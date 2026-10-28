# apps/reference

The "hello tenant" application that uses the `@infrabyx/*` packages the way a product does (IPB-14 §14.3; PL6 plan §8). The template products scaffold from: `api` becomes their `apps/api`, `worker` their `apps/worker`, `web` (PL6 session 5) their `apps/web` (IPB-01 §01.4.2).

| Part     | What it is                                                                                                                                                                                                                                                                                                                       |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `api`    | `@infrabyx/reference-api`: NestJS 11 on the kernel (`tenancy`), the ledger (`audit`), settings and events (`config`), the IDENTITY, AUTHZ, STORAGE and QUEUE adapters (`connectors`), help (`hlp`) and the seed framework (`seed`). Sign-in with PKCE through IDENTITY, health probes, the `hello` module, the worker entrypoint |
| `worker` | `@infrabyx/reference-worker`: the API's codebase started at its worker entrypoint (queue consumers, the same health probes)                                                                                                                                                                                                      |
| `web`    | PL6 session 5                                                                                                                                                                                                                                                                                                                    |

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
| `POST /vidhi/hello/summarise`, `GET /vidhi/tasks/:id`                        | makers                      | the hello Vidhi skill: the agent summarises and proposes; a checker decides the post at `POST /approvals/:id/decide` |
| `POST /export`, `GET /export/:id`, `GET /export/archives/:id/download`       | owners (admins request)     | the tenant export: the worker runs the job, the download is a signed link                                            |
| `GET /trust`                                                                 | anyone                      | the Trust Centre built from the mirror                                                                               |

## Run it

```sh
pnpm build
pnpm dev:up --profile apps             # the Compose stack with the api (53125) and worker (53126) images
curl -s http://127.0.0.1:53125/health/ready
# sign in as a seeded fixture persona (member, maker, checker, admin, owner, sandbox_owner, super_admin)
curl -s -c jar -b jar -L -o /dev/null "http://127.0.0.1:53125/auth/login?persona=maker"
curl -s -b jar http://127.0.0.1:53125/hello/greetings
```

Outside Compose: copy `api/.env.example`, set `APP_FIXTURE_ADAPTERS=true` in local, dev, test or preview (or the `AUTH_*`, `AUTHZ_*`, `STORAGE_*` and `QUEUE_*` variables of the real adapters), run `infrabyx-migrate --db <url> --dir apps/reference/api/migrations --name reference` after the platform migrations, then `pnpm --filter @infrabyx/reference-api start` and `start:worker`.

## Tests

`pnpm --filter @infrabyx/reference-api test` (environment, PKCE and cookies, the fixture IdP, the manifest) and `test:int` (PostgreSQL through Testcontainers or `IPB_TEST_PG_URL`): the HTTP journey on the fixture adapters, and `@NN-01`, `@NN-02`/`@NN-45`, `@NN-18`, `@IPB-02-10` and `@IPB-11-14` against `hello.greeting`.
