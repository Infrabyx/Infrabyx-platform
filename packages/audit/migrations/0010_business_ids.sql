-- @infrabyx/audit 0010: business ids on a ledger entry (LawDocsComply PR-LDC-30, R1-D-125).
-- `audit.ledger.business_ids` holds 1 to 16 distinct ids (obligation, matter, control ...), never
-- personal data. The chain covers them only when set, in their stored order, so every entry written
-- before this migration hashes and verifies exactly as before. Expand-only: one nullable column (no
-- rewrite), its check, and `audit.ledger_chain()` as in audit/0006 plus the one optional field. The
-- GIN index is built concurrently by audit/0011.
set lock_timeout = '5s';
set statement_timeout = '60s';

create or replace function audit.valid_business_ids(ids text[]) returns boolean
  language sql immutable parallel safe set search_path = pg_catalog
  as $$
    select ids is null
        or (cardinality(ids) between 1 and 16
            and array_position(ids, null) is null
            and (select bool_and(x ~ '^[A-Za-z0-9_.:@/+=-]{1,128}$') from unnest(ids) x)
            and (select count(distinct x) from unnest(ids) x) = cardinality(ids))
  $$;
alter function audit.valid_business_ids(text[]) owner to app_migrate;

alter table audit.ledger
  add column business_ids text[] check (audit.valid_business_ids(business_ids));
comment on column audit.ledger.business_ids is 'dataclass:INTERNAL';

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
      || case when new.business_ids is null then '' else ',"business_ids":' || to_json(new.business_ids)::text end
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
