-- reference 0002: register the hello module's outbox for the platform outbox relay
-- (SVC_OUTBOX_RELAY, owner answer #74(e), R1-D-01; @infrabyx/tenancy 0003). The relay's role gets
-- select of the relayed columns and update of dispatched_at and attempts on hello.outbox only.
-- Expand-only.

set lock_timeout = '5s';
set statement_timeout = '60s';

select tenancy.register_outbox('hello');
