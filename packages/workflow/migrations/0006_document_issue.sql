-- @infrabyx/workflow 0006: issuing a document from a template (regulatory templates plan §8, items
-- 2a and 2b; R1-D-315, R1-D-318, R1-D-321). Expand-only: one new table.
-- One row per issued document, from render through review or approval, signing and the archive.
-- It holds references and SHA-256 hashes only: never the template data (only the SHA-256 of its
-- canonical JSON), never a signer's name, email or phone (only the SHA-256 of the canonical signer
-- list). No delete grant: a document's record is never removed here (the locked list).
set lock_timeout = '5s';
set statement_timeout = '60s';

create table workflow.document_issue (
  id                        text        primary key check (id ~ '^dis_[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  tenant_id                 text        not null,
  template_id               text        not null check (length(template_id) between 1 and 120),
  template_version          text        check (length(template_version) between 1 and 64),
  format                    text        not null check (format in ('pdf', 'pdfa', 'docx', 'html')),
  -- How the template is registered (owner answer, R1-D-318): 'required' can never skip signing.
  signing                   text        not null check (signing in ('required', 'none')),
  data_sha256               text        not null check (data_sha256 ~ '^[0-9a-f]{64}$'),
  rendered_key              text        not null check (length(rendered_key) between 1 and 1024),
  rendered_sha256           text        not null check (rendered_sha256 ~ '^[0-9a-f]{64}$'),
  approval_id               text,
  reviewed_by               text        check (length(reviewed_by) between 1 and 200),
  reviewed_at               timestamptz,
  signers_sha256            text        check (signers_sha256 ~ '^[0-9a-f]{64}$'),
  envelope_id               text        check (length(envelope_id) between 1 and 200),
  signed_key                text        check (length(signed_key) between 1 and 1024),
  signed_sha256             text        check (signed_sha256 ~ '^[0-9a-f]{64}$'),
  archived_key              text        check (length(archived_key) between 1 and 1024),
  archived_sha256           text        check (archived_sha256 ~ '^[0-9a-f]{64}$'),
  -- The unsigned rendered copy kept with the signed copy's retention (R1-D-318 (2)).
  rendered_archived_key     text        check (length(rendered_archived_key) between 1 and 1024),
  rendered_archived_sha256  text        check (rendered_archived_sha256 ~ '^[0-9a-f]{64}$'),
  retain_until              timestamptz not null,
  state                     text        not null check (state in (
                              'rendered', 'reviewed', 'approval_pending', 'approved', 'signing',
                              'signed', 'archived', 'rejected', 'expired', 'failed')),
  failure_reason            text        check (failure_reason ~ '^[a-z][a-z0-9_]{0,63}$'),
  created_by                text        not null check (length(created_by) between 1 and 200),
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  -- A signing template is never archived unsigned; an unsigned one never has an envelope.
  constraint document_issue_signing_path check (
    (signing = 'required' and (state <> 'archived' or signed_sha256 is not null))
    or (signing = 'none' and envelope_id is null and signed_key is null)
  ),
  -- An archived copy is the file it stands for.
  constraint document_issue_archive_hash check (
    state <> 'archived' or (
      archived_sha256 is not null
      and archived_sha256 = coalesce(signed_sha256, rendered_sha256)
      and (signing = 'none' or rendered_archived_sha256 = rendered_sha256)
    )
  )
);
create index document_issue_tenant_state on workflow.document_issue (tenant_id, state, created_at);
create index document_issue_approval on workflow.document_issue (tenant_id, approval_id)
  where approval_id is not null;
comment on table workflow.document_issue is 'One issued document: render, review or approval, signing, archive (R1-D-321)';
comment on column workflow.document_issue.id is 'dataclass:INTERNAL';
comment on column workflow.document_issue.tenant_id is 'dataclass:INTERNAL';
comment on column workflow.document_issue.template_id is 'dataclass:INTERNAL';
comment on column workflow.document_issue.template_version is 'dataclass:INTERNAL';
comment on column workflow.document_issue.format is 'dataclass:INTERNAL';
comment on column workflow.document_issue.signing is 'dataclass:INTERNAL';
comment on column workflow.document_issue.data_sha256 is 'dataclass:CONFIDENTIAL';
comment on column workflow.document_issue.rendered_key is 'dataclass:INTERNAL';
comment on column workflow.document_issue.rendered_sha256 is 'dataclass:CONFIDENTIAL';
comment on column workflow.document_issue.approval_id is 'dataclass:INTERNAL';
comment on column workflow.document_issue.reviewed_by is 'dataclass:INTERNAL';
comment on column workflow.document_issue.reviewed_at is 'dataclass:INTERNAL';
comment on column workflow.document_issue.signers_sha256 is 'dataclass:CONFIDENTIAL';
comment on column workflow.document_issue.envelope_id is 'dataclass:INTERNAL';
comment on column workflow.document_issue.signed_key is 'dataclass:INTERNAL';
comment on column workflow.document_issue.signed_sha256 is 'dataclass:CONFIDENTIAL';
comment on column workflow.document_issue.archived_key is 'dataclass:INTERNAL';
comment on column workflow.document_issue.archived_sha256 is 'dataclass:CONFIDENTIAL';
comment on column workflow.document_issue.rendered_archived_key is 'dataclass:INTERNAL';
comment on column workflow.document_issue.rendered_archived_sha256 is 'dataclass:CONFIDENTIAL';
comment on column workflow.document_issue.retain_until is 'dataclass:INTERNAL';
comment on column workflow.document_issue.state is 'dataclass:INTERNAL';
comment on column workflow.document_issue.failure_reason is 'dataclass:INTERNAL';
comment on column workflow.document_issue.created_by is 'dataclass:INTERNAL';
comment on column workflow.document_issue.created_at is 'dataclass:INTERNAL';
comment on column workflow.document_issue.updated_at is 'dataclass:INTERNAL';
alter table workflow.document_issue enable row level security;
alter table workflow.document_issue force row level security;
create policy document_issue_tenant on workflow.document_issue for all
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
grant select, insert, update on workflow.document_issue to app_rw;
grant select on workflow.document_issue to app_ro;
