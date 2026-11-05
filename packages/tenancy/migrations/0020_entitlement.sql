-- @infrabyx/tenancy 0020: tenant entitlements (Finbyx PR-FBX-43; OWNER-QUESTIONS #123; R1-D-107).
-- The licence of a SKU for a tenant, with its dates, set only by Infrabyx until the Operations Hub
-- issues entitlements (OH8, Phase 16e). Expand-only.
--   * `tenancy.entitlement`: insert-only versions per (tenant, SKU); the latest decides. A row is
--     written only by the platform's approved change (`TenantEntitlements.apply`, a platform context
--     whose transaction carries the action `tenancy.entitlement.change`), with who requested it and
--     who approved it, never the same person.
--   * `tenancy.entitlement_notice`: what the tenant is told of and sees on its admin page: every
--     grant, revocation and lapse, once each.
--   * `tenancy.entitlement_status(sku)`: the transaction's tenant's status today (India time):
--     ACTIVE, NOT_YET, LAPSED, REVOKED or NONE; a product's write policy may require ACTIVE.
--     Reads are never refused: a lapsed or revoked licence keeps every record readable.
--   * `tenancy.entitlement_lapses_due()`: grants that ended without a lapse notice, for the sweep.
set lock_timeout = '5s';
set statement_timeout = '60s';

create table tenancy.entitlement (
  id            text        primary key check (id ~ '^lic_[0-9A-HJKMNP-TV-Z]{26}$'),
  tenant_id     text        not null references tenancy.tenant (id),
  sku           text        not null check (sku ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  version       integer     not null check (version >= 1),
  kind          text        not null check (kind in ('GRANT', 'REVOKE')),
  valid_from    date        not null,
  valid_until   date        check (valid_until is null or valid_until >= valid_from),
  reason        text        not null check (length(reason) between 10 and 500),
  requested_by  text        not null check (length(requested_by) between 1 and 255),
  approved_by   text        not null check (length(approved_by) between 1 and 255),
  approval_id   text        not null check (length(approval_id) between 1 and 64),
  recorded_at   timestamptz not null default now(),
  unique (tenant_id, sku, version),
  check (kind = 'GRANT' or valid_until is null),
  check (approved_by <> requested_by)
);
comment on column tenancy.entitlement.id is 'dataclass:INTERNAL';
comment on column tenancy.entitlement.tenant_id is 'dataclass:INTERNAL';
comment on column tenancy.entitlement.sku is 'dataclass:INTERNAL';
comment on column tenancy.entitlement.version is 'dataclass:INTERNAL';
comment on column tenancy.entitlement.kind is 'dataclass:INTERNAL';
comment on column tenancy.entitlement.valid_from is 'dataclass:INTERNAL';
comment on column tenancy.entitlement.valid_until is 'dataclass:INTERNAL';
comment on column tenancy.entitlement.reason is 'dataclass:INTERNAL';
comment on column tenancy.entitlement.requested_by is 'dataclass:INTERNAL';
comment on column tenancy.entitlement.approved_by is 'dataclass:INTERNAL';
comment on column tenancy.entitlement.approval_id is 'dataclass:INTERNAL';
comment on column tenancy.entitlement.recorded_at is 'dataclass:INTERNAL';

create table tenancy.entitlement_notice (
  id              text        primary key check (id ~ '^lcn_[0-9A-HJKMNP-TV-Z]{26}$'),
  tenant_id       text        not null references tenancy.tenant (id),
  entitlement_id  text        not null references tenancy.entitlement (id),
  sku             text        not null check (sku ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  kind            text        not null check (kind in ('GRANT', 'REVOKE', 'LAPSE')),
  version         integer     not null check (version >= 1),
  valid_from      date        not null,
  valid_until     date,
  noticed_at      timestamptz not null default now(),
  unique (entitlement_id, kind)
);
comment on column tenancy.entitlement_notice.id is 'dataclass:INTERNAL';
comment on column tenancy.entitlement_notice.tenant_id is 'dataclass:INTERNAL';
comment on column tenancy.entitlement_notice.entitlement_id is 'dataclass:INTERNAL';
comment on column tenancy.entitlement_notice.sku is 'dataclass:INTERNAL';
comment on column tenancy.entitlement_notice.kind is 'dataclass:INTERNAL';
comment on column tenancy.entitlement_notice.version is 'dataclass:INTERNAL';
comment on column tenancy.entitlement_notice.valid_from is 'dataclass:INTERNAL';
comment on column tenancy.entitlement_notice.valid_until is 'dataclass:INTERNAL';
comment on column tenancy.entitlement_notice.noticed_at is 'dataclass:INTERNAL';

-- The tenant reads its own; only the platform's ledgered paths write.
alter table tenancy.entitlement enable row level security;
alter table tenancy.entitlement force row level security;
create policy entitlement_read on tenancy.entitlement for select to app_rw, app_ro
  using (tenant_id = current_setting('app.tenant_id', true));
create policy entitlement_write on tenancy.entitlement for insert to app_rw
  with check (
    tenant_id = current_setting('app.tenant_id', true)
    and coalesce(current_setting('app.scope', true), '') = 'platform'
    and coalesce(current_setting('app.action', true), '') = 'tenancy.entitlement.change');
revoke all on tenancy.entitlement from public;
grant select on tenancy.entitlement to app_rw, app_ro;
grant insert on tenancy.entitlement to app_rw;

alter table tenancy.entitlement_notice enable row level security;
alter table tenancy.entitlement_notice force row level security;
create policy entitlement_notice_read on tenancy.entitlement_notice for select to app_rw, app_ro
  using (tenant_id = current_setting('app.tenant_id', true));
create policy entitlement_notice_write on tenancy.entitlement_notice for insert to app_rw
  with check (
    tenant_id = current_setting('app.tenant_id', true)
    and coalesce(current_setting('app.scope', true), '') = 'platform'
    and coalesce(current_setting('app.action', true), '') in
      ('tenancy.entitlement.change', 'tenancy.entitlement.lapse'));
revoke all on tenancy.entitlement_notice from public;
grant select on tenancy.entitlement_notice to app_rw, app_ro;
grant insert on tenancy.entitlement_notice to app_rw;

-- Rows are only ever added.
create function tenancy.entitlement_append_only() returns trigger
  language plpgsql set search_path = pg_catalog
  as $$
  begin
    raise exception 'tenancy.% is insert-only; a change is a new version', tg_table_name
      using errcode = '42501';
  end
  $$;
revoke all on function tenancy.entitlement_append_only() from public;
create trigger entitlement_append_only before update or delete on tenancy.entitlement
  for each row execute function tenancy.entitlement_append_only();
create trigger entitlement_no_truncate before truncate on tenancy.entitlement
  for each statement execute function tenancy.entitlement_append_only();
create trigger entitlement_notice_append_only before update or delete on tenancy.entitlement_notice
  for each row execute function tenancy.entitlement_append_only();
create trigger entitlement_notice_no_truncate before truncate on tenancy.entitlement_notice
  for each statement execute function tenancy.entitlement_append_only();

-- Today in India, the day licences are dated in.
create function tenancy.entitlement_today() returns date
  language sql stable set search_path = pg_catalog
  as $$ select (pg_catalog.now() at time zone 'Asia/Kolkata')::date $$;
revoke all on function tenancy.entitlement_today() from public;
grant execute on function tenancy.entitlement_today() to app_rw, app_ro;

-- The transaction's tenant's status of a SKU today. SECURITY DEFINER so a product's write policy
-- (and app_external) can use it; it reads the transaction's tenant only.
create function tenancy.entitlement_status(p_sku text) returns text
  language sql stable security definer set search_path = pg_catalog, tenancy
  as $$
    select case
             when e.id is null then 'NONE'
             when e.kind = 'REVOKE' then 'REVOKED'
             when tenancy.entitlement_today() < e.valid_from then 'NOT_YET'
             when e.valid_until is not null and tenancy.entitlement_today() > e.valid_until then 'LAPSED'
             else 'ACTIVE'
           end
      from (select 1) one
      left join lateral (
        select x.id, x.kind, x.valid_from, x.valid_until from tenancy.entitlement x
         where x.tenant_id = pg_catalog.current_setting('app.tenant_id', true) and x.sku = p_sku
         order by x.version desc limit 1) e on true
  $$;
revoke all on function tenancy.entitlement_status(text) from public;
grant execute on function tenancy.entitlement_status(text) to app_rw, app_ro, app_external;

-- Grants that ended (latest version per tenant and SKU) and have no lapse notice yet.
create function tenancy.entitlement_lapses_due()
  returns table (tenant_id text, entitlement_id text)
  language sql stable security definer set search_path = pg_catalog, tenancy
  as $$
    select l.tenant_id, l.id from (
      select distinct on (e.tenant_id, e.sku) e.*
        from tenancy.entitlement e
       order by e.tenant_id, e.sku, e.version desc) l
     where l.kind = 'GRANT' and l.valid_until is not null
       and l.valid_until < tenancy.entitlement_today()
       and not exists (select 1 from tenancy.entitlement_notice n
                        where n.entitlement_id = l.id and n.kind = 'LAPSE')
     order by l.tenant_id, l.id
  $$;
revoke all on function tenancy.entitlement_lapses_due() from public;
grant execute on function tenancy.entitlement_lapses_due() to app_rw;
