-- @infrabyx/ai 0002: AI run retention, approved by the owner (OWNER-QUESTIONS #30, PL4-D-05).
-- Expand-only.
-- (1) Routine run rows (metadata only; no content is ever stored) are deleted 180 days after the
--     run, by the retention sweep, with each deletion ledgered in the same transaction.
-- (2) A run linked to an approval, a statutory output or a maker-checker request is held: a
--     `run_hold` row keeps it for as long as the linked record is kept, and the sweep never deletes
--     it. The owner of the linked record releases the hold when that record itself is deleted.
-- (3) The rules are enforced by PostgreSQL, not only by the sweep: a restrictive policy lets a
--     delete reach only runs older than 180 days with no active hold, whatever the caller.
-- (4) SVC_AI_RUN_SWEEP finds tenants with runs past the floor. It may select only the run id,
--     tenant and time, has no write grant, and is granted to app_rw and app_ro so their login
--     users can SET LOCAL ROLE.
set lock_timeout = '5s';
set statement_timeout = '60s';

create table ai.run_hold (
  run_id       text        not null check (run_id ~ '^run_[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  tenant_id    text        not null,
  kind         text        not null check (kind in ('approval', 'statutory_output', 'maker_checker')),
  ref          text        not null check (length(ref) between 1 and 200),
  held_by      text        not null,
  created_at   timestamptz not null default now(),
  released_at  timestamptz,
  released_by  text,
  primary key (run_id, kind, ref),
  constraint run_hold_release_actor check ((released_at is null) = (released_by is null))
);
comment on column ai.run_hold.run_id is 'dataclass:INTERNAL';
comment on column ai.run_hold.tenant_id is 'dataclass:INTERNAL';
comment on column ai.run_hold.kind is 'dataclass:INTERNAL';
comment on column ai.run_hold.ref is 'dataclass:INTERNAL';
comment on column ai.run_hold.held_by is 'dataclass:INTERNAL';
comment on column ai.run_hold.created_at is 'dataclass:INTERNAL';
comment on column ai.run_hold.released_at is 'dataclass:INTERNAL';
comment on column ai.run_hold.released_by is 'dataclass:INTERNAL';
create index run_hold_active_idx on ai.run_hold (run_id) where released_at is null;
alter table ai.run_hold enable row level security;
alter table ai.run_hold force row level security;
create policy run_hold_tenant on ai.run_hold for all
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
grant select, insert on ai.run_hold to app_rw;
grant update (released_at, released_by) on ai.run_hold to app_rw;
grant select on ai.run_hold to app_ro;

-- A hold is released once and never reopened or rewritten.
create function ai.run_hold_release_once() returns trigger language plpgsql as $$
begin
  if old.released_at is not null then
    raise exception 'run hold % % % is already released', old.run_id, old.kind, old.ref
      using errcode = '42501';
  end if;
  return new;
end
$$;
create trigger run_hold_release_once before update on ai.run_hold
  for each row execute function ai.run_hold_release_once();

-- The only delete path for runs: older than the 180-day floor and not held.
grant delete on ai.run to app_rw;
create policy run_delete_retention on ai.run as restrictive for delete
  using (
    created_at < now() - interval '180 days'
    and not exists (
      select 1 from ai.run_hold h where h.run_id = run.id and h.released_at is null
    )
  );

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'svc_ai_run_sweep') then
    create role svc_ai_run_sweep nologin nosuperuser nobypassrls nocreatedb nocreaterole;
  end if;
end
$$;

grant usage on schema ai to svc_ai_run_sweep;
grant select (id, tenant_id, created_at) on ai.run to svc_ai_run_sweep;
create policy run_sweep on ai.run for select to svc_ai_run_sweep
  using (current_setting('app.scope', true) = 'platform');
grant svc_ai_run_sweep to app_rw, app_ro;
