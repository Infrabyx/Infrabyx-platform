-- @infrabyx/connectors 0017: the step-up of a customer device session (Udofin PR-UDF-056,
-- R1-D-244; threat model §3.168). Expand-only: two nullable columns on `connectors.customer_device`;
-- no row, grant or policy is changed.
--   step_up_at   when the borrower last proved the account's login again on this device session
--                with a fresh one-time code (the session's `auth_time` from then on);
--   step_up_acr  the assurance of that step-up (`otp`, a one-time code to the registered login).
-- Written by the customer store in a kernel transaction whose action is
-- `identity.customer.device.step_up`, ledgered with the device id, the level and the time (no
-- login, no code); only an unrevoked device is updated. The columns go with the device row
-- (unbinding, account closure, the 12-month retention of `connectors/0005`).
set lock_timeout = '5s';
set statement_timeout = '60s';

alter table connectors.customer_device add column step_up_at timestamptz;
alter table connectors.customer_device add column step_up_acr text check (step_up_acr in ('otp'));
comment on column connectors.customer_device.step_up_at is 'dataclass:INTERNAL';
comment on column connectors.customer_device.step_up_acr is 'dataclass:INTERNAL';
