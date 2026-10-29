# Product guide — building a product on the platform

For the teams of LawDocs, LawDocsComply, Equator, Finbyx, Udofin and Operations Hub. It collects what a product repository does to adopt the `@infrabyx/*` packages and the shared infrastructure, and the owner decisions behind each step (`docs/DECISIONS.md`). The spec of record stays `docs/ipb/` and `docs/ecosystem/`.

## 1. Start the repository

1. From this repository at a release commit, after `pnpm install --frozen-lockfile` here (the scaffold refuses to start without it): `pnpm scaffold --product <code> --name "<name>" --out <dir>` (PL6-D-14). It writes the five apps with your product code in place of the reference default (`LD`), the toolchain, CI, CLAUDE.md, STATUS, DECISIONS, the local stack, the chart values and the OpenTofu stacks; each `.env.example` is already what `infrabyx-env example --product <code>` writes (R1-D-07).
2. Create the GitHub repository from that folder, add the secret `NPM_READ_TOKEN` (read:packages) and apply your ruleset (the shape of `infra/policy/github/rulesets.json`: squash merges only, signed commits, linear history).
3. Copy from this repository on day one: the git hooks (`lefthook.yml`, `infra/policy/hooks/`, `.gitleaks.toml`, `commitlint.config.mjs`), the secret scan, and the integration, NN, container, compose and a11y CI legs as your code grows.

## 2. Install and upgrade the packages

The committed `.npmrc` names the registry only (ADR-0002); CI writes the token through `actions/setup-node`, developers once with `pnpm config set "//npm.pkg.github.com/:_authToken" <token>`. Pin exact versions and move every `@infrabyx/*` dependency together; Renovate proposes the bumps (the 7-day minimum release age exempts `@infrabyx/*`). Each release lists what a product must change (migrations through `infrabyx-migrate`, settings, environment variables) in the gate report and STATUS.

**Running the platform CLIs.** Call them by name: `pnpm exec infrabyx-migrate …` (or a `package.json` script), `infrabyx-env`, `infrabyx-rls-lint`, `infrabyx-migration-lint`, `infrabyx-seed` and the others. Before the patch release that carries platform request PR-UDF-005 (STATUS, "Releases after 1.0.0"), ten of the fourteen CLIs exited 0 without running when started through a `node_modules` symlink: `pnpm exec` with linked packages, npm's `.bin`, and `node node_modules/@infrabyx/<pkg>/…` as the chart's migration job runs it. A CI step built on them passed without checking anything. Once on that release, remove any wrapper that runs a CLI by its real path (Udofin's `scripts/platform-cli.mjs`, and `scripts/env-example.mjs` calling `generateEnvExample` directly) and call the CLI itself; a run prints its usage or its findings, never nothing.

## 3. Images

The platform does not publish images (owner answer #67(3)). Build your own from the shared Dockerfiles, `infra/docker/node` (api, worker) and `infra/docker/next` (web, public, console), with the base images pinned by digest as they are here (`@IPB-01-AT-01`, `@IPB-01-AT-15`). Push them to your own registry by digest, then sign each image and attest its CycloneDX SBOM from your release workflow (section 6).

## 4. OpenTofu state

Compose your cloud's `platform` module in `infra/terraform/envs/<product>/<env>/`, from `infra/terraform/envs/example/preview`. State is SECRET class: some provider-generated secrets live in it, for example the Memorystore AUTH string on GCP (PL6-D-06). So:

- **Client-side state encryption is on from the first apply** (owner answers #71, #72; PL6-D-16). The example stack's `encryption` block encrypts state and plans with AES-GCM and sets `enforced = true`, so OpenTofu refuses to write either unencrypted. Supply the key at run time, never in a file: `TF_VAR_state_passphrase` (at least 16 characters) from your CI secret store, or replace the `pbkdf2` key provider with your cloud's KMS (`aws_kms`, `gcp_kms`) or OpenBao (`openbao`) key provider once the key exists.
- The scaffolded stacks reference the platform modules by git (`git::https://github.com/Infrabyx/Infrabyx-platform.git//infra/terraform/modules/…?ref=<commit>`), which works without a credential while the platform repository is public. If it is made private later, `tofu init` needs a read token for it (a fine-grained token with contents read on that repository, supplied through the git credential helper or `GIT_ASKPASS` in CI, never in the module source).
- Keep the state in the cloud's locked remote backend (S3 with `use_lockfile`, GCS or Azure Blob), with the bucket's own encryption and versioning.
- Losing the passphrase or the key makes the state unreadable: keep it with the break-glass material, and rotate it with a `fallback` block (the old key) for one apply.

## 5. Admission policies

Apply `infra/policy/kyverno` to every cluster. `verify-images` refuses an unsigned or unattested image (owner answer #67(1)):

- **Enforce** in every namespace except those labelled `infrabyx.dev/env` = `local`, `dev`, `test` or `preview`, where the same check only audits. Staging, demo, pre-prod, prod, dr and an unlabelled namespace are enforced. Label each namespace when you bootstrap the cluster.
- Add your registry path to `imageReferences` and your release workflow to the attestors' `subjectRegExp` (for example `^https://github\.com/Infrabyx/<repo>/\.github/workflows/release\.yml@refs/heads/main$`), or replace the keyless attestors with your KMS public key if you sign with a key (section 6).

## 6. Signing and its privacy cost

The platform signs its BOM and attests every published package with cosign keyless signing (GitHub OIDC, Fulcio certificates, the public Rekor transparency log). Verify a platform release with:

```sh
ID='https://github.com/Infrabyx/Infrabyx-platform/.github/workflows/release.yml@refs/heads/main'
cosign verify-blob --bundle bom.cdx.json.sigstore.json --certificate-identity "$ID" \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com bom.cdx.json
npm pack @infrabyx/tenancy@<version>
cosign verify-blob-attestation --type cyclonedx --bundle infrabyx-tenancy-<version>.tgz.cdx.sigstore.json \
  --certificate-identity "$ID" --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  infrabyx-tenancy-<version>.tgz
```

The bundles are attached to each package's GitHub release.

**Keyless signing from a private repository is public.** Every signature writes a certificate to Rekor, a public, append-only log that cannot be redacted. The certificate names the repository, the workflow file and the ref (for example `https://github.com/Infrabyx/<repo>/.github/workflows/release.yml@refs/heads/main`), and the log entry carries the artefact's digest and the time. For a private product repository this discloses the repository's name and release cadence. A product that must not disclose them signs with a KMS key instead: `cosign sign --key awskms:///<key-arn>` (or `gcpkms://`, `azurekms://`, `hashivault://`), with `--tlog-upload=false` if nothing may reach Rekor, and lists the key's public key in its Kyverno attestors (`keys:` instead of `keyless:`).

## 7. Before go-live

- Wire the real adapters for every port you use; the fixtures refuse to start from staging up (`APP_FIXTURE_ADAPTERS`, PL6-D-08).
- **Outbox relay:** from the minor after 1.0.0, run the platform `OutboxRelay` (`@infrabyx/tenancy`) in the worker as the `SVC_OUTBOX_RELAY` service reader (owner answer #74(e), R1-D-01). Add `select tenancy.register_outbox('<schema>');` to a migration of each module that has an outbox: it grants the relay only that table's relayed columns and fails if the table lacks forced RLS or a needed column. The relay reads pending rows across tenants (ledgered in each tenant), then delivers and marks each batch in that tenant's own context with one `<schema>.outbox.dispatch` ledger entry. The reference worker shows the wiring; retire any per-tenant relay of your own then.
- **Websites:** product editors will not edit JSON; the visual block editor for pages (PR-038) must be in place before the first product website goes live.
- Run `pnpm exit-runbook --routing <your production routing file>` and keep the runbook younger than 180 days; generate the BOM with each release (IPB-01-38, IPB-01-40).

## 7a. Consuming Ecosystem events

A module that consumes Ecosystem events keeps its own inbox (Spec §3.5). Its migration calls `select tenancy.create_ecosystem_inbox('<schema>');`. The worker then uses `new EcosystemInbox({ kernel, audit, schema, environment: "live" })`:

1. **Receive.** In the webhook handler, after the delivery signature verifies, call `inbox.receive(ctx, envelope, { businessKey })` in the consuming tenant's context, then answer 2xx. The business key is the event's idempotency key from Spec Part 6. A duplicate is acknowledged and never processed again.
2. **Process.** Call `inbox.drain(ctx, handle)` from the worker. `handle(tx, event)` runs in the event's own transaction, in `seq` order per subject. Events ahead of a gap wait.
3. **Sweep.** Call `inbox.sweep(ctx, { handle, replay, raiseBreak })` every few minutes:
   - `replay` fetches the missing events from the producer's `GET /v1/events?after=…` and passes each to `receive`;
   - `raiseBreak` publishes `ReconciliationBreakRaised` through the module's outbox in the transaction it is given.
4. **Reconcile.** After a break, an operator reconciles the subject from the owner's snapshot (`GET /v1/[aggregate]/{id}`) and calls `inbox.setPosition(ctx, source, subject, lastSeq)`.

## 7b. Signing and verifying regulated messages

For an event that `isRegulatedMessage(type)` names (Ecosystem Spec §3.6):

- **Producer:** sign it with `signRegulatedMessage({ event, kid, sign })`. `sign` is the KMS port's `sign` with the product's ES256 regulated-message key, and `kid` is that key's id. Store the returned JWS with the event and send it as the event's `signature` attribute.
- **Consumer:** check it with `verifyRegulatedMessage(event, jws, { keys, replay })` before `EcosystemInbox.receive`:
  - `keys` is a `RegulatedKeyRing` of the producer's published keys;
  - `replay` is a shared `ReplayStore` when several instances verify.
  - A failure answers 401 and is logged with its reason, never with the event.
- **Rotation:** add the new key to every consumer's ring first, then sign with it, and finally set the old key's `notAfter` to the end of the overlap.

## 7c. Scheduled per-tenant jobs

A job that must run for every tenant (the IPB-02-51 chain verification weekly, the anchor daily, or a product's own) lists the tenants through `TenantSweep` and runs once per tenant in that tenant's context:

```ts
const sweep = new TenantSweep({ kernel, audit: sink }); // after infrabyx-migrate (tenancy/0005)
const audits = new AuditSweep({ service: auditService, tenants: sweep });
const weekly = await audits.verifyAll(); // weekly.broken: tenants whose chain broke
const daily = await audits.anchorAll(yesterdayUtc); // daily.failed: tenants to retry
const own = await sweep.run((ctx) => myJob(ctx)); // ctx: tenant scope, svc_tenant_job
```

- The list is a ledgered `SVC_TENANT_SWEEP` read (`id`, `status` only); every tenant's ledger shows it.
- A job runs as `svc_tenant_job`, or as your own service principal passed as `jobPrincipal`, never as the reader.
- Schedule the calls in your worker (Temporal schedule or cron), and alert on `broken` and `failed`.

## 7d. Customer sign-in (one-time codes and DPoP)

End users who are not staff (borrowers, clients, parties) sign in with a one-time code in a **customer realm** of your product (R1-D-19). Never put customers in a staff realm.

1. **Run Keycloak with the extension.** Build `infra/keycloak/customer-otp` (`docker build -t <you>/keycloak-customer:26.8.1 infra/keycloak/customer-otp`) and run that image instead of the stock one. Apply the realm in your deploy job: `KeycloakCustomerIdentity.applyCustomerRealm({ baseUrl, masterAdmin, spec: { realm: "<product>-customers", apiClientId, adminClientId, audience, customerRoles: ["<P>_CUSTOMER"] } })`. It refuses a Keycloak without the extension. Keep the two client secrets it returns in SECRETS. On Zitadel, `ZitadelCustomerIdentity.applyCustomerOrg(...)` creates the customer organisation, application and login client.
2. **Wire the adapter.** Use `new KeycloakCustomerIdentity({ ..., store, replay, revocations, sender, customerRoles, settings })`:
   - `store` is a `PgCustomerAuthStore` (`connectors/0004`, applied by `infrabyx-migrate`);
   - `replay` is a `RedisReplayStore` on your Redis, so a proof replayed to another replica is refused;
   - `sender` is `notifyOtpSender({ notify, classes: { sms: "security.sign_in_code", email: "security.sign_in_code" }, context })`. Add that class to your catalogue: category `security`, mandatory, urgent, with your DLT SMS template, the WhatsApp `authentication` template and an email template. Its first variable is the code.
   - `settings` comes from `readCustomerIdentitySettings((k) => settings.get(ctx, k))`. The `int.identity.customer.*` keys hold the limits and lifetimes; they can only be tightened.
3. **The app's device key.** On first launch the app makes a P-256 key pair in the platform keystore (Secure Enclave or StrongBox, not exportable). Every call carries a DPoP proof (RFC 9449, ES256) made with it:
   - sign-in and refresh proofs target `port.signInProofTarget` (the IdP's token endpoint; publish it to the app);
   - API proofs target the API URL and carry `ath`.
4. **Sign-in.** The app sends the login and a proof to your API. Your API calls `startChallenge({ tenantId, channel, login, dpopProof })`, then `verifyChallenge({ tenantId, challengeId, code, dpopProof, deviceLabel })`. The code must be verified by the key that asked for it. Return the `CustomerSession` to the app.
   - `IPB-SEC-019` carries `meta.retryAfterSeconds`; show it to the customer.
   - `IPB-IDN-001` with `meta.reason` `code` or `challenge` means a wrong or expired code.
5. **Requests.** The API guard calls `verifyRequest({ authorization, dpopProof, method, url })` and gets `VerifiedCustomerClaims` (`tid`, `sub`, product roles, `deviceId`, `mfa: false`). `url` must be the URL the app called, as the public sees it. A Bearer token is refused.
6. **Refresh and sign-out.** Call `refreshSession({ tenantId, refreshToken, dpopProof })`; each refresh token works once. A current refresh token sent with another key signs the device out. `listDevices` and `revokeDevice` back the app's "signed-in devices" screen. A revoked device is refused everywhere within 15 s.
7. **Upgrade note.** Rebuild the image whenever the platform moves the Keycloak pin (it will move from 26.8.1 soon after 30 Oct 2026).

## 7e. KYC and video calls (ports only)

`KycPort` and `VideoMeetPort` are defined in `@infrabyx/contracts/ports` (R1-D-21). No adapter exists yet; the owner chooses the vendors (OWNER-QUESTIONS #87, #88). Build your flows on the interfaces now, and test them with `FakeKyc` and `FakeVideoMeet` from `@infrabyx/testing`:

- Pass files as STORAGE references with their SHA-256. Store the evidence each result returns (`vendorRef`, `modelVersion`, `checkedAt`), and for V-CIP the manifest, in your ledgered records. Never store an Aadhaar number: results give its last four digits only.
- Create a V-CIP room with a REGULATED `RoomPolicy` (see `VCIP_ROOM_POLICY`): `participantCountries: ["IN"]`, your tenant's official networks, recording on to the tenant's target, `providerRetention: "none"`. Resolve each joiner's country and proxy status with your GEO check, and pass it to `joinToken`.
- Keep `kyc.vcip.enabled` off: per-tenant STORAGE routing to a tenant-owned bucket is deferred (#83).

## 8. Adopting 1.0.0

1.0.0 is the platform baseline (IPB-14 §14.5 item 1; owner answer #67(4)). Every package moved to 1.0.0 together, and the public API is the same as the PL6 0.x set (`docs/phases/PL6-gate.md` §6). From 1.0.0 on, semantic versioning holds: a breaking change to an export, a migration or a setting comes only in a major release with an ADR (IPB-09-34/35).

**Versions.** All 22 packages are at **1.0.0**: `@infrabyx/a11y`, `ai`, `audit`, `brand`, `cms`, `config`, `connectors`, `consent`, `contracts`, `crypto`, `export`, `feedback`, `hlp`, `notify`, `rules`, `seed`, `tenancy`, `testing`, `trust`, `ui`, `vidhi` and `workflow`. The registry checksums are in `docs/phases/PL6-gate.md` §6.

**Install** (a new product; `pnpm scaffold` already writes these pins):

```sh
pnpm add --save-exact @infrabyx/contracts@1.0.0 @infrabyx/crypto@1.0.0 @infrabyx/config@1.0.0 \
  @infrabyx/tenancy@1.0.0 @infrabyx/audit@1.0.0 @infrabyx/connectors@1.0.0 @infrabyx/seed@1.0.0
pnpm add --save-exact --save-dev @infrabyx/testing@1.0.0
# then each package the product uses, at 1.0.0: rules, workflow, notify, export, ai, vidhi,
# ui, a11y, hlp, brand, cms, consent, feedback, trust
```

**Upgrade an existing product repository:**

1. List what is installed: `pnpm ls "@infrabyx/*" --depth 0`. Move every `@infrabyx/*` dependency to `1.0.0` in one change (the packages depend on each other at exact versions): `pnpm add --save-exact <each @infrabyx package you use>@1.0.0`, and the same with `--save-dev` for `@infrabyx/testing`.
2. Migrate: `infrabyx-migrate --db-file <path>` (or `--db <url>` locally) applies the platform migrations in order and refuses an edited released file. It names any platform package with migrations that it cannot resolve from the current package and skips it; `--require-all` refuses instead, so pass it once every such package is a dependency of the package that runs the command. 1.0.0 adds no migration to the PL6 0.x set. From a set older than PL5, the PL5 migrations apply first (`docs/phases/PL5-gate.md` §5). Then run `infrabyx-rls-lint`.
3. Settings and environment: nothing new since PL6. The only key added in PL6 is `hello.greeting.max_length`, which only the reference module reads.
4. Verify what you installed, as in section 6: `npm pack @infrabyx/<name>@1.0.0`, then `cosign verify-blob-attestation --type cyclonedx --bundle infrabyx-<name>-1.0.0.tgz.cdx.sigstore.json …`, with the bundle from that package's GitHub release.
5. Run your CI (the nine required checks) and deploy through your normal promotion. Renovate proposes later 1.x versions within the 7-day rule.
