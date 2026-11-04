-- @infrabyx/consent 0004: platform purpose notices and the purpose-consent purge (LawDocsComply
-- PR-LDC-14; OWNER-QUESTIONS #95, the owner's approval of this deletion rule; R1-plan M41; R1-D-72;
-- IPB-04 §04.3.12 section 12: PLT_DPO maker, PLT_LEGAL_REVIEWER checker). Expand-only: one nullable
-- column, policies and triggers; no row is changed.
-- (1) Platform-tier notices are `consent.purpose_notice` rows of `tnt_platform`. Every tenant reads
--     the approved and retired ones (never a draft) and may cite them when recording consent. Only
--     a platform-scope transaction in `tnt_platform` (a PLT_* principal, checked by the kernel) may
--     insert or change one; a tenant-scope transaction never can, whatever its tenant.
-- (2) #95: purpose-consent records and their notice versions are kept 8 years after the
--     relationship ends or the consent is withdrawn, then purged by the ledgered sweep; a legal
--     hold (`consent.subject_status.legal_hold`, 0002) stops it. Deletion is on the locked list, so
--     the later of the two clocks applies: a record may go only when the relationship the product
--     reported has ended (`relationship_ended_at`; null = not ended, so never) at least 8 years
--     after the later of that end and the record, and any withdrawal of that purpose by that person
--     at or after the record is also at least 8 years old. A withdrawn consent is kept while the
--     relationship continues. The 8 years are fixed here; no setting shortens them. A notice
--     version goes only when retired and no record anywhere
--     cites it (the foreign key from `purpose_record`, checked across tenants). Every other delete,
--     and every update of a record, is still refused for every caller. A subject status row (0002)
--     now stays while any purpose-consent record of the person remains.
set lock_timeout = '5s';
set statement_timeout = '60s';

-- (1) Reads: a tenant's own notices, plus the platform's approved and retired ones.
alter policy purpose_notice_tenant on consent.purpose_notice
  using (tenant_id = current_setting('app.tenant_id', true)
         or (tenant_id = 'tnt_platform' and state <> 'draft'));
-- (1) Writes: a platform row only from a platform-scope transaction.
alter policy purpose_notice_insert on consent.purpose_notice
  with check (tenant_id = current_setting('app.tenant_id', true)
              and (tenant_id <> 'tnt_platform' or current_setting('app.scope', true) = 'platform'));
alter policy purpose_notice_update on consent.purpose_notice
  using (tenant_id = current_setting('app.tenant_id', true)
         and (tenant_id <> 'tnt_platform' or current_setting('app.scope', true) = 'platform'))
  with check (tenant_id = current_setting('app.tenant_id', true)
              and (tenant_id <> 'tnt_platform' or current_setting('app.scope', true) = 'platform'));

-- (2) The relationship end, reported by the product; null means the relationship has not ended.
alter table consent.subject_status add column relationship_ended_at timestamptz;
comment on column consent.subject_status.relationship_ended_at is 'dataclass:CONFIDENTIAL';
-- A status row now also carries #95's relationship end, so it stays while any purpose-consent
-- record of the person remains (0002's rule, narrowed: it only keeps more).
alter policy subject_status_delete_orphan on consent.subject_status
  using (
    not legal_hold and updated_at < now() - interval '24 months'
    and not exists (
      select 1 from consent.record r
       where r.tenant_id = subject_status.tenant_id
         and coalesce(r.principal_ref, 'cid:' || r.cid) = subject_status.subject_ref)
    and not exists (
      select 1 from consent.purpose_record p
       where p.tenant_id = subject_status.tenant_id and p.subject_ref = subject_status.subject_ref));

-- (2) Deletes run only as the #95 sweep (its action and principal, set by the kernel) and only for
-- rows the restrictive policies below allow; an update of a record is refused as before.
create function consent.purpose_purge_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE'
      and current_setting('app.action', true) in ('consent.purpose.purge', 'consent.purpose_notice.purge')
      and current_setting('app.actor_id', true) = 'svc_consent_sweep' then
    return old;
  end if;
  raise exception '%.% is append-only (only the #95 purge deletes)', tg_table_schema, tg_table_name
    using errcode = '42501';
end
$$;
create or replace trigger purpose_record_append_only before update or delete on consent.purpose_record
  for each row execute function consent.purpose_purge_guard();
create or replace trigger purpose_notice_no_delete before delete on consent.purpose_notice
  for each row execute function consent.purpose_purge_guard();

create policy purpose_record_delete on consent.purpose_record for delete
  using (tenant_id = current_setting('app.tenant_id', true));
create policy purpose_record_delete_retention on consent.purpose_record as restrictive for delete
  using (
    not exists (
      select 1 from consent.subject_status h
       where h.tenant_id = purpose_record.tenant_id and h.subject_ref = purpose_record.subject_ref
         and h.legal_hold)
    and exists (
      select 1 from consent.subject_status s
       where s.tenant_id = purpose_record.tenant_id and s.subject_ref = purpose_record.subject_ref
         and not s.active_relationship and s.relationship_ended_at is not null
         and greatest(s.relationship_ended_at, purpose_record.recorded_at) < now() - interval '8 years')
    and not exists (
      select 1 from consent.purpose_record w
       where w.tenant_id = purpose_record.tenant_id and w.subject_ref = purpose_record.subject_ref
         and w.purpose = purpose_record.purpose and w.action = 'withdrawn'
         and w.recorded_at >= purpose_record.recorded_at
         and w.recorded_at >= now() - interval '8 years'));
grant delete on consent.purpose_record to app_rw;

create policy purpose_notice_delete on consent.purpose_notice for delete
  using (tenant_id = current_setting('app.tenant_id', true));
create policy purpose_notice_delete_retention on consent.purpose_notice as restrictive for delete
  using (
    state = 'retired'
    and not exists (select 1 from consent.purpose_record r where r.notice_id = purpose_notice.id));
grant delete on consent.purpose_notice to app_rw;

-- (2) The sweep's tenant finder needs only the relationship end of status rows (0002 already lets
-- svc_consent_sweep read their tenant and time); it reads no purpose record and writes nothing.
grant select (relationship_ended_at) on consent.subject_status to svc_consent_sweep;
