-- @infrabyx/consent 0001: consent texts, the consent ledger and the acceptance ledger (IPB-04
-- §04.3.9, IPB-04-78, 04-84; IPB-05-05, template 18; Ecosystem entity 29; PL5 plan §6.1). Expand-only.
-- (1) Texts are versioned strings: drafted by a PLT_DPO, approved by a PLT_LEGAL_REVIEWER (never
--     the maker; IPB-04 §04.3.12 section 12). An approved text never changes; a change is a new
--     version, which re-prompts the banner (IPB-04-84).
-- (2) Consent records and acceptances are append-only: an update is refused for every role. A new
--     choice is a new record (IPB-04-78). Each record keeps the exact text shown (IPB-05 AT-10).
-- (3) Deletion (OWNER-QUESTIONS #48, PL5-D-05; the owner's approval): a consent record is deleted
--     3 years after the end of its life. Its life ends when a later record for the same person and
--     pack replaces it, or, for a cookie choice, when its cookie expires (365 days). PostgreSQL
--     refuses every other delete. SVC_CONSENT_SWEEP finds the tenants with records due.
set lock_timeout = '5s';
set statement_timeout = '60s';

create schema if not exists consent;
revoke all on schema consent from public;
grant usage on schema consent to app_rw, app_ro;

create table consent.text (
  id            text        primary key check (id ~ '^ctx_[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  tenant_id     text        not null default 'tnt_platform' check (tenant_id = 'tnt_platform'),
  key           text        not null check (key ~ '^(consent|notice)\.[a-z0-9_.]+$'),
  version       text        not null check (version ~ '^[0-9]+\.[0-9]+$'),
  locale        text        not null default 'en-IN' check (locale ~ '^[a-z]{2}-[A-Z]{2}$'),
  region        text        not null default 'IN' check (region in ('IN', 'EU', 'US-CA', 'OTHER')),
  body          text        not null check (length(body) between 1 and 4000),
  state         text        not null default 'draft' check (state in ('draft', 'approved', 'retired')),
  maker_id      text        not null,
  checker_id    text,
  approved_at   timestamptz,
  effective_at  timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  unique (key, version, locale, region),
  constraint text_checker_not_maker check (checker_id is null or checker_id <> maker_id),
  constraint text_approved_checked check (state = 'draft' or checker_id is not null)
);
comment on column consent.text.id is 'dataclass:PUBLIC';
comment on column consent.text.tenant_id is 'dataclass:INTERNAL';
comment on column consent.text.key is 'dataclass:PUBLIC';
comment on column consent.text.version is 'dataclass:PUBLIC';
comment on column consent.text.locale is 'dataclass:PUBLIC';
comment on column consent.text.region is 'dataclass:PUBLIC';
comment on column consent.text.body is 'dataclass:PUBLIC';
comment on column consent.text.state is 'dataclass:INTERNAL';
comment on column consent.text.maker_id is 'dataclass:INTERNAL';
comment on column consent.text.checker_id is 'dataclass:INTERNAL';
comment on column consent.text.approved_at is 'dataclass:INTERNAL';
comment on column consent.text.effective_at is 'dataclass:PUBLIC';
comment on column consent.text.created_at is 'dataclass:INTERNAL';
alter table consent.text enable row level security;
alter table consent.text force row level security;
create policy text_read on consent.text for select
  using (tenant_id = current_setting('app.tenant_id', true) or tenant_id = 'tnt_platform');
create policy text_insert on consent.text for insert
  with check (tenant_id = current_setting('app.tenant_id', true) and current_setting('app.scope', true) = 'platform');
create policy text_update on consent.text for update
  using (tenant_id = current_setting('app.tenant_id', true) and current_setting('app.scope', true) = 'platform')
  with check (tenant_id = current_setting('app.tenant_id', true) and current_setting('app.scope', true) = 'platform');
grant select, insert, update on consent.text to app_rw;
grant select on consent.text to app_ro;

-- Only the approval and retirement fields of a text change, once; the wording never does.
create function consent.text_guard() returns trigger language plpgsql as $$
begin
  if new.body is distinct from old.body or new.key is distinct from old.key or new.version is distinct from old.version
      or new.locale is distinct from old.locale or new.region is distinct from old.region
      or new.maker_id is distinct from old.maker_id or new.created_at is distinct from old.created_at then
    raise exception 'consent text % is immutable; add a new version', old.id using errcode = '42501';
  end if;
  if old.checker_id is not null and new.checker_id is distinct from old.checker_id then
    raise exception 'consent text % already approved', old.id using errcode = '42501';
  end if;
  if not (new.state = old.state or (old.state = 'draft' and new.state = 'approved')
      or (old.state = 'approved' and new.state = 'retired')) then
    raise exception 'consent text % cannot move from % to %', old.id, old.state, new.state using errcode = '42501';
  end if;
  return new;
end
$$;
create trigger text_guard before update on consent.text for each row execute function consent.text_guard();

create table consent.record (
  id              text        primary key check (id ~ '^cns_[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  tenant_id       text        not null,
  cid             text        check (cid ~ '^[A-Za-z0-9_-]{16,64}$'),
  principal_ref   text        check (length(principal_ref) between 3 and 120),
  brand_pack_id   text        check (brand_pack_id ~ '^brd_'),
  method          text        not null check (method in ('CMP_BANNER', 'PREFERENCE_CENTRE', 'FORM', 'API', 'IMPORT')),
  functional      boolean,
  analytics       boolean,
  marketing       boolean,
  purposes        text[]      not null default '{}',
  text_key        text        not null,
  text_version    text        not null,
  text_shown      text        not null,
  policy_version  text,
  region          text        not null check (region in ('IN', 'EU', 'US-CA', 'OTHER')),
  gpc             boolean     not null,
  ua_class        text        check (length(ua_class) <= 40),
  recorded_at     timestamptz not null default now(),
  constraint record_subject check (cid is not null or principal_ref is not null),
  constraint record_choice check (
    (method not in ('CMP_BANNER', 'PREFERENCE_CENTRE')) or (functional is not null and analytics is not null and marketing is not null))
);
comment on column consent.record.id is 'dataclass:INTERNAL';
comment on column consent.record.tenant_id is 'dataclass:INTERNAL';
comment on column consent.record.cid is 'dataclass:CONFIDENTIAL';
comment on column consent.record.principal_ref is 'dataclass:CONFIDENTIAL';
comment on column consent.record.brand_pack_id is 'dataclass:INTERNAL';
comment on column consent.record.method is 'dataclass:INTERNAL';
comment on column consent.record.functional is 'dataclass:CONFIDENTIAL';
comment on column consent.record.analytics is 'dataclass:CONFIDENTIAL';
comment on column consent.record.marketing is 'dataclass:CONFIDENTIAL';
comment on column consent.record.purposes is 'dataclass:CONFIDENTIAL';
comment on column consent.record.text_key is 'dataclass:INTERNAL';
comment on column consent.record.text_version is 'dataclass:INTERNAL';
comment on column consent.record.text_shown is 'dataclass:PUBLIC';
comment on column consent.record.policy_version is 'dataclass:INTERNAL';
comment on column consent.record.region is 'dataclass:INTERNAL';
comment on column consent.record.gpc is 'dataclass:INTERNAL';
comment on column consent.record.ua_class is 'dataclass:INTERNAL';
comment on column consent.record.recorded_at is 'dataclass:INTERNAL';
create index record_cid_idx on consent.record (tenant_id, cid, recorded_at) where cid is not null;
create index record_principal_idx on consent.record (tenant_id, principal_ref, recorded_at) where principal_ref is not null;
create index record_time_idx on consent.record (recorded_at);
alter table consent.record enable row level security;
alter table consent.record force row level security;
create policy record_tenant_read on consent.record for select
  using (tenant_id = current_setting('app.tenant_id', true));
create policy record_tenant_insert on consent.record for insert
  with check (tenant_id = current_setting('app.tenant_id', true));
create policy record_tenant_delete on consent.record for delete
  using (tenant_id = current_setting('app.tenant_id', true));
-- The purge rule (#48): only records 3 years past the end of their life.
create policy record_delete_retention on consent.record as restrictive for delete
  using (
    exists (
      select 1 from consent.record n
       where n.tenant_id = record.tenant_id and n.recorded_at > record.recorded_at
         and coalesce(n.brand_pack_id, '') = coalesce(record.brand_pack_id, '')
         and ((record.cid is not null and n.cid = record.cid)
              or (record.principal_ref is not null and n.principal_ref = record.principal_ref))
         and n.recorded_at < now() - interval '3 years')
    or (record.method in ('CMP_BANNER', 'PREFERENCE_CENTRE') and record.recorded_at < now() - interval '3 years' - interval '365 days'));
grant select, insert, delete on consent.record to app_rw;
grant select on consent.record to app_ro;

create function consent.append_only() returns trigger language plpgsql as $$
begin
  raise exception '%.% is append-only', tg_table_schema, tg_table_name using errcode = '42501';
end
$$;
create trigger record_append_only before update on consent.record for each row execute function consent.append_only();

-- Acceptances of Terms-class documents and acknowledgements of Privacy-class ones (IPB-05-05).
create table consent.acceptance (
  id            text        primary key check (id ~ '^acc_[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  tenant_id     text        not null,
  principal_id  text        not null,
  document_key  text        not null check (document_key ~ '^[a-z][a-z_]{1,40}$'),
  version       text        not null check (version ~ '^[0-9]+\.[0-9]+$'),
  text_sha256   text        not null check (text_sha256 ~ '^[0-9a-f]{64}$'),
  kind          text        not null check (kind in ('accepted', 'acknowledged', 'refused')),
  ui_version    text        check (length(ui_version) <= 40),
  recorded_at   timestamptz not null default now()
);
comment on column consent.acceptance.id is 'dataclass:INTERNAL';
comment on column consent.acceptance.tenant_id is 'dataclass:INTERNAL';
comment on column consent.acceptance.principal_id is 'dataclass:CONFIDENTIAL';
comment on column consent.acceptance.document_key is 'dataclass:INTERNAL';
comment on column consent.acceptance.version is 'dataclass:INTERNAL';
comment on column consent.acceptance.text_sha256 is 'dataclass:INTERNAL';
comment on column consent.acceptance.kind is 'dataclass:INTERNAL';
comment on column consent.acceptance.ui_version is 'dataclass:INTERNAL';
comment on column consent.acceptance.recorded_at is 'dataclass:INTERNAL';
create index acceptance_principal_idx on consent.acceptance (tenant_id, principal_id, document_key, recorded_at);
alter table consent.acceptance enable row level security;
alter table consent.acceptance force row level security;
create policy acceptance_tenant on consent.acceptance for select
  using (tenant_id = current_setting('app.tenant_id', true));
create policy acceptance_insert on consent.acceptance for insert
  with check (tenant_id = current_setting('app.tenant_id', true));
grant select, insert on consent.acceptance to app_rw;
grant select on consent.acceptance to app_ro;
create trigger acceptance_append_only before update or delete on consent.acceptance
  for each row execute function consent.append_only();

-- The purge's tenant finder (#48): ids, tenants and times only; no write grant.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'svc_consent_sweep') then
    create role svc_consent_sweep nologin nosuperuser nobypassrls nocreatedb nocreaterole;
  end if;
end
$$;
grant usage on schema consent to svc_consent_sweep;
grant select (id, tenant_id, recorded_at) on consent.record to svc_consent_sweep;
create policy record_sweep on consent.record for select to svc_consent_sweep
  using (current_setting('app.scope', true) = 'platform');
grant svc_consent_sweep to app_rw, app_ro;

-- Transactional outbox and consumer inbox (IPB-01 §01.4.3.3).
create table consent.outbox (
  id             text        primary key,
  tenant_id      text        not null,
  type           text        not null,
  envelope       jsonb       not null,
  created_at     timestamptz not null default now(),
  dispatched_at  timestamptz,
  attempts       integer     not null default 0
);
comment on column consent.outbox.id is 'dataclass:INTERNAL';
comment on column consent.outbox.tenant_id is 'dataclass:INTERNAL';
comment on column consent.outbox.type is 'dataclass:INTERNAL';
comment on column consent.outbox.envelope is 'dataclass:INTERNAL';
comment on column consent.outbox.created_at is 'dataclass:INTERNAL';
comment on column consent.outbox.dispatched_at is 'dataclass:INTERNAL';
comment on column consent.outbox.attempts is 'dataclass:INTERNAL';
create index outbox_pending_idx on consent.outbox (created_at) where dispatched_at is null;
alter table consent.outbox enable row level security;
alter table consent.outbox force row level security;
create policy outbox_tenant on consent.outbox for all
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
grant select, insert, update on consent.outbox to app_rw;
grant select on consent.outbox to app_ro;

create table consent.inbox (
  consumer      text        not null,
  event_id      text        not null,
  tenant_id     text        not null,
  processed_at  timestamptz not null default now(),
  primary key (consumer, event_id)
);
comment on column consent.inbox.consumer is 'dataclass:INTERNAL';
comment on column consent.inbox.event_id is 'dataclass:INTERNAL';
comment on column consent.inbox.tenant_id is 'dataclass:INTERNAL';
comment on column consent.inbox.processed_at is 'dataclass:INTERNAL';
alter table consent.inbox enable row level security;
alter table consent.inbox force row level security;
create policy inbox_tenant on consent.inbox for all
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
grant select, insert on consent.inbox to app_rw;
grant select on consent.inbox to app_ro;
