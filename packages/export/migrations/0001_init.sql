-- @infrabyx/export 0001: export jobs, archives (Ecosystem §12 entity 40) and the module outbox
-- (PL3 plan §7.3, PL3-D-22). Expand-only. Requires the roles created by @infrabyx/tenancy 0001.
-- Jobs and archives describe an export, never its content: the archive bytes live in STORAGE.
-- An archive row is written once and never updated (no UPDATE grant); every write goes through the
-- kernel with an audit ledger entry, and every download records the archive SHA-256 there.
set lock_timeout = '5s';
set statement_timeout = '60s';

create schema if not exists export;
revoke all on schema export from public;
grant usage on schema export to app_rw, app_ro;

create table export.export_job (
  id              text        primary key check (id ~ '^exj_[0-9A-HJKMNP-TV-Z]{26}$'),
  tenant_id       text        not null,
  scope_type      text        not null check (scope_type in ('DATASET', 'LEGAL_ENTITY', 'MODULE', 'AUDIT_PACK', 'RE_PACK', 'FULL_TENANT', 'EXIT')),
  scope_ref       text,
  map_version     text        not null check (map_version ~ '^[A-Z][A-Z0-9]{1,9}-EXPORT-[0-9]+\.[0-9]+$'),
  requester_id    text        not null,
  requester_role  text        not null,
  state           text        not null default 'requested' check (state in ('requested', 'running', 'completed', 'failed')),
  archive_id      text,
  bytes           bigint      check (bytes >= 0),
  file_count      integer     check (file_count >= 0),
  manifest_hash   text        check (manifest_hash ~ '^[0-9a-f]{64}$'),
  error_code      text,
  created_at      timestamptz not null default now(),
  started_at      timestamptz,
  finished_at     timestamptz
);
comment on column export.export_job.id is 'dataclass:INTERNAL';
comment on column export.export_job.tenant_id is 'dataclass:INTERNAL';
comment on column export.export_job.scope_type is 'dataclass:INTERNAL';
comment on column export.export_job.scope_ref is 'dataclass:INTERNAL';
comment on column export.export_job.map_version is 'dataclass:INTERNAL';
comment on column export.export_job.requester_id is 'dataclass:INTERNAL';
comment on column export.export_job.requester_role is 'dataclass:INTERNAL';
comment on column export.export_job.state is 'dataclass:INTERNAL';
comment on column export.export_job.archive_id is 'dataclass:INTERNAL';
comment on column export.export_job.bytes is 'dataclass:INTERNAL';
comment on column export.export_job.file_count is 'dataclass:INTERNAL';
comment on column export.export_job.manifest_hash is 'dataclass:INTERNAL';
comment on column export.export_job.error_code is 'dataclass:INTERNAL';
comment on column export.export_job.created_at is 'dataclass:INTERNAL';
comment on column export.export_job.started_at is 'dataclass:INTERNAL';
comment on column export.export_job.finished_at is 'dataclass:INTERNAL';
create index export_job_requester_idx on export.export_job (tenant_id, requester_id, created_at);
alter table export.export_job enable row level security;
alter table export.export_job force row level security;
create policy export_job_tenant on export.export_job for all
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
grant select, insert, update on export.export_job to app_rw;
grant select on export.export_job to app_ro;

-- Archives (Ecosystem §12 entity 40): one row per produced archive, written once.
create table export.archive (
  id                        text        primary key check (id ~ '^arc_[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  tenant_id                 text        not null,
  job_id                    text        not null references export.export_job (id),
  map_version               text        not null,
  archive_standard_version  text        not null check (archive_standard_version = '1.0'),
  folder_profile            text        not null,
  scope_type                text        not null,
  storage_key               text        not null unique,
  sha256                    text        not null check (sha256 ~ '^[0-9a-f]{64}$'),
  bytes                     bigint      not null check (bytes >= 0),
  file_count                integer     not null check (file_count >= 0),
  manifest_hash             text        not null check (manifest_hash ~ '^[0-9a-f]{64}$'),
  pack_sha256               text        not null check (pack_sha256 ~ '^[0-9a-f]{64}$'),
  signing_kid               text        not null,
  manifest_jws              text        not null,
  completed_event_jws       text,
  predecessor_archive_id    text,
  as_of                     timestamptz not null,
  created_at                timestamptz not null default now()
);
comment on column export.archive.id is 'dataclass:INTERNAL';
comment on column export.archive.tenant_id is 'dataclass:INTERNAL';
comment on column export.archive.job_id is 'dataclass:INTERNAL';
comment on column export.archive.map_version is 'dataclass:INTERNAL';
comment on column export.archive.archive_standard_version is 'dataclass:INTERNAL';
comment on column export.archive.folder_profile is 'dataclass:INTERNAL';
comment on column export.archive.scope_type is 'dataclass:INTERNAL';
comment on column export.archive.storage_key is 'dataclass:INTERNAL';
comment on column export.archive.sha256 is 'dataclass:INTERNAL';
comment on column export.archive.bytes is 'dataclass:INTERNAL';
comment on column export.archive.file_count is 'dataclass:INTERNAL';
comment on column export.archive.manifest_hash is 'dataclass:INTERNAL';
comment on column export.archive.pack_sha256 is 'dataclass:INTERNAL';
comment on column export.archive.signing_kid is 'dataclass:INTERNAL';
comment on column export.archive.manifest_jws is 'dataclass:INTERNAL';
comment on column export.archive.completed_event_jws is 'dataclass:INTERNAL';
comment on column export.archive.predecessor_archive_id is 'dataclass:INTERNAL';
comment on column export.archive.as_of is 'dataclass:INTERNAL';
comment on column export.archive.created_at is 'dataclass:INTERNAL';
create index archive_job_idx on export.archive (job_id);
alter table export.archive enable row level security;
alter table export.archive force row level security;
create policy archive_tenant on export.archive for all
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
grant select, insert on export.archive to app_rw;
grant select on export.archive to app_ro;

-- Transactional outbox and consumer inbox (IPB-01 §01.4.3.3).
create table export.outbox (
  id             text        primary key,
  tenant_id      text        not null,
  type           text        not null,
  envelope       jsonb       not null,
  created_at     timestamptz not null default now(),
  dispatched_at  timestamptz,
  attempts       integer     not null default 0
);
comment on column export.outbox.id is 'dataclass:INTERNAL';
comment on column export.outbox.tenant_id is 'dataclass:INTERNAL';
comment on column export.outbox.type is 'dataclass:INTERNAL';
comment on column export.outbox.envelope is 'dataclass:CONFIDENTIAL';
comment on column export.outbox.created_at is 'dataclass:INTERNAL';
comment on column export.outbox.dispatched_at is 'dataclass:INTERNAL';
comment on column export.outbox.attempts is 'dataclass:INTERNAL';
create index outbox_pending_idx on export.outbox (created_at) where dispatched_at is null;
alter table export.outbox enable row level security;
alter table export.outbox force row level security;
create policy outbox_tenant on export.outbox for all
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
grant select, insert, update on export.outbox to app_rw;
grant select on export.outbox to app_ro;

create table export.inbox (
  consumer      text        not null,
  event_id      text        not null,
  tenant_id     text        not null,
  processed_at  timestamptz not null default now(),
  primary key (consumer, event_id)
);
comment on column export.inbox.consumer is 'dataclass:INTERNAL';
comment on column export.inbox.event_id is 'dataclass:INTERNAL';
comment on column export.inbox.tenant_id is 'dataclass:INTERNAL';
comment on column export.inbox.processed_at is 'dataclass:INTERNAL';
alter table export.inbox enable row level security;
alter table export.inbox force row level security;
create policy inbox_tenant on export.inbox for all
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
grant select, insert on export.inbox to app_rw;
grant select on export.inbox to app_ro;
