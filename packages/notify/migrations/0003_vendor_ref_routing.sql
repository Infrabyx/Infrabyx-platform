-- infrabyx:no-transaction
-- @infrabyx/notify 0003: delivery reports routed by vendor reference (LawDocsComply PR-LDC-15;
-- R1-D-69). A vendor webhook carries no tenant, so the dispatcher's service reader
-- (svc_notify_dispatch) finds the tenant by (channel, adapter, vendor_ref): it may now select
-- those three columns, still never an address or content, and RLS still applies. The index is
-- cross-tenant and built concurrently on the existing table (PR-UDF-031). Expand-only. If a run
-- fails part-way, drop an invalid index with DROP INDEX CONCURRENTLY IF EXISTS before re-running.
set lock_timeout = '5s';
set statement_timeout = '3600s';
grant select (channel, adapter, vendor_ref) on notify.delivery to svc_notify_dispatch;
create index concurrently if not exists delivery_vendor_route_idx
  on notify.delivery (channel, adapter, vendor_ref) where vendor_ref is not null;
