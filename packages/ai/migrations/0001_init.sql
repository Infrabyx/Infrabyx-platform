-- @infrabyx/ai 0001: the model registry, the prompt registry and AI runs (IPB-03 §03.3.B, §03.3.D,
-- §03.3.G–H; PL4 plan §4, §9). Expand-only. Requires the roles created by @infrabyx/tenancy 0001.
-- Registry and prompt rows of the platform tenant (tnt_platform) are readable by every tenant and
-- written only in a platform context. A run row records a model call without its content: ids,
-- route, data class, usage, cost and guard flags. Every write goes through the kernel with an
-- audit ledger entry.
set lock_timeout = '5s';
set statement_timeout = '60s';

create schema if not exists ai;
revoke all on schema ai from public;
grant usage on schema ai to app_rw, app_ro;

-- Model registry (IPB-03-11 to 03-17, §03.4.4). `model_id` is `<adapter_key>/<provider model>`.
create table ai.model (
  model_id                text        primary key check (model_id ~ '^[a-z0-9_]+/[A-Za-z0-9._:@/-]+$'),
  tenant_id               text        not null default 'tnt_platform' check (tenant_id = 'tnt_platform'),
  adapter_key             text        not null check (adapter_key ~ '^[a-z0-9_]+$'),
  provider_model_name     text        not null,
  capabilities            text[]      not null check (capabilities <@ array['chat', 'tools', 'structured', 'stream', 'batch', 'vision', 'embed', 'image', 'stt', 'tts', 'rerank']::text[]),
  context_tokens          integer     check (context_tokens > 0),
  max_output_tokens       integer     check (max_output_tokens > 0),
  embedding_dims          integer     check (embedding_dims > 0),
  price_in_per_mtok       numeric(12, 4) check (price_in_per_mtok >= 0),
  price_out_per_mtok      numeric(12, 4) check (price_out_per_mtok >= 0),
  currency                char(3),
  residency               text        not null check (residency in ('IN', 'EU', 'US', 'GLOBAL', 'SELF')),
  retention_policy        text        not null check (retention_policy in ('ZERO', 'ABUSE_30D', 'STANDARD', 'UNKNOWN')),
  retention_evidence_url  text,
  training_opt_out        boolean     not null default false,
  training_evidence_url   text,
  eval_scores             jsonb       not null default '{}',
  state                   text        not null default 'CANDIDATE' check (state in ('CANDIDATE', 'EVALUATING', 'APPROVED', 'DEFAULT', 'DEPRECATED', 'BLOCKED')),
  sunset_at               timestamptz,
  approved_by             text,
  approved_at             timestamptz,
  notes                   text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  -- IPB-03-52: no model serves traffic without a documented training opt-out and retention evidence.
  constraint model_servable_evidence check (
    state not in ('APPROVED', 'DEFAULT')
    or (training_opt_out and retention_evidence_url is not null and training_evidence_url is not null)
  ),
  constraint model_deprecated_sunset check (state <> 'DEPRECATED' or sunset_at is not null)
);
comment on column ai.model.model_id is 'dataclass:INTERNAL';
comment on column ai.model.tenant_id is 'dataclass:INTERNAL';
comment on column ai.model.adapter_key is 'dataclass:INTERNAL';
comment on column ai.model.provider_model_name is 'dataclass:INTERNAL';
comment on column ai.model.capabilities is 'dataclass:INTERNAL';
comment on column ai.model.context_tokens is 'dataclass:INTERNAL';
comment on column ai.model.max_output_tokens is 'dataclass:INTERNAL';
comment on column ai.model.embedding_dims is 'dataclass:INTERNAL';
comment on column ai.model.price_in_per_mtok is 'dataclass:INTERNAL';
comment on column ai.model.price_out_per_mtok is 'dataclass:INTERNAL';
comment on column ai.model.currency is 'dataclass:INTERNAL';
comment on column ai.model.residency is 'dataclass:INTERNAL';
comment on column ai.model.retention_policy is 'dataclass:INTERNAL';
comment on column ai.model.retention_evidence_url is 'dataclass:INTERNAL';
comment on column ai.model.training_opt_out is 'dataclass:INTERNAL';
comment on column ai.model.training_evidence_url is 'dataclass:INTERNAL';
comment on column ai.model.eval_scores is 'dataclass:INTERNAL';
comment on column ai.model.state is 'dataclass:INTERNAL';
comment on column ai.model.sunset_at is 'dataclass:INTERNAL';
comment on column ai.model.approved_by is 'dataclass:INTERNAL';
comment on column ai.model.approved_at is 'dataclass:INTERNAL';
comment on column ai.model.notes is 'dataclass:INTERNAL';
comment on column ai.model.created_at is 'dataclass:INTERNAL';
comment on column ai.model.updated_at is 'dataclass:INTERNAL';
alter table ai.model enable row level security;
alter table ai.model force row level security;
create policy model_read on ai.model for select
  using (tenant_id = current_setting('app.tenant_id', true) or tenant_id = 'tnt_platform');
create policy model_insert on ai.model for insert
  with check (tenant_id = current_setting('app.tenant_id', true) and current_setting('app.scope', true) = 'platform');
create policy model_update on ai.model for update
  using (tenant_id = current_setting('app.tenant_id', true) and current_setting('app.scope', true) = 'platform')
  with check (tenant_id = current_setting('app.tenant_id', true) and current_setting('app.scope', true) = 'platform');
grant select, insert, update on ai.model to app_rw;
grant select on ai.model to app_ro;

-- Lifecycle history (append-only).
create table ai.model_event (
  id          bigint      generated always as identity primary key,
  tenant_id   text        not null default 'tnt_platform' check (tenant_id = 'tnt_platform'),
  model_id    text        not null references ai.model (model_id),
  from_state  text        not null,
  to_state    text        not null,
  actor_id    text        not null,
  approval_id text,
  reason      text,
  created_at  timestamptz not null default now()
);
comment on column ai.model_event.id is 'dataclass:INTERNAL';
comment on column ai.model_event.tenant_id is 'dataclass:INTERNAL';
comment on column ai.model_event.model_id is 'dataclass:INTERNAL';
comment on column ai.model_event.from_state is 'dataclass:INTERNAL';
comment on column ai.model_event.to_state is 'dataclass:INTERNAL';
comment on column ai.model_event.actor_id is 'dataclass:INTERNAL';
comment on column ai.model_event.approval_id is 'dataclass:INTERNAL';
comment on column ai.model_event.reason is 'dataclass:INTERNAL';
comment on column ai.model_event.created_at is 'dataclass:INTERNAL';
create index model_event_model_idx on ai.model_event (model_id, created_at);
alter table ai.model_event enable row level security;
alter table ai.model_event force row level security;
create policy model_event_read on ai.model_event for select
  using (tenant_id = current_setting('app.tenant_id', true) or tenant_id = 'tnt_platform');
create policy model_event_insert on ai.model_event for insert
  with check (tenant_id = current_setting('app.tenant_id', true) and current_setting('app.scope', true) = 'platform');
grant select, insert on ai.model_event to app_rw;
grant select on ai.model_event to app_ro;

-- Exactly one DEFAULT per (capability, band) (IPB-03-14): the primary key is the rule.
create table ai.default_model (
  capability  text        not null,
  band        text        not null check (band in ('open', 'in_zero', 'self')),
  tenant_id   text        not null default 'tnt_platform' check (tenant_id = 'tnt_platform'),
  model_id    text        not null references ai.model (model_id),
  set_by      text        not null,
  approval_id text,
  updated_at  timestamptz not null default now(),
  primary key (capability, band)
);
comment on column ai.default_model.capability is 'dataclass:INTERNAL';
comment on column ai.default_model.band is 'dataclass:INTERNAL';
comment on column ai.default_model.tenant_id is 'dataclass:INTERNAL';
comment on column ai.default_model.model_id is 'dataclass:INTERNAL';
comment on column ai.default_model.set_by is 'dataclass:INTERNAL';
comment on column ai.default_model.approval_id is 'dataclass:INTERNAL';
comment on column ai.default_model.updated_at is 'dataclass:INTERNAL';
alter table ai.default_model enable row level security;
alter table ai.default_model force row level security;
create policy default_model_read on ai.default_model for select
  using (tenant_id = current_setting('app.tenant_id', true) or tenant_id = 'tnt_platform');
create policy default_model_write on ai.default_model for all
  using (tenant_id = current_setting('app.tenant_id', true) and current_setting('app.scope', true) = 'platform')
  with check (tenant_id = current_setting('app.tenant_id', true) and current_setting('app.scope', true) = 'platform');
grant select, insert, update, delete on ai.default_model to app_rw;
grant select on ai.default_model to app_ro;

-- Prompt registry (IPB-03-25, 03-26). Platform prompts in tnt_platform; a tenant may hold its own.
-- A version's template never changes once it leaves DRAFT.
create table ai.prompt_version (
  prompt_key          text        not null check (prompt_key ~ '^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$'),
  version             text        not null check (version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
  tenant_id           text        not null,
  major               integer     not null check (major >= 0),
  owner_role          text        not null,
  template            text        not null,
  variables_schema    jsonb       not null default '{}',
  eval_set_ref        text        not null,
  data_class_max      text        not null check (data_class_max in ('PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'REGULATED', 'SECRET')),
  status              text        not null default 'DRAFT' check (status in ('DRAFT', 'ACTIVE', 'RETIRED')),
  content_sha256      text        not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  eval_passed_sha256  text        check (eval_passed_sha256 ~ '^[0-9a-f]{64}$'),
  created_by          text        not null,
  created_at          timestamptz not null default now(),
  activated_at        timestamptz,
  primary key (tenant_id, prompt_key, version)
);
comment on column ai.prompt_version.prompt_key is 'dataclass:INTERNAL';
comment on column ai.prompt_version.version is 'dataclass:INTERNAL';
comment on column ai.prompt_version.tenant_id is 'dataclass:INTERNAL';
comment on column ai.prompt_version.major is 'dataclass:INTERNAL';
comment on column ai.prompt_version.owner_role is 'dataclass:INTERNAL';
comment on column ai.prompt_version.template is 'dataclass:INTERNAL';
comment on column ai.prompt_version.variables_schema is 'dataclass:INTERNAL';
comment on column ai.prompt_version.eval_set_ref is 'dataclass:INTERNAL';
comment on column ai.prompt_version.data_class_max is 'dataclass:INTERNAL';
comment on column ai.prompt_version.status is 'dataclass:INTERNAL';
comment on column ai.prompt_version.content_sha256 is 'dataclass:INTERNAL';
comment on column ai.prompt_version.eval_passed_sha256 is 'dataclass:INTERNAL';
comment on column ai.prompt_version.created_by is 'dataclass:INTERNAL';
comment on column ai.prompt_version.created_at is 'dataclass:INTERNAL';
comment on column ai.prompt_version.activated_at is 'dataclass:INTERNAL';
create unique index prompt_one_active on ai.prompt_version (tenant_id, prompt_key, major)
  where status = 'ACTIVE';
alter table ai.prompt_version enable row level security;
alter table ai.prompt_version force row level security;
create policy prompt_read on ai.prompt_version for select
  using (tenant_id = current_setting('app.tenant_id', true) or tenant_id = 'tnt_platform');
create policy prompt_write on ai.prompt_version for all
  using (
    tenant_id = current_setting('app.tenant_id', true)
    and (tenant_id <> 'tnt_platform' or current_setting('app.scope', true) = 'platform')
  )
  with check (
    tenant_id = current_setting('app.tenant_id', true)
    and (tenant_id <> 'tnt_platform' or current_setting('app.scope', true) = 'platform')
  );
grant select, insert, update on ai.prompt_version to app_rw;
grant select on ai.prompt_version to app_ro;

create function ai.prompt_template_immutable() returns trigger language plpgsql as $$
begin
  if old.status <> 'DRAFT' and (new.template is distinct from old.template
      or new.content_sha256 is distinct from old.content_sha256
      or new.variables_schema is distinct from old.variables_schema
      or new.data_class_max is distinct from old.data_class_max) then
    raise exception 'prompt % % is % and immutable', old.prompt_key, old.version, old.status
      using errcode = '42501';
  end if;
  return new;
end
$$;
create trigger prompt_template_immutable before update on ai.prompt_version
  for each row execute function ai.prompt_template_immutable();

-- AI runs (IPB-03-22, 03-45, 03-55): one row per gateway call, written once. No prompt, completion
-- or tool-argument text is stored here.
create table ai.run (
  id                    text        primary key check (id ~ '^run_[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  tenant_id             text        not null,
  feature_key           text        not null,
  skill_key             text,
  principal_id          text        not null,
  principal_type        text        not null,
  operation             text        not null check (operation in ('chat', 'tools', 'structured', 'stream', 'embed', 'image')),
  data_class            text        not null check (data_class in ('PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'REGULATED', 'SECRET')),
  band                  text        not null check (band in ('open', 'in_zero', 'self')),
  prompt_ref            text,
  prompt_sha256         text        check (prompt_sha256 ~ '^[0-9a-f]{64}$'),
  model_id              text,
  adapter_key           text,
  byok                  boolean     not null default false,
  outcome               text        not null check (outcome in ('ok', 'failed', 'refused', 'blocked')),
  error_code            text,
  route_reason          text        not null,
  candidates            jsonb       not null default '[]',
  tokens_in             integer     not null default 0 check (tokens_in >= 0),
  tokens_out            integer     not null default 0 check (tokens_out >= 0),
  cached_tokens         integer     not null default 0 check (cached_tokens >= 0),
  cost_minor_units      bigint      check (cost_minor_units >= 0),
  currency              char(3),
  guard_flags           text[]      not null default '{}',
  provider_request_id   text,
  duration_ms           integer     not null check (duration_ms >= 0),
  created_at            timestamptz not null default now()
);
comment on column ai.run.id is 'dataclass:INTERNAL';
comment on column ai.run.tenant_id is 'dataclass:INTERNAL';
comment on column ai.run.feature_key is 'dataclass:INTERNAL';
comment on column ai.run.skill_key is 'dataclass:INTERNAL';
comment on column ai.run.principal_id is 'dataclass:INTERNAL';
comment on column ai.run.principal_type is 'dataclass:INTERNAL';
comment on column ai.run.operation is 'dataclass:INTERNAL';
comment on column ai.run.data_class is 'dataclass:INTERNAL';
comment on column ai.run.band is 'dataclass:INTERNAL';
comment on column ai.run.prompt_ref is 'dataclass:INTERNAL';
comment on column ai.run.prompt_sha256 is 'dataclass:INTERNAL';
comment on column ai.run.model_id is 'dataclass:INTERNAL';
comment on column ai.run.adapter_key is 'dataclass:INTERNAL';
comment on column ai.run.byok is 'dataclass:INTERNAL';
comment on column ai.run.outcome is 'dataclass:INTERNAL';
comment on column ai.run.error_code is 'dataclass:INTERNAL';
comment on column ai.run.route_reason is 'dataclass:INTERNAL';
comment on column ai.run.candidates is 'dataclass:INTERNAL';
comment on column ai.run.tokens_in is 'dataclass:INTERNAL';
comment on column ai.run.tokens_out is 'dataclass:INTERNAL';
comment on column ai.run.cached_tokens is 'dataclass:INTERNAL';
comment on column ai.run.cost_minor_units is 'dataclass:INTERNAL';
comment on column ai.run.currency is 'dataclass:INTERNAL';
comment on column ai.run.guard_flags is 'dataclass:INTERNAL';
comment on column ai.run.provider_request_id is 'dataclass:INTERNAL';
comment on column ai.run.duration_ms is 'dataclass:INTERNAL';
comment on column ai.run.created_at is 'dataclass:INTERNAL';
create index run_tenant_day_idx on ai.run (tenant_id, created_at);
create index run_feature_idx on ai.run (tenant_id, feature_key, created_at);
alter table ai.run enable row level security;
alter table ai.run force row level security;
create policy run_tenant on ai.run for all
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
grant select, insert on ai.run to app_rw;
grant select on ai.run to app_ro;

-- Transactional outbox and consumer inbox (IPB-01 §01.4.3.3).
create table ai.outbox (
  id             text        primary key,
  tenant_id      text        not null,
  type           text        not null,
  envelope       jsonb       not null,
  created_at     timestamptz not null default now(),
  dispatched_at  timestamptz,
  attempts       integer     not null default 0
);
comment on column ai.outbox.id is 'dataclass:INTERNAL';
comment on column ai.outbox.tenant_id is 'dataclass:INTERNAL';
comment on column ai.outbox.type is 'dataclass:INTERNAL';
comment on column ai.outbox.envelope is 'dataclass:INTERNAL';
comment on column ai.outbox.created_at is 'dataclass:INTERNAL';
comment on column ai.outbox.dispatched_at is 'dataclass:INTERNAL';
comment on column ai.outbox.attempts is 'dataclass:INTERNAL';
create index outbox_pending_idx on ai.outbox (created_at) where dispatched_at is null;
alter table ai.outbox enable row level security;
alter table ai.outbox force row level security;
create policy outbox_tenant on ai.outbox for all
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
grant select, insert, update on ai.outbox to app_rw;
grant select on ai.outbox to app_ro;

create table ai.inbox (
  consumer      text        not null,
  event_id      text        not null,
  tenant_id     text        not null,
  processed_at  timestamptz not null default now(),
  primary key (consumer, event_id)
);
comment on column ai.inbox.consumer is 'dataclass:INTERNAL';
comment on column ai.inbox.event_id is 'dataclass:INTERNAL';
comment on column ai.inbox.tenant_id is 'dataclass:INTERNAL';
comment on column ai.inbox.processed_at is 'dataclass:INTERNAL';
alter table ai.inbox enable row level security;
alter table ai.inbox force row level security;
create policy inbox_tenant on ai.inbox for all
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
grant select, insert on ai.inbox to app_rw;
grant select on ai.inbox to app_ro;
