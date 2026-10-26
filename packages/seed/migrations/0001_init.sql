-- @infrabyx/seed 0001: seed runs and the rows each profile created (IPB-11-31, PL1-D-06).
-- Expand-only. Holds no personal data. Requires the roles from @infrabyx/tenancy 0001.
set lock_timeout = '5s';
set statement_timeout = '60s';

create schema if not exists seed;
revoke all on schema seed from public;
grant usage on schema seed to app_rw, app_ro;

create table seed.seed_run (
  id           text        primary key check (id ~ '^run_[0-9A-HJKMNP-TV-Z]{26}$'),
  tenant_id    text        not null default 'tnt_platform',
  profile      text        not null check (profile in ('dev', 'demo', 'test', 'load')),
  product      text        not null,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  counts       jsonb       not null default '{}'
);
comment on column seed.seed_run.id is 'dataclass:INTERNAL';
comment on column seed.seed_run.tenant_id is 'dataclass:INTERNAL';
comment on column seed.seed_run.profile is 'dataclass:INTERNAL';
comment on column seed.seed_run.product is 'dataclass:INTERNAL';
comment on column seed.seed_run.started_at is 'dataclass:INTERNAL';
comment on column seed.seed_run.finished_at is 'dataclass:INTERNAL';
comment on column seed.seed_run.counts is 'dataclass:INTERNAL';
alter table seed.seed_run enable row level security;
alter table seed.seed_run force row level security;
create policy seed_run_platform on seed.seed_run for all
  using (tenant_id = current_setting('app.tenant_id', true) and current_setting('app.scope', true) = 'platform')
  with check (tenant_id = current_setting('app.tenant_id', true) and current_setting('app.scope', true) = 'platform');
grant select, insert, update on seed.seed_run to app_rw;
grant select on seed.seed_run to app_ro;

-- One row per seeded database row; `ord` gives the insertion order that purge reverses.
create table seed.seed_row (
  ord         bigint      generated always as identity primary key,
  run_id      text        not null references seed.seed_run (id),
  tenant_id   text        not null,
  profile     text        not null check (profile in ('dev', 'demo', 'test', 'load')),
  table_name  text        not null check (table_name ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$'),
  row_key     jsonb       not null,
  created_at  timestamptz not null default now(),
  unique (table_name, row_key)
);
comment on column seed.seed_row.ord is 'dataclass:INTERNAL';
comment on column seed.seed_row.run_id is 'dataclass:INTERNAL';
comment on column seed.seed_row.tenant_id is 'dataclass:INTERNAL';
comment on column seed.seed_row.profile is 'dataclass:INTERNAL';
comment on column seed.seed_row.table_name is 'dataclass:INTERNAL';
comment on column seed.seed_row.row_key is 'dataclass:INTERNAL';
comment on column seed.seed_row.created_at is 'dataclass:INTERNAL';
create index seed_row_profile_idx on seed.seed_row (profile, ord);
alter table seed.seed_row enable row level security;
alter table seed.seed_row force row level security;
create policy seed_row_tenant on seed.seed_row for all
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
grant select, insert on seed.seed_row to app_rw;
grant select on seed.seed_row to app_ro;

create table seed.outbox (
  id             text        primary key,
  tenant_id      text        not null,
  type           text        not null,
  envelope       jsonb       not null,
  created_at     timestamptz not null default now(),
  dispatched_at  timestamptz,
  attempts       integer     not null default 0
);
comment on column seed.outbox.id is 'dataclass:INTERNAL';
comment on column seed.outbox.tenant_id is 'dataclass:INTERNAL';
comment on column seed.outbox.type is 'dataclass:INTERNAL';
comment on column seed.outbox.envelope is 'dataclass:INTERNAL';
comment on column seed.outbox.created_at is 'dataclass:INTERNAL';
comment on column seed.outbox.dispatched_at is 'dataclass:INTERNAL';
comment on column seed.outbox.attempts is 'dataclass:INTERNAL';
alter table seed.outbox enable row level security;
alter table seed.outbox force row level security;
create policy outbox_tenant on seed.outbox for all
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
grant select, insert, update on seed.outbox to app_rw;
grant select on seed.outbox to app_ro;
