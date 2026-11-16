-- infrabyx:no-transaction
-- @infrabyx/audit 0011: the GIN index for `AuditService.history(ctx, businessId)` (PR-LDC-30,
-- R1-D-125). Built concurrently so ledger writes continue while it builds; partial, so the entries
-- without business ids (every entry before audit/0010) add nothing to it. A failed concurrent build
-- leaves an invalid index and this file unrecorded, so a re-run first drops whatever is there and
-- builds it again (`if not exists` alone would keep the invalid one).
set lock_timeout = '5s';
set statement_timeout = '3600s';
drop index concurrently if exists audit.ledger_business_ids_idx;
create index concurrently ledger_business_ids_idx
  on audit.ledger using gin (business_ids) where business_ids is not null;
