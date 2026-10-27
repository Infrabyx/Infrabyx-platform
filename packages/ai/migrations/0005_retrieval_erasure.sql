-- @infrabyx/ai 0005: deleting retrieval chunks, approved by the owner (OWNER-QUESTIONS #34,
-- PL4-D-13). Expand-only.
-- (1) Erasure: when a product deletes a resource, every chunk of it in every index version is
--     deleted, ledgered in the same transaction (supports erasure under the DPDP Act). A
--     `resource_erasure` row records the erasure first; the chunk delete policy only lets a delete
--     reach chunks of an erased resource, or chunks of a version past its retention.
-- (2) Retired index versions are deleted 30 days after retirement, chunks first, ledgered.
--     `retired_at` is set by PostgreSQL when a version is retired and cleared if it is brought back;
--     no caller writes it. A version retired before this migration has no `retired_at` and is kept
--     until it is retired again (nothing is deleted on a guessed date).
-- (3) SVC_AI_INDEX_SWEEP finds retired versions past 30 days across tenants. It may select only
--     the id, tenant, state and retirement time, has no write grant, and is granted to app_rw and
--     app_ro so their login users can SET LOCAL ROLE.
set lock_timeout = '5s';
set statement_timeout = '60s';

alter table ai.retrieval_index add column retired_at timestamptz;
comment on column ai.retrieval_index.retired_at is 'dataclass:INTERNAL';

create function ai.retrieval_index_retired_at() returns trigger language plpgsql as $$
begin
  if new.retired_at is distinct from old.retired_at then
    raise exception 'retired_at of index % is set by the database', old.id using errcode = '42501';
  end if;
  if new.state = 'retired' and old.state <> 'retired' then
    new.retired_at := now();
  elsif new.state <> 'retired' then
    new.retired_at := null;
  end if;
  return new;
end
$$;
create trigger retrieval_index_retired_at before update on ai.retrieval_index
  for each row execute function ai.retrieval_index_retired_at();

create table ai.resource_erasure (
  tenant_id     text        not null,
  resource_ref  text        not null check (length(resource_ref) between 1 and 300),
  chunks        integer     not null check (chunks >= 0),
  erased_by     text        not null,
  erased_at     timestamptz not null default now(),
  primary key (tenant_id, resource_ref, erased_at)
);
comment on column ai.resource_erasure.tenant_id is 'dataclass:INTERNAL';
comment on column ai.resource_erasure.resource_ref is 'dataclass:INTERNAL';
comment on column ai.resource_erasure.chunks is 'dataclass:INTERNAL';
comment on column ai.resource_erasure.erased_by is 'dataclass:INTERNAL';
comment on column ai.resource_erasure.erased_at is 'dataclass:INTERNAL';
alter table ai.resource_erasure enable row level security;
alter table ai.resource_erasure force row level security;
create policy resource_erasure_tenant on ai.resource_erasure for all
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
grant select, insert on ai.resource_erasure to app_rw;
grant select on ai.resource_erasure to app_ro;

-- The only delete paths for chunks: an erased resource, or a retired version past 30 days.
grant delete on ai.chunk to app_rw;
create policy chunk_delete_erasure on ai.chunk as restrictive for delete
  using (
    exists (
      select 1 from ai.resource_erasure e
       where e.tenant_id = chunk.tenant_id and e.resource_ref = chunk.resource_ref
    )
    or exists (
      select 1 from ai.retrieval_index i
       where i.id = chunk.index_id and i.state = 'retired'
         and i.retired_at < now() - interval '30 days'
    )
  );

-- The only delete path for index versions: retired more than 30 days ago (chunks go first).
grant delete on ai.retrieval_index to app_rw;
create policy retrieval_index_delete_retired on ai.retrieval_index as restrictive for delete
  using (state = 'retired' and retired_at < now() - interval '30 days');

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'svc_ai_index_sweep') then
    create role svc_ai_index_sweep nologin nosuperuser nobypassrls nocreatedb nocreaterole;
  end if;
end
$$;

grant usage on schema ai to svc_ai_index_sweep;
grant select (id, tenant_id, state, retired_at) on ai.retrieval_index to svc_ai_index_sweep;
create policy retrieval_index_sweep on ai.retrieval_index for select to svc_ai_index_sweep
  using (current_setting('app.scope', true) = 'platform');
grant svc_ai_index_sweep to app_rw, app_ro;
