-- @infrabyx/audit 0003: database-level statutory audit capture (Finbyx platform request PR-FBX-10
-- item 2, owner request 29 Oct 2026; R1-D-25). The edit log the Companies (Accounts) Rules 2014
-- r.3(1) proviso asks of books of account: every insert, update and delete on a registered table,
-- with before and after values, the actor, the time and the change's context. Expand-only.
--
-- (1) A product registers a table in its own migration: `select audit.register_capture('<schema>.<table>')`.
--     The table must have `tenant_id` and forced row-level security. Its row trigger (`ipb_capture`)
--     is ENABLED ALWAYS, so it also fires under `session_replication_role = replica`; a TRUNCATE is
--     refused, because it would remove rows without capturing them.
-- (2) Every captured change is one `audit.capture` row, appended by `audit.capture_row()`, a
--     SECURITY DEFINER function owned by the `capture_writer` role, which no application, read-only,
--     migration or support role is granted. The row holds the values (`to_jsonb`), the application
--     actor, entity, branch, break-glass grant, trace, action and reason from the kernel's
--     transaction settings, the database login (`session_user`) and role (`role`), and the
--     transaction id. Rows are never updated or deleted, by anyone.
-- (3) Per-tenant hash chain, as the ledger's (PL1-C-01): entry_hash = sha256_hex(prev_hash || '\n'
--     || canonical), genesis 64 zeros; `canonical` is a fixed, sorted JSON object over fields whose
--     characters JSON never escapes, with the values, the row key and the reason as SHA-256 digests
--     of their stored text. The daily anchor binds the head: `AuditService.writeAnchor` signs the
--     capture head of the day with the ledger head (anchor format 2).
-- (4) It cannot be disabled: there is no setting or flag; two event triggers refuse any DDL that
--     would drop or disable a capture object or a registered table's triggers, or hand
--     `capture_row()` to another owner, and refuse dropping a registered table. Event triggers need
--     the database owner's privilege (on a managed service, its administrative role); where the
--     migrating role cannot create them, registration is refused, so no table is registered without
--     the guard. The scheduled verification reports a missing or disabled guard, a chain break or a
--     gap (`audit.capture_problems()` and the chain check in `@infrabyx/audit`).
set lock_timeout = '5s';
set statement_timeout = '60s';

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'capture_writer') then
    create role capture_writer nologin nosuperuser nobypassrls nocreatedb nocreaterole noinherit;
  end if;
end
$$;
grant usage on schema audit to capture_writer;

-- Registered tables (the capture's scope); rows are added by register_capture only.
create table audit.capture_table (
  rel            regclass    primary key,
  rel_name       text        not null unique check (rel_name ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$'),
  key_columns    text[]      not null check (cardinality(key_columns) between 1 and 8),
  registered_at  timestamptz not null default now(),
  registered_by  text        not null
);
comment on column audit.capture_table.rel is 'dataclass:INTERNAL';
comment on column audit.capture_table.rel_name is 'dataclass:INTERNAL';
comment on column audit.capture_table.key_columns is 'dataclass:INTERNAL';
comment on column audit.capture_table.registered_at is 'dataclass:INTERNAL';
comment on column audit.capture_table.registered_by is 'dataclass:INTERNAL';
revoke all on audit.capture_table from public;
grant select on audit.capture_table to app_rw, app_ro, app_migrate, capture_writer;

create table audit.capture (
  tenant_id      text        not null check (tenant_id ~ '^[A-Za-z0-9_]{1,64}$'),
  seq            bigint      not null check (seq > 0),
  table_name     text        not null check (table_name ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$'),
  op             text        not null check (op in ('insert', 'update', 'delete')),
  row_key        jsonb       not null,
  before_values  jsonb,
  after_values   jsonb,
  actor_id       text        check (actor_id ~ '^[A-Za-z0-9_.:@/+=-]{1,255}$'),
  entity_id      text        check (entity_id ~ '^[A-Za-z0-9_.:-]{1,64}$'),
  branch_id      text        check (branch_id ~ '^[A-Za-z0-9_.:-]{1,64}$'),
  breakglass_id  text        check (breakglass_id ~ '^[A-Za-z0-9_.:-]{1,64}$'),
  trace_id       text        check (trace_id ~ '^[A-Za-z0-9-]{1,64}$'),
  action         text        check (action ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
  reason         text        check (length(reason) between 1 and 500),
  db_user        text        not null check (db_user ~ '^[A-Za-z0-9_.@-]{1,63}$'),
  db_role        text        not null check (db_role ~ '^[A-Za-z0-9_.@-]{1,63}$'),
  txid           bigint      not null,
  occurred_at    timestamptz not null,
  prev_hash      text        not null check (prev_hash ~ '^[0-9a-f]{64}$'),
  entry_hash     text        not null check (entry_hash ~ '^[0-9a-f]{64}$'),
  primary key (tenant_id, seq),
  check ((op = 'insert') = (before_values is null)),
  check ((op = 'delete') = (after_values is null))
);
comment on column audit.capture.tenant_id is 'dataclass:INTERNAL';
comment on column audit.capture.seq is 'dataclass:INTERNAL';
comment on column audit.capture.table_name is 'dataclass:INTERNAL';
comment on column audit.capture.op is 'dataclass:INTERNAL';
comment on column audit.capture.row_key is 'dataclass:CONFIDENTIAL';
comment on column audit.capture.before_values is 'dataclass:REGULATED';
comment on column audit.capture.after_values is 'dataclass:REGULATED';
comment on column audit.capture.actor_id is 'dataclass:INTERNAL';
comment on column audit.capture.entity_id is 'dataclass:INTERNAL';
comment on column audit.capture.branch_id is 'dataclass:INTERNAL';
comment on column audit.capture.breakglass_id is 'dataclass:INTERNAL';
comment on column audit.capture.trace_id is 'dataclass:INTERNAL';
comment on column audit.capture.action is 'dataclass:INTERNAL';
comment on column audit.capture.reason is 'dataclass:CONFIDENTIAL';
comment on column audit.capture.db_user is 'dataclass:INTERNAL';
comment on column audit.capture.db_role is 'dataclass:INTERNAL';
comment on column audit.capture.txid is 'dataclass:INTERNAL';
comment on column audit.capture.occurred_at is 'dataclass:INTERNAL';
comment on column audit.capture.prev_hash is 'dataclass:INTERNAL';
comment on column audit.capture.entry_hash is 'dataclass:INTERNAL';
create index capture_time_idx on audit.capture (tenant_id, occurred_at);
create index capture_row_idx on audit.capture (tenant_id, table_name, row_key);

create table audit.capture_head (
  tenant_id   text   primary key,
  seq         bigint not null,
  entry_hash  text   not null check (entry_hash ~ '^[0-9a-f]{64}$')
);
comment on column audit.capture_head.tenant_id is 'dataclass:INTERNAL';
comment on column audit.capture_head.seq is 'dataclass:INTERNAL';
comment on column audit.capture_head.entry_hash is 'dataclass:INTERNAL';

-- Tenants read their own capture; only capture_writer appends, whatever the tenant setting (a
-- migration's backfill runs without one).
alter table audit.capture enable row level security;
alter table audit.capture force row level security;
create policy capture_tenant_read on audit.capture for select
  using (tenant_id = current_setting('app.tenant_id', true));
create policy capture_append on audit.capture for insert to capture_writer with check (true);
create policy capture_owner_read on audit.capture for select to capture_writer using (true);
revoke all on audit.capture from public, app_rw, app_ro, app_migrate;
grant select on audit.capture to app_rw, app_ro;
grant select, insert on audit.capture to capture_writer;

alter table audit.capture_head enable row level security;
alter table audit.capture_head force row level security;
create policy capture_head_tenant_read on audit.capture_head for select
  using (tenant_id = current_setting('app.tenant_id', true));
create policy capture_head_owner on audit.capture_head for all to capture_writer
  using (true) with check (true);
revoke all on audit.capture_head from public, app_rw, app_ro, app_migrate;
grant select on audit.capture_head to app_rw, app_ro;
grant select, insert, update on audit.capture_head to capture_writer;

create trigger capture_no_update before update or delete on audit.capture
  for each row execute function audit.refuse_change();
create trigger capture_no_truncate before truncate on audit.capture
  for each statement execute function audit.refuse_change();
alter table audit.capture enable always trigger capture_no_update;
alter table audit.capture enable always trigger capture_no_truncate;

create function audit.capture_digest(v text) returns text
  language sql immutable strict set search_path = pg_catalog
  as $$ select encode(sha256(convert_to(v, 'UTF8')), 'hex') $$;

create function audit.capture_row() returns trigger
  language plpgsql security definer set search_path = pg_catalog, audit
  as $$
  declare
    v_before jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
    v_after  jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
    v_row    jsonb := coalesce(v_after, v_before);
    v_key    jsonb;
    v_tenant text := v_row ->> 'tenant_id';
    v_table  text := tg_table_schema || '.' || tg_table_name;
    v_op     text := lower(tg_op);
    v_actor  text := nullif(current_setting('app.actor_id', true), '');
    v_entity text := nullif(current_setting('app.entity_id', true), '');
    v_branch text := nullif(current_setting('app.branch_id', true), '');
    v_bg     text := nullif(current_setting('app.breakglass', true), '');
    v_trace  text := nullif(current_setting('app.trace_id', true), '');
    v_action text := nullif(current_setting('app.action', true), '');
    v_reason text := nullif(current_setting('app.reason', true), '');
    v_role   text := coalesce(nullif(current_setting('role', true), 'none'), session_user::text);
    v_login  text;
    v_txid   bigint := txid_current();
    v_at     timestamptz := date_trunc('milliseconds', clock_timestamp());
    head     record;
    v_seq    bigint;
    canon    text;
    v_hash   text;
  begin
    -- A setting that does not fit its column is recorded as absent, never allowed to block the write.
    if v_actor !~ '^[A-Za-z0-9_.:@/+=-]{1,255}$' then v_actor := null; end if;
    if v_entity !~ '^[A-Za-z0-9_.:-]{1,64}$' then v_entity := null; end if;
    if v_branch !~ '^[A-Za-z0-9_.:-]{1,64}$' then v_branch := null; end if;
    if v_bg !~ '^[A-Za-z0-9_.:-]{1,64}$' then v_bg := null; end if;
    if v_trace !~ '^[A-Za-z0-9-]{1,64}$' then v_trace := null; end if;
    if v_action !~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$' then v_action := null; end if;
    v_reason := left(v_reason, 500);
    v_login := session_user::text;
    if v_login !~ '^[A-Za-z0-9_.@-]{1,63}$' then v_login := 'h-' || left(audit.capture_digest(v_login), 60); end if;
    if v_role !~ '^[A-Za-z0-9_.@-]{1,63}$' then v_role := 'h-' || left(audit.capture_digest(v_role), 60); end if;
    if v_tenant is null then
      raise exception 'statutory capture: % has no tenant_id in this row', v_table using errcode = '23502';
    end if;
    select jsonb_object_agg(c, v_row -> c) into v_key
      from audit.capture_table t, unnest(t.key_columns) as c where t.rel = tg_relid;
    insert into audit.capture_head (tenant_id, seq, entry_hash) values (v_tenant, 0, repeat('0', 64))
      on conflict (tenant_id) do nothing;
    select seq, entry_hash into head from audit.capture_head where tenant_id = v_tenant for update;
    v_seq := head.seq + 1;
    canon := '{"action":' || coalesce(to_json(v_action)::text, 'null')
      || ',"actor_id":' || coalesce(to_json(v_actor)::text, 'null')
      || ',"after_digest":' || coalesce(to_json(audit.capture_digest(v_after::text))::text, 'null')
      || ',"before_digest":' || coalesce(to_json(audit.capture_digest(v_before::text))::text, 'null')
      || ',"branch_id":' || coalesce(to_json(v_branch)::text, 'null')
      || ',"breakglass_id":' || coalesce(to_json(v_bg)::text, 'null')
      || ',"db_role":' || to_json(v_role)::text
      || ',"db_user":' || to_json(v_login)::text
      || ',"entity_id":' || coalesce(to_json(v_entity)::text, 'null')
      || ',"occurred_at":' || to_json(to_char(v_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))::text
      || ',"op":' || to_json(v_op)::text
      || ',"reason_digest":' || coalesce(to_json(audit.capture_digest(v_reason))::text, 'null')
      || ',"row_key_digest":' || to_json(audit.capture_digest(coalesce(v_key, '{}'::jsonb)::text))::text
      || ',"seq":' || v_seq::text
      || ',"table_name":' || to_json(v_table)::text
      || ',"tenant_id":' || to_json(v_tenant)::text
      || ',"trace_id":' || coalesce(to_json(v_trace)::text, 'null')
      || ',"txid":' || v_txid::text
      || '}';
    v_hash := encode(sha256(convert_to(head.entry_hash || E'\n' || canon, 'UTF8')), 'hex');
    insert into audit.capture (tenant_id, seq, table_name, op, row_key, before_values, after_values,
        actor_id, entity_id, branch_id, breakglass_id, trace_id, action, reason, db_user, db_role,
        txid, occurred_at, prev_hash, entry_hash)
      values (v_tenant, v_seq, v_table, v_op, coalesce(v_key, '{}'::jsonb), v_before, v_after,
        v_actor, v_entity, v_branch, v_bg, v_trace, v_action, v_reason, v_login, v_role,
        v_txid, v_at, head.entry_hash, v_hash);
    update audit.capture_head set seq = v_seq, entry_hash = v_hash where tenant_id = v_tenant;
    return null;
  end
  $$;
alter function audit.capture_row() owner to capture_writer;
revoke all on function audit.capture_row() from public;

create function audit.capture_refuse_truncate() returns trigger
  language plpgsql set search_path = pg_catalog
  as $$
  begin
    raise exception 'statutory capture: % is registered; TRUNCATE would remove rows without capturing them',
      tg_table_schema || '.' || tg_table_name using errcode = '42501';
  end
  $$;
revoke all on function audit.capture_refuse_truncate() from public;

create trigger capture_table_no_change before update or delete on audit.capture_table
  for each row execute function audit.refuse_change();
create trigger capture_table_no_truncate before truncate on audit.capture_table
  for each statement execute function audit.refuse_change();

-- Every way the capture could be off, as one row each; empty means it is whole.
-- `with_guard` also checks the event triggers (the guard itself cannot see them disabled).
create function audit.capture_problems(with_guard boolean default true) returns setof text
  language sql stable set search_path = pg_catalog, audit
  as $$
    select format('%s: the capture trigger is missing or not enabled always', t.rel_name)
      from audit.capture_table t
     where not exists (
       select 1 from pg_trigger g
        where g.tgrelid = t.rel and g.tgname = 'ipb_capture' and g.tgenabled = 'A'
          and g.tgfoid = 'audit.capture_row()'::regprocedure)
    union all
    select format('%s: the truncate refusal is missing or not enabled always', t.rel_name)
      from audit.capture_table t
     where not exists (
       select 1 from pg_trigger g
        where g.tgrelid = t.rel and g.tgname = 'ipb_capture_truncate' and g.tgenabled = 'A')
    union all
    select format('audit.capture: %s is missing or disabled', n)
      from unnest(array['capture_no_update', 'capture_no_truncate']) as n
     where not exists (
       select 1 from pg_trigger g
        where g.tgrelid = 'audit.capture'::regclass and g.tgname = n and g.tgenabled = 'A')
    union all
    select 'audit.capture_row(): its owner or security definer changed'
     where not exists (
       select 1 from pg_proc p join pg_roles r on r.oid = p.proowner
        where p.oid = 'audit.capture_row()'::regprocedure and r.rolname = 'capture_writer'
          and p.prosecdef)
    union all
    select format('event trigger %s is missing or disabled', n)
      from unnest(array['ipb_capture_guard_ddl', 'ipb_capture_guard_drop']) as n
     where with_guard and not exists (
       select 1 from pg_event_trigger e where e.evtname = n and e.evtenabled in ('O', 'A'))
  $$;
revoke all on function audit.capture_problems(boolean) from public;
grant execute on function audit.capture_problems(boolean) to app_rw, app_ro, app_migrate;

create function audit.register_capture(p_table regclass, p_key text[] default null) returns void
  language plpgsql set search_path = pg_catalog, audit
  as $$
  declare
    v_name text;
    v_key  text[] := p_key;
  begin
    select n.nspname || '.' || c.relname into v_name
      from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.oid = p_table;
    if v_name !~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$' then
      raise exception 'register_capture: invalid table name %', v_name using errcode = '22023';
    end if;
    if exists (select 1 from audit.capture_table where rel = p_table) then
      return;
    end if;
    if exists (select 1 from audit.capture_problems(true) x where x like 'event trigger %') then
      raise exception 'register_capture: the capture guard (event triggers) is not installed; run audit/0003 as the database owner'
        using errcode = '55000';
    end if;
    if not exists (
      select 1 from pg_attribute where attrelid = p_table and attname = 'tenant_id' and not attisdropped
    ) then
      raise exception 'register_capture: % has no tenant_id', v_name using errcode = '42703';
    end if;
    if not exists (select 1 from pg_class where oid = p_table and relrowsecurity and relforcerowsecurity) then
      raise exception 'register_capture: % must have forced row-level security', v_name using errcode = '42501';
    end if;
    if v_key is null then
      select array_agg(a.attname::text order by k.ord) into v_key
        from pg_index i, unnest(i.indkey) with ordinality as k(attnum, ord), pg_attribute a
       where i.indrelid = p_table and i.indisprimary and a.attrelid = p_table and a.attnum = k.attnum;
    end if;
    if v_key is null then
      raise exception 'register_capture: % has no primary key; name its key columns', v_name using errcode = '42P10';
    end if;
    -- Triggers first: the DDL guard checks registered tables only, and this one is not yet.
    execute format('create trigger ipb_capture after insert or update or delete on %s for each row execute function audit.capture_row()', p_table);
    execute format('create trigger ipb_capture_truncate before truncate on %s for each statement execute function audit.capture_refuse_truncate()', p_table);
    execute format('alter table %s enable always trigger ipb_capture', p_table);
    execute format('alter table %s enable always trigger ipb_capture_truncate', p_table);
    insert into audit.capture_table (rel, rel_name, key_columns, registered_by)
      values (p_table, v_name, v_key, session_user::text);
  end
  $$;
revoke all on function audit.register_capture(regclass, text[]) from public;
grant execute on function audit.register_capture(regclass, text[]) to app_migrate;
grant insert on audit.capture_table to app_migrate;

-- The guard: refuse DDL that leaves the capture incomplete, and drops that remove any part of it.
-- SECURITY DEFINER (owned by the role that ran this migration), so the check runs whoever issued the DDL.
create function audit.capture_guard_ddl() returns event_trigger
  language plpgsql security definer set search_path = pg_catalog, audit
  as $$
  declare
    p text;
  begin
    select string_agg(x, '; ') into p from audit.capture_problems(false) x;
    if p is not null then
      raise exception 'statutory capture cannot be disabled: %', p using errcode = '42501';
    end if;
  end
  $$;

create function audit.capture_guard_drop() returns event_trigger
  language plpgsql security definer set search_path = pg_catalog, audit
  as $$
  declare
    o record;
  begin
    for o in select * from pg_event_trigger_dropped_objects() loop
      if o.object_identity like 'audit.capture%'
         or o.object_identity like '% on audit.capture%'
         or (o.object_type = 'trigger' and o.object_identity like 'ipb_capture%')
         or (o.classid = 'pg_class'::regclass and o.objsubid = 0
             and exists (select 1 from audit.capture_table t where t.rel = o.objid)) then
        raise exception 'statutory capture cannot be disabled: % % may not be dropped',
          o.object_type, o.object_identity using errcode = '42501';
      end if;
    end loop;
  end
  $$;
revoke all on function audit.capture_guard_ddl() from public;
revoke all on function audit.capture_guard_drop() from public;

do $$
begin
  create event trigger ipb_capture_guard_ddl on ddl_command_end
    execute function audit.capture_guard_ddl();
  create event trigger ipb_capture_guard_drop on sql_drop
    execute function audit.capture_guard_drop();
exception when insufficient_privilege then
  raise notice 'audit/0003: the capture guard needs the privilege to create event triggers; no table can be registered until it is installed';
end
$$;
