-- @infrabyx/connectors 0007: the TallyPrime adapter of the ACCOUNTING sink and its on-premises
-- agent (Finbyx PR-FBX-46, R1-D-137, R1-D-178; threat model §3.121; plan
-- `docs/phases/R1-tallyprime-plan.md`). Expand-only. Three tables under forced RLS by tenant,
-- written through the kernel with a ledger entry per mutation, and with no delete grant:
--   * `tally_agent`: an enrolled agent: approved under maker-checker, then activated once with
--     its public key; `revoked` is final; one active agent per tenant;
--   * `tally_journal`: one posting per journal id, the batch and its digest immutable,
--     `ACKNOWLEDGED` final;
--   * `tally_read`: trial-balance reads; a `done` or `failed` read is final.
-- An agent's poll that finds no job writes only `last_seq` and `last_poll_at` as
-- `svc_tally_poll`, a role that may update just those two columns (no ledger row, as a
-- rate-limit hit, R1-D-123).
set lock_timeout = '5s';
set statement_timeout = '60s';

create table connectors.tally_agent (
  id               text        primary key check (id ~ '^tga_[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  tenant_id        text        not null,
  name             text        not null check (name ~ '^[\x20-\x7E]{1,80}$'),
  company          text        not null check (length(company) between 1 and 120 and company !~ '[\x00-\x1F\x7F]'),
  state            text        not null default 'approved' check (state in ('approved', 'active', 'revoked')),
  approval_id      text        not null check (approval_id ~ '^apr_[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  requested_by     text        not null check (length(requested_by) between 1 and 200),
  code_sha256      text        check (code_sha256 ~ '^[0-9a-f]{64}$'),
  code_expires_at  timestamptz,
  code_failures    integer     not null default 0 check (code_failures between 0 and 1000),
  code_issued_by   text        check (length(code_issued_by) between 1 and 200),
  public_jwk       jsonb,
  jkt              text        check (jkt ~ '^[A-Za-z0-9_-]{43}$'),
  last_seq         bigint      not null default 0 check (last_seq >= 0),
  last_poll_at     timestamptz,
  agent_version    text        check (agent_version ~ '^[0-9A-Za-z.+-]{1,40}$'),
  enrolled_at      timestamptz,
  revoked_at       timestamptz,
  revoked_by       text        check (length(revoked_by) between 1 and 200),
  revoke_reason    text        check (revoke_reason ~ '^[\x20-\x7E]{1,200}$'),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (public_jwk is null or (jsonb_typeof(public_jwk) = 'object'
    and public_jwk ?& array['kty', 'crv', 'x', 'y']
    and (public_jwk - 'kty' - 'crv' - 'x' - 'y') = '{}'::jsonb
    and public_jwk ->> 'kty' = 'EC' and public_jwk ->> 'crv' = 'P-256')),
  check (state <> 'active' or (public_jwk is not null and jkt is not null and enrolled_at is not null)),
  check ((state = 'revoked') = (revoked_at is not null and revoked_by is not null)),
  check ((code_sha256 is null) = (code_expires_at is null))
);
comment on column connectors.tally_agent.id is 'dataclass:INTERNAL';
comment on column connectors.tally_agent.tenant_id is 'dataclass:INTERNAL';
comment on column connectors.tally_agent.name is 'dataclass:INTERNAL';
comment on column connectors.tally_agent.company is 'dataclass:INTERNAL';
comment on column connectors.tally_agent.state is 'dataclass:INTERNAL';
comment on column connectors.tally_agent.approval_id is 'dataclass:INTERNAL';
comment on column connectors.tally_agent.requested_by is 'dataclass:INTERNAL';
comment on column connectors.tally_agent.code_sha256 is 'dataclass:CONFIDENTIAL';
comment on column connectors.tally_agent.code_expires_at is 'dataclass:INTERNAL';
comment on column connectors.tally_agent.code_failures is 'dataclass:INTERNAL';
comment on column connectors.tally_agent.code_issued_by is 'dataclass:INTERNAL';
comment on column connectors.tally_agent.public_jwk is 'dataclass:INTERNAL';
comment on column connectors.tally_agent.jkt is 'dataclass:INTERNAL';
comment on column connectors.tally_agent.last_seq is 'dataclass:INTERNAL';
comment on column connectors.tally_agent.last_poll_at is 'dataclass:INTERNAL';
comment on column connectors.tally_agent.agent_version is 'dataclass:INTERNAL';
comment on column connectors.tally_agent.enrolled_at is 'dataclass:INTERNAL';
comment on column connectors.tally_agent.revoked_at is 'dataclass:INTERNAL';
comment on column connectors.tally_agent.revoked_by is 'dataclass:INTERNAL';
comment on column connectors.tally_agent.revoke_reason is 'dataclass:INTERNAL';
comment on column connectors.tally_agent.created_at is 'dataclass:INTERNAL';
comment on column connectors.tally_agent.updated_at is 'dataclass:INTERNAL';
create unique index tally_agent_one_active on connectors.tally_agent (tenant_id) where state = 'active';
create index tally_agent_tenant_idx on connectors.tally_agent (tenant_id, created_at);

create function connectors.tally_agent_guard() returns trigger
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
    or new.jkt is distinct from old.jkt or new.enrolled_at is distinct from old.enrolled_at) then
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
create trigger tally_agent_guard before update on connectors.tally_agent
  for each row execute function connectors.tally_agent_guard();

create table connectors.tally_journal (
  tenant_id        text        not null,
  journal_id       text        not null check (journal_id ~ '^[A-Za-z0-9_.:-]{8,128}$'),
  digest           text        not null check (digest ~ '^[0-9a-f]{64}$'),
  batch            jsonb       not null check (jsonb_typeof(batch) = 'object'),
  vouchers         integer     not null check (vouchers between 1 and 1000),
  state            text        not null check (state in ('PENDING', 'ACKNOWLEDGED', 'REJECTED')),
  attempts         integer     not null default 1 check (attempts between 1 and 1000),
  ledger_refs      jsonb       check (ledger_refs is null or jsonb_typeof(ledger_refs) = 'object'),
  reason_code      text        check (reason_code in ('ledger_unknown', 'voucher_type_unknown', 'period_closed',
                                 'company_not_open', 'duplicate_voucher', 'remote_mismatch', 'remote_duplicate',
                                 'tally_unreachable', 'tally_error', 'agent_unreachable', 'too_large')),
  reason           text        check (length(reason) between 1 and 300),
  posted_by        text        not null check (length(posted_by) between 1 and 200),
  queued_at        timestamptz not null default now(),
  claimed_by       text        check (claimed_by ~ '^tga_[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  claimed_attempt  integer,
  lease_until      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  primary key (tenant_id, journal_id),
  check ((state = 'ACKNOWLEDGED') = (ledger_refs is not null)),
  check ((state = 'REJECTED') = (reason_code is not null)),
  check ((claimed_by is null) = (lease_until is null) and (claimed_by is null) = (claimed_attempt is null))
);
comment on column connectors.tally_journal.tenant_id is 'dataclass:INTERNAL';
comment on column connectors.tally_journal.journal_id is 'dataclass:INTERNAL';
comment on column connectors.tally_journal.digest is 'dataclass:INTERNAL';
comment on column connectors.tally_journal.batch is 'dataclass:CONFIDENTIAL';
comment on column connectors.tally_journal.vouchers is 'dataclass:INTERNAL';
comment on column connectors.tally_journal.state is 'dataclass:INTERNAL';
comment on column connectors.tally_journal.attempts is 'dataclass:INTERNAL';
comment on column connectors.tally_journal.ledger_refs is 'dataclass:INTERNAL';
comment on column connectors.tally_journal.reason_code is 'dataclass:INTERNAL';
comment on column connectors.tally_journal.reason is 'dataclass:INTERNAL';
comment on column connectors.tally_journal.posted_by is 'dataclass:INTERNAL';
comment on column connectors.tally_journal.queued_at is 'dataclass:INTERNAL';
comment on column connectors.tally_journal.claimed_by is 'dataclass:INTERNAL';
comment on column connectors.tally_journal.claimed_attempt is 'dataclass:INTERNAL';
comment on column connectors.tally_journal.lease_until is 'dataclass:INTERNAL';
comment on column connectors.tally_journal.created_at is 'dataclass:INTERNAL';
comment on column connectors.tally_journal.updated_at is 'dataclass:INTERNAL';
create index tally_journal_queue_idx on connectors.tally_journal (tenant_id, queued_at) where state = 'PENDING';

create function connectors.tally_journal_guard() returns trigger
  language plpgsql
  set search_path = pg_catalog, pg_temp
as $$
begin
  if new.tenant_id <> old.tenant_id or new.journal_id <> old.journal_id or new.digest <> old.digest
    or new.batch <> old.batch or new.vouchers <> old.vouchers or new.posted_by <> old.posted_by
    or new.created_at <> old.created_at then
    raise exception 'a posted batch never changes; post a new journal id' using errcode = 'P0001';
  end if;
  if old.state = 'ACKNOWLEDGED' then
    raise exception 'an acknowledged batch is final' using errcode = 'P0001';
  end if;
  if new.attempts < old.attempts then
    raise exception 'attempts never go back' using errcode = 'P0001';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
alter function connectors.tally_journal_guard() owner to app_migrate;
revoke all on function connectors.tally_journal_guard() from public;
create trigger tally_journal_guard before update on connectors.tally_journal
  for each row execute function connectors.tally_journal_guard();

create table connectors.tally_read (
  id               text        primary key check (id ~ '^tbr_[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  tenant_id        text        not null,
  as_of            date        not null,
  state            text        not null default 'queued' check (state in ('queued', 'claimed', 'done', 'failed')),
  attempt          integer     not null default 1 check (attempt between 1 and 1000),
  lines            jsonb       check (lines is null or jsonb_typeof(lines) = 'array'),
  total_debit      bigint      check (total_debit >= 0),
  total_credit     bigint      check (total_credit >= 0),
  reason_code      text        check (reason_code in ('ledger_unknown', 'voucher_type_unknown', 'period_closed',
                                 'company_not_open', 'duplicate_voucher', 'remote_mismatch', 'remote_duplicate',
                                 'tally_unreachable', 'tally_error', 'agent_unreachable', 'too_large')),
  requested_by     text        not null check (length(requested_by) between 1 and 200),
  claimed_by       text        check (claimed_by ~ '^tga_[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  lease_until      timestamptz,
  completed_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check ((state = 'done') = (lines is not null and total_debit is not null and total_credit is not null)),
  check ((state = 'failed') = (reason_code is not null)),
  check ((state in ('done', 'failed')) = (completed_at is not null))
);
comment on column connectors.tally_read.id is 'dataclass:INTERNAL';
comment on column connectors.tally_read.tenant_id is 'dataclass:INTERNAL';
comment on column connectors.tally_read.as_of is 'dataclass:INTERNAL';
comment on column connectors.tally_read.state is 'dataclass:INTERNAL';
comment on column connectors.tally_read.attempt is 'dataclass:INTERNAL';
comment on column connectors.tally_read.lines is 'dataclass:CONFIDENTIAL';
comment on column connectors.tally_read.total_debit is 'dataclass:CONFIDENTIAL';
comment on column connectors.tally_read.total_credit is 'dataclass:CONFIDENTIAL';
comment on column connectors.tally_read.reason_code is 'dataclass:INTERNAL';
comment on column connectors.tally_read.requested_by is 'dataclass:INTERNAL';
comment on column connectors.tally_read.claimed_by is 'dataclass:INTERNAL';
comment on column connectors.tally_read.lease_until is 'dataclass:INTERNAL';
comment on column connectors.tally_read.completed_at is 'dataclass:INTERNAL';
comment on column connectors.tally_read.created_at is 'dataclass:INTERNAL';
comment on column connectors.tally_read.updated_at is 'dataclass:INTERNAL';
create index tally_read_as_of_idx on connectors.tally_read (tenant_id, as_of, completed_at);
create index tally_read_queue_idx on connectors.tally_read (tenant_id, created_at) where state in ('queued', 'claimed');

create function connectors.tally_read_guard() returns trigger
  language plpgsql
  set search_path = pg_catalog, pg_temp
as $$
begin
  if new.id <> old.id or new.tenant_id <> old.tenant_id or new.as_of <> old.as_of
    or new.requested_by <> old.requested_by or new.created_at <> old.created_at then
    raise exception 'a trial-balance read keeps its date' using errcode = 'P0001';
  end if;
  if old.state in ('done', 'failed') then
    raise exception 'a % trial-balance read is final', old.state using errcode = 'P0001';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
alter function connectors.tally_read_guard() owner to app_migrate;
revoke all on function connectors.tally_read_guard() from public;
create trigger tally_read_guard before update on connectors.tally_read
  for each row execute function connectors.tally_read_guard();

alter table connectors.tally_agent enable row level security;
alter table connectors.tally_agent force row level security;
create policy tally_agent_tenant on connectors.tally_agent for all
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
alter table connectors.tally_journal enable row level security;
alter table connectors.tally_journal force row level security;
create policy tally_journal_tenant on connectors.tally_journal for all
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
alter table connectors.tally_read enable row level security;
alter table connectors.tally_read force row level security;
create policy tally_read_tenant on connectors.tally_read for all
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));

grant select, insert, update on connectors.tally_agent, connectors.tally_journal, connectors.tally_read to app_rw;
grant select on connectors.tally_agent, connectors.tally_journal, connectors.tally_read to app_ro;

-- The poll path: an agent's request that finds no job stores its sequence number and poll time,
-- and nothing else.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'svc_tally_poll') then
    create role svc_tally_poll nologin nosuperuser nobypassrls nocreatedb nocreaterole;
  end if;
end;
$$;
grant usage on schema connectors to svc_tally_poll;
grant select (id, tenant_id, state, last_seq, last_poll_at) on connectors.tally_agent to svc_tally_poll;
grant update (last_seq, last_poll_at) on connectors.tally_agent to svc_tally_poll;
grant svc_tally_poll to app_rw with inherit false, set true;
