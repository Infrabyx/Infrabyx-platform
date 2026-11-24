-- @infrabyx/tenancy 0033: the inbox keeps an UNSIGNED partner original too (Udofin PR-UDF-085; owner's
-- order of 24 Nov 2026 14:35 IST, R1-D-285; built as R1-D-288). Expand-only. tenancy/0029 kept a
-- partner's original only with the JWS verified over it (`eco_inbox_original_with_jws`); a lender
-- that sends unsigned events has no copy of what it sent. From here `original` may be kept without
-- a JWS, under the same class (REGULATED, 0030) and so the same retention as a signed one, written
-- once by the same trigger, and read with the same reader roles. Unsigned is the row having no JWS:
-- the JWS is written once too (0026), so an unsigned original can never later look signed, and
-- nothing claims a signature check for it (`EcosystemInbox` reports `originalSigned: false`).
--   * `tenancy.add_ecosystem_inbox_original(text)` is replaced with 0030's body but for that check,
--     which it now drops where it exists;
--   * every existing inbox carrying the check loses it (one `do` block; a catalogue change only, no
--     row is read, rewritten or deleted: products' existing rows are untouched).
-- 0029 and 0030 have shipped and are not edited.
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
    -- The JWS column comes first: a signed original is read with its JWS's reader roles.
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
    -- 0033 (PR-UDF-085): an original may be kept without a JWS (unsigned); 0029's check that it
    -- comes only with one is dropped where it exists, and never added again.
    execute format('alter table %I.eco_inbox drop constraint if exists eco_inbox_original_with_jws', p_schema);
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
  'Adds <schema>.eco_inbox.original (R1-D-281): nullable JSON object of at most 262,144 octets, written once, class REGULATED (R1-D-283), signed when the row has a JWS and unsigned otherwise (R1-D-288); idempotent.';

-- Existing inboxes: only 0029's check is dropped.
do $$
  declare
    s text;
  begin
    for s in
      select n.nspname
        from pg_constraint k
        join pg_class c on c.oid = k.conrelid
        join pg_namespace n on n.oid = c.relnamespace
       where c.relname = 'eco_inbox' and c.relkind = 'r' and k.conname = 'eco_inbox_original_with_jws'
       order by n.nspname
    loop
      execute format('alter table %I.eco_inbox drop constraint eco_inbox_original_with_jws', s);
    end loop;
  end
$$;
