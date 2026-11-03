-- infrabyx:no-transaction
-- @infrabyx/audit 0007: the lane position of every laned entry is unique (Finbyx PR-FBX-32;
-- ADR-0005; R1-D-58), and the anchor finds each lane's head by it. Built concurrently on the
-- existing tables (PR-UDF-031). If a run fails part-way, drop an invalid index with DROP INDEX
-- CONCURRENTLY IF EXISTS before re-running.
set lock_timeout = '5s';
set statement_timeout = '3600s';
create unique index concurrently if not exists ledger_lane_seq_idx
  on audit.ledger (tenant_id, lane, lane_seq) where lane is not null;
create unique index concurrently if not exists capture_lane_seq_idx
  on audit.capture (tenant_id, lane, lane_seq) where lane is not null;
