-- @infrabyx/audit 0005: one ledger entry for a job step over many resources (Finbyx PR-FBX-30;
-- IPB-02-51; R1-D-41). Expand-only. A nightly job that changes many rows in one transaction (each
-- in its own kernel unit, so one failure rolls back alone) writes one `audit.ledger` entry naming
-- the run, the step and the members' type (`resource_type = 'job_step'`, `resource_id =
-- '<run>/<step>/<type>'`) and lists the
-- resources it changed here, in order. The entry's `after_digest` is the canonical digest of the
-- run, the step, the resource type and the full id list, so a changed or missing member row is
-- found by `verifyBatch`. Members are append-only for every role, like the ledger.
set lock_timeout = '5s';
set statement_timeout = '60s';

create table audit.batch_member (
  tenant_id    text    not null check (tenant_id ~ '^[A-Za-z0-9_]{1,64}$'),
  ledger_id    text    not null,
  ordinal      integer not null check (ordinal >= 0),
  resource_id  text    not null check (resource_id ~ '^[A-Za-z0-9_.:@/+=-]{1,255}$'),
  primary key (ledger_id, ordinal)
);
comment on column audit.batch_member.tenant_id is 'dataclass:INTERNAL';
comment on column audit.batch_member.ledger_id is 'dataclass:INTERNAL';
comment on column audit.batch_member.ordinal is 'dataclass:INTERNAL';
comment on column audit.batch_member.resource_id is 'dataclass:INTERNAL';
create index batch_member_resource_idx on audit.batch_member (tenant_id, resource_id);
alter table audit.batch_member enable row level security;
alter table audit.batch_member force row level security;
create policy batch_member_read on audit.batch_member for select
  using (tenant_id = current_setting('app.tenant_id', true));
create policy batch_member_append on audit.batch_member for insert
  with check (tenant_id = current_setting('app.tenant_id', true));
revoke all on audit.batch_member from public;
grant select, insert on audit.batch_member to app_rw;
grant select on audit.batch_member to app_ro;
create trigger batch_member_no_update before update or delete on audit.batch_member
  for each row execute function audit.refuse_change();
create trigger batch_member_no_truncate before truncate on audit.batch_member
  for each statement execute function audit.refuse_change();

-- A member belongs to a job-step entry of its own tenant (checked here rather than by a foreign key,
-- so the ledger keeps refusing TRUNCATE through its own append-only trigger).
create function audit.batch_member_guard() returns trigger language plpgsql as $$
begin
  if not exists (
    select 1 from audit.ledger l
     where l.id = new.ledger_id and l.tenant_id = new.tenant_id and l.resource_type = 'job_step') then
    raise exception 'batch member of % must name a job_step entry of the same tenant', new.ledger_id
      using errcode = '42501';
  end if;
  return new;
end
$$;
create trigger batch_member_guard before insert on audit.batch_member
  for each row execute function audit.batch_member_guard();
