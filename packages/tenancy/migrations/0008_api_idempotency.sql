-- @infrabyx/tenancy 0008: the inbound idempotency store of IPB-10-07 (Finbyx PR-FBX-10 item 4;
-- R1-D-27). Expand-only. IPB-10 §10.4 names the table `api.idempotency_key`; the platform keeps it
-- in the tenancy schema, which owns the request context, as `tenancy.idempotency_key` with the
-- same columns. A product claims a key inside the same transaction as the change it makes, so the
-- key, the request hash and the response commit together or not at all.
--   key            the client's UUIDv7 `Idempotency-Key`, unique per tenant;
--   route          the method and route template the key was first used on;
--   request_hash   SHA-256 of the canonical request (method, route, body);
--   response_*     the status and body the first request returned, replayed for 24 h;
--   expires_at     created_at + `int.api.idempotency_ttl_hours` (24 h at least); expired rows are
--                  deleted by the per-tenant expiry job, and only expired rows can be.
set lock_timeout = '5s';
set statement_timeout = '60s';

create table tenancy.idempotency_key (
  tenant_id        text        not null,
  key              uuid        not null,
  route            text        not null check (length(route) between 1 and 300),
  request_hash     text        not null check (request_hash ~ '^[0-9a-f]{64}$'),
  request_id       text        check (length(request_id) between 1 and 100),
  response_status  integer     not null check (response_status between 100 and 599),
  response_body    jsonb,
  created_at       timestamptz not null default now(),
  expires_at       timestamptz not null,
  primary key (tenant_id, key),
  check (expires_at >= created_at + interval '24 hours')
);
comment on column tenancy.idempotency_key.tenant_id is 'dataclass:INTERNAL';
comment on column tenancy.idempotency_key.key is 'dataclass:INTERNAL';
comment on column tenancy.idempotency_key.route is 'dataclass:INTERNAL';
comment on column tenancy.idempotency_key.request_hash is 'dataclass:INTERNAL';
comment on column tenancy.idempotency_key.request_id is 'dataclass:INTERNAL';
comment on column tenancy.idempotency_key.response_status is 'dataclass:INTERNAL';
comment on column tenancy.idempotency_key.response_body is 'dataclass:REGULATED';
comment on column tenancy.idempotency_key.created_at is 'dataclass:INTERNAL';
comment on column tenancy.idempotency_key.expires_at is 'dataclass:INTERNAL';
create index idempotency_key_expiry_idx on tenancy.idempotency_key (tenant_id, expires_at);

alter table tenancy.idempotency_key enable row level security;
alter table tenancy.idempotency_key force row level security;
create policy idempotency_key_tenant on tenancy.idempotency_key for all
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
create policy idempotency_key_delete_expired on tenancy.idempotency_key
  as restrictive for delete using (expires_at < now());
grant select, insert, delete on tenancy.idempotency_key to app_rw;
