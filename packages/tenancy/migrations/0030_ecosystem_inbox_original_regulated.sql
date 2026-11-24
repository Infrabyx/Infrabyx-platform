-- @infrabyx/tenancy 0030: the partner's original signed body is REGULATED, not INTERNAL
-- (owner answer #201 (1), 24 Nov 2026, R1-D-282; built as R1-D-283). tenancy 0029 tagged
-- `<schema>.eco_inbox.original` `dataclass:INTERNAL`, the class first ordered; the original carries
-- the same lender data as the mapped `envelope` (`dataclass:REGULATED`), and the class gates exports,
-- masking and AI routing. 0029 has shipped and is never edited, so this migration:
--   * replaces `tenancy.add_ecosystem_inbox_original` with 0029's body but for the tag, so every
--     inbox made from now on (`create_ecosystem_inbox` calls it) tags the column REGULATED;
--   * retags the column of every inbox that already has it tagged INTERNAL (each was added by that
--     function, run as app_migrate, the role that runs this migration).
-- Nothing else changes: the column, its checks, its trigger, its grants and its readers are 0029's.
-- A comment change only: no lock beyond the catalogue row, no rewrite.

set lock_timeout = '5s';
set statement_timeout = '60s';

create or replace function tenancy.add_ecosystem_inbox_original(p_schema text) returns void
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
    -- The owner's class (owner answer #201 (1), 24 Nov 2026, R1-D-282): the original carries the
    -- same lender data as the mapped envelope, so it has the envelope's class.
    execute format('comment on column %I.eco_inbox.original is %L', p_schema, 'dataclass:REGULATED');
  end
  $$;
revoke all on function tenancy.add_ecosystem_inbox_original(text) from public;
grant execute on function tenancy.add_ecosystem_inbox_original(text) to app_migrate;
comment on function tenancy.add_ecosystem_inbox_original(text) is
  'Adds <schema>.eco_inbox.original (R1-D-281): nullable JSON object of at most 262,144 octets, only with a JWS, written once, class REGULATED (R1-D-283); idempotent.';

-- Inboxes that already have the column: the tag 0029 set is the only thing changed.
do $$
  declare
    s text;
  begin
    for s in
      select n.nspname
        from pg_attribute a
        join pg_class c on c.oid = a.attrelid
        join pg_namespace n on n.oid = c.relnamespace
       where c.relname = 'eco_inbox' and c.relkind = 'r'
         and a.attname = 'original' and a.attnum > 0 and not a.attisdropped
         and col_description(c.oid, a.attnum::int) = 'dataclass:INTERNAL'
       order by n.nspname
    loop
      execute format('comment on column %I.eco_inbox.original is %L', s, 'dataclass:REGULATED');
    end loop;
  end
$$;
