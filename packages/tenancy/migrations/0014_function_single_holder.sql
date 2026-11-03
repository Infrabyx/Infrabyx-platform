-- infrabyx:no-transaction
-- @infrabyx/tenancy 0014: one active holder of a single-holder function per tenant and legal
-- entity (Finbyx PR-FBX-31; R1-D-46). Built concurrently on the existing table (PR-UDF-031). If a
-- run fails part-way, drop an invalid index with DROP INDEX CONCURRENTLY IF EXISTS before re-running.
set lock_timeout = '5s';
set statement_timeout = '600s';
create unique index concurrently if not exists function_assignment_single_idx
  on tenancy.function_assignment (tenant_id, function, coalesce(entity_ref, ''))
  where revoked_at is null and single_holder;
