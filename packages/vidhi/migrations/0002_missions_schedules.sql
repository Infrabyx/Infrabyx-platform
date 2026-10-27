-- @infrabyx/vidhi 0002: missions and scheduled tasks (IPB-03-63 to 03-67, §03.4.7, §03.4.9; PL4
-- plan §8.5, §8.6; session 7). Expand-only. No goal, prompt or output text is stored: a mission
-- keeps its plan as skill keys and task ids, and a schedule keeps its recurrence, trigger and the
-- owner's roles at creation (the re-check before every run compares them with the roles held now).
set lock_timeout = '5s';
set statement_timeout = '60s';

-- Missions (IPB-03-63): a multi-step goal under a budget, each step a task.
create table vidhi.mission (
  id             text        primary key check (id ~ '^msn_[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  tenant_id      text        not null,
  owner_id       text        not null,
  agent_id       text        not null,
  state          text        not null default 'RUNNING' check (state in ('RUNNING', 'WAITING', 'DONE', 'STOPPED', 'FAILED', 'CANCELLED')),
  level          text        not null check (level in ('L0', 'L1', 'L2', 'L3', 'L4')),
  scope          text[]      not null,
  steps          jsonb       not null,
  step_index     integer     not null default 0,
  budget         jsonb       not null,
  used           jsonb       not null default '{"tokens": 0, "cost_minor": 0, "tool_calls": 0}',
  stop_code      text,
  lease_until    timestamptz,
  deadline_at    timestamptz not null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  finished_at    timestamptz
);
comment on column vidhi.mission.id is 'dataclass:INTERNAL';
comment on column vidhi.mission.tenant_id is 'dataclass:INTERNAL';
comment on column vidhi.mission.owner_id is 'dataclass:INTERNAL';
comment on column vidhi.mission.agent_id is 'dataclass:INTERNAL';
comment on column vidhi.mission.state is 'dataclass:INTERNAL';
comment on column vidhi.mission.level is 'dataclass:INTERNAL';
comment on column vidhi.mission.scope is 'dataclass:INTERNAL';
comment on column vidhi.mission.steps is 'dataclass:INTERNAL';
comment on column vidhi.mission.step_index is 'dataclass:INTERNAL';
comment on column vidhi.mission.budget is 'dataclass:INTERNAL';
comment on column vidhi.mission.used is 'dataclass:INTERNAL';
comment on column vidhi.mission.stop_code is 'dataclass:INTERNAL';
comment on column vidhi.mission.lease_until is 'dataclass:INTERNAL';
comment on column vidhi.mission.deadline_at is 'dataclass:INTERNAL';
comment on column vidhi.mission.created_at is 'dataclass:INTERNAL';
comment on column vidhi.mission.updated_at is 'dataclass:INTERNAL';
comment on column vidhi.mission.finished_at is 'dataclass:INTERNAL';
create index mission_open_idx on vidhi.mission (tenant_id, state) where state in ('RUNNING', 'WAITING');
alter table vidhi.mission enable row level security;
alter table vidhi.mission force row level security;
create policy mission_tenant on vidhi.mission for all
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
grant select, insert on vidhi.mission to app_rw;
grant update (state, steps, step_index, used, stop_code, lease_until, updated_at, finished_at) on vidhi.mission to app_rw;
grant select on vidhi.mission to app_ro;

create function vidhi.mission_terminal_immutable() returns trigger language plpgsql as $$
begin
  if old.state in ('DONE', 'STOPPED', 'FAILED', 'CANCELLED') then
    raise exception 'mission % is % and cannot change', old.id, old.state using errcode = '42501';
  end if;
  return new;
end
$$;
create trigger mission_terminal_immutable before update on vidhi.mission
  for each row execute function vidhi.mission_terminal_immutable();

-- Scheduled tasks (IPB-03-64): a recurrence (RFC 5545 subset) or an event trigger with an optional
-- CEL condition. The owner is the person the runs act for.
create table vidhi.schedule (
  id                 text        primary key check (id ~ '^sch_[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  tenant_id          text        not null,
  skill_key          text        not null,
  owner_id           text        not null,
  owner_roles        text[]      not null,
  kind               text        not null check (kind in ('recurrence', 'event')),
  recurrence         text        check (length(recurrence) <= 2000),
  event_type         text        check (length(event_type) <= 200),
  condition          text        check (length(condition) <= 2000),
  template_key       text,
  state              text        not null default 'ACTIVE' check (state in ('ACTIVE', 'PAUSED', 'ENDED')),
  next_run_at        timestamptz,
  last_run_at        timestamptz,
  consecutive_skips  integer     not null default 0,
  paused_code        text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check ((kind = 'recurrence') = (recurrence is not null)),
  check ((kind = 'event') = (event_type is not null))
);
comment on column vidhi.schedule.id is 'dataclass:INTERNAL';
comment on column vidhi.schedule.tenant_id is 'dataclass:INTERNAL';
comment on column vidhi.schedule.skill_key is 'dataclass:INTERNAL';
comment on column vidhi.schedule.owner_id is 'dataclass:INTERNAL';
comment on column vidhi.schedule.owner_roles is 'dataclass:INTERNAL';
comment on column vidhi.schedule.kind is 'dataclass:INTERNAL';
comment on column vidhi.schedule.recurrence is 'dataclass:INTERNAL';
comment on column vidhi.schedule.event_type is 'dataclass:INTERNAL';
comment on column vidhi.schedule.condition is 'dataclass:INTERNAL';
comment on column vidhi.schedule.template_key is 'dataclass:INTERNAL';
comment on column vidhi.schedule.state is 'dataclass:INTERNAL';
comment on column vidhi.schedule.next_run_at is 'dataclass:INTERNAL';
comment on column vidhi.schedule.last_run_at is 'dataclass:INTERNAL';
comment on column vidhi.schedule.consecutive_skips is 'dataclass:INTERNAL';
comment on column vidhi.schedule.paused_code is 'dataclass:INTERNAL';
comment on column vidhi.schedule.created_at is 'dataclass:INTERNAL';
comment on column vidhi.schedule.updated_at is 'dataclass:INTERNAL';
create index schedule_due_idx on vidhi.schedule (next_run_at) where state = 'ACTIVE' and kind = 'recurrence';
create index schedule_event_idx on vidhi.schedule (tenant_id, event_type) where state = 'ACTIVE' and kind = 'event';
alter table vidhi.schedule enable row level security;
alter table vidhi.schedule force row level security;
create policy schedule_tenant on vidhi.schedule for all
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
grant select, insert on vidhi.schedule to app_rw;
grant update (state, next_run_at, last_run_at, consecutive_skips, paused_code, updated_at) on vidhi.schedule to app_rw;
grant select on vidhi.schedule to app_ro;

-- One row per due occurrence or trigger event, started or skipped: exactly once per occurrence.
create table vidhi.schedule_run (
  id              bigint      generated always as identity primary key,
  tenant_id       text        not null,
  schedule_id     text        not null references vidhi.schedule (id),
  occurrence_key  text        not null check (length(occurrence_key) <= 200),
  outcome         text        not null check (outcome in ('started', 'skipped')),
  code            text,
  reason          text,
  task_id         text,
  created_at      timestamptz not null default now(),
  unique (schedule_id, occurrence_key)
);
comment on column vidhi.schedule_run.id is 'dataclass:INTERNAL';
comment on column vidhi.schedule_run.tenant_id is 'dataclass:INTERNAL';
comment on column vidhi.schedule_run.schedule_id is 'dataclass:INTERNAL';
comment on column vidhi.schedule_run.occurrence_key is 'dataclass:INTERNAL';
comment on column vidhi.schedule_run.outcome is 'dataclass:INTERNAL';
comment on column vidhi.schedule_run.code is 'dataclass:INTERNAL';
comment on column vidhi.schedule_run.reason is 'dataclass:INTERNAL';
comment on column vidhi.schedule_run.task_id is 'dataclass:INTERNAL';
comment on column vidhi.schedule_run.created_at is 'dataclass:INTERNAL';
create index schedule_run_schedule_idx on vidhi.schedule_run (tenant_id, schedule_id, created_at);
alter table vidhi.schedule_run enable row level security;
alter table vidhi.schedule_run force row level security;
create policy schedule_run_tenant on vidhi.schedule_run for all
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
grant select, insert on vidhi.schedule_run to app_rw;
grant update (task_id) on vidhi.schedule_run to app_rw;
grant select on vidhi.schedule_run to app_ro;

-- The due-run poller's cross-tenant reader (OWNER-QUESTIONS #22, PL3-D-21): it may see only which
-- active recurring schedule is due in which tenant; everything else is read in the tenant's context.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'svc_vidhi_sched') then
    create role svc_vidhi_sched nologin nosuperuser nobypassrls nocreatedb nocreaterole;
  end if;
end
$$;
grant usage on schema vidhi to svc_vidhi_sched;
grant select (id, tenant_id, state, kind, next_run_at) on vidhi.schedule to svc_vidhi_sched;
create policy schedule_poller on vidhi.schedule for select to svc_vidhi_sched
  using (current_setting('app.scope', true) = 'platform');
grant svc_vidhi_sched to app_rw, app_ro;
