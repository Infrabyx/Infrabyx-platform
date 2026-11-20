-- @infrabyx/connectors 0015: the verified email of a customer account (Udofin PR-UDF-055, R1-D-224;
-- threat model §3.153). Expand-only. One row per account: the address the customer proved with a
-- one-time code sent through NOTIFY, and when. Written through the kernel by the customer store
-- (`identity.customer.email.verify`, ledgered without the address), under forced RLS by tenant;
-- a new proof replaces the row. No delete grant: removing an address is a retention decision
-- (owner question #161 (3)).
set lock_timeout = '5s';
set statement_timeout = '60s';

create table connectors.customer_verified_email (
  tenant_id    text        not null,
  user_id      text        not null check (length(user_id) between 1 and 200),
  email        text        not null check (length(email) between 3 and 254 and email = lower(email) and position('@' in email) > 1),
  verified_at  timestamptz not null,
  updated_at   timestamptz not null default now(),
  primary key (tenant_id, user_id)
);
comment on column connectors.customer_verified_email.tenant_id is 'dataclass:INTERNAL';
comment on column connectors.customer_verified_email.user_id is 'dataclass:CONFIDENTIAL';
comment on column connectors.customer_verified_email.email is 'dataclass:CONFIDENTIAL';
comment on column connectors.customer_verified_email.verified_at is 'dataclass:INTERNAL';
comment on column connectors.customer_verified_email.updated_at is 'dataclass:INTERNAL';

alter table connectors.customer_verified_email enable row level security;
alter table connectors.customer_verified_email force row level security;
create policy customer_verified_email_tenant on connectors.customer_verified_email for all
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));

grant select, insert, update on connectors.customer_verified_email to app_rw;
grant select on connectors.customer_verified_email to app_ro;
