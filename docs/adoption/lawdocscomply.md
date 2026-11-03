# Adoption note — LawDocsComply (3 November 2026 release)

LawDocsComply has raised no platform request yet. Its repository is at Phase 0: tooling only, with no `@infrabyx/*` dependency installed. So it has nothing to bump and no shim to retire. This note says what to install first and which platform answers to use rather than rebuild.

## 1. First install

- Scaffold from this repository at the release commit (product guide §1), or add the packages by hand at the versions of the release that follows version PR "chore: version packages" of 3 November 2026 (STATUS, "Releases after 1.0.0"): `contracts` 1.15.0, `tenancy` 1.9.0, `connectors` 1.5.0, `crypto` 1.4.0, `config` 1.6.0, `audit` 1.5.1, `seed` 1.0.20, and `testing` 1.5.0 as a dev dependency. Then add each package you use at the same release.
- Run `infrabyx-migrate --require-all` from the package that depends on every platform package with migrations, then `infrabyx-rls-lint`.
- Call the platform CLIs by name (guide §2).

## 2. Use these rather than build them

- **Tooling.** Use `@infrabyx/testing/eslint` for the IPB lint rules instead of a copy. Generate each `.env.example` with `infrabyx-env example --product LDC` once your settings are registered in `@infrabyx/config`. Keep `pin-check`, `licence-check` and `pr-checklist` until the platform publishes them (Udofin PR-UDF-001); then retire them.
- **Public forms.** Use `TurnstileCaptcha` behind `CaptchaGate` (§7q).
- **DPDP consent to your own purposes.** Use `PurposeConsents` (§7j), not a ledger of your own.
- **Named functions such as a compliance officer.** Use `TenantFunctions` with `OFFICER_POLICY` (§7k).
- **Batches, idempotent APIs and timers.** Use `tx.unit` and `recordBatch` (§7n), `kernel.ambient` with `idempotent()` (§7g), and `WorkflowTimers` product kinds (§7c).

## 3. Raising requests

Record anything missing in your `docs/platform-requests.md`, with the shim you use meanwhile, as Finbyx and Udofin do. The platform works only on raised requests and security updates (maintenance mode).
