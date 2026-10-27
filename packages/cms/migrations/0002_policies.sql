-- @infrabyx/cms 0002: policy sets and policy instances (IPB-05 §05.3, §05.4.19; IPB-04 §04.4.3
-- "Legal page / policy instance"; PL5 plan §5.7). Expand-only.
-- (1) A policy set holds one brand pack's policy parameters (officers, governing law, URLs). A
--     change is proposed by a PLT_LEGAL_REVIEWER and applied by a PLT_SUPER_ADMIN (IPB-05-12).
-- (2) A policy instance is one version of one template for a pack: drafted by a
--     PLT_LEGAL_REVIEWER, approved by a PLT_SUPER_ADMIN and, for privacy-class templates, by a
--     PLT_DPO; never the maker. Once approved it never changes (IPB-POL-008): a change is a new
--     version that supersedes it when it takes effect; the superseded version stays readable.
-- (3) Platform rows, written only in a platform context through the kernel with a ledger entry.
set lock_timeout = '5s';
set statement_timeout = '60s';

create table cms.policy_set (
  id               text        primary key check (id ~ '^pol_[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  tenant_id        text        not null default 'tnt_platform' check (tenant_id = 'tnt_platform'),
  brand_pack_id    text        not null unique check (brand_pack_id ~ '^brd_[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  params           jsonb       not null default '{}',
  params_version   integer     not null default 0,
  pending_params   jsonb,
  pending_maker_id text,
  created_by       text        not null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint policy_set_pending check ((pending_params is null) = (pending_maker_id is null))
);
comment on column cms.policy_set.id is 'dataclass:PUBLIC';
comment on column cms.policy_set.tenant_id is 'dataclass:INTERNAL';
comment on column cms.policy_set.brand_pack_id is 'dataclass:PUBLIC';
comment on column cms.policy_set.params is 'dataclass:PUBLIC';
comment on column cms.policy_set.params_version is 'dataclass:INTERNAL';
comment on column cms.policy_set.pending_params is 'dataclass:INTERNAL';
comment on column cms.policy_set.pending_maker_id is 'dataclass:INTERNAL';
comment on column cms.policy_set.created_by is 'dataclass:INTERNAL';
comment on column cms.policy_set.created_at is 'dataclass:INTERNAL';
comment on column cms.policy_set.updated_at is 'dataclass:INTERNAL';
alter table cms.policy_set enable row level security;
alter table cms.policy_set force row level security;
create policy policy_set_read on cms.policy_set for select
  using (tenant_id = current_setting('app.tenant_id', true) or tenant_id = 'tnt_platform');
create policy policy_set_insert on cms.policy_set for insert
  with check (tenant_id = current_setting('app.tenant_id', true) and current_setting('app.scope', true) = 'platform');
create policy policy_set_update on cms.policy_set for update
  using (tenant_id = current_setting('app.tenant_id', true) and current_setting('app.scope', true) = 'platform')
  with check (tenant_id = current_setting('app.tenant_id', true) and current_setting('app.scope', true) = 'platform');
grant select, insert, update on cms.policy_set to app_rw;
grant select on cms.policy_set to app_ro;

create table cms.policy_instance (
  id                   text        primary key check (id ~ '^pin_[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  tenant_id            text        not null default 'tnt_platform' check (tenant_id = 'tnt_platform'),
  policy_set_id        text        not null references cms.policy_set (id),
  policy_key           text        not null check (policy_key ~ '^[a-z][a-z_]{1,40}$'),
  template_version     text        not null,
  version_label        text        not null check (version_label ~ '^[0-9]+\.[0-9]+$'),
  change_class         text        not null check (change_class in ('INITIAL', 'MAJOR', 'MINOR')),
  title                text        not null,
  body                 text        not null,
  hi_summary           text,
  hi_machine_translated boolean    not null default false,
  summary_of_changes   text        not null,
  effective_at         timestamptz not null,
  reconsent_required   boolean     not null default false,
  privacy_class        boolean     not null,
  params_snapshot      jsonb,
  rendered_sha256      text        check (rendered_sha256 ~ '^[0-9a-f]{64}$'),
  state                text        not null default 'draft'
                         check (state in ('draft', 'submitted', 'approved', 'effective', 'superseded', 'withdrawn')),
  seeded_placeholder   boolean     not null default false,
  supersedes_id        text        references cms.policy_instance (id),
  maker_id             text        not null,
  checker_id           text,
  dpo_id               text,
  approved_at          timestamptz,
  effective_since      timestamptz,
  superseded_at        timestamptz,
  last_reviewed_at     timestamptz not null default now(),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (policy_set_id, policy_key, version_label),
  constraint policy_instance_checker_not_maker check (checker_id is null or checker_id <> maker_id),
  constraint policy_instance_dpo_not_maker check (dpo_id is null or dpo_id <> maker_id),
  constraint policy_instance_approved_checked check (
    state not in ('approved', 'effective', 'superseded') or seeded_placeholder
    or (checker_id is not null and (not privacy_class or dpo_id is not null))),
  constraint policy_instance_approved_snapshot check (
    state not in ('approved', 'effective', 'superseded') or (params_snapshot is not null and rendered_sha256 is not null))
);
comment on column cms.policy_instance.id is 'dataclass:PUBLIC';
comment on column cms.policy_instance.tenant_id is 'dataclass:INTERNAL';
comment on column cms.policy_instance.policy_set_id is 'dataclass:PUBLIC';
comment on column cms.policy_instance.policy_key is 'dataclass:PUBLIC';
comment on column cms.policy_instance.template_version is 'dataclass:PUBLIC';
comment on column cms.policy_instance.version_label is 'dataclass:PUBLIC';
comment on column cms.policy_instance.change_class is 'dataclass:PUBLIC';
comment on column cms.policy_instance.title is 'dataclass:PUBLIC';
comment on column cms.policy_instance.body is 'dataclass:PUBLIC';
comment on column cms.policy_instance.hi_summary is 'dataclass:PUBLIC';
comment on column cms.policy_instance.hi_machine_translated is 'dataclass:INTERNAL';
comment on column cms.policy_instance.summary_of_changes is 'dataclass:PUBLIC';
comment on column cms.policy_instance.effective_at is 'dataclass:PUBLIC';
comment on column cms.policy_instance.reconsent_required is 'dataclass:PUBLIC';
comment on column cms.policy_instance.privacy_class is 'dataclass:PUBLIC';
comment on column cms.policy_instance.params_snapshot is 'dataclass:PUBLIC';
comment on column cms.policy_instance.rendered_sha256 is 'dataclass:PUBLIC';
comment on column cms.policy_instance.state is 'dataclass:INTERNAL';
comment on column cms.policy_instance.seeded_placeholder is 'dataclass:INTERNAL';
comment on column cms.policy_instance.supersedes_id is 'dataclass:PUBLIC';
comment on column cms.policy_instance.maker_id is 'dataclass:INTERNAL';
comment on column cms.policy_instance.checker_id is 'dataclass:INTERNAL';
comment on column cms.policy_instance.dpo_id is 'dataclass:INTERNAL';
comment on column cms.policy_instance.approved_at is 'dataclass:INTERNAL';
comment on column cms.policy_instance.effective_since is 'dataclass:PUBLIC';
comment on column cms.policy_instance.superseded_at is 'dataclass:PUBLIC';
comment on column cms.policy_instance.last_reviewed_at is 'dataclass:PUBLIC';
comment on column cms.policy_instance.created_at is 'dataclass:INTERNAL';
comment on column cms.policy_instance.updated_at is 'dataclass:INTERNAL';
create unique index policy_instance_one_effective_idx on cms.policy_instance (policy_set_id, policy_key)
  where state = 'effective';
create unique index policy_instance_one_open_idx on cms.policy_instance (policy_set_id, policy_key)
  where state in ('draft', 'submitted', 'approved');
create index policy_instance_due_idx on cms.policy_instance (effective_at) where state = 'approved';
alter table cms.policy_instance enable row level security;
alter table cms.policy_instance force row level security;
create policy policy_instance_read on cms.policy_instance for select
  using (tenant_id = current_setting('app.tenant_id', true) or tenant_id = 'tnt_platform');
create policy policy_instance_insert on cms.policy_instance for insert
  with check (tenant_id = current_setting('app.tenant_id', true) and current_setting('app.scope', true) = 'platform');
create policy policy_instance_update on cms.policy_instance for update
  using (tenant_id = current_setting('app.tenant_id', true) and current_setting('app.scope', true) = 'platform')
  with check (tenant_id = current_setting('app.tenant_id', true) and current_setting('app.scope', true) = 'platform');
grant select, insert, update on cms.policy_instance to app_rw;
grant select on cms.policy_instance to app_ro;

-- An approved instance is immutable (IPB-POL-008); its state only moves forward; reviewers are set once.
create function cms.policy_instance_guard() returns trigger language plpgsql as $$
begin
  if old.state in ('approved', 'effective', 'superseded', 'withdrawn') and (
      new.body is distinct from old.body or new.version_label is distinct from old.version_label
      or new.title is distinct from old.title or new.hi_summary is distinct from old.hi_summary
      or new.effective_at is distinct from old.effective_at or new.change_class is distinct from old.change_class
      or new.params_snapshot is distinct from old.params_snapshot
      or new.rendered_sha256 is distinct from old.rendered_sha256
      or new.reconsent_required is distinct from old.reconsent_required
      or new.summary_of_changes is distinct from old.summary_of_changes) then
    raise exception 'policy instance % is published and cannot be edited in place', old.id using errcode = '42501';
  end if;
  if new.policy_set_id is distinct from old.policy_set_id or new.policy_key is distinct from old.policy_key
      or new.maker_id is distinct from old.maker_id or new.privacy_class is distinct from old.privacy_class
      or new.seeded_placeholder is distinct from old.seeded_placeholder then
    raise exception 'policy instance % identity is immutable', old.id using errcode = '42501';
  end if;
  if (old.checker_id is not null and new.checker_id is distinct from old.checker_id)
      or (old.dpo_id is not null and new.dpo_id is distinct from old.dpo_id) then
    raise exception 'policy instance % reviewer already recorded', old.id using errcode = '42501';
  end if;
  if not (new.state = old.state
      or (old.state = 'draft' and new.state in ('submitted', 'withdrawn'))
      or (old.state = 'submitted' and new.state in ('draft', 'approved', 'withdrawn'))
      or (old.state = 'approved' and new.state in ('effective', 'withdrawn'))
      or (old.state = 'effective' and new.state = 'superseded')) then
    raise exception 'policy instance % cannot move from % to %', old.id, old.state, new.state using errcode = '42501';
  end if;
  return new;
end
$$;
create trigger policy_instance_guard before update on cms.policy_instance
  for each row execute function cms.policy_instance_guard();
