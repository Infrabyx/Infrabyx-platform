-- @infrabyx/tenancy 0024: the shared rate limiter (LawDocsComply PR-LDC-54; R1-D-123, owner
-- answer #129, R1-D-144, R1-D-149). One counter row per tenant, limiter bucket, hashed key and
-- fixed window. Expand-only.
--   bucket        the product's limiter name, e.g. `ldc.public_read` (no data in it);
--   key_hash      HMAC-SHA-256 of the bucket and the caller's key under the tenant's rate-limit
--                 sub-key (PL1-C-05 blind-index keys, R1-D-37): no token, address or personal data;
--   window_start  the start of the fixed window, aligned to the window length;
--   window_end    window_start + the window length (1 second to 1 day);
--   hits          hits counted in the window, capped one above the limit.
-- A hit writes no ledger row (R1-D-123): it runs as `svc_rate_limit`, which may only select,
-- insert and update this table under the tenant's RLS, and never delete. The sweep (owner answer
-- #129, the one named exception to the deletion stop) runs as app_rw through the kernel, writes one
-- ledger entry per run, and the restrictive policy lets it delete only rows whose window has fully
-- expired. No other table gains a delete path.
set lock_timeout = '5s';
set statement_timeout = '60s';

create table tenancy.rate_limit_counter (
  tenant_id     text        not null,
  bucket        text        not null check (bucket ~ '^[a-z][a-z0-9_.:-]{0,63}$'),
  key_hash      text        not null check (key_hash ~ '^[0-9a-f]{64}$'),
  window_start  timestamptz not null,
  window_end    timestamptz not null,
  hits          integer     not null check (hits >= 1),
  primary key (tenant_id, bucket, key_hash, window_start),
  check (window_end > window_start and window_end <= window_start + interval '1 day')
);
comment on table tenancy.rate_limit_counter is
  'Operational rate-limit counters (PR-LDC-54). Only rows whose window has ended may be deleted (owner answer #129).';
comment on column tenancy.rate_limit_counter.tenant_id is 'dataclass:INTERNAL';
comment on column tenancy.rate_limit_counter.bucket is 'dataclass:INTERNAL';
comment on column tenancy.rate_limit_counter.key_hash is 'dataclass:INTERNAL';
comment on column tenancy.rate_limit_counter.window_start is 'dataclass:INTERNAL';
comment on column tenancy.rate_limit_counter.window_end is 'dataclass:INTERNAL';
comment on column tenancy.rate_limit_counter.hits is 'dataclass:INTERNAL';
create index rate_limit_counter_expiry_idx on tenancy.rate_limit_counter (tenant_id, window_end);

alter table tenancy.rate_limit_counter enable row level security;
alter table tenancy.rate_limit_counter force row level security;
create policy rate_limit_counter_tenant on tenancy.rate_limit_counter for all
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
create policy rate_limit_counter_delete_expired on tenancy.rate_limit_counter
  as restrictive for delete using (window_end <= now());

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'svc_rate_limit') then
    create role svc_rate_limit nologin nosuperuser nobypassrls nocreatedb nocreaterole;
  end if;
end
$$;

grant usage on schema tenancy to svc_rate_limit;
grant select, insert, update on tenancy.rate_limit_counter to svc_rate_limit;
grant select, delete on tenancy.rate_limit_counter to app_rw;
grant svc_rate_limit to app_rw with inherit false, set true;
