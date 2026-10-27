-- @infrabyx/vidhi 0001: the Vidhi kernel's skill state, autonomy and tasks (IPB-03 §03.3.J–K,
-- §03.4.7–§03.4.8; PL4 plan §8, §9; session 6). Expand-only. Requires the roles created by
-- @infrabyx/tenancy 0001. No prompt, completion or tool-argument text is stored: tool arguments
-- that need a human travel only in the encrypted approval payload. Every write goes through the
-- kernel with an audit ledger entry. Missions, schedules and notebooks come in later migrations.
set lock_timeout = '5s';
set statement_timeout = '60s';

create schema if not exists vidhi;
revoke all on schema vidhi from public;
grant usage on schema vidhi to app_rw, app_ro;

-- Per tenant and skill: enabled, the kernel's operating level (L2 until a grant raises it; lowered
-- by auto-demotion) and the start of the evidence window (reset by every demotion).
create table vidhi.skill_state (
  tenant_id        text        not null,
  skill_key        text        not null check (skill_key ~ '^[a-z]{2,8}\.[a-z0-9_]+$'),
  enabled          boolean     not null default true,
  operating_level  text        not null default 'L2' check (operating_level in ('L0', 'L1', 'L2', 'L3', 'L4')),
  evidence_since   timestamptz not null default now(),
  demoted_at       timestamptz,
  updated_at       timestamptz not null default now(),
  primary key (tenant_id, skill_key)
);
comment on column vidhi.skill_state.tenant_id is 'dataclass:INTERNAL';
comment on column vidhi.skill_state.skill_key is 'dataclass:INTERNAL';
comment on column vidhi.skill_state.enabled is 'dataclass:INTERNAL';
comment on column vidhi.skill_state.operating_level is 'dataclass:INTERNAL';
comment on column vidhi.skill_state.evidence_since is 'dataclass:INTERNAL';
comment on column vidhi.skill_state.demoted_at is 'dataclass:INTERNAL';
comment on column vidhi.skill_state.updated_at is 'dataclass:INTERNAL';
alter table vidhi.skill_state enable row level security;
alter table vidhi.skill_state force row level security;
create policy skill_state_tenant on vidhi.skill_state for all
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
grant select, insert, update on vidhi.skill_state to app_rw;
grant select on vidhi.skill_state to app_ro;

-- Promotion to L3/L4 (IPB-03-70, §03.4.8): sponsor, budget, scope, kill-switch owner, evidence.
create table vidhi.autonomy_grant (
  id                    text        primary key check (id ~ '^grt_[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  tenant_id             text        not null,
  skill_key             text        not null,
  level                 text        not null check (level in ('L3', 'L4')),
  sponsor_id            text        not null,
  budget                jsonb       not null,
  scope                 jsonb       not null,
  kill_switch_owner_id  text        not null,
  evidence              jsonb       not null,
  approval_id           text        not null,
  state                 text        not null default 'requested' check (state in ('requested', 'active', 'revoked')),
  created_at            timestamptz not null default now(),
  granted_at            timestamptz,
  revoked_at            timestamptz
);
comment on column vidhi.autonomy_grant.id is 'dataclass:INTERNAL';
comment on column vidhi.autonomy_grant.tenant_id is 'dataclass:INTERNAL';
comment on column vidhi.autonomy_grant.skill_key is 'dataclass:INTERNAL';
comment on column vidhi.autonomy_grant.level is 'dataclass:INTERNAL';
comment on column vidhi.autonomy_grant.sponsor_id is 'dataclass:INTERNAL';
comment on column vidhi.autonomy_grant.budget is 'dataclass:INTERNAL';
comment on column vidhi.autonomy_grant.scope is 'dataclass:INTERNAL';
comment on column vidhi.autonomy_grant.kill_switch_owner_id is 'dataclass:INTERNAL';
comment on column vidhi.autonomy_grant.evidence is 'dataclass:INTERNAL';
comment on column vidhi.autonomy_grant.approval_id is 'dataclass:INTERNAL';
comment on column vidhi.autonomy_grant.state is 'dataclass:INTERNAL';
comment on column vidhi.autonomy_grant.created_at is 'dataclass:INTERNAL';
comment on column vidhi.autonomy_grant.granted_at is 'dataclass:INTERNAL';
comment on column vidhi.autonomy_grant.revoked_at is 'dataclass:INTERNAL';
create index autonomy_grant_skill_idx on vidhi.autonomy_grant (tenant_id, skill_key, state);
alter table vidhi.autonomy_grant enable row level security;
alter table vidhi.autonomy_grant force row level security;
create policy autonomy_grant_tenant on vidhi.autonomy_grant for all
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
grant select, insert on vidhi.autonomy_grant to app_rw;
grant update (state, granted_at, revoked_at) on vidhi.autonomy_grant to app_rw;
grant select on vidhi.autonomy_grant to app_ro;

-- Level history (append-only).
create table vidhi.autonomy_event (
  id          bigint      generated always as identity primary key,
  tenant_id   text        not null,
  skill_key   text        not null,
  from_level  text        not null,
  to_level    text        not null,
  reason      text        not null check (reason in ('promotion', 'demotion_locked', 'demotion_guardrail', 'demotion_rate', 'grant_revoked')),
  task_id     text,
  actor_id    text        not null,
  created_at  timestamptz not null default now()
);
comment on column vidhi.autonomy_event.id is 'dataclass:INTERNAL';
comment on column vidhi.autonomy_event.tenant_id is 'dataclass:INTERNAL';
comment on column vidhi.autonomy_event.skill_key is 'dataclass:INTERNAL';
comment on column vidhi.autonomy_event.from_level is 'dataclass:INTERNAL';
comment on column vidhi.autonomy_event.to_level is 'dataclass:INTERNAL';
comment on column vidhi.autonomy_event.reason is 'dataclass:INTERNAL';
comment on column vidhi.autonomy_event.task_id is 'dataclass:INTERNAL';
comment on column vidhi.autonomy_event.actor_id is 'dataclass:INTERNAL';
comment on column vidhi.autonomy_event.created_at is 'dataclass:INTERNAL';
create index autonomy_event_skill_idx on vidhi.autonomy_event (tenant_id, skill_key, created_at);
alter table vidhi.autonomy_event enable row level security;
alter table vidhi.autonomy_event force row level security;
create policy autonomy_event_tenant on vidhi.autonomy_event for all
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
grant select, insert on vidhi.autonomy_event to app_rw;
grant select on vidhi.autonomy_event to app_ro;

-- Tasks (IPB-03-62, §03.4.7). Transitions are compare-and-set on `state`; terminal states never
-- change (a trigger refuses it as well).
create table vidhi.task (
  id              text        primary key check (id ~ '^tsk_[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  tenant_id       text        not null,
  skill_key       text        not null,
  state           text        not null default 'QUEUED' check (state in ('QUEUED', 'RUNNING', 'NEEDS_INPUT', 'NEEDS_APPROVAL', 'DONE', 'FAILED', 'CANCELLED')),
  level           text        not null check (level in ('L0', 'L1', 'L2', 'L3', 'L4')),
  agent_id        text        not null,
  owner_id        text        not null,
  mission_id      text,
  schedule_id     text,
  pending_tool    text,
  approval_id     text,
  error_code      text,
  cancel_reason   text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  finished_at     timestamptz
);
comment on column vidhi.task.id is 'dataclass:INTERNAL';
comment on column vidhi.task.tenant_id is 'dataclass:INTERNAL';
comment on column vidhi.task.skill_key is 'dataclass:INTERNAL';
comment on column vidhi.task.state is 'dataclass:INTERNAL';
comment on column vidhi.task.level is 'dataclass:INTERNAL';
comment on column vidhi.task.agent_id is 'dataclass:INTERNAL';
comment on column vidhi.task.owner_id is 'dataclass:INTERNAL';
comment on column vidhi.task.mission_id is 'dataclass:INTERNAL';
comment on column vidhi.task.schedule_id is 'dataclass:INTERNAL';
comment on column vidhi.task.pending_tool is 'dataclass:INTERNAL';
comment on column vidhi.task.approval_id is 'dataclass:INTERNAL';
comment on column vidhi.task.error_code is 'dataclass:INTERNAL';
comment on column vidhi.task.cancel_reason is 'dataclass:INTERNAL';
comment on column vidhi.task.created_at is 'dataclass:INTERNAL';
comment on column vidhi.task.updated_at is 'dataclass:INTERNAL';
comment on column vidhi.task.finished_at is 'dataclass:INTERNAL';
create index task_open_idx on vidhi.task (tenant_id, state) where state not in ('DONE', 'FAILED', 'CANCELLED');
create index task_skill_idx on vidhi.task (tenant_id, skill_key, created_at);
alter table vidhi.task enable row level security;
alter table vidhi.task force row level security;
create policy task_tenant on vidhi.task for all
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
grant select, insert on vidhi.task to app_rw;
grant update (state, pending_tool, approval_id, error_code, cancel_reason, updated_at, finished_at) on vidhi.task to app_rw;
grant select on vidhi.task to app_ro;

create function vidhi.task_terminal_immutable() returns trigger language plpgsql as $$
begin
  if old.state in ('DONE', 'FAILED', 'CANCELLED') then
    raise exception 'task % is % and cannot change', old.id, old.state using errcode = '42501';
  end if;
  return new;
end
$$;
create trigger task_terminal_immutable before update on vidhi.task
  for each row execute function vidhi.task_terminal_immutable();

-- One row per tool call or approval decision: the child audit rows of a task (IPB-03-62).
create table vidhi.task_step (
  id               bigint      generated always as identity primary key,
  tenant_id        text        not null,
  task_id          text        not null references vidhi.task (id),
  tool             text        not null,
  outcome          text        not null check (outcome in ('executed', 'needs_approval', 'approved', 'rejected', 'refused', 'failed', 'locked_attempt')),
  approval_id      text,
  idempotency_key  text,
  actor_id         text        not null,
  created_at       timestamptz not null default now()
);
comment on column vidhi.task_step.id is 'dataclass:INTERNAL';
comment on column vidhi.task_step.tenant_id is 'dataclass:INTERNAL';
comment on column vidhi.task_step.task_id is 'dataclass:INTERNAL';
comment on column vidhi.task_step.tool is 'dataclass:INTERNAL';
comment on column vidhi.task_step.outcome is 'dataclass:INTERNAL';
comment on column vidhi.task_step.approval_id is 'dataclass:INTERNAL';
comment on column vidhi.task_step.idempotency_key is 'dataclass:INTERNAL';
comment on column vidhi.task_step.actor_id is 'dataclass:INTERNAL';
comment on column vidhi.task_step.created_at is 'dataclass:INTERNAL';
create unique index task_step_idempotent on vidhi.task_step (task_id, idempotency_key)
  where outcome = 'executed' and idempotency_key is not null;
create index task_step_task_idx on vidhi.task_step (tenant_id, task_id);
alter table vidhi.task_step enable row level security;
alter table vidhi.task_step force row level security;
create policy task_step_tenant on vidhi.task_step for all
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
grant select, insert on vidhi.task_step to app_rw;
grant select on vidhi.task_step to app_ro;

-- Transactional outbox and consumer inbox (IPB-01 §01.4.3.3).
create table vidhi.outbox (
  id             text        primary key,
  tenant_id      text        not null,
  type           text        not null,
  envelope       jsonb       not null,
  created_at     timestamptz not null default now(),
  dispatched_at  timestamptz,
  attempts       integer     not null default 0
);
comment on column vidhi.outbox.id is 'dataclass:INTERNAL';
comment on column vidhi.outbox.tenant_id is 'dataclass:INTERNAL';
comment on column vidhi.outbox.type is 'dataclass:INTERNAL';
comment on column vidhi.outbox.envelope is 'dataclass:INTERNAL';
comment on column vidhi.outbox.created_at is 'dataclass:INTERNAL';
comment on column vidhi.outbox.dispatched_at is 'dataclass:INTERNAL';
comment on column vidhi.outbox.attempts is 'dataclass:INTERNAL';
create index outbox_pending_idx on vidhi.outbox (created_at) where dispatched_at is null;
alter table vidhi.outbox enable row level security;
alter table vidhi.outbox force row level security;
create policy outbox_tenant on vidhi.outbox for all
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
grant select, insert, update on vidhi.outbox to app_rw;
grant select on vidhi.outbox to app_ro;

create table vidhi.inbox (
  consumer      text        not null,
  event_id      text        not null,
  tenant_id     text        not null,
  processed_at  timestamptz not null default now(),
  primary key (consumer, event_id)
);
comment on column vidhi.inbox.consumer is 'dataclass:INTERNAL';
comment on column vidhi.inbox.event_id is 'dataclass:INTERNAL';
comment on column vidhi.inbox.tenant_id is 'dataclass:INTERNAL';
comment on column vidhi.inbox.processed_at is 'dataclass:INTERNAL';
alter table vidhi.inbox enable row level security;
alter table vidhi.inbox force row level security;
create policy inbox_tenant on vidhi.inbox for all
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
grant select, insert on vidhi.inbox to app_rw;
grant select on vidhi.inbox to app_ro;
