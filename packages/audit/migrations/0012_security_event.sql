-- @infrabyx/audit 0012: security audit events (owner answer #132 (5); R1-D-187; threat model
-- §3.130). Expand-only. One row per attempt the platform refused for security reasons (for now a
-- refused reveal of a CONFIDENTIAL rule input, `rules.reveal.refused`): who, when, what was
-- targeted and why it was refused. `detail` holds ids, names and codes only, never a value, a
-- free-text purpose or personal data, and is bounded to 2 KiB.
--
-- Not part of the hash-chained business ledger (IPB-02-51 is unchanged) and not in a tenant's
-- business history: a refusal writes no ledger row. A row is written in its own short transaction
-- as `svc_security_event`, a role that may only insert into this table under the tenant's RLS, so
-- the path can change nothing else. Append-only for everyone: no update or delete grant to any
-- application role, and triggers refuse both. Kept like the ledger until the owner's retention
-- schedule says otherwise; nothing here deletes.
set lock_timeout = '5s';
set statement_timeout = '60s';

create table audit.security_event (
  id             text        primary key check (id ~ '^sev_[0-9A-HJKMNP-TV-Z]{26}$'),
  tenant_id      text        not null check (tenant_id ~ '^[A-Za-z0-9_]{1,64}$'),
  occurred_at    timestamptz not null default now(),
  actor_id       text        not null check (actor_id ~ '^[A-Za-z0-9_.:@/+=-]{1,255}$'),
  actor_type     text        not null check (actor_type in ('user', 'service', 'agent', 'breakglass', 'external')),
  kind           text        not null check (kind in ('rules.reveal.refused')),
  resource_type  text        not null check (resource_type ~ '^[a-z][a-z0-9_.]{0,63}$'),
  resource_id    text        check (resource_id ~ '^[A-Za-z0-9_.:@/+=-]{1,255}$'),
  detail         jsonb       not null default '{}'::jsonb
                             check (jsonb_typeof(detail) = 'object' and octet_length(detail::text) <= 2048),
  trace_id       text        check (trace_id ~ '^[A-Za-z0-9-]{1,64}$')
);
comment on table audit.security_event is
  'Security audit events (owner answer #132 (5)): refused attempts, outside the business ledger. Append-only.';
comment on column audit.security_event.id is 'dataclass:INTERNAL';
comment on column audit.security_event.tenant_id is 'dataclass:INTERNAL';
comment on column audit.security_event.occurred_at is 'dataclass:INTERNAL';
comment on column audit.security_event.actor_id is 'dataclass:INTERNAL';
comment on column audit.security_event.actor_type is 'dataclass:INTERNAL';
comment on column audit.security_event.kind is 'dataclass:INTERNAL';
comment on column audit.security_event.resource_type is 'dataclass:INTERNAL';
comment on column audit.security_event.resource_id is 'dataclass:INTERNAL';
comment on column audit.security_event.detail is 'dataclass:INTERNAL';
comment on column audit.security_event.trace_id is 'dataclass:INTERNAL';
create index security_event_actor_idx on audit.security_event (tenant_id, actor_id, occurred_at);
create index security_event_time_idx on audit.security_event (tenant_id, occurred_at);

create trigger security_event_no_update before update or delete on audit.security_event
  for each row execute function audit.refuse_change();
create trigger security_event_no_truncate before truncate on audit.security_event
  for each statement execute function audit.refuse_change();

alter table audit.security_event enable row level security;
alter table audit.security_event force row level security;
create policy security_event_read on audit.security_event for select
  using (tenant_id = current_setting('app.tenant_id', true));
create policy security_event_append on audit.security_event for insert
  with check (tenant_id = current_setting('app.tenant_id', true));

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'svc_security_event') then
    create role svc_security_event nologin nosuperuser nobypassrls nocreatedb nocreaterole;
  end if;
end
$$;

revoke all on audit.security_event from public;
revoke update, delete, truncate on audit.security_event from app_rw, app_ro, app_migrate;
grant select on audit.security_event to app_rw, app_ro;
grant usage on schema audit to svc_security_event;
grant insert on audit.security_event to svc_security_event;
grant svc_security_event to app_rw with inherit false, set true;
