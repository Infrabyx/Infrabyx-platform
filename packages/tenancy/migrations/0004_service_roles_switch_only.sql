-- @infrabyx/tenancy 0004: service roles are switch-only, and the read-only role writes nothing
-- (Udofin platform request PR-UDF-016, security; IPB-02-12; R1-D-11).
-- The `svc_*` service-reader roles were granted to app_rw and app_ro with PostgreSQL's default
-- INHERIT, so both held every service role's privileges without switching to it: app_ro could
-- append to audit.ledger and update `dispatched_at` and `attempts` of every registered outbox
-- through svc_outbox_relay, and read through each reader's platform-scope policy.
--   * app_ro and app_rw become NOINHERIT, so every later grant of a role to them (the service
--     readers other packages' migrations create) defaults to INHERIT FALSE (PostgreSQL 16+);
--   * every existing `svc_*` membership of app_rw and app_ro is re-granted INHERIT FALSE,
--     SET TRUE, by each of its grantors: the kernel still switches to the role with SET LOCAL
--     ROLE, and only then do its grants apply;
--   * svc_outbox_relay, the one service role that writes, is revoked from app_ro altogether, so
--     no role reachable from app_ro by INHERIT or SET can write.
-- Expand-only: no table, column or row changes.

set lock_timeout = '5s';
set statement_timeout = '60s';

-- Roles are cluster-wide, while the runner's advisory lock holds per database: two databases on
-- one cluster migrating at once rewrite the same catalog rows and one fails with "tuple
-- concurrently updated". So only what still needs changing is changed, and a run that loses the
-- race looks again; every run converges on the same state.
do $$
declare
  g record;
  attempt int := 0;
begin
  loop
    begin
      if exists (select 1 from pg_roles where rolname = 'app_ro' and rolinherit) then
        alter role app_ro noinherit;
      end if;
      if exists (select 1 from pg_roles where rolname = 'app_rw' and rolinherit) then
        alter role app_rw noinherit;
      end if;
      for g in
        select r.rolname as role, m.rolname as member, gr.rolname as grantor
          from pg_auth_members a
          join pg_roles r on r.oid = a.roleid
          join pg_roles m on m.oid = a.member
          join pg_roles gr on gr.oid = a.grantor
         where m.rolname in ('app_ro', 'app_rw') and r.rolname like 'svc\_%'
           and (a.inherit_option or not a.set_option
                or (r.rolname = 'svc_outbox_relay' and m.rolname = 'app_ro'))
      loop
        if g.role = 'svc_outbox_relay' and g.member = 'app_ro' then
          execute format('revoke %I from %I granted by %I', g.role, g.member, g.grantor);
        else
          execute format('grant %I to %I with inherit false, set true granted by %I',
            g.role, g.member, g.grantor);
        end if;
      end loop;
      exit;
    exception when internal_error then
      if sqlerrm not like 'tuple concurrently %' or attempt >= 20 then
        raise;
      end if;
      attempt := attempt + 1;
      perform pg_sleep(0.05 * attempt);
    end;
  end loop;
end
$$;
