-- @infrabyx/rules 0004: a rule set's purpose (LawDocsComply PR-LDC-49, R1-D-123, R1-D-139). A rule
-- set created for projection (forecasts, what-if calendars) is evaluated by `RulesService.project`,
-- which writes no decision record and no ledger entry; every other rule set stays decision-grade and
-- is only evaluated through `evaluate`, which always records. Expand-only: one column with a
-- constant default (no rewrite in PostgreSQL 11+); existing rule sets are `decision`.
set lock_timeout = '5s';
set statement_timeout = '60s';

alter table rules.rule_set
  add column purpose text not null default 'decision'
  check (purpose in ('decision', 'projection'));
comment on column rules.rule_set.purpose is 'dataclass:INTERNAL';
