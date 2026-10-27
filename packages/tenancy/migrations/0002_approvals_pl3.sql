-- @infrabyx/tenancy 0002: maker-checker additions for PL3 (plan §5.2, PL3-D-07, PL3-D-19).
-- Expand-only. Expiry is recorded in `expired_at` rather than by widening the `state` CHECK, which
-- would need a drop in the same release; a request with `expired_at` set is terminal (trigger)
-- and the engine reports its state as `expired`.
set lock_timeout = '5s';
set statement_timeout = '60s';

alter table tenancy.approval_request
  add column diff          jsonb,
  add column financial     boolean     not null default false,
  add column expires_at    timestamptz,
  add column expired_at    timestamptz,
  add column reminded_at   timestamptz,
  add column escalated_at  timestamptz;
comment on column tenancy.approval_request.diff is 'dataclass:CONFIDENTIAL';
comment on column tenancy.approval_request.financial is 'dataclass:INTERNAL';
comment on column tenancy.approval_request.expires_at is 'dataclass:INTERNAL';
comment on column tenancy.approval_request.expired_at is 'dataclass:INTERNAL';
comment on column tenancy.approval_request.reminded_at is 'dataclass:INTERNAL';
comment on column tenancy.approval_request.escalated_at is 'dataclass:INTERNAL';

-- An expired request never changes again, and only a pending request can expire.
create function tenancy.approval_expiry_guard() returns trigger
  language plpgsql
  set search_path = pg_catalog, pg_temp
as $$
begin
  if old.expired_at is not null and (
    new.state is distinct from old.state
    or new.expired_at is distinct from old.expired_at
    or new.approved_at is distinct from old.approved_at
    or new.executed_at is distinct from old.executed_at
  ) then
    raise exception 'approval request % has expired', old.id using errcode = 'P0001';
  end if;
  if old.expired_at is null and new.expired_at is not null and (old.state <> 'pending' or new.state <> 'pending') then
    raise exception 'only a pending approval request can expire' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
alter function tenancy.approval_expiry_guard() owner to app_migrate;
revoke all on function tenancy.approval_expiry_guard() from public;
create trigger approval_request_expiry_guard before update on tenancy.approval_request
  for each row execute function tenancy.approval_expiry_guard();
