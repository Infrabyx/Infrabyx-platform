-- @infrabyx/connectors 0010: DigiLocker pulls by idempotency key (Udofin PR-UDF-040, R1-D-193;
-- threat model §3.136). Expand-only. One row per keyed pull, under forced RLS by tenant and written
-- through the kernel with a ledger entry per mutation, so a retry with the same key gets the
-- documents the first pull stored instead of `consent_used`. Ids, hashes and references only: the
-- key and the consent session are matched by SHA-256 (the key is never kept as given); each
-- document by its STORAGE reference, issuer and evidence (the vendor's reference among it), never
-- its content. A row lives 24 hours (IPB-10-07's window); expired rows are deleted by the adapter's
-- store when the key or the session comes again, or by its purge.
set lock_timeout = '5s';
set statement_timeout = '60s';

create table connectors.kyc_digilocker_pull (
  id            text        primary key check (id ~ '^kdl_[0-9A-HJKMNP-TV-Z]{26}$'),
  tenant_id     text        not null,
  adapter       text        not null check (adapter ~ '^[a-z][a-z0-9-]{0,63}$'),
  key_hash      text        not null check (key_hash ~ '^[0-9a-f]{64}$'),
  consent_hash  text        not null check (consent_hash ~ '^[0-9a-f]{64}$'),
  request_hash  text        not null check (request_hash ~ '^[0-9a-f]{64}$'),
  state         text        not null check (state in ('pending', 'done', 'refused')),
  documents     jsonb       check (documents is null or (jsonb_typeof(documents) = 'array'
                                   and jsonb_array_length(documents) <= 5)),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  constraint kyc_digilocker_pull_documents_when_done check ((state = 'done') = (documents is not null)),
  constraint kyc_digilocker_pull_one_per_key unique (tenant_id, adapter, key_hash),
  constraint kyc_digilocker_pull_one_per_session unique (tenant_id, adapter, consent_hash)
);
comment on column connectors.kyc_digilocker_pull.id is 'dataclass:INTERNAL';
comment on column connectors.kyc_digilocker_pull.tenant_id is 'dataclass:INTERNAL';
comment on column connectors.kyc_digilocker_pull.adapter is 'dataclass:INTERNAL';
comment on column connectors.kyc_digilocker_pull.key_hash is 'dataclass:INTERNAL';
comment on column connectors.kyc_digilocker_pull.consent_hash is 'dataclass:INTERNAL';
comment on column connectors.kyc_digilocker_pull.request_hash is 'dataclass:INTERNAL';
comment on column connectors.kyc_digilocker_pull.state is 'dataclass:INTERNAL';
comment on column connectors.kyc_digilocker_pull.documents is 'dataclass:INTERNAL';
comment on column connectors.kyc_digilocker_pull.created_at is 'dataclass:INTERNAL';
comment on column connectors.kyc_digilocker_pull.updated_at is 'dataclass:INTERNAL';
comment on column connectors.kyc_digilocker_pull.expires_at is 'dataclass:INTERNAL';
create index kyc_digilocker_pull_expiry_idx on connectors.kyc_digilocker_pull (tenant_id, expires_at);

-- A live row keeps its key, session and request; it moves once, from pending to done or refused,
-- and its documents are set only by that move.
create function connectors.kyc_digilocker_pull_guard() returns trigger
  language plpgsql
  set search_path = pg_catalog, pg_temp
as $$
begin
  if new.id <> old.id or new.tenant_id <> old.tenant_id or new.adapter <> old.adapter
    or new.key_hash <> old.key_hash or new.consent_hash <> old.consent_hash
    or new.request_hash <> old.request_hash or new.created_at <> old.created_at
    or new.expires_at <> old.expires_at then
    raise exception 'a DigiLocker pull record keeps its key, session and request' using errcode = 'P0001';
  end if;
  if old.state <> 'pending' then
    raise exception 'a % DigiLocker pull record is final', old.state using errcode = 'P0001';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
alter function connectors.kyc_digilocker_pull_guard() owner to app_migrate;
revoke all on function connectors.kyc_digilocker_pull_guard() from public;
create trigger kyc_digilocker_pull_guard before update on connectors.kyc_digilocker_pull
  for each row execute function connectors.kyc_digilocker_pull_guard();

alter table connectors.kyc_digilocker_pull enable row level security;
alter table connectors.kyc_digilocker_pull force row level security;
create policy kyc_digilocker_pull_tenant on connectors.kyc_digilocker_pull for all
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));

grant select, insert, update, delete on connectors.kyc_digilocker_pull to app_rw;
grant select on connectors.kyc_digilocker_pull to app_ro;
