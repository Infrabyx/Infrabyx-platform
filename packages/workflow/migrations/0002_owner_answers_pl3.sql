-- @infrabyx/workflow 0002: owner answers #21 and #22 (PL3-D-21). Expand-only.
--
-- (1) Inbox escalation (#21): an item raised with `escalateAfterHours` (UNDETERMINED rule
-- decisions, 48 h) is escalated to ORG_ADMIN by an `inbox.escalate` timer, as approval requests
-- are. `escalated_at` makes the escalation happen once; the timer CHECKs widen to the new kind and
-- the `ibx_` reference (a wider CHECK accepts every existing row).
--
-- (2) The SVC_SCHEDULER service reader (#22). The timer poller reads due timers across tenants
-- as this database role, which may select only the timer columns it needs; RLS still applies
-- (platform scope) and it has no write grant anywhere. It is granted to app_rw and app_ro so that the login users holding those roles
-- can SET LOCAL ROLE to it inside a kernel read; it adds no privilege they lack.
set lock_timeout = '5s';
set statement_timeout = '60s';

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'svc_scheduler') then
    create role svc_scheduler nologin nosuperuser nobypassrls nocreatedb nocreaterole;
  end if;
end
$$;

alter table workflow.inbox_item add column escalated_at timestamptz;
comment on column workflow.inbox_item.escalated_at is 'dataclass:INTERNAL';

alter table workflow.timer drop constraint timer_kind_check;
alter table workflow.timer add constraint timer_kind_check
  check (kind in ('approval.execute', 'approval.remind', 'approval.escalate', 'approval.expire', 'inbox.escalate'));
alter table workflow.timer drop constraint timer_ref_check;
alter table workflow.timer add constraint timer_ref_check
  check (ref ~ '^(apr|sca|ibx)_[0-9A-HJKMNP-TV-Z]{26}$');

grant usage on schema workflow to svc_scheduler;
grant select (tenant_id, kind, ref, fire_at, attempts, state) on workflow.timer to svc_scheduler;
grant svc_scheduler to app_rw, app_ro;
