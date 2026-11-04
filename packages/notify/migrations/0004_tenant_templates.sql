-- @infrabyx/notify 0004: tenant notification templates (LawDocsComply PR-LDC-27; R1-plan M58;
-- R1-D-90). Expand-only. One row per version of a tenant's template for (class, channel, locale):
-- `proposed` when a maker raises the change, `active` once the `notify.template.change` approval
-- executes (the executor supersedes the previous active version in the same transaction, with its
-- ledger entry), `superseded` afterwards; rows are never deleted, so the table is the history.
-- An `override` holds either the email subject, plain-text and optional HTML parts (linted by
-- `@infrabyx/notify`, with `{{var}}` placeholders) or the registered SMS DLT template or approved
-- WhatsApp template the tenant selected (never free text); a `revert` returns the key to the
-- catalogue template. Tenant-owned under forced RLS. NOTIFY resolves the active version at every
-- delivery in the delivering tenant's own context (`dispatchDue` included, as the SVC_NOTIFY
-- service principal under app_rw), so the dispatcher's cross-tenant reader svc_notify_dispatch
-- needs, and gets, no grant on it.
set lock_timeout = '5s';
set statement_timeout = '60s';

create table notify.tenant_template (
  id               text        primary key check (id ~ '^ntt_[0-9A-HJKMNP-TV-Z]{26}$'),
  tenant_id        text        not null,
  class_id         text        not null check (class_id ~ '^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$'),
  channel          text        not null check (channel in ('email', 'sms', 'whatsapp')),
  locale           text        not null check (locale ~ '^[a-z]{2,3}(-[A-Z]{2})?$'),
  version          integer     not null check (version >= 1),
  state            text        not null check (state in ('proposed', 'active', 'superseded')),
  kind             text        not null check (kind in ('override', 'revert')),
  base_version     integer     check (base_version >= 1),
  subject          text        check (length(subject) between 1 and 150),
  body_text        text        check (length(body_text) between 1 and 20000),
  body_html        text        check (length(body_html) between 1 and 100000),
  dlt_template_id  text        check (dlt_template_id ~ '^[0-9]{10,30}$'),
  sender_id        text        check (sender_id ~ '^[A-Z]{6}$'),
  dlt_entity_id    text        check (dlt_entity_id ~ '^[0-9]{19}$'),
  wa_name          text        check (wa_name ~ '^[a-z0-9_]{1,512}$'),
  wa_lang          text        check (wa_lang ~ '^[a-z]{2,3}(_[A-Z]{2})?$'),
  vars             jsonb,
  content_digest   text        not null check (content_digest ~ '^[0-9a-f]{64}$'),
  approval_id      text,
  proposed_by      text        not null,
  proposed_at      timestamptz not null default now(),
  activated_by     text,
  activated_at     timestamptz,
  superseded_at    timestamptz,
  constraint tenant_template_version unique (tenant_id, class_id, channel, locale, version),
  -- An override carries exactly its channel's fields; a revert carries none.
  constraint tenant_template_shape check (
    (kind = 'revert' and subject is null and body_text is null and body_html is null
      and dlt_template_id is null and sender_id is null and dlt_entity_id is null
      and wa_name is null and wa_lang is null and vars is null)
    or (kind = 'override' and channel = 'email' and subject is not null and body_text is not null
      and dlt_template_id is null and sender_id is null and dlt_entity_id is null
      and wa_name is null and wa_lang is null and vars is null)
    or (kind = 'override' and channel = 'sms' and dlt_template_id is not null
      and sender_id is not null and dlt_entity_id is not null and subject is null
      and body_text is null and body_html is null and wa_name is null and wa_lang is null)
    or (kind = 'override' and channel = 'whatsapp' and wa_name is not null and wa_lang is not null
      and subject is null and body_text is null and body_html is null and dlt_template_id is null
      and sender_id is null and dlt_entity_id is null)
  ),
  constraint tenant_template_activation check (
    (state = 'proposed' and activated_at is null)
    or (state in ('active', 'superseded') and activated_at is not null and activated_by is not null)
  )
);
comment on column notify.tenant_template.id is 'dataclass:INTERNAL';
comment on column notify.tenant_template.tenant_id is 'dataclass:INTERNAL';
comment on column notify.tenant_template.class_id is 'dataclass:INTERNAL';
comment on column notify.tenant_template.channel is 'dataclass:INTERNAL';
comment on column notify.tenant_template.locale is 'dataclass:INTERNAL';
comment on column notify.tenant_template.version is 'dataclass:INTERNAL';
comment on column notify.tenant_template.state is 'dataclass:INTERNAL';
comment on column notify.tenant_template.kind is 'dataclass:INTERNAL';
comment on column notify.tenant_template.base_version is 'dataclass:INTERNAL';
comment on column notify.tenant_template.subject is 'dataclass:INTERNAL';
comment on column notify.tenant_template.body_text is 'dataclass:INTERNAL';
comment on column notify.tenant_template.body_html is 'dataclass:INTERNAL';
comment on column notify.tenant_template.dlt_template_id is 'dataclass:INTERNAL';
comment on column notify.tenant_template.sender_id is 'dataclass:INTERNAL';
comment on column notify.tenant_template.dlt_entity_id is 'dataclass:INTERNAL';
comment on column notify.tenant_template.wa_name is 'dataclass:INTERNAL';
comment on column notify.tenant_template.wa_lang is 'dataclass:INTERNAL';
comment on column notify.tenant_template.vars is 'dataclass:INTERNAL';
comment on column notify.tenant_template.content_digest is 'dataclass:INTERNAL';
comment on column notify.tenant_template.approval_id is 'dataclass:INTERNAL';
comment on column notify.tenant_template.proposed_by is 'dataclass:INTERNAL';
comment on column notify.tenant_template.proposed_at is 'dataclass:INTERNAL';
comment on column notify.tenant_template.activated_by is 'dataclass:INTERNAL';
comment on column notify.tenant_template.activated_at is 'dataclass:INTERNAL';
comment on column notify.tenant_template.superseded_at is 'dataclass:INTERNAL';
-- At most one active version per key; delivery looks it up by key.
create unique index tenant_template_active_idx
  on notify.tenant_template (tenant_id, class_id, channel, locale) where state = 'active';
create index tenant_template_approval_idx on notify.tenant_template (approval_id)
  where approval_id is not null;
alter table notify.tenant_template enable row level security;
alter table notify.tenant_template force row level security;
create policy tenant_template_tenant on notify.tenant_template for all
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
grant select, insert, update on notify.tenant_template to app_rw;
grant select on notify.tenant_template to app_ro;
