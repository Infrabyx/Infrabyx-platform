-- @infrabyx/tenancy 0005: SVC_TENANT_SWEEP, the service reader that lists tenants for a
-- product's scheduled per-tenant jobs (Udofin platform request PR-UDF-013; R1-D-12).
-- Its role reads `id` and `status` of tenancy.tenant and nothing else; the table's existing
-- read policy admits a platform-scope reader. `TenantSweep` ledgers the read in every tenant it
-- lists, then runs the job in each tenant's own context, under that tenant's RLS, as app_rw.
-- Switch-only for app_rw and app_ro, as every service role since 0004. Expand-only.

set lock_timeout = '5s';
set statement_timeout = '60s';

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'svc_tenant_sweep') then
    create role svc_tenant_sweep nologin nosuperuser nobypassrls nocreatedb nocreaterole;
  end if;
end
$$;

grant usage on schema tenancy to svc_tenant_sweep;
grant select (id, status) on tenancy.tenant to svc_tenant_sweep;
grant svc_tenant_sweep to app_rw, app_ro with inherit false, set true;
