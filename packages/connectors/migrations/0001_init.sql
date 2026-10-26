-- @infrabyx/connectors 0001: idempotency records for port side effects (PL2 plan §3.5 and §5.4,
-- PL2-D-25, PL2-D-08). Expand-only. Requires the roles created by @infrabyx/tenancy 0001.
-- A record is written as `pending` before the vendor call and settled afterwards; every write goes
-- through the kernel with an audit ledger entry (IPB-MOD-003). Circuit-breaker state stays in
-- memory per replica (PL2-D-33), so there is no adapter_state table.
set lock_timeout = '5s';
set statement_timeout = '60s';

create schema if not exists connectors;
revoke all on schema connectors from public;
grant usage on schema connectors to app_rw, app_ro;

create table connectors.idempotency_record (
  id             text        primary key check (id ~ '^idm_[0-9A-HJKMNP-TV-Z]{26}$'),
  tenant_id      text        not null,
  port           text        not null check (port ~ '^[A-Z][A-Z_]*$'),
  adapter        text        not null check (adapter ~ '^[a-z][a-z0-9-]*$'),
  operation      text        not null check (operation ~ '^[a-zA-Z][a-zA-Z0-9_.]*$'),
  key_hash       text        not null check (key_hash ~ '^[0-9a-f]{64}$'),
  request_hash   text        not null check (request_hash ~ '^[0-9a-f]{64}$'),
  status         text        not null check (status in ('pending', 'succeeded', 'failed')),
  money          boolean     not null default false,
  data_class     text        not null check (data_class in ('PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'REGULATED', 'SECRET')),
  result         jsonb,
  result_sealed  jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  expires_at     timestamptz not null,
  constraint idempotency_record_unique unique (tenant_id, port, key_hash),
  constraint idempotency_record_one_result check (result is null or result_sealed is null),
  constraint idempotency_record_sealed_above_internal check (
    result is null or data_class in ('PUBLIC', 'INTERNAL')
  )
);
comment on column connectors.idempotency_record.id is 'dataclass:INTERNAL';
comment on column connectors.idempotency_record.tenant_id is 'dataclass:INTERNAL';
comment on column connectors.idempotency_record.port is 'dataclass:INTERNAL';
comment on column connectors.idempotency_record.adapter is 'dataclass:INTERNAL';
comment on column connectors.idempotency_record.operation is 'dataclass:INTERNAL';
comment on column connectors.idempotency_record.key_hash is 'dataclass:INTERNAL';
comment on column connectors.idempotency_record.request_hash is 'dataclass:INTERNAL';
comment on column connectors.idempotency_record.status is 'dataclass:INTERNAL';
comment on column connectors.idempotency_record.money is 'dataclass:INTERNAL';
comment on column connectors.idempotency_record.data_class is 'dataclass:INTERNAL';
comment on column connectors.idempotency_record.result is 'dataclass:INTERNAL';
comment on column connectors.idempotency_record.result_sealed is 'dataclass:REGULATED';
comment on column connectors.idempotency_record.created_at is 'dataclass:INTERNAL';
comment on column connectors.idempotency_record.updated_at is 'dataclass:INTERNAL';
comment on column connectors.idempotency_record.expires_at is 'dataclass:INTERNAL';
create index idempotency_record_expiry_idx on connectors.idempotency_record (tenant_id, expires_at);

alter table connectors.idempotency_record enable row level security;
alter table connectors.idempotency_record force row level security;
create policy idempotency_record_tenant on connectors.idempotency_record for all
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
grant select, insert, update, delete on connectors.idempotency_record to app_rw;
grant select on connectors.idempotency_record to app_ro;
