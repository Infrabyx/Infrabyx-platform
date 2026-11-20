-- @infrabyx/connectors 0016: deleting a customer's verified email (owner answer #161 (3), R1-D-233;
-- R1-D-235; threat model §3.159). Expand-only: one grant, one trigger function and one trigger; no
-- row is changed.
-- The row of `connectors/0015` is deleted when the account is closed (`retireLogin`) or on the
-- borrower's erasure request (`eraseVerifiedEmail`), by the customer store, in a kernel transaction
-- whose action is `identity.customer.verified_email.delete` and which ledgers the deletion (reason
-- `account_closed` or `erasure_request`, the account by its hash, never the address).
-- (1) DELETE is granted to app_rw on this table only; app_ro and every other connectors table are
--     unchanged.
-- (2) The forced tenant policy of 0015 (`for all`) scopes the delete to the caller's tenant.
-- (3) Any other delete is refused for every caller: the trigger lets a row go only inside a
--     transaction whose kernel action is the deletion's (set by the kernel, as for the consent #95
--     purge).
set lock_timeout = '5s';
set statement_timeout = '60s';

create function connectors.customer_verified_email_delete_guard() returns trigger
  language plpgsql as $$
begin
  if current_setting('app.action', true) = 'identity.customer.verified_email.delete' then
    return old;
  end if;
  raise exception 'connectors.customer_verified_email is deleted only at account closure or on erasure'
    using errcode = '42501';
end
$$;
create trigger customer_verified_email_delete_guard
  before delete on connectors.customer_verified_email
  for each row execute function connectors.customer_verified_email_delete_guard();

grant delete on connectors.customer_verified_email to app_rw;
