-- @infrabyx/tenancy 0003: the outbox relay's service reader (owner answer #74(e), R1-D-01).
-- SVC_OUTBOX_RELAY relays module outboxes to the QUEUE. Its database role starts with no grant
-- at all; a module's migration registers its outbox with `select tenancy.register_outbox('<schema>')`,
-- which grants the role exactly what the relay needs on that one table and nothing else:
--   * select of the relayed columns, and update of `dispatched_at` and `attempts` only;
--   * a platform-scope select policy, to find which tenants have pending rows (a ledgered
--     ServiceReader read); updates happen only in a tenant context, under the table's own
--     tenant policy, so a row is only ever marked dispatched by its own tenant's transaction.
-- `@infrabyx/audit` 0002 grants the ledger append, so each batch is audited in its transaction.
-- Expand-only.

set lock_timeout = '5s';
set statement_timeout = '60s';

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'svc_outbox_relay') then
    create role svc_outbox_relay nologin nosuperuser nobypassrls nocreatedb nocreaterole;
  end if;
end
$$;
-- The kernel switches to the reader's role with SET LOCAL ROLE, as for every service reader.
grant svc_outbox_relay to app_rw, app_ro;

create function tenancy.register_outbox(p_schema text) returns void
  language plpgsql set search_path = pg_catalog
  as $$
  declare
    t regclass;
    missing text;
  begin
    if p_schema !~ '^[a-z][a-z0-9_]*$' then
      raise exception 'register_outbox: invalid schema name %', p_schema using errcode = '22023';
    end if;
    t := to_regclass(format('%I.outbox', p_schema));
    if t is null then
      raise exception 'register_outbox: %.outbox does not exist', p_schema using errcode = '42P01';
    end if;
    select string_agg(c, ', ') into missing
      from unnest(array['id', 'tenant_id', 'type', 'envelope', 'created_at', 'dispatched_at', 'attempts']) as c
     where not exists (
       select 1 from pg_attribute a where a.attrelid = t and a.attname = c and not a.attisdropped
     );
    if missing is not null then
      raise exception 'register_outbox: %.outbox lacks %', p_schema, missing using errcode = '42703';
    end if;
    if not exists (select 1 from pg_class where oid = t and relrowsecurity and relforcerowsecurity) then
      raise exception 'register_outbox: %.outbox must have forced row-level security', p_schema
        using errcode = '42501';
    end if;
    execute format('grant usage on schema %I to svc_outbox_relay', p_schema);
    execute format(
      'grant select (id, tenant_id, type, envelope, created_at, dispatched_at, attempts), update (dispatched_at, attempts) on %I.outbox to svc_outbox_relay',
      p_schema);
    if not exists (
      select 1 from pg_policy where polrelid = t and polname = 'outbox_relay_discover'
    ) then
      execute format(
        'create policy outbox_relay_discover on %I.outbox for select to svc_outbox_relay using (current_setting(''app.scope'', true) = ''platform'')',
        p_schema);
    end if;
  end
  $$;
revoke all on function tenancy.register_outbox(text) from public;
grant execute on function tenancy.register_outbox(text) to app_migrate;
comment on function tenancy.register_outbox(text) is
  'Registers <schema>.outbox for the outbox relay (SVC_OUTBOX_RELAY, R1-D-01): select of the relayed columns, update of dispatched_at and attempts, and a platform-scope discovery policy; nothing else.';
