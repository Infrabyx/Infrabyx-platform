-- @infrabyx/notify 0001: notifications, deliveries, in-app messages, the platform suppression list,
-- marketing consent, push device tokens and unsubscribe tokens (PL3 plan §6.8, PL3-D-20).
-- Expand-only. Requires the roles created by @infrabyx/tenancy 0001. Every write goes through the
-- kernel with an audit ledger entry. Addresses are never stored: suppression and consent are keyed
-- by the C-23 hash (PL3-D-05); device tokens are sealed with FieldCrypto.
set lock_timeout = '5s';
set statement_timeout = '60s';

create schema if not exists notify;
revoke all on schema notify from public;
grant usage on schema notify to app_rw, app_ro;

create table notify.notification (
  id               text        primary key check (id ~ '^ntf_[0-9A-HJKMNP-TV-Z]{26}$'),
  tenant_id        text        not null,
  class_id         text        not null check (class_id ~ '^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$'),
  idempotency_key  text        not null check (length(idempotency_key) between 8 and 200),
  deep_link        text        not null,
  vars             jsonb       not null default '{}'::jsonb,
  locale           text,
  created_by       text        not null,
  created_at       timestamptz not null default now(),
  constraint notification_idempotency unique (tenant_id, idempotency_key)
);
comment on column notify.notification.id is 'dataclass:INTERNAL';
comment on column notify.notification.tenant_id is 'dataclass:INTERNAL';
comment on column notify.notification.class_id is 'dataclass:INTERNAL';
comment on column notify.notification.idempotency_key is 'dataclass:INTERNAL';
comment on column notify.notification.deep_link is 'dataclass:INTERNAL';
comment on column notify.notification.vars is 'dataclass:INTERNAL';
comment on column notify.notification.locale is 'dataclass:INTERNAL';
comment on column notify.notification.created_by is 'dataclass:INTERNAL';
comment on column notify.notification.created_at is 'dataclass:INTERNAL';
alter table notify.notification enable row level security;
alter table notify.notification force row level security;
create policy notification_tenant on notify.notification for all
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
grant select, insert on notify.notification to app_rw;
grant select on notify.notification to app_ro;

-- One row per (notification, recipient, channel). `send_after` defers a send past quiet hours or
-- to the digest time. The dispatcher reads due rows across tenants in a read-only platform context.
create table notify.delivery (
  id               text        primary key check (id ~ '^dlv_[0-9A-HJKMNP-TV-Z]{26}$'),
  tenant_id        text        not null,
  notification_id  text        not null references notify.notification (id),
  recipient_ref    text        not null,
  channel          text        not null check (channel in ('inapp', 'email', 'sms', 'whatsapp', 'push')),
  state            text        not null check (state in ('queued', 'sent', 'delivered', 'failed', 'held', 'suppressed', 'killed', 'digested', 'expired')),
  resend_class     text        not null default 'hold' check (resend_class in ('safe', 'hold')),
  attempt          integer     not null default 1 check (attempt between 1 and 3),
  send_after       timestamptz not null default now(),
  adapter          text,
  vendor_ref       text,
  last_error_code  text,
  inbox_item_id    text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint delivery_one_per_channel unique (notification_id, recipient_ref, channel)
);
comment on column notify.delivery.id is 'dataclass:INTERNAL';
comment on column notify.delivery.tenant_id is 'dataclass:INTERNAL';
comment on column notify.delivery.notification_id is 'dataclass:INTERNAL';
comment on column notify.delivery.recipient_ref is 'dataclass:INTERNAL';
comment on column notify.delivery.channel is 'dataclass:INTERNAL';
comment on column notify.delivery.state is 'dataclass:INTERNAL';
comment on column notify.delivery.resend_class is 'dataclass:INTERNAL';
comment on column notify.delivery.attempt is 'dataclass:INTERNAL';
comment on column notify.delivery.send_after is 'dataclass:INTERNAL';
comment on column notify.delivery.adapter is 'dataclass:INTERNAL';
comment on column notify.delivery.vendor_ref is 'dataclass:INTERNAL';
comment on column notify.delivery.last_error_code is 'dataclass:INTERNAL';
comment on column notify.delivery.inbox_item_id is 'dataclass:INTERNAL';
comment on column notify.delivery.created_at is 'dataclass:INTERNAL';
comment on column notify.delivery.updated_at is 'dataclass:INTERNAL';
create index delivery_due_idx on notify.delivery (send_after) where state in ('queued', 'digested');
create index delivery_vendor_idx on notify.delivery (tenant_id, channel, vendor_ref) where vendor_ref is not null;
create index delivery_notification_idx on notify.delivery (notification_id);
alter table notify.delivery enable row level security;
alter table notify.delivery force row level security;
create policy delivery_read on notify.delivery for select
  using (tenant_id = current_setting('app.tenant_id', true) or current_setting('app.scope', true) = 'platform');
create policy delivery_insert on notify.delivery for insert
  with check (tenant_id = current_setting('app.tenant_id', true));
create policy delivery_update on notify.delivery for update
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
grant select, insert, update on notify.delivery to app_rw;
grant select on notify.delivery to app_ro;

-- In-app messages (read by the PL5 shell). Title INTERNAL; the body is fetched by deep link.
create table notify.inapp_message (
  id               text        primary key check (id ~ '^inm_[0-9A-HJKMNP-TV-Z]{26}$'),
  tenant_id        text        not null,
  user_ref         text        not null,
  notification_id  text        not null references notify.notification (id),
  class_id         text        not null,
  title            text        not null check (length(title) between 1 and 200),
  deep_link        text        not null,
  digest           boolean     not null default false,
  created_at       timestamptz not null default now(),
  read_at          timestamptz
);
comment on column notify.inapp_message.id is 'dataclass:INTERNAL';
comment on column notify.inapp_message.tenant_id is 'dataclass:INTERNAL';
comment on column notify.inapp_message.user_ref is 'dataclass:INTERNAL';
comment on column notify.inapp_message.notification_id is 'dataclass:INTERNAL';
comment on column notify.inapp_message.class_id is 'dataclass:INTERNAL';
comment on column notify.inapp_message.title is 'dataclass:INTERNAL';
comment on column notify.inapp_message.deep_link is 'dataclass:INTERNAL';
comment on column notify.inapp_message.digest is 'dataclass:INTERNAL';
comment on column notify.inapp_message.created_at is 'dataclass:INTERNAL';
comment on column notify.inapp_message.read_at is 'dataclass:INTERNAL';
create index inapp_message_user_idx on notify.inapp_message (tenant_id, user_ref, created_at);
alter table notify.inapp_message enable row level security;
alter table notify.inapp_message force row level security;
create policy inapp_message_tenant on notify.inapp_message for all
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
grant select, insert, update on notify.inapp_message to app_rw;
grant select on notify.inapp_message to app_ro;

-- The platform suppression list, the single source of truth (PL2-D-65). Platform rows
-- (tenant_id 'tnt_platform') hold address facts: hard bounces, complaints, invalid numbers. They
-- are readable by every tenant, may be added from any tenant's delivery reports, and are lifted only
-- in a platform context. Tenant rows hold that tenant's opt-outs and manual entries.
create table notify.suppression (
  id                text        primary key check (id ~ '^sup_[0-9A-HJKMNP-TV-Z]{26}$'),
  tenant_id         text        not null,
  channel           text        not null check (channel in ('email', 'sms', 'whatsapp', 'push')),
  address_hash      text        not null check (address_hash ~ '^[0-9a-f]{64}$'),
  reason            text        not null check (reason in ('hard_bounce', 'complaint', 'unsubscribe', 'stop', 'manual', 'invalid')),
  class_scope       text        not null check (class_scope in ('all', 'marketing')),
  source            text        not null check (length(source) between 1 and 80),
  created_at        timestamptz not null default now(),
  lifted_at         timestamptz,
  lift_approval_id  text,
  constraint suppression_platform_reasons check (
    tenant_id <> 'tnt_platform' or reason in ('hard_bounce', 'complaint', 'invalid')
  )
);
comment on column notify.suppression.id is 'dataclass:INTERNAL';
comment on column notify.suppression.tenant_id is 'dataclass:INTERNAL';
comment on column notify.suppression.channel is 'dataclass:INTERNAL';
comment on column notify.suppression.address_hash is 'dataclass:CONFIDENTIAL';
comment on column notify.suppression.reason is 'dataclass:INTERNAL';
comment on column notify.suppression.class_scope is 'dataclass:INTERNAL';
comment on column notify.suppression.source is 'dataclass:INTERNAL';
comment on column notify.suppression.created_at is 'dataclass:INTERNAL';
comment on column notify.suppression.lifted_at is 'dataclass:INTERNAL';
comment on column notify.suppression.lift_approval_id is 'dataclass:INTERNAL';
create unique index suppression_active on notify.suppression (tenant_id, channel, address_hash, class_scope)
  where lifted_at is null;
alter table notify.suppression enable row level security;
alter table notify.suppression force row level security;
create policy suppression_read on notify.suppression for select
  using (tenant_id = current_setting('app.tenant_id', true) or tenant_id = 'tnt_platform');
create policy suppression_insert on notify.suppression for insert
  with check (tenant_id = current_setting('app.tenant_id', true) or tenant_id = 'tnt_platform');
create policy suppression_update on notify.suppression for update
  using (
    (tenant_id = current_setting('app.tenant_id', true) and tenant_id <> 'tnt_platform')
    or (tenant_id = 'tnt_platform' and current_setting('app.scope', true) = 'platform')
  )
  with check (
    (tenant_id = current_setting('app.tenant_id', true) and tenant_id <> 'tnt_platform')
    or (tenant_id = 'tnt_platform' and current_setting('app.scope', true) = 'platform')
  );
grant select, insert, update on notify.suppression to app_rw;
grant select on notify.suppression to app_ro;

-- Marketing consent before the CONSENT port (Ecosystem §6.39): default deny.
create table notify.marketing_consent (
  tenant_id       text        not null,
  principal_hash  text        not null check (principal_hash ~ '^[0-9a-f]{64}$'),
  purpose         text        not null check (purpose in ('MARKETING_EMAIL', 'MARKETING_SMS', 'MARKETING_WHATSAPP', 'ANALYTICS', 'PERSONALISATION')),
  brand_pack_id   text        not null default '',
  state           text        not null check (state in ('GRANTED', 'WITHDRAWN')),
  consentref      text,
  notice_version  text,
  updated_at      timestamptz not null default now(),
  primary key (tenant_id, principal_hash, purpose, brand_pack_id)
);
comment on column notify.marketing_consent.tenant_id is 'dataclass:INTERNAL';
comment on column notify.marketing_consent.principal_hash is 'dataclass:CONFIDENTIAL';
comment on column notify.marketing_consent.purpose is 'dataclass:INTERNAL';
comment on column notify.marketing_consent.brand_pack_id is 'dataclass:INTERNAL';
comment on column notify.marketing_consent.state is 'dataclass:INTERNAL';
comment on column notify.marketing_consent.consentref is 'dataclass:INTERNAL';
comment on column notify.marketing_consent.notice_version is 'dataclass:INTERNAL';
comment on column notify.marketing_consent.updated_at is 'dataclass:INTERNAL';
alter table notify.marketing_consent enable row level security;
alter table notify.marketing_consent force row level security;
create policy marketing_consent_tenant on notify.marketing_consent for all
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
grant select, insert, update on notify.marketing_consent to app_rw;
grant select on notify.marketing_consent to app_ro;

-- Push device tokens, sealed; `token_digest` finds a token again without decrypting.
create table notify.device_token (
  id            text        primary key check (id ~ '^ptk_[0-9A-HJKMNP-TV-Z]{26}$'),
  tenant_id     text        not null,
  user_ref      text        not null,
  provider      text        not null check (provider ~ '^[a-z][a-z0-9-]*$'),
  platform      text        not null check (platform in ('ios', 'android', 'web')),
  token_enc     bytea       not null,
  token_key_id  text        not null,
  token_digest  text        not null check (token_digest ~ '^[0-9a-f]{64}$'),
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  constraint device_token_unique unique (tenant_id, provider, token_digest)
);
comment on column notify.device_token.id is 'dataclass:INTERNAL';
comment on column notify.device_token.tenant_id is 'dataclass:INTERNAL';
comment on column notify.device_token.user_ref is 'dataclass:INTERNAL';
comment on column notify.device_token.provider is 'dataclass:INTERNAL';
comment on column notify.device_token.platform is 'dataclass:INTERNAL';
comment on column notify.device_token.token_enc is 'dataclass:CONFIDENTIAL';
comment on column notify.device_token.token_key_id is 'dataclass:INTERNAL';
comment on column notify.device_token.token_digest is 'dataclass:INTERNAL';
comment on column notify.device_token.created_at is 'dataclass:INTERNAL';
comment on column notify.device_token.last_seen_at is 'dataclass:INTERNAL';
create index device_token_user_idx on notify.device_token (tenant_id, user_ref, provider);
alter table notify.device_token enable row level security;
alter table notify.device_token force row level security;
create policy device_token_tenant on notify.device_token for all
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
grant select, insert, update, delete on notify.device_token to app_rw;
grant select on notify.device_token to app_ro;

-- One-click unsubscribe tokens (PL3-D-06): random, one-time, revocable, 90 days. Only the SHA-256
-- of the token is stored; the unauthenticated link finds it in a read-only platform context. The
-- recipient reference (never an address) lets NOTIFY resolve the address when the link is used.
create table notify.unsubscribe_token (
  token_hash      text        primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  tenant_id       text        not null,
  recipient_ref   text        not null,
  channel         text        not null check (channel in ('email', 'sms', 'whatsapp')),
  purpose         text        not null,
  brand_pack_id   text        not null default '',
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null,
  used_at         timestamptz,
  revoked_at      timestamptz
);
comment on column notify.unsubscribe_token.token_hash is 'dataclass:INTERNAL';
comment on column notify.unsubscribe_token.tenant_id is 'dataclass:INTERNAL';
comment on column notify.unsubscribe_token.recipient_ref is 'dataclass:INTERNAL';
comment on column notify.unsubscribe_token.channel is 'dataclass:INTERNAL';
comment on column notify.unsubscribe_token.purpose is 'dataclass:INTERNAL';
comment on column notify.unsubscribe_token.brand_pack_id is 'dataclass:INTERNAL';
comment on column notify.unsubscribe_token.created_at is 'dataclass:INTERNAL';
comment on column notify.unsubscribe_token.expires_at is 'dataclass:INTERNAL';
comment on column notify.unsubscribe_token.used_at is 'dataclass:INTERNAL';
comment on column notify.unsubscribe_token.revoked_at is 'dataclass:INTERNAL';
alter table notify.unsubscribe_token enable row level security;
alter table notify.unsubscribe_token force row level security;
create policy unsubscribe_token_read on notify.unsubscribe_token for select
  using (tenant_id = current_setting('app.tenant_id', true) or current_setting('app.scope', true) = 'platform');
create policy unsubscribe_token_write on notify.unsubscribe_token for insert
  with check (tenant_id = current_setting('app.tenant_id', true));
create policy unsubscribe_token_update on notify.unsubscribe_token for update
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
grant select, insert, update on notify.unsubscribe_token to app_rw;
grant select on notify.unsubscribe_token to app_ro;

-- Transactional outbox and consumer inbox (IPB-01 §01.4.3.3).
create table notify.outbox (
  id             text        primary key,
  tenant_id      text        not null,
  type           text        not null,
  envelope       jsonb       not null,
  created_at     timestamptz not null default now(),
  dispatched_at  timestamptz,
  attempts       integer     not null default 0
);
comment on column notify.outbox.id is 'dataclass:INTERNAL';
comment on column notify.outbox.tenant_id is 'dataclass:INTERNAL';
comment on column notify.outbox.type is 'dataclass:INTERNAL';
comment on column notify.outbox.envelope is 'dataclass:CONFIDENTIAL';
comment on column notify.outbox.created_at is 'dataclass:INTERNAL';
comment on column notify.outbox.dispatched_at is 'dataclass:INTERNAL';
comment on column notify.outbox.attempts is 'dataclass:INTERNAL';
create index outbox_pending_idx on notify.outbox (created_at) where dispatched_at is null;
alter table notify.outbox enable row level security;
alter table notify.outbox force row level security;
create policy outbox_tenant on notify.outbox for all
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
grant select, insert, update on notify.outbox to app_rw;
grant select on notify.outbox to app_ro;

create table notify.inbox (
  consumer      text        not null,
  event_id      text        not null,
  tenant_id     text        not null,
  processed_at  timestamptz not null default now(),
  primary key (consumer, event_id)
);
comment on column notify.inbox.consumer is 'dataclass:INTERNAL';
comment on column notify.inbox.event_id is 'dataclass:INTERNAL';
comment on column notify.inbox.tenant_id is 'dataclass:INTERNAL';
comment on column notify.inbox.processed_at is 'dataclass:INTERNAL';
alter table notify.inbox enable row level security;
alter table notify.inbox force row level security;
create policy inbox_tenant on notify.inbox for all
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
grant select, insert on notify.inbox to app_rw;
grant select on notify.inbox to app_ro;
