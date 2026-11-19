-- @infrabyx/connectors 0011: Aadhaar OTP verifies by idempotency key (Udofin PR-UDF-041, R1-D-194;
-- threat model §3.137). Expand-only. One row per keyed `aadhaarOtpVerify`, under forced RLS by
-- tenant and written through the kernel with a ledger entry per mutation, so a retry with the same
-- key gets the first answer (the result, or the vendor's `otp_invalid` or `otp_expired`). Hashes and
-- references only, and never the Aadhaar number, the VID or the code: the key is kept as SHA-256,
-- the request (transaction and code) as an HMAC-SHA-256 keyed by the key and the transaction, which
-- no row holds in clear; the result is the e-KYC's STORAGE reference, the evidence, the signature
-- result and the last four digits. A row lives 24 hours (IPB-10-07's window); expired rows are
-- deleted by the adapter's store when the key comes again, or by its purge.
set lock_timeout = '5s';
set statement_timeout = '60s';

create table connectors.kyc_aadhaar_otp_verify (
  id            text        primary key check (id ~ '^kao_[0-9A-HJKMNP-TV-Z]{26}$'),
  tenant_id     text        not null,
  adapter       text        not null check (adapter ~ '^[a-z][a-z0-9-]{0,63}$'),
  key_hash      text        not null check (key_hash ~ '^[0-9a-f]{64}$'),
  request_hash  text        not null check (request_hash ~ '^[0-9a-f]{64}$'),
  state         text        not null check (state in ('pending', 'done', 'refused')),
  reason        text        check (reason in ('otp_invalid', 'otp_expired')),
  result        jsonb       check (result is null or jsonb_typeof(result) = 'object'),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  constraint kyc_aadhaar_otp_verify_result_when_done check ((state = 'done') = (result is not null)),
  constraint kyc_aadhaar_otp_verify_reason_when_refused check ((state = 'refused') = (reason is not null)),
  constraint kyc_aadhaar_otp_verify_one_per_key unique (tenant_id, adapter, key_hash)
);
comment on column connectors.kyc_aadhaar_otp_verify.id is 'dataclass:INTERNAL';
comment on column connectors.kyc_aadhaar_otp_verify.tenant_id is 'dataclass:INTERNAL';
comment on column connectors.kyc_aadhaar_otp_verify.adapter is 'dataclass:INTERNAL';
comment on column connectors.kyc_aadhaar_otp_verify.key_hash is 'dataclass:INTERNAL';
comment on column connectors.kyc_aadhaar_otp_verify.request_hash is 'dataclass:INTERNAL';
comment on column connectors.kyc_aadhaar_otp_verify.state is 'dataclass:INTERNAL';
comment on column connectors.kyc_aadhaar_otp_verify.reason is 'dataclass:INTERNAL';
comment on column connectors.kyc_aadhaar_otp_verify.result is 'dataclass:CONFIDENTIAL';
comment on column connectors.kyc_aadhaar_otp_verify.created_at is 'dataclass:INTERNAL';
comment on column connectors.kyc_aadhaar_otp_verify.updated_at is 'dataclass:INTERNAL';
comment on column connectors.kyc_aadhaar_otp_verify.expires_at is 'dataclass:INTERNAL';
create index kyc_aadhaar_otp_verify_expiry_idx on connectors.kyc_aadhaar_otp_verify (tenant_id, expires_at);

-- A live row keeps its key and request; it moves once, from pending to done or refused, and its
-- result or reason is set only by that move.
create function connectors.kyc_aadhaar_otp_verify_guard() returns trigger
  language plpgsql
  set search_path = pg_catalog, pg_temp
as $$
begin
  if new.id <> old.id or new.tenant_id <> old.tenant_id or new.adapter <> old.adapter
    or new.key_hash <> old.key_hash or new.request_hash <> old.request_hash
    or new.created_at <> old.created_at or new.expires_at <> old.expires_at then
    raise exception 'an Aadhaar OTP verify record keeps its key and request' using errcode = 'P0001';
  end if;
  if old.state <> 'pending' then
    raise exception 'a % Aadhaar OTP verify record is final', old.state using errcode = 'P0001';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
alter function connectors.kyc_aadhaar_otp_verify_guard() owner to app_migrate;
revoke all on function connectors.kyc_aadhaar_otp_verify_guard() from public;
create trigger kyc_aadhaar_otp_verify_guard before update on connectors.kyc_aadhaar_otp_verify
  for each row execute function connectors.kyc_aadhaar_otp_verify_guard();

alter table connectors.kyc_aadhaar_otp_verify enable row level security;
alter table connectors.kyc_aadhaar_otp_verify force row level security;
create policy kyc_aadhaar_otp_verify_tenant on connectors.kyc_aadhaar_otp_verify for all
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));

grant select, insert, update, delete on connectors.kyc_aadhaar_otp_verify to app_rw;
grant select on connectors.kyc_aadhaar_otp_verify to app_ro;
