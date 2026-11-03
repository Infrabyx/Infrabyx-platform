-- @infrabyx/workflow 0003: a product's own durable timer kinds (Udofin PR-UDF-035; Finbyx
-- PR-FBX-13 (1); R1-D-49). Expand-only: the platform's kinds keep their references; a product
-- kind is `<product>.<area>.<name>` with a reference of 1 to 64 letters, digits, `_` or `-`.
set lock_timeout = '5s';
set statement_timeout = '60s';

alter table workflow.timer drop constraint timer_kind_check;
alter table workflow.timer add constraint timer_kind_check
  check (kind in ('approval.execute', 'approval.remind', 'approval.escalate', 'approval.expire', 'inbox.escalate')
         or kind ~ '^[a-z]{2,4}\.[a-z][a-z0-9_]{0,31}\.[a-z][a-z0-9_]{0,31}$');
alter table workflow.timer drop constraint timer_ref_check;
alter table workflow.timer add constraint timer_ref_check
  check (case when kind ~ '^(approval|inbox)\.' then ref ~ '^(apr|sca|ibx)_[0-9A-HJKMNP-TV-Z]{26}$'
              else ref ~ '^[A-Za-z0-9_-]{1,64}$' end);
