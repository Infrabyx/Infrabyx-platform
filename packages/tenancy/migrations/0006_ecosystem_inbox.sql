-- @infrabyx/tenancy 0006: the Ecosystem inbox (Ecosystem Spec §3.4, §3.5; R1 plan M10, G2).
-- A consuming module's migration calls `select tenancy.create_ecosystem_inbox('<schema>')`, which
-- creates two tables in that module's schema, so the inbox stays inside its bounded context:
--   * <schema>.eco_inbox: every received event, stored before processing, unique by
--     (tenant, source, id) and by (tenant, type, business key), with its per-subject `seq`
--     and a state (received, parked, processed, skipped, failed, break);
--   * <schema>.eco_position: the last processed `seq` per (tenant, source, subject).
-- Both have forced row-level security by tenant; app_rw may select, insert and update, never
-- delete (inbox retention is the product's decision); every write goes through the kernel with a
-- ledger entry (`EcosystemInbox`). Expand-only.

set lock_timeout = '5s';
set statement_timeout = '60s';

create function tenancy.create_ecosystem_inbox(p_schema text) returns void
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
  end
  $$;
revoke all on function tenancy.create_ecosystem_inbox(text) from public;
grant execute on function tenancy.create_ecosystem_inbox(text) to app_migrate;
comment on function tenancy.create_ecosystem_inbox(text) is
  'Creates <schema>.eco_inbox and <schema>.eco_position for the Ecosystem inbox (Spec §3.5, R1 G2): forced RLS by tenant, no delete grant.';
