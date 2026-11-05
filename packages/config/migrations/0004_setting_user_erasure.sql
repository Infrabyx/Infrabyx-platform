-- @infrabyx/config 0004: erasing a person's USER settings on a DPDP erasure request (OWNER-QUESTIONS
-- #110, R1-D-89; R1-plan M63). Expand-only.
-- `SettingsService.eraseUser` records a `setting_erasure` row first, then deletes the person's USER
-- values (`setting_value`) and USER change history (`setting_change`) in the tenant, and ledgers it,
-- all in one transaction. The history stays insert-only otherwise: the only delete it accepts is of
-- USER rows of a person with an erasure row in the same tenant. Other tiers are never deleted here.
set lock_timeout = '5s';
set statement_timeout = '60s';

create table config.setting_erasure (
  id           text        primary key check (id ~ '^ser_[0-9A-HJKMNP-TV-Z]{26}$'),
  tenant_id    text        not null,
  user_id      text        not null check (length(user_id) between 1 and 128),
  request_ref  text        not null check (request_ref ~ '^[A-Za-z0-9_.:-]{1,128}$'),
  value_rows   integer     not null check (value_rows >= 0),
  change_rows  integer     not null check (change_rows >= 0),
  erased_by    text        not null,
  erased_at    timestamptz not null default now()
);
comment on column config.setting_erasure.id is 'dataclass:INTERNAL';
comment on column config.setting_erasure.tenant_id is 'dataclass:INTERNAL';
comment on column config.setting_erasure.user_id is 'dataclass:INTERNAL';
comment on column config.setting_erasure.request_ref is 'dataclass:INTERNAL';
comment on column config.setting_erasure.value_rows is 'dataclass:INTERNAL';
comment on column config.setting_erasure.change_rows is 'dataclass:INTERNAL';
comment on column config.setting_erasure.erased_by is 'dataclass:INTERNAL';
comment on column config.setting_erasure.erased_at is 'dataclass:INTERNAL';
create index setting_erasure_user_idx on config.setting_erasure (tenant_id, user_id);

alter table config.setting_erasure enable row level security;
alter table config.setting_erasure force row level security;
create policy setting_erasure_read on config.setting_erasure for select
  using (tenant_id = current_setting('app.tenant_id', true));
create policy setting_erasure_insert on config.setting_erasure for insert
  with check (
    tenant_id = current_setting('app.tenant_id', true)
    and erased_by = current_setting('app.actor_id', true)
  );
grant select, insert on config.setting_erasure to app_rw;
grant select on config.setting_erasure to app_ro;

-- The only delete path for the change history: USER rows of an erased person, in the caller's tenant.
grant delete on config.setting_change to app_rw;
create policy setting_change_erase on config.setting_change for delete
  using (
    tier = 'USER'
    and tenant_id = current_setting('app.tenant_id', true)
    and exists (
      select 1 from config.setting_erasure e
       where e.tenant_id = setting_change.tenant_id and e.user_id = setting_change.scope_id
    )
  );
