-- @infrabyx/config 0003: per-value setting change history (IPB-07-39; LawDocsComply PR-LDC-17,
-- R1-D-82). Expand-only. One row per applied change, written by `SettingsService` in the same
-- transaction as the value and its `settings.setting.change` ledger entry, whose id it carries:
-- the ledger keeps the digests of { value: old } and { value: new }, this row the values. Insert-only
-- for the application roles; TENANT, ENTITY and USER rows follow app.tenant_id, PLATFORM, PLAN and
-- BRAND rows are read and written only in a platform context, and the actor is the context's own.
set lock_timeout = '5s';
set statement_timeout = '60s';

create table config.setting_change (
  seq            bigint      generated always as identity primary key,
  id             text        not null unique check (id ~ '^sch_[0-9A-HJKMNP-TV-Z]{26}$'),
  ledger_id      text        not null check (ledger_id ~ '^[A-Za-z0-9_]{1,64}$'),
  key            text        not null check (key ~ '^[a-z0-9][a-z0-9_.-]*$'),
  tier           text        not null check (tier in ('PLATFORM', 'PLAN', 'BRAND', 'TENANT', 'ENTITY', 'USER')),
  scope_id       text,
  tenant_id      text,
  old_value      jsonb,
  new_value      jsonb,
  version        integer     not null check (version > 0),
  actor_id       text        not null,
  mc_request_id  text,
  changed_at     timestamptz not null default now(),
  constraint setting_change_scope check (
    (tier = 'PLATFORM' and scope_id is null and tenant_id is null)
    or (tier in ('PLAN', 'BRAND') and scope_id is not null and tenant_id is null)
    or (tier in ('TENANT', 'ENTITY', 'USER') and scope_id is not null and tenant_id is not null)
  ),
  constraint setting_change_tenant_scope check (tier <> 'TENANT' or scope_id = tenant_id)
);
comment on column config.setting_change.seq is 'dataclass:INTERNAL';
comment on column config.setting_change.id is 'dataclass:INTERNAL';
comment on column config.setting_change.ledger_id is 'dataclass:INTERNAL';
comment on column config.setting_change.key is 'dataclass:INTERNAL';
comment on column config.setting_change.tier is 'dataclass:INTERNAL';
comment on column config.setting_change.scope_id is 'dataclass:INTERNAL';
comment on column config.setting_change.tenant_id is 'dataclass:INTERNAL';
comment on column config.setting_change.old_value is 'dataclass:CONFIDENTIAL';
comment on column config.setting_change.new_value is 'dataclass:CONFIDENTIAL';
comment on column config.setting_change.version is 'dataclass:INTERNAL';
comment on column config.setting_change.actor_id is 'dataclass:INTERNAL';
comment on column config.setting_change.mc_request_id is 'dataclass:INTERNAL';
comment on column config.setting_change.changed_at is 'dataclass:INTERNAL';
-- The history of one key at one scope, newest first.
create index setting_change_scope_idx on config.setting_change (key, tier, scope_id, seq desc);
create index setting_change_tenant_idx on config.setting_change (tenant_id, key);

alter table config.setting_change enable row level security;
alter table config.setting_change force row level security;
create policy setting_change_read on config.setting_change for select
  using (
    tenant_id = current_setting('app.tenant_id', true)
    or (tenant_id is null and current_setting('app.scope', true) = 'platform')
  );
create policy setting_change_insert on config.setting_change for insert
  with check (
    actor_id = current_setting('app.actor_id', true)
    and (
      tenant_id = current_setting('app.tenant_id', true)
      or (tenant_id is null and current_setting('app.scope', true) = 'platform')
    )
  );
grant select, insert on config.setting_change to app_rw;
grant select on config.setting_change to app_ro;
