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

## 4. Wave 1 (version PR #208, release run 184: `tenancy` 1.10.0, `connectors` 1.8.0, `contracts` 1.16.0, `config` 1.9.0, `testing` 1.8.0)

What LawDocsComply removes once the wave 1 release is published (R1-plan M37, M38; R1-D-67, R1-D-68). Move every `@infrabyx/*` dependency to that release together and run `infrabyx-migrate --require-all` (wave 1 adds no migration).

1. **PR-LDC-12, tenant creation (guide §7y).** Replace the tests' direct `insert into tenancy.tenant` rows and the local provisioning gap with `TenantBootstrap.bootstrap(platformCtx, { tenantId, product: "LDC", name, settings?, onCreated? })`. Pass `SettingsService` for initial tenant settings, and write your own first rows in `onCreated`. It is refused in `prod`, `dr` and `pre-prod`. **Shim removed:** the direct tenant inserts in tests and Compose.
2. **PR-LDC-11, the Operations Hub adapter (guide §7z).** Replace your inbox `TenantProvisioned` consumer and `TrialService.provisionIn` with `OperationsHubProvisioning` from `@infrabyx/connectors/provisioning`. Call `receive(event, jws)` from the webhook route and `drain()` from the worker. Move what `provisionIn` wrote into `onProvisioned(tx, tenant)`. Keep reporting `READY` by `PUT /v1/provisioning-requests/{id}`. **Shim removed:** the inbox consumer and `provisionIn`. **Kept:** your outbox `ProvisioningRequested`, until PR-040 (Ecosystem Spec v1.3) is signed off (OWNER-QUESTIONS #105). The platform then adds the request half and `ProvisioningFailed`.
3. **Mark met** PR-LDC-11 (the consumer half) and PR-LDC-12 in your `docs/platform-requests.md`. PR-LDC-01 is answered with no change: KYC and KYB go through `digio-kyc` and `idfy-kyc`, and DigiLocker through `digio-kyc`. PR-LDC-04 and PR-LDC-06 are planned for wave 4 and after it (M48, M49). PR-LDC-08 (a) and (b) are planned as tenant-consented support access (M50).

## 5. Wave 2 (version PR #209, release run 186: `contracts` 1.17.0, `notify` 1.2.0, patches of the rest)

What LawDocsComply removes once it moves to the wave 2 release (R1-plan M39; R1-D-69). Move every `@infrabyx/*` dependency to the run 186 versions together and run `infrabyx-migrate --require-all` (`notify/0003`).

1. **PR-LDC-15, delivery reports by vendor reference (guide §7aa).** In each vendor webhook controller, verify the event as now, then call `routeEmailEvents(adapter, events)`, `routeSmsReports(adapter, reports)` or `routeWhatsappEvents(adapter, events)`. The dispatcher's service reader finds each report's tenant (ledgered) and applies it there. Log the returned `{ routed, unknown, ambiguous }` counts. **Shim removed:** the webhook controller's platform-wide suppression-only handling, so deliveries now move past `sent` to delivered, bounced or read.
2. **Per-tenant templates.** Optional for LawDocsComply: pass `templates` to `NotifyService` only if a tenant needs its own DLT or WhatsApp template.
3. **Mark met** PR-LDC-15 in your `docs/platform-requests.md`.
