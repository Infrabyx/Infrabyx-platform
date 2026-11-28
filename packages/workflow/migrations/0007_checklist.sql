-- @infrabyx/workflow 0007: digital checklists with maker-checker sign-off and evidence (regulatory
-- templates item (d); plan §6b; R1-D-326). Expand-only: two new tables.
-- A run follows one checklist definition (by code, version and the definition's SHA-256). Each item
-- is open, met, not_met or not_applicable; the last two carry a reason; evidence is held by
-- reference (STORAGE key and SHA-256), never the file. A run is signed off by its maker, then by a
-- checker who is not the maker, each after a step-up. No delete grant: runs are records.
set lock_timeout = '5s';
set statement_timeout = '60s';

create table workflow.checklist_run (
  id                  text        primary key check (id ~ '^clr_[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  tenant_id           text        not null,
  checklist_code      text        not null check (checklist_code ~ '^[A-Z][A-Z0-9]{0,9}(-[A-Z0-9]{1,10}){0,4}$'),
  checklist_version   text        not null check (checklist_version ~ '^\d+\.\d+\.\d+$'),
  definition_sha256   text        not null check (definition_sha256 ~ '^[0-9a-f]{64}$'),
  subject_ref         text        check (subject_ref ~ '^[A-Za-z0-9_.:@/+=-]{1,128}$'),
  state               text        not null check (state in ('open', 'maker_signed', 'signed_off')),
  maker_signed_by     text        check (length(maker_signed_by) between 1 and 200),
  maker_signed_at     timestamptz,
  checker_signed_by   text        check (length(checker_signed_by) between 1 and 200),
  checker_signed_at   timestamptz,
  created_by          text        not null check (length(created_by) between 1 and 200),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  -- The checker is never the maker (IPB-02 §02.4.6.1), here as well as in the service.
  constraint checklist_run_four_eyes check (checker_signed_by is null or checker_signed_by <> maker_signed_by),
  constraint checklist_run_signatures check (
    (state = 'open' and maker_signed_by is null and checker_signed_by is null)
    or (state = 'maker_signed' and maker_signed_by is not null and checker_signed_by is null)
    or (state = 'signed_off' and maker_signed_by is not null and checker_signed_by is not null)
  )
);
create index checklist_run_tenant on workflow.checklist_run (tenant_id, checklist_code, state, created_at);

create table workflow.checklist_item (
  tenant_id     text        not null,
  run_id        text        not null references workflow.checklist_run (id),
  item_id       text        not null check (item_id ~ '^[A-Za-z0-9_.-]{1,40}$'),
  position      integer     not null check (position between 1 and 500),
  state         text        not null check (state in ('open', 'met', 'not_met', 'not_applicable')),
  reason        text        check (length(reason) between 1 and 2000),
  -- [{ "storageKey": ..., "sha256": ... }], at most 20.
  evidence      jsonb       not null default '[]'::jsonb check (jsonb_typeof(evidence) = 'array' and jsonb_array_length(evidence) <= 20),
  action_ref    text        check (length(action_ref) between 1 and 200),
  updated_by    text        check (length(updated_by) between 1 and 200),
  updated_at    timestamptz not null default now(),
  primary key (tenant_id, run_id, item_id),
  constraint checklist_item_reason check (state in ('open', 'met') or reason is not null)
);
comment on table workflow.checklist_run is 'A checklist run: maker then checker sign-off with step-up (R1-D-326)';
comment on table workflow.checklist_item is 'One item of a checklist run: state, reason, evidence by reference (R1-D-326)';
comment on column workflow.checklist_run.id is 'dataclass:INTERNAL';
comment on column workflow.checklist_run.tenant_id is 'dataclass:INTERNAL';
comment on column workflow.checklist_run.checklist_code is 'dataclass:INTERNAL';
comment on column workflow.checklist_run.checklist_version is 'dataclass:INTERNAL';
comment on column workflow.checklist_run.definition_sha256 is 'dataclass:INTERNAL';
comment on column workflow.checklist_run.subject_ref is 'dataclass:INTERNAL';
comment on column workflow.checklist_run.state is 'dataclass:INTERNAL';
comment on column workflow.checklist_run.maker_signed_by is 'dataclass:INTERNAL';
comment on column workflow.checklist_run.maker_signed_at is 'dataclass:INTERNAL';
comment on column workflow.checklist_run.checker_signed_by is 'dataclass:INTERNAL';
comment on column workflow.checklist_run.checker_signed_at is 'dataclass:INTERNAL';
comment on column workflow.checklist_run.created_by is 'dataclass:INTERNAL';
comment on column workflow.checklist_run.created_at is 'dataclass:INTERNAL';
comment on column workflow.checklist_run.updated_at is 'dataclass:INTERNAL';
comment on column workflow.checklist_item.tenant_id is 'dataclass:INTERNAL';
comment on column workflow.checklist_item.run_id is 'dataclass:INTERNAL';
comment on column workflow.checklist_item.item_id is 'dataclass:INTERNAL';
comment on column workflow.checklist_item.position is 'dataclass:INTERNAL';
comment on column workflow.checklist_item.state is 'dataclass:INTERNAL';
comment on column workflow.checklist_item.reason is 'dataclass:CONFIDENTIAL';
comment on column workflow.checklist_item.evidence is 'dataclass:CONFIDENTIAL';
comment on column workflow.checklist_item.action_ref is 'dataclass:INTERNAL';
comment on column workflow.checklist_item.updated_by is 'dataclass:INTERNAL';
comment on column workflow.checklist_item.updated_at is 'dataclass:INTERNAL';
alter table workflow.checklist_run enable row level security;
alter table workflow.checklist_run force row level security;
create policy checklist_run_tenant on workflow.checklist_run for all
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
alter table workflow.checklist_item enable row level security;
alter table workflow.checklist_item force row level security;
create policy checklist_item_tenant on workflow.checklist_item for all
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
grant select, insert, update on workflow.checklist_run, workflow.checklist_item to app_rw;
grant select on workflow.checklist_run, workflow.checklist_item to app_ro;
