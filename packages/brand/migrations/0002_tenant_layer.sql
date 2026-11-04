-- @infrabyx/brand 0002: the tenant brand layer over a product's pack (LawDocsComply PR-LDC-26;
-- R1-D-87, M57; IPB-04-24, IPB-04 §04.5 white-label tenant keys). Expand-only. A tenant may set
-- colour tokens the pack already defines, a logo, a favicon, a letterhead, an email identity, a
-- domain and a login message; never the legal entity, terminology or anything else. Each change is
-- a new version made by ORG_ADMIN or ORG_OWNER and applied by a tenant checker through the
-- approvals engine (`brand.tenant_layer.change`, R3), with an audit ledger entry in the same
-- transaction. A version's body never changes once written; a revert is a new version.
set lock_timeout = '5s';
set statement_timeout = '60s';

create table brand.tenant_layer_version (
  tenant_id    text        not null check (tenant_id <> 'tnt_platform'),
  version      integer     not null check (version > 0),
  pack_id      text        not null references brand.pack (id),
  body         jsonb       not null,
  digest       text        not null check (digest ~ '^[0-9a-f]{64}$'),
  domain       text        check (domain ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'),
  status       text        not null default 'pending_approval'
                 check (status in ('pending_approval', 'active', 'superseded', 'withdrawn')),
  approval_id  text,
  revert_of    integer,
  maker_id     text        not null,
  created_at   timestamptz not null default now(),
  activated_at timestamptz,
  primary key (tenant_id, version),
  constraint tenant_layer_revert_fk foreign key (tenant_id, revert_of)
    references brand.tenant_layer_version (tenant_id, version),
  constraint tenant_layer_active_approved check (status not in ('active', 'superseded') or approval_id is not null)
);
comment on column brand.tenant_layer_version.tenant_id is 'dataclass:INTERNAL';
comment on column brand.tenant_layer_version.version is 'dataclass:INTERNAL';
comment on column brand.tenant_layer_version.pack_id is 'dataclass:INTERNAL';
comment on column brand.tenant_layer_version.body is 'dataclass:INTERNAL';
comment on column brand.tenant_layer_version.digest is 'dataclass:INTERNAL';
comment on column brand.tenant_layer_version.domain is 'dataclass:PUBLIC';
comment on column brand.tenant_layer_version.status is 'dataclass:INTERNAL';
comment on column brand.tenant_layer_version.approval_id is 'dataclass:INTERNAL';
comment on column brand.tenant_layer_version.revert_of is 'dataclass:INTERNAL';
comment on column brand.tenant_layer_version.maker_id is 'dataclass:INTERNAL';
comment on column brand.tenant_layer_version.created_at is 'dataclass:INTERNAL';
comment on column brand.tenant_layer_version.activated_at is 'dataclass:INTERNAL';
-- One applied layer and at most one change waiting for a checker, per tenant.
create unique index tenant_layer_one_active_idx on brand.tenant_layer_version (tenant_id) where status = 'active';
create unique index tenant_layer_one_pending_idx on brand.tenant_layer_version (tenant_id) where status = 'pending_approval';
alter table brand.tenant_layer_version enable row level security;
alter table brand.tenant_layer_version force row level security;
create policy tenant_layer_version_tenant on brand.tenant_layer_version for all
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
grant select, insert, update on brand.tenant_layer_version to app_rw;
grant select on brand.tenant_layer_version to app_ro;

-- The body, pack, digest, domain, maker and lineage never change; the approval is recorded once;
-- the status only moves forward (pending to active or withdrawn, active to superseded).
create function brand.tenant_layer_version_guard() returns trigger language plpgsql as $$
begin
  if new.body is distinct from old.body or new.digest is distinct from old.digest
      or new.pack_id is distinct from old.pack_id or new.domain is distinct from old.domain
      or new.maker_id is distinct from old.maker_id or new.revert_of is distinct from old.revert_of
      or new.tenant_id is distinct from old.tenant_id or new.version is distinct from old.version
      or new.created_at is distinct from old.created_at then
    raise exception 'tenant brand layer %/% is immutable', old.tenant_id, old.version using errcode = '42501';
  end if;
  if old.approval_id is not null and new.approval_id is distinct from old.approval_id then
    raise exception 'tenant brand layer %/% approval already recorded', old.tenant_id, old.version
      using errcode = '42501';
  end if;
  if not (new.status = old.status
      or (old.status = 'pending_approval' and new.status in ('active', 'withdrawn'))
      or (old.status = 'active' and new.status = 'superseded')) then
    raise exception 'tenant brand layer %/% cannot move from % to %', old.tenant_id, old.version, old.status, new.status
      using errcode = '42501';
  end if;
  return new;
end
$$;
create trigger tenant_layer_version_guard before update on brand.tenant_layer_version
  for each row execute function brand.tenant_layer_version_guard();

-- The applied tenant domains. A host is unique group-wide across pack hosts (brand.host) and
-- tenant domains. A tenant reads and writes its own row; a context in the platform tenant reads
-- them all, so the host resolver (which runs before any tenant is known) and the pack publish
-- check can see them. No tenant reads another tenant's row.
create table brand.tenant_host (
  host        text        primary key check (host ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'),
  tenant_id   text        not null check (tenant_id <> 'tnt_platform'),
  version     integer     not null,
  pack_id     text        not null references brand.pack (id),
  verified    boolean     not null default false,
  created_at  timestamptz not null default now(),
  constraint tenant_host_version_fk foreign key (tenant_id, version)
    references brand.tenant_layer_version (tenant_id, version)
);
comment on column brand.tenant_host.host is 'dataclass:PUBLIC';
comment on column brand.tenant_host.tenant_id is 'dataclass:INTERNAL';
comment on column brand.tenant_host.version is 'dataclass:INTERNAL';
comment on column brand.tenant_host.pack_id is 'dataclass:INTERNAL';
comment on column brand.tenant_host.verified is 'dataclass:INTERNAL';
comment on column brand.tenant_host.created_at is 'dataclass:INTERNAL';
create index tenant_host_tenant_idx on brand.tenant_host (tenant_id);
alter table brand.tenant_host enable row level security;
alter table brand.tenant_host force row level security;
create policy tenant_host_tenant on brand.tenant_host for all
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
create policy tenant_host_resolve on brand.tenant_host for select
  using (current_setting('app.tenant_id', true) = 'tnt_platform');
grant select, insert, delete on brand.tenant_host to app_rw;
grant select on brand.tenant_host to app_ro;

-- Host uniqueness across both maps, in the database as well as in code (IPB-04-29).
create function brand.tenant_host_free() returns trigger language plpgsql as $$
begin
  if exists (select 1 from brand.host h where h.host = new.host) then
    raise exception 'host % is mapped to a brand pack', new.host using errcode = '23505';
  end if;
  return new;
end
$$;
create trigger tenant_host_free before insert or update on brand.tenant_host
  for each row execute function brand.tenant_host_free();

create function brand.pack_host_free() returns trigger language plpgsql as $$
begin
  if exists (select 1 from brand.tenant_host t where t.host = new.host) then
    raise exception 'host % is a tenant domain', new.host using errcode = '23505';
  end if;
  return new;
end
$$;
create trigger pack_host_free before insert or update on brand.host
  for each row execute function brand.pack_host_free();
