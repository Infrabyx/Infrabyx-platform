-- @infrabyx/audit 0008: retiring a statutory-capture registration (Finbyx PR-FBX-39; OWNER-QUESTIONS
-- #122, R1-D-102). Until now the drop guard (audit/0003) refused, for ever, any drop of a registered
-- table, so a product could never contract a captured table it no longer uses. The owner allowed one
-- narrow way out, and nothing else:
--
--   select audit.retire_capture('<schema>.<table>');   -- in a product migration, then
--   drop table <schema>.<table>;                        -- in the same transaction
--
-- * Only the migrating role may call it (EXECUTE is granted to app_migrate only), and only inside a
--   migration: the platform runner (`@infrabyx/tenancy` migrate) sets `ipb.migration` to the file it
--   is applying, for that file's transaction, and holds its advisory lock; without both it is refused.
-- * The table must be registered and empty. It is locked (ACCESS EXCLUSIVE) and read past row-level
--   security; a table with any row is refused. Its writes are refused from then on
--   (`ipb_capture_retired`), so no row can appear and vanish with the drop.
-- * The retirement is written into the capture chain: one `audit.capture_retirement` row in the
--   platform tenant's chain and in the chain of every tenant holding capture rows of the table (who,
--   when, which migration, the registration, the table's row count 0, and how many capture rows of it
--   that tenant keeps). That table is itself registered for capture, so each row is a chained capture
--   entry (action `audit.capture.retire`). Every existing capture row is kept; nothing is deleted.
-- * The registration row is then removed (the only delete `audit.capture_table` admits, and only in
--   the retiring transaction), and the drop guard admits the drop of that one table, with its
--   capture triggers, in the same transaction only. If the table is not dropped by the end of the
--   transaction, the commit fails and the retirement is undone. Every other drop is refused as before.
-- * A retired name can be registered again only by a new `register_capture`, which starts a new
--   registration (its history stays in the capture chain under the same table name).
set lock_timeout = '5s';
set statement_timeout = '60s';

-- The retirement record: one row per chain it is written to. Rows are only ever added.
create table audit.capture_retirement (
  tenant_id      text        not null check (tenant_id ~ '^[A-Za-z0-9_]{1,64}$'),
  rel_name       text        not null check (rel_name ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$'),
  retired_txid   bigint      not null,
  rel_oid        oid         not null,
  key_columns    text[]      not null,
  registered_at  timestamptz not null,
  registered_by  text        not null,
  table_rows     bigint      not null check (table_rows = 0),
  capture_rows   bigint      not null check (capture_rows >= 0),
  migration      text        not null check (length(migration) between 10 and 300),
  retired_by     text        not null,
  retired_at     timestamptz not null default now(),
  primary key (tenant_id, rel_name, retired_txid)
);
comment on column audit.capture_retirement.tenant_id is 'dataclass:INTERNAL';
comment on column audit.capture_retirement.rel_name is 'dataclass:INTERNAL';
comment on column audit.capture_retirement.retired_txid is 'dataclass:INTERNAL';
comment on column audit.capture_retirement.rel_oid is 'dataclass:INTERNAL';
comment on column audit.capture_retirement.key_columns is 'dataclass:INTERNAL';
comment on column audit.capture_retirement.registered_at is 'dataclass:INTERNAL';
comment on column audit.capture_retirement.registered_by is 'dataclass:INTERNAL';
comment on column audit.capture_retirement.table_rows is 'dataclass:INTERNAL';
comment on column audit.capture_retirement.capture_rows is 'dataclass:INTERNAL';
comment on column audit.capture_retirement.migration is 'dataclass:INTERNAL';
comment on column audit.capture_retirement.retired_by is 'dataclass:INTERNAL';
comment on column audit.capture_retirement.retired_at is 'dataclass:INTERNAL';
alter table audit.capture_retirement enable row level security;
alter table audit.capture_retirement force row level security;
create policy capture_retirement_tenant_read on audit.capture_retirement for select
  using (tenant_id = current_setting('app.tenant_id', true));
revoke all on audit.capture_retirement from public, app_rw, app_ro, app_migrate;
grant select on audit.capture_retirement to app_rw, app_ro, app_migrate;
create trigger capture_retirement_no_change before update or delete on audit.capture_retirement
  for each row execute function audit.refuse_change();
create trigger capture_retirement_no_truncate before truncate on audit.capture_retirement
  for each statement execute function audit.refuse_change();
alter table audit.capture_retirement enable always trigger capture_retirement_no_change;
alter table audit.capture_retirement enable always trigger capture_retirement_no_truncate;

-- At commit: a retired table must be gone. Deferred, so the drop can follow the call; made
-- immediate, it fails at once, which is the safe side.
create function audit.capture_retirement_dropped() returns trigger
  language plpgsql set search_path = pg_catalog
  as $$
  begin
    if exists (select 1 from pg_class where oid = new.rel_oid) then
      raise exception 'retire_capture: % was retired but not dropped in the same transaction', new.rel_name
        using errcode = '55000';
    end if;
    return null;
  end
  $$;
revoke all on function audit.capture_retirement_dropped() from public;
create constraint trigger capture_retirement_dropped after insert on audit.capture_retirement
  deferrable initially deferred for each row execute function audit.capture_retirement_dropped();
alter table audit.capture_retirement enable always trigger capture_retirement_dropped;

-- The retirement is itself captured, so each row is an entry in its tenant's capture chain.
do $$
begin
  if not exists (select 1 from audit.capture_problems(true) x where x like 'event trigger %') then
    perform audit.register_capture('audit.capture_retirement');
  end if;
end
$$;

-- A retired table takes no more writes before it is dropped.
create function audit.capture_refuse_retired() returns trigger
  language plpgsql set search_path = pg_catalog
  as $$
  begin
    raise exception 'statutory capture: %.% is retired and is being dropped; it takes no writes',
      tg_table_schema, tg_table_name using errcode = '42501';
  end
  $$;
revoke all on function audit.capture_refuse_retired() from public;

-- Registrations: still never updated; a row is deleted only by the retirement of its table, in the
-- retiring transaction. (CREATE OR REPLACE TRIGGER changes the trigger in place; nothing is dropped.)
create function audit.capture_table_change() returns trigger
  language plpgsql set search_path = pg_catalog, audit
  as $$
  begin
    if tg_op = 'DELETE' and exists (
      select 1 from audit.capture_retirement r
       where r.rel_oid = old.rel and r.retired_txid = txid_current()
    ) then
      return old;
    end if;
    raise exception 'audit.capture_table: a registration ends only through audit.retire_capture'
      using errcode = 'insufficient_privilege';
  end
  $$;
revoke all on function audit.capture_table_change() from public;
create or replace trigger capture_table_no_change before update or delete on audit.capture_table
  for each row execute function audit.capture_table_change();

create function audit.retire_capture(p_table regclass) returns void
  language plpgsql security definer set search_path = pg_catalog, audit
  as $$
  declare
    reg          record;
    t            record;
    v_migration  text := nullif(current_setting('ipb.migration', true), '');
    v_txid       bigint := txid_current();
    v_rls        text := current_setting('row_security');
    v_action     text := current_setting('app.action', true);
    v_reason     text := current_setting('app.reason', true);
    v_rows       boolean;
    v_count      bigint;
  begin
    -- Inside a migration: the runner's marker for this transaction, and its advisory lock
    -- (`@infrabyx/tenancy` migrate, key 7270140001).
    if v_migration is null or v_migration !~ '^.{1,200}/[0-9]{4}_[a-z0-9_]+\.sql$'
       or not exists (
         select 1 from pg_locks
          where locktype = 'advisory' and pid = pg_backend_pid() and granted
            and classid = 1 and objid = 2975172705 and objsubid = 1) then
      raise exception 'retire_capture: only inside a migration applied by the platform migration runner'
        using errcode = '42501';
    end if;
    select * into reg from audit.capture_table where rel = p_table;
    if not found then
      raise exception 'retire_capture: % is not registered for capture', p_table using errcode = '22023';
    end if;
    if p_table = 'audit.capture_retirement'::regclass then
      raise exception 'retire_capture: the retirement record is never retired' using errcode = '42501';
    end if;
    if not exists (select 1 from audit.capture_table where rel = 'audit.capture_retirement'::regclass) then
      raise exception 'retire_capture: audit.capture_retirement is not registered for capture; the retirement could not be chained'
        using errcode = '55000';
    end if;

    -- Empty, counted past row-level security, under a lock that holds until the drop.
    execute format('lock table %s in access exclusive mode', p_table);
    perform set_config('row_security', 'off', true);
    begin
      execute format('select exists (select 1 from %s)', p_table) into v_rows;
    exception when insufficient_privilege then
      raise exception 'retire_capture: % cannot be read past row-level security; audit/0008 must be installed by the database owner, as audit/0003',
        reg.rel_name using errcode = '42501';
    end;
    perform set_config('row_security', v_rls, true);
    if v_rows then
      raise exception 'retire_capture: % has rows; only an empty table can be retired', reg.rel_name
        using errcode = '55000';
    end if;

    -- The retirement, into the platform chain and the chain of each tenant holding capture rows of it.
    perform set_config('app.action', 'audit.capture.retire', true);
    perform set_config('app.reason', left(format('retire_capture %s in %s', reg.rel_name, v_migration), 500), true);
    for t in
      select x.tenant_id from (
        select tenant_id from audit.capture_lane
        union select tenant_id from audit.capture_head
        union select 'tnt_platform'
      ) x order by 1
    loop
      select count(*) into v_count from audit.capture c
       where c.tenant_id = t.tenant_id and c.table_name = reg.rel_name;
      if v_count > 0 or t.tenant_id = 'tnt_platform' then
        insert into audit.capture_retirement (tenant_id, rel_name, retired_txid, rel_oid, key_columns,
            registered_at, registered_by, table_rows, capture_rows, migration, retired_by)
          values (t.tenant_id, reg.rel_name, v_txid, p_table::oid, reg.key_columns,
            reg.registered_at, reg.registered_by, 0, v_count, v_migration, session_user::text);
      end if;
    end loop;
    perform set_config('app.action', coalesce(v_action, ''), true);
    perform set_config('app.reason', coalesce(v_reason, ''), true);

    -- End the registration, and refuse writes until the drop.
    delete from audit.capture_table where rel = p_table;
    execute format('create trigger ipb_capture_retired before insert or update or delete on %s for each row execute function audit.capture_refuse_retired()', p_table);
    execute format('alter table %s enable always trigger ipb_capture_retired', p_table);
  end
  $$;
revoke all on function audit.retire_capture(regclass) from public;
grant execute on function audit.retire_capture(regclass) to app_migrate;

-- The drop guard, as audit/0003's, admitting one thing more: the drop of a table retired in this
-- transaction, together with its capture triggers.
create or replace function audit.capture_guard_drop() returns event_trigger
  language plpgsql security definer set search_path = pg_catalog, audit
  as $$
  declare
    o record;
  begin
    for o in select * from pg_event_trigger_dropped_objects() loop
      if o.object_identity like 'audit.capture%'
         or o.object_identity like '% on audit.capture%' then
        raise exception 'statutory capture cannot be disabled: % % may not be dropped',
          o.object_type, o.object_identity using errcode = '42501';
      end if;
      -- A capture trigger goes only with its table, retired in this transaction.
      if o.object_type = 'trigger' and o.object_identity like 'ipb_capture%' then
        if exists (
          select 1 from audit.capture_retirement r
           where r.retired_txid = txid_current()
             and o.object_identity in ('ipb_capture on ' || r.rel_name,
                                       'ipb_capture_truncate on ' || r.rel_name,
                                       'ipb_capture_retired on ' || r.rel_name)
             and exists (
               select 1 from pg_event_trigger_dropped_objects() d
                where d.classid = 'pg_class'::regclass and d.objid = r.rel_oid and d.objsubid = 0
                  and d.object_type = 'table')
        ) then
          continue;
        end if;
        raise exception 'statutory capture cannot be disabled: % % may not be dropped',
          o.object_type, o.object_identity using errcode = '42501';
      end if;
      if o.classid = 'pg_class'::regclass and o.objsubid = 0
         and exists (select 1 from audit.capture_table t where t.rel = o.objid) then
        raise exception 'statutory capture cannot be disabled: % % may not be dropped',
          o.object_type, o.object_identity using errcode = '42501';
      end if;
    end loop;
  end
  $$;
