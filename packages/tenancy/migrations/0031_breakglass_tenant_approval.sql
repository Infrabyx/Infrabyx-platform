-- @infrabyx/tenancy 0031: a scoped break-glass grant approved by the tenant it is scoped to (Finbyx
-- PR-FBX-55; owner order of 24 Nov 2026, R1-D-282; built as R1-D-284). Expand-only. A scoped grant
-- (tenancy/0016, R1-D-75) is requested and approved in the platform tenant; this adds the tenant's
-- own decision on each grant, as a maker-checker in the tenant:
--   * `tenancy.breakglass_tenant_approval`: one row per grant and scope tenant, the tenant's own
--     (forced RLS on `app.tenant_id`). A `read` grant is approved by one ORG_OWNER or ORG_ADMIN; a
--     `read_write` grant waits (`awaiting_second_approval`) for a second, different one. The
--     approval lasts at most the grant's duration (never above 240 minutes) from the final approval.
--     The tenant may refuse a grant, or revoke its decision at once; both are final. The checks hold
--     the maker-checker rules, and a trigger refuses any write that is not the acting tenant
--     manager's own step (no break-glass, platform, agent, service or support context; the approver
--     or the ender is `app.actor_id`; only the forward transitions), so neither the platform side
--     nor a product's code can write an approval in a tenant manager's name;
--   * `tenancy.breakglass_tenant_pending()`: SECURITY DEFINER; the scoped grants whose scope tenant
--     is the transaction's own tenant and that are requested or active and unexpired, so the tenant
--     sees what awaits it (the grant rows themselves stay the platform tenant's);
--   * `tenancy.breakglass_tenant_approval_state(grant)`: the tenant's decision on one grant, for
--     the transaction's own tenant: `approved` only while unexpired (else `expired`), `none` when
--     the tenant has not decided. SECURITY INVOKER: it reads only rows RLS already shows.
-- The kernel always enforces a `refused` or `revoked` decision on a scoped grant used in that
-- tenant, and with `PgKernelOptions.requireTenantApprovedBreakGlass` refuses any scoped grant without
-- a live `approved` one. Unscoped break-glass is unchanged. 0016's functions are not edited.
set lock_timeout = '5s';
set statement_timeout = '60s';

create table tenancy.breakglass_tenant_approval (
  tenant_id           text        not null references tenancy.tenant (id),
  grant_id            text        not null check (grant_id ~ '^bgr_[0-9A-HJKMNP-TV-Z]{26}$'),
  access              text        not null check (access in ('read', 'read_write')),
  state               text        not null
                        check (state in ('awaiting_second_approval', 'approved', 'refused', 'revoked')),
  window_minutes      integer     check (window_minutes is null or window_minutes between 1 and 240),
  first_approver_id   text        check (first_approver_id is null or first_approver_id ~ '^[A-Za-z0-9_.:@/+=-]{1,255}$'),
  first_approved_at   timestamptz,
  second_approver_id  text        check (second_approver_id is null or second_approver_id ~ '^[A-Za-z0-9_.:@/+=-]{1,255}$'),
  second_approved_at  timestamptz,
  expires_at          timestamptz,
  ended_by            text        check (ended_by is null or ended_by ~ '^[A-Za-z0-9_.:@/+=-]{1,255}$'),
  ended_at            timestamptz,
  reason              text        check (reason is null or (length(reason) between 1 and 500 and reason !~ '[[:cntrl:]]')),
  created_at          timestamptz not null default now(),
  primary key (tenant_id, grant_id),
  check ((first_approver_id is null) = (first_approved_at is null)),
  check ((second_approver_id is null) = (second_approved_at is null)),
  check ((first_approver_id is null) = (window_minutes is null)),
  check (second_approver_id is null or (first_approver_id is not null and second_approver_id <> first_approver_id)),
  check (access = 'read_write' or second_approver_id is null),
  check (state <> 'awaiting_second_approval'
         or (access = 'read_write' and first_approver_id is not null and second_approver_id is null)),
  check (state <> 'approved'
         or (first_approver_id is not null and expires_at is not null
             and (access = 'read' or second_approver_id is not null))),
  check (expires_at is null
         or (first_approver_id is not null and (access = 'read' or second_approver_id is not null)
             and expires_at <= coalesce(second_approved_at, first_approved_at) + make_interval(mins => window_minutes))),
  check ((state in ('refused', 'revoked')) = (ended_at is not null and ended_by is not null)),
  check ((state = 'refused') = (reason is not null))
);
comment on column tenancy.breakglass_tenant_approval.tenant_id is 'dataclass:INTERNAL';
comment on column tenancy.breakglass_tenant_approval.grant_id is 'dataclass:INTERNAL';
comment on column tenancy.breakglass_tenant_approval.access is 'dataclass:INTERNAL';
comment on column tenancy.breakglass_tenant_approval.state is 'dataclass:INTERNAL';
comment on column tenancy.breakglass_tenant_approval.window_minutes is 'dataclass:INTERNAL';
comment on column tenancy.breakglass_tenant_approval.first_approver_id is 'dataclass:INTERNAL';
comment on column tenancy.breakglass_tenant_approval.first_approved_at is 'dataclass:INTERNAL';
comment on column tenancy.breakglass_tenant_approval.second_approver_id is 'dataclass:INTERNAL';
comment on column tenancy.breakglass_tenant_approval.second_approved_at is 'dataclass:INTERNAL';
comment on column tenancy.breakglass_tenant_approval.expires_at is 'dataclass:INTERNAL';
comment on column tenancy.breakglass_tenant_approval.ended_by is 'dataclass:INTERNAL';
comment on column tenancy.breakglass_tenant_approval.ended_at is 'dataclass:INTERNAL';
comment on column tenancy.breakglass_tenant_approval.reason is 'dataclass:CONFIDENTIAL';
comment on column tenancy.breakglass_tenant_approval.created_at is 'dataclass:INTERNAL';

alter table tenancy.breakglass_tenant_approval enable row level security;
alter table tenancy.breakglass_tenant_approval force row level security;
create policy breakglass_tenant_approval_tenant on tenancy.breakglass_tenant_approval for all to app_rw, app_ro
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
revoke all on tenancy.breakglass_tenant_approval from public;
grant select, insert, update on tenancy.breakglass_tenant_approval to app_rw;
grant select on tenancy.breakglass_tenant_approval to app_ro;

-- Each write is the acting tenant manager's own step, and only a forward one. The kernel sets every
-- `app.*` setting from the verified context and refuses callback SQL that sets one (R1-D-280).
create function tenancy.breakglass_tenant_approval_guard() returns trigger
  language plpgsql set search_path = pg_catalog
  as $$
  declare
    v_actor text := nullif(current_setting('app.actor_id', true), '');
    v_roles text[] := string_to_array(nullif(current_setting('app.roles', true), ''), ',');
  begin
    if coalesce(current_setting('app.breakglass', true), '') <> ''
       or coalesce(current_setting('app.scope', true), '') = 'platform'
       or v_actor is null
       or v_roles is null
       or not (v_roles && array['ORG_OWNER', 'ORG_ADMIN'])
       or exists (select 1 from unnest(v_roles) r where r ~ '^(PLT|AGT|SVC)_') then
      raise exception 'breakglass_tenant_approval: only the tenant''s own ORG_OWNER or ORG_ADMIN decides'
        using errcode = '42501';
    end if;
    if tg_op = 'INSERT' then
      if (new.first_approver_id is not null and new.first_approver_id <> v_actor)
         or new.second_approver_id is not null
         or (new.ended_by is not null and new.ended_by <> v_actor) then
        raise exception 'breakglass_tenant_approval: a decision is the actor''s own' using errcode = '42501';
      end if;
      return new;
    end if;
    if new.tenant_id is distinct from old.tenant_id or new.grant_id is distinct from old.grant_id
       or new.access is distinct from old.access or new.created_at is distinct from old.created_at
       or new.first_approver_id is distinct from old.first_approver_id
       or new.first_approved_at is distinct from old.first_approved_at then
      raise exception 'breakglass_tenant_approval: a decision is never rewritten' using errcode = '42501';
    end if;
    if not ((old.state = 'awaiting_second_approval' and new.state in ('approved', 'refused', 'revoked'))
            or (old.state = 'approved' and new.state = 'revoked')) then
      raise exception 'breakglass_tenant_approval: % cannot become %', old.state, new.state using errcode = '42501';
    end if;
    if new.state = 'approved' and new.second_approver_id is distinct from v_actor then
      raise exception 'breakglass_tenant_approval: a decision is the actor''s own' using errcode = '42501';
    end if;
    if new.state in ('refused', 'revoked')
       and (new.ended_by is distinct from v_actor
            or new.second_approver_id is distinct from old.second_approver_id
            or new.expires_at is distinct from old.expires_at
            or new.window_minutes is distinct from old.window_minutes) then
      raise exception 'breakglass_tenant_approval: a decision is the actor''s own' using errcode = '42501';
    end if;
    return new;
  end
  $$;
revoke all on function tenancy.breakglass_tenant_approval_guard() from public;
create trigger breakglass_tenant_approval_guard before insert or update on tenancy.breakglass_tenant_approval
  for each row execute function tenancy.breakglass_tenant_approval_guard();

-- The scoped grants awaiting or holding the transaction's own tenant's decision: requested, or
-- active and unexpired, and scoped to that tenant. Nothing outside a tenant context.
create function tenancy.breakglass_tenant_pending()
  returns table (id text, requester_id text, approver_id text, reason text, duration_minutes integer,
                 scope_modules text[], scope_access text, state text, requested_at timestamptz,
                 expires_at timestamptz)
  language sql stable security definer set search_path = pg_catalog
  as $$
    select g.id, g.requester_id, g.approver_id, g.reason, g.duration_minutes, g.scope_modules,
           g.scope_access, g.state, g.requested_at, g.expires_at
      from tenancy.breakglass_grant g
     where g.scope_tenant_id = nullif(current_setting('app.tenant_id', true), '')
       and coalesce(current_setting('app.scope', true), '') <> 'platform'
       and (g.state = 'requested' or (g.state = 'active' and g.expires_at > now()))
     order by g.requested_at, g.id
  $$;
revoke all on function tenancy.breakglass_tenant_pending() from public;
grant execute on function tenancy.breakglass_tenant_pending() to app_rw, app_ro;

-- The transaction's own tenant's decision on one grant: none, awaiting_second_approval, approved
-- (while unexpired), expired, refused or revoked.
create function tenancy.breakglass_tenant_approval_state(p_grant_id text) returns text
  language sql stable set search_path = pg_catalog
  as $$
    select coalesce((
      select case when a.state = 'approved' and a.expires_at <= now() then 'expired' else a.state end
        from tenancy.breakglass_tenant_approval a
       where a.tenant_id = nullif(current_setting('app.tenant_id', true), '') and a.grant_id = p_grant_id
    ), 'none')
  $$;
revoke all on function tenancy.breakglass_tenant_approval_state(text) from public;
grant execute on function tenancy.breakglass_tenant_approval_state(text) to app_rw, app_ro;
