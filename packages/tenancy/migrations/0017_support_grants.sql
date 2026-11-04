-- @infrabyx/tenancy 0017: tenant-consented support access (LawDocsComply PR-LDC-08 (a), (b) and
-- PR-LDC-20; owner answer #104; R1-plan M50; R1-D-76). Expand-only. A separate grant, not
-- break-glass (IPB-02-06 is unchanged):
--   * `tenancy.support_grant`: a PLT_SUPPORT principal asks one tenant for access to a list of
--     modules (schemas), read-only by default; the tenant's ORG_OWNER or ORG_ADMIN consents first;
--     read-write also needs a second, different ORG_OWNER or ORG_ADMIN; it lasts at most 24 hours
--     from activation and the tenant may refuse or revoke it at once. The rows are the tenant's own
--     (RLS on the tenant) and the checks below hold the maker-checker rules in the database;
--   * `tenancy.support_read`: every read made under a grant, shown to the tenant. Nobody writes it
--     except `tenancy.support_read_record`, which records a read only for the principal's own grant
--     in the transaction's tenant, so a product can neither forge nor hide one.
set lock_timeout = '5s';
set statement_timeout = '60s';

create table tenancy.support_grant (
  id                  text        primary key check (id ~ '^sgr_[0-9A-HJKMNP-TV-Z]{26}$'),
  tenant_id           text        not null references tenancy.tenant (id),
  requester_id        text        not null check (requester_id ~ '^[A-Za-z0-9_.:@/+=-]{1,255}$'),
  reason              text        not null check (length(reason) between 10 and 500),
  ticket_ref          text        check (ticket_ref is null or ticket_ref ~ '^[A-Za-z0-9_.:/#-]{1,120}$'),
  modules             text[]      not null check (cardinality(modules) between 1 and 50
                        and array_to_string(modules, ',') ~ '^[a-z][a-z0-9_]{0,62}(,[a-z][a-z0-9_]{0,62})*$'),
  access              text        not null default 'read' check (access in ('read', 'read_write')),
  duration_hours      integer     not null check (duration_hours between 1 and 24),
  state               text        not null default 'awaiting_tenant_consent'
                        check (state in ('awaiting_tenant_consent', 'awaiting_second_approval', 'active',
                                         'refused', 'revoked')),
  requested_at        timestamptz not null default now(),
  consented_by        text,
  consented_at        timestamptz,
  second_approver_id  text,
  second_approved_at  timestamptz,
  activated_at        timestamptz,
  expires_at          timestamptz,
  ended_by            text,
  ended_at            timestamptz,
  check (consented_by is null or consented_by <> requester_id),
  check (second_approver_id is null or (consented_by is not null and second_approver_id <> consented_by
                                         and second_approver_id <> requester_id)),
  check (access = 'read_write' or second_approver_id is null),
  check (state <> 'awaiting_second_approval' or (access = 'read_write' and consented_by is not null)),
  check (activated_at is null or (consented_by is not null and expires_at is not null
                                  and (access = 'read' or second_approver_id is not null))),
  check (state <> 'active' or activated_at is not null),
  check (expires_at is null or expires_at <= activated_at + interval '24 hours'),
  check ((state in ('refused', 'revoked')) = (ended_at is not null and ended_by is not null))
);
comment on column tenancy.support_grant.id is 'dataclass:INTERNAL';
comment on column tenancy.support_grant.tenant_id is 'dataclass:INTERNAL';
comment on column tenancy.support_grant.requester_id is 'dataclass:INTERNAL';
comment on column tenancy.support_grant.reason is 'dataclass:CONFIDENTIAL';
comment on column tenancy.support_grant.ticket_ref is 'dataclass:INTERNAL';
comment on column tenancy.support_grant.modules is 'dataclass:INTERNAL';
comment on column tenancy.support_grant.access is 'dataclass:INTERNAL';
comment on column tenancy.support_grant.duration_hours is 'dataclass:INTERNAL';
comment on column tenancy.support_grant.state is 'dataclass:INTERNAL';
comment on column tenancy.support_grant.requested_at is 'dataclass:INTERNAL';
comment on column tenancy.support_grant.consented_by is 'dataclass:INTERNAL';
comment on column tenancy.support_grant.consented_at is 'dataclass:INTERNAL';
comment on column tenancy.support_grant.second_approver_id is 'dataclass:INTERNAL';
comment on column tenancy.support_grant.second_approved_at is 'dataclass:INTERNAL';
comment on column tenancy.support_grant.activated_at is 'dataclass:INTERNAL';
comment on column tenancy.support_grant.expires_at is 'dataclass:INTERNAL';
comment on column tenancy.support_grant.ended_by is 'dataclass:INTERNAL';
comment on column tenancy.support_grant.ended_at is 'dataclass:INTERNAL';
-- One open request per principal and tenant; the live grant the kernel looks up.
create unique index support_grant_open_idx on tenancy.support_grant (tenant_id, requester_id)
  where state in ('awaiting_tenant_consent', 'awaiting_second_approval');
create index support_grant_live_idx on tenancy.support_grant (tenant_id, requester_id, expires_at)
  where state = 'active';

alter table tenancy.support_grant enable row level security;
alter table tenancy.support_grant force row level security;
create policy support_grant_tenant on tenancy.support_grant for all to app_rw, app_ro
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
revoke all on tenancy.support_grant from public;
grant select, insert, update on tenancy.support_grant to app_rw;
grant select on tenancy.support_grant to app_ro;

create table tenancy.support_read (
  id            text        primary key check (id ~ '^srd_[0-9A-HJKMNP-TV-Z]{26}$'),
  tenant_id     text        not null references tenancy.tenant (id),
  grant_id      text        not null references tenancy.support_grant (id),
  principal_id  text        not null,
  table_name    text        not null check (table_name ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$'),
  row_count     integer     not null check (row_count >= 0),
  read_at       timestamptz not null default now()
);
comment on column tenancy.support_read.id is 'dataclass:INTERNAL';
comment on column tenancy.support_read.tenant_id is 'dataclass:INTERNAL';
comment on column tenancy.support_read.grant_id is 'dataclass:INTERNAL';
comment on column tenancy.support_read.principal_id is 'dataclass:INTERNAL';
comment on column tenancy.support_read.table_name is 'dataclass:INTERNAL';
comment on column tenancy.support_read.row_count is 'dataclass:INTERNAL';
comment on column tenancy.support_read.read_at is 'dataclass:INTERNAL';
create index support_read_grant_idx on tenancy.support_read (tenant_id, grant_id, read_at);

alter table tenancy.support_read enable row level security;
alter table tenancy.support_read force row level security;
create policy support_read_tenant on tenancy.support_read for all to app_rw, app_ro
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
revoke all on tenancy.support_read from public;
grant select on tenancy.support_read to app_rw, app_ro;

-- Record one read under the principal's own grant in the transaction's tenant (SupportReads calls
-- it with the read's ledger entry). A grant that has been active records its reads even when it was
-- revoked or expired between the read and this call.
create function tenancy.support_read_record(p_id text, p_grant_id text, p_table text, p_rows integer)
  returns void
  language plpgsql security definer set search_path = pg_catalog, tenancy
  as $$
  declare
    v_tenant text := nullif(current_setting('app.tenant_id', true), '');
    v_actor  text := nullif(current_setting('app.actor_id', true), '');
  begin
    if not exists (
      select 1 from tenancy.support_grant g
       where g.id = p_grant_id and g.tenant_id = v_tenant and g.requester_id = v_actor
         and g.activated_at is not null) then
      raise exception 'support_read_record: not this principal''s grant in this tenant' using errcode = '42501';
    end if;
    insert into tenancy.support_read (id, tenant_id, grant_id, principal_id, table_name, row_count)
      values (p_id, v_tenant, p_grant_id, v_actor, p_table, p_rows);
  end
  $$;
revoke all on function tenancy.support_read_record(text, text, text, integer) from public;
grant execute on function tenancy.support_read_record(text, text, text, integer) to app_rw;
