-- @infrabyx/registers 0001: the register row store (regulatory templates item (a), part 2;
-- ADR-0016, R1-D-323). Its own schema (IPB-01-09: module = schema = bounded context).
-- One table of versioned rows: a correction is a new version, never an update of the data, and a
-- row is never deleted before its retention date (owner answer 2, R1-D-301): a trigger refuses it,
-- for every role, and there is no purge job and no delete grant. Data is `jsonb`, checked against
-- the register's `RegisterDefinition` before every write; up to CONFIDENTIAL (R1-D-323 (3)).
set lock_timeout = '5s';
set statement_timeout = '60s';

create schema if not exists registers;
revoke all on schema registers from public;
grant usage on schema registers to app_rw, app_ro, app_migrate;

create table registers.row_version (
  tenant_id           text        not null,
  row_id              text        not null check (row_id ~ '^rrw_[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  version             integer     not null check (version between 1 and 100000),
  register_code       text        not null check (register_code ~ '^[A-Z][A-Z0-9]{0,9}(-[A-Z0-9]{1,10}){0,4}$'),
  definition_version  text        not null check (definition_version ~ '^\d+\.\d+\.\d+$'),
  sheet               text        not null check (length(sheet) between 1 and 31),
  data                jsonb       not null check (jsonb_typeof(data) = 'object' and pg_column_size(data) <= 65536),
  data_sha256         text        not null check (data_sha256 ~ '^[0-9a-f]{64}$'),
  -- pending: awaiting its approval; current: the row's live version (one per row);
  -- superseded: an earlier version; rejected: an approval refused it.
  state               text        not null check (state in ('pending', 'current', 'superseded', 'rejected')),
  approval_id         text,
  retain_until        timestamptz not null,
  created_by          text        not null check (length(created_by) between 1 and 200),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  primary key (tenant_id, row_id, version)
);
create unique index row_version_one_current on registers.row_version (tenant_id, row_id)
  where state = 'current';
create unique index row_version_one_pending on registers.row_version (tenant_id, row_id)
  where state = 'pending';
create index row_version_list on registers.row_version (tenant_id, register_code, sheet, state, row_id);
comment on table registers.row_version is 'Versioned register rows; never deleted before retain_until (R1-D-323)';
comment on column registers.row_version.tenant_id is 'dataclass:INTERNAL';
comment on column registers.row_version.row_id is 'dataclass:INTERNAL';
comment on column registers.row_version.version is 'dataclass:INTERNAL';
comment on column registers.row_version.register_code is 'dataclass:INTERNAL';
comment on column registers.row_version.definition_version is 'dataclass:INTERNAL';
comment on column registers.row_version.sheet is 'dataclass:INTERNAL';
comment on column registers.row_version.data is 'dataclass:CONFIDENTIAL';
comment on column registers.row_version.data_sha256 is 'dataclass:CONFIDENTIAL';
comment on column registers.row_version.state is 'dataclass:INTERNAL';
comment on column registers.row_version.approval_id is 'dataclass:INTERNAL';
comment on column registers.row_version.retain_until is 'dataclass:INTERNAL';
comment on column registers.row_version.created_by is 'dataclass:INTERNAL';
comment on column registers.row_version.created_at is 'dataclass:INTERNAL';
comment on column registers.row_version.updated_at is 'dataclass:INTERNAL';

-- A version's content never changes: only its state (and approval link) moves, forward only.
create function registers.row_version_guard() returns trigger
  language plpgsql set search_path = pg_catalog, pg_temp as $$
begin
  if tg_op = 'DELETE' then
    if old.retain_until > now() then
      raise exception 'register row % version % is retained until %', old.row_id, old.version, old.retain_until
        using errcode = 'P0001', hint = 'register_row_retained';
    end if;
    return old;
  end if;
  if new.tenant_id <> old.tenant_id or new.row_id <> old.row_id or new.version <> old.version
     or new.register_code <> old.register_code or new.definition_version <> old.definition_version
     or new.sheet <> old.sheet or new.data <> old.data or new.data_sha256 <> old.data_sha256
     or new.retain_until <> old.retain_until or new.created_by <> old.created_by
     or new.created_at <> old.created_at then
    raise exception 'a register row version is immutable: correct it with a new version'
      using errcode = 'P0001', hint = 'register_row_immutable';
  end if;
  if not ((old.state = 'pending' and new.state in ('current', 'rejected'))
          or (old.state = 'current' and new.state = 'superseded')
          or old.state = new.state) then
    raise exception 'register row state % cannot become %', old.state, new.state
      using errcode = 'P0001', hint = 'register_row_state';
  end if;
  return new;
end;
$$;
create trigger row_version_guard before update or delete on registers.row_version
  for each row execute function registers.row_version_guard();
create function registers.row_version_refuse_truncate() returns trigger
  language plpgsql set search_path = pg_catalog, pg_temp as $$
begin
  raise exception 'register rows are never truncated' using errcode = 'P0001', hint = 'register_row_retained';
end;
$$;
create trigger row_version_no_truncate before truncate on registers.row_version
  for each statement execute function registers.row_version_refuse_truncate();

alter table registers.row_version enable row level security;
alter table registers.row_version force row level security;
create policy row_version_tenant on registers.row_version for all
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
grant select, insert, update on registers.row_version to app_rw;
grant select on registers.row_version to app_ro;
