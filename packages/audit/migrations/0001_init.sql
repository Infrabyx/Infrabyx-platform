-- @infrabyx/audit 0001: hash-chained, insert-only audit ledger and signed anchors
-- (IPB-02-51, §02.4.7.1; PL1-C-01). Expand-only. Requires the roles from @infrabyx/tenancy 0001.
--
-- entry_hash = sha256_hex(prev_hash || '\n' || JCS(entry)), genesis prev_hash = 64 zeros per
-- tenant. JCS(entry) is built here over a fixed, sorted field list; CHECK constraints restrict
-- every hashed field to characters JSON never escapes, so to_json() here and JSON.stringify()
-- in the TypeScript verifier produce identical bytes.
set lock_timeout = '5s';
set statement_timeout = '60s';

create schema if not exists audit;
revoke all on schema audit from public;
grant usage on schema audit to app_rw, app_ro, app_migrate;

create table audit.ledger (
  id             text        primary key check (id ~ '^led_[0-9A-HJKMNP-TV-Z]{26}$'),
  tenant_id      text        not null check (tenant_id ~ '^[A-Za-z0-9_]{1,64}$'),
  seq            bigint      not null check (seq > 0),
  actor_id       text        not null check (actor_id ~ '^[A-Za-z0-9_.:@/+=-]{1,255}$'),
  actor_type     text        not null check (actor_type in ('user', 'service', 'agent', 'breakglass')),
  action         text        not null check (action ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
  resource_type  text        not null check (resource_type ~ '^[a-z][a-z0-9_.]{0,63}$'),
  resource_id    text        not null check (resource_id ~ '^[A-Za-z0-9_.:@/+=-]{1,255}$'),
  before_digest  text        check (before_digest ~ '^[0-9a-f]{64}$'),
  after_digest   text        check (after_digest ~ '^[0-9a-f]{64}$'),
  corrects_id    text        check (corrects_id ~ '^led_[0-9A-HJKMNP-TV-Z]{26}$'),
  trace_id       text        check (trace_id ~ '^[A-Za-z0-9-]{1,64}$'),
  ip_hash        text        check (ip_hash ~ '^[0-9a-f]{64}$'),
  ua_hash        text        check (ua_hash ~ '^[0-9a-f]{64}$'),
  occurred_at    timestamptz not null,
  prev_hash      text        not null check (prev_hash ~ '^[0-9a-f]{64}$'),
  entry_hash     text        not null check (entry_hash ~ '^[0-9a-f]{64}$'),
  unique (tenant_id, seq)
);
comment on column audit.ledger.id is 'dataclass:INTERNAL';
comment on column audit.ledger.tenant_id is 'dataclass:INTERNAL';
comment on column audit.ledger.seq is 'dataclass:INTERNAL';
comment on column audit.ledger.actor_id is 'dataclass:INTERNAL';
comment on column audit.ledger.actor_type is 'dataclass:INTERNAL';
comment on column audit.ledger.action is 'dataclass:INTERNAL';
comment on column audit.ledger.resource_type is 'dataclass:INTERNAL';
comment on column audit.ledger.resource_id is 'dataclass:INTERNAL';
comment on column audit.ledger.before_digest is 'dataclass:INTERNAL';
comment on column audit.ledger.after_digest is 'dataclass:INTERNAL';
comment on column audit.ledger.corrects_id is 'dataclass:INTERNAL';
comment on column audit.ledger.trace_id is 'dataclass:INTERNAL';
comment on column audit.ledger.ip_hash is 'dataclass:INTERNAL';
comment on column audit.ledger.ua_hash is 'dataclass:INTERNAL';
comment on column audit.ledger.occurred_at is 'dataclass:INTERNAL';
comment on column audit.ledger.prev_hash is 'dataclass:INTERNAL';
comment on column audit.ledger.entry_hash is 'dataclass:INTERNAL';
create index ledger_resource_idx on audit.ledger (tenant_id, resource_type, resource_id);
create index ledger_time_idx on audit.ledger (tenant_id, occurred_at);

-- Per-tenant chain head; locked FOR UPDATE by the trigger, which serialises appends per tenant.
create table audit.chain_head (
  tenant_id   text   primary key,
  seq         bigint not null,
  entry_hash  text   not null check (entry_hash ~ '^[0-9a-f]{64}$')
);
comment on column audit.chain_head.tenant_id is 'dataclass:INTERNAL';
comment on column audit.chain_head.seq is 'dataclass:INTERNAL';
comment on column audit.chain_head.entry_hash is 'dataclass:INTERNAL';
alter table audit.chain_head enable row level security;
alter table audit.chain_head force row level security;
create policy chain_head_tenant on audit.chain_head for all
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
revoke all on audit.chain_head from public, app_rw, app_ro;
grant select, insert, update on audit.chain_head to app_migrate;

create function audit.ledger_chain() returns trigger
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
create trigger ledger_chain before insert on audit.ledger for each row execute function audit.ledger_chain();

-- History is never edited, by anyone (IPB-02 NN-02): privileges revoked and triggers that raise.
create function audit.refuse_change() returns trigger
  language plpgsql set search_path = pg_catalog
  as $$
  begin
    raise exception 'audit.% is append-only; write a correction entry instead', tg_table_name
      using errcode = 'insufficient_privilege';
  end
  $$;
revoke all on function audit.refuse_change() from public;
create trigger ledger_no_update before update or delete on audit.ledger for each row execute function audit.refuse_change();
create trigger ledger_no_truncate before truncate on audit.ledger for each statement execute function audit.refuse_change();

alter table audit.ledger enable row level security;
alter table audit.ledger force row level security;
create policy ledger_read on audit.ledger for select
  using (tenant_id = current_setting('app.tenant_id', true));
create policy ledger_append on audit.ledger for insert
  with check (
    tenant_id = current_setting('app.tenant_id', true)
    and actor_id = current_setting('app.actor_id', true)
  );
revoke all on audit.ledger from public;
revoke update, delete, truncate on audit.ledger from app_rw, app_ro, app_migrate;
grant select, insert on audit.ledger to app_rw;
grant select on audit.ledger to app_ro;

-- Signed daily anchors (IPB-02-51): per-tenant head hash, KMS signature, STORAGE object key.
create table audit.anchor (
  id           text        primary key check (id ~ '^anc_[0-9A-HJKMNP-TV-Z]{26}$'),
  tenant_id    text        not null,
  anchor_date  date        not null,
  seq          bigint      not null check (seq >= 0),
  head_hash    text        not null check (head_hash ~ '^[0-9a-f]{64}$'),
  signature    text        not null,
  alg          text        not null,
  key_id       text        not null,
  storage_key  text        not null,
  created_at   timestamptz not null default now(),
  unique (tenant_id, anchor_date)
);
comment on column audit.anchor.id is 'dataclass:INTERNAL';
comment on column audit.anchor.tenant_id is 'dataclass:INTERNAL';
comment on column audit.anchor.anchor_date is 'dataclass:INTERNAL';
comment on column audit.anchor.seq is 'dataclass:INTERNAL';
comment on column audit.anchor.head_hash is 'dataclass:INTERNAL';
comment on column audit.anchor.signature is 'dataclass:INTERNAL';
comment on column audit.anchor.alg is 'dataclass:INTERNAL';
comment on column audit.anchor.key_id is 'dataclass:INTERNAL';
comment on column audit.anchor.storage_key is 'dataclass:INTERNAL';
comment on column audit.anchor.created_at is 'dataclass:INTERNAL';
create trigger anchor_no_update before update or delete on audit.anchor for each row execute function audit.refuse_change();
create trigger anchor_no_truncate before truncate on audit.anchor for each statement execute function audit.refuse_change();
alter table audit.anchor enable row level security;
alter table audit.anchor force row level security;
create policy anchor_tenant on audit.anchor for all
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
revoke all on audit.anchor from public;
revoke update, delete, truncate on audit.anchor from app_rw, app_ro, app_migrate;
grant select, insert on audit.anchor to app_rw;
grant select on audit.anchor to app_ro;

-- Outbox for LedgerAnchorWritten and LedgerChainBroken (IPB-01 §01.4.3.3).
create table audit.outbox (
  id             text        primary key,
  tenant_id      text        not null,
  type           text        not null,
  envelope       jsonb       not null,
  created_at     timestamptz not null default now(),
  dispatched_at  timestamptz,
  attempts       integer     not null default 0
);
comment on column audit.outbox.id is 'dataclass:INTERNAL';
comment on column audit.outbox.tenant_id is 'dataclass:INTERNAL';
comment on column audit.outbox.type is 'dataclass:INTERNAL';
comment on column audit.outbox.envelope is 'dataclass:INTERNAL';
comment on column audit.outbox.created_at is 'dataclass:INTERNAL';
comment on column audit.outbox.dispatched_at is 'dataclass:INTERNAL';
comment on column audit.outbox.attempts is 'dataclass:INTERNAL';
create index outbox_pending_idx on audit.outbox (created_at) where dispatched_at is null;
alter table audit.outbox enable row level security;
alter table audit.outbox force row level security;
create policy outbox_tenant on audit.outbox for all
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
grant select, insert, update on audit.outbox to app_rw;
grant select on audit.outbox to app_ro;
