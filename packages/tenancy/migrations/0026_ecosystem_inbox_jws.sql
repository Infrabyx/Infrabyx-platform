-- @infrabyx/tenancy 0026: the Ecosystem inbox keeps a regulated message's verified detached JWS
-- beside the event (Udofin PR-UDF-073, R1-D-257; Ecosystem Spec §3.6, guide §7dp "store it beside
-- the event"). Every inbox made by `tenancy.create_ecosystem_inbox` gains a nullable `jws` column:
--   * null for an unsigned event; otherwise the compact detached JWS `EcosystemInbox.receive`
--     verified (C-22 profile) before it stored the event, never an unverified one;
--   * at most 1,024 octets in the compact detached form, the envelope's `X-Infrabyx-JWS` limit
--     (`REGULATED_JWS_HEADER_MAX`, Spec v1.4 §3.6);
--   * written once, at insert: a BEFORE UPDATE trigger refuses any change of it (42501), so the
--     proof can always be re-verified against the stored envelope.
-- `tenancy.add_ecosystem_inbox_jws('<schema>')` adds the column, constraint and trigger, and is
-- idempotent; `create_ecosystem_inbox` now calls it, and this migration runs it for every inbox
-- that already exists. Expand-only: a nullable column without default, one check, one trigger.

set lock_timeout = '5s';
set statement_timeout = '60s';

create function tenancy.eco_inbox_jws_once() returns trigger
  language plpgsql set search_path = pg_catalog
  as $$
  begin
    if new.jws is distinct from old.jws then
      raise exception 'the JWS of inbox event % is written once, when it is received', old.event_id
        using errcode = '42501';
    end if;
    return new;
  end
  $$;
revoke all on function tenancy.eco_inbox_jws_once() from public;
-- A module's migration creates the trigger through create_ecosystem_inbox, as app_migrate.
grant execute on function tenancy.eco_inbox_jws_once() to app_migrate;
comment on function tenancy.eco_inbox_jws_once() is
  'Refuses a change of <schema>.eco_inbox.jws after insert (R1-D-257): the verified JWS is written once.';

create function tenancy.add_ecosystem_inbox_jws(p_schema text) returns void
  language plpgsql set search_path = pg_catalog
  as $$
  declare
    t regclass;
  begin
    if p_schema !~ '^[a-z][a-z0-9_]*$' then
      raise exception 'add_ecosystem_inbox_jws: invalid schema name %', p_schema using errcode = '22023';
    end if;
    t := to_regclass(format('%I.eco_inbox', p_schema));
    if t is null then
      raise exception 'add_ecosystem_inbox_jws: %.eco_inbox does not exist', p_schema using errcode = '42P01';
    end if;
    execute format('alter table %I.eco_inbox add column if not exists jws text', p_schema);
    if not exists (select 1 from pg_constraint where conrelid = t and conname = 'eco_inbox_jws_compact') then
      execute format(
        'alter table %I.eco_inbox add constraint eco_inbox_jws_compact check (octet_length(jws) <= 1024 and jws ~ ''^[A-Za-z0-9_-]+\.\.[A-Za-z0-9_-]+$'')',
        p_schema);
    end if;
    if not exists (select 1 from pg_trigger where tgrelid = t and tgname = 'eco_inbox_jws_once' and not tgisinternal) then
      execute format(
        'create trigger eco_inbox_jws_once before update on %I.eco_inbox for each row execute function tenancy.eco_inbox_jws_once()',
        p_schema);
    end if;
    execute format('comment on column %I.eco_inbox.jws is %L', p_schema, 'dataclass:INTERNAL');
  end
  $$;
revoke all on function tenancy.add_ecosystem_inbox_jws(text) from public;
grant execute on function tenancy.add_ecosystem_inbox_jws(text) to app_migrate;
comment on function tenancy.add_ecosystem_inbox_jws(text) is
  'Adds <schema>.eco_inbox.jws (R1-D-257): nullable, at most 1,024 octets of compact detached JWS, written once; idempotent.';

-- tenancy 0006's function, unchanged but for the last step: new inboxes get the column too.
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
  end
  $$;
comment on function tenancy.create_ecosystem_inbox(text) is
  'Creates <schema>.eco_inbox (with the write-once jws column, R1-D-257) and <schema>.eco_position for the Ecosystem inbox (Spec §3.5, R1 G2): forced RLS by tenant, no delete grant.';

-- Inboxes made before this migration: the table comment `create_ecosystem_inbox` sets marks them.
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
      perform tenancy.add_ecosystem_inbox_jws(s);
    end loop;
  end
$$;
