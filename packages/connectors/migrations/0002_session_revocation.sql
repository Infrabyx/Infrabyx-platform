-- @infrabyx/connectors 0002: revoked sessions and users for the IDENTITY port (PL2 plan §6.5,
-- IPB-02-05, PL2-D-53). Expand-only. A revocation makes every replica refuse the session's tokens
-- (or every token a user was issued before `not_before`) within the 60 s the IPB allows; replicas
-- refresh their cache at least every 15 s. Subjects are stored as SHA-256 hashes only.
set lock_timeout = '5s';
set statement_timeout = '60s';

create table connectors.session_revocation (
  id            text        primary key check (id ~ '^rvk_[0-9A-HJKMNP-TV-Z]{26}$'),
  tenant_id     text        not null,
  kind          text        not null check (kind in ('session', 'user')),
  subject_hash  text        not null check (subject_hash ~ '^[0-9a-f]{64}$'),
  not_before    timestamptz not null,
  reason        text        not null check (reason in ('logout', 'scim_deactivate', 'revoke_sessions', 'security')),
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  constraint session_revocation_unique unique (tenant_id, kind, subject_hash)
);
comment on column connectors.session_revocation.id is 'dataclass:INTERNAL';
comment on column connectors.session_revocation.tenant_id is 'dataclass:INTERNAL';
comment on column connectors.session_revocation.kind is 'dataclass:INTERNAL';
comment on column connectors.session_revocation.subject_hash is 'dataclass:INTERNAL';
comment on column connectors.session_revocation.not_before is 'dataclass:INTERNAL';
comment on column connectors.session_revocation.reason is 'dataclass:INTERNAL';
comment on column connectors.session_revocation.created_at is 'dataclass:INTERNAL';
comment on column connectors.session_revocation.expires_at is 'dataclass:INTERNAL';
create index session_revocation_expiry_idx on connectors.session_revocation (tenant_id, expires_at);

alter table connectors.session_revocation enable row level security;
alter table connectors.session_revocation force row level security;
create policy session_revocation_tenant on connectors.session_revocation for all
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
grant select, insert, update, delete on connectors.session_revocation to app_rw;
grant select on connectors.session_revocation to app_ro;
