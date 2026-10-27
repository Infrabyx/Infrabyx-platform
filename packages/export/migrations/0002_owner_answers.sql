-- @infrabyx/export 0002: owner answers to OWNER-QUESTIONS #24 (PL3-D-25). Expand-only.
-- (1) An archive can be downloaded for 30 days and is then deleted: `expires_at` is set when the
--     archive is written (rows from 0001 expire 30 days after `created_at`), and each deletion is
--     one insert-only `archive_deletion` row plus a ledger entry, written in the same transaction.
-- (2) An ORG_ADMIN export runs only after an ORG_OWNER approves it: the job keeps the approval id.
-- (3) SVC_EXPORT_SWEEP finds approved jobs not yet run and expired archives across tenants. It
--     may select only ids, tenant, state and times (never a storage key or a signature), has no
--     write grant, and is granted to app_rw and app_ro so their login users can SET LOCAL ROLE.
set lock_timeout = '5s';
set statement_timeout = '60s';

alter table export.archive add column expires_at timestamptz;
comment on column export.archive.expires_at is 'dataclass:INTERNAL';

alter table export.export_job add column approval_id text;
comment on column export.export_job.approval_id is 'dataclass:INTERNAL';

create table export.archive_deletion (
  archive_id  text        primary key references export.archive (id),
  tenant_id   text        not null,
  reason      text        not null check (reason in ('expired')),
  deleted_at  timestamptz not null default now()
);
comment on column export.archive_deletion.archive_id is 'dataclass:INTERNAL';
comment on column export.archive_deletion.tenant_id is 'dataclass:INTERNAL';
comment on column export.archive_deletion.reason is 'dataclass:INTERNAL';
comment on column export.archive_deletion.deleted_at is 'dataclass:INTERNAL';
alter table export.archive_deletion enable row level security;
alter table export.archive_deletion force row level security;
create policy archive_deletion_tenant on export.archive_deletion for all
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
grant select, insert on export.archive_deletion to app_rw;
grant select on export.archive_deletion to app_ro;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'svc_export_sweep') then
    create role svc_export_sweep nologin nosuperuser nobypassrls nocreatedb nocreaterole;
  end if;
end
$$;

grant usage on schema export to svc_export_sweep;
grant select (id, tenant_id, state, created_at) on export.export_job to svc_export_sweep;
grant select (id, tenant_id, created_at, expires_at) on export.archive to svc_export_sweep;
grant select (archive_id, tenant_id) on export.archive_deletion to svc_export_sweep;
create policy export_job_sweep on export.export_job for select to svc_export_sweep
  using (current_setting('app.scope', true) = 'platform');
create policy archive_sweep on export.archive for select to svc_export_sweep
  using (current_setting('app.scope', true) = 'platform');
create policy archive_deletion_sweep on export.archive_deletion for select to svc_export_sweep
  using (current_setting('app.scope', true) = 'platform');
grant svc_export_sweep to app_rw, app_ro;
