-- @infrabyx/tenancy 0029: the inbox keeps a partner's ORIGINAL signed body beside the mapped event
-- (Udofin PR-UDF-083, owner-approved 23 Nov 2026, R1-D-281). A product that receives a message in a
-- partner's own data format, signed with the C-22 detached JWS over that original envelope, maps
-- `data` to the shared schema and stores the mapped event; the JWS still signs the original. Every
-- inbox made by `tenancy.create_ecosystem_inbox` gains a nullable `original jsonb` column:
--   * null unless `EcosystemInbox.receive` was given the original and verified the JWS over it;
--   * a JSON object of at most 262,144 octets in its text form, kept only with the JWS that
--     verified over it (`original is null or jws is not null`);
--   * written once, at insert: a BEFORE UPDATE trigger refuses any change of it (42501), so the
--     proof can always be re-verified against the stored original;
--   * on an inbox restricted by `tenancy.restrict_ecosystem_inbox_jws` (tenancy 0028), kept to the
--     same reader roles as `jws`: app_rw and app_ro select neither column, and both are read
--     through SECURITY DEFINER functions that check `app.roles` and the row's tenant.
-- `tenancy.add_ecosystem_inbox_original('<schema>')` adds the column, its checks and the trigger,
-- and is idempotent; `create_ecosystem_inbox` now calls it, and this migration runs it for every
-- inbox that already exists. 0026 and 0028 are untouched (their functions are replaced here).
-- Expand-only: a nullable column without default, three checks, one trigger, two functions.

set lock_timeout = '5s';
set statement_timeout = '60s';

create function tenancy.eco_inbox_original_once() returns trigger
  language plpgsql set search_path = pg_catalog
  as $$
  begin
    if new.original is distinct from old.original then
      raise exception 'the original of inbox event % is written once, when it is received', old.event_id
        using errcode = '42501';
    end if;
    return new;
  end
  $$;
revoke all on function tenancy.eco_inbox_original_once() from public;
-- A module's migration creates the trigger through create_ecosystem_inbox, as app_migrate.
grant execute on function tenancy.eco_inbox_original_once() to app_migrate;
comment on function tenancy.eco_inbox_original_once() is
  'Refuses a change of <schema>.eco_inbox.original after insert (R1-D-281): the signed original is written once.';

create function tenancy.add_ecosystem_inbox_original(p_schema text) returns void
  language plpgsql set search_path = pg_catalog
  as $$
  declare
    t regclass;
  begin
    if p_schema !~ '^[a-z][a-z0-9_]*$' then
      raise exception 'add_ecosystem_inbox_original: invalid schema name %', p_schema using errcode = '22023';
    end if;
    t := to_regclass(format('%I.eco_inbox', p_schema));
    if t is null then
      raise exception 'add_ecosystem_inbox_original: %.eco_inbox does not exist', p_schema using errcode = '42P01';
    end if;
    -- The original is only ever kept with its JWS, so the JWS column comes first.
    perform tenancy.add_ecosystem_inbox_jws(p_schema);
    execute format('alter table %I.eco_inbox add column if not exists original jsonb', p_schema);
    if not exists (select 1 from pg_constraint where conrelid = t and conname = 'eco_inbox_original_object') then
      execute format(
        'alter table %I.eco_inbox add constraint eco_inbox_original_object check (jsonb_typeof(original) = ''object'')',
        p_schema);
    end if;
    if not exists (select 1 from pg_constraint where conrelid = t and conname = 'eco_inbox_original_size') then
      execute format(
        'alter table %I.eco_inbox add constraint eco_inbox_original_size check (octet_length(original::text) <= 262144)',
        p_schema);
    end if;
    if not exists (select 1 from pg_constraint where conrelid = t and conname = 'eco_inbox_original_with_jws') then
      execute format(
        'alter table %I.eco_inbox add constraint eco_inbox_original_with_jws check (original is null or jws is not null)',
        p_schema);
    end if;
    if not exists (select 1 from pg_trigger where tgrelid = t and tgname = 'eco_inbox_original_once' and not tgisinternal) then
      execute format(
        'create trigger eco_inbox_original_once before update on %I.eco_inbox for each row execute function tenancy.eco_inbox_original_once()',
        p_schema);
    end if;
    -- The owner's class (R1-D-281, owner question #201 item 1).
    execute format('comment on column %I.eco_inbox.original is %L', p_schema, 'dataclass:INTERNAL');
  end
  $$;
revoke all on function tenancy.add_ecosystem_inbox_original(text) from public;
grant execute on function tenancy.add_ecosystem_inbox_original(text) to app_migrate;
comment on function tenancy.add_ecosystem_inbox_original(text) is
  'Adds <schema>.eco_inbox.original (R1-D-281): nullable JSON object of at most 262,144 octets, only with a JWS, written once; idempotent.';

-- tenancy 0026's function, unchanged but for the last step: new inboxes get the column too.
create or replace function tenancy.create_ecosystem_inbox(p_schema text) returns void
  language plpgsql set search_path = pg_catalog
  as $$
  begin
    if p_schema !~ '^[a-z][a-z0-9_]*$' then
      raise exception 'create_ecosystem_inbox: invalid schema name %', p_schema using errcode = '22023';
    end if;
    if to_regnamespace(p_schema) is null then
      raise exception 'create_ecosystem_inbox: schema % does not exist', p_schema using errcode = '3F000';
    end if;
    execute format($ddl$
      create table %1$I.eco_inbox (
        tenant_id     text        not null,
        source        text        not null check (length(source) between 8 and 300),
        event_id      text        not null check (event_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
        type          text        not null check (type ~ '^in\.infrabyx\.[a-z][a-z0-9_]*\.[A-Z][A-Za-z0-9]*\.v[1-9][0-9]*$'),
        subject       text        not null check (length(subject) between 1 and 200),
        seq           bigint      not null check (seq >= 0),
        business_key  text        check (length(business_key) between 1 and 400),
        envelope      jsonb       not null,
        state         text        not null default 'received'
                      check (state in ('received', 'parked', 'processed', 'skipped', 'failed', 'break')),
        attempts      integer     not null default 0 check (attempts >= 0),
        last_error    text        check (last_error ~ '^[A-Za-z0-9_.:-]{1,80}$'),
        received_at   timestamptz not null default now(),
        parked_at     timestamptz,
        processed_at  timestamptz,
        primary key (tenant_id, source, event_id)
      )$ddl$, p_schema);
    execute format(
      'create unique index eco_inbox_business_key on %I.eco_inbox (tenant_id, type, business_key) where business_key is not null',
      p_schema);
    execute format(
      'create index eco_inbox_pending on %I.eco_inbox (tenant_id, source, subject, seq) where state in (''received'', ''parked'')',
      p_schema);
    execute format($ddl$
      create table %1$I.eco_position (
        tenant_id   text        not null,
        source      text        not null,
        subject     text        not null,
        last_seq    bigint      not null check (last_seq >= -1),
        updated_at  timestamptz not null default now(),
        primary key (tenant_id, source, subject)
      )$ddl$, p_schema);
    execute format('alter table %I.eco_inbox enable row level security', p_schema);
    execute format('alter table %I.eco_inbox force row level security', p_schema);
    execute format('alter table %I.eco_position enable row level security', p_schema);
    execute format('alter table %I.eco_position force row level security', p_schema);
    execute format(
      'create policy eco_inbox_tenant on %I.eco_inbox for all using (tenant_id = current_setting(''app.tenant_id'', true)) with check (tenant_id = current_setting(''app.tenant_id'', true))',
      p_schema);
    execute format(
      'create policy eco_position_tenant on %I.eco_position for all using (tenant_id = current_setting(''app.tenant_id'', true)) with check (tenant_id = current_setting(''app.tenant_id'', true))',
      p_schema);
    execute format('grant select, insert, update on %I.eco_inbox, %I.eco_position to app_rw', p_schema, p_schema);
    execute format('grant select on %I.eco_inbox, %I.eco_position to app_ro', p_schema, p_schema);
    execute format('comment on table %I.eco_inbox is %L', p_schema,
      'Ecosystem inbox (Spec §3.5; tenancy.create_ecosystem_inbox, R1 G2)');
    execute format('comment on column %I.eco_inbox.tenant_id is %L', p_schema, 'dataclass:INTERNAL');
    execute format('comment on column %I.eco_inbox.source is %L', p_schema, 'dataclass:INTERNAL');
    execute format('comment on column %I.eco_inbox.event_id is %L', p_schema, 'dataclass:INTERNAL');
    execute format('comment on column %I.eco_inbox.type is %L', p_schema, 'dataclass:INTERNAL');
    execute format('comment on column %I.eco_inbox.subject is %L', p_schema, 'dataclass:INTERNAL');
    execute format('comment on column %I.eco_inbox.seq is %L', p_schema, 'dataclass:INTERNAL');
    execute format('comment on column %I.eco_inbox.business_key is %L', p_schema, 'dataclass:CONFIDENTIAL');
    execute format('comment on column %I.eco_inbox.envelope is %L', p_schema, 'dataclass:REGULATED');
    execute format('comment on column %I.eco_inbox.state is %L', p_schema, 'dataclass:INTERNAL');
    execute format('comment on column %I.eco_inbox.attempts is %L', p_schema, 'dataclass:INTERNAL');
    execute format('comment on column %I.eco_inbox.last_error is %L', p_schema, 'dataclass:INTERNAL');
    execute format('comment on column %I.eco_inbox.received_at is %L', p_schema, 'dataclass:INTERNAL');
    execute format('comment on column %I.eco_inbox.parked_at is %L', p_schema, 'dataclass:INTERNAL');
    execute format('comment on column %I.eco_inbox.processed_at is %L', p_schema, 'dataclass:INTERNAL');
    execute format('comment on column %I.eco_position.tenant_id is %L', p_schema, 'dataclass:INTERNAL');
    execute format('comment on column %I.eco_position.source is %L', p_schema, 'dataclass:INTERNAL');
    execute format('comment on column %I.eco_position.subject is %L', p_schema, 'dataclass:INTERNAL');
    execute format('comment on column %I.eco_position.last_seq is %L', p_schema, 'dataclass:INTERNAL');
    execute format('comment on column %I.eco_position.updated_at is %L', p_schema, 'dataclass:INTERNAL');
    perform tenancy.add_ecosystem_inbox_jws(p_schema);
    perform tenancy.add_ecosystem_inbox_original(p_schema);
  end
  $$;
comment on function tenancy.create_ecosystem_inbox(text) is
  'Creates <schema>.eco_inbox (with the write-once jws and original columns, R1-D-257, R1-D-281) and <schema>.eco_position for the Ecosystem inbox (Spec §3.5, R1 G2): forced RLS by tenant, no delete grant.';

-- Inboxes made before this migration: the table comment `create_ecosystem_inbox` sets marks them.
-- A restricted inbox holds no table-level SELECT, so the new column is granted to nobody until the
-- column grants below are refreshed, and they leave it out.
do $$
  declare
    s text;
  begin
    for s in
      select n.nspname
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where c.relname = 'eco_inbox' and c.relkind = 'r'
         and obj_description(c.oid, 'pg_class') = 'Ecosystem inbox (Spec §3.5; tenancy.create_ecosystem_inbox, R1 G2)'
       order by n.nspname
    loop
      perform tenancy.add_ecosystem_inbox_original(s);
    end loop;
  end
$$;

-- tenancy 0028's function, now leaving out `original` as well as `jws`: a restricted inbox keeps
-- the original to the same reader roles as the JWS.
create or replace function tenancy.eco_inbox_jws_column_grants(p_schema text) returns void
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
     where a.attrelid = t and a.attnum > 0 and not a.attisdropped and a.attname not in ('jws', 'original');
    execute format('revoke select on %I.eco_inbox from app_rw, app_ro', p_schema);
    execute format('revoke select (jws) on %I.eco_inbox from app_rw, app_ro', p_schema);
    if exists (select 1 from pg_attribute a
                where a.attrelid = t and a.attname = 'original' and not a.attisdropped) then
      execute format('revoke select (original) on %I.eco_inbox from app_rw, app_ro', p_schema);
    end if;
    execute format('grant select (%s) on %I.eco_inbox to app_rw, app_ro', cols, p_schema);
  end
  $$;
comment on function tenancy.eco_inbox_jws_column_grants(text) is
  'Grants app_rw and app_ro SELECT on every column of <schema>.eco_inbox but jws and original, and revokes the rest (R1-D-280, R1-D-281).';

select tenancy.refresh_ecosystem_inbox_jws_grants();

-- The original of one event of the transaction's tenant, for a caller that may read the inbox's
-- JWS (the same reader roles; any caller while the inbox is not restricted).
create function tenancy.eco_inbox_original(p_schema text, p_source text, p_event_id text) returns jsonb
  language plpgsql stable security definer set search_path = pg_catalog
  as $$
  declare
    v jsonb;
  begin
    if not tenancy.eco_inbox_jws_readable(p_schema) then
      raise exception 'the original of %.eco_inbox is read by its registered reader roles only', p_schema
        using errcode = '42501';
    end if;
    execute format(
      'select original from %I.eco_inbox where tenant_id = $1 and source = $2 and event_id = $3', p_schema)
      into v
      using current_setting('app.tenant_id', true), p_source, p_event_id;
    return v;
  end
  $$;
revoke all on function tenancy.eco_inbox_original(text, text, text) from public;
grant execute on function tenancy.eco_inbox_original(text, text, text) to app_rw, app_ro;
comment on function tenancy.eco_inbox_original(text, text, text) is
  'The original of one event of app.tenant_id in <schema>.eco_inbox, or 42501 when app.roles may not read the inbox''s JWS (PR-UDF-083, R1-D-281).';
