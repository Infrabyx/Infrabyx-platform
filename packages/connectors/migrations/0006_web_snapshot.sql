-- @infrabyx/connectors 0006: web snapshots kept as evidence (LawDocsComply PR-LDC-40, R1-D-176;
-- threat model §3.125). Expand-only. One table under forced RLS by tenant, written through the
-- kernel with a ledger entry per mutation, and with no delete grant (removing a snapshot is a
-- retention decision, the product's). What was fetched is immutable; only a quarantined row's scan
-- may change, to RELEASED or REJECTED (the AV port scans it again, IPB-02-44).
set lock_timeout = '5s';
set statement_timeout = '60s';

create table connectors.web_snapshot (
  id               text        primary key check (id ~ '^wsn_[0-9A-HJKMNP-TV-Z]{26}$'),
  tenant_id        text        not null,
  requested_url    text        not null check (length(requested_url) between 9 and 2048),
  final_url        text        not null check (length(final_url) between 9 and 2048),
  redirects        jsonb       not null default '[]'::jsonb
                               check (jsonb_typeof(redirects) = 'array' and jsonb_array_length(redirects) <= 5),
  http_status      integer     not null check (http_status = 200),
  content_type     text        not null check (content_type in ('text/html', 'application/xhtml+xml',
                                 'text/plain', 'application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp')),
  charset          text        check (charset ~ '^[A-Za-z0-9._-]{1,40}$'),
  content_encoding text        not null check (content_encoding in ('identity', 'gzip', 'deflate', 'br')),
  bytes            integer     not null check (bytes >= 0),
  sha256           text        not null check (sha256 ~ '^[0-9a-f]{64}$'),
  storage_key      text        not null check (length(storage_key) between 1 and 1024),
  bucket_class     text        not null check (bucket_class in ('GENERAL', 'CONFIDENTIAL', 'REGULATED')),
  compartment      text        check (compartment in ('BOARD_CONFIDENTIAL', 'SEALED')),
  fetched_at       timestamptz not null,
  state            text        not null check (state in ('RELEASED', 'QUARANTINED', 'REJECTED')),
  scan_verdict     text        not null check (length(scan_verdict) between 1 and 32),
  scan_engine      text        check (length(scan_engine) <= 200),
  scan_reason      text        check (length(scan_reason) <= 64),
  scan_threat      text        check (length(scan_threat) <= 200),
  scanned_at       timestamptz not null,
  reference        text        check (reference ~ '^[\x20-\x7E]{1,120}$'),
  requested_by     text        not null check (length(requested_by) between 1 and 200),
  retain_until     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (tenant_id, storage_key)
);
comment on column connectors.web_snapshot.id is 'dataclass:INTERNAL';
comment on column connectors.web_snapshot.tenant_id is 'dataclass:INTERNAL';
comment on column connectors.web_snapshot.requested_url is 'dataclass:CONFIDENTIAL';
comment on column connectors.web_snapshot.final_url is 'dataclass:CONFIDENTIAL';
comment on column connectors.web_snapshot.redirects is 'dataclass:CONFIDENTIAL';
comment on column connectors.web_snapshot.http_status is 'dataclass:INTERNAL';
comment on column connectors.web_snapshot.content_type is 'dataclass:INTERNAL';
comment on column connectors.web_snapshot.charset is 'dataclass:INTERNAL';
comment on column connectors.web_snapshot.content_encoding is 'dataclass:INTERNAL';
comment on column connectors.web_snapshot.bytes is 'dataclass:INTERNAL';
comment on column connectors.web_snapshot.sha256 is 'dataclass:INTERNAL';
comment on column connectors.web_snapshot.storage_key is 'dataclass:INTERNAL';
comment on column connectors.web_snapshot.bucket_class is 'dataclass:INTERNAL';
comment on column connectors.web_snapshot.compartment is 'dataclass:INTERNAL';
comment on column connectors.web_snapshot.fetched_at is 'dataclass:INTERNAL';
comment on column connectors.web_snapshot.state is 'dataclass:INTERNAL';
comment on column connectors.web_snapshot.scan_verdict is 'dataclass:INTERNAL';
comment on column connectors.web_snapshot.scan_engine is 'dataclass:INTERNAL';
comment on column connectors.web_snapshot.scan_reason is 'dataclass:INTERNAL';
comment on column connectors.web_snapshot.scan_threat is 'dataclass:INTERNAL';
comment on column connectors.web_snapshot.scanned_at is 'dataclass:INTERNAL';
comment on column connectors.web_snapshot.reference is 'dataclass:INTERNAL';
comment on column connectors.web_snapshot.requested_by is 'dataclass:INTERNAL';
comment on column connectors.web_snapshot.retain_until is 'dataclass:INTERNAL';
comment on column connectors.web_snapshot.created_at is 'dataclass:INTERNAL';
comment on column connectors.web_snapshot.updated_at is 'dataclass:INTERNAL';
create index web_snapshot_reference_idx on connectors.web_snapshot (tenant_id, reference, fetched_at);

create function connectors.web_snapshot_guard() returns trigger
  language plpgsql
  set search_path = pg_catalog, pg_temp
as $$
begin
  if new.id <> old.id or new.tenant_id <> old.tenant_id
    or new.requested_url <> old.requested_url or new.final_url <> old.final_url
    or new.redirects <> old.redirects or new.http_status <> old.http_status
    or new.content_type <> old.content_type or new.charset is distinct from old.charset
    or new.content_encoding <> old.content_encoding or new.bytes <> old.bytes
    or new.sha256 <> old.sha256 or new.storage_key <> old.storage_key
    or new.bucket_class <> old.bucket_class or new.compartment is distinct from old.compartment
    or new.fetched_at <> old.fetched_at or new.reference is distinct from old.reference
    or new.requested_by <> old.requested_by or new.retain_until is distinct from old.retain_until
    or new.created_at <> old.created_at then
    raise exception 'a web snapshot keeps what was fetched' using errcode = 'P0001';
  end if;
  if old.state <> 'QUARANTINED' then
    raise exception 'a % web snapshot is final', old.state using errcode = 'P0001';
  end if;
  if new.state not in ('QUARANTINED', 'RELEASED', 'REJECTED') then
    raise exception 'a web snapshot cannot move from % to %', old.state, new.state using errcode = 'P0001';
  end if;
  if new.scanned_at < old.scanned_at then
    raise exception 'a web snapshot rescan is never older than the scan it replaces' using errcode = 'P0001';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
alter function connectors.web_snapshot_guard() owner to app_migrate;
revoke all on function connectors.web_snapshot_guard() from public;
create trigger web_snapshot_guard before update on connectors.web_snapshot
  for each row execute function connectors.web_snapshot_guard();

alter table connectors.web_snapshot enable row level security;
alter table connectors.web_snapshot force row level security;
create policy web_snapshot_tenant on connectors.web_snapshot for all
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));

grant select, insert, update on connectors.web_snapshot to app_rw;
grant select on connectors.web_snapshot to app_ro;
