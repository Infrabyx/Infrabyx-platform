-- @infrabyx/connectors 0008: how a TallyPrime agent keeps its key (owner answer #136 (4);
-- R1-D-184; threat model §3.121). Expand-only. `key_protection` is set once at enrolment, with
-- the key: `dpapi` (Windows DPAPI for the agent's account) or `file` (a mode-0600 file, which the
-- agent's view carries as a warning). Rows enrolled before this migration stay null and read as
-- `file`. The guard now keeps `key_protection` set-once like the key itself.
set lock_timeout = '5s';
set statement_timeout = '60s';

alter table connectors.tally_agent
  add column key_protection text check (key_protection in ('dpapi', 'file'));
comment on column connectors.tally_agent.key_protection is 'dataclass:INTERNAL';
alter table connectors.tally_agent
  add constraint tally_agent_key_protection_with_key
  check (key_protection is null or public_jwk is not null);

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
