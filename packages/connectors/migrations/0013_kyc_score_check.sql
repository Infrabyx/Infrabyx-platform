-- @infrabyx/connectors 0013: liveness and face-match checks by idempotency key (Udofin PR-UDF-044,
-- R1-D-197; threat model §3.140). Expand-only. One row per keyed `livenessCheck` or `faceMatch`,
-- under forced RLS by tenant and written through the kernel with a ledger entry per mutation, so a
-- retry with the same key gets the first answer and the vendor is never asked twice for one key. A
-- key is scoped to its method. No image, frame, face template or embedding, and no storage
-- reference in clear: the key is kept as SHA-256, the request (the files' storage keys and SHA-256s
-- in order, and the liveness mode) as an HMAC-SHA-256 keyed by the idempotency key, which no row
-- holds in clear. The liveness mode is kept in clear. The result is the port's answer (score, pass,
-- threshold, mode, evidence). A row lives 24 hours (IPB-10-07's window); expired rows are deleted
-- by the adapter's store when the key comes again, or by its purge.
set lock_timeout = '5s';
set statement_timeout = '60s';

create table connectors.kyc_score_check (
  id            text        primary key check (id ~ '^ksc_[0-9A-HJKMNP-TV-Z]{26}$'),
  tenant_id     text        not null,
  adapter       text        not null check (adapter ~ '^[a-z][a-z0-9-]{0,63}$'),
  method        text        not null check (method in ('liveness', 'face_match')),
  key_hash      text        not null check (key_hash ~ '^[0-9a-f]{64}$'),
  request_hash  text        not null check (request_hash ~ '^[0-9a-f]{64}$'),
  mode          text        check (mode in ('passive', 'active_gesture', 'active_voice')),
  state         text        not null check (state in ('pending', 'done')),
  result        jsonb       check (result is null or jsonb_typeof(result) = 'object'),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  constraint kyc_score_check_mode_for_liveness check ((method = 'liveness') = (mode is not null)),
  constraint kyc_score_check_result_when_done check ((state = 'done') = (result is not null)),
  constraint kyc_score_check_one_per_key unique (tenant_id, adapter, method, key_hash)
);
comment on column connectors.kyc_score_check.id is 'dataclass:INTERNAL';
comment on column connectors.kyc_score_check.tenant_id is 'dataclass:INTERNAL';
comment on column connectors.kyc_score_check.adapter is 'dataclass:INTERNAL';
comment on column connectors.kyc_score_check.method is 'dataclass:INTERNAL';
comment on column connectors.kyc_score_check.key_hash is 'dataclass:INTERNAL';
comment on column connectors.kyc_score_check.request_hash is 'dataclass:INTERNAL';
comment on column connectors.kyc_score_check.mode is 'dataclass:INTERNAL';
comment on column connectors.kyc_score_check.state is 'dataclass:INTERNAL';
comment on column connectors.kyc_score_check.result is 'dataclass:REGULATED';
comment on column connectors.kyc_score_check.created_at is 'dataclass:INTERNAL';
comment on column connectors.kyc_score_check.updated_at is 'dataclass:INTERNAL';
comment on column connectors.kyc_score_check.expires_at is 'dataclass:INTERNAL';
create index kyc_score_check_expiry_idx on connectors.kyc_score_check (tenant_id, expires_at);

-- A live row keeps its key, method, request and mode; it moves once, from pending to done, and its
-- result is set only by that move.
create function connectors.kyc_score_check_guard() returns trigger
  language plpgsql
  set search_path = pg_catalog, pg_temp
as $$
begin
  if new.id <> old.id or new.tenant_id <> old.tenant_id or new.adapter <> old.adapter
    or new.method <> old.method or new.key_hash <> old.key_hash
    or new.request_hash <> old.request_hash or new.mode is distinct from old.mode
    or new.created_at <> old.created_at or new.expires_at <> old.expires_at then
    raise exception 'a liveness or face-match check record keeps its key and request' using errcode = 'P0001';
  end if;
  if old.state <> 'pending' then
    raise exception 'a % liveness or face-match check record is final', old.state using errcode = 'P0001';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
alter function connectors.kyc_score_check_guard() owner to app_migrate;
revoke all on function connectors.kyc_score_check_guard() from public;
create trigger kyc_score_check_guard before update on connectors.kyc_score_check
  for each row execute function connectors.kyc_score_check_guard();

alter table connectors.kyc_score_check enable row level security;
alter table connectors.kyc_score_check force row level security;
create policy kyc_score_check_tenant on connectors.kyc_score_check for all
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));

grant select, insert, update, delete on connectors.kyc_score_check to app_rw;
grant select on connectors.kyc_score_check to app_ro;
