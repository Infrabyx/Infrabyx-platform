-- @infrabyx/tenancy 0010: the external read role (Finbyx PR-FBX-10 item 5; IPB-02-12; IPB-08-19;
-- R1-D-29). Expand-only. A named external grantee (statutory auditor, IS auditor, RBI inspector,
-- SEBI, IRDAI, internal auditor) reads one tenant's data under one grant:
--   * `app_external` is SELECT-only and switch-only (granted to app_rw and app_ro with INHERIT FALSE,
--     SET TRUE): the kernel switches to it for an `external` principal's reads, and to nothing else;
--   * `tenancy.external_grant` is the grant: the entities, the branches (none listed: every branch
--     of those entities) and the period the grantee may read, time-boxed (at most 90 days) and active
--     only once a second ORG_OWNER or ORG_ADMIN approves it;
--   * a product grants `app_external` SELECT on the columns it will show and adds a RESTRICTIVE
--     select policy for `app_external` calling `tenancy.external_allows(...)`, so the per-grant scope
--     holds whatever permissive policies the table has (rls-lint `external-read` checks both);
--   * every read is ledgered by `ExternalReads` in `@infrabyx/tenancy`, and the kernel refuses an
--     external read made any other way.
set lock_timeout = '5s';
set statement_timeout = '60s';

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_external') then
    create role app_external nologin noinherit nosuperuser nobypassrls nocreatedb nocreaterole;
  end if;
end
$$;
grant app_external to app_rw, app_ro with inherit false, set true;
grant usage on schema tenancy to app_external;

create table tenancy.external_grant (
  id             text        primary key check (id ~ '^xgr_[0-9A-HJKMNP-TV-Z]{26}$'),
  tenant_id      text        not null references tenancy.tenant (id),
  grantee_id     text        not null check (grantee_id ~ '^[A-Za-z0-9_.:@/+=-]{1,255}$'),
  grantee_name   text        not null check (length(grantee_name) between 1 and 200),
  organisation   text        not null check (length(organisation) between 1 and 200),
  kind           text        not null check (kind in ('statutory_auditor', 'internal_auditor',
                   'is_auditor', 'rbi_inspector', 'sebi', 'irdai')),
  purpose        text        not null check (length(purpose) between 10 and 500),
  entity_ids     text[]      not null check (cardinality(entity_ids) between 1 and 100),
  branch_ids     text[]      check (branch_ids is null or cardinality(branch_ids) between 1 and 1000),
  period_from    date        not null,
  period_to      date        not null,
  duration_days  integer     not null check (duration_days between 1 and 90),
  state          text        not null default 'requested' check (state in ('requested', 'active', 'revoked')),
  requested_by   text        not null,
  requested_at   timestamptz not null default now(),
  approved_by    text,
  approved_at    timestamptz,
  expires_at     timestamptz,
  revoked_by     text,
  revoked_at     timestamptz,
  check (period_from <= period_to),
  check (approved_by is null or approved_by <> requested_by),
  check (state <> 'active' or (approved_by is not null and approved_at is not null and expires_at is not null)),
  check (expires_at is null or expires_at <= approved_at + interval '90 days'),
  check ((state = 'revoked') = (revoked_at is not null and revoked_by is not null))
);
comment on column tenancy.external_grant.id is 'dataclass:INTERNAL';
comment on column tenancy.external_grant.tenant_id is 'dataclass:INTERNAL';
comment on column tenancy.external_grant.grantee_id is 'dataclass:INTERNAL';
comment on column tenancy.external_grant.grantee_name is 'dataclass:CONFIDENTIAL';
comment on column tenancy.external_grant.organisation is 'dataclass:INTERNAL';
comment on column tenancy.external_grant.kind is 'dataclass:INTERNAL';
comment on column tenancy.external_grant.purpose is 'dataclass:CONFIDENTIAL';
comment on column tenancy.external_grant.entity_ids is 'dataclass:INTERNAL';
comment on column tenancy.external_grant.branch_ids is 'dataclass:INTERNAL';
comment on column tenancy.external_grant.period_from is 'dataclass:INTERNAL';
comment on column tenancy.external_grant.period_to is 'dataclass:INTERNAL';
comment on column tenancy.external_grant.duration_days is 'dataclass:INTERNAL';
comment on column tenancy.external_grant.state is 'dataclass:INTERNAL';
comment on column tenancy.external_grant.requested_by is 'dataclass:INTERNAL';
comment on column tenancy.external_grant.requested_at is 'dataclass:INTERNAL';
comment on column tenancy.external_grant.approved_by is 'dataclass:INTERNAL';
comment on column tenancy.external_grant.approved_at is 'dataclass:INTERNAL';
comment on column tenancy.external_grant.expires_at is 'dataclass:INTERNAL';
comment on column tenancy.external_grant.revoked_by is 'dataclass:INTERNAL';
comment on column tenancy.external_grant.revoked_at is 'dataclass:INTERNAL';
create index external_grant_grantee_idx on tenancy.external_grant (tenant_id, grantee_id);

alter table tenancy.external_grant enable row level security;
alter table tenancy.external_grant force row level security;
create policy external_grant_tenant on tenancy.external_grant for all to app_rw, app_ro
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
-- The grantee sees its own active grant in the transaction's tenant, and no other row.
create policy external_grant_self on tenancy.external_grant for select to app_external
  using (tenant_id = current_setting('app.tenant_id', true)
     and id = current_setting('app.external_grant', true)
     and grantee_id = current_setting('app.actor_id', true)
     and state = 'active' and expires_at > now());
revoke all on tenancy.external_grant from public;
grant select, insert, update on tenancy.external_grant to app_rw;
grant select on tenancy.external_grant to app_ro;
grant select (id, tenant_id, grantee_id, entity_ids, branch_ids, period_from, period_to, state, expires_at)
  on tenancy.external_grant to app_external;

-- Is the transaction's grant active for its principal in its tenant? (The kernel asks it first.)
-- SQL functions without SET clauses, so the planner can inline them into a product's policy.
create function tenancy.external_grant_active() returns boolean
  language sql stable
  as $$
    select exists (
      select 1 from tenancy.external_grant g
       where g.id = pg_catalog.current_setting('app.external_grant', true)
         and g.tenant_id = pg_catalog.current_setting('app.tenant_id', true)
         and g.grantee_id = pg_catalog.current_setting('app.actor_id', true)
         and g.state = 'active' and g.expires_at > pg_catalog.now())
  $$;

-- Does the transaction's grant cover a row of this entity, branch and date? A null argument, or a
-- branch the grant does not list, is refused.
create function tenancy.external_allows(p_entity_id text, p_branch_id text, p_on date) returns boolean
  language sql stable
  as $$
    select coalesce((
      select p_entity_id = any (g.entity_ids)
         and (g.branch_ids is null or p_branch_id = any (g.branch_ids))
         and p_on between g.period_from and g.period_to
        from tenancy.external_grant g
       where g.id = pg_catalog.current_setting('app.external_grant', true)
         and g.tenant_id = pg_catalog.current_setting('app.tenant_id', true)
         and g.grantee_id = pg_catalog.current_setting('app.actor_id', true)
         and g.state = 'active' and g.expires_at > pg_catalog.now()), false)
  $$;

-- For a table without branches: covered only by a grant that lists no branches.
create function tenancy.external_allows(p_entity_id text, p_on date) returns boolean
  language sql stable
  as $$
    select coalesce((
      select p_entity_id = any (g.entity_ids)
         and g.branch_ids is null
         and p_on between g.period_from and g.period_to
        from tenancy.external_grant g
       where g.id = pg_catalog.current_setting('app.external_grant', true)
         and g.tenant_id = pg_catalog.current_setting('app.tenant_id', true)
         and g.grantee_id = pg_catalog.current_setting('app.actor_id', true)
         and g.state = 'active' and g.expires_at > pg_catalog.now()), false)
  $$;
revoke all on function tenancy.external_grant_active() from public;
revoke all on function tenancy.external_allows(text, text, date) from public;
revoke all on function tenancy.external_allows(text, date) from public;
grant execute on function tenancy.external_grant_active() to app_rw, app_ro, app_external;
grant execute on function tenancy.external_allows(text, text, date) to app_rw, app_ro, app_external;
grant execute on function tenancy.external_allows(text, date) to app_rw, app_ro, app_external;
