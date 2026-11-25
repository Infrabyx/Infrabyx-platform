# R1 plan: a per-product local stack and redirect URIs on a re-run (DEV-LOCAL-01)

The owner's request of 25 Nov 2026, 22:35 IST (OWNER-MANUAL-02; R1-D-289), from the owner's own run of a product's local stack the same day. Udofin and LawDocsComply are fixing their own copies now (their DEV-LOCAL-01), so the setting names below are kept stable for them to align with. Built as R1-D-290. Spec of record: IPB-01-33 and §01.4.8.3 (the local Compose stack), IPB-02-28 (environment-variable secrets only in the local stack), IPB-02-05 and IPB-01 IDENTITY (the realm as configuration as code), IPB-11 (`.env.example`, seeds never in `prod`, `dr` or `pre-prod`; `SEED_REFUSED_ENVS`, PL1-D-06). Nothing under `docs/ipb/` or `docs/ecosystem/` is edited.

## A. The defects

1. The Compose project name was fixed (`name: infrabyx`) and so were the host ports, so every product copied from the scaffold shared one project: their stacks clashed, and `dev:down` (`down --volumes`) in one product deleted the data volumes of every other.
2. `dev-up.mjs` ran the public-site seed (cwd `apps/public`, `APP_PRODUCT` `OH`) whether or not the product had that app.
3. The compose `apps` profile built the reference apps and set `APP_PRODUCT: LD`.
4. `dev-up` registered one web callback on one client, and `KeycloakIdentity.applyRealm` never updated an existing client's redirect URIs, so a product with two web apps signed in on one only.
5. `.cerbos/` must be git-ignored in the product (the scaffold copies the platform's `.gitignore`, which has it; a test now holds it).
6. Not every variable `dev-up`, the migrations and the seed read was in an `.env.example`.

## B. The product setting (stable names)

One block in the repository's root `package.json`, beside the `infrabyx.product` the scaffold already writes:

```json
"infrabyx": {
  "product": "UDF",
  "local": {
    "apps": [
      { "name": "api", "dir": "apps/api", "kind": "api", "slot": 5 },
      { "name": "worker", "dir": "apps/worker", "kind": "worker", "slot": 6, "api": "api" },
      { "name": "web", "dir": "apps/web", "kind": "web", "slot": 7, "api": "api" },
      { "name": "portal", "dir": "apps/portal", "kind": "web", "slot": 8, "api": "api" }
    ]
  }
}
```

- **`infrabyx.product`** (the product code) gives the Compose project name `infrabyx-<code in lower case>` and the port block: every service port is its default plus the product's offset, `FBX` 0 (today's ports), `UDF` 100 (the block Udofin already uses), `LDC` 500, `EQ` 600, `LD` 1200, `OH` 1300. The offsets are chosen so that no two blocks share a port; a test holds it.
- **`infrabyx.local.project`** and **`infrabyx.local.portOffset`** override the two for a repository that is not a product. The platform repository uses `infrabyx-platform` and offset 0, so its CI and tests keep today's ports and its volumes are its own.
- **`infrabyx.local.apps`**: the apps the `apps` profile builds and runs, each with `name` (the Compose service), `dir`, `kind` (`api`, `worker`, `web`, `public`, `console`), `slot` (0 to 19: host port 53120 + slot + offset), and optionally `api` (the api a web or worker app talks to), `site` (the public app a console links to), `callbackPath` (web: `/auth/callback` by default; api: `/auth/callback`) and `postLogoutPath` (web: `/` by default), and `product` (that app's own code where it differs; the platform's group site is `OH`).
- A host port in `.env.local` (for example `PG_PORT=55433`) still overrides one port.

## C. `scripts/dev-up.mjs` and `scripts/local-stack.mjs`

- `local-stack.mjs` (new, no dependency): reads and validates the setting; the project name, ports and app URLs; the generated `infra/compose/.apps.local` (the `apps` services, JSON, which Compose reads as YAML; git-ignored by `*.local`); the realm's redirect, post-logout and web-origin lists; the variable list of `.env.example`.
- `dev-up` passes `-p <project>` and the computed ports to every Compose call. `up` builds the Cerbos bundle from the platform policies and each declared api's `policy/cerbos` that exists; runs the platform migrations, then each declared api's `migrations` that exist; runs the public-site seed only when a `public` app is declared and its directory exists, and each api's seed and personas only when that api's built seed exists; `APP_PRODUCT` is always the setting's code (or the app's own `product`). It refuses to run when `APP_ENV` is `prod`, `dr` or `pre-prod` (`SEED_REFUSED_ENVS`).
- `down` stops the project and keeps its volumes; `down --volumes` removes this project's volumes only (Compose scopes them by `-p`). Another project's volumes are never named.
- `logs` prints the project's logs (CI uses it instead of a bare `docker compose`).
- `docker-compose.yml` loses `name:` and the five app services (they move to the generated file); every port keeps its variable.

## D. `KeycloakIdentity.applyRealm` (`connectors` minor)

- `KeycloakRealmSpec.apiClient` gains `postLogoutRedirectUris?` and `webOrigins?`. Web origins default to the exact origins of the redirect and post-logout URIs (the same as Keycloak's `+`, but listed).
- On a realm that exists, the api client's `redirectUris`, `webOrigins` and (when given) `post.logout.redirect.uris` are set to exactly the spec's on every run; a client missing from an existing realm is created.
- Never wider than declared: every URI is an absolute `http`/`https` URL with no `*`, no fragment and no user info; `http` only to `localhost`, `127.0.0.1` or `[::1]`; a web origin is an origin only (no path), never `*` or `+`; with the new `localOnly: true` (what `dev-up` passes) every URI and origin must be on a loopback host. A refusal is `IPB-PORT-001` with the field and the problem, never the URI, before any call to Keycloak (`realmRedirectProblem`).
- Tests: the unit test (recorded Admin API) shows a second run PUTs the new lists; the Keycloak contract leg applies a realm twice with different lists and reads them back.

## E. The scaffold

Writes `scripts/local-stack.mjs`, `infrabyx.local.apps` for its five apps, `infra/compose/.env.example` (every variable `dev-up`, the migrations and the seed need, no values), and keeps `.cerbos/` and `*.local` git-ignored (tested). `dev-up.mjs` no longer carries a product constant.

## F. CI

The `compose` job (required): a decoy volume of another project (`infrabyx-udf_pgdata`, Compose's labels) and of the old shared project (`infrabyx_pgdata`) before `dev:up`; every declared web app's sign-in redirect carries its own registered callback and Keycloak serves its login page for it (an unregistered one answers `Invalid parameter: redirect_uri`); `dev:down` keeps this project's volumes, `dev:down --volumes` removes them, and both decoys survive.

## G. Decisions (R1-D-290, `[ASSUMED – owner review]`, owner question #207)

The setting's place and names; the offsets; the platform's own project and offset 0 (shared with Finbyx's block, so the two cannot run at the same time); web origins listed instead of `+`; the post-logout list left as it is when a spec omits it; `localOnly`. No migration, platform setting, environment variable read by a package, role or algorithm.

## H. Exit gate

`pnpm turbo run build lint typecheck test --filter=@infrabyx/connectors`; `pnpm scripts:test`; the Keycloak contract leg; `pnpm dev:up --profile apps` and the `compose` job's checks locally; `node scripts/ipb-check.mjs`; Prettier. Changeset `@infrabyx/connectors` minor. Threat model §3.192; guide §7ez.
