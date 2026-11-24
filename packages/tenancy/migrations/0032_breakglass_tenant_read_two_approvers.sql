-- @infrabyx/tenancy 0032: a `read` break-glass grant approved by two tenant managers (owner addition
-- (A) to answer #203, 24 Nov 2026, from Udofin's owner answer #223; R1-D-286). Expand-only: two
-- checks of tenancy/0031 are loosened and its guard trigger function replaced; no column, table,
-- grant or setting. With `PgKernelOptions.breakGlassTenantApproversForRead: 2` a `read` grant, like
-- a `read_write` one, needs two different ORG_OWNER/ORG_ADMIN approvers; the kernel enforces it at
-- use (an approval of a `read` grant by one manager is then `awaiting_second_approval`). So that the
-- table can hold it:
--   * a `read` row may carry a second approver (0031's `access = 'read_write' or second_approver_id
--     is null` is dropped), and may wait for one (`awaiting_second_approval` no longer needs
--     `read_write`). `approved` still needs both approvers for `read_write`, and the expiry still
--     runs at most the window from the final approval (0031's other checks, unchanged);
--   * the guard admits one more forward step: a live `read` approval held by one manager takes a
--     second, different manager's approval, without lengthening its window or its expiry. Every
--     other rule of 0031's guard is kept as it was.
-- 0031 has shipped and is not edited.
set lock_timeout = '5s';
set statement_timeout = '60s';

alter table tenancy.breakglass_tenant_approval drop constraint breakglass_tenant_approval_check4;
alter table tenancy.breakglass_tenant_approval drop constraint breakglass_tenant_approval_check5;
alter table tenancy.breakglass_tenant_approval add constraint breakglass_tenant_approval_awaiting_check
  check (state <> 'awaiting_second_approval'
         or (first_approver_id is not null and second_approver_id is null)) not valid;
alter table tenancy.breakglass_tenant_approval validate constraint breakglass_tenant_approval_awaiting_check;

create or replace function tenancy.breakglass_tenant_approval_guard() returns trigger
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
      -- The row decides on a scoped grant awaiting this tenant, with that grant's own access, so a
      -- read_write grant can never be approved by one manager as if it were read.
      if not exists (select 1 from tenancy.breakglass_tenant_pending() p
                      where p.id = new.grant_id and p.scope_access = new.access) then
        raise exception 'breakglass_tenant_approval: % is not a scoped grant awaiting this tenant with access %',
          new.grant_id, new.access using errcode = '42501';
      end if;
      return new;
    end if;
    if new.tenant_id is distinct from old.tenant_id or new.grant_id is distinct from old.grant_id
       or new.access is distinct from old.access or new.created_at is distinct from old.created_at
       or new.first_approver_id is distinct from old.first_approver_id
       or new.first_approved_at is distinct from old.first_approved_at then
      raise exception 'breakglass_tenant_approval: a decision is never rewritten' using errcode = '42501';
    end if;
    -- 0032: a live `read` approval held by one manager may take a second, different manager's
    -- approval (a product with `breakGlassTenantApproversForRead: 2` admits a `read` grant only
    -- with two), and that step never lengthens the approval: neither its window nor its expiry.
    if old.state = 'approved' and new.state = 'approved' then
      if old.access <> 'read' or old.second_approver_id is not null or old.expires_at <= now()
         or new.second_approver_id is null
         or new.window_minutes > old.window_minutes or new.expires_at > old.expires_at then
        raise exception 'breakglass_tenant_approval: approved cannot become approved here' using errcode = '42501';
      end if;
    elsif not ((old.state = 'awaiting_second_approval' and new.state in ('approved', 'refused', 'revoked'))
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
