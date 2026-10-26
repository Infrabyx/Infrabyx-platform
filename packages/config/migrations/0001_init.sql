-- @infrabyx/config 0001: settings values, flags, outbox and inbox (IPB-07 §07.3.3, IPB-09-24,
-- IPB-01 §01.4.3.3). Expand-only. Requires the roles created by @infrabyx/tenancy 0001.
set lock_timeout = '5s';
set statement_timeout = '60s';

create schema if not exists config;
revoke all on schema config from public;
grant usage on schema config to app_rw, app_ro;

-- Stored setting values. PLATFORM/PLAN/BRAND rows carry no tenant_id and are written only in a
-- platform context; TENANT/ENTITY/USER rows belong to one tenant and follow app.tenant_id.
create table config.setting_value (
  id          text        primary key check (id ~ '^set_[0-9A-HJKMNP-TV-Z]{26}$'),
  key         text        not null check (key ~ '^[a-z0-9][a-z0-9_.-]*$'),
  tier        text        not null check (tier in ('PLATFORM', 'PLAN', 'BRAND', 'TENANT', 'ENTITY', 'USER')),
  scope_id    text,
  tenant_id   text,
  value       jsonb       not null,
  version     integer     not null default 1 check (version > 0),
  updated_at  timestamptz not null default now(),
  updated_by  text        not null,
  constraint setting_value_scope check (
    (tier = 'PLATFORM' and scope_id is null and tenant_id is null)
    or (tier in ('PLAN', 'BRAND') and scope_id is not null and tenant_id is null)
    or (tier in ('TENANT', 'ENTITY', 'USER') and scope_id is not null and tenant_id is not null)
  ),
  constraint setting_value_tenant_scope check (tier <> 'TENANT' or scope_id = tenant_id),
  constraint setting_value_unique unique nulls not distinct (key, tier, scope_id)
);
comment on column config.setting_value.id is 'dataclass:INTERNAL';
comment on column config.setting_value.key is 'dataclass:INTERNAL';
comment on column config.setting_value.tier is 'dataclass:INTERNAL';
comment on column config.setting_value.scope_id is 'dataclass:INTERNAL';
comment on column config.setting_value.tenant_id is 'dataclass:INTERNAL';
comment on column config.setting_value.value is 'dataclass:CONFIDENTIAL';
comment on column config.setting_value.version is 'dataclass:INTERNAL';
comment on column config.setting_value.updated_at is 'dataclass:INTERNAL';
comment on column config.setting_value.updated_by is 'dataclass:INTERNAL';
create index setting_value_tenant_idx on config.setting_value (tenant_id, key);

alter table config.setting_value enable row level security;
alter table config.setting_value force row level security;
create policy setting_value_read on config.setting_value for select
  using (tenant_id is null or tenant_id = current_setting('app.tenant_id', true));
create policy setting_value_insert on config.setting_value for insert
  with check (
    tenant_id = current_setting('app.tenant_id', true)
    or (tenant_id is null and current_setting('app.scope', true) = 'platform')
  );
create policy setting_value_update on config.setting_value for update
  using (
    tenant_id = current_setting('app.tenant_id', true)
    or (tenant_id is null and current_setting('app.scope', true) = 'platform')
  )
  with check (
    tenant_id = current_setting('app.tenant_id', true)
    or (tenant_id is null and current_setting('app.scope', true) = 'platform')
  );
create policy setting_value_delete on config.setting_value for delete
  using (
    tenant_id = current_setting('app.tenant_id', true)
    or (tenant_id is null and current_setting('app.scope', true) = 'platform')
  );
grant select, insert, update, delete on config.setting_value to app_rw;
grant select on config.setting_value to app_ro;

-- Flag values for the PostgreSQL FEATURE_FLAG adapter (platform rows, no tenant data).
create table config.flag_value (
  flag_key    text        primary key check (flag_key ~ '^(mod|exp|ops|kill|fut)\.[a-z0-9_.-]+$'),
  value       jsonb       not null,
  updated_at  timestamptz not null default now(),
  updated_by  text        not null
);
comment on column config.flag_value.flag_key is 'dataclass:INTERNAL';
comment on column config.flag_value.value is 'dataclass:INTERNAL';
comment on column config.flag_value.updated_at is 'dataclass:INTERNAL';
comment on column config.flag_value.updated_by is 'dataclass:INTERNAL';
alter table config.flag_value enable row level security;
alter table config.flag_value force row level security;
create policy flag_value_read on config.flag_value for select using (true);
create policy flag_value_write on config.flag_value for insert
  with check (current_setting('app.scope', true) = 'platform');
create policy flag_value_update on config.flag_value for update
  using (current_setting('app.scope', true) = 'platform')
  with check (current_setting('app.scope', true) = 'platform');
grant select, insert, update on config.flag_value to app_rw;
grant select on config.flag_value to app_ro;

-- Last-known-good flag snapshot (IPB-01: snapshot ≤ 24 h; IPB-02-83 safe state).
create table config.flag_snapshot (
  flag_key    text        primary key,
  value       jsonb       not null,
  fetched_at  timestamptz not null
);
comment on column config.flag_snapshot.flag_key is 'dataclass:INTERNAL';
comment on column config.flag_snapshot.value is 'dataclass:INTERNAL';
comment on column config.flag_snapshot.fetched_at is 'dataclass:INTERNAL';
alter table config.flag_snapshot enable row level security;
alter table config.flag_snapshot force row level security;
create policy flag_snapshot_all on config.flag_snapshot for all using (true) with check (true);
grant select, insert, update on config.flag_snapshot to app_rw;
grant select on config.flag_snapshot to app_ro;

-- Transactional outbox and consumer inbox (IPB-01 §01.4.3.3).
create table config.outbox (
  id             text        primary key,
  tenant_id      text        not null,
  type           text        not null,
  envelope       jsonb       not null,
  created_at     timestamptz not null default now(),
  dispatched_at  timestamptz,
  attempts       integer     not null default 0
);
comment on column config.outbox.id is 'dataclass:INTERNAL';
comment on column config.outbox.tenant_id is 'dataclass:INTERNAL';
comment on column config.outbox.type is 'dataclass:INTERNAL';
comment on column config.outbox.envelope is 'dataclass:CONFIDENTIAL';
comment on column config.outbox.created_at is 'dataclass:INTERNAL';
comment on column config.outbox.dispatched_at is 'dataclass:INTERNAL';
comment on column config.outbox.attempts is 'dataclass:INTERNAL';
create index outbox_pending_idx on config.outbox (created_at) where dispatched_at is null;
alter table config.outbox enable row level security;
alter table config.outbox force row level security;
create policy outbox_tenant on config.outbox for all
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
grant select, insert, update on config.outbox to app_rw;
grant select on config.outbox to app_ro;

create table config.inbox (
  consumer      text        not null,
  event_id      text        not null,
  tenant_id     text        not null,
  processed_at  timestamptz not null default now(),
  primary key (consumer, event_id)
);
comment on column config.inbox.consumer is 'dataclass:INTERNAL';
comment on column config.inbox.event_id is 'dataclass:INTERNAL';
comment on column config.inbox.tenant_id is 'dataclass:INTERNAL';
comment on column config.inbox.processed_at is 'dataclass:INTERNAL';
alter table config.inbox enable row level security;
alter table config.inbox force row level security;
create policy inbox_tenant on config.inbox for all
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
grant select, insert, delete on config.inbox to app_rw;
grant select on config.inbox to app_ro;
