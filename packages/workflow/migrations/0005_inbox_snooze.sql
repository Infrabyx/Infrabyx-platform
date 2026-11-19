-- @infrabyx/workflow 0005: snooze a Work Inbox item until a time, per person (LawDocsComply PR-LDC-46, R1-D-206).
-- Expand-only: one new table. A row hides one item from one principal until `snoozed_until`; every read
-- compares it with now(), so the item reappears at its time with no timer. Unsnooze sets `cleared_at`
-- (no delete grant). The 30-day bound is held here as well as in `InboxService.snooze`.
set lock_timeout = '5s';
set statement_timeout = '60s';

create table workflow.inbox_snooze (
  tenant_id      text        not null,
  item_id        text        not null references workflow.inbox_item (id),
  principal_id   text        not null check (length(principal_id) between 1 and 200),
  snoozed_until  timestamptz not null,
  cleared_at     timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  primary key (tenant_id, item_id, principal_id),
  constraint inbox_snooze_bounded check (snoozed_until <= updated_at + interval '30 days')
);
comment on column workflow.inbox_snooze.tenant_id is 'dataclass:INTERNAL';
comment on column workflow.inbox_snooze.item_id is 'dataclass:INTERNAL';
comment on column workflow.inbox_snooze.principal_id is 'dataclass:INTERNAL';
comment on column workflow.inbox_snooze.snoozed_until is 'dataclass:INTERNAL';
comment on column workflow.inbox_snooze.cleared_at is 'dataclass:INTERNAL';
comment on column workflow.inbox_snooze.created_at is 'dataclass:INTERNAL';
comment on column workflow.inbox_snooze.updated_at is 'dataclass:INTERNAL';
alter table workflow.inbox_snooze enable row level security;
alter table workflow.inbox_snooze force row level security;
create policy inbox_snooze_tenant on workflow.inbox_snooze for all
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
grant select, insert, update on workflow.inbox_snooze to app_rw;
grant select on workflow.inbox_snooze to app_ro;
