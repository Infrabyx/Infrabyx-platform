-- @infrabyx/audit 0006: chain lanes (Finbyx PR-FBX-32; IPB-02-51; ADR-0005; R1-D-58). Expand-only.
--
-- Until now every append to a tenant's ledger and to its statutory capture locked that tenant's one
-- chain head (`audit.chain_head`, `audit.capture_head`) until the transaction ended, so a tenant's
-- writing transactions ran one at a time. From here each tenant has N lanes per chain (32 by
-- default, raised only, `audit.set_chain_lanes`). Each lane is a hash chain of its own, exactly as
-- before: entry_hash = sha256_hex(prev_hash || '\n' || canonical), genesis 64 zeros. A transaction
-- takes the first lane it can lock without waiting (its preferred lane first, then the others;
-- `FOR UPDATE SKIP LOCKED`), waits for its preferred lane only when all are busy, and keeps that
-- lane for every entry it writes until it ends (`audit.ledger_lane` and `audit.capture_lane`,
-- transaction settings, rolled back with a savepoint). So up to N transactions of a tenant append
-- at once, each lane stays a strict sequence, and one transaction's entries are contiguous in one
-- lane.
--
-- New entries carry `lane` and `lane_seq` (their position in the lane, both set only by the
-- triggers), and both are hashed; `seq`
-- is now a global sequence (unique, increasing in each lane, with gaps), no longer a dense count per
-- tenant. Entries written before this migration have no lane: they are lane 0, positioned by their
-- `seq`, and hash as before. Lane 0 continues each tenant's existing chain from its old head, so
-- nothing already written changes. The old head tables are kept, frozen, for the record.
-- The daily anchor (format 3) signs every lane head of both chains; the verifiers follow each lane
-- and compare its end with the lane head tables, which only the chains' owners can write.
set lock_timeout = '5s';
set statement_timeout = '120s';

-- No append runs while the triggers change.
lock table audit.ledger, audit.capture in exclusive mode;

-- The number of lanes per chain; only ever raised, so no lane is abandoned.
create table audit.lane_setting (
  chain  text     primary key check (chain in ('ledger', 'capture')),
  lanes  smallint not null check (lanes between 1 and 256)
);
comment on column audit.lane_setting.chain is 'dataclass:INTERNAL';
comment on column audit.lane_setting.lanes is 'dataclass:INTERNAL';
insert into audit.lane_setting (chain, lanes) values ('ledger', 32), ('capture', 32);
revoke all on audit.lane_setting from public;
grant select on audit.lane_setting to app_rw, app_ro, app_migrate, capture_writer;

create function audit.lane_setting_only_up() returns trigger
  language plpgsql set search_path = pg_catalog
  as $$
  begin
    if tg_op <> 'UPDATE' or new.chain <> old.chain or new.lanes < old.lanes then
      raise exception 'audit.lane_setting: lanes are only ever raised' using errcode = '42501';
    end if;
    return new;
  end
  $$;
revoke all on function audit.lane_setting_only_up() from public;
create trigger lane_setting_only_up before update or delete on audit.lane_setting
  for each row execute function audit.lane_setting_only_up();
create trigger lane_setting_no_truncate before truncate on audit.lane_setting
  for each statement execute function audit.refuse_change();

-- A product raises its lanes in its own migration: `select audit.set_chain_lanes('ledger', 64);`.
create function audit.set_chain_lanes(p_chain text, p_lanes integer) returns void
  language sql set search_path = pg_catalog, audit
  as $$ update audit.lane_setting set lanes = p_lanes where chain = p_chain $$;
revoke all on function audit.set_chain_lanes(text, integer) from public;
grant execute on function audit.set_chain_lanes(text, integer) to app_migrate;
grant update on audit.lane_setting to app_migrate;

-- Global sequences for `seq`, started above every existing value so (tenant_id, seq) stays unique.
create sequence audit.ledger_seq as bigint;
create sequence audit.capture_seq as bigint;
select setval('audit.ledger_seq', coalesce((select max(seq) from audit.ledger), 0) + 1, false);
select setval('audit.capture_seq', coalesce((select max(seq) from audit.capture), 0) + 1, false);
revoke all on sequence audit.ledger_seq, audit.capture_seq from public;
grant usage on sequence audit.ledger_seq to app_migrate;
grant usage on sequence audit.capture_seq to capture_writer;

alter table audit.ledger add column lane smallint;
alter table audit.ledger add column lane_seq bigint;
comment on column audit.ledger.lane is 'dataclass:INTERNAL';
comment on column audit.ledger.lane_seq is 'dataclass:INTERNAL';
alter table audit.capture add column lane smallint;
alter table audit.capture add column lane_seq bigint;
comment on column audit.capture.lane is 'dataclass:INTERNAL';
comment on column audit.capture.lane_seq is 'dataclass:INTERNAL';

-- Lane heads, created by a tenant's first append after this migration: lane 0 starts from the
-- tenant's old head (read FOR UPDATE, so a transaction still finishing under the old trigger is
-- waited for), the others from genesis. The columns `lane` and `lane_seq` are set only by the
-- triggers below.
create table audit.ledger_lane (
  tenant_id   text     not null check (tenant_id ~ '^[A-Za-z0-9_]{1,64}$'),
  lane        smallint not null check (lane between 0 and 255),
  lane_seq    bigint   not null check (lane_seq >= 0),
  entry_hash  text     not null check (entry_hash ~ '^[0-9a-f]{64}$'),
  primary key (tenant_id, lane)
);
comment on column audit.ledger_lane.tenant_id is 'dataclass:INTERNAL';
comment on column audit.ledger_lane.lane is 'dataclass:INTERNAL';
comment on column audit.ledger_lane.lane_seq is 'dataclass:INTERNAL';
comment on column audit.ledger_lane.entry_hash is 'dataclass:INTERNAL';
alter table audit.ledger_lane enable row level security;
alter table audit.ledger_lane force row level security;
create policy ledger_lane_tenant on audit.ledger_lane for all
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
revoke all on audit.ledger_lane from public, app_rw, app_ro;
grant select on audit.ledger_lane to app_rw, app_ro;
grant select, insert, update on audit.ledger_lane to app_migrate;

create table audit.capture_lane (
  tenant_id   text     not null check (tenant_id ~ '^[A-Za-z0-9_]{1,64}$'),
  lane        smallint not null check (lane between 0 and 255),
  lane_seq    bigint   not null check (lane_seq >= 0),
  entry_hash  text     not null check (entry_hash ~ '^[0-9a-f]{64}$'),
  primary key (tenant_id, lane)
);
comment on column audit.capture_lane.tenant_id is 'dataclass:INTERNAL';
comment on column audit.capture_lane.lane is 'dataclass:INTERNAL';
comment on column audit.capture_lane.lane_seq is 'dataclass:INTERNAL';
comment on column audit.capture_lane.entry_hash is 'dataclass:INTERNAL';
alter table audit.capture_lane enable row level security;
alter table audit.capture_lane force row level security;
create policy capture_lane_tenant_read on audit.capture_lane for select
  using (tenant_id = current_setting('app.tenant_id', true));
create policy capture_lane_owner on audit.capture_lane for all to capture_writer
  using (true) with check (true);
revoke all on audit.capture_lane from public, app_rw, app_ro, app_migrate;
grant select on audit.capture_lane to app_rw, app_ro;
grant select, insert, update on audit.capture_lane to capture_writer;

-- Lane heads are never deleted; only the chains' owners move them forward.
create trigger ledger_lane_no_delete before delete on audit.ledger_lane
  for each row execute function audit.refuse_change();
create trigger ledger_lane_no_truncate before truncate on audit.ledger_lane
  for each statement execute function audit.refuse_change();
create trigger capture_lane_no_delete before delete on audit.capture_lane
  for each row execute function audit.refuse_change();
create trigger capture_lane_no_truncate before truncate on audit.capture_lane
  for each statement execute function audit.refuse_change();
alter table audit.capture_lane enable always trigger capture_lane_no_delete;
alter table audit.capture_lane enable always trigger capture_lane_no_truncate;

create or replace function audit.ledger_chain() returns trigger
  language plpgsql security definer set search_path = pg_catalog, audit
  as $$
  declare
    v_n     integer;
    v_hint  text := current_setting('audit.ledger_lane', true);
    v_lane  integer;
    v_pref  integer;
    old_head record;
    head    record;
    canon   text;
  begin
    new.occurred_at := date_trunc('milliseconds', now());
    select lanes into v_n from audit.lane_setting where chain = 'ledger';
    if not exists (select 1 from audit.ledger_lane where tenant_id = new.tenant_id and lane = v_n - 1) then
      select seq, entry_hash into old_head from audit.chain_head where tenant_id = new.tenant_id for update;
      insert into audit.ledger_lane (tenant_id, lane, lane_seq, entry_hash)
        select new.tenant_id, g,
               case when g = 0 then coalesce(old_head.seq, 0) else 0 end,
               case when g = 0 then coalesce(old_head.entry_hash, repeat('0', 64)) else repeat('0', 64) end
          from generate_series(0, v_n - 1) g
        on conflict (tenant_id, lane) do nothing;
    end if;
    if v_hint ~ '^[0-9]{1,3}$' and v_hint::integer < v_n then
      v_lane := v_hint::integer;
    else
      v_pref := (hashint8(txid_current()) & 2147483647) % v_n;
      select lane into v_lane from audit.ledger_lane
       where tenant_id = new.tenant_id and lane < v_n
       order by (lane - v_pref + v_n) % v_n
       for update skip locked limit 1;
      v_lane := coalesce(v_lane, v_pref);
      perform set_config('audit.ledger_lane', v_lane::text, true);
    end if;
    select lane_seq, entry_hash into head from audit.ledger_lane
     where tenant_id = new.tenant_id and lane = v_lane for update;
    new.seq := nextval('audit.ledger_seq');
    new.lane := v_lane;
    new.lane_seq := head.lane_seq + 1;
    new.prev_hash := head.entry_hash;
    canon := '{"action":' || to_json(new.action)::text
      || ',"actor_id":' || to_json(new.actor_id)::text
      || ',"actor_type":' || to_json(new.actor_type)::text
      || ',"after_digest":' || coalesce(to_json(new.after_digest)::text, 'null')
      || ',"before_digest":' || coalesce(to_json(new.before_digest)::text, 'null')
      || case when new.branch_id is null then '' else ',"branch_id":' || to_json(new.branch_id)::text end
      || ',"corrects_id":' || coalesce(to_json(new.corrects_id)::text, 'null')
      || ',"id":' || to_json(new.id)::text
      || ',"ip_hash":' || coalesce(to_json(new.ip_hash)::text, 'null')
      || ',"lane":' || new.lane::text
      || ',"lane_seq":' || new.lane_seq::text
      || ',"occurred_at":' || to_json(to_char(new.occurred_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))::text
      || ',"resource_id":' || to_json(new.resource_id)::text
      || ',"resource_type":' || to_json(new.resource_type)::text
      || ',"seq":' || new.seq::text
      || ',"tenant_id":' || to_json(new.tenant_id)::text
      || ',"trace_id":' || coalesce(to_json(new.trace_id)::text, 'null')
      || ',"ua_hash":' || coalesce(to_json(new.ua_hash)::text, 'null')
      || '}';
    new.entry_hash := encode(sha256(convert_to(new.prev_hash || E'\n' || canon, 'UTF8')), 'hex');
    update audit.ledger_lane set lane_seq = new.lane_seq, entry_hash = new.entry_hash
     where tenant_id = new.tenant_id and lane = v_lane;
    return new;
  end
  $$;
alter function audit.ledger_chain() owner to app_migrate;
revoke all on function audit.ledger_chain() from public;

create or replace function audit.capture_row() returns trigger
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
    v_n      integer;
    v_hint   text := current_setting('audit.capture_lane', true);
    v_lane   integer;
    v_pref   integer;
    old_head record;
    head     record;
    v_seq    bigint;
    v_lseq   bigint;
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
    select lanes into v_n from audit.lane_setting where chain = 'capture';
    if not exists (select 1 from audit.capture_lane where tenant_id = v_tenant and lane = v_n - 1) then
      select seq, entry_hash into old_head from audit.capture_head where tenant_id = v_tenant for update;
      insert into audit.capture_lane (tenant_id, lane, lane_seq, entry_hash)
        select v_tenant, g,
               case when g = 0 then coalesce(old_head.seq, 0) else 0 end,
               case when g = 0 then coalesce(old_head.entry_hash, repeat('0', 64)) else repeat('0', 64) end
          from generate_series(0, v_n - 1) g
        on conflict (tenant_id, lane) do nothing;
    end if;
    if v_hint ~ '^[0-9]{1,3}$' and v_hint::integer < v_n then
      v_lane := v_hint::integer;
    else
      v_pref := (hashint8(v_txid) & 2147483647) % v_n;
      select lane into v_lane from audit.capture_lane
       where tenant_id = v_tenant and lane < v_n
       order by (lane - v_pref + v_n) % v_n
       for update skip locked limit 1;
      v_lane := coalesce(v_lane, v_pref);
      perform set_config('audit.capture_lane', v_lane::text, true);
    end if;
    select lane_seq, entry_hash into head from audit.capture_lane
     where tenant_id = v_tenant and lane = v_lane for update;
    v_seq := nextval('audit.capture_seq');
    v_lseq := head.lane_seq + 1;
    canon := '{"action":' || coalesce(to_json(v_action)::text, 'null')
      || ',"actor_id":' || coalesce(to_json(v_actor)::text, 'null')
      || ',"after_digest":' || coalesce(to_json(audit.capture_digest(v_after::text))::text, 'null')
      || ',"before_digest":' || coalesce(to_json(audit.capture_digest(v_before::text))::text, 'null')
      || ',"branch_id":' || coalesce(to_json(v_branch)::text, 'null')
      || ',"breakglass_id":' || coalesce(to_json(v_bg)::text, 'null')
      || ',"db_role":' || to_json(v_role)::text
      || ',"db_user":' || to_json(v_login)::text
      || ',"entity_id":' || coalesce(to_json(v_entity)::text, 'null')
      || ',"lane":' || v_lane::text
      || ',"lane_seq":' || v_lseq::text
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
        txid, occurred_at, prev_hash, entry_hash, lane, lane_seq)
      values (v_tenant, v_seq, v_table, v_op, coalesce(v_key, '{}'::jsonb), v_before, v_after,
        v_actor, v_entity, v_branch, v_bg, v_trace, v_action, v_reason, v_login, v_role,
        v_txid, v_at, head.entry_hash, v_hash, v_lane, v_lseq);
    update audit.capture_lane set lane_seq = v_lseq, entry_hash = v_hash
     where tenant_id = v_tenant and lane = v_lane;
    return null;
  end
  $$;
revoke all on function audit.capture_row() from public;
