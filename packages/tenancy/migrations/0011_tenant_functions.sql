-- @infrabyx/tenancy 0011: named tenant functions (Finbyx PR-FBX-20; IPB-02-33; IPB-02 §02.4.6;
-- R1-D-39). Expand-only. A regulated tenant names the people who hold statutory functions (the
-- CRO who vets a product, the CCO who approves it, the compliance officer; a product adds its own,
-- such as the principal or grievance officer). An assignment:
--   * is created only by the executor of an approved `tenancy.function.assign` request, so a maker
--     asks and a different ORG_OWNER or ORG_ADMIN approves; the assignee approves nothing of it;
--   * is revoked at once by an ORG_OWNER or ORG_ADMIN, and a revoked row never comes back (a new
--     assignment is a new row);
--   * is added to the person's session roles as `FN:<CODE>`, so `mc.checker_roles.<action>` and an
--     action's `checkerFunctions` can require it.
set lock_timeout = '5s';
set statement_timeout = '60s';

create table tenancy.function_assignment (
  id           text        primary key check (id ~ '^fna_[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  tenant_id    text        not null references tenancy.tenant (id),
  user_id      text        not null,
  function     text        not null check (function ~ '^FN:[A-Z][A-Z0-9_]{1,31}$'),
  request_id   text        not null,
  maker_id     text        not null,
  approved_by  text        not null,
  reason       text        not null check (length(reason) between 5 and 500),
  assigned_at  timestamptz not null default now(),
  revoked_at   timestamptz,
  revoked_by   text,
  revoke_reason text       check (revoke_reason is null or length(revoke_reason) between 5 and 500),
  foreign key (tenant_id, user_id) references tenancy.membership (tenant_id, user_id),
  constraint function_assignment_checker check (approved_by <> maker_id and approved_by <> user_id),
  constraint function_assignment_revoked check ((revoked_at is null) = (revoked_by is null))
);
comment on column tenancy.function_assignment.id is 'dataclass:INTERNAL';
comment on column tenancy.function_assignment.tenant_id is 'dataclass:INTERNAL';
comment on column tenancy.function_assignment.user_id is 'dataclass:INTERNAL';
comment on column tenancy.function_assignment.function is 'dataclass:INTERNAL';
comment on column tenancy.function_assignment.request_id is 'dataclass:INTERNAL';
comment on column tenancy.function_assignment.maker_id is 'dataclass:INTERNAL';
comment on column tenancy.function_assignment.approved_by is 'dataclass:INTERNAL';
comment on column tenancy.function_assignment.reason is 'dataclass:INTERNAL';
comment on column tenancy.function_assignment.assigned_at is 'dataclass:INTERNAL';
comment on column tenancy.function_assignment.revoked_at is 'dataclass:INTERNAL';
comment on column tenancy.function_assignment.revoked_by is 'dataclass:INTERNAL';
comment on column tenancy.function_assignment.revoke_reason is 'dataclass:INTERNAL';
create unique index function_assignment_active_idx on tenancy.function_assignment (tenant_id, user_id, function)
  where revoked_at is null;
create index function_assignment_user_idx on tenancy.function_assignment (tenant_id, user_id) where revoked_at is null;
alter table tenancy.function_assignment enable row level security;
alter table tenancy.function_assignment force row level security;
create policy function_assignment_tenant on tenancy.function_assignment for select
  using (tenant_id = current_setting('app.tenant_id', true));
create policy function_assignment_insert on tenancy.function_assignment for insert
  with check (tenant_id = current_setting('app.tenant_id', true));
create policy function_assignment_update on tenancy.function_assignment for update
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
grant select, insert, update on tenancy.function_assignment to app_rw;
grant select on tenancy.function_assignment to app_ro;

-- Only the revocation fields change, once.
create function tenancy.function_assignment_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'tenancy.function_assignment keeps every assignment; revoke it instead' using errcode = '42501';
  end if;
  if old.revoked_at is not null then
    raise exception 'function assignment % is already revoked', old.id using errcode = '42501';
  end if;
  if new.id is distinct from old.id or new.tenant_id is distinct from old.tenant_id
      or new.user_id is distinct from old.user_id or new.function is distinct from old.function
      or new.request_id is distinct from old.request_id or new.maker_id is distinct from old.maker_id
      or new.approved_by is distinct from old.approved_by or new.reason is distinct from old.reason
      or new.assigned_at is distinct from old.assigned_at then
    raise exception 'only the revocation of function assignment % may change', old.id using errcode = '42501';
  end if;
  return new;
end
$$;
create trigger function_assignment_guard before update or delete on tenancy.function_assignment
  for each row execute function tenancy.function_assignment_guard();
