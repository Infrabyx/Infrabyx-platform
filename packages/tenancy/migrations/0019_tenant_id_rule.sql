-- @infrabyx/tenancy 0019: one tenant-id rule, platform-wide (Finbyx PR-FBX-40; R1-D-103).
-- A tenant id is `tnt_` followed by letters and digits only: lower-case letters and digits (1 to 60,
-- so the id fits every 64-character tenant column), or a ULID. 0001 also allowed underscores after
-- `tnt_` (`tnt_bcl_enterprises`), which the ports' storage prefixes (`tenant/<tenant id>/<module>`)
-- refuse, so such a tenant could not store a call recording or a generated document. The rule is
-- now checked where tenants are created; every id it admits is admitted by every port.
--   * First, a check that no existing tenant breaks it: the migration stops, naming up to ten such
--     ids, and changes nothing. Rename those tenants (a product decision; the product guide's
--     tenant-id section says how) and run it again.
--   * Then the constraint. 0001's wider check stays; this one is narrower. Expand-only.
set lock_timeout = '5s';
set statement_timeout = '60s';

do $$
declare
  v_n   integer;
  v_ids text;
begin
  select count(*), string_agg(id, ', ' order by id) filter (where rn <= 10)
    into v_n, v_ids
    from (
      select id, row_number() over (order by id) as rn
        from tenancy.tenant
       where id !~ '^tnt_[a-z0-9]{1,60}$' and id !~ '^tnt_[0-7][0-9A-HJKMNP-TV-Z]{25}$'
    ) bad;
  if v_n > 0 then
    raise exception 'tenancy/0019: % tenant id(s) break the tenant-id rule (tnt_ then letters and digits only): %; rename them, then run the migration again',
      v_n, v_ids using errcode = '23514';
  end if;
end
$$;

alter table tenancy.tenant add constraint tenant_id_rule
  check (id ~ '^tnt_[a-z0-9]{1,60}$' or id ~ '^tnt_[0-7][0-9A-HJKMNP-TV-Z]{25}$');
