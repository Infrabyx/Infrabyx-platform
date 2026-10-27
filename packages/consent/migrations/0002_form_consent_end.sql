-- @infrabyx/consent 0002: the end of life of form consents for marketing leads (OWNER-QUESTIONS #57,
-- PL5-D-11; the owner's approval of this deletion rule; IPB-05 template 9 "Marketing leads (no
-- customer relationship): 24 months from the last interaction"). Expand-only.
-- (1) `consent.subject_status` holds, per person (`principal_ref`, or `cid:<cid>` for a cookie-only
--     subject), the last interaction the product reported, whether the person has an active
--     relationship (a customer, an applicant in process), and a legal hold placed by a
--     PLT_LEGAL_REVIEWER.
-- (2) A FORM record for a lead contact (`LEAD_CONTACT` purpose) with no later record ends 24 months
--     after the last interaction (the later of the record and the reported interaction). Like every
--     other consent record it is then deleted by the ledgered sweep 3 years after its end (#48),
--     unless the person has an active relationship.
-- (3) A legal hold stops every consent-record deletion for that person.
-- (4) A status row goes with its person: the sweep deletes it once no consent record refers to it,
--     24 months after its last change, never under legal hold.
set lock_timeout = '5s';
set statement_timeout = '60s';

create table consent.subject_status (
  tenant_id            text        not null,
  subject_ref          text        not null check (length(subject_ref) between 3 and 120),
  last_interaction_at  timestamptz,
  active_relationship  boolean     not null default false,
  legal_hold           boolean     not null default false,
  hold_reason          text        check (hold_reason is null or length(hold_reason) between 5 and 500),
  updated_at           timestamptz not null default now(),
  primary key (tenant_id, subject_ref),
  constraint subject_status_hold_reason check (not legal_hold or hold_reason is not null)
);
comment on column consent.subject_status.tenant_id is 'dataclass:INTERNAL';
comment on column consent.subject_status.subject_ref is 'dataclass:CONFIDENTIAL';
comment on column consent.subject_status.last_interaction_at is 'dataclass:INTERNAL';
comment on column consent.subject_status.active_relationship is 'dataclass:CONFIDENTIAL';
comment on column consent.subject_status.legal_hold is 'dataclass:INTERNAL';
comment on column consent.subject_status.hold_reason is 'dataclass:CONFIDENTIAL';
comment on column consent.subject_status.updated_at is 'dataclass:INTERNAL';
alter table consent.subject_status enable row level security;
alter table consent.subject_status force row level security;
create policy subject_status_tenant on consent.subject_status for all
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
-- (4): only orphaned, unheld rows 24 months after their last change.
create policy subject_status_delete_orphan on consent.subject_status as restrictive for delete
  using (
    not legal_hold and updated_at < now() - interval '24 months'
    and not exists (
      select 1 from consent.record r
       where r.tenant_id = subject_status.tenant_id
         and coalesce(r.principal_ref, 'cid:' || r.cid) = subject_status.subject_ref));
grant select, insert, update, delete on consent.subject_status to app_rw;
grant select on consent.subject_status to app_ro;

-- (2) and (3): the purge rule of 0001 plus the form-lead end of life, all under the legal hold.
alter policy record_delete_retention on consent.record
  using (
    not exists (
      select 1 from consent.subject_status h
       where h.tenant_id = record.tenant_id and h.legal_hold
         and h.subject_ref = coalesce(record.principal_ref, 'cid:' || record.cid))
    and (
      exists (
        select 1 from consent.record n
         where n.tenant_id = record.tenant_id and n.recorded_at > record.recorded_at
           and coalesce(n.brand_pack_id, '') = coalesce(record.brand_pack_id, '')
           and ((record.cid is not null and n.cid = record.cid)
                or (record.principal_ref is not null and n.principal_ref = record.principal_ref))
           and n.recorded_at < now() - interval '3 years')
      or (record.method in ('CMP_BANNER', 'PREFERENCE_CENTRE')
          and record.recorded_at < now() - interval '3 years' - interval '365 days')
      or (record.method = 'FORM' and 'LEAD_CONTACT' = any(record.purposes)
          and not exists (
            select 1 from consent.subject_status s
             where s.tenant_id = record.tenant_id and s.active_relationship
               and s.subject_ref = coalesce(record.principal_ref, 'cid:' || record.cid))
          and greatest(record.recorded_at, coalesce((
            select s.last_interaction_at from consent.subject_status s
             where s.tenant_id = record.tenant_id
               and s.subject_ref = coalesce(record.principal_ref, 'cid:' || record.cid)), record.recorded_at))
              < now() - interval '24 months' - interval '3 years')));

-- The sweep's tenant finder also sees status rows (tenants and times only; no write grant).
grant select (tenant_id, updated_at) on consent.subject_status to svc_consent_sweep;
create policy subject_status_sweep on consent.subject_status for select to svc_consent_sweep
  using (current_setting('app.scope', true) = 'platform');
