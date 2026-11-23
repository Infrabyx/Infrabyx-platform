-- @infrabyx/tenancy 0028: a narrower read grant on an inbox's JWS (Udofin PR-UDF-084, R1-D-280).
-- tenancy 0026 put the verified detached JWS of a regulated message in `<schema>.eco_inbox.jws`,
-- readable by every principal that may read the row (app_rw and app_ro hold table-level SELECT,
-- RLS keeps it to the row's tenant). A product may now narrow that column, per inbox, to named
-- roles held in the row's own tenant; the rest of the row keeps its grants and its RLS:
--   * `tenancy.eco_inbox_jws_reader`: the registry of reader roles per inbox schema. Platform
--     configuration, not tenant data (no tenant_id): no row-level security, no grant to app_rw or
--     app_ro; app_migrate writes it through `restrict_ecosystem_inbox_jws`, and the two SECURITY
--     DEFINER functions below read it as their owner;
--   * `tenancy.restrict_ecosystem_inbox_jws('<schema>', array[<roles>])`, run by the product's
--     own migration: records the roles (replacing that schema's set), revokes SELECT on
--     `<schema>.eco_inbox` and on its `jws` column from app_rw and app_ro, and grants them SELECT
--     on every other column, listed from the catalog. Idempotent; running it again refreshes the
--     column grants, so a later migration that adds a column to the inbox runs it again (or
--     `tenancy.refresh_ecosystem_inbox_jws_grants()` for every restricted inbox);
--   * `tenancy.eco_inbox_jws_readable('<schema>')`: whether the transaction's roles (`app.roles`,
--     set by the kernel from the verified context, like `app.tenant_id`) may read the inbox's JWS:
--     true for an inbox with no registered roles, else when one of them is held;
--   * `tenancy.eco_inbox_jws('<schema>', source, event_id)`: the JWS of one event of the
--     transaction's tenant, or 42501 without it when the roles may not read it. The tenant filter
--     is explicit (`app.tenant_id`) besides the table's forced RLS, as the owner may bypass RLS.
-- The definers run as their owner, the migration identity, which must be able to read the
-- product's inbox: it can whenever one identity runs every migration (`infrabyx-migrate`); if it
-- cannot, the read fails closed (42501). Expand-only: one new table and five functions.
set lock_timeout = '5s';
set statement_timeout = '60s';

create table tenancy.eco_inbox_jws_reader (
  schema_name  text not null check (schema_name ~ '^[a-z][a-z0-9_]*$'),
  role         text not null check (
                 length(role) <= 128
                 and role ~ '^([A-Z]{2,4}_[A-Z][A-Z0-9_]*|FN:[A-Z][A-Z0-9_]{1,31})$'),
  primary key (schema_name, role)
);
comment on table tenancy.eco_inbox_jws_reader is
  'Roles that may read <schema>.eco_inbox.jws of an inbox restricted by tenancy.restrict_ecosystem_inbox_jws (PR-UDF-084, R1-D-280).';
comment on column tenancy.eco_inbox_jws_reader.schema_name is 'dataclass:INTERNAL';
comment on column tenancy.eco_inbox_jws_reader.role is 'dataclass:INTERNAL';
revoke all on tenancy.eco_inbox_jws_reader from public;
grant select, insert, delete on tenancy.eco_inbox_jws_reader to app_migrate;

-- Column grants of a restricted inbox: SELECT on every column but `jws` for app_rw and app_ro.
create function tenancy.eco_inbox_jws_column_grants(p_schema text) returns void
  language plpgsql set search_path = pg_catalog
  as $$
  declare
    t regclass;
    cols text;
  begin
    if p_schema is null or p_schema !~ '^[a-z][a-z0-9_]*$' then
      raise exception 'eco_inbox_jws_column_grants: invalid schema name %', p_schema using errcode = '22023';
    end if;
    t := to_regclass(format('%I.eco_inbox', p_schema));
    if t is null then
      raise exception 'eco_inbox_jws_column_grants: %.eco_inbox does not exist', p_schema using errcode = '42P01';
    end if;
    select string_agg(quote_ident(a.attname), ', ' order by a.attnum) into cols
      from pg_attribute a
     where a.attrelid = t and a.attnum > 0 and not a.attisdropped and a.attname <> 'jws';
    execute format('revoke select on %I.eco_inbox from app_rw, app_ro', p_schema);
    execute format('revoke select (jws) on %I.eco_inbox from app_rw, app_ro', p_schema);
    execute format('grant select (%s) on %I.eco_inbox to app_rw, app_ro', cols, p_schema);
  end
  $$;
revoke all on function tenancy.eco_inbox_jws_column_grants(text) from public;
grant execute on function tenancy.eco_inbox_jws_column_grants(text) to app_migrate;
comment on function tenancy.eco_inbox_jws_column_grants(text) is
  'Grants app_rw and app_ro SELECT on every column of <schema>.eco_inbox but jws, and revokes the rest (R1-D-280).';

create function tenancy.restrict_ecosystem_inbox_jws(p_schema text, p_roles text[]) returns void
  language plpgsql set search_path = pg_catalog
  as $$
  declare
    t regclass;
    r text;
  begin
    if p_schema is null or p_schema !~ '^[a-z][a-z0-9_]*$' then
      raise exception 'restrict_ecosystem_inbox_jws: invalid schema name %', p_schema using errcode = '22023';
    end if;
    t := to_regclass(format('%I.eco_inbox', p_schema));
    if t is null then
      raise exception 'restrict_ecosystem_inbox_jws: %.eco_inbox does not exist', p_schema using errcode = '42P01';
    end if;
    if obj_description(t, 'pg_class') is distinct from 'Ecosystem inbox (Spec §3.5; tenancy.create_ecosystem_inbox, R1 G2)' then
      raise exception 'restrict_ecosystem_inbox_jws: %.eco_inbox was not made by tenancy.create_ecosystem_inbox', p_schema
        using errcode = '22023';
    end if;
    if p_roles is null or cardinality(p_roles) = 0 then
      raise exception 'restrict_ecosystem_inbox_jws: name at least one reader role' using errcode = '22023';
    end if;
    foreach r in array p_roles loop
      if r is null or length(r) > 128 or r !~ '^([A-Z]{2,4}_[A-Z][A-Z0-9_]*|FN:[A-Z][A-Z0-9_]{1,31})$' then
        raise exception 'restrict_ecosystem_inbox_jws: invalid role name %', r using errcode = '22023';
      end if;
    end loop;
    perform tenancy.add_ecosystem_inbox_jws(p_schema);
    delete from tenancy.eco_inbox_jws_reader where schema_name = p_schema;
    insert into tenancy.eco_inbox_jws_reader (schema_name, role)
      select distinct p_schema, x from unnest(p_roles) as x;
    perform tenancy.eco_inbox_jws_column_grants(p_schema);
  end
  $$;
revoke all on function tenancy.restrict_ecosystem_inbox_jws(text, text[]) from public;
grant execute on function tenancy.restrict_ecosystem_inbox_jws(text, text[]) to app_migrate;
comment on function tenancy.restrict_ecosystem_inbox_jws(text, text[]) is
  'Narrows <schema>.eco_inbox.jws to the reader roles named (replacing the set) and refreshes the column grants (PR-UDF-084, R1-D-280); idempotent.';

-- A later migration that adds a column to the inbox tables runs this, so every restricted inbox
-- grants the new column too.
create function tenancy.refresh_ecosystem_inbox_jws_grants() returns void
  language plpgsql set search_path = pg_catalog
  as $$
  declare
    s text;
  begin
    for s in select distinct schema_name from tenancy.eco_inbox_jws_reader order by 1 loop
      perform tenancy.eco_inbox_jws_column_grants(s);
    end loop;
  end
  $$;
revoke all on function tenancy.refresh_ecosystem_inbox_jws_grants() from public;
grant execute on function tenancy.refresh_ecosystem_inbox_jws_grants() to app_migrate;
comment on function tenancy.refresh_ecosystem_inbox_jws_grants() is
  'Re-runs the column grants of every inbox restricted by tenancy.restrict_ecosystem_inbox_jws (R1-D-280).';

-- Whether the transaction's roles may read the inbox's JWS. Reads the registry only, and says
-- nothing about any row.
create function tenancy.eco_inbox_jws_readable(p_schema text) returns boolean
  language plpgsql stable security definer set search_path = pg_catalog
  as $$
  declare
    t regclass;
  begin
    if p_schema is null or p_schema !~ '^[a-z][a-z0-9_]*$' then
      raise exception 'eco_inbox_jws_readable: invalid schema name %', p_schema using errcode = '22023';
    end if;
    t := to_regclass(format('%I.eco_inbox', p_schema));
    if t is null
       or obj_description(t, 'pg_class') is distinct from 'Ecosystem inbox (Spec §3.5; tenancy.create_ecosystem_inbox, R1 G2)' then
      raise exception 'eco_inbox_jws_readable: %.eco_inbox is not an Ecosystem inbox', p_schema using errcode = '42P01';
    end if;
    if not exists (select 1 from tenancy.eco_inbox_jws_reader r where r.schema_name = p_schema) then
      return true;
    end if;
    return exists (
      select 1 from tenancy.eco_inbox_jws_reader r
       where r.schema_name = p_schema
         and r.role = any (string_to_array(nullif(current_setting('app.roles', true), ''), ',')));
  end
  $$;
revoke all on function tenancy.eco_inbox_jws_readable(text) from public;
grant execute on function tenancy.eco_inbox_jws_readable(text) to app_rw, app_ro;
comment on function tenancy.eco_inbox_jws_readable(text) is
  'Whether app.roles may read <schema>.eco_inbox.jws: no reader registered, or one held (R1-D-280).';

-- The JWS of one event of the transaction's tenant, for a caller holding a reader role.
create function tenancy.eco_inbox_jws(p_schema text, p_source text, p_event_id text) returns text
  language plpgsql stable security definer set search_path = pg_catalog
  as $$
  declare
    v text;
  begin
    if not tenancy.eco_inbox_jws_readable(p_schema) then
      raise exception 'the JWS of %.eco_inbox is read by its registered reader roles only', p_schema
        using errcode = '42501';
    end if;
    execute format(
      'select jws from %I.eco_inbox where tenant_id = $1 and source = $2 and event_id = $3', p_schema)
      into v
      using current_setting('app.tenant_id', true), p_source, p_event_id;
    return v;
  end
  $$;
revoke all on function tenancy.eco_inbox_jws(text, text, text) from public;
grant execute on function tenancy.eco_inbox_jws(text, text, text) to app_rw, app_ro;
comment on function tenancy.eco_inbox_jws(text, text, text) is
  'The JWS of one event of app.tenant_id in <schema>.eco_inbox, or 42501 when app.roles may not read it (PR-UDF-084, R1-D-280).';
