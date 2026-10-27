-- @infrabyx/feedback 0001: feedback items, their status history and the accessibility SLA timers
-- (IPB-04 §04.3.11, IPB-04-94…98; IPB-06-61, 06-62; Ecosystem §6.40; PL5 plan §7.1). Expand-only.
-- (1) Minimisation (IPB-04-95): an item holds a route pattern (never a URL, query string or
--     document id), the app version, pack, locale, viewport class, OS and browser family, the trace
--     id and the consent id (public) or user id (authenticated). Never page content, form values or
--     a screenshot: there is no column for any of them.
-- (2) The summary is PII-scanned before it is stored (the package refuses it otherwise); a CHECK
--     keeps it short.
-- (3) Status comes from OH (`FeedbackStatusChanged`); each change is a row in `status_change`
--     (append-only). Accessibility items carry the IPB-06-62 SLA due dates and the breaches raised.
-- (4) Deletion (OWNER-QUESTIONS #48, PL5-D-10; the owner's approval): an item is deleted 3 years
--     after it was closed (SHIPPED, DECLINED or DUPLICATE). PostgreSQL refuses every other delete.
--     SVC_FEEDBACK_SLA finds the tenants with SLA timers due, hand-offs pending and items to purge.
set lock_timeout = '5s';
set statement_timeout = '60s';

create schema if not exists feedback;
revoke all on schema feedback from public;
grant usage on schema feedback to app_rw, app_ro;

create table feedback.item (
  id                  text        primary key check (id ~ '^fbk_[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  tenant_id           text        not null,
  type                text        not null check (type in ('bug', 'idea', 'praise', 'nps', 'accessibility', 'help_content')),
  category            text        not null check (category in ('BUG', 'IDEA', 'UX', 'ACCESSIBILITY', 'CONTENT', 'HELP_ARTICLE')),
  surface             text        not null check (surface in ('WIDGET', 'HELP_ARTICLE', 'BETA', 'A11Y', 'VIDHI')),
  summary             text        not null check (length(summary) between 1 and 2000),
  nps_score           smallint    check (nps_score between 0 and 10),
  assistive_tech      text        check (length(assistive_tech) <= 120),
  route_pattern       text        check (route_pattern ~ '^/[A-Za-z0-9/_:.\-\[\]]{0,200}$'),
  app_version         text        check (length(app_version) <= 40),
  brand_pack_id       text        check (brand_pack_id ~ '^brd_'),
  locale              text        check (locale ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  viewport_class      text        check (viewport_class in ('xs', 'sm', 'md', 'lg', 'xl')),
  os_family           text        check (length(os_family) <= 20),
  browser_family      text        check (length(browser_family) <= 20),
  trace_id            text        check (trace_id ~ '^[0-9a-f]{32}$'),
  cid                 text        check (cid ~ '^[A-Za-z0-9_-]{16,64}$'),
  user_id             text        check (user_id ~ '^usr_'),
  submitted_by_role   text        not null check (length(submitted_by_role) between 2 and 40),
  view_key_sha256     text        check (view_key_sha256 ~ '^[0-9a-f]{64}$'),
  contact_ok          boolean     not null default false,
  severity            text        check (severity in ('S1', 'S2', 'S3', 'S4')),
  status              text        not null default 'RECEIVED'
                                  check (status in ('RECEIVED', 'TRIAGED', 'PLANNED', 'SHIPPED', 'DECLINED', 'DUPLICATE')),
  oh_ref              text        check (length(oh_ref) between 1 and 80),
  hand_off_attempts   integer     not null default 0,
  priority            text        check (priority in ('P1', 'P2', 'P3')),
  regulated_step      boolean     not null default false,
  ack_due_at          timestamptz,
  interim_due_at      timestamptz,
  workaround_due_at   timestamptz,
  fix_due_at          timestamptz,
  acknowledged_at     timestamptz,
  workaround_at       timestamptz,
  sla_breaches        text[]      not null default '{}',
  created_at          timestamptz not null default now(),
  status_changed_at   timestamptz not null default now(),
  closed_at           timestamptz,
  constraint item_subject check (cid is not null or user_id is not null),
  constraint item_nps check ((type = 'nps') = (nps_score is not null)),
  constraint item_a11y check (type = 'accessibility' or (ack_due_at is null and fix_due_at is null and priority is null)),
  constraint item_closed check ((status in ('SHIPPED', 'DECLINED', 'DUPLICATE')) = (closed_at is not null))
);
comment on column feedback.item.id is 'dataclass:INTERNAL';
comment on column feedback.item.tenant_id is 'dataclass:INTERNAL';
comment on column feedback.item.type is 'dataclass:INTERNAL';
comment on column feedback.item.category is 'dataclass:INTERNAL';
comment on column feedback.item.surface is 'dataclass:INTERNAL';
comment on column feedback.item.summary is 'dataclass:CONFIDENTIAL';
comment on column feedback.item.nps_score is 'dataclass:INTERNAL';
comment on column feedback.item.assistive_tech is 'dataclass:CONFIDENTIAL';
comment on column feedback.item.route_pattern is 'dataclass:INTERNAL';
comment on column feedback.item.app_version is 'dataclass:INTERNAL';
comment on column feedback.item.brand_pack_id is 'dataclass:INTERNAL';
comment on column feedback.item.locale is 'dataclass:INTERNAL';
comment on column feedback.item.viewport_class is 'dataclass:INTERNAL';
comment on column feedback.item.os_family is 'dataclass:INTERNAL';
comment on column feedback.item.browser_family is 'dataclass:INTERNAL';
comment on column feedback.item.trace_id is 'dataclass:INTERNAL';
comment on column feedback.item.cid is 'dataclass:CONFIDENTIAL';
comment on column feedback.item.user_id is 'dataclass:CONFIDENTIAL';
comment on column feedback.item.submitted_by_role is 'dataclass:INTERNAL';
comment on column feedback.item.view_key_sha256 is 'dataclass:CONFIDENTIAL';
comment on column feedback.item.contact_ok is 'dataclass:INTERNAL';
comment on column feedback.item.severity is 'dataclass:INTERNAL';
comment on column feedback.item.status is 'dataclass:INTERNAL';
comment on column feedback.item.oh_ref is 'dataclass:INTERNAL';
comment on column feedback.item.hand_off_attempts is 'dataclass:INTERNAL';
comment on column feedback.item.priority is 'dataclass:INTERNAL';
comment on column feedback.item.regulated_step is 'dataclass:INTERNAL';
comment on column feedback.item.ack_due_at is 'dataclass:INTERNAL';
comment on column feedback.item.interim_due_at is 'dataclass:INTERNAL';
comment on column feedback.item.workaround_due_at is 'dataclass:INTERNAL';
comment on column feedback.item.fix_due_at is 'dataclass:INTERNAL';
comment on column feedback.item.acknowledged_at is 'dataclass:INTERNAL';
comment on column feedback.item.workaround_at is 'dataclass:INTERNAL';
comment on column feedback.item.sla_breaches is 'dataclass:INTERNAL';
comment on column feedback.item.created_at is 'dataclass:INTERNAL';
comment on column feedback.item.status_changed_at is 'dataclass:INTERNAL';
comment on column feedback.item.closed_at is 'dataclass:INTERNAL';
create index item_cid_idx on feedback.item (tenant_id, cid, created_at) where cid is not null;
create index item_user_idx on feedback.item (tenant_id, user_id, created_at) where user_id is not null;
create index item_oh_ref_idx on feedback.item (tenant_id, oh_ref) where oh_ref is not null;
create index item_open_a11y_idx on feedback.item (created_at) where type = 'accessibility' and closed_at is null;
create index item_pending_idx on feedback.item (created_at) where oh_ref is null;
create index item_closed_idx on feedback.item (closed_at) where closed_at is not null;
alter table feedback.item enable row level security;
alter table feedback.item force row level security;
create policy item_tenant on feedback.item for select
  using (tenant_id = current_setting('app.tenant_id', true));
create policy item_insert on feedback.item for insert
  with check (tenant_id = current_setting('app.tenant_id', true));
create policy item_update on feedback.item for update
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
create policy item_delete on feedback.item for delete
  using (tenant_id = current_setting('app.tenant_id', true));
-- The purge rule (#48): only items closed more than 3 years ago.
create policy item_delete_retention on feedback.item as restrictive for delete
  using (closed_at is not null and closed_at < now() - interval '3 years');
grant select, insert, update, delete on feedback.item to app_rw;
grant select on feedback.item to app_ro;

-- What a submission said, how it was classified and who submitted it never change.
create function feedback.item_guard() returns trigger language plpgsql as $$
begin
  if new.id is distinct from old.id or new.tenant_id is distinct from old.tenant_id or new.type is distinct from old.type
      or new.summary is distinct from old.summary or new.nps_score is distinct from old.nps_score
      or new.assistive_tech is distinct from old.assistive_tech or new.route_pattern is distinct from old.route_pattern
      or new.cid is distinct from old.cid or new.user_id is distinct from old.user_id
      or new.view_key_sha256 is distinct from old.view_key_sha256 or new.created_at is distinct from old.created_at then
    raise exception 'feedback item % keeps what was submitted', old.id using errcode = '42501';
  end if;
  if old.oh_ref is not null and new.oh_ref is distinct from old.oh_ref then
    raise exception 'feedback item % already handed off', old.id using errcode = '42501';
  end if;
  if not (old.sla_breaches <@ new.sla_breaches) then
    raise exception 'feedback item % SLA breaches are append-only', old.id using errcode = '42501';
  end if;
  return new;
end
$$;
create trigger item_guard before update on feedback.item for each row execute function feedback.item_guard();

create table feedback.status_change (
  id          text        primary key check (id ~ '^fbs_[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  tenant_id   text        not null,
  item_id     text        not null references feedback.item (id) on delete cascade,
  status      text        not null check (status in ('RECEIVED', 'TRIAGED', 'PLANNED', 'SHIPPED', 'DECLINED', 'DUPLICATE')),
  public_note text        check (length(public_note) <= 300),
  source      text        not null check (source in ('oh_event', 'oh_poll', 'platform')),
  changed_at  timestamptz not null
);
comment on column feedback.status_change.id is 'dataclass:INTERNAL';
comment on column feedback.status_change.tenant_id is 'dataclass:INTERNAL';
comment on column feedback.status_change.item_id is 'dataclass:INTERNAL';
comment on column feedback.status_change.status is 'dataclass:INTERNAL';
comment on column feedback.status_change.public_note is 'dataclass:INTERNAL';
comment on column feedback.status_change.source is 'dataclass:INTERNAL';
comment on column feedback.status_change.changed_at is 'dataclass:INTERNAL';
create index status_change_item_idx on feedback.status_change (item_id, changed_at);
alter table feedback.status_change enable row level security;
alter table feedback.status_change force row level security;
create policy status_change_tenant on feedback.status_change for select
  using (tenant_id = current_setting('app.tenant_id', true));
create policy status_change_insert on feedback.status_change for insert
  with check (tenant_id = current_setting('app.tenant_id', true));
grant select, insert on feedback.status_change to app_rw;
grant select on feedback.status_change to app_ro;

-- History rows go only with their item (the cascade of the purge); any other change is refused.
create function feedback.append_only() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception '%.% is append-only', tg_table_schema, tg_table_name using errcode = '42501';
end
$$;
create trigger status_change_append_only before update or delete on feedback.status_change
  for each row execute function feedback.append_only();

-- The sweep's tenant finder: ids, tenants, timers and states only; no summary, no subject, no write.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'svc_feedback_sla') then
    create role svc_feedback_sla nologin nosuperuser nobypassrls nocreatedb nocreaterole;
  end if;
end
$$;
grant usage on schema feedback to svc_feedback_sla;
grant select (id, tenant_id, type, status, oh_ref, hand_off_attempts, created_at, closed_at, ack_due_at, interim_due_at,
              workaround_due_at, fix_due_at, acknowledged_at, workaround_at, sla_breaches)
  on feedback.item to svc_feedback_sla;
create policy item_sweep on feedback.item for select to svc_feedback_sla
  using (current_setting('app.scope', true) = 'platform');
grant svc_feedback_sla to app_rw, app_ro;

-- Transactional outbox and consumer inbox (IPB-01 §01.4.3.3).
create table feedback.outbox (
  id             text        primary key,
  tenant_id      text        not null,
  type           text        not null,
  envelope       jsonb       not null,
  created_at     timestamptz not null default now(),
  dispatched_at  timestamptz,
  attempts       integer     not null default 0
);
comment on column feedback.outbox.id is 'dataclass:INTERNAL';
comment on column feedback.outbox.tenant_id is 'dataclass:INTERNAL';
comment on column feedback.outbox.type is 'dataclass:INTERNAL';
comment on column feedback.outbox.envelope is 'dataclass:INTERNAL';
comment on column feedback.outbox.created_at is 'dataclass:INTERNAL';
comment on column feedback.outbox.dispatched_at is 'dataclass:INTERNAL';
comment on column feedback.outbox.attempts is 'dataclass:INTERNAL';
create index outbox_pending_idx on feedback.outbox (created_at) where dispatched_at is null;
alter table feedback.outbox enable row level security;
alter table feedback.outbox force row level security;
create policy outbox_tenant on feedback.outbox for all
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
grant select, insert, update on feedback.outbox to app_rw;
grant select on feedback.outbox to app_ro;

create table feedback.inbox (
  consumer      text        not null,
  event_id      text        not null,
  tenant_id     text        not null,
  processed_at  timestamptz not null default now(),
  primary key (consumer, event_id)
);
comment on column feedback.inbox.consumer is 'dataclass:INTERNAL';
comment on column feedback.inbox.event_id is 'dataclass:INTERNAL';
comment on column feedback.inbox.tenant_id is 'dataclass:INTERNAL';
comment on column feedback.inbox.processed_at is 'dataclass:INTERNAL';
alter table feedback.inbox enable row level security;
alter table feedback.inbox force row level security;
create policy inbox_tenant on feedback.inbox for all
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
grant select, insert on feedback.inbox to app_rw;
grant select on feedback.inbox to app_ro;
