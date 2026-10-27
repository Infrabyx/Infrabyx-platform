-- @infrabyx/brand 0001: brand packs, their immutable revisions and the group-wide host map
-- (IPB-04 §04.3.2, §04.4.1, §04.4.3; Ecosystem §5.4; PL5 plan §5.2). Expand-only. Requires the
-- roles created by @infrabyx/tenancy 0001. Packs are platform rows (tnt_platform): every context
-- reads them to resolve its host, and only a platform context writes them, through the kernel with
-- an audit ledger entry. A revision's body never changes once written; its checker and legal
-- reviewer are set once each and never equal the maker (maker-checker, IPB-04-31).
set lock_timeout = '5s';
set statement_timeout = '60s';

create schema if not exists brand;
revoke all on schema brand from public;
grant usage on schema brand to app_rw, app_ro;

create table brand.pack (
  id                     text        primary key check (id ~ '^brd_[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  tenant_id              text        not null default 'tnt_platform' check (tenant_id = 'tnt_platform'),
  product                text        not null check (product in ('LD', 'LDC', 'EQ', 'FBX', 'UDF', 'OH', 'GRP')),
  is_default             boolean     not null default false,
  label                  text        not null,
  status                 text        not null default 'draft' check (status in ('draft', 'published')),
  published_revision_id  text,
  created_by             text        not null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint pack_published_has_revision check (status = 'draft' or published_revision_id is not null)
);
comment on column brand.pack.id is 'dataclass:PUBLIC';
comment on column brand.pack.tenant_id is 'dataclass:INTERNAL';
comment on column brand.pack.product is 'dataclass:PUBLIC';
comment on column brand.pack.is_default is 'dataclass:PUBLIC';
comment on column brand.pack.label is 'dataclass:INTERNAL';
comment on column brand.pack.status is 'dataclass:INTERNAL';
comment on column brand.pack.published_revision_id is 'dataclass:PUBLIC';
comment on column brand.pack.created_by is 'dataclass:INTERNAL';
comment on column brand.pack.created_at is 'dataclass:INTERNAL';
comment on column brand.pack.updated_at is 'dataclass:INTERNAL';
-- One default pack per product: the pack an unknown host is served (IPB-04-29).
create unique index pack_one_default_idx on brand.pack (product) where is_default;
alter table brand.pack enable row level security;
alter table brand.pack force row level security;
create policy pack_read on brand.pack for select
  using (tenant_id = current_setting('app.tenant_id', true) or tenant_id = 'tnt_platform');
create policy pack_insert on brand.pack for insert
  with check (tenant_id = current_setting('app.tenant_id', true) and current_setting('app.scope', true) = 'platform');
create policy pack_update on brand.pack for update
  using (tenant_id = current_setting('app.tenant_id', true) and current_setting('app.scope', true) = 'platform')
  with check (tenant_id = current_setting('app.tenant_id', true) and current_setting('app.scope', true) = 'platform');
grant select, insert, update on brand.pack to app_rw;
grant select on brand.pack to app_ro;

-- Revisions: the shared brand_pack shape (Ecosystem §5.4) as JSON, with the draft host list.
create table brand.pack_revision (
  id                     text        primary key check (id ~ '^brv_[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  tenant_id              text        not null default 'tnt_platform' check (tenant_id = 'tnt_platform'),
  pack_id                text        not null references brand.pack (id),
  body                   jsonb       not null,
  hosts                  jsonb       not null default '[]',
  status                 text        not null default 'draft'
                           check (status in ('draft', 'pending_approval', 'rejected', 'published', 'superseded')),
  contrast_guard_passed  boolean     not null,
  svg_sanitised          boolean     not null,
  legal_review_required  boolean     not null default false,
  rollback_of            text        references brand.pack_revision (id),
  maker_id               text        not null,
  submitted_at           timestamptz,
  checker_id             text,
  approved_at            timestamptz,
  legal_reviewer_id      text,
  legal_reviewed_at      timestamptz,
  rejected_reason        text,
  created_at             timestamptz not null default now(),
  constraint revision_checker_not_maker check (checker_id is null or checker_id <> maker_id),
  constraint revision_legal_not_maker check (legal_reviewer_id is null or legal_reviewer_id <> maker_id),
  constraint revision_published_checked check (status not in ('published', 'superseded') or checker_id is not null),
  constraint revision_published_guard check (status not in ('published', 'superseded') or (contrast_guard_passed and svg_sanitised)),
  constraint revision_legal_reviewed check (
    status not in ('published', 'superseded') or not legal_review_required or legal_reviewer_id is not null
  )
);
comment on column brand.pack_revision.id is 'dataclass:PUBLIC';
comment on column brand.pack_revision.tenant_id is 'dataclass:INTERNAL';
comment on column brand.pack_revision.pack_id is 'dataclass:PUBLIC';
comment on column brand.pack_revision.body is 'dataclass:INTERNAL';
comment on column brand.pack_revision.hosts is 'dataclass:INTERNAL';
comment on column brand.pack_revision.status is 'dataclass:INTERNAL';
comment on column brand.pack_revision.contrast_guard_passed is 'dataclass:INTERNAL';
comment on column brand.pack_revision.svg_sanitised is 'dataclass:INTERNAL';
comment on column brand.pack_revision.legal_review_required is 'dataclass:INTERNAL';
comment on column brand.pack_revision.rollback_of is 'dataclass:INTERNAL';
comment on column brand.pack_revision.maker_id is 'dataclass:INTERNAL';
comment on column brand.pack_revision.submitted_at is 'dataclass:INTERNAL';
comment on column brand.pack_revision.checker_id is 'dataclass:INTERNAL';
comment on column brand.pack_revision.approved_at is 'dataclass:INTERNAL';
comment on column brand.pack_revision.legal_reviewer_id is 'dataclass:INTERNAL';
comment on column brand.pack_revision.legal_reviewed_at is 'dataclass:INTERNAL';
comment on column brand.pack_revision.rejected_reason is 'dataclass:INTERNAL';
comment on column brand.pack_revision.created_at is 'dataclass:INTERNAL';
create index pack_revision_pack_idx on brand.pack_revision (pack_id, created_at);
alter table brand.pack_revision enable row level security;
alter table brand.pack_revision force row level security;
create policy pack_revision_read on brand.pack_revision for select
  using (tenant_id = current_setting('app.tenant_id', true) or tenant_id = 'tnt_platform');
create policy pack_revision_insert on brand.pack_revision for insert
  with check (tenant_id = current_setting('app.tenant_id', true) and current_setting('app.scope', true) = 'platform');
create policy pack_revision_update on brand.pack_revision for update
  using (tenant_id = current_setting('app.tenant_id', true) and current_setting('app.scope', true) = 'platform')
  with check (tenant_id = current_setting('app.tenant_id', true) and current_setting('app.scope', true) = 'platform');
grant select, insert, update on brand.pack_revision to app_rw;
grant select on brand.pack_revision to app_ro;

-- The body, hosts, guard results, maker and lineage never change; whether legal review is needed
-- is fixed at submit; reviewers are set once; the status only moves forward (IPB-04 §04.4.3).
create function brand.pack_revision_guard() returns trigger language plpgsql as $$
begin
  if new.body is distinct from old.body or new.hosts is distinct from old.hosts
      or new.pack_id is distinct from old.pack_id or new.maker_id is distinct from old.maker_id
      or new.rollback_of is distinct from old.rollback_of
      or new.contrast_guard_passed is distinct from old.contrast_guard_passed
      or new.svg_sanitised is distinct from old.svg_sanitised
      or (new.legal_review_required is distinct from old.legal_review_required
          and not (old.status = 'draft' and new.status = 'pending_approval'))
      or new.created_at is distinct from old.created_at then
    raise exception 'brand pack revision % is immutable', old.id using errcode = '42501';
  end if;
  if (old.checker_id is not null and new.checker_id is distinct from old.checker_id)
      or (old.legal_reviewer_id is not null and new.legal_reviewer_id is distinct from old.legal_reviewer_id) then
    raise exception 'brand pack revision % reviewer already recorded', old.id using errcode = '42501';
  end if;
  if not (new.status = old.status
      or (old.status = 'draft' and new.status in ('pending_approval', 'rejected'))
      or (old.status = 'pending_approval' and new.status in ('published', 'rejected'))
      or (old.status = 'published' and new.status = 'superseded')) then
    raise exception 'brand pack revision % cannot move from % to %', old.id, old.status, new.status
      using errcode = '42501';
  end if;
  return new;
end
$$;
create trigger pack_revision_guard before update on brand.pack_revision
  for each row execute function brand.pack_revision_guard();

-- The published host map: a host belongs to exactly one pack group-wide (IPB-04-29, Ecosystem §5.4).
create table brand.host (
  host        text        primary key check (host ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'),
  tenant_id   text        not null default 'tnt_platform' check (tenant_id = 'tnt_platform'),
  pack_id     text        not null references brand.pack (id),
  role        text        not null check (role in ('APP', 'PUBLIC', 'API', 'SANDBOX_API', 'MAIL')),
  verified    boolean     not null default false,
  created_at  timestamptz not null default now()
);
comment on column brand.host.host is 'dataclass:PUBLIC';
comment on column brand.host.tenant_id is 'dataclass:INTERNAL';
comment on column brand.host.pack_id is 'dataclass:PUBLIC';
comment on column brand.host.role is 'dataclass:PUBLIC';
comment on column brand.host.verified is 'dataclass:INTERNAL';
comment on column brand.host.created_at is 'dataclass:INTERNAL';
create index host_pack_idx on brand.host (pack_id);
alter table brand.host enable row level security;
alter table brand.host force row level security;
create policy host_read on brand.host for select
  using (tenant_id = current_setting('app.tenant_id', true) or tenant_id = 'tnt_platform');
create policy host_write on brand.host for all
  using (tenant_id = current_setting('app.tenant_id', true) and current_setting('app.scope', true) = 'platform')
  with check (tenant_id = current_setting('app.tenant_id', true) and current_setting('app.scope', true) = 'platform');
grant select, insert, update, delete on brand.host to app_rw;
grant select on brand.host to app_ro;

-- Transactional outbox and consumer inbox (IPB-01 §01.4.3.3).
create table brand.outbox (
  id             text        primary key,
  tenant_id      text        not null,
  type           text        not null,
  envelope       jsonb       not null,
  created_at     timestamptz not null default now(),
  dispatched_at  timestamptz,
  attempts       integer     not null default 0
);
comment on column brand.outbox.id is 'dataclass:INTERNAL';
comment on column brand.outbox.tenant_id is 'dataclass:INTERNAL';
comment on column brand.outbox.type is 'dataclass:INTERNAL';
comment on column brand.outbox.envelope is 'dataclass:INTERNAL';
comment on column brand.outbox.created_at is 'dataclass:INTERNAL';
comment on column brand.outbox.dispatched_at is 'dataclass:INTERNAL';
comment on column brand.outbox.attempts is 'dataclass:INTERNAL';
create index outbox_pending_idx on brand.outbox (created_at) where dispatched_at is null;
alter table brand.outbox enable row level security;
alter table brand.outbox force row level security;
create policy outbox_tenant on brand.outbox for all
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
grant select, insert, update on brand.outbox to app_rw;
grant select on brand.outbox to app_ro;

create table brand.inbox (
  consumer      text        not null,
  event_id      text        not null,
  tenant_id     text        not null,
  processed_at  timestamptz not null default now(),
  primary key (consumer, event_id)
);
comment on column brand.inbox.consumer is 'dataclass:INTERNAL';
comment on column brand.inbox.event_id is 'dataclass:INTERNAL';
comment on column brand.inbox.tenant_id is 'dataclass:INTERNAL';
comment on column brand.inbox.processed_at is 'dataclass:INTERNAL';
alter table brand.inbox enable row level security;
alter table brand.inbox force row level security;
create policy inbox_tenant on brand.inbox for all
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
grant select, insert on brand.inbox to app_rw;
grant select on brand.inbox to app_ro;
