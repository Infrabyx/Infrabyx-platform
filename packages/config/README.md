# @infrabyx/config

Environment loader and guards, the settings registry and resolution, and feature flags for every Infrabyx product.

**Specified by:** `docs/ipb/` — IPB-11 §11.3–11.4 (environment), IPB-07 §07.3.3, §07.4.2, §07.5 (settings), IPB-09-24 to IPB-09-27, IPB-02-83 and IPB-12 §12.5 (flags), IPB-01 §01.4.11 (supabase-guard). Plan: `docs/phases/PL1-plan.md` §6. Decisions PL1-D-03, PL1-D-08, PL1-D-10 to PL1-D-12.

## Environment (`@infrabyx/config/env`)

```ts
import { z } from "zod";
import { envVar, secretRef, envUrl, loadAndValidate, secretsResolver } from "@infrabyx/config/env";

export const envSchema = z.object({
  APP_ENV: envVar(
    z.enum(["local", "dev", "test", "preview", "staging", "pre-prod", "demo", "prod", "dr"]),
    { desc: "Deployment environment", example: "local", required: "all", sens: "C", port: "APP" },
  ),
  DB_URL: envVar(envUrl(), {
    desc: "PostgreSQL URL without password",
    example: "postgres://app@localhost:5432/ldc",
    required: "all",
    sens: "C",
    port: "DB",
  }),
  DB_PASSWORD: secretRef({
    desc: "PostgreSQL password",
    example: "app",
    prodExample: "secret://aws-sm/infrabyx/ldc/prod/db#password",
    required: "all",
    port: "DB",
  }),
});
export const env = await loadAndValidate(envSchema, {
  secrets: secretsResolver({ "aws-sm": secretsPort }),
  hostMap,
});
```

- Boot order (IPB-11 §11.4.2): parse → guards → resolve `secret://` through the SECRETS port → guards on resolved secrets → one log line `config.guard.passed=true` with the check names. Any failure prints `<code> <NAME>: <reason>` (never a value) and exits **78**.
- Guards (`GUARDS` in `env/guards.ts`, the only place with environment branches): `node-env` and `seed-refused` (IPB-11-14, ENV-006/ENV-001), `literal-secret` (IPB-11-15, ENV-003), `forbidden-host` (IPB-11-16, ENV-004), `known-dev-value` incl. LocalKms fingerprints (IPB-11-17, ENV-005), `public-url-host-map` (IPB-11-18, ENV-010), `db-tls` (IPB-11-19, ENV-007), `ai-india-region` (IPB-11-20, ENV-008), `supabase-guard` (IPB-01, ENV-002). Groups follow IPB-11 §11.2: pre-prod gets prod rules; pre-prod and demo get staging rules.
- `redact(schema, values)` masks every `sens: "S"` variable (IPB-11-07).
- `infrabyx-env example --schema dist/env.schema.js [--product LDC] [--check]` writes `.env.example` from the schema, or fails and names the drifting variables (IPB-11-03, IPB-11-AT-06).

## Settings (`@infrabyx/config/settings`)

`settings-tree.yaml` is the source: the 20 binding nodes of IPB-07 §07.4.2 in order, the console-only nodes, and every key from IPB-01 §01.5, IPB-02 §02.5, IPB-07 §07.5 and IPB-11 §11.5 with tier, type, default, bounds, `locked`, `tighten`, `user_override`, roles and maker-checker class. `pnpm gen:registry` emits `src/settings/registry.generated.ts`; `pnpm check:registry` fails CI on drift. Keys of later phases are registered by those phases (D-11).

- `SettingsService.get(ctx, key)` is typed by key; an unregistered key fails typecheck and throws `IPB-UX-007`.
- Resolution PLATFORM → PLAN → BRAND → TENANT → ENTITY → USER (IPB-07-38); a key's `tier` is the lowest tier where it may be set.
- `set()` refuses locked keys (`IPB-SEC-020`), tiers below the key's tier, out-of-bound values and loosening of tighten-only keys (`IPB-UX-008`), and principals without a listed role (`IPB-UX-011`). It writes through `MutationKernel.mutate` with an audit entry and `SettingChanged`/`UserPreferenceChanged` in the same transaction; maker-checker keys become an approval request instead, and the approvals engine calls `applyApproved()`.
- Stores: `PgSettingsStore` (`config.setting_value`, RLS) and `MemorySettingsStore`.

## Flags (`@infrabyx/config/flags`)

- Registry with owner, created date, expiry, default and description, plus taxonomy and expiry lint (IPB-09-24/25). `kill.*` switches per IPB-02-83; the 39 `fut.*` flags of IPB-12 §12.5 (PL1-D-10). `flags.defaults.json` mirrors the defaults.
- `FlagService.isOn(key)` is typed by key (unregistered → typecheck error, `IPB-ENG-008`). When the provider fails it serves the last snapshot if it is at most 24 h old; otherwise `kill.*` evaluates **on** (safe state) and other flags take their default.
- `FlagAdmin.set()` — `kill.*` by PLT_RELEASE_MANAGER or PLT_SECURITY_OFFICER only (`IPB-ENG-016`), ledgered with `KillSwitchChanged`; `fut.*` through maker-checker (PL1-D-11).
- Providers: `MemoryFlagProvider`, `FileFlagProvider`, `PgFlagProvider` (`config.flag_value`); snapshot stores `MemorySnapshotStore`, `PgSnapshotStore` (`config.flag_snapshot`). Unleash arrives in PL2.

## Provider routing (`@infrabyx/config/routing`)

- `loadRoutingFile(path)` reads `infra/routing/<product>/<env>.routing.yaml` (`int.routing.file`) and validates it with `checkRouting` from `@infrabyx/contracts/routing` (IPB-01 §01.4.5, IPB-01-20). Any problem refuses boot with `IPB-PORT-005`, listing every problem:
  - a `secrets` value that is a literal, or a path for another env;
  - an adapter whose residency cannot carry its own maximum data class;
  - a failover that crosses residency;
  - a product file that loosens `residency_policy`;
  - a GLOBAL messaging adapter without `dpa_ref`, or with `recipient_delivery.allow_global: false` (IPB-DEV-05);
  - an `unproven` adapter in staging, pre-prod, prod or dr (IPB-DEV-04 gate B).
- `infrabyx-routing check <file...> [--sandbox-status packages/connectors/sandbox-status.json]` runs the same checks in CI and prints problems only. Secrets are paths, never values.
- PL2 registers the port keys of IPB-01 §01.4.4.2 for the thirteen PL2 ports (`int.<port>.*`, `eng.otel.*`, `eng.logs.*`, `eng.flags.*`). The registry now has 156 keys.

## Migrations

`migrations/0001_init.sql` creates schema `config`: `setting_value`, `flag_value`, `flag_snapshot`, `outbox`, `inbox`, all with RLS enabled and forced. Applied by `infrabyx-migrate` from `@infrabyx/tenancy` after the tenancy and audit migrations.

`internalEvent()` (`@infrabyx/config/events`) builds internal CloudEvents envelopes for the outbox.
