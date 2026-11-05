-- @infrabyx/consent 0005: dry runs and live runs of the purpose-consent purge (Finbyx PR-FBX-37;
-- OWNER-QUESTIONS #95's guards; R1-D-97). Expand-only: one table, no row changed. A dry run
-- records, per tenant, the ids it would delete and the report's digest; a live run names the dry
-- run it follows (at most 72 hours old) and deletes no record outside that list; each live batch is
-- its own row. The deletion rule itself (consent/0004)
-- is unchanged: a dry run never widens it, it only narrows a live run.
set lock_timeout = '5s';
set statement_timeout = '60s';

create table consent.purpose_purge_run (
  id             text        primary key check (id ~ '^cpr_[0-9A-HJKMNP-TV-Z]{26}$'),
  tenant_id      text        not null,
  kind           text        not null check (kind in ('dry_run', 'live')),
  dry_run_id     text        references consent.purpose_purge_run (id),
  record_ids     text[]      not null default '{}',
  records        integer     not null check (records >= 0),
  report_sha256  text        check (report_sha256 ~ '^[0-9a-f]{64}$'),
  ran_by         text        not null,
  ran_at         timestamptz not null default now(),
  constraint purpose_purge_run_kind check (
    (kind = 'dry_run' and dry_run_id is null and report_sha256 is not null)
    or (kind = 'live' and dry_run_id is not null)
  )
);
comment on column consent.purpose_purge_run.id is 'dataclass:INTERNAL';
comment on column consent.purpose_purge_run.tenant_id is 'dataclass:INTERNAL';
comment on column consent.purpose_purge_run.kind is 'dataclass:INTERNAL';
comment on column consent.purpose_purge_run.dry_run_id is 'dataclass:INTERNAL';
comment on column consent.purpose_purge_run.record_ids is 'dataclass:INTERNAL';
comment on column consent.purpose_purge_run.records is 'dataclass:INTERNAL';
comment on column consent.purpose_purge_run.report_sha256 is 'dataclass:INTERNAL';
comment on column consent.purpose_purge_run.ran_by is 'dataclass:INTERNAL';
comment on column consent.purpose_purge_run.ran_at is 'dataclass:INTERNAL';
create index purpose_purge_run_tenant_idx on consent.purpose_purge_run (tenant_id, ran_at desc);
create index purpose_purge_run_dry_run_idx on consent.purpose_purge_run (dry_run_id);

alter table consent.purpose_purge_run enable row level security;
alter table consent.purpose_purge_run force row level security;
create policy purpose_purge_run_read on consent.purpose_purge_run for select
  using (tenant_id = current_setting('app.tenant_id', true));
create policy purpose_purge_run_insert on consent.purpose_purge_run for insert
  with check (
    tenant_id = current_setting('app.tenant_id', true)
    and ran_by = current_setting('app.actor_id', true)
  );
grant select, insert on consent.purpose_purge_run to app_rw;
grant select on consent.purpose_purge_run to app_ro;
