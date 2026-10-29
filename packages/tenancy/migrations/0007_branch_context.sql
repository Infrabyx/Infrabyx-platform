-- @infrabyx/tenancy 0007: the branch context (Finbyx PR-FBX-10 item 1, owner request 29 Oct 2026;
-- R1-D-26). Expand-only. The kernel sets, for each transaction:
--   app.branch_id     the branch the change is made in (recorded in the ledger and the capture);
--   app.branch_ids    the branches whose rows the principal may see, comma-separated;
--   app.branch_scope  'all' (every branch of the tenant), 'listed' (app.branch_ids) or 'none'.
-- A product scopes a table by branch as well as tenant with `tenancy.branch_allowed(branch_id)` in
-- its policy, next to the tenant condition. It denies by default: no branch context, an unlisted
-- branch or a row without a branch is refused, unless the scope is 'all'.
set lock_timeout = '5s';
set statement_timeout = '60s';

create function tenancy.branch_allowed(p_branch text) returns boolean
  language sql stable parallel safe set search_path = pg_catalog
  as $$
    select case current_setting('app.branch_scope', true)
      when 'all' then true
      when 'listed' then coalesce(
        p_branch = any(string_to_array(nullif(current_setting('app.branch_ids', true), ''), ',')),
        false)
      else false
    end
  $$;
revoke all on function tenancy.branch_allowed(text) from public;
grant execute on function tenancy.branch_allowed(text) to app_rw, app_ro, app_migrate;
comment on function tenancy.branch_allowed(text) is
  'Branch-level RLS (R1-D-26): true when the transaction may see rows of this branch; denies by default.';
