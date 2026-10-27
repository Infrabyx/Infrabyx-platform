-- @infrabyx/trust 0001: the vendor-assurance mirror and the tenant-side records of the Vendor
-- Assurance Room (IPB-08 §08.3.4, §08.3.6, §08.4.2; Ecosystem §6.34; PL5 plan §7.2). Expand-only.
-- (1) Operations Hub is the system of record (IPB-08-01). The mirror tables are written only by the
--     mirror consumer (`svc_trust_mirror`); every other principal, staff included, can only read them.
--     There is no table for creating or editing a `vad_` here.
-- (2) Tenant rows (acknowledgements, NDA acceptances, requests, subscriptions) carry `tenant_id` under
--     RLS, deny by default (IPB-08-34). Acknowledgements and NDA acceptances are append-only.
-- (3) Deletion (OWNER-QUESTIONS #48, PL5-D-10; the owner's approval): an acknowledgement is deleted
--     10 years after the document version it acknowledges was superseded, expired or withdrawn
--     (IPB-08-37), never while under legal hold. PostgreSQL refuses every other delete.
--     SVC_TRUST_SWEEP finds the tenants with acknowledgements to purge and requests past their SLA.
set lock_timeout = '5s';
set statement_timeout = '60s';

create schema if not exists trust;
revoke all on schema trust from public;
grant usage on schema trust to app_rw, app_ro;

-- One row per announced version. `mirror_state` is the Ecosystem §6.34 mirror state machine
-- (STALE is derived from `trust.mirror_sync`); `oh_state` is the document state OH reports.
create table trust.mirror_document (
  vad_id               text        not null check (vad_id ~ '^vad_[0-9A-Za-z]{20,32}$'),
  version              integer     not null check (version > 0),
  tenant_id            text        not null default 'tnt_platform' check (tenant_id = 'tnt_platform'),
  title                text        not null check (length(title) between 1 and 300),
  category             text        not null check (category in ('CERTIFICATE', 'AUDIT_REPORT', 'AFFIDAVIT', 'DPA', 'POLICY',
                                     'STATEMENT', 'ACCESSIBILITY_STATEMENT', 'EXIT_RUNBOOK', 'BOM', 'PENTEST_SUMMARY', 'INSURANCE')),
  type_key             text        check (length(type_key) <= 80),
  cadence              text        not null check (cadence in ('MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'ANNUAL', 'EVENT')),
  valid_from           date        not null,
  valid_until          date,
  storage_ref          text        not null check (length(storage_ref) between 1 and 500),
  sha256               text        not null check (sha256 ~ '^[0-9a-f]{64}$'),
  visibility           text        not null check (visibility in ('PUBLIC', 'TENANT', 'GATED_NDA', 'AUDITOR')),
  publication_targets  text[]      not null,
  nda_required         boolean     not null,
  summary              text        not null check (length(summary) <= 500),
  supersedes_vad_id    text        check (supersedes_vad_id ~ '^vad_'),
  issuer_name          text        check (length(issuer_name) <= 200),
  oh_state             text        not null check (oh_state in ('PUBLISHED', 'SUPERSEDED', 'EXPIRED', 'WITHDRAWN')),
  mirror_state         text        not null check (mirror_state in ('ANNOUNCED', 'FETCHED', 'VERIFIED', 'VISIBLE', 'SUPERSEDED', 'HIDDEN')),
  digest_mismatch_at   timestamptz,
  ended_at             timestamptz,
  source_event_id      text        not null check (length(source_event_id) between 1 and 80),
  announced_at         timestamptz not null default now(),
  verified_at          timestamptz,
  synced_at            timestamptz not null default now(),
  primary key (vad_id, version),
  constraint mirror_ended check ((oh_state = 'PUBLISHED') = (ended_at is null))
);
comment on column trust.mirror_document.vad_id is 'dataclass:PUBLIC';
comment on column trust.mirror_document.version is 'dataclass:PUBLIC';
comment on column trust.mirror_document.tenant_id is 'dataclass:INTERNAL';
comment on column trust.mirror_document.title is 'dataclass:PUBLIC';
comment on column trust.mirror_document.category is 'dataclass:PUBLIC';
comment on column trust.mirror_document.type_key is 'dataclass:PUBLIC';
comment on column trust.mirror_document.cadence is 'dataclass:PUBLIC';
comment on column trust.mirror_document.valid_from is 'dataclass:PUBLIC';
comment on column trust.mirror_document.valid_until is 'dataclass:PUBLIC';
comment on column trust.mirror_document.storage_ref is 'dataclass:INTERNAL';
comment on column trust.mirror_document.sha256 is 'dataclass:PUBLIC';
comment on column trust.mirror_document.visibility is 'dataclass:INTERNAL';
comment on column trust.mirror_document.publication_targets is 'dataclass:INTERNAL';
comment on column trust.mirror_document.nda_required is 'dataclass:INTERNAL';
comment on column trust.mirror_document.summary is 'dataclass:PUBLIC';
comment on column trust.mirror_document.supersedes_vad_id is 'dataclass:PUBLIC';
comment on column trust.mirror_document.issuer_name is 'dataclass:PUBLIC';
comment on column trust.mirror_document.oh_state is 'dataclass:INTERNAL';
comment on column trust.mirror_document.mirror_state is 'dataclass:INTERNAL';
comment on column trust.mirror_document.digest_mismatch_at is 'dataclass:INTERNAL';
comment on column trust.mirror_document.ended_at is 'dataclass:INTERNAL';
comment on column trust.mirror_document.source_event_id is 'dataclass:INTERNAL';
comment on column trust.mirror_document.announced_at is 'dataclass:INTERNAL';
comment on column trust.mirror_document.verified_at is 'dataclass:INTERNAL';
comment on column trust.mirror_document.synced_at is 'dataclass:INTERNAL';
create index mirror_document_visible_idx on trust.mirror_document (vad_id) where mirror_state = 'VISIBLE';
alter table trust.mirror_document enable row level security;
alter table trust.mirror_document force row level security;
create policy mirror_document_read on trust.mirror_document for select using (true);
create policy mirror_document_insert on trust.mirror_document for insert
  with check (current_setting('app.tenant_id', true) = 'tnt_platform' and current_setting('app.actor_id', true) = 'svc_trust_mirror');
create policy mirror_document_update on trust.mirror_document for update
  using (current_setting('app.tenant_id', true) = 'tnt_platform' and current_setting('app.actor_id', true) = 'svc_trust_mirror')
  with check (current_setting('app.tenant_id', true) = 'tnt_platform' and current_setting('app.actor_id', true) = 'svc_trust_mirror');
grant select, insert, update on trust.mirror_document to app_rw;
grant select on trust.mirror_document to app_ro;

-- What OH said about a version never changes; only its state and the mirror's bookkeeping do.
create function trust.mirror_guard() returns trigger language plpgsql as $$
begin
  if new.vad_id is distinct from old.vad_id or new.version is distinct from old.version
      or new.sha256 is distinct from old.sha256 or new.storage_ref is distinct from old.storage_ref
      or new.valid_from is distinct from old.valid_from or new.title is distinct from old.title
      or new.category is distinct from old.category then
    raise exception 'mirror version %/% is immutable; OH announces a new version', old.vad_id, old.version
      using errcode = '42501';
  end if;
  if old.valid_until is not null and (new.valid_until is null or new.valid_until > old.valid_until) then
    raise exception 'mirror version %/% valid_until cannot be extended', old.vad_id, old.version using errcode = '42501';
  end if;
  return new;
end
$$;
create trigger mirror_guard before update on trust.mirror_document for each row execute function trust.mirror_guard();
-- Mirror rows are never deleted: versions are retained (IPB-08-07).
create function trust.mirror_guard_delete() returns trigger language plpgsql as $$
begin
  raise exception 'mirror versions are retained' using errcode = '42501';
end
$$;
create trigger mirror_no_delete before delete on trust.mirror_document for each row execute function trust.mirror_guard_delete();

-- The mirror's contact with OH: drives the "as of" label and STALE (Ecosystem §6.34, 7 days).
create table trust.mirror_sync (
  product             text        primary key check (product ~ '^[A-Z]{2,8}$'),
  tenant_id           text        not null default 'tnt_platform' check (tenant_id = 'tnt_platform'),
  last_contact_at     timestamptz,
  last_event_at       timestamptz,
  last_reconciled_at  timestamptz,
  oh_digest           text        check (oh_digest ~ '^[0-9a-f]{64}$'),
  mirror_digest       text        check (mirror_digest ~ '^[0-9a-f]{64}$'),
  digest_ok           boolean
);
comment on column trust.mirror_sync.product is 'dataclass:INTERNAL';
comment on column trust.mirror_sync.tenant_id is 'dataclass:INTERNAL';
comment on column trust.mirror_sync.last_contact_at is 'dataclass:INTERNAL';
comment on column trust.mirror_sync.last_event_at is 'dataclass:INTERNAL';
comment on column trust.mirror_sync.last_reconciled_at is 'dataclass:INTERNAL';
comment on column trust.mirror_sync.oh_digest is 'dataclass:INTERNAL';
comment on column trust.mirror_sync.mirror_digest is 'dataclass:INTERNAL';
comment on column trust.mirror_sync.digest_ok is 'dataclass:INTERNAL';
alter table trust.mirror_sync enable row level security;
alter table trust.mirror_sync force row level security;
create policy mirror_sync_read on trust.mirror_sync for select using (true);
create policy mirror_sync_insert on trust.mirror_sync for insert
  with check (current_setting('app.tenant_id', true) = 'tnt_platform' and current_setting('app.actor_id', true) = 'svc_trust_mirror');
create policy mirror_sync_update on trust.mirror_sync for update
  using (current_setting('app.tenant_id', true) = 'tnt_platform' and current_setting('app.actor_id', true) = 'svc_trust_mirror')
  with check (current_setting('app.tenant_id', true) = 'tnt_platform' and current_setting('app.actor_id', true) = 'svc_trust_mirror');
grant select, insert, update on trust.mirror_sync to app_rw;
grant select on trust.mirror_sync to app_ro;

-- Acknowledgements (IPB-08-15): evidence for the tenant. Never the user's name or e-mail; the IP
-- and user agent as classes only (IPB-08-38).
create table trust.acknowledgement (
  id                text        primary key check (id ~ '^vada_[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  tenant_id         text        not null,
  vad_id            text        not null,
  version           integer     not null,
  user_id           text        not null check (user_id ~ '^usr_'),
  user_role         text        not null check (length(user_role) between 2 and 40),
  grant_id          text        check (grant_id ~ '^vadg_'),
  action            text        not null check (action in ('VIEWED', 'ACKNOWLEDGED', 'DOWNLOADED', 'PACK_EXPORTED', 'NDA_ACCEPTED')),
  purpose           text        check (length(purpose) <= 200),
  ip_class          text        check (length(ip_class) <= 40),
  ua_class          text        check (length(ua_class) <= 40),
  watermark_id      text        check (length(watermark_id) <= 80),
  delivered_sha256  text        check (delivered_sha256 ~ '^[0-9a-f]{64}$'),
  legal_hold        boolean     not null default false,
  oh_synced_at      timestamptz,
  acknowledged_at   timestamptz not null default now(),
  foreign key (vad_id, version) references trust.mirror_document (vad_id, version)
);
comment on column trust.acknowledgement.id is 'dataclass:INTERNAL';
comment on column trust.acknowledgement.tenant_id is 'dataclass:INTERNAL';
comment on column trust.acknowledgement.vad_id is 'dataclass:INTERNAL';
comment on column trust.acknowledgement.version is 'dataclass:INTERNAL';
comment on column trust.acknowledgement.user_id is 'dataclass:CONFIDENTIAL';
comment on column trust.acknowledgement.user_role is 'dataclass:INTERNAL';
comment on column trust.acknowledgement.grant_id is 'dataclass:INTERNAL';
comment on column trust.acknowledgement.action is 'dataclass:INTERNAL';
comment on column trust.acknowledgement.purpose is 'dataclass:CONFIDENTIAL';
comment on column trust.acknowledgement.ip_class is 'dataclass:CONFIDENTIAL';
comment on column trust.acknowledgement.ua_class is 'dataclass:INTERNAL';
comment on column trust.acknowledgement.watermark_id is 'dataclass:INTERNAL';
comment on column trust.acknowledgement.delivered_sha256 is 'dataclass:INTERNAL';
comment on column trust.acknowledgement.legal_hold is 'dataclass:INTERNAL';
comment on column trust.acknowledgement.oh_synced_at is 'dataclass:INTERNAL';
comment on column trust.acknowledgement.acknowledged_at is 'dataclass:INTERNAL';
create index acknowledgement_tenant_idx on trust.acknowledgement (tenant_id, acknowledged_at);
create index acknowledgement_doc_idx on trust.acknowledgement (vad_id, version);
alter table trust.acknowledgement enable row level security;
alter table trust.acknowledgement force row level security;
create policy acknowledgement_tenant on trust.acknowledgement for select
  using (tenant_id = current_setting('app.tenant_id', true));
create policy acknowledgement_insert on trust.acknowledgement for insert
  with check (tenant_id = current_setting('app.tenant_id', true));
create policy acknowledgement_update on trust.acknowledgement for update
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
create policy acknowledgement_delete on trust.acknowledgement for delete
  using (tenant_id = current_setting('app.tenant_id', true));
-- The purge rule (#48, IPB-08-37): 10 years after the version ended, never under legal hold.
create policy acknowledgement_delete_retention on trust.acknowledgement as restrictive for delete
  using (
    not legal_hold
    and exists (
      select 1 from trust.mirror_document d
       where d.vad_id = acknowledgement.vad_id and d.version = acknowledgement.version
         and d.ended_at < now() - interval '10 years'));
grant select, insert, update, delete on trust.acknowledgement to app_rw;
grant select on trust.acknowledgement to app_ro;

-- Only the sync stamp and the legal hold of an acknowledgement change; the evidence never does.
create function trust.acknowledgement_guard() returns trigger language plpgsql as $$
begin
  if (to_jsonb(new) - 'oh_synced_at' - 'legal_hold') is distinct from (to_jsonb(old) - 'oh_synced_at' - 'legal_hold') then
    raise exception 'acknowledgement % is evidence and cannot change', old.id using errcode = '42501';
  end if;
  if old.oh_synced_at is not null and new.oh_synced_at is distinct from old.oh_synced_at then
    raise exception 'acknowledgement % already synced', old.id using errcode = '42501';
  end if;
  return new;
end
$$;
create trigger acknowledgement_guard before update on trust.acknowledgement
  for each row execute function trust.acknowledgement_guard();

-- NDA acceptances (IPB-08-08): a consent-type record, append-only and never deleted here.
create table trust.nda_acceptance (
  id            text        primary key check (id ~ '^nda_[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  tenant_id     text        not null,
  nda_version   text        not null check (length(nda_version) between 1 and 40),
  accepted_by   text        not null check (accepted_by ~ '^usr_'),
  accepted_role text        not null check (accepted_role in ('ORG_OWNER', 'ORG_ADMIN')),
  msa_ref       text        check (length(msa_ref) <= 80),
  accepted_at   timestamptz not null default now(),
  unique (tenant_id, nda_version)
);
comment on column trust.nda_acceptance.id is 'dataclass:INTERNAL';
comment on column trust.nda_acceptance.tenant_id is 'dataclass:INTERNAL';
comment on column trust.nda_acceptance.nda_version is 'dataclass:INTERNAL';
comment on column trust.nda_acceptance.accepted_by is 'dataclass:CONFIDENTIAL';
comment on column trust.nda_acceptance.accepted_role is 'dataclass:INTERNAL';
comment on column trust.nda_acceptance.msa_ref is 'dataclass:INTERNAL';
comment on column trust.nda_acceptance.accepted_at is 'dataclass:INTERNAL';
alter table trust.nda_acceptance enable row level security;
alter table trust.nda_acceptance force row level security;
create policy nda_acceptance_tenant on trust.nda_acceptance for select
  using (tenant_id = current_setting('app.tenant_id', true));
create policy nda_acceptance_insert on trust.nda_acceptance for insert
  with check (tenant_id = current_setting('app.tenant_id', true));
grant select, insert on trust.nda_acceptance to app_rw;
grant select on trust.nda_acceptance to app_ro;

create function trust.append_only() returns trigger language plpgsql as $$
begin
  raise exception '%.% is append-only', tg_table_schema, tg_table_name using errcode = '42501';
end
$$;
create trigger nda_acceptance_append_only before update or delete on trust.nda_acceptance
  for each row execute function trust.append_only();

-- Document requests (IPB-08-17): the SLA from `trust.request.*`; PENDING_SYNC until OH has a ticket.
create table trust.request (
  id                  text        primary key check (id ~ '^vadr_[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  tenant_id           text        not null,
  type_key            text        check (length(type_key) <= 80),
  description         text        not null check (length(description) between 1 and 1000),
  purpose             text        check (length(purpose) <= 200),
  regulator_deadline  date,
  state               text        not null default 'open'
                                  check (state in ('open', 'acknowledged', 'in_progress', 'fulfilled', 'declined')),
  ticket_ref          text        check (length(ticket_ref) between 1 and 80),
  sync_attempts       integer     not null default 0,
  fulfilled_vad_id    text        check (fulfilled_vad_id ~ '^vad_'),
  sla_ack_due         timestamptz not null,
  sla_fulfil_due      timestamptz not null,
  sla_breaches        text[]      not null default '{}',
  created_by          text        not null check (created_by ~ '^usr_'),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
comment on column trust.request.id is 'dataclass:INTERNAL';
comment on column trust.request.tenant_id is 'dataclass:INTERNAL';
comment on column trust.request.type_key is 'dataclass:INTERNAL';
comment on column trust.request.description is 'dataclass:CONFIDENTIAL';
comment on column trust.request.purpose is 'dataclass:CONFIDENTIAL';
comment on column trust.request.regulator_deadline is 'dataclass:INTERNAL';
comment on column trust.request.state is 'dataclass:INTERNAL';
comment on column trust.request.ticket_ref is 'dataclass:INTERNAL';
comment on column trust.request.sync_attempts is 'dataclass:INTERNAL';
comment on column trust.request.fulfilled_vad_id is 'dataclass:INTERNAL';
comment on column trust.request.sla_ack_due is 'dataclass:INTERNAL';
comment on column trust.request.sla_fulfil_due is 'dataclass:INTERNAL';
comment on column trust.request.sla_breaches is 'dataclass:INTERNAL';
comment on column trust.request.created_by is 'dataclass:CONFIDENTIAL';
comment on column trust.request.created_at is 'dataclass:INTERNAL';
comment on column trust.request.updated_at is 'dataclass:INTERNAL';
create index request_tenant_idx on trust.request (tenant_id, created_at);
create index request_open_idx on trust.request (sla_fulfil_due) where state not in ('fulfilled', 'declined');
alter table trust.request enable row level security;
alter table trust.request force row level security;
create policy request_tenant on trust.request for select
  using (tenant_id = current_setting('app.tenant_id', true));
create policy request_insert on trust.request for insert
  with check (tenant_id = current_setting('app.tenant_id', true));
create policy request_update on trust.request for update
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
grant select, insert, update on trust.request to app_rw;
grant select on trust.request to app_ro;

-- Update subscriptions (IPB-08-16): per document type, or all types when `type_key` is null.
create table trust.subscription (
  id          text        primary key check (id ~ '^vads_[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  tenant_id   text        not null,
  user_id     text        not null check (user_id ~ '^usr_'),
  type_key    text        check (length(type_key) <= 80),
  channels    text[]      not null check (channels <@ array['in_app', 'email']::text[] and cardinality(channels) > 0),
  created_at  timestamptz not null default now()
);
comment on column trust.subscription.id is 'dataclass:INTERNAL';
comment on column trust.subscription.tenant_id is 'dataclass:INTERNAL';
comment on column trust.subscription.user_id is 'dataclass:CONFIDENTIAL';
comment on column trust.subscription.type_key is 'dataclass:INTERNAL';
comment on column trust.subscription.channels is 'dataclass:INTERNAL';
comment on column trust.subscription.created_at is 'dataclass:INTERNAL';
create unique index subscription_unique_idx on trust.subscription (tenant_id, user_id, coalesce(type_key, '*'));
alter table trust.subscription enable row level security;
alter table trust.subscription force row level security;
create policy subscription_tenant on trust.subscription for all
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
grant select, insert, update, delete on trust.subscription to app_rw;
grant select on trust.subscription to app_ro;

-- The sweep's tenant finder: ids, tenants, versions and timers only; no purpose, no user, no write.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'svc_trust_sweep') then
    create role svc_trust_sweep nologin nosuperuser nobypassrls nocreatedb nocreaterole;
  end if;
end
$$;
grant usage on schema trust to svc_trust_sweep;
grant select (id, tenant_id, vad_id, version, legal_hold, acknowledged_at) on trust.acknowledgement to svc_trust_sweep;
grant select (id, tenant_id, state, ticket_ref, sync_attempts, sla_ack_due, sla_fulfil_due, sla_breaches, created_at)
  on trust.request to svc_trust_sweep;
grant select (vad_id, version, ended_at) on trust.mirror_document to svc_trust_sweep;
create policy acknowledgement_sweep on trust.acknowledgement for select to svc_trust_sweep
  using (current_setting('app.scope', true) = 'platform');
create policy request_sweep on trust.request for select to svc_trust_sweep
  using (current_setting('app.scope', true) = 'platform');
grant svc_trust_sweep to app_rw, app_ro;

-- Transactional outbox and consumer inbox (IPB-01 §01.4.3.3).
create table trust.outbox (
  id             text        primary key,
  tenant_id      text        not null,
  type           text        not null,
  envelope       jsonb       not null,
  created_at     timestamptz not null default now(),
  dispatched_at  timestamptz,
  attempts       integer     not null default 0
);
comment on column trust.outbox.id is 'dataclass:INTERNAL';
comment on column trust.outbox.tenant_id is 'dataclass:INTERNAL';
comment on column trust.outbox.type is 'dataclass:INTERNAL';
comment on column trust.outbox.envelope is 'dataclass:INTERNAL';
comment on column trust.outbox.created_at is 'dataclass:INTERNAL';
comment on column trust.outbox.dispatched_at is 'dataclass:INTERNAL';
comment on column trust.outbox.attempts is 'dataclass:INTERNAL';
create index outbox_pending_idx on trust.outbox (created_at) where dispatched_at is null;
alter table trust.outbox enable row level security;
alter table trust.outbox force row level security;
create policy outbox_tenant on trust.outbox for all
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
grant select, insert, update on trust.outbox to app_rw;
grant select on trust.outbox to app_ro;

create table trust.inbox (
  consumer      text        not null,
  event_id      text        not null,
  tenant_id     text        not null,
  processed_at  timestamptz not null default now(),
  primary key (consumer, event_id)
);
comment on column trust.inbox.consumer is 'dataclass:INTERNAL';
comment on column trust.inbox.event_id is 'dataclass:INTERNAL';
comment on column trust.inbox.tenant_id is 'dataclass:INTERNAL';
comment on column trust.inbox.processed_at is 'dataclass:INTERNAL';
alter table trust.inbox enable row level security;
alter table trust.inbox force row level security;
create policy inbox_tenant on trust.inbox for all
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
grant select, insert on trust.inbox to app_rw;
grant select on trust.inbox to app_ro;
