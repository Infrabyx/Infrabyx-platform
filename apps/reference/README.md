# apps/reference

The "hello tenant" application that uses the `@infrabyx/*` packages the way a product does (IPB-14 §14.3; PL6 plan §8). The template products scaffold from: `api` becomes their `apps/api`, `worker` their `apps/worker`, `web` (PL6 session 5) their `apps/web` (IPB-01 §01.4.2).

| Part     | What it is                                                                                                                                                                                                                                                                                                                       |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `api`    | `@infrabyx/reference-api`: NestJS 11 on the kernel (`tenancy`), the ledger (`audit`), settings and events (`config`), the IDENTITY, AUTHZ, STORAGE and QUEUE adapters (`connectors`), help (`hlp`) and the seed framework (`seed`). Sign-in with PKCE through IDENTITY, health probes, the `hello` module, the worker entrypoint |
| `worker` | `@infrabyx/reference-worker`: the API's codebase started at its worker entrypoint (queue consumers, the outbox relay, the timers' poller and the Temporal worker of `ipb-timers`, the same health probes)                                                                                                                        |
| `web`    | `@infrabyx/reference-web`: Next.js 16, the browser's only origin (a backend-for-frontend): sign-in proxied to the api through this origin, pages rendered from server-side api calls with the session cookie, same-origin POST routes, the nonce CSP; the gate journey in `web/src/__tests__/journey.e2e.test.ts`                |

## The `hello` module (the module pattern)

`api/src/modules/hello`: the manifest (`defineModule`), the migration `api/migrations/0001_hello.sql` (schema `hello`, one tenant table under forced RLS, the module's outbox and inbox), the service (every write through `kernel.mutate` with its ledger entry and its event in one transaction), the setting `hello.greeting.max_length` registered in `@infrabyx/config`, the help keys in `api/help/hello.yaml`, the Cerbos policy in `api/policy/cerbos`, the Vidhi skill `api/src/modules/hello/summarise.ts`, the seed module `api/src/seed/hello.ts`, and the NN pattern suites in `api/src/__tests__/api.int.test.ts`.

| Route                                                                        | Who                         | What                                                                                                                 |
| ---------------------------------------------------------------------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `GET /hello/greetings`, `GET …/:id`                                          | readers of the tenant       | the tenant's greetings (RLS: another tenant's id answers 404)                                                        |
| `POST /hello/greetings`                                                      | makers                      | a greeting of at most `hello.greeting.max_length` characters                                                         |
| `POST /hello/greetings/:id/retract`                                          | makers                      | an R2 maker-checker request; a checker decides at `POST /approvals/:id/decide`                                       |
| `DELETE /hello/greetings/:id`                                                | owners                      | soft delete; the action ends in `delete`, which the kernel refuses to agents                                         |
| `GET /auth/login`, `GET /auth/callback`, `GET /auth/me`, `POST /auth/logout` | anyone                      | the OIDC code flow with PKCE; `?persona=` only with the fixture IDENTITY                                             |
| `GET /health/live`, `/ready`, `/startup`                                     | the container and the chart | IPB-01 §01.4.8.2 probes                                                                                              |
| `GET /content/:packId/:locale/*path`                                         | anyone                      | published CMS content of a brand pack (content, redirects, 404)                                                      |
| `GET /pages/:locale/*path`                                                   | anyone                      | published CMS content of the product's default brand pack (what the web app renders)                                 |
| `POST /vidhi/hello/summarise`, `GET /vidhi/tasks/:id`                        | makers                      | the hello Vidhi skill: the agent summarises and proposes; a checker decides the post at `POST /approvals/:id/decide` |
| `POST /export`, `GET /export/:id`, `GET /export/archives/:id/download`       | owners (admins request)     | the tenant export: the worker runs the job, the download is a signed link                                            |
| `GET /trust`                                                                 | anyone                      | the Trust Centre built from the mirror                                                                               |

## Run it

```sh
pnpm build
pnpm dev:up --profile apps             # the stack (Keycloak realm, MinIO buckets, Unleash, seeds, personas) and the api (53125), worker (53126) and web (53127) images on its real adapters
curl -s http://127.0.0.1:53127/health/ready
# open the web app and sign in through Keycloak as a seed persona (passwords in SEED_CREDENTIALS.md,
# never committed; owners, admins and checkers enrol an authenticator on the first sign-in):
open http://localhost:53127/
# or, with fixture adapters (APP_FIXTURE_ADAPTERS=true outside Compose), as a fixture persona:
curl -s -c jar -b jar -L -o /dev/null "http://localhost:3000/auth/login?persona=maker"
```

Outside Compose: copy `api/.env.example`, set `APP_FIXTURE_ADAPTERS=true` in local, dev, test or preview (or the `AUTH_*`, `AUTHZ_*`, `STORAGE_*`, `QUEUE_*` and `WORKFLOW_*` variables of the real adapters; `WORKFLOW_TEMPORAL_ADDRESS` alone switches the timers to Temporal), run `infrabyx-migrate --db <url> --dir apps/reference/api/migrations --name reference` after the platform migrations, then `pnpm --filter @infrabyx/reference-api start` and `start:worker`.

## Tests

`pnpm --filter @infrabyx/reference-api test` (environment, PKCE and cookies, the fixture IdP, the manifest) and `test:int` (PostgreSQL through Testcontainers or `IPB_TEST_PG_URL`): the HTTP journey on the fixture adapters, and `@NN-01`, `@NN-02`/`@NN-45`, `@NN-18`, `@IPB-02-10` and `@IPB-11-14` against `hello.greeting`.

The gate journey (PL6 plan §8.2): with the stack up, `IPB_TEST_CREDENTIALS=$PWD/SEED_CREDENTIALS.md pnpm --filter @infrabyx/reference-web test:e2e` signs in as the demo owner through Keycloak (TOTP enrolment, then a sign-in with the code), reads the welcome page, asks the assistant, downloads the signed export and opens the Trust Centre, with axe on every page. The `reference` CI job runs it, then the api's integration and NN suites on the stack's PostgreSQL and Temporal.
