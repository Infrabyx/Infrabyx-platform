-- @infrabyx/notify 0007: inbound email replies (LawDocsComply PR-LDC-50; R1-D-177; plan
-- docs/phases/R1-inbound-mail-plan.md §5; threat model §3.123). Expand-only: one nullable column
-- and new tables, roles and grants; nothing is rewritten.
--   * notify.notification.reply_thread_ref: the thread a notification invites replies to.
--   * notify.reply_token: a reply address's token, stored only as its SHA-256, bound to one thread,
--     recipient and address hash (C-23), with an expiry and a use limit.
--   * svc_notify_reply: the service reader that finds a token's tenant by its hash (the inbound
--     route runs before any tenant is known), granted (token_hash, tenant_id) only; every read is
--     ledgered per tenant by ServiceReader (OWNER-QUESTIONS #22, PL3-D-21).
--   * notify.reply: one row per accepted reply; immutable; one per (tenant, adapter, vendor id).
--   * notify.reply_drop_daily: the first drop of a day per sender hash and reason, written with its
--     ledger entry; later ones that day write nothing (they are counted in metrics only). No body
--     is ever stored.
set lock_timeout = '5s';
set statement_timeout = '60s';

alter table notify.notification add column if not exists reply_thread_ref text
  check (reply_thread_ref is null or reply_thread_ref ~ '^[\x21-\x7e]{1,120}$');
comment on column notify.notification.reply_thread_ref is 'dataclass:INTERNAL';

create table notify.reply_token (
  token_hash     text        primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  tenant_id      text        not null,
  thread_ref     text        not null check (thread_ref ~ '^[\x21-\x7e]{1,120}$'),
  recipient_ref  text        not null check (length(recipient_ref) between 3 and 120),
  address_hash   text        not null check (address_hash ~ '^[0-9a-f]{64}$'),
  delivery_id    text        not null references notify.delivery (id),
  expires_at     timestamptz not null,
  uses           integer     not null default 0 check (uses >= 0),
  max_uses       integer     not null default 50 check (max_uses between 1 and 50),
  created_at     timestamptz not null default now(),
  constraint reply_token_uses check (uses <= max_uses)
);
comment on column notify.reply_token.token_hash is 'dataclass:INTERNAL';
comment on column notify.reply_token.tenant_id is 'dataclass:INTERNAL';
comment on column notify.reply_token.thread_ref is 'dataclass:INTERNAL';
comment on column notify.reply_token.recipient_ref is 'dataclass:INTERNAL';
comment on column notify.reply_token.address_hash is 'dataclass:INTERNAL';
comment on column notify.reply_token.delivery_id is 'dataclass:INTERNAL';
comment on column notify.reply_token.expires_at is 'dataclass:INTERNAL';
comment on column notify.reply_token.uses is 'dataclass:INTERNAL';
comment on column notify.reply_token.max_uses is 'dataclass:INTERNAL';
comment on column notify.reply_token.created_at is 'dataclass:INTERNAL';
create index reply_token_tenant_idx on notify.reply_token (tenant_id, thread_ref);
alter table notify.reply_token enable row level security;
alter table notify.reply_token force row level security;
create policy reply_token_read on notify.reply_token for select
  using (tenant_id = current_setting('app.tenant_id', true) or current_setting('app.scope', true) = 'platform');
create policy reply_token_insert on notify.reply_token for insert
  with check (tenant_id = current_setting('app.tenant_id', true));
create policy reply_token_update on notify.reply_token for update
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
grant select, insert on notify.reply_token to app_rw;
grant update (uses) on notify.reply_token to app_rw;
grant select on notify.reply_token to app_ro;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'svc_notify_reply') then
    create role svc_notify_reply nologin nosuperuser nobypassrls nocreatedb nocreaterole;
  end if;
end
$$;
grant usage on schema notify to svc_notify_reply;
grant select (token_hash, tenant_id) on notify.reply_token to svc_notify_reply;
grant svc_notify_reply to app_rw, app_ro;

create table notify.reply (
  id                 text        primary key check (id ~ '^rpl_[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  tenant_id          text        not null,
  token_hash         text        not null references notify.reply_token (token_hash),
  thread_ref         text        not null,
  recipient_ref      text        not null,
  sender_hash        text        not null check (sender_hash ~ '^[0-9a-f]{64}$'),
  adapter            text        not null check (adapter ~ '^[a-z][a-z0-9-]{1,40}$'),
  vendor_message_id  text        not null check (length(vendor_message_id) between 1 and 128),
  text               text        not null check (length(text) <= 20000),
  attachments        jsonb       not null default '[]'::jsonb check (jsonb_typeof(attachments) = 'array'),
  received_at        timestamptz not null,
  created_at         timestamptz not null default now(),
  constraint reply_once unique (tenant_id, adapter, vendor_message_id)
);
comment on column notify.reply.id is 'dataclass:INTERNAL';
comment on column notify.reply.tenant_id is 'dataclass:INTERNAL';
comment on column notify.reply.token_hash is 'dataclass:INTERNAL';
comment on column notify.reply.thread_ref is 'dataclass:INTERNAL';
comment on column notify.reply.recipient_ref is 'dataclass:INTERNAL';
comment on column notify.reply.sender_hash is 'dataclass:INTERNAL';
comment on column notify.reply.adapter is 'dataclass:INTERNAL';
comment on column notify.reply.vendor_message_id is 'dataclass:INTERNAL';
comment on column notify.reply.text is 'dataclass:CONFIDENTIAL';
comment on column notify.reply.attachments is 'dataclass:CONFIDENTIAL';
comment on column notify.reply.received_at is 'dataclass:INTERNAL';
comment on column notify.reply.created_at is 'dataclass:INTERNAL';
create index reply_thread_idx on notify.reply (tenant_id, thread_ref, received_at);
alter table notify.reply enable row level security;
alter table notify.reply force row level security;
create policy reply_tenant on notify.reply for all
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
grant select, insert on notify.reply to app_rw;
grant select on notify.reply to app_ro;

-- An accepted reply is evidence of what was said: it is never changed (no update grant either).
create function notify.reply_immutable() returns trigger language plpgsql as $$
begin
  raise exception 'notify.reply is immutable' using errcode = '42501';
end
$$;
create trigger reply_immutable before update on notify.reply
  for each row execute function notify.reply_immutable();

create table notify.reply_drop_daily (
  tenant_id    text        not null,
  day          date        not null,
  sender_hash  text        not null check (sender_hash ~ '^([0-9a-f]{64}|none)$'),
  reason       text        not null check (reason ~ '^[a-z_]{2,20}$'),
  first_at     timestamptz not null default now(),
  primary key (tenant_id, day, sender_hash, reason)
);
comment on column notify.reply_drop_daily.tenant_id is 'dataclass:INTERNAL';
comment on column notify.reply_drop_daily.day is 'dataclass:INTERNAL';
comment on column notify.reply_drop_daily.sender_hash is 'dataclass:INTERNAL';
comment on column notify.reply_drop_daily.reason is 'dataclass:INTERNAL';
comment on column notify.reply_drop_daily.first_at is 'dataclass:INTERNAL';
alter table notify.reply_drop_daily enable row level security;
alter table notify.reply_drop_daily force row level security;
create policy reply_drop_daily_tenant on notify.reply_drop_daily for all
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
grant select, insert on notify.reply_drop_daily to app_rw;
grant select on notify.reply_drop_daily to app_ro;
