-- @infrabyx/rules 0001: rule sets, immutable published versions, the decision log and simulation
-- runs (PL3 plan §4.3, PL3-D-18). Expand-only. Requires the roles created by @infrabyx/tenancy 0001.
-- Rule sets of the platform tenant (tnt_platform) are readable by every tenant and writable only in
-- a platform context. Every write goes through the kernel with an audit ledger entry.
set lock_timeout = '5s';
set statement_timeout = '60s';

create schema if not exists rules;
revoke all on schema rules from public;
grant usage on schema rules to app_rw, app_ro;

create table rules.rule_set (
  id            text        primary key check (id ~ '^rls_[0-9A-HJKMNP-TV-Z]{26}$'),
  tenant_id     text        not null,
  key           text        not null check (key ~ '^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$'),
  owner_module  text        not null check (owner_module ~ '^[a-z][a-z0-9_]*$'),
  data_class    text        not null check (data_class in ('PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'REGULATED')),
  created_by    text        not null,
  created_at    timestamptz not null default now(),
  constraint rule_set_key_unique unique (tenant_id, key),
  constraint rule_set_tenant_unique unique (id, tenant_id)
);
comment on column rules.rule_set.id is 'dataclass:INTERNAL';
comment on column rules.rule_set.tenant_id is 'dataclass:INTERNAL';
comment on column rules.rule_set.key is 'dataclass:INTERNAL';
comment on column rules.rule_set.owner_module is 'dataclass:INTERNAL';
comment on column rules.rule_set.data_class is 'dataclass:INTERNAL';
comment on column rules.rule_set.created_by is 'dataclass:INTERNAL';
comment on column rules.rule_set.created_at is 'dataclass:INTERNAL';
alter table rules.rule_set enable row level security;
alter table rules.rule_set force row level security;
create policy rule_set_read on rules.rule_set for select
  using (tenant_id = current_setting('app.tenant_id', true) or tenant_id = 'tnt_platform');
create policy rule_set_insert on rules.rule_set for insert
  with check (
    tenant_id = current_setting('app.tenant_id', true)
    and (tenant_id <> 'tnt_platform' or current_setting('app.scope', true) = 'platform')
  );
grant select, insert on rules.rule_set to app_rw;
grant select on rules.rule_set to app_ro;

-- A version's body is the platform decision table (ipb.decision_table.v1). Once a version leaves
-- `draft` its body and digest never change; states move only forward (or back to draft when its
-- approval request was rejected, cancelled or expired).
create table rules.rule_set_version (
  rule_set_id     text        not null,
  version         integer     not null check (version > 0),
  tenant_id       text        not null,
  state           text        not null check (state in ('draft', 'pending_approval', 'published', 'retired')),
  body            jsonb       not null,
  digest          text        not null check (digest ~ '^[0-9a-f]{64}$'),
  approval_id     text,
  effective_from  timestamptz,
  effective_to    timestamptz,
  published_at    timestamptz,
  created_by      text        not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  primary key (rule_set_id, version),
  -- A version always belongs to its rule set's tenant, so no tenant can add a version to a
  -- platform rule set (or another tenant's).
  constraint rule_set_version_set foreign key (rule_set_id, tenant_id)
    references rules.rule_set (id, tenant_id),
  constraint rule_set_version_published check (
    state not in ('published', 'retired') or (effective_from is not null and published_at is not null)
  )
);
comment on column rules.rule_set_version.rule_set_id is 'dataclass:INTERNAL';
comment on column rules.rule_set_version.version is 'dataclass:INTERNAL';
comment on column rules.rule_set_version.tenant_id is 'dataclass:INTERNAL';
comment on column rules.rule_set_version.state is 'dataclass:INTERNAL';
comment on column rules.rule_set_version.body is 'dataclass:INTERNAL';
comment on column rules.rule_set_version.digest is 'dataclass:INTERNAL';
comment on column rules.rule_set_version.approval_id is 'dataclass:INTERNAL';
comment on column rules.rule_set_version.effective_from is 'dataclass:INTERNAL';
comment on column rules.rule_set_version.effective_to is 'dataclass:INTERNAL';
comment on column rules.rule_set_version.published_at is 'dataclass:INTERNAL';
comment on column rules.rule_set_version.created_by is 'dataclass:INTERNAL';
comment on column rules.rule_set_version.created_at is 'dataclass:INTERNAL';
comment on column rules.rule_set_version.updated_at is 'dataclass:INTERNAL';
-- At most one open (draft or pending) and one published version per rule set.
create unique index rule_set_version_one_open on rules.rule_set_version (rule_set_id)
  where state in ('draft', 'pending_approval');
create unique index rule_set_version_one_published on rules.rule_set_version (rule_set_id)
  where state = 'published';

create function rules.version_guard() returns trigger
  language plpgsql
  set search_path = pg_catalog, pg_temp
as $$
begin
  if new.rule_set_id <> old.rule_set_id or new.version <> old.version or new.tenant_id <> old.tenant_id then
    raise exception 'rule set version identity is immutable' using errcode = 'P0001';
  end if;
  if old.state <> 'draft' and (new.body is distinct from old.body or new.digest <> old.digest) then
    raise exception 'rule set version body is immutable once it leaves draft' using errcode = 'P0001';
  end if;
  if new.state <> old.state and not (
    (old.state = 'draft' and new.state = 'pending_approval')
    or (old.state = 'pending_approval' and new.state in ('published', 'draft'))
    or (old.state = 'published' and new.state = 'retired')
  ) then
    raise exception 'rule set version cannot move from % to %', old.state, new.state using errcode = 'P0001';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
alter function rules.version_guard() owner to app_migrate;
revoke all on function rules.version_guard() from public;
create trigger rule_set_version_guard before update on rules.rule_set_version
  for each row execute function rules.version_guard();

alter table rules.rule_set_version enable row level security;
alter table rules.rule_set_version force row level security;
create policy rule_set_version_read on rules.rule_set_version for select
  using (tenant_id = current_setting('app.tenant_id', true) or tenant_id = 'tnt_platform');
create policy rule_set_version_insert on rules.rule_set_version for insert
  with check (
    tenant_id = current_setting('app.tenant_id', true)
    and (tenant_id <> 'tnt_platform' or current_setting('app.scope', true) = 'platform')
  );
create policy rule_set_version_update on rules.rule_set_version for update
  using (
    tenant_id = current_setting('app.tenant_id', true)
    and (tenant_id <> 'tnt_platform' or current_setting('app.scope', true) = 'platform')
  )
  with check (
    tenant_id = current_setting('app.tenant_id', true)
    and (tenant_id <> 'tnt_platform' or current_setting('app.scope', true) = 'platform')
  );
grant select, insert, update on rules.rule_set_version to app_rw;
grant select on rules.rule_set_version to app_ro;

-- Every decision, append-only. Input values at PUBLIC or INTERNAL are kept in `inputs` for
-- explain; inputs above INTERNAL are sealed together with FieldCrypto in `inputs_enc`.
-- Retention: the audit class default (PL3-D-10).
create table rules.decision_log (
  id              text        primary key check (id ~ '^dcs_[0-9A-HJKMNP-TV-Z]{26}$'),
  tenant_id       text        not null,
  rule_set_id     text        not null,
  version         integer,
  engine          text        not null check (engine ~ '^[a-z][a-z0-9-]*$'),
  outcome         text        not null check (outcome in ('MATCHED', 'NO_MATCH', 'UNDETERMINED')),
  reason          text        not null check (reason ~ '^[a-z][a-z_]*$'),
  rule_ids        text[]      not null default '{}',
  inputs_digest   text        not null check (inputs_digest ~ '^[0-9a-f]{64}$'),
  inputs          jsonb,
  inputs_enc      bytea,
  inputs_key_id   text,
  inbox_item_id   text,
  actor_id        text        not null,
  actor_type      text        not null,
  created_at      timestamptz not null default now(),
  constraint decision_log_sealed check ((inputs_enc is null) = (inputs_key_id is null))
);
comment on column rules.decision_log.id is 'dataclass:INTERNAL';
comment on column rules.decision_log.tenant_id is 'dataclass:INTERNAL';
comment on column rules.decision_log.rule_set_id is 'dataclass:INTERNAL';
comment on column rules.decision_log.version is 'dataclass:INTERNAL';
comment on column rules.decision_log.engine is 'dataclass:INTERNAL';
comment on column rules.decision_log.outcome is 'dataclass:INTERNAL';
comment on column rules.decision_log.reason is 'dataclass:INTERNAL';
comment on column rules.decision_log.rule_ids is 'dataclass:INTERNAL';
comment on column rules.decision_log.inputs_digest is 'dataclass:INTERNAL';
comment on column rules.decision_log.inputs is 'dataclass:INTERNAL';
comment on column rules.decision_log.inputs_enc is 'dataclass:REGULATED';
comment on column rules.decision_log.inputs_key_id is 'dataclass:INTERNAL';
comment on column rules.decision_log.inbox_item_id is 'dataclass:INTERNAL';
comment on column rules.decision_log.actor_id is 'dataclass:INTERNAL';
comment on column rules.decision_log.actor_type is 'dataclass:INTERNAL';
comment on column rules.decision_log.created_at is 'dataclass:INTERNAL';
create index decision_log_rule_set_idx on rules.decision_log (tenant_id, rule_set_id, created_at);
alter table rules.decision_log enable row level security;
alter table rules.decision_log force row level security;
create policy decision_log_read on rules.decision_log for select
  using (tenant_id = current_setting('app.tenant_id', true));
create policy decision_log_insert on rules.decision_log for insert
  with check (tenant_id = current_setting('app.tenant_id', true));
grant select, insert on rules.decision_log to app_rw;
grant select on rules.decision_log to app_ro;

-- Simulation runs: counts and changed indexes only; the inputs are never stored.
create table rules.simulation_run (
  id            text        primary key check (id ~ '^run_[0-9A-HJKMNP-TV-Z]{26}$'),
  tenant_id     text        not null,
  rule_set_id   text        not null,
  version       integer     not null,
  baseline      integer,
  input_count   integer     not null check (input_count >= 0),
  diff_summary  jsonb       not null,
  created_by    text        not null,
  created_at    timestamptz not null default now()
);
comment on column rules.simulation_run.id is 'dataclass:INTERNAL';
comment on column rules.simulation_run.tenant_id is 'dataclass:INTERNAL';
comment on column rules.simulation_run.rule_set_id is 'dataclass:INTERNAL';
comment on column rules.simulation_run.version is 'dataclass:INTERNAL';
comment on column rules.simulation_run.baseline is 'dataclass:INTERNAL';
comment on column rules.simulation_run.input_count is 'dataclass:INTERNAL';
comment on column rules.simulation_run.diff_summary is 'dataclass:INTERNAL';
comment on column rules.simulation_run.created_by is 'dataclass:INTERNAL';
comment on column rules.simulation_run.created_at is 'dataclass:INTERNAL';
alter table rules.simulation_run enable row level security;
alter table rules.simulation_run force row level security;
create policy simulation_run_tenant on rules.simulation_run for all
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
grant select, insert on rules.simulation_run to app_rw;
grant select on rules.simulation_run to app_ro;

-- Transactional outbox and consumer inbox (IPB-01 §01.4.3.3).
create table rules.outbox (
  id             text        primary key,
  tenant_id      text        not null,
  type           text        not null,
  envelope       jsonb       not null,
  created_at     timestamptz not null default now(),
  dispatched_at  timestamptz,
  attempts       integer     not null default 0
);
comment on column rules.outbox.id is 'dataclass:INTERNAL';
comment on column rules.outbox.tenant_id is 'dataclass:INTERNAL';
comment on column rules.outbox.type is 'dataclass:INTERNAL';
comment on column rules.outbox.envelope is 'dataclass:CONFIDENTIAL';
comment on column rules.outbox.created_at is 'dataclass:INTERNAL';
comment on column rules.outbox.dispatched_at is 'dataclass:INTERNAL';
comment on column rules.outbox.attempts is 'dataclass:INTERNAL';
create index outbox_pending_idx on rules.outbox (created_at) where dispatched_at is null;
alter table rules.outbox enable row level security;
alter table rules.outbox force row level security;
create policy outbox_tenant on rules.outbox for all
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
grant select, insert, update on rules.outbox to app_rw;
grant select on rules.outbox to app_ro;

create table rules.inbox (
  consumer      text        not null,
  event_id      text        not null,
  tenant_id     text        not null,
  processed_at  timestamptz not null default now(),
  primary key (consumer, event_id)
);
comment on column rules.inbox.consumer is 'dataclass:INTERNAL';
comment on column rules.inbox.event_id is 'dataclass:INTERNAL';
comment on column rules.inbox.tenant_id is 'dataclass:INTERNAL';
comment on column rules.inbox.processed_at is 'dataclass:INTERNAL';
alter table rules.inbox enable row level security;
alter table rules.inbox force row level security;
create policy inbox_tenant on rules.inbox for all
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
grant select, insert on rules.inbox to app_rw;
grant select on rules.inbox to app_ro;
