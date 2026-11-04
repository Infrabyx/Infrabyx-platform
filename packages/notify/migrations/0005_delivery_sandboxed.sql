-- @infrabyx/notify 0005: the `sandboxed` delivery state (LawDocsComply PR-LDC-29; R1-plan M60;
-- R1-D-87). Expand-only: in a sandbox tenant (`tenancy.tenant.sandbox`, read by the kernel into
-- `tx.ctx.sandbox`) a delivery that would leave the platform is recorded and ledgered as
-- `sandboxed` and never handed to an adapter. The check is widened (every existing value still
-- passes) and validated without blocking writes.
set lock_timeout = '5s';
set statement_timeout = '600s';

alter table notify.delivery drop constraint delivery_state_check;
alter table notify.delivery add constraint delivery_state_check
  check (state in ('queued', 'sent', 'delivered', 'failed', 'held', 'suppressed', 'killed', 'digested',
                   'expired', 'sandboxed')) not valid;
alter table notify.delivery validate constraint delivery_state_check;
