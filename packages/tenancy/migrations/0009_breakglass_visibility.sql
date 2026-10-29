-- @infrabyx/tenancy 0009: break-glass visible to the tenant (Finbyx PR-FBX-10 item 3; OUT 24, 70;
-- R1-D-28). Expand-only. A break-glass grant is a platform-tenant record the tenant cannot read. When
-- a break-glass context first runs in a tenant, the kernel records it there: one
-- `tenancy.breakglass_use` row per grant and tenant, with who asked, who approved, why, until when,
-- and the first and last use. The tenant reads its rows; nobody writes them except the two SECURITY
-- DEFINER functions below, so a product cannot hide or alter one. The per-tenant notice job claims
-- the new rows (`notified_at`) and raises BreakGlassUsed in the tenant, for the product to notify.
set lock_timeout = '5s';
set statement_timeout = '60s';

create table tenancy.breakglass_use (
  tenant_id          text        not null,
  grant_id           text        not null check (grant_id ~ '^bgr_[0-9A-HJKMNP-TV-Z]{26}$'),
  requester_id       text        not null,
  approver_id        text,
  reason             text        not null,
  expires_at         timestamptz,
  review_ticket_ref  text,
  first_used_at      timestamptz not null default now(),
  last_used_at       timestamptz not null default now(),
  uses               integer     not null default 1 check (uses > 0),
  notified_at        timestamptz,
  primary key (tenant_id, grant_id)
);
comment on column tenancy.breakglass_use.tenant_id is 'dataclass:INTERNAL';
comment on column tenancy.breakglass_use.grant_id is 'dataclass:INTERNAL';
comment on column tenancy.breakglass_use.requester_id is 'dataclass:INTERNAL';
comment on column tenancy.breakglass_use.approver_id is 'dataclass:INTERNAL';
comment on column tenancy.breakglass_use.reason is 'dataclass:CONFIDENTIAL';
comment on column tenancy.breakglass_use.expires_at is 'dataclass:INTERNAL';
comment on column tenancy.breakglass_use.review_ticket_ref is 'dataclass:INTERNAL';
comment on column tenancy.breakglass_use.first_used_at is 'dataclass:INTERNAL';
comment on column tenancy.breakglass_use.last_used_at is 'dataclass:INTERNAL';
comment on column tenancy.breakglass_use.uses is 'dataclass:INTERNAL';
comment on column tenancy.breakglass_use.notified_at is 'dataclass:INTERNAL';
create index breakglass_use_pending_idx on tenancy.breakglass_use (tenant_id) where notified_at is null;

alter table tenancy.breakglass_use enable row level security;
alter table tenancy.breakglass_use force row level security;
create policy breakglass_use_tenant on tenancy.breakglass_use for all
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
revoke all on tenancy.breakglass_use from public, app_rw, app_ro;
grant select on tenancy.breakglass_use to app_rw, app_ro;

-- Record a use of an active grant in the transaction's tenant (the kernel calls it).
create function tenancy.breakglass_touch(p_grant_id text, p_principal_id text) returns boolean
  language plpgsql security definer set search_path = pg_catalog, tenancy
  as $$
  declare
    g record;
    v_tenant text := nullif(current_setting('app.tenant_id', true), '');
    v_first boolean;
  begin
    if v_tenant is null then
      raise exception 'breakglass_touch: no tenant context' using errcode = '42501';
    end if;
    select * into g from tenancy.breakglass_grant
     where id = p_grant_id and requester_id = p_principal_id and state = 'active' and expires_at > now();
    if not found then
      return false;
    end if;
    insert into tenancy.breakglass_use
      (tenant_id, grant_id, requester_id, approver_id, reason, expires_at, review_ticket_ref)
      values (v_tenant, g.id, g.requester_id, g.approver_id, g.reason, g.expires_at, g.review_ticket_ref)
      on conflict (tenant_id, grant_id) do update
        set last_used_at = now(), uses = tenancy.breakglass_use.uses + 1
      returning (xmax = 0) into v_first;
    return v_first;
  end
  $$;
revoke all on function tenancy.breakglass_touch(text, text) from public;
grant execute on function tenancy.breakglass_touch(text, text) to app_rw;

-- The notice job: mark the tenant's new uses notified and return them, once each.
create function tenancy.breakglass_claim_notices(p_limit integer default 100)
  returns setof tenancy.breakglass_use
  language sql security definer set search_path = pg_catalog, tenancy
  as $$
    update tenancy.breakglass_use u set notified_at = now()
     where (u.tenant_id, u.grant_id) in (
       select tenant_id, grant_id from tenancy.breakglass_use
        where tenant_id = current_setting('app.tenant_id', true) and notified_at is null
        order by first_used_at limit p_limit
        for update skip locked)
    returning u.*
  $$;
revoke all on function tenancy.breakglass_claim_notices(integer) from public;
grant execute on function tenancy.breakglass_claim_notices(integer) to app_rw;
