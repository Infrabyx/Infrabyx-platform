-- @infrabyx/config 0002: saved table views and column layouts (IPB-07-13, @IPB-07-AT-08; Finbyx
-- PR-FBX-09, R1-D-32). Expand-only. A personal view and a layout are their owner's alone, under
-- forced RLS on `app.actor_id`; shared views are visible in the tenant and trimmed to their
-- audience by `SavedViews`. Rows are written only through the mutation kernel, which ledgers each.
set lock_timeout = '5s';
set statement_timeout = '60s';

create table config.saved_view (
  id          text        primary key check (id ~ '^svw_[0-9A-HJKMNP-TV-Z]{26}$'),
  tenant_id   text        not null,
  table_key   text        not null check (table_key ~ '^[a-z0-9][a-z0-9_.-]{0,99}$'),
  name        text        not null check (char_length(name) between 1 and 80),
  owner_id    text        not null,
  audience    text        not null check (audience in ('personal', 'team', 'roles', 'tenant')),
  team_id     text,
  roles       text[],
  is_default  boolean     not null default false,
  state       jsonb       not null check (jsonb_typeof(state) = 'object'),
  version     integer     not null default 1 check (version > 0),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  text        not null,
  constraint saved_view_audience check (
    (audience = 'team' and team_id is not null and roles is null)
    or (audience = 'roles' and team_id is null and cardinality(roles) between 1 and 10)
    or (audience in ('personal', 'tenant') and team_id is null and roles is null)
  ),
  constraint saved_view_default check (not is_default or audience in ('personal', 'tenant')),
  constraint saved_view_name unique (tenant_id, table_key, owner_id, name)
);
comment on column config.saved_view.id is 'dataclass:INTERNAL';
comment on column config.saved_view.tenant_id is 'dataclass:INTERNAL';
comment on column config.saved_view.table_key is 'dataclass:INTERNAL';
comment on column config.saved_view.name is 'dataclass:CONFIDENTIAL';
comment on column config.saved_view.owner_id is 'dataclass:INTERNAL';
comment on column config.saved_view.audience is 'dataclass:INTERNAL';
comment on column config.saved_view.team_id is 'dataclass:INTERNAL';
comment on column config.saved_view.roles is 'dataclass:INTERNAL';
comment on column config.saved_view.is_default is 'dataclass:INTERNAL';
comment on column config.saved_view.state is 'dataclass:CONFIDENTIAL';
comment on column config.saved_view.version is 'dataclass:INTERNAL';
comment on column config.saved_view.created_at is 'dataclass:INTERNAL';
comment on column config.saved_view.updated_at is 'dataclass:INTERNAL';
comment on column config.saved_view.updated_by is 'dataclass:INTERNAL';
create index saved_view_table_idx on config.saved_view (tenant_id, table_key);
-- One personal default per person and table; one tenant default per table.
create unique index saved_view_personal_default on config.saved_view (tenant_id, table_key, owner_id)
  where is_default and audience = 'personal';
create unique index saved_view_tenant_default on config.saved_view (tenant_id, table_key)
  where is_default and audience = 'tenant';

alter table config.saved_view enable row level security;
alter table config.saved_view force row level security;
-- A personal view is read only by its owner; a shared one by the tenant (audience trimmed above).
create policy saved_view_read on config.saved_view for select
  using (
    tenant_id = current_setting('app.tenant_id', true)
    and (audience <> 'personal' or owner_id = current_setting('app.actor_id', true))
  );
create policy saved_view_insert on config.saved_view for insert
  with check (
    tenant_id = current_setting('app.tenant_id', true)
    and owner_id = current_setting('app.actor_id', true)
    and updated_by = owner_id
  );
-- The owner changes their own; an ORG_ADMIN or ORG_OWNER (checked by SavedViews) also a roles or
-- tenant view. Ownership never moves.
create policy saved_view_update on config.saved_view for update
  using (
    tenant_id = current_setting('app.tenant_id', true)
    and (owner_id = current_setting('app.actor_id', true) or audience in ('roles', 'tenant'))
  )
  with check (
    tenant_id = current_setting('app.tenant_id', true)
    and updated_by = current_setting('app.actor_id', true)
    and (owner_id = current_setting('app.actor_id', true) or audience in ('roles', 'tenant'))
  );
create policy saved_view_delete on config.saved_view for delete
  using (
    tenant_id = current_setting('app.tenant_id', true)
    and (owner_id = current_setting('app.actor_id', true) or audience in ('roles', 'tenant'))
  );
grant select, insert, update, delete on config.saved_view to app_rw;
grant select on config.saved_view to app_ro;

-- The column chooser's state per person and table (show, hide, order; row density).
create table config.table_layout (
  tenant_id   text        not null,
  user_id     text        not null,
  table_key   text        not null check (table_key ~ '^[a-z0-9][a-z0-9_.-]{0,99}$'),
  columns     text[]      not null check (cardinality(columns) <= 100),
  density     text        not null default 'comfortable' check (density in ('compact', 'comfortable')),
  updated_at  timestamptz not null default now(),
  primary key (tenant_id, user_id, table_key)
);
comment on column config.table_layout.tenant_id is 'dataclass:INTERNAL';
comment on column config.table_layout.user_id is 'dataclass:INTERNAL';
comment on column config.table_layout.table_key is 'dataclass:INTERNAL';
comment on column config.table_layout.columns is 'dataclass:INTERNAL';
comment on column config.table_layout.density is 'dataclass:INTERNAL';
comment on column config.table_layout.updated_at is 'dataclass:INTERNAL';
alter table config.table_layout enable row level security;
alter table config.table_layout force row level security;
create policy table_layout_owner on config.table_layout for all
  using (
    tenant_id = current_setting('app.tenant_id', true)
    and user_id = current_setting('app.actor_id', true)
  )
  with check (
    tenant_id = current_setting('app.tenant_id', true)
    and user_id = current_setting('app.actor_id', true)
  );
grant select, insert, update, delete on config.table_layout to app_rw;
grant select on config.table_layout to app_ro;
