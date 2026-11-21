-- @infrabyx/tenancy 0027: parked outbox rows (Finbyx PR-FBX-53, R1-D-266). The outbox relay no
-- longer stops a pass on a row it cannot deliver: after a bounded number of attempts it parks the
-- row here, in the row's own tenant, and goes on with the rest. A parked row stays undispatched in
-- its `<schema>.outbox`; the relay skips it while its park is open. One row per park:
--   tenant_id    the event's tenant (the row's own tenant context writes it, under RLS);
--   schema_name  the module schema whose outbox holds the event;
--   event_id     the outbox row's id (the event id);
--   event_type   the CloudEvents type, so an operator can see what is parked;
--   reason       a fixed label (`queue_refused`, `queue_unavailable`, `delivery_failed`), never
--                an error message, which could carry data;
--   attempts     the row's `attempts` when it was parked;
--   parked_at    when;
--   requeued_at, requeued_by   set together, once, by the operator's requeue (a ledgered tenant
--                mutation); the relay then tries the row again with a fresh attempt budget.
-- Grants: SVC_OUTBOX_RELAY may select the columns it needs and insert a park, in a tenant context
-- under the tenant policy, and select (not insert) in the platform scope, so its discovery read
-- leaves parked rows out; app_rw may select and set the requeue columns of an open park only;
-- app_ro selects. Nobody deletes: a park is the record of what happened. Expand-only.
set lock_timeout = '5s';
set statement_timeout = '60s';

create table tenancy.outbox_parked (
  tenant_id    text        not null,
  schema_name  text        not null check (schema_name ~ '^[a-z][a-z0-9_]*$'),
  event_id     text        not null check (length(event_id) between 1 and 128),
  event_type   text        not null check (length(event_type) between 1 and 256),
  reason       text        not null check (reason ~ '^[a-z][a-z_]{0,39}$'),
  attempts     integer     not null check (attempts >= 1),
  parked_at    timestamptz not null default now(),
  requeued_at  timestamptz,
  requeued_by  text        check (length(requeued_by) between 1 and 128),
  primary key (tenant_id, schema_name, event_id, parked_at),
  check ((requeued_at is null) = (requeued_by is null))
);
comment on table tenancy.outbox_parked is
  'Outbox rows the relay parked after its attempts ran out (PR-FBX-53, R1-D-266); a requeue reopens delivery. Never deleted.';
comment on column tenancy.outbox_parked.tenant_id is 'dataclass:INTERNAL';
comment on column tenancy.outbox_parked.schema_name is 'dataclass:INTERNAL';
comment on column tenancy.outbox_parked.event_id is 'dataclass:INTERNAL';
comment on column tenancy.outbox_parked.event_type is 'dataclass:INTERNAL';
comment on column tenancy.outbox_parked.reason is 'dataclass:INTERNAL';
comment on column tenancy.outbox_parked.attempts is 'dataclass:INTERNAL';
comment on column tenancy.outbox_parked.parked_at is 'dataclass:INTERNAL';
comment on column tenancy.outbox_parked.requeued_at is 'dataclass:INTERNAL';
comment on column tenancy.outbox_parked.requeued_by is 'dataclass:INTERNAL';
-- At most one open park per event.
create unique index outbox_parked_open_idx on tenancy.outbox_parked (schema_name, event_id)
  where requeued_at is null;
create index outbox_parked_tenant_idx on tenancy.outbox_parked (tenant_id, parked_at);

alter table tenancy.outbox_parked enable row level security;
alter table tenancy.outbox_parked force row level security;
create policy outbox_parked_tenant on tenancy.outbox_parked for all
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
-- The relay's discovery read (platform scope) sees which events are parked, to leave them out.
create policy outbox_parked_relay_discover on tenancy.outbox_parked for select to svc_outbox_relay
  using (current_setting('app.scope', true) = 'platform');
-- A park is requeued once; a requeued park is never changed again.
create policy outbox_parked_requeue_once on tenancy.outbox_parked
  as restrictive for update using (requeued_at is null) with check (true);

grant usage on schema tenancy to svc_outbox_relay;
grant select (tenant_id, schema_name, event_id, attempts, requeued_at),
      insert (tenant_id, schema_name, event_id, event_type, reason, attempts)
  on tenancy.outbox_parked to svc_outbox_relay;
grant select, update (requeued_at, requeued_by) on tenancy.outbox_parked to app_rw;
grant select on tenancy.outbox_parked to app_ro;
