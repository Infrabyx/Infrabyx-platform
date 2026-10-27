-- @infrabyx/ai 0004: generated images (IPB-03-05, 03-06; owner decision OWN-10; PL4 plan §6,
-- session 5). Expand-only. One row per generated image, written only after the image was labelled
-- (visible "AI-generated image" band and XMP) and stored in the GENERAL bucket. No prompt text is
-- stored, only its hash. Publishing needs an R2 human approval (`ai.image.publish`); a CHECK makes
-- an unlabelled image impossible to approve.
set lock_timeout = '5s';
set statement_timeout = '60s';

create table ai.image (
  id             text        primary key check (id ~ '^img_[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  tenant_id      text        not null,
  feature_key    text        not null,
  use            text        not null check (use in ('marketing', 'blog_hero', 'diagram', 'placeholder')),
  run_id         text        not null check (run_id ~ '^run_'),
  model_id       text        not null,
  prompt_sha256  text        not null check (prompt_sha256 ~ '^[0-9a-f]{64}$'),
  storage_key    text        not null unique,
  sha256         text        not null check (sha256 ~ '^[0-9a-f]{64}$'),
  mime_type      text        not null check (mime_type = 'image/png'),
  width          integer     not null check (width > 0),
  height         integer     not null check (height > 0),
  sgi_label      boolean     not null,
  xmp            boolean     not null,
  state          text        not null default 'generated' check (state in ('generated', 'publish_requested', 'approved')),
  approval_id    text,
  created_by     text        not null,
  created_at     timestamptz not null default now(),
  approved_at    timestamptz,
  constraint image_approved_labelled check (state = 'generated' or (sgi_label and xmp)),
  constraint image_approval_ref check (state = 'generated' or approval_id is not null)
);
comment on column ai.image.id is 'dataclass:INTERNAL';
comment on column ai.image.tenant_id is 'dataclass:INTERNAL';
comment on column ai.image.feature_key is 'dataclass:INTERNAL';
comment on column ai.image.use is 'dataclass:INTERNAL';
comment on column ai.image.run_id is 'dataclass:INTERNAL';
comment on column ai.image.model_id is 'dataclass:INTERNAL';
comment on column ai.image.prompt_sha256 is 'dataclass:INTERNAL';
comment on column ai.image.storage_key is 'dataclass:INTERNAL';
comment on column ai.image.sha256 is 'dataclass:INTERNAL';
comment on column ai.image.mime_type is 'dataclass:INTERNAL';
comment on column ai.image.width is 'dataclass:INTERNAL';
comment on column ai.image.height is 'dataclass:INTERNAL';
comment on column ai.image.sgi_label is 'dataclass:INTERNAL';
comment on column ai.image.xmp is 'dataclass:INTERNAL';
comment on column ai.image.state is 'dataclass:INTERNAL';
comment on column ai.image.approval_id is 'dataclass:INTERNAL';
comment on column ai.image.created_by is 'dataclass:INTERNAL';
comment on column ai.image.created_at is 'dataclass:INTERNAL';
comment on column ai.image.approved_at is 'dataclass:INTERNAL';
create index image_tenant_idx on ai.image (tenant_id, created_at);
alter table ai.image enable row level security;
alter table ai.image force row level security;
create policy image_tenant on ai.image for all
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
grant select, insert on ai.image to app_rw;
grant update (state, approval_id, approved_at) on ai.image to app_rw;
grant select on ai.image to app_ro;
