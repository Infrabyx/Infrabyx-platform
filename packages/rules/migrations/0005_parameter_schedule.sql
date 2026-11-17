-- @infrabyx/rules 0005: parameter schedules (LawDocsComply PR-LDC-57, R1-D-146, R1-D-175). A
-- schedule is a platform-owned, versioned list of dated, cited values that a rule set's dated
-- parameter takes at the decision's instant. It lives in tnt_platform only: written in a platform
-- context through the kernel with a ledger entry, published through the R4 action
-- `rules.ruleset.publish`, and readable by every tenant. Expand-only: two new tables.
-- The entries are folded into the version's body (one immutable list per version), a departure
-- from the design's separate entry table recorded in R1-D-175.
set lock_timeout = '5s';
set statement_timeout = '60s';

create table rules.parameter_schedule (
  key         text        primary key check (key ~ '^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$'),
  tenant_id   text        not null default 'tnt_platform' check (tenant_id = 'tnt_platform'),
  created_by  text        not null,
  created_at  timestamptz not null default now(),
  constraint parameter_schedule_tenant_unique unique (key, tenant_id)
);
comment on column rules.parameter_schedule.key is 'dataclass:INTERNAL';
comment on column rules.parameter_schedule.tenant_id is 'dataclass:INTERNAL';
comment on column rules.parameter_schedule.created_by is 'dataclass:INTERNAL';
comment on column rules.parameter_schedule.created_at is 'dataclass:INTERNAL';
alter table rules.parameter_schedule enable row level security;
alter table rules.parameter_schedule force row level security;
-- Every tenant reads the platform's schedules, as it reads platform rule sets.
create policy parameter_schedule_read on rules.parameter_schedule for select
  using (tenant_id = current_setting('app.tenant_id', true) or tenant_id = 'tnt_platform');
create policy parameter_schedule_insert on rules.parameter_schedule for insert
  with check (
    tenant_id = current_setting('app.tenant_id', true)
    and tenant_id = 'tnt_platform'
    and current_setting('app.scope', true) = 'platform'
  );
grant select, insert on rules.parameter_schedule to app_rw;
grant select on rules.parameter_schedule to app_ro;

-- A version's body is `ipb.parameter_schedule.v1` (statutory values and their citations, public
-- text). Once it leaves `draft` its body and digest never change; states move only forward (or
-- back to draft when its approval request was rejected, cancelled or expired).
create table rules.parameter_schedule_version (
  key             text        not null,
  version         integer     not null check (version > 0),
  tenant_id       text        not null default 'tnt_platform' check (tenant_id = 'tnt_platform'),
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
  primary key (key, version),
  constraint parameter_schedule_version_schedule foreign key (key, tenant_id)
    references rules.parameter_schedule (key, tenant_id),
  constraint parameter_schedule_version_published check (
    state not in ('published', 'retired') or (effective_from is not null and published_at is not null)
  )
);
comment on column rules.parameter_schedule_version.key is 'dataclass:INTERNAL';
comment on column rules.parameter_schedule_version.version is 'dataclass:INTERNAL';
comment on column rules.parameter_schedule_version.tenant_id is 'dataclass:INTERNAL';
comment on column rules.parameter_schedule_version.state is 'dataclass:INTERNAL';
comment on column rules.parameter_schedule_version.body is 'dataclass:PUBLIC';
comment on column rules.parameter_schedule_version.digest is 'dataclass:INTERNAL';
comment on column rules.parameter_schedule_version.approval_id is 'dataclass:INTERNAL';
comment on column rules.parameter_schedule_version.effective_from is 'dataclass:INTERNAL';
comment on column rules.parameter_schedule_version.effective_to is 'dataclass:INTERNAL';
comment on column rules.parameter_schedule_version.published_at is 'dataclass:INTERNAL';
comment on column rules.parameter_schedule_version.created_by is 'dataclass:INTERNAL';
comment on column rules.parameter_schedule_version.created_at is 'dataclass:INTERNAL';
comment on column rules.parameter_schedule_version.updated_at is 'dataclass:INTERNAL';
-- At most one open (draft or pending) and one published version per schedule.
create unique index parameter_schedule_version_one_open on rules.parameter_schedule_version (key)
  where state in ('draft', 'pending_approval');
create unique index parameter_schedule_version_one_published on rules.parameter_schedule_version (key)
  where state = 'published';

create function rules.schedule_version_guard() returns trigger
  language plpgsql
  set search_path = pg_catalog, pg_temp
as $$
begin
  if new.key <> old.key or new.version <> old.version or new.tenant_id <> old.tenant_id then
    raise exception 'parameter schedule version identity is immutable' using errcode = 'P0001';
  end if;
  if old.state <> 'draft' and (new.body is distinct from old.body or new.digest <> old.digest) then
    raise exception 'parameter schedule version body is immutable once it leaves draft' using errcode = 'P0001';
  end if;
  if old.state in ('published', 'retired') and (
    new.effective_from is distinct from old.effective_from
    or new.published_at is distinct from old.published_at
  ) then
    raise exception 'a published parameter schedule version keeps its cut-over' using errcode = 'P0001';
  end if;
  if old.state = 'retired' and new.effective_to is distinct from old.effective_to then
    raise exception 'a retired parameter schedule version keeps its end' using errcode = 'P0001';
  end if;
  if new.state <> old.state and not (
    (old.state = 'draft' and new.state = 'pending_approval')
    or (old.state = 'pending_approval' and new.state in ('published', 'draft'))
    or (old.state = 'published' and new.state = 'retired')
  ) then
    raise exception 'parameter schedule version cannot move from % to %', old.state, new.state using errcode = 'P0001';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
alter function rules.schedule_version_guard() owner to app_migrate;
revoke all on function rules.schedule_version_guard() from public;
create trigger parameter_schedule_version_guard before update on rules.parameter_schedule_version
  for each row execute function rules.schedule_version_guard();

alter table rules.parameter_schedule_version enable row level security;
alter table rules.parameter_schedule_version force row level security;
create policy parameter_schedule_version_read on rules.parameter_schedule_version for select
  using (tenant_id = current_setting('app.tenant_id', true) or tenant_id = 'tnt_platform');
create policy parameter_schedule_version_insert on rules.parameter_schedule_version for insert
  with check (
    tenant_id = current_setting('app.tenant_id', true)
    and tenant_id = 'tnt_platform'
    and current_setting('app.scope', true) = 'platform'
  );
create policy parameter_schedule_version_update on rules.parameter_schedule_version for update
  using (
    tenant_id = current_setting('app.tenant_id', true)
    and tenant_id = 'tnt_platform'
    and current_setting('app.scope', true) = 'platform'
  )
  with check (
    tenant_id = current_setting('app.tenant_id', true)
    and tenant_id = 'tnt_platform'
    and current_setting('app.scope', true) = 'platform'
  );
grant select, insert, update on rules.parameter_schedule_version to app_rw;
grant select on rules.parameter_schedule_version to app_ro;
