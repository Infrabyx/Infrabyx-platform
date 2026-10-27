# Test images (PL2 plan §3.11)

Container images used by the hermetic contract legs. The source of truth is `TEST_IMAGES` in `packages/testing/src/containers.ts`, and a unit test fails if this table and that constant disagree. Images are pulled from Docker Hub by digest: in the PL2 spike, ECR Public anonymous pulls hit a data limit, and GHCR and quay.io blob downloads were unreachable from the build sandbox. These images run tests only; none is deployed. Images pinned from PL2 session 2 on were published at least 7 days before they were pinned (PL2-D-32).

| Name         | Image (pinned)                                                                                                 | Version                                    | Stands in for                                                               |
| ------------ | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | --------------------------------------------------------------------------- |
| `postgres`   | `postgres:18-alpine@sha256:10a5c69a83035ab5239f5620d708520e8b28f5aa1f2b20143e6024532edadfb5`                   | 18                                         | platform PostgreSQL; pg-boss                                                |
| `pgvector`   | `pgvector/pgvector:0.8.1-pg18@sha256:508c5290cda481d4f5f846446a26e9c1b804766828a394a5861de1b348a18b4c`         | PostgreSQL 18, pgvector 0.8.1              | platform PostgreSQL with vector search (startPostgres, CI integration; PL4) |
| `pgbouncer`  | `edoburu/pgbouncer@sha256:8638aa563607256d3c7440437534195f1066a92b68015d89ae9d6b935b444a6d`                    | 1.26.1                                     | transaction-mode pooler standing in for Supavisor (PL2-D-15)                |
| `redis`      | `redis:7.4-alpine@sha256:57e4255cc971b1c8d6f8a6ca283ac01bc3ecdd914273ef6bfaede87aaecd6541`                     | 7.4.11                                     | BullMQ reference (QUEUE)                                                    |
| `valkey`     | `valkey/valkey@sha256:081c2f5cb575efc901aa80ff9cdbd1ec6a301682fd35e1ebb4b0990a4a4a8507`                        | 8.1.10                                     | BullMQ on Valkey (ElastiCache)                                              |
| `temporal`   | `temporalio/temporal@sha256:ad4c82c97bd12b417d1ea942610dbcd511afb250c4d5ed26c694009533df447e`                  | CLI 1.9.1, server 1.32.0                   | Temporal dev server (WORKFLOW)                                              |
| `cerbos`     | `cerbos/cerbos@sha256:e5e3b150b3cb0090975605254f255164567d67e233634199fb20972e3eaff300`                        | 0.57.0                                     | Cerbos PDP (AUTHZ)                                                          |
| `keycloak`   | `keycloak/keycloak@sha256:79c623a22abacf3fe6c00a5fb30f5b7843d717b234033b80995891c06116d244`                    | 26.8.1                                     | Keycloak, dev mode with in-memory H2 (IDENTITY)                             |
| `localstack` | `localstack/localstack@sha256:0df3a97da57de03a588c05d9b8f390f15c7033fc7c4512f94619d344bc3cd317`                | 4.12.0 (last licence-free community build) | AWS KMS with MessageType DIGEST; SNS                                        |
| `moto`       | `motoserver/moto@sha256:120b1589c6df7e35d2092935f6ff724486bb2c4189d0e36ce795baba1400ffd2`                      | 5.2.4                                      | AWS Secrets Manager, S3 lock checks, SES v2 send                            |
| `openfga`    | `openfga/openfga@sha256:9cf9a20af32a40434cd3a788c429879439ee9ea9abf65c9c200ee17cd43f769e`                      | v1.22.0                                    | OpenFGA, memory store (AUTHZ)                                               |
| `openbao`    | `openbao/openbao@sha256:6d2b93856e3fcf7b18ad855a0b51eaba474dc8b79cf554379ea32034797d2acf`                      | 2.7.1                                      | OpenBao KV v2, Transit and database engines (SECRETS, KMS)                  |
| `otelcol`    | `otel/opentelemetry-collector-contrib@sha256:39923a8e431bd1f57be82411999d389fcfe40857492e4365456d97a4c1f74be6` | 0.162.0                                    | OTel Collector with file exporters (OBSERVABILITY)                          |
| `zitadel`    | `ghcr.io/zitadel/zitadel@sha256:a586456a208e0db4c633db0ba43c427c24b37846138b8b13ff16ad8e003a18d3`              | v4.19.5                                    | Zitadel with PostgreSQL (IDENTITY alternative; GHCR, so CI only)            |
| `unleash`    | `unleashorg/unleash-server@sha256:5020013b7a9a93c8ed3686d36b5025399714020b3fb5ef41afd84ba37a88c050`            | 8.2.0                                      | Unleash OSS (FEATURE_FLAG)                                                  |

Zitadel (GHCR) runs in CI only.

## Built from source

| Name    | Source (pinned)                                                                                                | Version                                                       | Stands in for                                                          |
| ------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `minio` | `github.com/minio/minio` tag `RELEASE.2025-09-07T16-13-09Z`, commit `07c3a429bfed433e49018cb0f78a52145d4bedeb` | RELEASE.2025-09-07T16-13-09Z (last community release, frozen) | MinIO server: Object Lock, SSE-S3, presigned-URL enforcement (STORAGE) |

MinIO publishes no pinnable image any more: the Docker Hub repository is gone and quay.io refuses anonymous pulls (CI, 26 Oct 2026). Per PL2-D-61, CI builds this release from source with Go 1.24 (`scripts/ci/minio-server.sh`), checks the commit, and keeps the binary in the Actions cache. A third-party mirror is never used. Images for MinIO are added with the sessions that use them (D-11).
