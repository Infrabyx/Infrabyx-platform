-- @infrabyx/tenancy 0016: more external grantee kinds and a scoped break-glass (LawDocsComply
-- PR-LDC-07, PR-LDC-08 (c); R1-plan M43; R1-D-75). Expand-only.
--   * `tenancy.external_grant.kind` also takes NHB, NABARD, IFSCA, RoC, RCS and CRCS inspectors, and
--     secretarial, tax, concurrent and co-operative auditors; the 90-day ceiling, the second approver
--     and read-only access are unchanged. The check is widened (every existing value still passes);
--   * a break-glass grant may carry a scope that only narrows it: one tenant, optionally a list of
--     modules (schemas), and read or read-write. No scope (every existing grant) keeps IPB-02-06's
--     behaviour. `tenancy.breakglass_scope` gives the kernel an active grant's scope;
--     `tenancy.breakglass_active` and `tenancy.breakglass_touch` now also refuse a tenant outside
--     it, so a scoped grant is neither honoured nor recorded as used there;
--   * `tenancy.breakglass_use` shows the tenant the scope of each grant used on its data.
set lock_timeout = '5s';
set statement_timeout = '60s';

alter table tenancy.external_grant drop constraint external_grant_kind_check;
alter table tenancy.external_grant add constraint external_grant_kind_check
  check (kind in ('statutory_auditor', 'internal_auditor', 'is_auditor', 'rbi_inspector', 'sebi', 'irdai',
                  'nhb', 'nabard', 'ifsca', 'roc_inspector', 'rcs_inspector', 'crcs_inspector',
                  'secretarial_auditor', 'tax_auditor', 'concurrent_auditor', 'cooperative_auditor')) not valid;
alter table tenancy.external_grant validate constraint external_grant_kind_check;

alter table tenancy.breakglass_grant
  add column scope_tenant_id text check (scope_tenant_id is null or scope_tenant_id ~ '^tnt_[A-Za-z0-9_]{1,64}$'),
  add column scope_modules text[] check (scope_modules is null or (cardinality(scope_modules) between 1 and 50
    and array_to_string(scope_modules, ',') ~ '^[a-z][a-z0-9_]{0,62}(,[a-z][a-z0-9_]{0,62})*$')),
  add column scope_access text check (scope_access is null or scope_access in ('read', 'read_write'));
alter table tenancy.breakglass_grant
  add constraint breakglass_grant_scope check ((scope_tenant_id is null) = (scope_access is null)
    and (scope_modules is null or scope_tenant_id is not null));
comment on column tenancy.breakglass_grant.scope_tenant_id is 'dataclass:INTERNAL';
comment on column tenancy.breakglass_grant.scope_modules is 'dataclass:INTERNAL';
comment on column tenancy.breakglass_grant.scope_access is 'dataclass:INTERNAL';

alter table tenancy.breakglass_use
  add column scope_modules text[],
  add column scope_access text check (scope_access is null or scope_access in ('read', 'read_write'));
comment on column tenancy.breakglass_use.scope_modules is 'dataclass:INTERNAL';
comment on column tenancy.breakglass_use.scope_access is 'dataclass:INTERNAL';

-- The scope of an active grant for its principal: no row when the grant is not active; null columns
-- when it has no scope.
create function tenancy.breakglass_scope(p_grant_id text, p_principal_id text)
  returns table (scope_tenant_id text, scope_modules text[], scope_access text)
  language sql stable security definer set search_path = pg_catalog, tenancy
  as $$
    select g.scope_tenant_id, g.scope_modules, g.scope_access
      from tenancy.breakglass_grant g
     where g.id = p_grant_id and g.requester_id = p_principal_id
       and g.state = 'active' and g.expires_at > now()
  $$;
revoke all on function tenancy.breakglass_scope(text, text) from public;
grant execute on function tenancy.breakglass_scope(text, text) to app_rw;

-- Active for its principal, and (when scoped) in the transaction's tenant.
create or replace function tenancy.breakglass_active(grant_id text, principal_id text) returns boolean
  language sql stable security definer set search_path = pg_catalog, tenancy
  as $$
    select exists (
      select 1 from tenancy.breakglass_grant g
       where g.id = grant_id and g.requester_id = principal_id
         and g.state = 'active' and g.expires_at > now()
         and (g.scope_tenant_id is null
              or (g.scope_tenant_id = current_setting('app.tenant_id', true)
                  and coalesce(current_setting('app.scope', true), '') <> 'platform'))
    )
  $$;

-- As 0009, refusing a tenant outside the grant's scope and recording the scope with the use.
create or replace function tenancy.breakglass_touch(p_grant_id text, p_principal_id text) returns boolean
  language plpgsql security definer set search_path = pg_catalog, tenancy
  as $$
  declare
    g record;
    v_tenant text := nullif(current_setting('app.tenant_id', true), '');
    v_first boolean;
  begin
    if v_tenant is null then
      raise exception 'breakglass_touch: no tenant context' using errcode = '42501';
    end if;
    select * into g from tenancy.breakglass_grant
     where id = p_grant_id and requester_id = p_principal_id and state = 'active' and expires_at > now()
       and (scope_tenant_id is null or scope_tenant_id = v_tenant);
    if not found then
      return false;
    end if;
    insert into tenancy.breakglass_use
      (tenant_id, grant_id, requester_id, approver_id, reason, expires_at, review_ticket_ref,
       scope_modules, scope_access)
      values (v_tenant, g.id, g.requester_id, g.approver_id, g.reason, g.expires_at, g.review_ticket_ref,
              g.scope_modules, g.scope_access)
      on conflict (tenant_id, grant_id) do update
        set last_used_at = now(), uses = tenancy.breakglass_use.uses + 1
      returning (xmax = 0) into v_first;
    return v_first;
  end
  $$;
