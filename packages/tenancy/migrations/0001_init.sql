-- @infrabyx/tenancy 0001: database roles, tenants, users, memberships, approvals, break-glass,
-- impersonation, outbox and inbox (IPB-01 §01.4.6, IPB-02 §02.3.A–B, §02.4.2). Expand-only.
-- app.tenant_id and app.scope are set with SET LOCAL by the transaction kernel only (IPB-02-13).
set lock_timeout = '5s';
set statement_timeout = '60s';

-- Roles (IPB-01 §01.4.6): RLS-subject application roles; never BYPASSRLS (IPB-02-12).
-- Login users are created by the deployment and granted one of these roles.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_rw') then
    create role app_rw nologin nosuperuser nobypassrls nocreatedb nocreaterole;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'app_ro') then
    create role app_ro nologin nosuperuser nobypassrls nocreatedb nocreaterole;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'app_migrate') then
    create role app_migrate nologin nosuperuser nobypassrls nocreatedb nocreaterole;
  end if;
end
$$;

create schema if not exists tenancy;
revoke all on schema tenancy from public;
grant usage on schema tenancy to app_rw, app_ro;

create table tenancy.tenant (
  id          text        primary key check (id ~ '^tnt_[a-z0-9_]+$|^tnt_[0-9A-HJKMNP-TV-Z]{26}$'),
  org_id      text,
  product     text        not null check (product in ('LD', 'LDC', 'EQ', 'FBX', 'UDF', 'OH', 'PLATFORM')),
  name        text        not null,
  status      text        not null default 'active' check (status in ('active', 'suspended', 'deleted')),
  residency   text        not null default 'IN' check (residency in ('IN', 'IN-ZR', 'GLOBAL')),
  brand_id    text,
  plan_ref    text,
  created_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  check ((status = 'deleted') = (deleted_at is not null))
);
comment on column tenancy.tenant.id is 'dataclass:INTERNAL';
comment on column tenancy.tenant.org_id is 'dataclass:INTERNAL';
comment on column tenancy.tenant.product is 'dataclass:INTERNAL';
comment on column tenancy.tenant.name is 'dataclass:INTERNAL';
comment on column tenancy.tenant.status is 'dataclass:INTERNAL';
comment on column tenancy.tenant.residency is 'dataclass:INTERNAL';
comment on column tenancy.tenant.brand_id is 'dataclass:INTERNAL';
comment on column tenancy.tenant.plan_ref is 'dataclass:INTERNAL';
comment on column tenancy.tenant.created_at is 'dataclass:INTERNAL';
comment on column tenancy.tenant.deleted_at is 'dataclass:INTERNAL';
alter table tenancy.tenant enable row level security;
alter table tenancy.tenant force row level security;
create policy tenant_read on tenancy.tenant for select
  using (id = current_setting('app.tenant_id', true) or current_setting('app.scope', true) = 'platform');
create policy tenant_insert on tenancy.tenant for insert
  with check (current_setting('app.scope', true) = 'platform');
create policy tenant_update on tenancy.tenant for update
  using (current_setting('app.scope', true) = 'platform' or id = current_setting('app.tenant_id', true))
  with check (current_setting('app.scope', true) = 'platform' or id = current_setting('app.tenant_id', true));
grant select, insert, update on tenancy.tenant to app_rw;
grant select on tenancy.tenant to app_ro;

create table tenancy.legal_entity (
  id          text        primary key check (id ~ '^ent_[0-9A-HJKMNP-TV-Z]{26}$'),
  tenant_id   text        not null references tenancy.tenant (id),
  name        text        not null,
  cin         text,
  gstin       text,
  created_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  unique (tenant_id, id)
);
comment on column tenancy.legal_entity.id is 'dataclass:INTERNAL';
comment on column tenancy.legal_entity.tenant_id is 'dataclass:INTERNAL';
comment on column tenancy.legal_entity.name is 'dataclass:INTERNAL';
comment on column tenancy.legal_entity.cin is 'dataclass:CONFIDENTIAL';
comment on column tenancy.legal_entity.gstin is 'dataclass:CONFIDENTIAL';
comment on column tenancy.legal_entity.created_at is 'dataclass:INTERNAL';
comment on column tenancy.legal_entity.deleted_at is 'dataclass:INTERNAL';
alter table tenancy.legal_entity enable row level security;
alter table tenancy.legal_entity force row level security;
create policy legal_entity_tenant on tenancy.legal_entity for all
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
grant select, insert, update on tenancy.legal_entity to app_rw;
grant select on tenancy.legal_entity to app_ro;

-- Identity anchor only; the profile lives in the IDENTITY provider. Not tenant-scoped: visible
-- through a membership in the current tenant, or in a platform context.
create table tenancy.user (
  id           text        primary key check (id ~ '^usr_[0-9A-HJKMNP-TV-Z]{26}$'),
  idp_subject  text        not null unique,
  type         text        not null default 'user' check (type in ('user', 'service', 'agent')),
  status       text        not null default 'active' check (status in ('active', 'disabled', 'deleted')),
  created_at   timestamptz not null default now()
);
comment on column tenancy.user.id is 'dataclass:INTERNAL';
comment on column tenancy.user.idp_subject is 'dataclass:CONFIDENTIAL';
comment on column tenancy.user.type is 'dataclass:INTERNAL';
comment on column tenancy.user.status is 'dataclass:INTERNAL';
comment on column tenancy.user.created_at is 'dataclass:INTERNAL';

create table tenancy.membership (
  tenant_id      text        not null references tenancy.tenant (id),
  user_id        text        not null references tenancy.user (id),
  roles          text[]      not null default '{}',
  entity_ids     text[]      not null default '{}',
  product_scope  text[]      not null default '{}',
  created_at     timestamptz not null default now(),
  primary key (tenant_id, user_id)
);
comment on column tenancy.membership.tenant_id is 'dataclass:INTERNAL';
comment on column tenancy.membership.user_id is 'dataclass:INTERNAL';
comment on column tenancy.membership.roles is 'dataclass:INTERNAL';
comment on column tenancy.membership.entity_ids is 'dataclass:INTERNAL';
comment on column tenancy.membership.product_scope is 'dataclass:INTERNAL';
comment on column tenancy.membership.created_at is 'dataclass:INTERNAL';
create index membership_user_idx on tenancy.membership (user_id);
alter table tenancy.membership enable row level security;
alter table tenancy.membership force row level security;
create policy membership_tenant on tenancy.membership for all
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
grant select, insert, update, delete on tenancy.membership to app_rw;
grant select on tenancy.membership to app_ro;

alter table tenancy.user enable row level security;
alter table tenancy.user force row level security;
create policy user_read on tenancy.user for select
  using (
    current_setting('app.scope', true) = 'platform'
    or exists (select 1 from tenancy.membership m where m.user_id = "user".id and m.tenant_id = current_setting('app.tenant_id', true))
  );
create policy user_insert on tenancy.user for insert with check (true);
create policy user_update on tenancy.user for update
  using (
    current_setting('app.scope', true) = 'platform'
    or exists (select 1 from tenancy.membership m where m.user_id = "user".id and m.tenant_id = current_setting('app.tenant_id', true))
  );
grant select, insert, update on tenancy.user to app_rw;
grant select on tenancy.user to app_ro;

-- Maker-checker (IPB-02 §02.4.2, §02.4.6.1). Checker ≠ maker is enforced by the composite FK
-- plus CHECK on approval_decision, and again in code.
create table tenancy.approval_request (
  id                 text        primary key check (id ~ '^apr_[0-9A-HJKMNP-TV-Z]{26}$'),
  tenant_id          text        not null references tenancy.tenant (id),
  action             text        not null check (action ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
  risk_class         text        not null check (risk_class in ('R2', 'R3', 'R4', 'R5')),
  payload_digest     text        not null check (payload_digest ~ '^[0-9a-f]{64}$'),
  payload            jsonb,
  payload_enc        bytea,
  payload_key_id     text,
  payload_class      text        not null default 'INTERNAL' check (payload_class in ('PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'REGULATED')),
  summary            text,
  maker_id           text        not null,
  maker_type         text        not null check (maker_type in ('user', 'service', 'agent', 'breakglass')),
  state              text        not null default 'pending' check (state in ('pending', 'approved', 'rejected', 'cancelled', 'executed')),
  required_checkers  integer     not null check (required_checkers between 1 and 3),
  delay_minutes      integer     not null default 0 check (delay_minutes >= 0),
  created_at         timestamptz not null default now(),
  approved_at        timestamptz,
  delay_until        timestamptz,
  executed_at        timestamptz,
  cancelled_by       text,
  unique (id, maker_id),
  check ((payload is null) <> (payload_enc is null)),
  check (payload_enc is null or payload_key_id is not null),
  check (payload_class in ('PUBLIC', 'INTERNAL') or payload_enc is not null)
);
comment on column tenancy.approval_request.id is 'dataclass:INTERNAL';
comment on column tenancy.approval_request.tenant_id is 'dataclass:INTERNAL';
comment on column tenancy.approval_request.action is 'dataclass:INTERNAL';
comment on column tenancy.approval_request.risk_class is 'dataclass:INTERNAL';
comment on column tenancy.approval_request.payload_digest is 'dataclass:INTERNAL';
comment on column tenancy.approval_request.payload is 'dataclass:INTERNAL';
comment on column tenancy.approval_request.payload_enc is 'dataclass:REGULATED';
comment on column tenancy.approval_request.payload_key_id is 'dataclass:INTERNAL';
comment on column tenancy.approval_request.payload_class is 'dataclass:INTERNAL';
comment on column tenancy.approval_request.summary is 'dataclass:INTERNAL';
comment on column tenancy.approval_request.maker_id is 'dataclass:INTERNAL';
comment on column tenancy.approval_request.maker_type is 'dataclass:INTERNAL';
comment on column tenancy.approval_request.state is 'dataclass:INTERNAL';
comment on column tenancy.approval_request.required_checkers is 'dataclass:INTERNAL';
comment on column tenancy.approval_request.delay_minutes is 'dataclass:INTERNAL';
comment on column tenancy.approval_request.created_at is 'dataclass:INTERNAL';
comment on column tenancy.approval_request.approved_at is 'dataclass:INTERNAL';
comment on column tenancy.approval_request.delay_until is 'dataclass:INTERNAL';
comment on column tenancy.approval_request.executed_at is 'dataclass:INTERNAL';
comment on column tenancy.approval_request.cancelled_by is 'dataclass:INTERNAL';
create index approval_request_state_idx on tenancy.approval_request (tenant_id, state);
alter table tenancy.approval_request enable row level security;
alter table tenancy.approval_request force row level security;
create policy approval_request_tenant on tenancy.approval_request for all
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
grant select, insert, update on tenancy.approval_request to app_rw;
grant select on tenancy.approval_request to app_ro;

create table tenancy.approval_decision (
  request_id  text        not null,
  tenant_id   text        not null references tenancy.tenant (id),
  maker_id    text        not null,
  checker_id  text        not null,
  decision    text        not null check (decision in ('approve', 'reject')),
  reason      text,
  decided_at  timestamptz not null default now(),
  primary key (request_id, checker_id),
  foreign key (request_id, maker_id) references tenancy.approval_request (id, maker_id),
  check (checker_id <> maker_id)
);
comment on column tenancy.approval_decision.request_id is 'dataclass:INTERNAL';
comment on column tenancy.approval_decision.tenant_id is 'dataclass:INTERNAL';
comment on column tenancy.approval_decision.maker_id is 'dataclass:INTERNAL';
comment on column tenancy.approval_decision.checker_id is 'dataclass:INTERNAL';
comment on column tenancy.approval_decision.decision is 'dataclass:INTERNAL';
comment on column tenancy.approval_decision.reason is 'dataclass:CONFIDENTIAL';
comment on column tenancy.approval_decision.decided_at is 'dataclass:INTERNAL';
alter table tenancy.approval_decision enable row level security;
alter table tenancy.approval_decision force row level security;
create policy approval_decision_tenant on tenancy.approval_decision for all
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
grant select, insert on tenancy.approval_decision to app_rw;
grant select on tenancy.approval_decision to app_ro;

-- Break-glass grants (IPB-02-06): platform tenant, platform context only.
create table tenancy.breakglass_grant (
  id                 text        primary key check (id ~ '^bgr_[0-9A-HJKMNP-TV-Z]{26}$'),
  tenant_id          text        not null references tenancy.tenant (id),
  requester_id       text        not null,
  approver_id        text,
  reason             text        not null check (length(reason) >= 10),
  duration_minutes   integer     not null check (duration_minutes between 1 and 240),
  state              text        not null default 'requested' check (state in ('requested', 'active', 'revoked')),
  requested_at       timestamptz not null default now(),
  approved_at        timestamptz,
  expires_at         timestamptz,
  revoked_at         timestamptz,
  review_ticket_ref  text,
  check (approver_id is null or approver_id <> requester_id),
  check (state = 'requested' or (approver_id is not null and expires_at is not null and review_ticket_ref is not null)),
  check (expires_at is null or expires_at <= approved_at + interval '4 hours')
);
comment on column tenancy.breakglass_grant.id is 'dataclass:INTERNAL';
comment on column tenancy.breakglass_grant.tenant_id is 'dataclass:INTERNAL';
comment on column tenancy.breakglass_grant.requester_id is 'dataclass:INTERNAL';
comment on column tenancy.breakglass_grant.approver_id is 'dataclass:INTERNAL';
comment on column tenancy.breakglass_grant.reason is 'dataclass:CONFIDENTIAL';
comment on column tenancy.breakglass_grant.duration_minutes is 'dataclass:INTERNAL';
comment on column tenancy.breakglass_grant.state is 'dataclass:INTERNAL';
comment on column tenancy.breakglass_grant.requested_at is 'dataclass:INTERNAL';
comment on column tenancy.breakglass_grant.approved_at is 'dataclass:INTERNAL';
comment on column tenancy.breakglass_grant.expires_at is 'dataclass:INTERNAL';
comment on column tenancy.breakglass_grant.revoked_at is 'dataclass:INTERNAL';
comment on column tenancy.breakglass_grant.review_ticket_ref is 'dataclass:INTERNAL';
alter table tenancy.breakglass_grant enable row level security;
alter table tenancy.breakglass_grant force row level security;
create policy breakglass_grant_platform on tenancy.breakglass_grant for all
  using (tenant_id = current_setting('app.tenant_id', true) and current_setting('app.scope', true) = 'platform')
  with check (tenant_id = current_setting('app.tenant_id', true) and current_setting('app.scope', true) = 'platform');
grant select, insert, update on tenancy.breakglass_grant to app_rw;

-- The kernel checks a bg token's grant from any tenant context; this definer function exposes
-- only "is grant <id> active for <principal> now" (allow-listed in rls-lint).
create function tenancy.breakglass_active(grant_id text, principal_id text) returns boolean
  language sql stable security definer set search_path = pg_catalog, tenancy
  as $$
    select exists (
      select 1 from tenancy.breakglass_grant g
       where g.id = grant_id and g.requester_id = principal_id
         and g.state = 'active' and g.expires_at > now()
    )
  $$;
revoke all on function tenancy.breakglass_active(text, text) from public;
grant execute on function tenancy.breakglass_active(text, text) to app_rw;

-- Impersonation (IPB-02-09): read-only "view as user"; rows belong to the target tenant so its
-- ORG_OWNER can see them, and are written only in a platform context.
create table tenancy.impersonation_session (
  id              text        primary key check (id ~ '^imp_[0-9A-HJKMNP-TV-Z]{26}$'),
  tenant_id       text        not null references tenancy.tenant (id),
  actor_id        text        not null,
  target_user_id  text        not null,
  ticket_ref      text        not null check (length(ticket_ref) >= 3),
  started_at      timestamptz not null default now(),
  expires_at      timestamptz not null,
  ended_at        timestamptz,
  check (actor_id <> target_user_id),
  check (expires_at <= started_at + interval '60 minutes')
);
comment on column tenancy.impersonation_session.id is 'dataclass:INTERNAL';
comment on column tenancy.impersonation_session.tenant_id is 'dataclass:INTERNAL';
comment on column tenancy.impersonation_session.actor_id is 'dataclass:INTERNAL';
comment on column tenancy.impersonation_session.target_user_id is 'dataclass:INTERNAL';
comment on column tenancy.impersonation_session.ticket_ref is 'dataclass:INTERNAL';
comment on column tenancy.impersonation_session.started_at is 'dataclass:INTERNAL';
comment on column tenancy.impersonation_session.expires_at is 'dataclass:INTERNAL';
comment on column tenancy.impersonation_session.ended_at is 'dataclass:INTERNAL';
alter table tenancy.impersonation_session enable row level security;
alter table tenancy.impersonation_session force row level security;
create policy impersonation_read on tenancy.impersonation_session for select
  using (tenant_id = current_setting('app.tenant_id', true));
create policy impersonation_insert on tenancy.impersonation_session for insert
  with check (tenant_id = current_setting('app.tenant_id', true) and current_setting('app.scope', true) = 'platform');
create policy impersonation_update on tenancy.impersonation_session for update
  using (tenant_id = current_setting('app.tenant_id', true) and current_setting('app.scope', true) = 'platform')
  with check (tenant_id = current_setting('app.tenant_id', true) and current_setting('app.scope', true) = 'platform');
grant select, insert, update on tenancy.impersonation_session to app_rw;
grant select on tenancy.impersonation_session to app_ro;

-- Transactional outbox and consumer inbox (IPB-01 §01.4.3.3).
create table tenancy.outbox (
  id             text        primary key,
  tenant_id      text        not null,
  type           text        not null,
  envelope       jsonb       not null,
  created_at     timestamptz not null default now(),
  dispatched_at  timestamptz,
  attempts       integer     not null default 0
);
comment on column tenancy.outbox.id is 'dataclass:INTERNAL';
comment on column tenancy.outbox.tenant_id is 'dataclass:INTERNAL';
comment on column tenancy.outbox.type is 'dataclass:INTERNAL';
comment on column tenancy.outbox.envelope is 'dataclass:CONFIDENTIAL';
comment on column tenancy.outbox.created_at is 'dataclass:INTERNAL';
comment on column tenancy.outbox.dispatched_at is 'dataclass:INTERNAL';
comment on column tenancy.outbox.attempts is 'dataclass:INTERNAL';
create index outbox_pending_idx on tenancy.outbox (created_at) where dispatched_at is null;
alter table tenancy.outbox enable row level security;
alter table tenancy.outbox force row level security;
create policy outbox_tenant on tenancy.outbox for all
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
grant select, insert, update on tenancy.outbox to app_rw;
grant select on tenancy.outbox to app_ro;

create table tenancy.inbox (
  consumer      text        not null,
  event_id      text        not null,
  tenant_id     text        not null,
  processed_at  timestamptz not null default now(),
  primary key (consumer, event_id)
);
comment on column tenancy.inbox.consumer is 'dataclass:INTERNAL';
comment on column tenancy.inbox.event_id is 'dataclass:INTERNAL';
comment on column tenancy.inbox.tenant_id is 'dataclass:INTERNAL';
comment on column tenancy.inbox.processed_at is 'dataclass:INTERNAL';
alter table tenancy.inbox enable row level security;
alter table tenancy.inbox force row level security;
create policy inbox_tenant on tenancy.inbox for all
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
grant select, insert, delete on tenancy.inbox to app_rw;
grant select on tenancy.inbox to app_ro;
