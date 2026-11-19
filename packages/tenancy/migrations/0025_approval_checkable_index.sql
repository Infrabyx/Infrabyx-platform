-- infrabyx:no-transaction
-- @infrabyx/tenancy 0025: the keyset index for `ApprovalsEngine.listCheckable` (Udofin PR-UDF-047,
-- R1-D-200). A checker's list reads a tenant's pending, unexpired requests in (created_at, id)
-- order; partial, so decided, cancelled, executed and expired requests add nothing to it. Built
-- concurrently on the existing table so requests and decisions continue while it builds.
-- Expand-only: no column, policy or grant changes. If a run fails part-way, drop the invalid index
-- with DROP INDEX CONCURRENTLY IF EXISTS before re-running.
set lock_timeout = '5s';
set statement_timeout = '3600s';
create index concurrently if not exists approval_request_checkable_idx
  on tenancy.approval_request (tenant_id, created_at, id)
  where state = 'pending' and expired_at is null;
