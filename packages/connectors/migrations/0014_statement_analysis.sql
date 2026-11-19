-- @infrabyx/connectors 0014: bank statement analyses (Udofin PR-UDF-048, R1-D-202, ADR-0012; threat
-- model §3.144). Expand-only. One row per `analyse` call of the STATEMENT_ANALYSIS adapters, keyed or
-- not, under forced RLS by tenant and written through the kernel with a ledger entry per mutation:
-- a keyed retry gets the first analysis and the analyser is asked once per key, and `status` finds a
-- pending analysis's report prefix and vendor reference. References and hashes only: no statement,
-- account or transaction. The idempotency key is kept as SHA-256; the request (the subject
-- reference, the inputs' FI types, STORAGE keys and SHA-256s, and the report prefix) as a SHA-256 of
-- its canonical form, which binds the statements' own digests and so cannot be tested against
-- guesses without them. The result is the port's answer (state, the report's STORAGE key and
-- SHA-256 or a failure label, the evidence). A row lives 24 hours (IPB-10-07's window); expired rows
-- are deleted by the adapter's store when the key comes again, or by its purge.
set lock_timeout = '5s';
set statement_timeout = '60s';

create table connectors.statement_analysis (
  id             text        primary key check (id ~ '^sta_[0-9A-HJKMNP-TV-Z]{26}$'),
  tenant_id      text        not null,
  adapter        text        not null check (adapter ~ '^[a-z][a-z0-9-]{0,63}$'),
  key_hash       text        check (key_hash ~ '^[0-9a-f]{64}$'),
  request_hash   text        not null check (request_hash ~ '^[0-9a-f]{64}$'),
  report_prefix  text        not null check (report_prefix ~ '^tenant/[a-z]{2,6}_[A-Za-z0-9]+/[a-z][a-z0-9_]*/$'),
  state          text        not null check (state in ('requested', 'pending', 'completed', 'failed')),
  vendor_ref     text        check (char_length(vendor_ref) between 1 and 200),
  result         jsonb       check (result is null or jsonb_typeof(result) = 'object'),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  expires_at     timestamptz not null,
  constraint statement_analysis_prefix_in_tenant check (split_part(report_prefix, '/', 2) = tenant_id),
  constraint statement_analysis_result_when_answered check ((state = 'requested') = (result is null)),
  constraint statement_analysis_vendor_ref_when_answered check ((state = 'requested') = (vendor_ref is null))
);
comment on column connectors.statement_analysis.id is 'dataclass:INTERNAL';
comment on column connectors.statement_analysis.tenant_id is 'dataclass:INTERNAL';
comment on column connectors.statement_analysis.adapter is 'dataclass:INTERNAL';
comment on column connectors.statement_analysis.key_hash is 'dataclass:INTERNAL';
comment on column connectors.statement_analysis.request_hash is 'dataclass:INTERNAL';
comment on column connectors.statement_analysis.report_prefix is 'dataclass:INTERNAL';
comment on column connectors.statement_analysis.state is 'dataclass:INTERNAL';
comment on column connectors.statement_analysis.vendor_ref is 'dataclass:CONFIDENTIAL';
comment on column connectors.statement_analysis.result is 'dataclass:REGULATED';
comment on column connectors.statement_analysis.created_at is 'dataclass:INTERNAL';
comment on column connectors.statement_analysis.updated_at is 'dataclass:INTERNAL';
comment on column connectors.statement_analysis.expires_at is 'dataclass:INTERNAL';
-- One analysis per key, per tenant and adapter; unkeyed analyses have no key.
create unique index statement_analysis_one_per_key on connectors.statement_analysis (tenant_id, adapter, key_hash)
  where key_hash is not null;
create index statement_analysis_expiry_idx on connectors.statement_analysis (tenant_id, expires_at);

-- A row keeps its binding; its state moves forward only (requested to any answer, pending to pending,
-- completed or failed; completed and failed are final), and its vendor reference, once set, stays.
create function connectors.statement_analysis_guard() returns trigger
  language plpgsql
  set search_path = pg_catalog, pg_temp
as $$
begin
  if new.id <> old.id or new.tenant_id <> old.tenant_id or new.adapter <> old.adapter
    or new.key_hash is distinct from old.key_hash or new.request_hash <> old.request_hash
    or new.report_prefix <> old.report_prefix or new.created_at <> old.created_at
    or new.expires_at <> old.expires_at then
    raise exception 'a statement analysis record keeps its binding' using errcode = 'P0001';
  end if;
  if old.state in ('completed', 'failed') then
    raise exception 'a % statement analysis record is final', old.state using errcode = 'P0001';
  end if;
  if new.state = 'requested' and old.state <> 'requested' then
    raise exception 'a statement analysis record moves forward only' using errcode = 'P0001';
  end if;
  if old.vendor_ref is not null and new.vendor_ref is distinct from old.vendor_ref then
    raise exception 'a statement analysis keeps its vendor reference' using errcode = 'P0001';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
alter function connectors.statement_analysis_guard() owner to app_migrate;
revoke all on function connectors.statement_analysis_guard() from public;
create trigger statement_analysis_guard before update on connectors.statement_analysis
  for each row execute function connectors.statement_analysis_guard();

alter table connectors.statement_analysis enable row level security;
alter table connectors.statement_analysis force row level security;
create policy statement_analysis_tenant on connectors.statement_analysis for all
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));

grant select, insert, update, delete on connectors.statement_analysis to app_rw;
grant select on connectors.statement_analysis to app_ro;
