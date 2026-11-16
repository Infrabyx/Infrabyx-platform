-- @infrabyx/tenancy 0022: a cancellation reason on an approval request (LawDocsComply PR-LDC-37,
-- R1-D-120). `ApprovalsEngine.cancelIn(tx, id, reason)` cancels inside the product's transaction and
-- records why. Expand-only: one nullable column (no rewrite) and a length check; the ledger keeps only
-- the digest of the cancellation (state and reason), so the text itself lives on the request alone.
set lock_timeout = '5s';
set statement_timeout = '60s';

alter table tenancy.approval_request
  add column cancel_reason text
  check (cancel_reason is null or char_length(cancel_reason) between 1 and 500);
comment on column tenancy.approval_request.cancel_reason is 'dataclass:CONFIDENTIAL';
