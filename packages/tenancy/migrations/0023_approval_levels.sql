-- @infrabyx/tenancy 0023: ordered approval levels on one request (LawDocsComply PR-LDC-38, owner
-- answer #125, R1-D-126, R1-D-136). A request may carry 1 to 5 levels, each a set of checker roles
-- and a number of checkers, decided in order; each decision records the level it was made at.
-- Expand-only: two nullable columns (no rewrite) with shape checks. A request without levels is
-- decided exactly as before.
set lock_timeout = '5s';
set statement_timeout = '60s';

alter table tenancy.approval_request
  add column levels jsonb
  check (
    levels is null
    or (jsonb_typeof(levels) = 'array' and jsonb_array_length(levels) between 1 and 5)
  );
comment on column tenancy.approval_request.levels is 'dataclass:INTERNAL';

alter table tenancy.approval_decision
  add column level smallint
  check (level is null or level between 1 and 5);
comment on column tenancy.approval_decision.level is 'dataclass:INTERNAL';
