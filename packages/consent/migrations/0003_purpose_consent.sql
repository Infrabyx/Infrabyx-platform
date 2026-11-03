-- @infrabyx/consent 0003: consent to a product's own purposes (Finbyx PR-FBX-26; IPB-04-78; IPB-05;
-- DPDP Act 2023 s.5 and s.6; R1-D-38). Expand-only; the public-site ledger of 0001 is unchanged.
-- (1) `consent.purpose_notice`: the tenant's notice text for one product purpose and language,
--     versioned. A maker drafts it and a different person approves it (the tenant's maker-checker);
--     an approved notice never changes; a change is a new version. Its SHA-256 is computed here.
-- (2) `consent.purpose_record`: append-only. Each grant names the exact notice version shown, with
--     its language and SHA-256; a withdrawal is a new row. Nothing deletes a row: no retention rule
--     for these records is set yet (OWNER-QUESTIONS #95); they are kept until the owner sets one.
set lock_timeout = '5s';
set statement_timeout = '60s';

create table consent.purpose_notice (
  id            text        primary key check (id ~ '^cpn_[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  tenant_id     text        not null,
  purpose       text        not null check (purpose ~ '^[a-z]{2,5}\.[a-z0-9_]+(\.[a-z0-9_]+){0,3}$'),
  version       integer     not null check (version between 1 and 100000),
  language      text        not null check (language ~ '^[a-z]{2,3}(-[A-Z]{2})?$'),
  body          text        not null check (length(body) between 1 and 20000),
  sha256        text        not null check (sha256 ~ '^[0-9a-f]{64}$'),
  state         text        not null default 'draft' check (state in ('draft', 'approved', 'retired')),
  maker_id      text        not null,
  checker_id    text,
  approved_at   timestamptz,
  retired_at    timestamptz,
  created_at    timestamptz not null default now(),
  unique (tenant_id, purpose, language, version),
  constraint purpose_notice_checker_not_maker check (checker_id is null or checker_id <> maker_id),
  constraint purpose_notice_approved_checked check (state = 'draft' or (checker_id is not null and approved_at is not null))
);
comment on column consent.purpose_notice.id is 'dataclass:INTERNAL';
comment on column consent.purpose_notice.tenant_id is 'dataclass:INTERNAL';
comment on column consent.purpose_notice.purpose is 'dataclass:INTERNAL';
comment on column consent.purpose_notice.version is 'dataclass:INTERNAL';
comment on column consent.purpose_notice.language is 'dataclass:INTERNAL';
comment on column consent.purpose_notice.body is 'dataclass:PUBLIC';
comment on column consent.purpose_notice.sha256 is 'dataclass:PUBLIC';
comment on column consent.purpose_notice.state is 'dataclass:INTERNAL';
comment on column consent.purpose_notice.maker_id is 'dataclass:INTERNAL';
comment on column consent.purpose_notice.checker_id is 'dataclass:INTERNAL';
comment on column consent.purpose_notice.approved_at is 'dataclass:INTERNAL';
comment on column consent.purpose_notice.retired_at is 'dataclass:INTERNAL';
comment on column consent.purpose_notice.created_at is 'dataclass:INTERNAL';
alter table consent.purpose_notice enable row level security;
alter table consent.purpose_notice force row level security;
create policy purpose_notice_tenant on consent.purpose_notice for select
  using (tenant_id = current_setting('app.tenant_id', true));
create policy purpose_notice_insert on consent.purpose_notice for insert
  with check (tenant_id = current_setting('app.tenant_id', true));
create policy purpose_notice_update on consent.purpose_notice for update
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
grant select, insert, update on consent.purpose_notice to app_rw;
grant select on consent.purpose_notice to app_ro;

-- The hash is the database's, over the exact body; the wording never changes after insert.
create function consent.purpose_notice_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.sha256 := encode(sha256(convert_to(new.body, 'UTF8')), 'hex');
    if new.state <> 'draft' then
      raise exception 'a purpose notice starts as a draft' using errcode = '42501';
    end if;
    return new;
  end if;
  if new.body is distinct from old.body or new.sha256 is distinct from old.sha256
      or new.purpose is distinct from old.purpose or new.version is distinct from old.version
      or new.language is distinct from old.language or new.maker_id is distinct from old.maker_id
      or new.tenant_id is distinct from old.tenant_id or new.created_at is distinct from old.created_at then
    raise exception 'purpose notice % is immutable; add a new version', old.id using errcode = '42501';
  end if;
  if old.checker_id is not null and new.checker_id is distinct from old.checker_id then
    raise exception 'purpose notice % already approved', old.id using errcode = '42501';
  end if;
  if not (new.state = old.state or (old.state = 'draft' and new.state = 'approved')
      or (old.state = 'approved' and new.state = 'retired')) then
    raise exception 'purpose notice % cannot move from % to %', old.id, old.state, new.state using errcode = '42501';
  end if;
  return new;
end
$$;
create trigger purpose_notice_guard before insert or update on consent.purpose_notice
  for each row execute function consent.purpose_notice_guard();
create trigger purpose_notice_no_delete before delete on consent.purpose_notice
  for each row execute function consent.append_only();

create table consent.purpose_record (
  id              text        primary key check (id ~ '^cpr_[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  tenant_id       text        not null,
  subject_ref     text        not null check (length(subject_ref) between 3 and 120),
  purpose         text        not null check (purpose ~ '^[a-z]{2,5}\.[a-z0-9_]+(\.[a-z0-9_]+){0,3}$'),
  action          text        not null check (action in ('granted', 'withdrawn')),
  notice_id       text        references consent.purpose_notice (id),
  notice_version  integer,
  language        text,
  notice_sha256   text        check (notice_sha256 ~ '^[0-9a-f]{64}$'),
  method          text        not null check (method in ('SELF_SERVICE', 'ASSISTED', 'API', 'IMPORT')),
  actor_id        text        not null,
  recorded_at     timestamptz not null default now(),
  constraint purpose_record_grant_notice check (
    action = 'withdrawn' or (notice_id is not null and notice_version is not null and language is not null and notice_sha256 is not null))
);
comment on column consent.purpose_record.id is 'dataclass:INTERNAL';
comment on column consent.purpose_record.tenant_id is 'dataclass:INTERNAL';
comment on column consent.purpose_record.subject_ref is 'dataclass:CONFIDENTIAL';
comment on column consent.purpose_record.purpose is 'dataclass:INTERNAL';
comment on column consent.purpose_record.action is 'dataclass:CONFIDENTIAL';
comment on column consent.purpose_record.notice_id is 'dataclass:INTERNAL';
comment on column consent.purpose_record.notice_version is 'dataclass:INTERNAL';
comment on column consent.purpose_record.language is 'dataclass:INTERNAL';
comment on column consent.purpose_record.notice_sha256 is 'dataclass:INTERNAL';
comment on column consent.purpose_record.method is 'dataclass:INTERNAL';
comment on column consent.purpose_record.actor_id is 'dataclass:INTERNAL';
comment on column consent.purpose_record.recorded_at is 'dataclass:INTERNAL';
create index purpose_record_subject_idx on consent.purpose_record (tenant_id, subject_ref, purpose, recorded_at);
alter table consent.purpose_record enable row level security;
alter table consent.purpose_record force row level security;
create policy purpose_record_tenant on consent.purpose_record for select
  using (tenant_id = current_setting('app.tenant_id', true));
create policy purpose_record_insert on consent.purpose_record for insert
  with check (tenant_id = current_setting('app.tenant_id', true));
grant select, insert on consent.purpose_record to app_rw;
grant select on consent.purpose_record to app_ro;
create trigger purpose_record_append_only before update or delete on consent.purpose_record
  for each row execute function consent.append_only();
