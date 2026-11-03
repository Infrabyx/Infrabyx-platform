-- @infrabyx/tenancy 0015: an idempotency key belongs to the principal that first used it (Udofin
-- PR-UDF-033 (2); IPB-10-07; R1-D-48). Expand-only. Every borrower of a product shares its tenant,
-- so without the principal one who learnt another's key and body would be served the other's
-- stored response. Rows written before this migration have no principal and keep today's check.
set lock_timeout = '5s';
set statement_timeout = '60s';

alter table tenancy.idempotency_key add column principal_id text;
comment on column tenancy.idempotency_key.principal_id is 'dataclass:INTERNAL';
