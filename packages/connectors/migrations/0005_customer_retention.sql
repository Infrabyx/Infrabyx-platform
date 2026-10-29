-- @infrabyx/connectors 0005: retention of customer sign-in state, approved by the owner
-- (OWNER-QUESTIONS #86, R1-D-22, R1-D-23). Expand-only.
-- (1) Rows of the `0004` tables are deleted by the per-tenant retention job (`CustomerSignInRetention`
--     through `TenantSweep`), each deletion ledgered in the same transaction: a challenge 24 hours
--     after it expired, a guard row once its lockout window has ended, a device 12 months after its
--     last use. Each period is a setting (`int.identity.customer.retention.*`).
-- (2) A device is also deleted at once when the customer unbinds it or closes the account; it is
--     signed out (revoked) first, in the same flow.
-- (3) The floors are enforced by PostgreSQL, not only by the job: restrictive policies let a delete
--     reach only a challenge expired at least an hour ago, a guard row neither locked nor inside its
--     shortest send window, and a device that is revoked or unused for at least 30 days, whatever
--     the caller. Sign-in events stay in the audit ledger under its own rules.
set lock_timeout = '5s';
set statement_timeout = '60s';

grant delete on connectors.customer_otp_challenge to app_rw;
create policy customer_otp_challenge_delete_retention on connectors.customer_otp_challenge
  as restrictive for delete
  using (expires_at < now() - interval '1 hour');

grant delete on connectors.customer_otp_guard to app_rw;
create policy customer_otp_guard_delete_retention on connectors.customer_otp_guard
  as restrictive for delete
  using (
    (locked_until is null or locked_until < now())
    and window_start < now() - interval '600 seconds'
  );

grant delete on connectors.customer_device to app_rw;
create policy customer_device_delete_retention on connectors.customer_device
  as restrictive for delete
  using (revoked_at is not null or last_used_at < now() - interval '30 days');
