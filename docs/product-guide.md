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
- **A timer per record (PR-UDF-035, PR-FBX-13 (1); R1-D-49).** Run `infrabyx-migrate` (`workflow/0003`). Register your kind with its handler first: `timers.on("udf.journey.abandon", async (ctx, t) => …)`. Kinds are `<product>.<area>.<name>` in lower case. Then, in the transaction that opens the record, call `timers.schedule(tx, "udf.journey.abandon", journeyId, at)`; cancel it with `timers.cancel(tx, journeyId, ["udf.journey.abandon"])`. References have 1 to 64 letters, digits, `_` or `-`. The handler runs as `svc_workflow_timers` in the timer's tenant, is retried with back-off up to 5 times, and must re-check the record's state and return `"stale"` when it moved on. Udofin can retire the daily idle-journey sweep (UDF-D-125); Finbyx can expire an external-access grant at its `valid_to` (AU7.2).

## 7d. Customer sign-in (one-time codes and DPoP)

End users who are not staff (borrowers, clients, parties) sign in with a one-time code in a **customer realm** of your product (R1-D-19). Never put customers in a staff realm.

1. **Run Keycloak with the extension.** Build `infra/keycloak/customer-otp` (`docker build -t <you>/keycloak-customer:26.8.1-1 infra/keycloak/customer-otp`) and run that image instead of the stock one. Apply the realm in your deploy job: `KeycloakCustomerIdentity.applyCustomerRealm({ baseUrl, masterAdmin, spec: { realm: "<product>-customers", apiClientId, adminClientId, audience, customerRoles: ["<P>_CUSTOMER"] } })`. It refuses a Keycloak without the extension. Keep the two client secrets it returns in SECRETS. On Zitadel, `ZitadelCustomerIdentity.applyCustomerOrg(...)` creates the customer organisation, application and login client.
2. **Wire the adapter.** Use `new KeycloakCustomerIdentity({ ..., store, replay, revocations, sender, customerRoles, settings })`:
   - `store` is a `PgCustomerAuthStore` (`connectors/0004`, applied by `infrabyx-migrate`);
   - `replay` is a `RedisReplayStore` on your Redis, so a proof replayed to another replica is refused. Build it with `RedisReplayStore.fromUrl(url, { password, prefix })` (PR-UDF-032, R1-D-47): the platform holds the Redis client, so you import none. Take the AUTH token from SECRETS, use `rediss://` above development and call `close()` on shutdown. A claim throws while Redis is down, so sign-in then fails closed. Udofin can end its 503 outside fixtures (UDF-D-119);
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
7. **Upgrade note.** Rebuild the image whenever the platform moves the Keycloak pin. It moved to the 26.8.1-1 rebuild on 30 Oct 2026 (R1-D-35): rebuild now, and run the IdP with the same digest (`keycloak/keycloak@sha256:a78d6b79…`) wherever you pinned 26.8.1. The rebuild clears one base-image finding; three remain waived until a Keycloak or UBI release carries their fixes (`infra/docker/trivyignore.yaml`), so carry the same waivers in your own image scan.
8. **Retention (#86).** Schedule `new CustomerSignInRetention({ store, settings }).sweep(tenantSweep)` daily (`connectors/0005`, R1-D-23). It deletes challenges 24 hours after they expire, guard counters once their lockout window ends, and devices 12 months after last use (`int.identity.customer.retention.*`). Call `forgetDevices` when a customer closes the account: it signs out and deletes every device at once. The database refuses to delete live state (restrictive policies keep a floor below the settings).
9. **Changing or retiring a login (PR-UDF-034, R1-D-51).** For a signed-in customer, call `startLoginChange({ tenantId, userId, channel, currentLogin, newLogin, dpopProof })`. It sends one code to each number; the new number must belong to no account. Then call `confirmLoginChange({ …, challengeId, oldCode, newCode, dpopProof })` with a proof by the same device key. The account keeps its id, devices and subject, and the old number can open a new account. When a number is reported recycled or an account closes, call `retireLogin({ tenantId, userId, channel, login })`: its devices are forgotten, the account is disabled and the number is free. Use the same NOTIFY class as sign-in codes. Udofin can retire its successor link (`borrower_idp_successor`, UDF-D-123).

## 7e. KYC and video calls

`KycPort` and `VideoMeetPort` are defined in `@infrabyx/contracts/ports` (R1-D-21). Build your flows on the interfaces, and test them with `FakeKyc` and `FakeVideoMeet` from `@infrabyx/testing`:

- Pass files as STORAGE references with their SHA-256. Store the evidence each result returns (`vendorRef`, `modelVersion`, `checkedAt`), and for V-CIP the manifest, in your ledgered records. Never store an Aadhaar number: results give its last four digits only.
- Create a V-CIP room with a REGULATED `RoomPolicy` (see `VCIP_ROOM_POLICY`): `participantCountries: ["IN"]`, your tenant's official networks, recording on to the tenant's target, `providerRetention: "none"`. Resolve each joiner's country and proxy status with your GEO check, and pass it to `joinToken`.
- Keep `kyc.vcip.enabled` off until the owner revisits per-tenant STORAGE routing to a tenant-owned bucket (#83, deferred to before Phase 6, which Finbyx has now passed) and Digio's account exists.
- **Digio** (`@infrabyx/connectors/kyc`, `DigioKyc`, R1-D-24) provides `digilockerPull` and `verifyAadhaarOffline`; every other method is `unsupported`, so routing picks another adapter for it. It is off (`int.kyc.digio.enabled`) and `unproven` until the owner's Digio account exists (#147). There is no KYC alternative yet (#91).
- **LiveKit** (the VIDEO_MEET reference, #88) is built under C-26 (#89; §7s).
- **V-CIP in your LiveKit room (M24, R1-D-55).** Build `new VcipConductor({ meet, scorer, store, enabled })` from `@infrabyx/connectors/kyc`: `meet` is your VIDEO_MEET, `scorer` is `kycMethodRouter` with Digio first and IDfy second for `liveness` and `face_match`, and `store` is your `VcipStore` table. Create the room with `VCIP_ROOM_POLICY`, then call `startVcip`. During the call the official calls `assess` with frames from the call, the document photo and the customer's geo-tag; only frames leave for the scorer. The official ends it with `complete({ by, decision })`: an approval needs both checks passed, the customer in India and a recording the provider does not keep, and a rejection needs a reason. Use `drop` when the call breaks. The manifest lists every artefact by hash. Only the session's official may act; keep the official's own sign-in and MFA on that action.

- **IDfy as the second KYC source (R1-D-45).** `IdfyKyc` provides `verifyPan`, `faceMatch` and `livenessCheck`; it is off (`int.kyc.idfy.enabled`) and `unproven` until the owner's IDfy sandbox exists. Give it the account id and API key from SECRETS and your tenant's face-match and liveness pass marks.
- **One KYC port, several vendors.** Wrap your adapters in `kycMethodRouter({ adapters: [digio, idfy], order: { pan: ["idfy-kyc"], digilocker: ["digio-kyc", "idfy-kyc"] } })` and use the result as your `KycPort`. A method goes to the first adapter in its order that has it; the next one is tried only when the first is off, unavailable or lacks the method. A customer-level refusal is final.
- **Finbyx (PR-FBX-24).** Replace the "missing methods are refused above staging" shim with the router: Digio first for DigiLocker and Aadhaar offline, IDfy for PAN, face match and liveness. Keep both vendor flags off until the owner's accounts exist.

## 7f. Books of account: statutory capture, branches and external auditors

For the Companies Act audit trail on books of account (PR-FBX-10), use the database-level capture rather than an application log (R1-D-25):

```sql
-- in a product migration, run by the database owner after infrabyx-migrate (audit/0003)
select audit.register_capture('books.journal_line');
```

- The table needs `tenant_id` and forced RLS. From then on every insert, update and delete is captured with its before and after values, the actor, branch, trace, action and reason from the kernel, the database login and role, the transaction id and the time, in a per-tenant hash chain. Nothing in the application can switch it off, and a registered table cannot be dropped or have its triggers removed.
- Pass `{ action, reason }` to `kernel.mutate` for corrections, so the reason is captured.
- Schedule `auditSweep.verifyCaptureAll()` daily with the other per-tenant jobs and alert on `broken`; auditors read the trail with `StatutoryCapture.query`, and the daily anchor signs its head.

**Branches (R1-D-26).** Build the context with `branchId` (the branch of this change), `branchIds` (the branches the user may see) or `allBranches` (head office). Add `and tenancy.branch_allowed(branch_id)` beside the tenant condition in each branch-scoped table's policy (`tenancy/0007`). It denies by default. The ledger and the capture record the branch.

**External auditors and inspectors (R1-D-29).** An ORG_OWNER or ORG_ADMIN requests an external grant with `ExternalGrants.request` (grantee, kind, purpose, entities, branches, period, days); a different one approves it. Then:

```sql
grant select (id, entity_id, branch_id, booked_on, amount) on books.journal_line to app_external;
create policy journal_line_external on books.journal_line as restrictive for select to app_external
  using (tenancy.external_allows(entity_id, branch_id, booked_on));
```

- Serve the grantee's requests with `new ExternalReads({ kernel, audit }).read(externalContext(tenantId, granteeId, grantId), "books.journal_line", sql)`. Each read is ledgered; a revoked or expired grant is refused (`IPB-TRUST-003`). rls-lint fails a table `app_external` can read without the restrictive policy.

## 7g. Idempotent API calls and break-glass notices

- **`Idempotency-Key` (IPB-10-07, R1-D-27).** Register `IdempotencyKeyInterceptor` (`@infrabyx/tenancy/nest`) on your API. In each POST or PATCH handler, wrap the change: `kernel.mutate(ctx, (tx) => idempotent(tx, req.idempotency, work, { audit }))`, where `work` returns `{ status, body }`. A replay returns the first response; another body under the key is 409. Schedule `new IdempotencyExpiry({ kernel, audit }).sweep(tenantSweep)` daily (`tenancy/0008`).
- **Services that open their own mutation (PR-UDF-033, PR-FBX-21; R1-D-48).** Use `kernel.ambient(ctx, (tx) => idempotent(tx, req.idempotency, work, { audit }), { action })` in place of `kernel.mutate`. Every `kernel.mutate` your services and the platform's engines make inside `work`, on the same `PgKernel`, then joins that transaction in a kernel savepoint. Each joined call keeps its own action, reason and ledger check. A joined call that throws rolls back alone, and the handler decides. Joined calls must be the same tenant and person, and run one at a time (no `Promise.all`). Reads keep their own read-only transaction, so they do not see the handler's uncommitted writes. Run `infrabyx-migrate` (`tenancy/0015`): keys now belong to the person who first used them. `IdempotencyKeyInterceptor` hashes the route parameters too, so a request in flight across the upgrade may get 409 instead of a replay.
- **Udofin and Finbyx.** Udofin can retire `AmbientKernel` (`apps/api/src/ambient-kernel.ts`) and its principal-in-hash shim (UDF-D-122). Finbyx can retire `FbxKernel`'s first-mutation claim, `respondFrom` and `IdempotentScope`'s path re-hash (PR-FBX-21).
- **Break-glass in your tenants (R1-D-28).** Every use of a platform break-glass grant on a tenant is recorded there (`tenancy/0009`). Schedule `new BreakGlassTenantNotices({ kernel, audit, outbox, product }).sweep(tenantSweep)` every few minutes; on `BreakGlassUsed`, notify the tenant's administrators. Show `list` on the tenant's security page.

## 7h. The application shell: search, workspaces, saved views and page templates

For the shared shell parts of PR-FBX-09 (R1-D-32), use the platform's components and store, and keep only your catalogue and copy:

- **Search and the palette (IPB-07-17).** Post the query (never put it in a URL) to a server action that calls `globalSearch(q, ctx, providers)` from `@infrabyx/ui/search`. Write one `SearchProvider` per source: navigation (`staticProvider` over your filtered menu), settings, shortcuts, then each module's SEARCH index. Each provider returns only what the caller may open. Run `checkQuery` in the browser before sending. Log only `paletteEvent(result)`. Render `CommandPalette` with the result, and bind Ctrl+K in your `ShortcutRegistry` to focus `#palette-query`. A PAN lookup for `kyc.search_by_pan` is a KYC screen of your own; the palette refuses PANs for everyone.
- **Workspaces.** Keep the catalogue and the role or membership map in the product. Pass the assigned workspaces, each with the route that records the choice, to `resolveWorkspace(assigned, cookie)` and `WorkspaceSwitcher`.
- **Saved views and columns (IPB-07-13).** Run `infrabyx-migrate` (`config/0002`). Build `new SavedViews({ kernel, audit, settings })`. Pass the caller's verified team ids as `viewer`. List with `list` and `defaultView`, save with `save`, and keep the column chooser with `layout` and `setLayout`. Render `SavedViewPicker`, `ColumnChooser` and `DataTable` with `applyColumns(columns, layout.columns)` and `density`. Sharing with roles or the tenant is for ORG_ADMIN or ORG_OWNER, and the tenant setting `ux.tables.saved_views_shared` switches it off. A filter holding an Aadhaar number, card number or PAN is refused (`IPB-UX-003`).
- **Pages.** Build list, detail, wizard, approval-queue and dashboard screens on `ListPage`, `DetailPage`, `WizardPage`, `ApprovalQueuePage` and `DashboardPage`, with a `PageState`: `empty` (the purpose sentence from your `hlp.` entry, the first action, a tutorial), `loading` (a skeleton), `error` (what failed, whether it saved, the trace id, a retry) and `denied` (the code, the reason, the screen that fixes it). Every dashboard widget names its evidence class and source.
- **Keyboard map (IPB-06-29).** Render `KeyboardMap` at `Settings › Accessibility › Keyboard shortcuts` from `registry.list()`, each entry tagged with its group.

## 7i. Searchable sealed values: blind-index keys (PR-FBX-25)

- **The key (R1-D-37).** Put one root key per environment in SECRETS at `blindIndexSecretPath(appEnv, product)` (`secrets/<env>/kms/blind-index/<product>`): 32 random bytes, hex or base64url (`generateWebhookSecret()` makes one), with integer versions (`1`, `2`, …). At start-up, `loadBlindIndexRoot(secrets, { appEnv, product })`; below staging use `localBlindIndexRoot()` instead. Build one `BlindIndexer({ product, scope, current })` per indexed field (`scope` such as `cif` or `pan`).
- **Writing and searching.** Store `index(tenantId, value)` as two columns: the value and its version. Search with `candidates(tenantId, value)` (`where (bi, bi_v) in (…)`). Index only high-entropy identifiers (PAN, Aadhaar reference, account numbers), never a date of birth or a pincode.
- **Rotation.** Write a new version of the secret, then build the indexer with `current` the new root and `previous` the old one. Run a batched, idempotent re-index over rows where `needsReindex(row)` (decrypt, `index`, update), then drop `previous`.
- **In AWS (owner answer #94, R1-D-57).** Keep the root in a Secrets Manager secret encrypted with a customer-managed KMS key. Only the runtime role may read it (`secretsmanager:GetSecretValue` and `kms:Decrypt` on that key, nothing broader). Rotate it yearly by the steps under Rotation. A KMS-backed HMAC is revisited before the second tenant goes live.
- **Finbyx.** The label `<product>/<scope>/v<n>/<tenant>` equals the shim's `fbx/cif/v1/<tenant>`, so existing local indexes stay valid. Replace the shim with `BlindIndexer`, and lift the refusal above staging once the secret exists.

## 7j. Consent to your own purposes (PR-FBX-26)

- **Purposes and notices (R1-D-38).** Run `infrabyx-migrate` (`consent/0003`). Build `new PurposeConsents({ kernel, audit, product, outbox, purposes })` with your purposes in code (`fbx.kyc.processing`, `fbx.kyc.ckyc_download`, …). Each tenant writes its notice per purpose and language: an ORG_OWNER, ORG_ADMIN or ORG_MAKER calls `draftNotice`, and a different ORG_OWNER, ORG_ADMIN or ORG_CHECKER calls `approveNotice`. A change is a new version; `retireNotice` stops offering one.
- **Recording.** Show `currentNotice(ctx, purpose, language)`, then `grant(ctx, { subjectRef, purpose, noticeId, method })` with the id of the notice shown. `withdraw` must be as easy as giving consent. Gate every processing step on `consentState(ctx, subjectRef, purpose)?.granted`. Use your customer id as `subjectRef`, never a PAN or Aadhaar number.
- **Finbyx.** Replace `kyc.consent` and the draft notices in `kyc/notices.ts`. Existing rows can be imported with `method: "IMPORT"` once each notice text is approved in the tenant.

## 7k. Named tenant functions (PR-FBX-20)

- **Functions (R1-D-39).** Run `infrabyx-migrate` (`tenancy/0011`). Build `new TenantFunctions({ kernel, audit, approvals, functions: ["FN:PRINCIPAL_OFFICER", …] }).register()`. After verifying the token, call `ctx = await functions.withFunctions(ctx)` once per request. Assign through `requestAssign` (an ORG_OWNER or ORG_ADMIN; a different one approves in the approvals queue), list with `assignments` and end with `revoke`. Require a function on an action with `engine.register(action, { checkerFunctions: ["FN:CRO"] })`; a tenant can add `FN:` entries to `mc.checker_roles.<action>`.
- **Finbyx.** The CRO vets a product (`checkerFunctions: ["FN:CRO"]`) and the CCO approves it (`["FN:CCO"]`). This replaces the "any checker" shim of OWNER-QUESTIONS #20. The executor's three-different-people rule stays in Finbyx.
- **Officers per legal entity (PR-FBX-31, R1-D-46).** Run `infrabyx-migrate` (`tenancy/0013`, then the no-transaction `0014`). Pass `policies: { "FN:CRO": OFFICER_POLICY, "FN:CCO": OFFICER_POLICY, "FN:COMPLIANCE_OFFICER": OFFICER_POLICY }`. Then `requestAssign` needs `entityRef` (your legal entity id, which must be in the person's membership `entity_ids` when that list is set) and `registerRef` (your officer-register row). Only one person holds each function per entity. Set `ctx.entityId` before `withFunctions`, so the function counts only in its entity. Give AUTHZ `principal.attr.functions` from `authzAttributes(ctx)`. End an officer with `requestRevoke` (a second person approves); `revoke` is refused for these functions. To stop a compromised officer at once, suspend their sign-in while the request waits.
- **Finbyx.** `org.compliance_officer` (migration 0065, `modules/org/compliance.ts`) can move onto `FN:COMPLIANCE_OFFICER` with `registerRef` naming the `org.entity_officer` row. The executor's check for the write-off policy confirmation (#66 (b)) then reads `FN:COMPLIANCE_OFFICER` from the session. That closes PR-FBX-31 (P9-25).

## 7l. External grants from your own approvals (PR-FBX-22)

- **External grants from your register (R1-D-40).** Run `infrabyx-migrate` (`tenancy/0012`). In the executor of your own approved access request, call `grants.fromApproved(tx, { …grantee, kind, entityIds, branchIds, periodFrom, periodTo, days, piiLevel, exportAllowed, sourceApprovalId, makerId, checkerId })`, and `revokeFromApproved(tx, sourceApprovalId, by)` when your register revokes. Map your grantee types onto the six kinds. In restrictive policies or views, read `tenancy.external_pii_level()` to choose masked or clear columns. Gate exports on `tenancy.external_export_allowed()`. External reads still go only through `ExternalReads`.
- **Finbyx.** AU7 (P2-D9) can move from `app_ro` to `app_external`, keeping its CCO-or-nominee maker, its CISO or MD & CEO checker and its second approval for full PII or export. That closes PR-FBX-22 and Finbyx OWNER-QUESTIONS #24.

## 7m. Retention you can only extend (PR-FBX-27)

- **Writing (R1-D-42).** Write a recording or any record under a retention date with `storage.putWithRetention(key, body, retainUntil, meta)`. That is one single-part write with the COMPLIANCE lock and a SHA-256 checksum, so an encrypt-only tenant key is enough.
- **Extending.** Call `storage.extendRetention(key, laterDate)` when a hold or a longer floor applies; an earlier date is refused (`IPB-STOR-003`). Read the current date with `retentionOf(key)`.
- **Proving.** `assertImmutable(key)` checks the lock and the stored checksum without reading the body. Finbyx can replace `kyc/retention.ts`'s write path with these calls.

## 7n. Batches in one transaction (PR-FBX-30)

- **Units (R1-D-41).** Inside `kernel.mutate`, run each item as `await tx.unit!(async (u) => { …; await audit.record(u, …) })`. A failed item returns `{ ok: false, error }` and rolls back alone, with its ledger entries and outbox rows; the others stay. Do not issue `SAVEPOINT` yourself.
- **One entry per step.** After the step, call `sink.recordBatch(tx, { action, run, step, resourceType, resourceIds })` with the ids that succeeded, up to 100,000. Run `infrabyx-migrate` (`audit/0005`). `verifyBatch(tx, ledgerId)` proves the member list later.
- **Finbyx.** COB pass A can group loans into transactions of a few thousand units each, instead of one transaction per loan. Keep a per-loan entry where the loan's own history needs one; use the batch entry for the step.

## 7o. Credit bureaus and Account Aggregators (PR-FBX-28)

- **Interfaces now, adapters later (R1-D-43, ADR-0003).** The ports are IPB-01's `BUREAU` and `AA_FIU`. Build your bureau and AA flows on `CreditBureauPort` and `AccountAggregatorPort` from `@infrabyx/contracts/ports`, with `FakeCreditBureau` and `FakeAccountAggregator` from `@infrabyx/testing` below staging. Above staging, refuse with `IPB-PORT-001` until a platform adapter lands; vendor adapters wait for the owner's sandbox accounts.
- **Consent first.** Record the customer's consent with `PurposeConsents` (§7j) before every pull or AA consent request, and pass its receipt id as `consentRef`; a pull without one is refused. Choose `soft` for pre-qualification and `hard` only for an application.
- **Storage, not payloads.** Pass a `reportPrefix` or `dataPrefix` under the tenant's own prefix. Keep the returned STORAGE reference and SHA-256 with the application, and read the normalised summary (amounts in integer paise) for the BRE. Read a `pending` pull back with `status` or through its webhook.
- **Finbyx.** Replace `los/ports.ts`'s shim ports and fixture adapters with these interfaces and fakes; run `creditBureauContractCases` and `accountAggregatorContractCases` against any adapter you build meanwhile.

## 7p. An index on an existing table (PR-UDF-031)

- **No-transaction files (R1-D-44).** Put `-- infrabyx:no-transaction` on the first line, then `SET lock_timeout` and a `statement_timeout` long enough for the build, then `CREATE [UNIQUE] INDEX CONCURRENTLY IF NOT EXISTS …`. `infrabyx-migrate` sends each statement on its own. The file is not atomic: keep it to the index builds, and if a run fails, check `pg_index.indisvalid` and drop an invalid index with `DROP INDEX CONCURRENTLY IF EXISTS` before the next run.
- **Udofin.** Uniqueness can move back onto the existing table; `u03_identity.borrower_idp_link` (UDF-D-113) may stay as it is.

## 7q. CAPTCHA and device attestation (PR-UDF-029, PR-UDF-028)

- **CAPTCHA (R1-D-50, ADR-0004).** Build `new TurnstileCaptcha({ enabled, secret })` from `@infrabyx/connectors/captcha`, with the secret from SECRETS (`secrets/<env>/captcha/turnstile/secret_key`). Wrap it in `new CaptchaGate({ captcha, underAttack })`, reading `int.captcha.under_attack`. Render the widget when `gate.required()` is true, in Turnstile's managed or invisible mode (no puzzle, IPB-06-40). In the handler, call `await gate.check({ token, expectedAction, expectedHostname })`; it refuses with 429 IPB-SEC-019 while the switch is on. Send the vendor nothing but the token. Turn on `int.captcha.turnstile.enabled` once the owner's site key and secret exist; `HCaptchaCaptcha` is the alternative.
- **Device attestation.** Build your device registration on `DeviceAttestationPort` from `@infrabyx/contracts/ports`, with `FakeDeviceAttestation` from `@infrabyx/testing` below staging. Bind each check to a nonce your server issued or to the DPoP key's `jkt`. Keep the `AppAttestKeyRecord` with the device and store the returned counter. The Google and Apple adapters wait for OWNER-QUESTIONS #99; until then, keep failing closed above test fixtures.
- **The `native` adapter (#99, R1-D-59).** Build `new NativeDeviceAttestation({ replay, keys, playIntegrity, appAttest })` from `@infrabyx/connectors/device-attestation`. Its options:
  - `replay`: a shared `ReplayStore` such as `RedisReplayStore`;
  - `keys`: your device table's `has` and `add` for App Attest key ids;
  - Play Integrity: the service-account key from SECRETS (`secrets/<env>/device_attestation/play_integrity/service_account_key`, scope Play Integrity only) and your signing-certificate digests per package;
  - App Attest: nothing to configure. Apple's root is pinned.

  The app passes your nonce or DPoP `jkt` as Play Integrity's `requestHash`, and as the App Attest challenge (the client data it hashes). Turn on `int.device_attestation.play_integrity.enabled` and `int.device_attestation.app_attest.enabled` once the owner's Google Cloud project and Apple account exist. Keep the returned `AppAttestKeyRecord` and store each new counter.

- **Udofin.** Replace the product-local CAPTCHA port of UDF-D-111 and UDF-D-124 with these, and mark PR-UDF-029 met. PR-UDF-028 is met by the `native` adapter (R1-D-59): replace UDF-D-124's product-local port with it, off until the owner's accounts exist.

## 7r. Stamps, documents, payouts and mandates (PR-FBX-29)

- **Interfaces now, adapters later (R1-D-52).** Build on `EstampPort`, `PayoutsPort`, `DocgenPort`, `PdfPort` and `MandateLifecycle` from `@infrabyx/contracts/ports`. Use `FakeEstamp`, `FakePayouts`, `FakeMandates`, `FakeDocgen`, `FakePdf` and `FakeEsign` from `@infrabyx/testing` below staging. Above staging, refuse with `IPB-PORT-001` until a platform adapter lands. The payout adapter waits for the pilot lender's disbursement bank; the mandate and DDE adapters are in §7x, off (OWNER-QUESTIONS #100).
- **Money-moving calls.** Run the action through your maker-checker first. Pass its approved request as `authorisation.approvalRef`, with the person or service that executes it, an idempotency key derived from that request, and the amount in paise. Never call these from an agent. Book a disbursement only when `getStatus` (or the webhook read-back) says `settled`, and keep the UTR and value date.
- **Documents.** Every input and output is a STORAGE key with its SHA-256 under your tenant prefix. `renderHtml` replaces an HTML-to-PDF shim, and `PdfPort.toPdfA` gives archival copies. NeSL DDE runs after the stamp: `purchase`, then `ddeRegister` with the certificate, then `ddeDownloadExecuted` once every executant has signed.
- **Finbyx.** Replace `dms/ports.ts` and `dsb/ports.ts` (`EstampPort`, `DdePort`, `PayoutPort`, `MandatePort`, `DocumentRenderPort`) and the `FakeEsign` shim with these interfaces and fakes. The signing evidence of P8-D5 reads `espTransactionId` and `signerIp` from `SignatureRecord`.

## 7s. Video calls on LiveKit (M15)

- **Running it (R1-D-53).** Run LiveKit self-hosted in India with its egress worker. Keep its API key and secret (≥ 32 random bytes) in SECRETS, one per deployment. Locally, `pnpm dev:up -- --profile video` starts it on loopback. Turn on `int.video_meet.livekit.enabled` only once your server runs.
- **Rooms and joins.** Create rooms through the VIDEO_MEET port from `@infrabyx/connectors/video-meet` with a `RoomPolicy`, and provide a durable `LiveKitRoomStore`. Pass the caller's resolved origin to `join`. Tokens last at most 300 s for one room and one identity, so issue one per join.
- **Recordings.** Give REGULATED rooms a recording target in the tenant's STORAGE. Each recording is written once, locked and checksummed, and the egress disk copy is removed; keep the manifest with the case.
- **Webhooks.** Route LiveKit webhooks to `handleWebhook` with the raw body and the `Authorization` header; anything unsigned or foreign is refused.

## 7t. SMS and WhatsApp template variables (PR-UDF-025)

- **Name the order (R1-D-54).** In your notification catalogue, list each SMS template's variables in the DLT template's order: `templates.sms.vars: ["reference", "re_name", "help_link"]`; do the same for `templates.whatsapp.vars`. A notification missing one of them fails its delivery instead of sending the wrong text. Without a list, names sort naturally, so `v01`, `v02` (Udofin's UDF-D-97 shim) keep working; Udofin can return to named variables.

## 7u. Many writers per tenant: chain lanes (PR-FBX-32)

- **What changes (ADR-0005, R1-D-58).** Run `infrabyx-migrate`: `audit/0006` (briefly locks `audit.ledger` and `audit.capture`; run it in a quiet window), then the no-transaction `audit/0007`. A tenant's ledger and statutory capture become 32 lanes each. Up to 32 of a tenant's transactions now append at once, so more workers raise throughput. Each tenant's existing chains continue as lane 0 at its first write after the upgrade.
- **`seq` is no longer a count.** It is a global sequence: unique, increasing within a lane, with gaps. Count entries with `count(*)`. Page with a snapshot read (`kernel.read(ctx, fn, { snapshot: true })`), not by `afterSeq` across transactions. Order a lane by `lane_seq`.
- **Verifying.** `verify`, `verifyCapture` and the sweeps follow each lane and compare its end with the stored lane head. A break names its `lane` and `laneSeq`. Anchors are format 3: every lane head of both chains, under `head_hash` and `capture_head_hash` as roots. `verifyAgainstAnchor` and `verifyCaptureAgainstAnchor` accept formats 1 to 3.
- **Exports.** The reference map is `REF-EXPORT-1.4`: `audit_event` carries `lane` and `lane_seq`, and the archive's `verify.mjs` checks the trail lane by lane. A product map that exports `audit.ledger` adds both fields in its own minor bump.
- **Keep each transaction's writes in one order.** Write the change first, then its ledger entry. A transaction holds one ledger lane and one capture lane until it ends.
- **More lanes.** If you run more concurrent writers than lanes, raise them in your own migration: `select audit.set_chain_lanes('ledger', 64); select audit.set_chain_lanes('capture', 64);`. Lanes are never lowered.
- **Finbyx.** COB can claim partitions with several workers and batch loans per transaction with `tx.unit` and `recordBatch` (§7n). See `docs/adoption/finbyx.md`.

## 7v. Temporal 1.25.0 and two transitive fixes (R1-D-60)

- **Temporal.** `@infrabyx/connectors` now pins `@temporalio/*` 1.25.0 (core-bridge with Rust `zip` 9.0.5). Move every `@infrabyx/*` together and drop any SEC-01 override of your own that raised Temporal (Finbyx PR-FBX-14); your image scan then clears CVE-2026-115905, -115907, -115908 and -115909.
- **body-parser and multer.** express 5.2.1 still resolves body-parser 2.3.0, and `@nestjs/platform-express` 11.2.x pins multer 2.4.0. Add the same overrides as the platform's `pnpm-workspace.yaml` (`body-parser@2.3.0: 2.4.0`, `multer@2.4.0: 2.5.0`) until their parents carry the fixes, then drop the waivers for CVE-2026-111181 and CVE-2026-113872.

## 7w. The first bureau and AA adapters (owner answer #97)

- **What exists (R1-D-61).** `CibilBureau` from `@infrabyx/connectors/bureau` (TransUnion CIBIL) and `SetuAccountAggregator` from `@infrabyx/connectors/aa-fiu` (Setu FIU). Both are built against stubs, off behind `int.bureau.cibil.enabled` and `int.aa_fiu.setu.enabled`, and `unproven` until the owner's sandboxes exist. Keep using the fakes (§7o) until then.
- **Wiring.** Pass your tenant's STORAGE, the credentials from SECRETS (`secrets/<env>/bureau/cibil/member_id` and `api_key`; `secrets/<env>/aa_fiu/setu/client_id`, `client_secret` and `product_instance_id`) and a small durable store: CIBIL's `pulls` (keyed by the pull id) and Setu's `consents` (keyed by the consent id). Read the flags on every call, as the adapters do.
- **CIBIL.** A pull for another CIC is refused; route Experian, Equifax and CRIF to their adapters when they come. A `pending` pull completes through `status` or the webhook; route CIBIL's event to `handleWebhook` with the raw body, and keep the result, not the event.
- **Setu.** Show the customer the page from `approvalUrl(consentId)` after `requestConsent`. `fetch` polls the data session a few times and may answer `PENDING`; ask again later under the same consent. Revoking some FI types stops the platform fetching them; revoking all revokes at Setu.
- **Finbyx.** Swap `FakeCreditBureau` and `FakeAccountAggregator` for these only above test environments, once the owner turns the flags on after the sandbox legs pass.

## 7x. Mandates on Digio and NeSL DDE (owner answer #100)

- **Off until the accounts exist (R1-D-62).** `DigioMandates` (`@infrabyx/connectors/payments`) and `NeslDde` (`@infrabyx/connectors/estamp`) are built against stubs and `unproven`. Keep `int.payments.digio_mandate.enabled` and `int.estamp.nesl_dde.enabled` off until the owner's Digio mandate account (with the sponsor bank's configuration) and NeSL account exist and their sandbox legs pass.
- **Mandates.** Wire `DigioMandates` as PAYMENTS' `MandateLifecycle` beside your payment aggregator. Give it a durable `MandateKeyStore` (one row per idempotency key: request digest, mandate id, claim time) and a `debtor` resolver that turns your `customerRef` and verified `debtorAccountRef` into the name, e-mail or mobile, account number, IFSC and account type. Nothing it resolves is returned or stored. Route Digio's callback, with `ipb_token` on its URL, to `handleWebhook`; it returns the mandate read back from Digio. eNACH (net banking, debit card, Aadhaar) and UPI AutoPay only.
- **Money calls (R1-D-52).** As in §7r: your maker-checker first, then `registerMandate` or `cancelMandate` with the approved reference, the initiator and an idempotency key derived from that request; amounts in paise. An `in_flight` answer means the first call's outcome is still unknown: ask again later with the same key, never a new one.
- **The approval the adapter consumes (R1-D-66; `contracts`, `tenancy`, `connectors` minors).** Raise each mandate's maker-checker request on `MANDATE_APPROVAL_ACTION` (`payments.mandate.change`, from `@infrabyx/contracts/ports`) at R3 or above, with exactly a `MandateApprovalSubject` as its payload: `{ operation: "register", mandate: <the registration's idempotency key>, maxAmountMinor }`, or `{ operation: "cancel", mandate: <the mandate id>, maxAmountMinor: <its current ceiling> }`. The engine registers the action itself and never executes it on approval; you may narrow its checkers with `register(MANDATE_APPROVAL_ACTION, { checkerRoles })`. Pass `DigioMandates` `approvals: engine.mandateVerifier((tenantId) => <your service principal's context in that tenant>)` and `tenantId: () => <the call's tenant>` (both required). The adapter has the engine consume the approval before Digio is called; any refusal (`IPB-UX-004` with `meta.reason`: `not_found`, `consumed`, `not_approved`, `other_mandate`, `other_amount`, `other_operation`, `risk_class`, `expired`) sends nothing. A retry that reads the first mandate back consumes nothing; a call that must be made again after an unknown outcome or a vendor failure needs a fresh approval. In tests use `MemoryMandateApprovals` from `@infrabyx/testing` (`acceptAny` only for the shared contract cases).
- **DDE.** Register the stamped PDF with its certificate (`ddeRegister`), follow `ddeStatus` or the callback (`handleDdeWebhook`), then `ddeDownloadExecuted` once every executant has signed. Give it a durable `DdeRecordStore`. Stamp duty is not bought through this adapter.

## 7y. Creating a tenant for a provisional id (PR-LDC-12; R1-D-67)

- **`TenantBootstrap` (`@infrabyx/tenancy`; `tenancy` and `config` minors).** Construct it with your kernel, audit sink, `APP_ENV` and your `SettingsService` (for initial settings). `bootstrap(platformCtx, { tenantId, product, name, residency?, orgId?, planRef?, brandId?, settings?, onCreated? })` creates the `tenancy.tenant` row, writes each initial tenant-tier setting through `SettingsService.setInitial` (validated, tighten-checked and ledgered as `set` is; a setting under maker-checker is refused, so set it once the tenant exists), runs `onCreated(tx)` for your own first rows, and writes the tenant's first ledger entry (`tenancy.tenant.bootstrap`), all in one transaction with RLS on. Settings you do not pass resolve to their registry defaults.
- **Idempotent per provisional id.** The same request again returns `{ created: false }` and writes nothing but a `tenancy.tenant.bootstrap.replay` entry; another request under the id is refused.
- **Where it runs.** `platformCtx` is a platform context with a PLT_* role (the kernel checks it). `bootstrap` is refused in `prod`, `dr` and `pre-prod` (`IPB-SEED-001`, the seed rule PL1-D-06): use it for local, test and trial environments and replace your tests' direct tenant inserts with it. In every environment the Operations Hub provisioning adapter (§7z) calls `provision`, the same path, after verifying the signed `TenantProvisioned`; its ledger entry names the provisioning request.

## 7z. Tenants from the Operations Hub (PR-LDC-11; R1-D-68)

- **`OperationsHubProvisioning` (`@infrabyx/connectors/provisioning`; `connectors`, `contracts` minors).** It consumes the signed `TenantProvisioned` (Ecosystem Spec §6.29) and creates the tenant through `TenantBootstrap.provision` (§7y), once per `provisioning_request_id`. Give it your module's Ecosystem inbox (a migration with `select tenancy.create_ecosystem_inbox('<schema>')`), a `TenantBootstrap`, a platform context with a PLT_* service principal, your product code, this deployment's environment (`SANDBOX`, `UAT` or `PRODUCTION`), the Hub's pinned signing keys (`RegulatedKeyRing`) and a durable `ReplayStore`, a `proofs.save(eventId, jws)` that keeps the JWS beside the event, and `onProvisioned(tx, tenant)` for your own first rows (it runs in the tenant's creation transaction, so it commits or rolls back with the tenant).
- **Receiving.** Call `receive(event, jws)` from your webhook route and answer 2xx only when it returns. It refuses (`IPB-API-005` with `meta.reason`, or `IPB-API-018` for the JWS) an event not from the Hub, of another type, product or environment, with a JWS that does not verify or was replayed, a PRODUCTION request without the MSA, DPA and OUT clause-matrix refs (`regulatory-guard`), and a first-admin email without `legalbasis = CONTRACT_PERFORMANCE_VENDOR`. A second event for the same request is acknowledged as `business_duplicate` and never processed.
- **Processing.** Run `drain()` from your worker (as for any inbox). The tenant id is the request's `provisional_tenant_id` when the Hub sends it (PR-040, v1.3), else one derived from the request id, the same on every retry. A failing `onProvisioned` rolls the tenant back and the inbox retries it. Report `READY` to the Hub by `PUT /v1/provisioning-requests/{id}` yourself. LawDocsComply replaces its inbox `TenantProvisioned` consumer and `TrialService.provisionIn` with this.

- **Asking the Hub for a tenant (Spec v1.3; R1-D-70).** Give the adapter `outbox: { writer: new PgOutbox(), schema: "<your schema>" }` (a module outbox registered for the relay), `signer: { kid, sign }` (your ecosystem signing key in KMS) and `onFailed`. In your sign-up's own ledgered transaction in the provisional tenant (`tnt_` + ULID), call `request(tx, { provisionalTenantId, planId, modules, homeCell, orgName, orgRef?, consentRef, firstAdminEmail? })`: it writes `ProvisioningRequested` to your outbox and returns the request id (a UUIDv7; pass `provisioningRequestId` to resend the same request, which is then a no-op; the same id with another payload is refused with `IPB-PORT-004`). In the relay's `deliver`, call `signForDelivery(event)` and send the JWS with the event (the JWS lives 5 minutes, so it is made at delivery). Hold at most one live provisional id per org reference or work-email domain, product and environment (Spec v1.3).
- **When the Hub refuses (Spec v1.3).** `receive` also takes `ProvisioningFailed` (the same checks as `TenantProvisioned`; personal data in `detail` and a `retryable` that contradicts the reason are refused), and `drain` calls `onFailed(tx, failure)` once per request with `reasonCode`, `retryable`, `failedAt` and `purgeBy` (`failedAt` + 30 days). One request has one outcome: whichever of `TenantProvisioned` and `ProvisioningFailed` is stored first wins, and the other is acknowledged as `business_duplicate` (log it as a conflict). By `purgeBy`, purge the provisional tenant's rows and its first-admin contact data, ledgered, unless a retry under a new request id is open (Spec v1.3 retention rule; DPDP Act 2023 s.8(7)). LawDocsComply then retires its own outbox `ProvisioningRequested`.

## 7aa. Per-tenant templates and delivery reports by vendor reference (PR-FBX-33, PR-LDC-15; R1-D-69)

- **Per-tenant templates (`notify`, `contracts` minors).** Pass `templates: (ctx, cls, channel, locale) => …` to `NotifyService`. NOTIFY calls it at every delivery, `dispatchDue` included, in the delivering tenant's context. Return `{ channel: "sms", dltTemplateId, senderId, dltEntityId, vars? }`, `{ channel: "whatsapp", name, lang, vars? }` or `{ channel: "email", key }` to use the tenant's own template; `undefined` to use the catalogue's; `null` to fail that delivery closed (nothing is sent, the delivery is `failed` with `IPB-PORT-001`, reason `template_missing`; IPB-04-28). `vars` is the template's positional order, as in the catalogue (PR-UDF-025). Finbyx removes its AsyncLocalStorage `TenantSms` and `TenantEmail` wrappers and can turn WhatsApp on.
- **Delivery reports by vendor reference.** A vendor webhook carries no tenant. Call `routeEmailEvents(adapter, events)`, `routeSmsReports(adapter, reports)` or `routeWhatsappEvents(adapter, events)` after verifying the webhook. The dispatcher's service reader finds each reference's tenant (ledgered in every tenant it read) and the reports are applied there, bounces and complaints still suppressed platform-wide. They return `{ routed, unknown, ambiguous }`: a reference no delivery of that channel and adapter carries is dropped and counted, and so is one found in two tenants. Run `infrabyx-migrate` for `notify/0003` (a column grant and a concurrently built index). LawDocsComply's deliveries then move past `sent`.

## 7ae. Reacting once to an approved setting change (PR-LDC-18; R1-D-74)

- **No new API.** Give `SettingsService` its `outbox` option (`config.outbox`, registered for the relay). Every committed change of a TENANT, ENTITY or PLATFORM key then writes `in.<product>.settings.SettingChanged.v1` (`key`, `tier`, `scope_id`, `old`, `new`, `actor`, `mc_request_id`) in the change's own transaction, so a rejected or expired approval writes nothing, and an approved one writes exactly one event, carrying its approval request id. USER changes write `UserPreferenceChanged` instead.
- **Consuming it.** The outbox relay delivers each event at least once to your queue; consume it with `PgInbox.firstSeen(tx, schema, consumer, eventId)` in your handler's transaction, so each change is acted on once. LawDocsComply then stops polling its own change history.

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

## 9. Adopting the 3 November 2026 release

The release after version PR "chore: version packages" of 3 November 2026 carries §7c to §7t's latest steps, and §7g's `kernel.ambient`. Its versions are `contracts` 1.15.0, `tenancy` 1.9.0, `connectors` 1.5.0, `crypto` 1.4.0, `config` 1.6.0, `workflow` 1.2.0 and `testing` 1.5.0, with patches for the rest; STATUS keeps the release record.

1. Move every `@infrabyx/*` dependency together.
2. Run `infrabyx-migrate --require-all`. The new migrations are `workflow/0003` and `tenancy/0013` to `0015`; `0014` is a no-transaction file (§7p). Products further behind also take `consent/0003`, `audit/0005` and `tenancy/0011` and `0012`.
3. Retire the shims your adoption note lists:
   - Finbyx: `docs/adoption/finbyx.md`;
   - Udofin: `docs/adoption/udofin.md`;
   - LawDocsComply, which installs for the first time: `docs/adoption/lawdocscomply.md`.

New settings keys, all off by default: `int.captcha.under_attack`, `int.captcha.turnstile.enabled`, `int.captcha.hcaptcha.enabled`, `int.kyc.idfy.enabled` and `int.video_meet.livekit.enabled`. No new environment variable.
