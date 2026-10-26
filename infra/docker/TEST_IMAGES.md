# Test images (PL2 plan §3.11)

Container images used by the hermetic contract legs. The source of truth is `TEST_IMAGES` in `packages/testing/src/containers.ts`, and a unit test fails if this table and that constant disagree. Images are pulled from Docker Hub by digest: in the PL2 spike, ECR Public anonymous pulls hit a data limit, and GHCR and quay.io blob downloads were unreachable from the build sandbox. These images run tests only; none is deployed.

| Name         | Image (pinned)                                                                                  | Version                                    | Stands in for                                                |
| ------------ | ----------------------------------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------ |
| `postgres`   | `postgres:18-alpine@sha256:10a5c69a83035ab5239f5620d708520e8b28f5aa1f2b20143e6024532edadfb5`    | 18                                         | platform PostgreSQL; pg-boss                                 |
| `pgbouncer`  | `edoburu/pgbouncer@sha256:8638aa563607256d3c7440437534195f1066a92b68015d89ae9d6b935b444a6d`     | 1.26.1                                     | transaction-mode pooler standing in for Supavisor (PL2-D-15) |
| `redis`      | `redis:7.4-alpine@sha256:57e4255cc971b1c8d6f8a6ca283ac01bc3ecdd914273ef6bfaede87aaecd6541`      | 7.4.11                                     | BullMQ reference (QUEUE)                                     |
| `valkey`     | `valkey/valkey@sha256:081c2f5cb575efc901aa80ff9cdbd1ec6a301682fd35e1ebb4b0990a4a4a8507`         | 8.1.10                                     | BullMQ on Valkey (ElastiCache)                               |
| `temporal`   | `temporalio/temporal@sha256:ad4c82c97bd12b417d1ea942610dbcd511afb250c4d5ed26c694009533df447e`   | CLI 1.9.1, server 1.32.0                   | Temporal dev server (WORKFLOW)                               |
| `cerbos`     | `cerbos/cerbos@sha256:e5e3b150b3cb0090975605254f255164567d67e233634199fb20972e3eaff300`         | 0.57.0                                     | Cerbos PDP (AUTHZ)                                           |
| `localstack` | `localstack/localstack@sha256:0df3a97da57de03a588c05d9b8f390f15c7033fc7c4512f94619d344bc3cd317` | 4.12.0 (last licence-free community build) | AWS KMS with MessageType DIGEST; SNS                         |
| `moto`       | `motoserver/moto@sha256:120b1589c6df7e35d2092935f6ff724486bb2c4189d0e36ce795baba1400ffd2`       | 5.2.4                                      | AWS Secrets Manager, S3 lock checks, SES v2 send             |

Images for Keycloak, Zitadel, OpenFGA, OpenBao, Unleash, MinIO and the OTel Collector are added with the sessions that use them (D-11).
