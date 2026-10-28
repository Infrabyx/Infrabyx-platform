-- apps/reference hello 0001: the module pattern on one tenant table (PL6 plan §8.1). Expand-only.
-- (1) `hello.greeting` is tenant-scoped under forced RLS: every policy compares `tenant_id` with
--     `app.tenant_id`, which the kernel sets from the verified context (IPB-02-12, IPB-02-13).
-- (2) No delete policy: a greeting is retracted (maker-checker) or soft-deleted by an owner; the
--     rows stay for the ledger and the export.
-- (3) The module's outbox and inbox (IPB-01 §01.4.3.3), as in every platform module.
set lock_timeout = '5s';
set statement_timeout = '60s';

create schema if not exists hello;
revoke all on schema hello from public;
grant usage on schema hello to app_rw, app_ro;

create table hello.greeting (
  id              text        primary key check (id ~ '^grt_[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  tenant_id       text        not null references tenancy.tenant (id),
  message         text        not null check (length(message) between 1 and 2000),
  created_by      text        not null check (length(created_by) between 1 and 120),
  created_at      timestamptz not null default now(),
  retracted_at    timestamptz,
  retract_reason  text        check (length(retract_reason) <= 500),
  deleted_at      timestamptz,
  constraint greeting_retracted check ((retracted_at is null) = (retract_reason is null))
);
comment on column hello.greeting.id is 'dataclass:INTERNAL';
comment on column hello.greeting.tenant_id is 'dataclass:INTERNAL';
comment on column hello.greeting.message is 'dataclass:INTERNAL';
comment on column hello.greeting.created_by is 'dataclass:INTERNAL';
comment on column hello.greeting.created_at is 'dataclass:INTERNAL';
comment on column hello.greeting.retracted_at is 'dataclass:INTERNAL';
comment on column hello.greeting.retract_reason is 'dataclass:INTERNAL';
comment on column hello.greeting.deleted_at is 'dataclass:INTERNAL';
create index greeting_tenant_created_idx on hello.greeting (tenant_id, created_at desc) where deleted_at is null;

alter table hello.greeting enable row level security;
alter table hello.greeting force row level security;
create policy greeting_select on hello.greeting for select
  using (tenant_id = current_setting('app.tenant_id', true));
create policy greeting_insert on hello.greeting for insert
  with check (tenant_id = current_setting('app.tenant_id', true));
create policy greeting_update on hello.greeting for update
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
grant select, insert, update on hello.greeting to app_rw;
grant select on hello.greeting to app_ro;

-- Transactional outbox and consumer inbox (IPB-01 §01.4.3.3).
create table hello.outbox (
  id             text        primary key,
  tenant_id      text        not null,
  type           text        not null,
  envelope       jsonb       not null,
  created_at     timestamptz not null default now(),
  dispatched_at  timestamptz,
  attempts       integer     not null default 0
);
comment on column hello.outbox.id is 'dataclass:INTERNAL';
comment on column hello.outbox.tenant_id is 'dataclass:INTERNAL';
comment on column hello.outbox.type is 'dataclass:INTERNAL';
comment on column hello.outbox.envelope is 'dataclass:INTERNAL';
comment on column hello.outbox.created_at is 'dataclass:INTERNAL';
comment on column hello.outbox.dispatched_at is 'dataclass:INTERNAL';
comment on column hello.outbox.attempts is 'dataclass:INTERNAL';
create index hello_outbox_pending_idx on hello.outbox (created_at) where dispatched_at is null;
alter table hello.outbox enable row level security;
alter table hello.outbox force row level security;
create policy outbox_tenant on hello.outbox for all
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
grant select, insert, update on hello.outbox to app_rw;
grant select on hello.outbox to app_ro;

create table hello.inbox (
  consumer      text        not null,
  event_id      text        not null,
  tenant_id     text        not null,
  processed_at  timestamptz not null default now(),
  primary key (consumer, event_id)
);
comment on column hello.inbox.consumer is 'dataclass:INTERNAL';
comment on column hello.inbox.event_id is 'dataclass:INTERNAL';
comment on column hello.inbox.tenant_id is 'dataclass:INTERNAL';
comment on column hello.inbox.processed_at is 'dataclass:INTERNAL';
alter table hello.inbox enable row level security;
alter table hello.inbox force row level security;
create policy inbox_tenant on hello.inbox for all
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
grant select, insert on hello.inbox to app_rw;
grant select on hello.inbox to app_ro;
