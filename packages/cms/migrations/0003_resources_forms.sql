-- @infrabyx/cms 0003: resource versions and downloads, and form submissions (IPB-04 §04.3.6,
-- IPB-04-59…61, 04-67; PL5 plan §5.8). Expand-only.
-- (1) A resource version is recorded when a revision of the resource is published with a new
--     `version`; older versions stay downloadable at `?v=` unless withdrawn (IPB-04-61).
-- (2) A download records the resource, version, gating and the CRM lead reference the port
--     returned (OWNER-QUESTIONS #47: a reference, never a hashed lead id) and UTM context.
-- (3) A form submission keeps the id, destination reference, consent receipt and state; field
--     values are never stored, also when the hand-off fails (#47).
set lock_timeout = '5s';
set statement_timeout = '60s';

create table cms.resource_version (
  id               text        primary key check (id ~ '^rsv_[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  tenant_id        text        not null default 'tnt_platform' check (tenant_id = 'tnt_platform'),
  content_item_id  text        not null references cms.content_item (id),
  version          text        not null check (length(version) between 1 and 40),
  revision_id      text        not null references cms.revision (id),
  media_id         text        check (media_id ~ '^med_[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  published_at     timestamptz not null default now(),
  withdrawn_at     timestamptz,
  withdrawn_by     text,
  created_by       text        not null,
  unique (content_item_id, version),
  constraint resource_version_withdrawn_actor check ((withdrawn_at is null) = (withdrawn_by is null))
);
comment on column cms.resource_version.id is 'dataclass:PUBLIC';
comment on column cms.resource_version.tenant_id is 'dataclass:INTERNAL';
comment on column cms.resource_version.content_item_id is 'dataclass:PUBLIC';
comment on column cms.resource_version.version is 'dataclass:PUBLIC';
comment on column cms.resource_version.revision_id is 'dataclass:PUBLIC';
comment on column cms.resource_version.media_id is 'dataclass:INTERNAL';
comment on column cms.resource_version.published_at is 'dataclass:PUBLIC';
comment on column cms.resource_version.withdrawn_at is 'dataclass:PUBLIC';
comment on column cms.resource_version.withdrawn_by is 'dataclass:INTERNAL';
comment on column cms.resource_version.created_by is 'dataclass:INTERNAL';
alter table cms.resource_version enable row level security;
alter table cms.resource_version force row level security;
create policy resource_version_read on cms.resource_version for select
  using (tenant_id = current_setting('app.tenant_id', true) or tenant_id = 'tnt_platform');
create policy resource_version_write on cms.resource_version for all
  using (tenant_id = current_setting('app.tenant_id', true) and current_setting('app.scope', true) = 'platform')
  with check (tenant_id = current_setting('app.tenant_id', true) and current_setting('app.scope', true) = 'platform');
-- Versions go with their resource when the purge removes it (OWNER-QUESTIONS #48).
create policy resource_version_delete_purge on cms.resource_version as restrictive for delete
  using (exists (
    select 1 from cms.content_item i
     where i.id = resource_version.content_item_id
       and i.deleted_at is not null and i.deleted_at < now() - interval '90 days'));
grant select, insert, update, delete on cms.resource_version to app_rw;
grant select on cms.resource_version to app_ro;

create table cms.resource_download (
  id                  text        primary key check (id ~ '^rdl_[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  tenant_id           text        not null default 'tnt_platform' check (tenant_id = 'tnt_platform'),
  content_item_id     text        not null,
  version             text        not null,
  gating              text        not null check (gating in ('public', 'email_gate', 'login', 'plan')),
  lead_ref            text        check (length(lead_ref) <= 120),
  consent_receipt_id  text        check (consent_receipt_id ~ '^cns_'),
  utm                 jsonb       not null default '{}',
  created_at          timestamptz not null default now()
);
comment on column cms.resource_download.id is 'dataclass:INTERNAL';
comment on column cms.resource_download.tenant_id is 'dataclass:INTERNAL';
comment on column cms.resource_download.content_item_id is 'dataclass:INTERNAL';
comment on column cms.resource_download.version is 'dataclass:INTERNAL';
comment on column cms.resource_download.gating is 'dataclass:INTERNAL';
comment on column cms.resource_download.lead_ref is 'dataclass:CONFIDENTIAL';
comment on column cms.resource_download.consent_receipt_id is 'dataclass:CONFIDENTIAL';
comment on column cms.resource_download.utm is 'dataclass:INTERNAL';
comment on column cms.resource_download.created_at is 'dataclass:INTERNAL';
create index resource_download_item_idx on cms.resource_download (content_item_id, created_at);
alter table cms.resource_download enable row level security;
alter table cms.resource_download force row level security;
create policy resource_download_read on cms.resource_download for select
  using (tenant_id = current_setting('app.tenant_id', true) and current_setting('app.scope', true) = 'platform');
create policy resource_download_insert on cms.resource_download for insert
  with check (tenant_id = current_setting('app.tenant_id', true) and current_setting('app.scope', true) = 'platform');
grant select, insert on cms.resource_download to app_rw;

create table cms.form_submission (
  id                  text        primary key check (id ~ '^fsb_[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  tenant_id           text        not null default 'tnt_platform' check (tenant_id = 'tnt_platform'),
  form_item_id        text        not null,
  destination         text        not null
                        check (destination in ('crm_lead', 'hr_application', 'support_ticket', 'dpa_request', 'grievance')),
  destination_ref     text        check (length(destination_ref) <= 120),
  consent_receipt_id  text        check (consent_receipt_id ~ '^cns_'),
  state               text        not null check (state in ('handed_off', 'failed')),
  error_code          text,
  created_at          timestamptz not null default now(),
  constraint form_submission_ref check ((state = 'handed_off') = (destination_ref is not null))
);
comment on column cms.form_submission.id is 'dataclass:INTERNAL';
comment on column cms.form_submission.tenant_id is 'dataclass:INTERNAL';
comment on column cms.form_submission.form_item_id is 'dataclass:INTERNAL';
comment on column cms.form_submission.destination is 'dataclass:INTERNAL';
comment on column cms.form_submission.destination_ref is 'dataclass:CONFIDENTIAL';
comment on column cms.form_submission.consent_receipt_id is 'dataclass:CONFIDENTIAL';
comment on column cms.form_submission.state is 'dataclass:INTERNAL';
comment on column cms.form_submission.error_code is 'dataclass:INTERNAL';
comment on column cms.form_submission.created_at is 'dataclass:INTERNAL';
create index form_submission_form_idx on cms.form_submission (form_item_id, created_at);
alter table cms.form_submission enable row level security;
alter table cms.form_submission force row level security;
create policy form_submission_read on cms.form_submission for select
  using (tenant_id = current_setting('app.tenant_id', true) and current_setting('app.scope', true) = 'platform');
create policy form_submission_insert on cms.form_submission for insert
  with check (tenant_id = current_setting('app.tenant_id', true) and current_setting('app.scope', true) = 'platform');
grant select, insert on cms.form_submission to app_rw;
