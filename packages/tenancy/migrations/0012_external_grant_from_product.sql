-- @infrabyx/tenancy 0012: external grants opened from a product's own approved register (Finbyx
-- PR-FBX-22; IPB-08-19; IPB-02-12; R1-D-40). Expand-only.
--   * `source = 'product'` marks a grant a product opened with `ExternalGrants.fromApproved` in the
--     executor's transaction of its own approval (its maker and checker, its approval id kept in
--     `source_approval_id`; `tenancy.external_grant_source` keeps it unique per tenant, a new table
--     so no index is built on the existing one); platform grants keep `source = 'platform'`;
--   * `pii_level` (none, masked, full) and `export_allowed` say how much personal data the grantee
--     may see and whether it may export; existing grants become `masked` and no export, the most
--     restrictive reading of what they were approved for;
--   * `tenancy.external_pii_level()` and `tenancy.external_export_allowed()` give a product's
--     restrictive policies, views and export gate the transaction's grant levels ('none' and false
--     when no grant is active).
set lock_timeout = '5s';
set statement_timeout = '60s';

alter table tenancy.external_grant
  add column source text not null default 'platform' check (source in ('platform', 'product')),
  add column source_approval_id text check (source_approval_id is null or source_approval_id ~ '^[A-Za-z0-9_.:-]{3,120}$'),
  add column pii_level text not null default 'masked' check (pii_level in ('none', 'masked', 'full')),
  add column export_allowed boolean not null default false;
alter table tenancy.external_grant
  add constraint external_grant_source_ref check ((source = 'product') = (source_approval_id is not null));
comment on column tenancy.external_grant.source is 'dataclass:INTERNAL';
comment on column tenancy.external_grant.source_approval_id is 'dataclass:INTERNAL';
comment on column tenancy.external_grant.pii_level is 'dataclass:INTERNAL';
comment on column tenancy.external_grant.export_allowed is 'dataclass:INTERNAL';
grant select (pii_level, export_allowed) on tenancy.external_grant to app_external;

create table tenancy.external_grant_source (
  tenant_id           text not null references tenancy.tenant (id),
  source_approval_id  text not null check (source_approval_id ~ '^[A-Za-z0-9_.:-]{3,120}$'),
  grant_id            text not null unique references tenancy.external_grant (id),
  primary key (tenant_id, source_approval_id)
);
comment on column tenancy.external_grant_source.tenant_id is 'dataclass:INTERNAL';
comment on column tenancy.external_grant_source.source_approval_id is 'dataclass:INTERNAL';
comment on column tenancy.external_grant_source.grant_id is 'dataclass:INTERNAL';
alter table tenancy.external_grant_source enable row level security;
alter table tenancy.external_grant_source force row level security;
create policy external_grant_source_tenant on tenancy.external_grant_source for all to app_rw, app_ro
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
revoke all on tenancy.external_grant_source from public;
grant select, insert on tenancy.external_grant_source to app_rw;
grant select on tenancy.external_grant_source to app_ro;

create function tenancy.external_pii_level() returns text
  language sql stable
  as $$
    select coalesce((
      select g.pii_level from tenancy.external_grant g
       where g.id = pg_catalog.current_setting('app.external_grant', true)
         and g.tenant_id = pg_catalog.current_setting('app.tenant_id', true)
         and g.grantee_id = pg_catalog.current_setting('app.actor_id', true)
         and g.state = 'active' and g.expires_at > pg_catalog.now()), 'none')
  $$;
create function tenancy.external_export_allowed() returns boolean
  language sql stable
  as $$
    select coalesce((
      select g.export_allowed from tenancy.external_grant g
       where g.id = pg_catalog.current_setting('app.external_grant', true)
         and g.tenant_id = pg_catalog.current_setting('app.tenant_id', true)
         and g.grantee_id = pg_catalog.current_setting('app.actor_id', true)
         and g.state = 'active' and g.expires_at > pg_catalog.now()), false)
  $$;
revoke all on function tenancy.external_pii_level() from public;
revoke all on function tenancy.external_export_allowed() from public;
grant execute on function tenancy.external_pii_level() to app_rw, app_ro, app_external;
grant execute on function tenancy.external_export_allowed() to app_rw, app_ro, app_external;
