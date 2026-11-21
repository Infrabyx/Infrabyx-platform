-- @infrabyx/audit 0013: the security event kind `connector.retrieval.host_refused` (Udofin
-- PR-UDF-072; R1-D-262; threat model §3.181). Expand-only: a product that refused to fetch a
-- document because the partner's retrieval URL names a host outside its allow-list records the
-- partner tenant, the document id and version, and the bare host name (no URL, query or
-- credential; the detail's shape is checked by `PgSecurityEvents` before the database is
-- touched). The kind check is widened (every existing row still passes) and validated without
-- blocking writes. Nothing else changes: same grants, RLS, triggers and append-only rule.
set lock_timeout = '5s';
set statement_timeout = '600s';

alter table audit.security_event drop constraint security_event_kind_check;
alter table audit.security_event add constraint security_event_kind_check
  check (kind in ('rules.reveal.refused', 'connector.retrieval.host_refused')) not valid;
alter table audit.security_event validate constraint security_event_kind_check;
