-- @infrabyx/audit 0009: register audit.outbox for the outbox relay (LawDocsComply PR-LDC-35, R1-D-112).
-- audit.outbox was created without `tenancy.register_outbox('audit')`, so SVC_OUTBOX_RELAY could neither
-- find nor mark its rows and the module's events never left the table. register_outbox (tenancy/0003)
-- grants the relay select of the relayed columns, update of dispatched_at and attempts, and the
-- platform-scope discovery policy on this one table; it is idempotent. Expand-only: grants and one
-- policy, no rewrite.
set lock_timeout = '5s';
set statement_timeout = '60s';

select tenancy.register_outbox('audit');
