-- @infrabyx/workflow 0001: the Work Inbox, scheduled actions and durable timers (PL3 plan §5,
-- PL3-D-19). Expand-only. Requires the roles created by @infrabyx/tenancy 0001. Every write goes
-- through the kernel with an audit ledger entry.
set lock_timeout = '5s';
set statement_timeout = '60s';

create schema if not exists workflow;
revoke all on schema workflow from public;
grant usage on schema workflow to app_rw, app_ro;

-- Work Inbox items (IPB-07 §07.4.9). Titles are INTERNAL text without personal data.
create table workflow.inbox_item (
  id                 text        primary key check (id ~ '^ibx_[0-9A-HJKMNP-TV-Z]{26}$'),
  tenant_id          text        not null,
  type               text        not null check (type in ('task', 'approval', 'mention', 'suggestion', 'due', 'job_failed')),
  product_module     text        not null check (product_module ~ '^[a-z][a-z0-9_]*$'),
  record_ref         text        not null,
  title              text        not null check (length(title) between 1 and 200),
  assignee_kind      text        not null check (assignee_kind in ('user', 'role')),
  assignee_id        text        not null,
  -- The maker never sees the approval item for their own request.
  exclude_principal  text,
  severity           text        not null default 'info' check (severity in ('info', 'warning', 'critical')),
  action_hint        text,
  deep_link          text        not null,
  help_key           text        not null check (help_key ~ '^hlp\.[a-z0-9_]+\.[a-z0-9_.]+$'),
  due_at             timestamptz,
  from_agent         boolean     not null default false,
  from_id            text,
  created_at         timestamptz not null default now(),
  read_at            timestamptz,
  resolved_at        timestamptz,
  resolution         text
);
comment on column workflow.inbox_item.id is 'dataclass:INTERNAL';
comment on column workflow.inbox_item.tenant_id is 'dataclass:INTERNAL';
comment on column workflow.inbox_item.type is 'dataclass:INTERNAL';
comment on column workflow.inbox_item.product_module is 'dataclass:INTERNAL';
comment on column workflow.inbox_item.record_ref is 'dataclass:INTERNAL';
comment on column workflow.inbox_item.title is 'dataclass:INTERNAL';
comment on column workflow.inbox_item.assignee_kind is 'dataclass:INTERNAL';
comment on column workflow.inbox_item.assignee_id is 'dataclass:INTERNAL';
comment on column workflow.inbox_item.exclude_principal is 'dataclass:INTERNAL';
comment on column workflow.inbox_item.severity is 'dataclass:INTERNAL';
comment on column workflow.inbox_item.action_hint is 'dataclass:INTERNAL';
comment on column workflow.inbox_item.deep_link is 'dataclass:INTERNAL';
comment on column workflow.inbox_item.help_key is 'dataclass:INTERNAL';
comment on column workflow.inbox_item.due_at is 'dataclass:INTERNAL';
comment on column workflow.inbox_item.from_agent is 'dataclass:INTERNAL';
comment on column workflow.inbox_item.from_id is 'dataclass:INTERNAL';
comment on column workflow.inbox_item.created_at is 'dataclass:INTERNAL';
comment on column workflow.inbox_item.read_at is 'dataclass:INTERNAL';
comment on column workflow.inbox_item.resolved_at is 'dataclass:INTERNAL';
comment on column workflow.inbox_item.resolution is 'dataclass:INTERNAL';
create index inbox_item_open_idx on workflow.inbox_item (tenant_id, assignee_kind, assignee_id)
  where resolved_at is null;
create index inbox_item_record_idx on workflow.inbox_item (tenant_id, product_module, record_ref);
alter table workflow.inbox_item enable row level security;
alter table workflow.inbox_item force row level security;
create policy inbox_item_tenant on workflow.inbox_item for all
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
grant select, insert, update on workflow.inbox_item to app_rw;
grant select on workflow.inbox_item to app_ro;

-- Scheduled actions (IPB-02-80, IPB-07-27(c)): an approved request inside its delay window.
create table workflow.scheduled_action (
  id               text        primary key check (id ~ '^sca_[0-9A-HJKMNP-TV-Z]{26}$'),
  tenant_id        text        not null,
  approval_id      text        not null,
  action           text        not null,
  execute_at       timestamptz not null,
  state            text        not null default 'scheduled' check (state in ('scheduled', 'executed', 'cancelled', 'failed')),
  attempts         integer     not null default 0 check (attempts >= 0),
  last_error_code  text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint scheduled_action_one_per_request unique (tenant_id, approval_id)
);
comment on column workflow.scheduled_action.id is 'dataclass:INTERNAL';
comment on column workflow.scheduled_action.tenant_id is 'dataclass:INTERNAL';
comment on column workflow.scheduled_action.approval_id is 'dataclass:INTERNAL';
comment on column workflow.scheduled_action.action is 'dataclass:INTERNAL';
comment on column workflow.scheduled_action.execute_at is 'dataclass:INTERNAL';
comment on column workflow.scheduled_action.state is 'dataclass:INTERNAL';
comment on column workflow.scheduled_action.attempts is 'dataclass:INTERNAL';
comment on column workflow.scheduled_action.last_error_code is 'dataclass:INTERNAL';
comment on column workflow.scheduled_action.created_at is 'dataclass:INTERNAL';
comment on column workflow.scheduled_action.updated_at is 'dataclass:INTERNAL';
alter table workflow.scheduled_action enable row level security;
alter table workflow.scheduled_action force row level security;
create policy scheduled_action_tenant on workflow.scheduled_action for all
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
grant select, insert, update on workflow.scheduled_action to app_rw;
grant select on workflow.scheduled_action to app_ro;

-- Durable timers, one per (tenant, kind, ref). The poller reads due timers across tenants in a
-- platform context (ids and times only) and fires each in its own tenant's context.
create table workflow.timer (
  tenant_id   text        not null,
  kind        text        not null check (kind in ('approval.execute', 'approval.remind', 'approval.escalate', 'approval.expire')),
  ref         text        not null check (ref ~ '^(apr|sca)_[0-9A-HJKMNP-TV-Z]{26}$'),
  fire_at     timestamptz not null,
  state       text        not null default 'scheduled' check (state in ('scheduled', 'fired', 'cancelled')),
  attempts    integer     not null default 0 check (attempts >= 0),
  last_error  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (tenant_id, kind, ref)
);
comment on column workflow.timer.tenant_id is 'dataclass:INTERNAL';
comment on column workflow.timer.kind is 'dataclass:INTERNAL';
comment on column workflow.timer.ref is 'dataclass:INTERNAL';
comment on column workflow.timer.fire_at is 'dataclass:INTERNAL';
comment on column workflow.timer.state is 'dataclass:INTERNAL';
comment on column workflow.timer.attempts is 'dataclass:INTERNAL';
comment on column workflow.timer.last_error is 'dataclass:INTERNAL';
comment on column workflow.timer.created_at is 'dataclass:INTERNAL';
comment on column workflow.timer.updated_at is 'dataclass:INTERNAL';
create index timer_due_idx on workflow.timer (fire_at) where state = 'scheduled';
alter table workflow.timer enable row level security;
alter table workflow.timer force row level security;
create policy timer_read on workflow.timer for select
  using (tenant_id = current_setting('app.tenant_id', true) or current_setting('app.scope', true) = 'platform');
create policy timer_insert on workflow.timer for insert
  with check (tenant_id = current_setting('app.tenant_id', true));
create policy timer_update on workflow.timer for update
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
grant select, insert, update on workflow.timer to app_rw;
grant select on workflow.timer to app_ro;

-- Transactional outbox and consumer inbox (IPB-01 §01.4.3.3).
create table workflow.outbox (
  id             text        primary key,
  tenant_id      text        not null,
  type           text        not null,
  envelope       jsonb       not null,
  created_at     timestamptz not null default now(),
  dispatched_at  timestamptz,
  attempts       integer     not null default 0
);
comment on column workflow.outbox.id is 'dataclass:INTERNAL';
comment on column workflow.outbox.tenant_id is 'dataclass:INTERNAL';
comment on column workflow.outbox.type is 'dataclass:INTERNAL';
comment on column workflow.outbox.envelope is 'dataclass:CONFIDENTIAL';
comment on column workflow.outbox.created_at is 'dataclass:INTERNAL';
comment on column workflow.outbox.dispatched_at is 'dataclass:INTERNAL';
comment on column workflow.outbox.attempts is 'dataclass:INTERNAL';
create index outbox_pending_idx on workflow.outbox (created_at) where dispatched_at is null;
alter table workflow.outbox enable row level security;
alter table workflow.outbox force row level security;
create policy outbox_tenant on workflow.outbox for all
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
grant select, insert, update on workflow.outbox to app_rw;
grant select on workflow.outbox to app_ro;

create table workflow.inbox (
  consumer      text        not null,
  event_id      text        not null,
  tenant_id     text        not null,
  processed_at  timestamptz not null default now(),
  primary key (consumer, event_id)
);
comment on column workflow.inbox.consumer is 'dataclass:INTERNAL';
comment on column workflow.inbox.event_id is 'dataclass:INTERNAL';
comment on column workflow.inbox.tenant_id is 'dataclass:INTERNAL';
comment on column workflow.inbox.processed_at is 'dataclass:INTERNAL';
alter table workflow.inbox enable row level security;
alter table workflow.inbox force row level security;
create policy inbox_tenant on workflow.inbox for all
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
grant select, insert on workflow.inbox to app_rw;
grant select on workflow.inbox to app_ro;
