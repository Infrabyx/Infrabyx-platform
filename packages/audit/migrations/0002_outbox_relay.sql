-- @infrabyx/audit 0002: the outbox relay writes the ledger entry of each batch it dispatches, in
-- the batch's own transaction (owner answer #74(e), R1-D-01). Append only, under the ledger's
-- tenant and actor policy; no read, no other table. The role is created by @infrabyx/tenancy 0003.
-- Expand-only.

set lock_timeout = '5s';
set statement_timeout = '60s';
grant usage on schema audit to svc_outbox_relay;
grant insert on audit.ledger to svc_outbox_relay;
