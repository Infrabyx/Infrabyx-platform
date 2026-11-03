-- @infrabyx/tenancy 0013: named officer functions per legal entity (Finbyx PR-FBX-31; IPB-02-33;
-- IPB-02 §02.4.6; R1-D-46). Expand-only. A function a product registers with a policy can be
--   * held for one legal entity (`entity_ref`, the product's entity id) and linked to the
--     product's officer register row (`register_ref`);
--   * held by one person at a time for the tenant or entity (`single_holder`, enforced by the
--     unique index of 0014);
--   * ended only through an approved `tenancy.function.revoke` request (`revoke_request_id`).
-- Rows written before this migration keep their meaning: tenant-wide, any number of holders,
-- revoked at once.
set lock_timeout = '5s';
set statement_timeout = '60s';

alter table tenancy.function_assignment
  add column entity_ref text check (entity_ref is null or entity_ref ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$'),
  add column register_ref text check (register_ref is null or register_ref ~ '^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,127}$'),
  add column single_holder boolean not null default false,
  add column revoke_request_id text;
comment on column tenancy.function_assignment.entity_ref is 'dataclass:INTERNAL';
comment on column tenancy.function_assignment.register_ref is 'dataclass:INTERNAL';
comment on column tenancy.function_assignment.single_holder is 'dataclass:INTERNAL';
comment on column tenancy.function_assignment.revoke_request_id is 'dataclass:INTERNAL';

-- The new columns are written once, with the row; only the revocation fields change, once.
create or replace function tenancy.function_assignment_guard() returns trigger language plpgsql as $$
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
      or new.assigned_at is distinct from old.assigned_at or new.entity_ref is distinct from old.entity_ref
      or new.register_ref is distinct from old.register_ref
      or new.single_holder is distinct from old.single_holder then
    raise exception 'only the revocation of function assignment % may change', old.id using errcode = '42501';
  end if;
  return new;
end
$$;
