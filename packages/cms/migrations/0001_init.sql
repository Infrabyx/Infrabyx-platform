-- @infrabyx/cms 0001: content items and immutable revisions, approvals, redirects, media, the
-- Claims Register and preview tokens (IPB-04 §04.3.1, §04.4.1, §04.4.3; PL5 plan §5.3–§5.6).
-- Expand-only. Requires the roles created by @infrabyx/tenancy 0001.
-- (1) Website content belongs to the platform, not a tenant: every row is `tnt_platform`, read by
--     any context (products render the public shell), written only in a platform context through
--     the kernel with an audit ledger entry in the same transaction (PL5 plan §3.2, §3.3).
-- (2) A revision never changes once written (IPB-04-02): any update is refused for every role.
-- (3) Maker-checker: the checker and the legal reviewer are never the maker, and never each other
--     (PL5-D-06), on approvals and on redirects alike.
-- (4) Soft delete only. The owner approved one purge (OWNER-QUESTIONS #48, PL5-D-05): content,
--     redirects and media soft-deleted more than 90 days ago are deleted by the ledgered purge
--     sweep. PostgreSQL refuses every other delete, whatever the caller.
set lock_timeout = '5s';
set statement_timeout = '60s';

create schema if not exists cms;
revoke all on schema cms from public;
grant usage on schema cms to app_rw, app_ro;

create table cms.content_item (
  id                     text        primary key check (id ~ '^[a-z]{2,3}_[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  tenant_id              text        not null default 'tnt_platform' check (tenant_id = 'tnt_platform'),
  brand_pack_id          text        not null check (brand_pack_id ~ '^brd_[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  content_type           text        not null check (content_type in (
                           'page', 'landing_page', 'section', 'nav_menu', 'footer', 'office', 'blog_post',
                           'vlog_item', 'resource', 'faq', 'glossary_term', 'job', 'team_member', 'press_item',
                           'case_study', 'testimonial', 'legal_page', 'changelog_entry', 'pricing_copy', 'form',
                           'group_company')),
  locale                 text        not null default 'en-IN' check (locale ~ '^[a-z]{2}-[A-Z]{2}$'),
  translation_group_id   text        not null,
  slug                   text        check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  parent_id              text        references cms.content_item (id) on delete set null,
  template               text,
  title                  text        not null check (length(title) between 1 and 300),
  status                 text        not null default 'draft' check (status in (
                           'draft', 'in_review', 'legal_review', 'approved', 'scheduled', 'published', 'archived')),
  current_revision_id    text        not null,
  approved_revision_id   text,
  scheduled_revision_id  text,
  published_revision_id  text,
  published_slug         text,
  published_path         text,
  published_at           timestamptz,
  publish_at             timestamptz,
  unpublish_at           timestamptz,
  needs_legal            boolean     not null default false,
  legal_review_status    text        not null default 'not_required'
                           check (legal_review_status in ('not_required', 'pending', 'approved')),
  machine_translated     boolean     not null default false,
  retired_behaviour      text        check (retired_behaviour in ('gone', 'redirect')),
  owner_user_id          text        not null,
  last_reviewed_at       timestamptz not null default now(),
  seo                    jsonb       not null default '{}',
  claims_refs            text[]      not null default '{}',
  tags                   text[]      not null default '{}',
  deleted_at             timestamptz,
  deleted_by             text,
  created_by             text        not null,
  updated_by             text        not null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint content_item_unpublish_after_publish check (
    unpublish_at is null or publish_at is null or unpublish_at > publish_at),
  constraint content_item_scheduled_has_revision check (
    status <> 'scheduled' or (scheduled_revision_id is not null and publish_at is not null)),
  constraint content_item_published_has_revision check (
    status <> 'published' or published_revision_id is not null),
  constraint content_item_deleted_actor check ((deleted_at is null) = (deleted_by is null))
);
comment on column cms.content_item.id is 'dataclass:PUBLIC';
comment on column cms.content_item.tenant_id is 'dataclass:INTERNAL';
comment on column cms.content_item.brand_pack_id is 'dataclass:PUBLIC';
comment on column cms.content_item.content_type is 'dataclass:PUBLIC';
comment on column cms.content_item.locale is 'dataclass:PUBLIC';
comment on column cms.content_item.translation_group_id is 'dataclass:PUBLIC';
comment on column cms.content_item.slug is 'dataclass:INTERNAL';
comment on column cms.content_item.parent_id is 'dataclass:PUBLIC';
comment on column cms.content_item.template is 'dataclass:PUBLIC';
comment on column cms.content_item.title is 'dataclass:INTERNAL';
comment on column cms.content_item.status is 'dataclass:INTERNAL';
comment on column cms.content_item.current_revision_id is 'dataclass:INTERNAL';
comment on column cms.content_item.approved_revision_id is 'dataclass:INTERNAL';
comment on column cms.content_item.scheduled_revision_id is 'dataclass:INTERNAL';
comment on column cms.content_item.published_revision_id is 'dataclass:PUBLIC';
comment on column cms.content_item.published_slug is 'dataclass:PUBLIC';
comment on column cms.content_item.published_path is 'dataclass:PUBLIC';
comment on column cms.content_item.published_at is 'dataclass:PUBLIC';
comment on column cms.content_item.publish_at is 'dataclass:INTERNAL';
comment on column cms.content_item.unpublish_at is 'dataclass:INTERNAL';
comment on column cms.content_item.needs_legal is 'dataclass:INTERNAL';
comment on column cms.content_item.legal_review_status is 'dataclass:INTERNAL';
comment on column cms.content_item.machine_translated is 'dataclass:INTERNAL';
comment on column cms.content_item.retired_behaviour is 'dataclass:INTERNAL';
comment on column cms.content_item.owner_user_id is 'dataclass:INTERNAL';
comment on column cms.content_item.last_reviewed_at is 'dataclass:PUBLIC';
comment on column cms.content_item.seo is 'dataclass:PUBLIC';
comment on column cms.content_item.claims_refs is 'dataclass:INTERNAL';
comment on column cms.content_item.tags is 'dataclass:PUBLIC';
comment on column cms.content_item.deleted_at is 'dataclass:INTERNAL';
comment on column cms.content_item.deleted_by is 'dataclass:INTERNAL';
comment on column cms.content_item.created_by is 'dataclass:INTERNAL';
comment on column cms.content_item.updated_by is 'dataclass:INTERNAL';
comment on column cms.content_item.created_at is 'dataclass:INTERNAL';
comment on column cms.content_item.updated_at is 'dataclass:INTERNAL';
-- A slug is unique per pack, locale and type among live items; so is a served path.
create unique index content_item_slug_idx on cms.content_item (brand_pack_id, locale, content_type, slug)
  where deleted_at is null and slug is not null;
create unique index content_item_path_idx on cms.content_item (brand_pack_id, locale, published_path)
  where deleted_at is null and published_path is not null;
create unique index content_item_one_footer_idx on cms.content_item (brand_pack_id, locale)
  where deleted_at is null and content_type = 'footer';
create index content_item_schedule_idx on cms.content_item (brand_pack_id, status, publish_at);
create index content_item_unpublish_idx on cms.content_item (unpublish_at) where unpublish_at is not null;
create index content_item_group_idx on cms.content_item (translation_group_id);
create index content_item_parent_idx on cms.content_item (parent_id);
create index content_item_deleted_idx on cms.content_item (deleted_at) where deleted_at is not null;
alter table cms.content_item enable row level security;
alter table cms.content_item force row level security;
create policy content_item_read on cms.content_item for select
  using (tenant_id = current_setting('app.tenant_id', true) or tenant_id = 'tnt_platform');
create policy content_item_insert on cms.content_item for insert
  with check (tenant_id = current_setting('app.tenant_id', true) and current_setting('app.scope', true) = 'platform');
create policy content_item_update on cms.content_item for update
  using (tenant_id = current_setting('app.tenant_id', true) and current_setting('app.scope', true) = 'platform')
  with check (tenant_id = current_setting('app.tenant_id', true) and current_setting('app.scope', true) = 'platform');
create policy content_item_delete on cms.content_item for delete
  using (tenant_id = current_setting('app.tenant_id', true) and current_setting('app.scope', true) = 'platform');
-- The purge is the only delete path (OWNER-QUESTIONS #48).
create policy content_item_delete_purge on cms.content_item as restrictive for delete
  using (deleted_at is not null and deleted_at < now() - interval '90 days');
grant select, insert, update, delete on cms.content_item to app_rw;
grant select on cms.content_item to app_ro;

-- Immutable body snapshots (IPB-04-02). `slug` is the slug the revision publishes under.
create table cms.revision (
  id                  text        primary key check (id ~ '^rev_[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  tenant_id           text        not null default 'tnt_platform' check (tenant_id = 'tnt_platform'),
  content_item_id     text        not null references cms.content_item (id),
  seq                 integer     not null check (seq >= 1),
  title               text        not null,
  slug                text        check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  body                jsonb       not null,
  seo                 jsonb       not null default '{}',
  summary_of_changes  text,
  source              text        not null check (
                        source in ('editor', 'import', 'machine_translation', 'seed')
                        or source ~ '^rollback_of:rev_[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  sanitiser_report    jsonb       not null default '[]',
  created_by          text        not null,
  created_at          timestamptz not null default now(),
  unique (content_item_id, seq)
);
comment on column cms.revision.id is 'dataclass:PUBLIC';
comment on column cms.revision.tenant_id is 'dataclass:INTERNAL';
comment on column cms.revision.content_item_id is 'dataclass:PUBLIC';
comment on column cms.revision.seq is 'dataclass:INTERNAL';
comment on column cms.revision.title is 'dataclass:INTERNAL';
comment on column cms.revision.slug is 'dataclass:INTERNAL';
comment on column cms.revision.body is 'dataclass:INTERNAL';
comment on column cms.revision.seo is 'dataclass:INTERNAL';
comment on column cms.revision.summary_of_changes is 'dataclass:INTERNAL';
comment on column cms.revision.source is 'dataclass:INTERNAL';
comment on column cms.revision.sanitiser_report is 'dataclass:INTERNAL';
comment on column cms.revision.created_by is 'dataclass:INTERNAL';
comment on column cms.revision.created_at is 'dataclass:INTERNAL';
create index revision_body_idx on cms.revision using gin (body);
alter table cms.revision enable row level security;
alter table cms.revision force row level security;
create policy revision_read on cms.revision for select
  using (tenant_id = current_setting('app.tenant_id', true) or tenant_id = 'tnt_platform');
create policy revision_insert on cms.revision for insert
  with check (tenant_id = current_setting('app.tenant_id', true) and current_setting('app.scope', true) = 'platform');
create policy revision_delete on cms.revision for delete
  using (tenant_id = current_setting('app.tenant_id', true) and current_setting('app.scope', true) = 'platform');
create policy revision_delete_purge on cms.revision as restrictive for delete
  using (exists (
    select 1 from cms.content_item i
     where i.id = revision.content_item_id
       and i.deleted_at is not null and i.deleted_at < now() - interval '90 days'));
grant select, insert, delete on cms.revision to app_rw;
grant select on cms.revision to app_ro;

create function cms.revision_immutable() returns trigger language plpgsql as $$
begin
  raise exception 'cms revision % is immutable', old.id using errcode = '42501';
end
$$;
create trigger revision_immutable before update on cms.revision
  for each row execute function cms.revision_immutable();

-- Maker-checker records (IPB-04 §04.4.1, §04.4.3). One row per review of a revision.
create table cms.approval (
  id                 text        primary key check (id ~ '^cap_[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  tenant_id          text        not null default 'tnt_platform' check (tenant_id = 'tnt_platform'),
  content_item_id    text        not null references cms.content_item (id),
  revision_id        text        not null references cms.revision (id),
  action             text        not null check (action in ('publish', 'rollback', 'delete')),
  maker_id           text        not null,
  checker_id         text,
  legal_reviewer_id  text,
  needs_legal        boolean     not null,
  state              text        not null default 'pending'
                       check (state in ('pending', 'approved', 'changes_requested', 'void', 'executed')),
  reason             text,
  created_at         timestamptz not null default now(),
  legal_decided_at   timestamptz,
  decided_at         timestamptz,
  constraint approval_checker_not_maker check (checker_id is null or checker_id <> maker_id),
  constraint approval_legal_not_maker check (legal_reviewer_id is null or legal_reviewer_id <> maker_id),
  constraint approval_checker_not_legal check (
    checker_id is null or legal_reviewer_id is null or checker_id <> legal_reviewer_id),
  constraint approval_approved_checked check (state not in ('approved', 'executed') or checker_id is not null),
  constraint approval_legal_signed check (
    state not in ('approved', 'executed') or not needs_legal or legal_reviewer_id is not null),
  constraint approval_changes_reason check (state <> 'changes_requested' or reason is not null)
);
comment on column cms.approval.id is 'dataclass:INTERNAL';
comment on column cms.approval.tenant_id is 'dataclass:INTERNAL';
comment on column cms.approval.content_item_id is 'dataclass:INTERNAL';
comment on column cms.approval.revision_id is 'dataclass:INTERNAL';
comment on column cms.approval.action is 'dataclass:INTERNAL';
comment on column cms.approval.maker_id is 'dataclass:INTERNAL';
comment on column cms.approval.checker_id is 'dataclass:INTERNAL';
comment on column cms.approval.legal_reviewer_id is 'dataclass:INTERNAL';
comment on column cms.approval.needs_legal is 'dataclass:INTERNAL';
comment on column cms.approval.state is 'dataclass:INTERNAL';
comment on column cms.approval.reason is 'dataclass:INTERNAL';
comment on column cms.approval.created_at is 'dataclass:INTERNAL';
comment on column cms.approval.legal_decided_at is 'dataclass:INTERNAL';
comment on column cms.approval.decided_at is 'dataclass:INTERNAL';
create unique index approval_one_pending_idx on cms.approval (content_item_id, action)
  where state in ('pending', 'approved');
create index approval_revision_idx on cms.approval (revision_id);
alter table cms.approval enable row level security;
alter table cms.approval force row level security;
create policy approval_read on cms.approval for select
  using (tenant_id = current_setting('app.tenant_id', true) or tenant_id = 'tnt_platform');
create policy approval_write on cms.approval for all
  using (tenant_id = current_setting('app.tenant_id', true) and current_setting('app.scope', true) = 'platform')
  with check (tenant_id = current_setting('app.tenant_id', true) and current_setting('app.scope', true) = 'platform');
create policy approval_delete_purge on cms.approval as restrictive for delete
  using (exists (
    select 1 from cms.content_item i
     where i.id = approval.content_item_id
       and i.deleted_at is not null and i.deleted_at < now() - interval '90 days'));
grant select, insert, update, delete on cms.approval to app_rw;
grant select on cms.approval to app_ro;

-- The decision fields are set once; the revision, maker and action never change.
create function cms.approval_guard() returns trigger language plpgsql as $$
begin
  if new.revision_id is distinct from old.revision_id or new.maker_id is distinct from old.maker_id
      or new.action is distinct from old.action or new.content_item_id is distinct from old.content_item_id
      or new.needs_legal is distinct from old.needs_legal or new.created_at is distinct from old.created_at then
    raise exception 'cms approval % is immutable', old.id using errcode = '42501';
  end if;
  if (old.checker_id is not null and new.checker_id is distinct from old.checker_id)
      or (old.legal_reviewer_id is not null and new.legal_reviewer_id is distinct from old.legal_reviewer_id) then
    raise exception 'cms approval % reviewer already recorded', old.id using errcode = '42501';
  end if;
  if old.state in ('changes_requested', 'void', 'executed') and new.state is distinct from old.state then
    raise exception 'cms approval % is closed', old.id using errcode = '42501';
  end if;
  return new;
end
$$;
create trigger approval_guard before update on cms.approval
  for each row execute function cms.approval_guard();

-- Redirects (IPB-04-10, IPB-04-20). A manual or imported redirect is pending until a checker and
-- the legal reviewer approve it (`redirect` is a legal-review type, IPB-04-06); slug-change and
-- retire redirects are created active by the publish that caused them.
create table cms.redirect (
  id                 text        primary key check (id ~ '^rdr_[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  tenant_id          text        not null default 'tnt_platform' check (tenant_id = 'tnt_platform'),
  brand_pack_id      text        not null check (brand_pack_id ~ '^brd_[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  from_path          text        not null check (from_path ~ '^/[^\s?#]*$'),
  to_path            text        check (to_path ~ '^(/[^\s]*|https://[^\s]+)$'),
  status_code        integer     not null check (status_code in (301, 302, 410)),
  source             text        not null check (source in ('manual', 'legacy_import', 'slug_change', 'retire')),
  state              text        not null default 'pending' check (state in ('pending', 'active', 'rejected', 'retired')),
  maker_id           text        not null,
  checker_id         text,
  legal_reviewer_id  text,
  hits               bigint      not null default 0,
  last_hit_at        timestamptz,
  deleted_at         timestamptz,
  deleted_by         text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint redirect_target check ((status_code = 410) = (to_path is null)),
  constraint redirect_checker_not_maker check (checker_id is null or checker_id <> maker_id),
  constraint redirect_legal_not_maker check (legal_reviewer_id is null or legal_reviewer_id <> maker_id),
  constraint redirect_checker_not_legal check (
    checker_id is null or legal_reviewer_id is null or checker_id <> legal_reviewer_id),
  constraint redirect_manual_reviewed check (
    state <> 'active' or source in ('slug_change', 'retire')
    or (checker_id is not null and legal_reviewer_id is not null)),
  constraint redirect_deleted_actor check ((deleted_at is null) = (deleted_by is null))
);
comment on column cms.redirect.id is 'dataclass:INTERNAL';
comment on column cms.redirect.tenant_id is 'dataclass:INTERNAL';
comment on column cms.redirect.brand_pack_id is 'dataclass:PUBLIC';
comment on column cms.redirect.from_path is 'dataclass:PUBLIC';
comment on column cms.redirect.to_path is 'dataclass:PUBLIC';
comment on column cms.redirect.status_code is 'dataclass:PUBLIC';
comment on column cms.redirect.source is 'dataclass:INTERNAL';
comment on column cms.redirect.state is 'dataclass:INTERNAL';
comment on column cms.redirect.maker_id is 'dataclass:INTERNAL';
comment on column cms.redirect.checker_id is 'dataclass:INTERNAL';
comment on column cms.redirect.legal_reviewer_id is 'dataclass:INTERNAL';
comment on column cms.redirect.hits is 'dataclass:INTERNAL';
comment on column cms.redirect.last_hit_at is 'dataclass:INTERNAL';
comment on column cms.redirect.deleted_at is 'dataclass:INTERNAL';
comment on column cms.redirect.deleted_by is 'dataclass:INTERNAL';
comment on column cms.redirect.created_at is 'dataclass:INTERNAL';
comment on column cms.redirect.updated_at is 'dataclass:INTERNAL';
create unique index redirect_from_idx on cms.redirect (brand_pack_id, from_path)
  where deleted_at is null and state in ('pending', 'active');
create index redirect_deleted_idx on cms.redirect (deleted_at) where deleted_at is not null;
alter table cms.redirect enable row level security;
alter table cms.redirect force row level security;
create policy redirect_read on cms.redirect for select
  using (tenant_id = current_setting('app.tenant_id', true) or tenant_id = 'tnt_platform');
create policy redirect_write on cms.redirect for all
  using (tenant_id = current_setting('app.tenant_id', true) and current_setting('app.scope', true) = 'platform')
  with check (tenant_id = current_setting('app.tenant_id', true) and current_setting('app.scope', true) = 'platform');
create policy redirect_delete_purge on cms.redirect as restrictive for delete
  using (deleted_at is not null and deleted_at < now() - interval '90 days');
grant select, insert, update, delete on cms.redirect to app_rw;
grant select on cms.redirect to app_ro;

-- Media metadata (IPB-04-11). Files live in STORAGE under immutable sha256 keys; uploads are
-- served as uploaded until a raster library is approved (OWNER-QUESTIONS #43, #53).
create table cms.media (
  id                 text        primary key check (id ~ '^med_[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  tenant_id          text        not null default 'tnt_platform' check (tenant_id = 'tnt_platform'),
  kind               text        not null check (kind in ('image', 'svg', 'video', 'pdf', 'other')),
  storage_key        text        not null,
  sha256             text        not null check (sha256 ~ '^[0-9a-f]{64}$'),
  mime               text        not null,
  bytes              bigint      not null check (bytes >= 0),
  alt_text           text        check (alt_text is null or length(alt_text) between 1 and 500),
  decorative         boolean     not null default false,
  decorative_reason  text,
  focal_x            numeric(4, 3) check (focal_x between 0 and 1),
  focal_y            numeric(4, 3) check (focal_y between 0 and 1),
  licence_note       text,
  sanitiser_report   jsonb       not null default '[]',
  uploaded_by        text        not null,
  deleted_at         timestamptz,
  deleted_by         text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint media_decorative_reason check (not decorative or decorative_reason is not null),
  constraint media_deleted_actor check ((deleted_at is null) = (deleted_by is null))
);
comment on column cms.media.id is 'dataclass:PUBLIC';
comment on column cms.media.tenant_id is 'dataclass:INTERNAL';
comment on column cms.media.kind is 'dataclass:PUBLIC';
comment on column cms.media.storage_key is 'dataclass:INTERNAL';
comment on column cms.media.sha256 is 'dataclass:PUBLIC';
comment on column cms.media.mime is 'dataclass:PUBLIC';
comment on column cms.media.bytes is 'dataclass:INTERNAL';
comment on column cms.media.alt_text is 'dataclass:PUBLIC';
comment on column cms.media.decorative is 'dataclass:PUBLIC';
comment on column cms.media.decorative_reason is 'dataclass:INTERNAL';
comment on column cms.media.focal_x is 'dataclass:PUBLIC';
comment on column cms.media.focal_y is 'dataclass:PUBLIC';
comment on column cms.media.licence_note is 'dataclass:INTERNAL';
comment on column cms.media.sanitiser_report is 'dataclass:INTERNAL';
comment on column cms.media.uploaded_by is 'dataclass:INTERNAL';
comment on column cms.media.deleted_at is 'dataclass:INTERNAL';
comment on column cms.media.deleted_by is 'dataclass:INTERNAL';
comment on column cms.media.created_at is 'dataclass:INTERNAL';
comment on column cms.media.updated_at is 'dataclass:INTERNAL';
create unique index media_sha_idx on cms.media (sha256) where deleted_at is null;
create index media_deleted_idx on cms.media (deleted_at) where deleted_at is not null;
alter table cms.media enable row level security;
alter table cms.media force row level security;
create policy media_read on cms.media for select
  using (tenant_id = current_setting('app.tenant_id', true) or tenant_id = 'tnt_platform');
create policy media_write on cms.media for all
  using (tenant_id = current_setting('app.tenant_id', true) and current_setting('app.scope', true) = 'platform')
  with check (tenant_id = current_setting('app.tenant_id', true) and current_setting('app.scope', true) = 'platform');
create policy media_delete_purge on cms.media as restrictive for delete
  using (deleted_at is not null and deleted_at < now() - interval '90 days');
grant select, insert, update, delete on cms.media to app_rw;
grant select on cms.media to app_ro;

-- The Claims Register (IPB-04-07, 04-102; IPB-05 §3h; IPB-08-24). An editor proposes a claim; only
-- a PLT_LEGAL_REVIEWER assigns its evidence class and makes it active.
create table cms.claim (
  id                 text        primary key check (id ~ '^clm_[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  tenant_id          text        not null default 'tnt_platform' check (tenant_id = 'tnt_platform'),
  text               text        not null check (length(text) between 1 and 500),
  value              text,
  unit               text,
  as_of              date        not null,
  evidence_class     text        not null default 'E0' check (evidence_class in ('E0', 'E1', 'E2', 'E3', 'E4')),
  kind               text        not null default 'figure'
                       check (kind in ('figure', 'certification', 'audit', 'permission', 'category')),
  source_url         text        check (source_url ~ '^https://'),
  evidence_doc_id    text        check (evidence_doc_id ~ '^vad_'),
  permission_doc_id  text,
  owner_id           text        not null,
  review_due         date        not null,
  status             text        not null default 'proposed'
                       check (status in ('proposed', 'active', 'expired', 'withdrawn')),
  assigned_by        text,
  assigned_at        timestamptz,
  created_by         text        not null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint claim_active_assigned check (status <> 'active' or assigned_by is not null),
  constraint claim_assigner_not_creator check (assigned_by is null or assigned_by <> created_by)
);
comment on column cms.claim.id is 'dataclass:PUBLIC';
comment on column cms.claim.tenant_id is 'dataclass:INTERNAL';
comment on column cms.claim.text is 'dataclass:PUBLIC';
comment on column cms.claim.value is 'dataclass:PUBLIC';
comment on column cms.claim.unit is 'dataclass:PUBLIC';
comment on column cms.claim.as_of is 'dataclass:PUBLIC';
comment on column cms.claim.evidence_class is 'dataclass:INTERNAL';
comment on column cms.claim.kind is 'dataclass:INTERNAL';
comment on column cms.claim.source_url is 'dataclass:INTERNAL';
comment on column cms.claim.evidence_doc_id is 'dataclass:INTERNAL';
comment on column cms.claim.permission_doc_id is 'dataclass:INTERNAL';
comment on column cms.claim.owner_id is 'dataclass:INTERNAL';
comment on column cms.claim.review_due is 'dataclass:INTERNAL';
comment on column cms.claim.status is 'dataclass:INTERNAL';
comment on column cms.claim.assigned_by is 'dataclass:INTERNAL';
comment on column cms.claim.assigned_at is 'dataclass:INTERNAL';
comment on column cms.claim.created_by is 'dataclass:INTERNAL';
comment on column cms.claim.created_at is 'dataclass:INTERNAL';
comment on column cms.claim.updated_at is 'dataclass:INTERNAL';
alter table cms.claim enable row level security;
alter table cms.claim force row level security;
create policy claim_read on cms.claim for select
  using (tenant_id = current_setting('app.tenant_id', true) or tenant_id = 'tnt_platform');
create policy claim_insert on cms.claim for insert
  with check (tenant_id = current_setting('app.tenant_id', true) and current_setting('app.scope', true) = 'platform');
create policy claim_update on cms.claim for update
  using (tenant_id = current_setting('app.tenant_id', true) and current_setting('app.scope', true) = 'platform')
  with check (tenant_id = current_setting('app.tenant_id', true) and current_setting('app.scope', true) = 'platform');
grant select, insert, update on cms.claim to app_rw;
grant select on cms.claim to app_ro;

-- Preview tokens (IPB-04-05): a random 32-byte token stored only as its SHA-256, expiring and
-- revocable (the random, server-side, revocable pattern approved for unsubscribe links, PL3-D-06).
create table cms.preview_token (
  id               text        primary key check (id ~ '^prv_[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  tenant_id        text        not null default 'tnt_platform' check (tenant_id = 'tnt_platform'),
  token_sha256     text        not null unique check (token_sha256 ~ '^[0-9a-f]{64}$'),
  content_item_id  text        not null references cms.content_item (id),
  revision_id      text        not null references cms.revision (id),
  created_by       text        not null,
  expires_at       timestamptz not null,
  revoked_at       timestamptz,
  created_at       timestamptz not null default now(),
  constraint preview_token_ttl check (expires_at <= created_at + interval '24 hours')
);
comment on column cms.preview_token.id is 'dataclass:INTERNAL';
comment on column cms.preview_token.tenant_id is 'dataclass:INTERNAL';
comment on column cms.preview_token.token_sha256 is 'dataclass:CONFIDENTIAL';
comment on column cms.preview_token.content_item_id is 'dataclass:INTERNAL';
comment on column cms.preview_token.revision_id is 'dataclass:INTERNAL';
comment on column cms.preview_token.created_by is 'dataclass:INTERNAL';
comment on column cms.preview_token.expires_at is 'dataclass:INTERNAL';
comment on column cms.preview_token.revoked_at is 'dataclass:INTERNAL';
comment on column cms.preview_token.created_at is 'dataclass:INTERNAL';
create index preview_token_item_idx on cms.preview_token (content_item_id);
alter table cms.preview_token enable row level security;
alter table cms.preview_token force row level security;
-- Tokens are looked up by hash from an anonymous preview request: platform rows, read by any
-- context; only a platform context writes.
create policy preview_token_read on cms.preview_token for select
  using (tenant_id = current_setting('app.tenant_id', true) or tenant_id = 'tnt_platform');
create policy preview_token_write on cms.preview_token for all
  using (tenant_id = current_setting('app.tenant_id', true) and current_setting('app.scope', true) = 'platform')
  with check (tenant_id = current_setting('app.tenant_id', true) and current_setting('app.scope', true) = 'platform');
create policy preview_token_delete_purge on cms.preview_token as restrictive for delete
  using (exists (
    select 1 from cms.content_item i
     where i.id = preview_token.content_item_id
       and i.deleted_at is not null and i.deleted_at < now() - interval '90 days'));
grant select, insert, update, delete on cms.preview_token to app_rw;
grant select on cms.preview_token to app_ro;

-- Transactional outbox and consumer inbox (IPB-01 §01.4.3.3).
create table cms.outbox (
  id             text        primary key,
  tenant_id      text        not null,
  type           text        not null,
  envelope       jsonb       not null,
  created_at     timestamptz not null default now(),
  dispatched_at  timestamptz,
  attempts       integer     not null default 0
);
comment on column cms.outbox.id is 'dataclass:INTERNAL';
comment on column cms.outbox.tenant_id is 'dataclass:INTERNAL';
comment on column cms.outbox.type is 'dataclass:INTERNAL';
comment on column cms.outbox.envelope is 'dataclass:INTERNAL';
comment on column cms.outbox.created_at is 'dataclass:INTERNAL';
comment on column cms.outbox.dispatched_at is 'dataclass:INTERNAL';
comment on column cms.outbox.attempts is 'dataclass:INTERNAL';
create index outbox_pending_idx on cms.outbox (created_at) where dispatched_at is null;
alter table cms.outbox enable row level security;
alter table cms.outbox force row level security;
create policy outbox_tenant on cms.outbox for all
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
grant select, insert, update on cms.outbox to app_rw;
grant select on cms.outbox to app_ro;

create table cms.inbox (
  consumer      text        not null,
  event_id      text        not null,
  tenant_id     text        not null,
  processed_at  timestamptz not null default now(),
  primary key (consumer, event_id)
);
comment on column cms.inbox.consumer is 'dataclass:INTERNAL';
comment on column cms.inbox.event_id is 'dataclass:INTERNAL';
comment on column cms.inbox.tenant_id is 'dataclass:INTERNAL';
comment on column cms.inbox.processed_at is 'dataclass:INTERNAL';
alter table cms.inbox enable row level security;
alter table cms.inbox force row level security;
create policy inbox_tenant on cms.inbox for all
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
grant select, insert on cms.inbox to app_rw;
grant select on cms.inbox to app_ro;
