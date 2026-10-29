-- @infrabyx/audit 0004: the branch in the ledger (Finbyx PR-FBX-10 item 1, owner request 29 Oct
-- 2026; R1-D-26). Expand-only. `audit.ledger.branch_id` is the branch the kernel context names
-- (`app.branch_id`). The chain covers it only when it is set, so every entry written before this
-- migration, and every entry without a branch, hashes exactly as before (PL1-C-01).
set lock_timeout = '5s';
set statement_timeout = '60s';

alter table audit.ledger add column branch_id text check (branch_id ~ '^[A-Za-z0-9_.:-]{1,64}$');
comment on column audit.ledger.branch_id is 'dataclass:INTERNAL';

create or replace function audit.ledger_chain() returns trigger
  language plpgsql security definer set search_path = pg_catalog, audit
  as $$
  declare
    head record;
    canon text;
  begin
    new.occurred_at := date_trunc('milliseconds', now());
    insert into audit.chain_head (tenant_id, seq, entry_hash)
      values (new.tenant_id, 0, repeat('0', 64))
      on conflict (tenant_id) do nothing;
    select seq, entry_hash into head from audit.chain_head where tenant_id = new.tenant_id for update;
    new.seq := head.seq + 1;
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
      || ',"occurred_at":' || to_json(to_char(new.occurred_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))::text
      || ',"resource_id":' || to_json(new.resource_id)::text
      || ',"resource_type":' || to_json(new.resource_type)::text
      || ',"seq":' || new.seq::text
      || ',"tenant_id":' || to_json(new.tenant_id)::text
      || ',"trace_id":' || coalesce(to_json(new.trace_id)::text, 'null')
      || ',"ua_hash":' || coalesce(to_json(new.ua_hash)::text, 'null')
      || '}';
    new.entry_hash := encode(sha256(convert_to(new.prev_hash || E'\n' || canon, 'UTF8')), 'hex');
    update audit.chain_head set seq = new.seq, entry_hash = new.entry_hash where tenant_id = new.tenant_id;
    return new;
  end
  $$;
alter function audit.ledger_chain() owner to app_migrate;
revoke all on function audit.ledger_chain() from public;
