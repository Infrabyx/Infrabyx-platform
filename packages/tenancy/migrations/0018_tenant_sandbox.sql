-- @infrabyx/tenancy 0018: sandbox tenants (LawDocsComply PR-LDC-29; R1-plan M60; R1-D-87).
-- Expand-only.
--   * `tenancy.tenant.sandbox`: the tenant is a sandbox; NOTIFY records its deliveries and never
--     sends them, and the AI gateway refuses data above INTERNAL. Every existing tenant is not a
--     sandbox (the default);
--   * it is set when the tenant is created (`TenantBootstrap`, in a platform context) and changed
--     only by a platform context whose transaction carries the action `tenancy.tenant.sandbox.set`
--     (`TenantSandbox.set`, ledgered); the trigger below refuses any other change, so a tenant
--     context, which RLS lets update its own row, can never flip it;
--   * `tenancy.tenant_sandbox()` gives the kernel the flag of the transaction's tenant, null when
--     there is no tenant row. The kernel reads it once per transaction into `tx.ctx.sandbox`.
set lock_timeout = '5s';
set statement_timeout = '60s';

alter table tenancy.tenant add column sandbox boolean not null default false;
comment on column tenancy.tenant.sandbox is 'dataclass:INTERNAL';

-- The flag of the transaction's tenant, for the kernel; nothing else. SECURITY DEFINER so a
-- role without SELECT on tenancy.tenant (app_external) can still learn it.
create function tenancy.tenant_sandbox() returns boolean
  language sql stable security definer set search_path = pg_catalog, tenancy
  as $$
    select t.sandbox from tenancy.tenant t
     where t.id = pg_catalog.current_setting('app.tenant_id', true)
  $$;
revoke all on function tenancy.tenant_sandbox() from public;
grant execute on function tenancy.tenant_sandbox() to app_rw, app_ro, app_external;

-- Only the platform's ledgered path changes the flag (app.* settings are set by the kernel alone).
create function tenancy.tenant_sandbox_guard() returns trigger
  language plpgsql set search_path = pg_catalog, tenancy
  as $$
  begin
    if new.sandbox is distinct from old.sandbox
       and (coalesce(pg_catalog.current_setting('app.scope', true), '') <> 'platform'
            or coalesce(pg_catalog.current_setting('app.action', true), '') <> 'tenancy.tenant.sandbox.set') then
      raise exception 'tenancy.tenant.sandbox is changed only by the platform (tenancy.tenant.sandbox.set)'
        using errcode = '42501';
    end if;
    return new;
  end
  $$;
revoke all on function tenancy.tenant_sandbox_guard() from public;
create trigger tenant_sandbox_guard before update on tenancy.tenant
  for each row execute function tenancy.tenant_sandbox_guard();
