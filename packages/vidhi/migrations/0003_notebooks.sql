-- @infrabyx/vidhi 0003: knowledge notebooks (IPB-03-79 to 03-82, §03.4.10; PL4 plan §8.8; session
-- 7b). Expand-only. Source and output text is sealed with FieldCrypto under the owning tenant's key
-- (never stored in clear); rows keep hashes, classes and provenance.
-- Reading: a tenant reads its own notebooks, the platform's (`tnt_platform`, read-only to tenants),
-- and the outputs of a notebook another tenant shared with it through an approved cross-tenant share
-- (a locked action, IPB-03-81). Sources are never visible outside their tenant.
set lock_timeout = '5s';
set statement_timeout = '60s';

create table vidhi.notebook (
  id           text        primary key check (id ~ '^nbk_[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  tenant_id    text        not null,
  title        text        not null check (length(title) between 1 and 200),
  owner_id     text        not null,
  data_class   text        not null default 'PUBLIC' check (data_class in ('PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'REGULATED')),
  acl          jsonb       not null default '{"users": [], "roles": []}',
  review_date  date,
  reviewer_id  text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
comment on column vidhi.notebook.id is 'dataclass:INTERNAL';
comment on column vidhi.notebook.tenant_id is 'dataclass:INTERNAL';
comment on column vidhi.notebook.title is 'dataclass:INTERNAL';
comment on column vidhi.notebook.owner_id is 'dataclass:INTERNAL';
comment on column vidhi.notebook.data_class is 'dataclass:INTERNAL';
comment on column vidhi.notebook.acl is 'dataclass:INTERNAL';
comment on column vidhi.notebook.review_date is 'dataclass:INTERNAL';
comment on column vidhi.notebook.reviewer_id is 'dataclass:INTERNAL';
comment on column vidhi.notebook.created_at is 'dataclass:INTERNAL';
comment on column vidhi.notebook.updated_at is 'dataclass:INTERNAL';
create index notebook_tenant_idx on vidhi.notebook (tenant_id, created_at);

-- Cross-tenant shares: requested by the owning tenant, active only after the approval executes.
create table vidhi.notebook_share (
  id                bigint      generated always as identity primary key,
  tenant_id         text        not null,
  notebook_id       text        not null references vidhi.notebook (id),
  target_tenant_id  text        not null,
  approval_id       text        not null,
  state             text        not null default 'requested' check (state in ('requested', 'active', 'revoked')),
  created_by        text        not null,
  created_at        timestamptz not null default now(),
  activated_at      timestamptz,
  check (target_tenant_id <> tenant_id)
);
comment on column vidhi.notebook_share.id is 'dataclass:INTERNAL';
comment on column vidhi.notebook_share.tenant_id is 'dataclass:INTERNAL';
comment on column vidhi.notebook_share.notebook_id is 'dataclass:INTERNAL';
comment on column vidhi.notebook_share.target_tenant_id is 'dataclass:INTERNAL';
comment on column vidhi.notebook_share.approval_id is 'dataclass:INTERNAL';
comment on column vidhi.notebook_share.state is 'dataclass:INTERNAL';
comment on column vidhi.notebook_share.created_by is 'dataclass:INTERNAL';
comment on column vidhi.notebook_share.created_at is 'dataclass:INTERNAL';
comment on column vidhi.notebook_share.activated_at is 'dataclass:INTERNAL';
create index notebook_share_target_idx on vidhi.notebook_share (target_tenant_id, notebook_id) where state = 'active';
alter table vidhi.notebook_share enable row level security;
alter table vidhi.notebook_share force row level security;
create policy notebook_share_tenant on vidhi.notebook_share for all
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
-- The receiving tenant sees that an active share exists (to read the shared notebook's outputs).
create policy notebook_share_target on vidhi.notebook_share for select
  using (state = 'active' and target_tenant_id = current_setting('app.tenant_id', true));
grant select, insert on vidhi.notebook_share to app_rw;
grant update (state, activated_at) on vidhi.notebook_share to app_rw;
grant select on vidhi.notebook_share to app_ro;

alter table vidhi.notebook enable row level security;
alter table vidhi.notebook force row level security;
create policy notebook_tenant on vidhi.notebook for all
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
create policy notebook_platform_read on vidhi.notebook for select
  using (tenant_id = 'tnt_platform');
create policy notebook_shared_read on vidhi.notebook for select
  using (exists (select 1 from vidhi.notebook_share s
                  where s.notebook_id = notebook.id and s.state = 'active'
                    and s.target_tenant_id = current_setting('app.tenant_id', true)));
grant select, insert on vidhi.notebook to app_rw;
grant update (title, data_class, acl, review_date, reviewer_id, updated_at) on vidhi.notebook to app_rw;
grant select on vidhi.notebook to app_ro;

create table vidhi.notebook_source (
  id           text        primary key check (id ~ '^src_[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  tenant_id    text        not null,
  notebook_id  text        not null references vidhi.notebook (id),
  kind         text        not null check (kind in ('upload', 'record', 'url')),
  title        text        not null check (length(title) between 1 and 200),
  mime         text,
  ref          text        check (length(ref) <= 2000),
  hash         text        not null check (hash ~ '^[0-9a-f]{64}$'),
  fetched_at   timestamptz not null,
  data_class   text        not null check (data_class in ('PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'REGULATED')),
  acl          jsonb       not null default '{"users": [], "roles": []}',
  text_enc     bytea,
  text_key_id  text,
  chars        integer     not null default 0,
  created_by   text        not null,
  created_at   timestamptz not null default now(),
  check ((kind = 'record') = (text_enc is null))
);
comment on column vidhi.notebook_source.id is 'dataclass:INTERNAL';
comment on column vidhi.notebook_source.tenant_id is 'dataclass:INTERNAL';
comment on column vidhi.notebook_source.notebook_id is 'dataclass:INTERNAL';
comment on column vidhi.notebook_source.kind is 'dataclass:INTERNAL';
comment on column vidhi.notebook_source.title is 'dataclass:INTERNAL';
comment on column vidhi.notebook_source.mime is 'dataclass:INTERNAL';
comment on column vidhi.notebook_source.ref is 'dataclass:INTERNAL';
comment on column vidhi.notebook_source.hash is 'dataclass:INTERNAL';
comment on column vidhi.notebook_source.fetched_at is 'dataclass:INTERNAL';
comment on column vidhi.notebook_source.data_class is 'dataclass:INTERNAL';
comment on column vidhi.notebook_source.acl is 'dataclass:INTERNAL';
comment on column vidhi.notebook_source.text_enc is 'dataclass:REGULATED';
comment on column vidhi.notebook_source.text_key_id is 'dataclass:INTERNAL';
comment on column vidhi.notebook_source.chars is 'dataclass:INTERNAL';
comment on column vidhi.notebook_source.created_by is 'dataclass:INTERNAL';
comment on column vidhi.notebook_source.created_at is 'dataclass:INTERNAL';
create index notebook_source_nbk_idx on vidhi.notebook_source (tenant_id, notebook_id);
alter table vidhi.notebook_source enable row level security;
alter table vidhi.notebook_source force row level security;
create policy notebook_source_tenant on vidhi.notebook_source for all
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
create policy notebook_source_platform_read on vidhi.notebook_source for select
  using (tenant_id = 'tnt_platform');
grant select, insert on vidhi.notebook_source to app_rw;
grant select on vidhi.notebook_source to app_ro;

create table vidhi.notebook_output (
  id           text        primary key check (id ~ '^out_[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  tenant_id    text        not null,
  notebook_id  text        not null references vidhi.notebook (id),
  kind         text        not null check (kind in ('qa', 'faq', 'briefing', 'timeline', 'mindmap', 'flashcards')),
  run_id       text        not null,
  provenance   jsonb       not null,
  data_class   text        not null check (data_class in ('PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'REGULATED')),
  text_enc     bytea       not null,
  text_key_id  text        not null,
  created_by   text        not null,
  created_at   timestamptz not null default now()
);
comment on column vidhi.notebook_output.id is 'dataclass:INTERNAL';
comment on column vidhi.notebook_output.tenant_id is 'dataclass:INTERNAL';
comment on column vidhi.notebook_output.notebook_id is 'dataclass:INTERNAL';
comment on column vidhi.notebook_output.kind is 'dataclass:INTERNAL';
comment on column vidhi.notebook_output.run_id is 'dataclass:INTERNAL';
comment on column vidhi.notebook_output.provenance is 'dataclass:INTERNAL';
comment on column vidhi.notebook_output.data_class is 'dataclass:INTERNAL';
comment on column vidhi.notebook_output.text_enc is 'dataclass:REGULATED';
comment on column vidhi.notebook_output.text_key_id is 'dataclass:INTERNAL';
comment on column vidhi.notebook_output.created_by is 'dataclass:INTERNAL';
comment on column vidhi.notebook_output.created_at is 'dataclass:INTERNAL';
create index notebook_output_nbk_idx on vidhi.notebook_output (tenant_id, notebook_id, created_at);
alter table vidhi.notebook_output enable row level security;
alter table vidhi.notebook_output force row level security;
create policy notebook_output_tenant on vidhi.notebook_output for all
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
create policy notebook_output_platform_read on vidhi.notebook_output for select
  using (tenant_id = 'tnt_platform');
create policy notebook_output_shared_read on vidhi.notebook_output for select
  using (exists (select 1 from vidhi.notebook_share s
                  where s.notebook_id = notebook_output.notebook_id and s.state = 'active'
                    and s.target_tenant_id = current_setting('app.tenant_id', true)));
grant select, insert on vidhi.notebook_output to app_rw;
grant select on vidhi.notebook_output to app_ro;
