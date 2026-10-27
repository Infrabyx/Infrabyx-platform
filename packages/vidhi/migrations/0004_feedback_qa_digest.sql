-- @infrabyx/vidhi 0004: feedback, QA sampling and the daily digest (IPB-03-83 to 03-85; PL4 plan
-- §8.9; session 8). Expand-only. A correction's text is sealed with FieldCrypto; it feeds the
-- tenant's own eval set and is never used for model training.
set lock_timeout = '5s';
set statement_timeout = '60s';

create table vidhi.feedback (
  id                text        primary key check (id ~ '^fbk_[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  tenant_id         text        not null,
  run_id            text        not null check (run_id ~ '^run_'),
  skill_key         text,
  output_ref        text        check (length(output_ref) <= 200),
  user_id           text        not null,
  rating            text        not null check (rating in ('up', 'down')),
  reason            text        check (reason in ('wrong', 'incomplete', 'unclear', 'unsafe', 'off_topic', 'other')),
  correction_enc    bytea,
  correction_key_id text,
  use_as_reference  boolean     not null default false,
  created_at        timestamptz not null default now(),
  check ((correction_enc is null) = (correction_key_id is null)),
  check (not use_as_reference or correction_enc is not null)
);
comment on column vidhi.feedback.id is 'dataclass:INTERNAL';
comment on column vidhi.feedback.tenant_id is 'dataclass:INTERNAL';
comment on column vidhi.feedback.run_id is 'dataclass:INTERNAL';
comment on column vidhi.feedback.skill_key is 'dataclass:INTERNAL';
comment on column vidhi.feedback.output_ref is 'dataclass:INTERNAL';
comment on column vidhi.feedback.user_id is 'dataclass:INTERNAL';
comment on column vidhi.feedback.rating is 'dataclass:INTERNAL';
comment on column vidhi.feedback.reason is 'dataclass:INTERNAL';
comment on column vidhi.feedback.correction_enc is 'dataclass:REGULATED';
comment on column vidhi.feedback.correction_key_id is 'dataclass:INTERNAL';
comment on column vidhi.feedback.use_as_reference is 'dataclass:INTERNAL';
comment on column vidhi.feedback.created_at is 'dataclass:INTERNAL';
create index feedback_skill_idx on vidhi.feedback (tenant_id, skill_key, created_at);
create unique index feedback_once on vidhi.feedback (run_id, user_id);
alter table vidhi.feedback enable row level security;
alter table vidhi.feedback force row level security;
create policy feedback_tenant on vidhi.feedback for all
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
grant select, insert on vidhi.feedback to app_rw;
grant select on vidhi.feedback to app_ro;

-- Runs sampled for human review by the skill owner (IPB-03-85); one sample per task.
create table vidhi.qa_sample (
  id           bigint      generated always as identity primary key,
  tenant_id    text        not null,
  skill_key    text        not null,
  task_id      text        not null unique,
  rate         numeric(5, 4) not null check (rate > 0 and rate <= 1),
  state        text        not null default 'queued' check (state in ('queued', 'reviewed')),
  verdict      text        check (verdict in ('correct', 'incorrect', 'missed')),
  reviewer_id  text,
  created_at   timestamptz not null default now(),
  reviewed_at  timestamptz,
  check ((state = 'reviewed') = (verdict is not null))
);
comment on column vidhi.qa_sample.id is 'dataclass:INTERNAL';
comment on column vidhi.qa_sample.tenant_id is 'dataclass:INTERNAL';
comment on column vidhi.qa_sample.skill_key is 'dataclass:INTERNAL';
comment on column vidhi.qa_sample.task_id is 'dataclass:INTERNAL';
comment on column vidhi.qa_sample.rate is 'dataclass:INTERNAL';
comment on column vidhi.qa_sample.state is 'dataclass:INTERNAL';
comment on column vidhi.qa_sample.verdict is 'dataclass:INTERNAL';
comment on column vidhi.qa_sample.reviewer_id is 'dataclass:INTERNAL';
comment on column vidhi.qa_sample.created_at is 'dataclass:INTERNAL';
comment on column vidhi.qa_sample.reviewed_at is 'dataclass:INTERNAL';
create index qa_sample_skill_idx on vidhi.qa_sample (tenant_id, skill_key, state);
alter table vidhi.qa_sample enable row level security;
alter table vidhi.qa_sample force row level security;
create policy qa_sample_tenant on vidhi.qa_sample for all
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
grant select, insert on vidhi.qa_sample to app_rw;
grant update (state, verdict, reviewer_id, reviewed_at) on vidhi.qa_sample to app_rw;
grant select on vidhi.qa_sample to app_ro;

-- "What Vidhi did today" (IPB-03-83): one digest per recipient and day, counts only.
create table vidhi.digest (
  id            bigint      generated always as identity primary key,
  tenant_id     text        not null,
  recipient_id  text        not null,
  scope         text        not null check (scope in ('user', 'tenant')),
  day           date        not null,
  summary       jsonb       not null,
  created_at    timestamptz not null default now(),
  unique (tenant_id, recipient_id, scope, day)
);
comment on column vidhi.digest.id is 'dataclass:INTERNAL';
comment on column vidhi.digest.tenant_id is 'dataclass:INTERNAL';
comment on column vidhi.digest.recipient_id is 'dataclass:INTERNAL';
comment on column vidhi.digest.scope is 'dataclass:INTERNAL';
comment on column vidhi.digest.day is 'dataclass:INTERNAL';
comment on column vidhi.digest.summary is 'dataclass:INTERNAL';
comment on column vidhi.digest.created_at is 'dataclass:INTERNAL';
alter table vidhi.digest enable row level security;
alter table vidhi.digest force row level security;
create policy digest_tenant on vidhi.digest for all
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
grant select, insert on vidhi.digest to app_rw;
grant select on vidhi.digest to app_ro;
