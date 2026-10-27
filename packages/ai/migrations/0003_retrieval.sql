-- @infrabyx/ai 0003: tenant-scoped hybrid retrieval (IPB-03-29 to 03-32; PL4 plan §4.9, session 4).
-- Expand-only. Requires PostgreSQL with the pgvector extension (CI: pgvector/pgvector:0.8.1-pg18).
-- (1) `retrieval_index` records the embedding model, dimensions, chunker and version of each index;
--     re-embedding builds a new version and switches to it when complete (IPB-03-32).
-- (2) `chunk` holds one passage: the original text sealed with FieldCrypto (readable only by its
--     tenant), and, computed from the scrubbed text (no personal identifiers), the lexical vector
--     (`tsv`) and the embedding. Every chunk carries tenant, entity, resource, ACL hash and data
--     class; RLS is forced, so a query only ever sees the caller's tenant (@IPB-03-AT-05).
-- (3) HNSW indexes are partial per supported dimension, because an HNSW index needs a fixed size.
set lock_timeout = '5s';
set statement_timeout = '120s';

create extension if not exists vector;

create table ai.retrieval_index (
  id               text        primary key check (id ~ '^idx_[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  tenant_id        text        not null,
  name             text        not null check (name ~ '^[a-z][a-z0-9_.-]{0,63}$'),
  version          integer     not null check (version > 0),
  embedding_model  text        not null,
  dims             integer     not null check (dims in (256, 384, 512, 768, 1024, 1536)),
  chunker          text        not null check (length(chunker) between 1 and 200),
  state            text        not null default 'building' check (state in ('building', 'active', 'retired')),
  created_by       text        not null,
  created_at       timestamptz not null default now(),
  activated_at     timestamptz,
  unique (tenant_id, name, version)
);
comment on column ai.retrieval_index.id is 'dataclass:INTERNAL';
comment on column ai.retrieval_index.tenant_id is 'dataclass:INTERNAL';
comment on column ai.retrieval_index.name is 'dataclass:INTERNAL';
comment on column ai.retrieval_index.version is 'dataclass:INTERNAL';
comment on column ai.retrieval_index.embedding_model is 'dataclass:INTERNAL';
comment on column ai.retrieval_index.dims is 'dataclass:INTERNAL';
comment on column ai.retrieval_index.chunker is 'dataclass:INTERNAL';
comment on column ai.retrieval_index.state is 'dataclass:INTERNAL';
comment on column ai.retrieval_index.created_by is 'dataclass:INTERNAL';
comment on column ai.retrieval_index.created_at is 'dataclass:INTERNAL';
comment on column ai.retrieval_index.activated_at is 'dataclass:INTERNAL';
create unique index retrieval_index_one_active on ai.retrieval_index (tenant_id, name)
  where state = 'active';
alter table ai.retrieval_index enable row level security;
alter table ai.retrieval_index force row level security;
create policy retrieval_index_tenant on ai.retrieval_index for all
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
grant select, insert, update on ai.retrieval_index to app_rw;
grant select on ai.retrieval_index to app_ro;

create table ai.chunk (
  id              text        primary key check (id ~ '^chk_[0-7][0-9A-HJKMNP-TV-Z]{25}$'),
  tenant_id       text        not null,
  index_id        text        not null references ai.retrieval_index (id),
  entity_id       text,
  resource_ref    text        not null check (length(resource_ref) between 1 and 300),
  locator         text        check (length(locator) <= 200),
  acl_hash        text        not null check (acl_hash ~ '^[0-9a-f]{64}$'),
  data_class      text        not null check (data_class in ('PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'REGULATED')),
  class_rank      smallint    not null generated always as (
                    case data_class when 'PUBLIC' then 0 when 'INTERNAL' then 1
                                    when 'CONFIDENTIAL' then 2 else 3 end) stored,
  content_sha256  text        not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  text_enc        bytea       not null,
  text_key_id     text        not null,
  tsv             tsvector    not null,
  dims            integer     not null,
  embedding       vector      not null,
  created_at      timestamptz not null default now(),
  constraint chunk_embedding_dims check (vector_dims(embedding) = dims)
);
comment on column ai.chunk.id is 'dataclass:INTERNAL';
comment on column ai.chunk.tenant_id is 'dataclass:INTERNAL';
comment on column ai.chunk.index_id is 'dataclass:INTERNAL';
comment on column ai.chunk.entity_id is 'dataclass:INTERNAL';
comment on column ai.chunk.resource_ref is 'dataclass:INTERNAL';
comment on column ai.chunk.locator is 'dataclass:INTERNAL';
comment on column ai.chunk.acl_hash is 'dataclass:INTERNAL';
comment on column ai.chunk.data_class is 'dataclass:INTERNAL';
comment on column ai.chunk.class_rank is 'dataclass:INTERNAL';
comment on column ai.chunk.content_sha256 is 'dataclass:INTERNAL';
comment on column ai.chunk.text_enc is 'dataclass:REGULATED';
comment on column ai.chunk.text_key_id is 'dataclass:INTERNAL';
comment on column ai.chunk.tsv is 'dataclass:CONFIDENTIAL';
comment on column ai.chunk.dims is 'dataclass:INTERNAL';
comment on column ai.chunk.embedding is 'dataclass:CONFIDENTIAL';
comment on column ai.chunk.created_at is 'dataclass:INTERNAL';
create index chunk_index_idx on ai.chunk (tenant_id, index_id);
create index chunk_resource_idx on ai.chunk (tenant_id, resource_ref);
create index chunk_tsv_idx on ai.chunk using gin (tsv);
create index chunk_hnsw_256 on ai.chunk using hnsw ((embedding::vector(256)) vector_cosine_ops) where dims = 256;
create index chunk_hnsw_384 on ai.chunk using hnsw ((embedding::vector(384)) vector_cosine_ops) where dims = 384;
create index chunk_hnsw_512 on ai.chunk using hnsw ((embedding::vector(512)) vector_cosine_ops) where dims = 512;
create index chunk_hnsw_768 on ai.chunk using hnsw ((embedding::vector(768)) vector_cosine_ops) where dims = 768;
create index chunk_hnsw_1024 on ai.chunk using hnsw ((embedding::vector(1024)) vector_cosine_ops) where dims = 1024;
create index chunk_hnsw_1536 on ai.chunk using hnsw ((embedding::vector(1536)) vector_cosine_ops) where dims = 1536;
alter table ai.chunk enable row level security;
alter table ai.chunk force row level security;
create policy chunk_tenant on ai.chunk for all
  using (tenant_id = current_setting('app.tenant_id', true))
  with check (tenant_id = current_setting('app.tenant_id', true));
grant select, insert on ai.chunk to app_rw;
grant select on ai.chunk to app_ro;
