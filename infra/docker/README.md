# infra/docker

The container images of the platform's deployables (IPB-01-31, §01.4.8.1; PL6 plan §3).

| File                 | What it is                                                                                                                                                     |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `next/Dockerfile`    | The image of every Next.js deployable (`apps/public`, `apps/console`): base → deps (`pnpm fetch`) → build (`turbo build`, `pnpm deploy --prod`) → runtime      |
| `node/Dockerfile`    | The image of every other Node deployable (`apps/reference/api`, `apps/reference/worker`): the same stages, `ENTRYPOINT node --enable-source-maps dist/main.js` |
| `healthcheck.mjs`    | The image `HEALTHCHECK`: the app's own `/health/live` on its port                                                                                              |
| `image.e2e.test.mjs` | `@IPB-01-AT-15` on built images (`IPB_IMAGES="<image> …" pnpm images:test`)                                                                                    |
| `trivyignore.yaml`   | Trivy waivers, each with a statement, a reason and an expiry                                                                                                   |
| `BASE_IMAGES.md`     | The pinned Node base (tag and digest)                                                                                                                          |
| `TEST_IMAGES.md`     | Images the contract legs run (tests only, never deployed)                                                                                                      |

## Build and run

```sh
docker build -f infra/docker/next/Dockerfile --build-arg APP=public -t infrabyx/public:dev .
docker build -f infra/docker/node/Dockerfile --build-arg APP=reference/api -t infrabyx/reference-api:dev .
# Behind a TLS-inspecting proxy: add --secret id=ca,src=<ca.pem>
docker run --read-only --tmpfs /tmp --tmpfs /app/.next/cache:uid=10001 --cap-drop ALL \
  --security-opt no-new-privileges -p 3000:3000 --env-file <env file> infrabyx/public:dev
```

The runtime runs as UID 10001 with the code owned by root (readable, never writable), on a read-only root filesystem. The only writable paths, `/tmp` and (Next.js only) `.next/cache`, are empty volumes in Compose and the Helm chart. Environment variables are the app's `.env.example` keys; in staging and above secrets come through the SECRETS port, never the environment (IPB-02-28).

## Probes

Every app serves `/health/live` (the process answers), `/health/ready` and `/health/startup` (one database round trip within 2 seconds; 503 when down). The body has the `ReadyBody` shape of `@infrabyx/connectors` and names no host, version or error text.

## Checks (`containers` CI job)

hadolint and `trivy config` on the Dockerfiles; build each image; `trivy image` (vulnerabilities and secrets; critical and high must be zero or waived in `trivyignore.yaml`); then `@IPB-01-AT-15`. Images are not pushed or signed until the owner approves it (OWNER-QUESTIONS #67).

| Tool     | Image (pinned)                                                                                      | Version | Published  |
| -------- | --------------------------------------------------------------------------------------------------- | ------- | ---------- |
| hadolint | `hadolint/hadolint:v2.15.1@sha256:32dac94127fd60b7b7e3fbfc65e1383b9b5e25c9bfd7b8536de7a539fe68a12d` | 2.15.1  | 2026-07-31 |
| Trivy    | `aquasec/trivy:0.76.0@sha256:2416d1f74045b57274df1a340eee6b510cacd73c66a6ccb8da092b117eb7d222`      | 0.76.0  | 2026-10-14 |

The same pinned images run locally and in CI (PL6-D-02); each was published at least 7 days before it was pinned (PL2-D-32).
