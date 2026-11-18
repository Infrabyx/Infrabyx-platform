-- @infrabyx/connectors 0009: the key notices of a TallyPrime agent (owner answer #139 (1);
-- R1-D-186; threat model §3.121). Expand-only. `key_notice_day` is the latest day of the key's
-- life (80 or 85) on which the tenant's administrators were notified that it expires; 0 before
-- the first. It only grows, and it is reset by nothing: a new enrolment is a new agent row.
set lock_timeout = '5s';
set statement_timeout = '60s';

alter table connectors.tally_agent
  add column key_notice_day smallint not null default 0 check (key_notice_day in (0, 80, 85));
comment on column connectors.tally_agent.key_notice_day is 'dataclass:INTERNAL';

create or replace function connectors.tally_agent_guard() returns trigger
  language plpgsql
  set search_path = pg_catalog, pg_temp
as $$
begin
  if new.id <> old.id or new.tenant_id <> old.tenant_id or new.name <> old.name
    or new.company <> old.company or new.approval_id <> old.approval_id
    or new.requested_by <> old.requested_by or new.created_at <> old.created_at then
    raise exception 'a TallyPrime agent keeps who approved it and for which company' using errcode = 'P0001';
  end if;
  if old.state = 'revoked' then
    raise exception 'a revoked TallyPrime agent is final' using errcode = 'P0001';
  end if;
  if old.public_jwk is not null and (new.public_jwk is distinct from old.public_jwk
    or new.jkt is distinct from old.jkt or new.enrolled_at is distinct from old.enrolled_at
    or new.key_protection is distinct from old.key_protection) then
    raise exception 'a TallyPrime agent key is set once; re-enrol to rotate it' using errcode = 'P0001';
  end if;
  if new.last_seq < old.last_seq then
    raise exception 'an agent sequence number never goes back' using errcode = 'P0001';
  end if;
  if new.key_notice_day < old.key_notice_day then
    raise exception 'an agent key notice is never taken back' using errcode = 'P0001';
  end if;
  if old.state = 'active' and new.state = 'approved' then
    raise exception 'an active TallyPrime agent cannot go back to approved' using errcode = 'P0001';
  end if;
  if new.state = 'active' and old.state = 'approved' and new.code_sha256 is not null then
    raise exception 'activating an agent uses up its enrolment code' using errcode = 'P0001';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
alter function connectors.tally_agent_guard() owner to app_migrate;
revoke all on function connectors.tally_agent_guard() from public;
