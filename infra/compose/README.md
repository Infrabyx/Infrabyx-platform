# infra/compose

The local development stack (IPB-01-33, §01.4.8.3; PL6 plan §4). Local only: nothing here is a deployment, and every port is bound to `127.0.0.1`.

```sh
pnpm build                       # the CLIs dev:up runs come from the built workspace
pnpm dev:up                      # core profile, then migrate and the dev seed
pnpm dev:up --profile apps       # also the site and console from their images
pnpm dev:down                    # stop and remove the stack and its volumes
```

`pnpm dev:up` writes `infra/compose/.env.local` on first run with generated local-only secrets (database, Keycloak admin, Unleash tokens, Redis, MinIO, OpenSearch). It is the only place environment-variable secrets are allowed (IPB-02-28), it is never committed (`*.local`), and later runs keep its values so the volumes stay usable. The seeded personas' passwords go to `SEED_CREDENTIALS.md` at the repository root (never committed).

## Profiles

| Profile         | Services (default local port)                                                                                                                                                                                                                                                                                                                                                                                   |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core`          | PostgreSQL 18 with pgvector (55432; databases `infrabyx`, `keycloak`, `unleash`), Redis 7.4 (56379), MinIO (59000), Mailpit (SMTP 51025, UI 58025), Keycloak 26 (58080), Temporal dev server (57233) and its UI (58233), Gotenberg (53000), Unleash (54242), Cerbos with the policy bundle `dev:up` assembles in `.cerbos/` (the platform policies and the reference app's own; 53592)                          |
| `apps`          | `apps/public` (53123) and `apps/console` (53124) from `infra/docker/next/Dockerfile` on fixture adapters; the reference `api` (53125) and `worker` (53126) from `infra/docker/node/Dockerfile` on the stack's Keycloak, Cerbos, MinIO, Redis and Temporal, and the reference `web` (53127, the browser's origin for the api) from `infra/docker/next/Dockerfile` (host network); all run read-only as UID 10001 |
| `search`        | OpenSearch 3.8 (59200)                                                                                                                                                                                                                                                                                                                                                                                          |
| `ai`            | Ollama (51434)                                                                                                                                                                                                                                                                                                                                                                                                  |
| `observability` | Grafana with Tempo, Loki and Prometheus behind one OTLP endpoint (`grafana/otel-lgtm`; UI 53300, OTLP gRPC 54317, HTTP 54318)                                                                                                                                                                                                                                                                                   |

The Temporal dev server keeps its state in memory, so workflows reset with the container. The site and console read the files the dev seed wrote from the checkout's `.storage/` (gitignored), mounted at `/storage`.

Every port can be moved with its variable in `.env.local` (for example `PG_PORT=55433`).

## Images

The images the contract legs share are pinned in `infra/docker/TEST_IMAGES.md`; the others, all by digest and published at least 7 days before pinning (PL2-D-32):

| Service       | Image                                                                                                        |
| ------------- | ------------------------------------------------------------------------------------------------------------ |
| Mailpit       | `axllent/mailpit:v1.31.6@sha256:23fe39e81bde596a918000b3135c0f85dc8bb4c9ea6be274b051143f3e300387`            |
| Temporal UI   | `temporalio/ui:2.56.0@sha256:66d55d383bfb334ee0781f21a3b36c865b3f0f2262491a070bb2143394e9fe88`               |
| Gotenberg     | `gotenberg/gotenberg:8.38.1@sha256:aa552cc115db488e0f0bcb07446aac13071ad51505b642c84bb894500907b42b`         |
| OpenSearch    | `opensearchproject/opensearch:3.8.0@sha256:fafe3fc3587088674669235575aa166228c48bdb940294a8cdbbc1da75236a40` |
| Ollama        | `ollama/ollama:0.40.6@sha256:265409e1d931028a8f7d5a32bcbafddd7bffbc6cc629d77efe9560adf692a5e7`               |
| Observability | `grafana/otel-lgtm:0.37.0@sha256:57b5ab1ca6619beb180174e2fccce04762470750669d043f544b4726d0582d07`           |
| MinIO (build) | `golang:1.24.13-bookworm@sha256:1a6d4452c65dea36aac2e2d606b01b4a029ec90cc1ae53890540ce6173ea77ac`            |

MinIO publishes no pinnable image, so `minio/Dockerfile` builds its last community release from source at the pinned commit, as CI does (PL2-D-61, OWNER-QUESTIONS #4); never a third-party mirror.

## The reference app on the stack

`dev:up` applies the Keycloak realm `infrabyx-local` (the `reference-api` client and the `reference-admin` service account; their generated secrets go to `.env.local`), creates the MinIO class buckets with Object Lock, synchronises the Unleash `default` project with the flag registry, applies the reference app's migrations and seeds after the platform ones, and provisions the seed personas into Keycloak (`SEED_CREDENTIALS.md`, never committed). The reference `api` and `worker` then run on those real adapters; only LLM, KMS and TRUST stay on fixtures (`APP_FIXTURE_PORTS`). The two containers join the host network and reach the services at their published loopback ports, because the adapters allow plain HTTP to loopback only (PL6-D-10). The durable timers of `@infrabyx/workflow` run on the stack's Temporal: the api starts them, the worker runs the `ipb-timers` task queue (PL6-D-11).
