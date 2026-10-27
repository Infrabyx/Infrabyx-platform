-- @infrabyx/notify 0002: the service readers SVC_NOTIFY_DISPATCH and SVC_NOTIFY_UNSUBSCRIBE
-- (OWNER-QUESTIONS #22, PL3-D-21). Expand-only. The dispatcher finds due deliveries across tenants,
-- and the one-click unsubscribe link finds its token by hash, each as its own database role that
-- may select only the columns it needs (ids, state, recipient reference, channel, due time; never
-- an address or content). RLS still applies and neither has a write grant anywhere. Both are
-- granted to app_rw and app_ro so that their login users can SET LOCAL ROLE to them in a kernel read.
set lock_timeout = '5s';
set statement_timeout = '60s';

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'svc_notify_dispatch') then
    create role svc_notify_dispatch nologin nosuperuser nobypassrls nocreatedb nocreaterole;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'svc_notify_unsubscribe') then
    create role svc_notify_unsubscribe nologin nosuperuser nobypassrls nocreatedb nocreaterole;
  end if;
end
$$;

grant usage on schema notify to svc_notify_dispatch, svc_notify_unsubscribe;
grant select (id, tenant_id, state, recipient_ref, channel, send_after) on notify.delivery
  to svc_notify_dispatch;
grant select (token_hash, tenant_id, recipient_ref, channel, purpose, brand_pack_id, expires_at,
  used_at, revoked_at) on notify.unsubscribe_token to svc_notify_unsubscribe;
grant svc_notify_dispatch, svc_notify_unsubscribe to app_rw, app_ro;
