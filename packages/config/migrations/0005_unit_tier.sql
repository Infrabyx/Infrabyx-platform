-- @infrabyx/config 0005: the UNIT setting tier, an organisation unit, department or function between
-- ENTITY and USER (IPB-07-38 as amended by the owner for PR-042, R1-D-91; LawDocsComply PR-LDC-17;
-- R1-D-95). Expand-only: the tier checks admit 'UNIT', and a UNIT row belongs to one tenant like
-- an ENTITY row. No existing row changes; RLS is unchanged (UNIT rows follow app.tenant_id).
set lock_timeout = '5s';
set statement_timeout = '60s';

alter table config.setting_value drop constraint setting_value_tier_check;
alter table config.setting_value add constraint setting_value_tier_check
  check (tier in ('PLATFORM', 'PLAN', 'BRAND', 'TENANT', 'ENTITY', 'UNIT', 'USER'));
alter table config.setting_value drop constraint setting_value_scope;
alter table config.setting_value add constraint setting_value_scope check (
  (tier = 'PLATFORM' and scope_id is null and tenant_id is null)
  or (tier in ('PLAN', 'BRAND') and scope_id is not null and tenant_id is null)
  or (tier in ('TENANT', 'ENTITY', 'UNIT', 'USER') and scope_id is not null and tenant_id is not null)
);

alter table config.setting_change drop constraint setting_change_tier_check;
alter table config.setting_change add constraint setting_change_tier_check
  check (tier in ('PLATFORM', 'PLAN', 'BRAND', 'TENANT', 'ENTITY', 'UNIT', 'USER'));
alter table config.setting_change drop constraint setting_change_scope;
alter table config.setting_change add constraint setting_change_scope check (
  (tier = 'PLATFORM' and scope_id is null and tenant_id is null)
  or (tier in ('PLAN', 'BRAND') and scope_id is not null and tenant_id is null)
  or (tier in ('TENANT', 'ENTITY', 'UNIT', 'USER') and scope_id is not null and tenant_id is not null)
);
