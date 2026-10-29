-- @infrabyx/connectors 0004: customer sign-in state for the IDENTITY port (OWNER-QUESTIONS #84 (b),
-- R1-D-19). Expand-only. Three tables, each under forced RLS by tenant, written through the kernel
-- with an audit entry per mutation, and with no delete grant (removing rows is a retention
-- decision, OWNER-QUESTIONS #85):
--   customer_otp_guard      per-account send counts, consecutive failures and lockouts (IPB-02
--                           §02.4.6.2 auth.otp); the account is the IdP user id, stored hashed;
--   customer_otp_challenge  one row per code sent: the device key it is bound to, the attempts, the
--                           IdP's reference (never the code: the IdP keeps only a hash of it);
--   customer_device         one row per signed-in device: its DPoP key thumbprint, the IdP session
--                           and a SHA-256 hash of the current refresh token (rotated on refresh).
set lock_timeout = '5s';
set statement_timeout = '60s';

create table connectors.customer_otp_guard (
  tenant_id        text        not null,
  account_hash     text        not null check (account_hash ~ '^[0-9a-f]{64}$'),
  window_start     timestamptz not null,
  sends            integer     not null default 0 check (sends >= 0),
  last_send_at     timestamptz,
  failures         integer     not null default 0 check (failures >= 0),
  last_failure_at  timestamptz,
  locked_until     timestamptz,
  updated_at       timestamptz not null default now(),
  primary key (tenant_id, account_hash)
);
comment on column connectors.customer_otp_guard.tenant_id is 'dataclass:INTERNAL';
comment on column connectors.customer_otp_guard.account_hash is 'dataclass:INTERNAL';
comment on column connectors.customer_otp_guard.window_start is 'dataclass:INTERNAL';
comment on column connectors.customer_otp_guard.sends is 'dataclass:INTERNAL';
comment on column connectors.customer_otp_guard.last_send_at is 'dataclass:INTERNAL';
comment on column connectors.customer_otp_guard.failures is 'dataclass:INTERNAL';
comment on column connectors.customer_otp_guard.last_failure_at is 'dataclass:INTERNAL';
comment on column connectors.customer_otp_guard.locked_until is 'dataclass:INTERNAL';
comment on column connectors.customer_otp_guard.updated_at is 'dataclass:INTERNAL';

create table connectors.customer_otp_challenge (
  id            text        primary key check (id ~ '^[A-Za-z0-9_-]{22}$'),
  tenant_id     text        not null,
  user_id       text        not null check (length(user_id) between 1 and 200),
  channel       text        not null check (channel in ('sms', 'whatsapp', 'email')),
  jkt           text        not null check (jkt ~ '^[A-Za-z0-9_-]{43}$'),
  idp_ref       jsonb       not null,
  attempts      integer     not null default 0 check (attempts >= 0),
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  consumed_at   timestamptz
);
comment on column connectors.customer_otp_challenge.id is 'dataclass:INTERNAL';
comment on column connectors.customer_otp_challenge.tenant_id is 'dataclass:INTERNAL';
comment on column connectors.customer_otp_challenge.user_id is 'dataclass:CONFIDENTIAL';
comment on column connectors.customer_otp_challenge.channel is 'dataclass:INTERNAL';
comment on column connectors.customer_otp_challenge.jkt is 'dataclass:INTERNAL';
comment on column connectors.customer_otp_challenge.idp_ref is 'dataclass:CONFIDENTIAL';
comment on column connectors.customer_otp_challenge.attempts is 'dataclass:INTERNAL';
comment on column connectors.customer_otp_challenge.created_at is 'dataclass:INTERNAL';
comment on column connectors.customer_otp_challenge.expires_at is 'dataclass:INTERNAL';
comment on column connectors.customer_otp_challenge.consumed_at is 'dataclass:INTERNAL';
create index customer_otp_challenge_expiry_idx on connectors.customer_otp_challenge (tenant_id, expires_at);

create table connectors.customer_device (
  id            text        primary key check (id ~ '^dev_[0-9A-HJKMNP-TV-Z]{26}$'),
  tenant_id     text        not null,
  user_id       text        not null check (length(user_id) between 1 and 200),
  jkt           text        not null check (jkt ~ '^[A-Za-z0-9_-]{43}$'),
  idp_session   text        not null check (length(idp_session) between 1 and 200),
  refresh_hash  text        not null check (refresh_hash ~ '^[0-9a-f]{64}$'),
  label         text        check (length(label) <= 80),
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz not null default now(),
  revoked_at    timestamptz,
  revoked_reason text       check (revoked_reason in ('sign_out', 'revoked', 'key_mismatch', 'security'))
);
comment on column connectors.customer_device.id is 'dataclass:INTERNAL';
comment on column connectors.customer_device.tenant_id is 'dataclass:INTERNAL';
comment on column connectors.customer_device.user_id is 'dataclass:CONFIDENTIAL';
comment on column connectors.customer_device.jkt is 'dataclass:INTERNAL';
comment on column connectors.customer_device.idp_session is 'dataclass:CONFIDENTIAL';
comment on column connectors.customer_device.refresh_hash is 'dataclass:CONFIDENTIAL';
comment on column connectors.customer_device.label is 'dataclass:CONFIDENTIAL';
comment on column connectors.customer_device.created_at is 'dataclass:INTERNAL';
comment on column connectors.customer_device.last_used_at is 'dataclass:INTERNAL';
comment on column connectors.customer_device.revoked_at is 'dataclass:INTERNAL';
comment on column connectors.customer_device.revoked_reason is 'dataclass:INTERNAL';
create unique index customer_device_refresh_idx on connectors.customer_device (tenant_id, refresh_hash);
create index customer_device_user_idx on connectors.customer_device (tenant_id, user_id, jkt);

alter table connectors.customer_otp_guard enable row level security;
alter table connectors.customer_otp_guard force row level security;
create policy customer_otp_guard_tenant on connectors.customer_otp_guard for all
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
alter table connectors.customer_otp_challenge enable row level security;
alter table connectors.customer_otp_challenge force row level security;
create policy customer_otp_challenge_tenant on connectors.customer_otp_challenge for all
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
alter table connectors.customer_device enable row level security;
alter table connectors.customer_device force row level security;
create policy customer_device_tenant on connectors.customer_device for all
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));

grant select, insert, update on connectors.customer_otp_guard to app_rw;
grant select, insert, update on connectors.customer_otp_challenge to app_rw;
grant select, insert, update on connectors.customer_device to app_rw;
grant select on connectors.customer_otp_guard to app_ro;
grant select on connectors.customer_otp_challenge to app_ro;
grant select on connectors.customer_device to app_ro;
