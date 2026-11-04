-- @infrabyx/rules 0002: rule parameters and as-of evaluation in the decision log (LawDocsComply
-- PR-LDC-21 (a) and PR-LDC-22 (b), R1-D-88). Expand-only: two nullable columns, no rewrite.
-- `parameters` holds the parameter values a decision used and where each came from
-- ({ name: { value, source } }, INTERNAL only: thresholds and switches, never personal data);
-- `as_of` the instant whose version was evaluated when the caller asked for one.
set lock_timeout = '5s';
set statement_timeout = '60s';

alter table rules.decision_log add column parameters jsonb;
alter table rules.decision_log add column as_of timestamptz;

comment on column rules.decision_log.parameters is 'dataclass:INTERNAL';
comment on column rules.decision_log.as_of is 'dataclass:INTERNAL';
