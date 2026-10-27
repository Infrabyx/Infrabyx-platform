-- @infrabyx/cms 0004: media renditions and policy change notices (OWNER-QUESTIONS #53 and #55,
-- PL5-D-11). Expand-only.
-- (1) Renditions (#53, IPB-04-11): when `cms.media.reencode_enabled` is on and the MEDIA port can
--     re-encode, a raster upload gets AVIF, WebP and a JPEG or PNG fallback at the fixed widths.
--     Each rendition is a STORAGE object listed in `cms.media.renditions`; the 90-day purge removes
--     them with the media row.
-- (2) Notices (#55, IPB-05-06): a MAJOR change to the Terms or the Payment Terms takes effect only
--     after the notice period, counted from the date users are notified: the later of the date the
--     notice was published and the date it was sent. Each of the two is recorded once, append-only;
--     the scheduler makes the version effective only when both exist and the period has passed.
set lock_timeout = '5s';
set statement_timeout = '60s';

alter table cms.media add column renditions jsonb not null default '[]';
comment on column cms.media.renditions is 'dataclass:PUBLIC';

create table cms.policy_notice (
  instance_id   text        not null references cms.policy_instance (id),
  tenant_id     text        not null default 'tnt_platform' check (tenant_id = 'tnt_platform'),
  kind          text        not null check (kind in ('published', 'sent')),
  noticed_at    timestamptz not null,
  recorded_by   text        not null,
  recorded_at   timestamptz not null default now(),
  primary key (instance_id, kind)
);
comment on column cms.policy_notice.instance_id is 'dataclass:PUBLIC';
comment on column cms.policy_notice.tenant_id is 'dataclass:INTERNAL';
comment on column cms.policy_notice.kind is 'dataclass:PUBLIC';
comment on column cms.policy_notice.noticed_at is 'dataclass:PUBLIC';
comment on column cms.policy_notice.recorded_by is 'dataclass:INTERNAL';
comment on column cms.policy_notice.recorded_at is 'dataclass:INTERNAL';
alter table cms.policy_notice enable row level security;
alter table cms.policy_notice force row level security;
create policy policy_notice_read on cms.policy_notice for select
  using (tenant_id = current_setting('app.tenant_id', true) or tenant_id = 'tnt_platform');
create policy policy_notice_insert on cms.policy_notice for insert
  with check (tenant_id = current_setting('app.tenant_id', true) and current_setting('app.scope', true) = 'platform');
grant select, insert on cms.policy_notice to app_rw;
grant select on cms.policy_notice to app_ro;

create function cms.policy_notice_append_only() returns trigger language plpgsql as $$
begin
  raise exception 'cms.policy_notice is append-only' using errcode = '42501';
end
$$;
create trigger policy_notice_append_only before update or delete on cms.policy_notice
  for each row execute function cms.policy_notice_append_only();
