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

1. **Run Keycloak with the extension.** Build `infra/keycloak/customer-otp` (`docker build -t <you>/keycloak-customer:26.8.1-2 infra/keycloak/customer-otp`) and run that image instead of the stock one. Apply the realm in your deploy job: `KeycloakCustomerIdentity.applyCustomerRealm({ baseUrl, masterAdmin, spec: { realm: "<product>-customers", apiClientId, adminClientId, audience, customerRoles: ["<P>_CUSTOMER"] } })`. It refuses a Keycloak without the extension. Keep the two client secrets it returns in SECRETS. On Zitadel, `ZitadelCustomerIdentity.applyCustomerOrg(...)` creates the customer organisation, application and login client.
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
7. **Upgrade note.** Rebuild the image whenever the platform moves the Keycloak pin. It moved to the 26.8.1-2 rebuild on 7 Nov 2026 (R1-D-110): rebuild now, and run the IdP with the same digest (`keycloak/keycloak@sha256:3f3c5f8e…`) wherever you pinned 26.8.1. The rebuild clears CVE-2026-91415; four base-image findings stay waived to 20 Dec 2026 by the owner (#124, R1-D-109; CVE-2026-91403 is an accepted risk, see the threat model) until a Keycloak or UBI release carries their fixes (`infra/docker/trivyignore.yaml`), so carry the same waivers in your own image scan.
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

## 7ab. CEL string functions (PR-LDC-13; R1-D-71)

- **String functions in rule rows (`connectors` minor).** A row's `when` can use `s.startsWith(x)`, `s.endsWith(x)`, `s.contains(x)` and `s.matches("re")` on every engine (`zen`, `json-rules`, `memory`). The receiver is a declared `string` input; the argument of the first three is a string literal or another `string` input. A `date` input, a literal receiver or a non-literal pattern is refused (`cel_unsupported`); a non-string receiver or argument is a type error (`cel_type`). Matching is case-sensitive, and an empty argument always matches.
- **`matches` patterns.** A pattern is a string literal (a CEL raw string, e.g. `code.matches(r"^L\d{5}[A-Z]{2}\d{4}(PLC|PTC)\d{6}$")`) and an unanchored search, as in CEL: anchor it with `^` and `$`. It is checked when the draft is saved, so before it can be submitted for publication; one outside the subset is `IPB-RULE-001`, reason `cel_pattern`. Allowed: at most 256 characters; literals in the Basic Multilingual Plane; `\d`, `\w`, `\b`, `\t`, `\n`, `\r`; escaped punctuation; `^`, `$`; positive classes with ranges (escape a literal `-` as `\-`); `|`, `(...)`, `(?:...)`; `*`, `+`, `?`, `{n}`, `{n,}`, `{n,m}` up to 1000, lazy or not. Refused: back-references, look-around, atomic, named and flag groups, possessive or stacked quantifiers, a quantified group holding a quantifier or an alternation (`(a+)+`, `(a|aa)+`), `.`, negated classes, `\D`, `\W`, `\s`, `\S`, `\B`, `\x`, `\u` and `\p`. Use a positive class instead of `.` or `[^…]`.
- **Inputs.** A string input over 4096 characters, or one that is not well-formed UTF-16 (a lone surrogate), is `UNDETERMINED` with `input_invalid` on every engine (a small tightening). `evaluateCel` (Vidhi's event conditions) returns `limit` for a `matches` outside the subset and `eval` when an input string is over 4096 characters.
- **LawDocsComply** moves its `classificationInput` booleans and the `classification.ts` rows into a `@infrabyx/rules` rule set (versioned, published through maker-checker, with an explain trace).

## 7ac. Platform purpose notices and the consent purge sweep (PR-LDC-14, #95; R1-D-72)

- **Platform purpose notices (`consent`, `contracts` minors).** Register a purpose with `tier: "platform"` in `PurposeConsents` (e.g. `{ code: "ldc.account.terms", description, tier: "platform" }`). Its notices belong to the platform: a PLT_DPO drafts them (`draftNotice`) and a different PLT_LEGAL_REVIEWER approves and retires them (`approveNotice`, `retireNotice`), in the platform context (`scope: "platform"`, `tnt_platform`). In every tenant, `currentNotice(ctx, purpose, language)` returns the approved platform version, and `grant(ctx, { subjectRef, purpose, noticeId, method })` records consent against it as against a tenant notice (notice id, version, language and SHA-256 kept). No tenant can draft, approve, change or retire a platform notice; PostgreSQL refuses any tenant-scope write to one (`consent/0004`). A platform purpose never cites a tenant notice, nor the reverse (`IPB-WEB-002`). Tenant-tier purposes are unchanged.
- **`latestByPrincipal`.** `ConsentPort.latestByPrincipal(principalRef, { tenantId })` returns one entry per purpose for that principal in that tenant only (`purpose`, `granted`, `receiptId`, `recordedAt`, `shown`, `noticeSha256`, `platformNotice`), over both the Ecosystem purposes of ledger records and the product purposes of purpose-consent records. `pg_local` and `@infrabyx/testing`'s fake provide it; `oh_ledger` answers `IPB-PORT-001` (`unsupported`). The member is optional, so your own fake still compiles.
- **The #95 purge.** Run `new ConsentPurge({ kernel, audit }).sweepPurposes()` daily from one worker, beside `sweep()`. Deletion is on the locked list, so the later of #95's two clocks applies (OWNER-QUESTIONS #108): a purpose-consent record and its notice version go only once the relationship has ended, reported with `ConsentSubjects.endRelationship(ctx, subjectRef, endedAt)` when a loan or account closes, and 8 years have passed since the later of that end, the record and any withdrawal of that purpose at or after it. A withdrawn consent is kept while the relationship continues; until you report an end, none of the person's purpose-consent records is purged; `setRelationship(ctx, ref, true)` clears a reported end. Nothing is deleted under a legal hold (`ConsentSubjects.legalHold`, PLT_LEGAL_REVIEWER). Each tenant batch writes one `consent.purpose.purge` ledger entry with counts only; a retired notice version goes once no record in any tenant cites it. The 8 years are fixed in PostgreSQL; no setting changes them.
- **Run** `infrabyx-migrate` for `consent/0004` (policies, triggers, one nullable column and column grants; no data change). No new settings or environment variables.

## 7ad. Field encryption over the KMS port (PR-LDC-16; R1-D-73)

- **`fieldCryptoForTenant` (`@infrabyx/tenancy`; `tenancy` minor).** Build one per tenant: `fieldCryptoForTenant(kms, tenantId)`, with the configured KMS adapter and the caller's verified tenant (`tnt_` + ULID). It returns a `TenantFieldCrypto`, the existing `FieldCrypto` bound to that tenant, so it fits wherever a `FieldCrypto` is taken (`encryptField`, `decryptField`, `decryptFieldText`, `rewrapField`). A call naming another tenant is refused before the KMS is called; a malformed tenant id is refused (`RangeError`), and so is an adapter without a key-id convention (`IPB-PORT-001`). You never pass a key id.
- **The key-id convention.** `tenantFieldKeyId(kms, tenantId)` names the key exactly as the adapter's `createTenantKey(tenantId)` creates it (C-15): `local:tenant:<tenant id>` on `LocalKms`, `alias/ipb/tenant/<tenant id>` on `aws-kms`, `tenant-<tenant id>` on `vault-transit`. Each data key is wrapped under the C-14 context `{ tenant_id, purpose: "field" }`, and the ciphertext is bound to tenant ‖ table ‖ column ‖ row. Store `<col>_enc`, `<col>_key_id` and `<col>_alg` as for any field (PL1-C-04).
- **Development and tests.** `new LocalKms()` from `@infrabyx/crypto` or `fakeKms()` from `@infrabyx/testing`; `@infrabyx/config` refuses the `local` adapter in staging, demo, pre-prod, prod and dr (IPB-11-17).
- **In AWS (key policy as §7i).** Create each tenant's key once, when the tenant is created: `kms.createTenantKey(tenantId)` from `onCreated` (§7y) or `onProvisioned` (§7z); it is idempotent through its alias, rotates yearly and is tagged `ipb:tenant_id`. A seal for a tenant without a key fails closed. The key policy lets only the runtime role (`arn:aws:iam::<account-id>:role/<runtime-role>`) call `kms:GenerateDataKey` and `kms:Decrypt`, and only with `kms:EncryptionContext:tenant_id` = the tenant id and `kms:EncryptionContext:purpose` = `field`; key administration (`kms:CreateAlias`, `kms:UpdateAlias`, `kms:ScheduleKeyDeletion`) belongs to the deployment role, never the runtime role. Deletion is scheduled only, 30 days ahead, after the R5 approval (C-15). Each tenant key is a recurring AWS cost; whether CONFIDENTIAL-only tenants may use the platform key instead is OWNER-QUESTIONS #107 (default: the tenant's own key).
- **Rotation.** Key material rotates yearly under the same key id, so stored fields stay readable; data keys rotate inside the envelope (at most 5 minutes or 2^20 uses); format-1 fields are upgraded with `rewrapField`.
- **LawDocsComply** seals each mobile number with `encryptField(tenantId, "CONFIDENTIAL", mobile, { table, column, rowId })`, keeps the blind index (§7i) beside it for search and the masked form for display.

## 7ae. Reacting once to an approved setting change (PR-LDC-18; R1-D-74)

- **No new API.** Give `SettingsService` its `outbox` option (`config.outbox`, registered for the relay). Every committed change of a TENANT, ENTITY or PLATFORM key then writes `in.<product>.settings.SettingChanged.v1` (`key`, `tier`, `scope_id`, `old`, `new`, `actor`, `mc_request_id`) in the change's own transaction, so a rejected or expired approval writes nothing, and an approved one writes exactly one event, carrying its approval request id. USER changes write `UserPreferenceChanged` instead.
- **Consuming it.** The outbox relay delivers each event at least once to your queue; consume it with `PgInbox.firstSeen(tx, schema, consumer, eventId)` in your handler's transaction, so each change is acted on once. LawDocsComply then stops polling its own change history.

## 7af. More external grantee kinds and a scoped break-glass (PR-LDC-07, PR-LDC-08 (c); R1-D-75)

- **Grantee kinds (`@infrabyx/tenancy`; `tenancy` minor; `tenancy/0016`).** `EXTERNAL_GRANTEE_KINDS` adds `nhb`, `nabard`, `ifsca`, `roc_inspector`, `rcs_inspector`, `crcs_inspector`, `secretarial_auditor`, `tax_auditor`, `concurrent_auditor` and `cooperative_auditor`; `ExternalGrants.request` and `fromApproved` accept them. The database check is widened, so existing rows still pass; the rest is unchanged (at most 90 days, a second ORG_OWNER or ORG_ADMIN approves, read-only through `ExternalReads`).
- **A scoped break-glass.** `BreakGlass.request(ctx, reason, minutes, { tenantId, modules?, access? })` narrows a grant to one tenant, optionally its modules (PostgreSQL schemas, 1 to 50), and `read` (the default) or `read_write`. Before each transaction the kernel reads the active grant's scope and refuses (`IPB-SEC-005`) another tenant, a platform context, a `mutate` under `read`, and any statement naming a schema outside the list; under a module list it also refuses statements that could reach another module without naming it (`SET`/`RESET`, `set_config`, `search_path`, `DO`, `PREPARE`/`EXECUTE`, `COPY`, `CALL`, the `*_to_xml` functions). The ledger append and `pg_catalog` are always allowed. Each refusal is ledgered in the tenant touched (`security.breakglass.scope_refused`), even when your code catches it. A grant without a scope behaves exactly as IPB-02-06 does today.
- **Give the kernel its audit sink:** `new PgKernel({ pool, audit })`; without it a scoped grant's context is refused. `BreakGlassTenantNotices.list` shows each grant's scope to the tenant.
- **Migrate:** `infrabyx-migrate --require-all` (`tenancy/0016`), then `infrabyx-rls-lint` (`tenancy.breakglass_scope` is on its default allow-list).

## 7ag. Tenant-consented support access (PR-LDC-08 (a), (b), PR-LDC-20; owner answer #104; R1-D-76)

- **A separate grant, not break-glass** (IPB-02-06 is unchanged). `PLT_SUPPORT` is a new platform role in `@infrabyx/contracts` (`SUPPORT_ROLE`; MFA required, as for every `PLT_*` role). Map your own support role onto it with `supportContext(tenantId, principalId)`: the context holds `PLT_SUPPORT` and nothing else, and is refused in the platform tenant, in a platform context, and with impersonation, break-glass or an external grant. The kernel accepts no product-defined platform role.
- **The flow (`SupportAccess`; `tenancy/0017`).** (1) `request(supportCtx, { reason, modules, access?, hours?, ticketRef? })`: read-only by default, at most 24 hours from activation (default 4); a read-write grant may not list `tenancy` or `audit`; one open request per principal and tenant. (2) `consent(adminCtx, id)` by the tenant's ORG_OWNER or ORG_ADMIN, never an agent: a `read` grant is then active. (3) A `read_write` grant also needs `approve(otherAdminCtx, id)` from a second, different ORG_OWNER or ORG_ADMIN (the database enforces it). (4) `refuse` and `revoke` (at once) belong to the tenant. `SupportAccessRequested`, `SupportAccessGranted` and `SupportAccessRevoked` go to the tenant's outbox, so you can notify its admins.
- **Using it.** Without a live grant in the tenant a support principal sees nothing (`IPB-TRUST-003`). It reads only through `SupportReads.read(ctx, "<schema>.<table>", sql, params)`, each read ledgered (`platform.support_read`) and recorded for the tenant; it writes only under a read-write grant with ordinary `kernel.mutate`. Every statement names only the grant's modules (§7af's guard; refusals ledgered as `security.support_access.scope_refused`).
- **The tenant's view.** `SupportAccess.list(adminCtx)` and `SupportAccess.reads(adminCtx, { grantId? })` (who, which table, how many rows, when): show both on the tenant admin's security page. **Migrate:** `tenancy/0017`, then `infrabyx-rls-lint`; the kernel needs its `audit` option.

## 7ah. Refresh-token grant with reuse detection (PR-LDC-03; R1-D-77)

- **`refreshSession` (`@infrabyx/contracts`, `@infrabyx/connectors`; minors).** Call `identity.refreshSession({ refreshToken })` on the workforce IDENTITY adapter instead of the IdP's token endpoint. It returns `{ accessToken, idToken?, refreshToken, expiresIn }` with a new refresh token every time: store it and drop the old one.
- **Refusals.** `IPB-IDN-001` with `meta.reason: "refresh_reused"`: a spent token was presented again; the session is revoked first (its access tokens are refused within 60 s, IPB-02-05, and its current refresh token is dead), so sign the user out. `"refresh_invalid"`: expired, revoked, unknown or another client's token; send the user to login. `IPB-IDN-002`: the IdP is unreachable; retry later. Two parallel refreshes with one token look like a reuse, so serialise refreshes per session in the client.
- **Keycloak.** `ipbRealm` already sets `revokeRefreshToken: true` and `refreshTokenMaxReuse: 0` (re-apply the realm if it was configured by hand). On a reuse the adapter records the session's `sid` in the revocation store, then ends the session through the Admin API.
- **Zitadel.** It rotates but reports a spent token only as invalid, so the adapter keeps a `RefreshTokenLedger` of SHA-256 hashes (`MemoryRefreshTokenLedger` by default). With several API replicas pass one shared `refreshLedger`; without it a reuse on another replica is still refused (`refresh_invalid`) but does not revoke the session.
- Never log, store in clear or put in an error a refresh token. Tests: `FakeIdentitySessions` and `identityRefreshContractCases` from `@infrabyx/testing`.

## 7ai. Tenant SSO: identity-provider brokers and domain discovery (PR-LDC-09; R1-D-78)

- **API (`IdentityBrokerAdmin` on the IDENTITY port; `contracts`, `connectors`, `testing` minors).** `upsertIdentityProvider(spec)`, `removeIdentityProvider(tenantId, alias)`, `listIdentityProviders(tenantId)` and `discoverIdentityProvider(email)`. `IdentityProviderSpec` is strict: `tenantId`, `alias`, `displayName`, `enabled`, `domains: [{ domain, verifiedAt }]`; OIDC adds `discoveryUrl` (`…/.well-known/openid-configuration`), `clientId`, `clientSecretRef` (`secret://<adapter>/<path>#<key>`; a literal secret fails the schema) and `scopes`; SAML adds `metadataUrl`. URLs must be https. Pass the adapter `resolveSecret` (e.g. `secretsResolver` from `@infrabyx/config`); without it OIDC brokers are refused (`IPB-PORT-001`).
- **Maker-checker.** Every upsert or remove is an R3 maker-checker request in your product; call the adapter only after approval, with the approved spec.
- **Domains and aliases.** Verify the tenant controls each domain (e.g. a DNS TXT record) before you list it; only listed domains route, one domain to one broker (`IPB-PORT-004` `domain_taken`). An alias belongs to one tenant (`alias_taken`, also for a hand-configured IdP). `discoverIdentityProvider(email)` returns `{ tenantId, alias }` or `null` from a 30-second cache; rate-limit it on public login pages; start the login with `kc_idp_hint=<alias>` (Keycloak) or the IdP id (Zitadel).
- **Linking only, on both IdPs.** A brokered login reaches only an account you have already provisioned (`provisionUser` or SCIM) in the broker's tenant, after its user has signed in to that account; no account is ever created through a broker (that would need the owner's word). Keycloak: set `identityBrokers: true` in the realm spec and re-apply it; `applyRealm` creates (and restores if edited) the first-login flow `ipb-broker-link-only` (find the existing account, refuse an unknown one, re-authenticate before linking), adds an `idp` access-token claim and grants the admin account `manage-identity-providers` and `view-identity-providers` only; `trustEmail` stays off. Zitadel brokers allow linking only.
- **Tenant guard.** A session from a broker of another tenant than its account is refused (`IPB-IDN-001` `idp_tenant`): Keycloak by the `idp` claim, Zitadel while the account is linked to another tenant's broker. Sign such a user out and remove the stray link.
- **Tests.** `FakeIdentityBrokers` with `FAKE_BROKER_SIGN_IN`, and `identityBrokerContractCases` (your legs provide `brokerSignIn`, and `brokeredSession` where they can).

## 7aj. Company data by CIN or LLPIN (PR-LDC-02; R1-D-79)

- **`CompanyDataPort` (`@infrabyx/contracts/ports`; `contracts` minor).** `lookupCin(cin)` and `lookupLlpin(llpin)` return a `CompanyRecord` (kind `company` or `llp`, name, normalised `status` and the register's `statusText`, `listed`, class, incorporation date, RoC, registered office, authorised and paid-up capital or an LLP's contribution in integer paise, last AGM and balance-sheet dates) or `null` when the register does not know it. `getDirectors(companyId)` lists directors or designated partners (DIN, name, normalised `designation` and `designationText`, `appointedOn`, `ceasedOn`); `getCharges(companyId)` lists charges (id, holder, amount in integer paise, `open` or `satisfied`, created, modified and satisfied dates). A malformed CIN or LLPIN is refused before any source is called; an unknown company makes `getDirectors` and `getCharges` throw `IPB-PORT-001` (`not_found`).
- **Freshness.** Every result carries `asOf` (the register date it reflects) and `stale` (a cache served after the source failed). Show `asOf` beside the data and treat `stale: true` as needing a re-check.
- **No adapter yet.** None is built until the owner chooses a data source (OWNER-QUESTIONS #102); direct MCA21 scraping is forbidden (IPB-01). Keep the public-list snapshot and manual CIN entry with document evidence meanwhile, and keep the port refused above staging.
- **Development and tests.** `FakeCompanyData` from `@infrabyx/testing` (a fictional register: a private company, a listed company and an LLP; `COMPANY_DATA_FAKE_FIXTURES`), and `companyDataContractCases(fixtures)` for your own wrapper. Director names and DINs identify people: never log results in full.

## 7ak. Collections through the sponsor bank and settlement lines (PR-FBX-34 (1), (2); R1-D-80)

- **`DisbursementRailPort` (`@infrabyx/contracts/ports`; `contracts` minor; ADR-0006).** The collection half of IPB-01's `DISBURSEMENT_RAIL` (§01.4.4.3), now a registered port (tier 1, `int.disbursement_rail.`).
- **`presentDebitBatch(batch)`.** A batch has `batchRef`, `channel` (`NACH` or `UPI_AUTOPAY`), `debitDate` and up to 10,000 `items`; each item `itemRef`, `mandateRef` (UMRN or UMN), `amountMinor` in integer paise, `attempt`, `purposeRef`, `idempotencyKey` and `authorisation` (approval reference and a user or service initiator). `assertDebitBatch` runs first: `assertMoneyCall` on every item (an agent is `IPB-SEC-004`; a missing approval or key is `IPB-UX-004`), the schema, and a key or item reference repeated in the batch (`IPB-PORT-004`); any failure refuses the whole batch. A key is presented at most once: the same item again is `replayed` with its first `presentationId`; another item under the key is `IPB-PORT-004`. `submitted` is never final; after an unknown outcome use `lookup("presentDebit", key)`.
- **`readPresentationResponse(file)`.** Each result is `paid` (settlement reference and date) or `returned` (`returnCode`, `returnReason`, `returnClass` `re_presentable` or `final`, `codeKnown`). Codes are classed by `classifyReturnCode` over `NPCI_RETURN_CODES`, a small `[VERIFY]` table; an unknown code is `final` with `codeKnown: false`. A re-presentation is a new item: a fresh key, `attempt + 1` and a fresh approval. A file naming an unpresented item, another amount or a result contradicting one already read is refused (`IPB-PORT-001`); reading the same file twice is harmless.
- **`statementLines({ from, to })`.** The collection account's lines with `valueDate` in the inclusive range (`lineId`, `amountMinor`, `direction`, `reference`, `narration`).
- **PAYMENTS.** `reconcile(range)` may return `settlementLines` (`SettlementLine`: `settlementId`, `source` `gateway` or `npci`, `utr`, `grossMinor`, `feesMinor`, `taxMinor`, optional signed `adjustmentsMinor`, `netMinor` = gross − fees − tax + adjustments exactly, `settledOn`). Optional: existing adapters are unchanged and do not fill it yet. Three-way reconciliation matches settlement lines to statement lines by UTR and amount, and both to your ledger.
- **No adapter.** None until a tenant names its sponsor bank and the owner gives the word (money movement, as #100); your maker-checker approves each debit before the call (the approvals engine does not consume debit approvals). **Fakes:** `FakeDisbursementRail` (its `respond(batchId, outcomes)` plays the bank's file; paid items credit its statement), `FakeSettlements`; contract cases `disbursementRailContractCases`, `settlementLineContractCases`.

## 7al. Daily external-read summary (PR-LDC-10; R1-D-81)

- **`AuditService.externalReadSummary(ctx, day)` (`@infrabyx/audit`; `audit` minor).** A tenant context and a UTC day (`YYYY-MM-DD`). Read from the `platform.external_read` entries `ExternalReads` writes, in the tenant's context under the ledger's RLS. Returns `reads`, `firstReadAt` and `lastReadAt` for the day; `byGrantTable` (grant, grantee principal id, `schema.table`, reads, first and last read); `byGrantee`; `byTable`.
- **No personal data.** Ids, counts and times only: never the grantee's name, IP or user-agent hashes, trace ids or digests; join `ExternalGrants.list` in your own report for names. Each entry holds its row count only inside a digest, so the summary counts reads, not rows.
- **Refusals.** An external principal is refused (`IPB-SEC-005`); a day that is not a calendar date is a `RangeError`. LawDocsComply builds its daily report from this and drops its own ledger scan.

## 7am. Setting change history (PR-LDC-17 in part; R1-D-82)

- **`SettingsService.history(ctx, key, scope, { limit?, cursor? })` (`@infrabyx/config`; `config` minor).** Each change of one key at one scope, newest first, 1 to 100 per page (default 50; pass `nextCursor` on). Each change: `actorId`, `at`, `old`, `new`, `version`, `approvalRequestId` (null for a direct change) and `ledgerId`, the `settings.setting.change` entry whose before and after digests match `{ value: old }` and `{ value: new }`.
- **Migration.** Apply `config/0003_setting_change.sql`: the insert-only `config.setting_change` table under forced RLS, written in the same transaction as each change. History starts at that migration; earlier changes are in the ledger as digests only.
- **Who may read.** USER scope: its owner only. TENANT and ENTITY: a role that may change the key, or ORG_OWNER, ORG_ADMIN or ORG_AUDITOR_RO. PLATFORM, PLAN and BRAND: a platform role in a platform context. Agents and external principals are refused (`IPB-UX-011`). Values come back as `get` returns them (secret-bearing keys hold `secret://` references only). Retention of the history is OWNER-QUESTIONS #110 (default: kept, as the current values are).
- **Scopes below ENTITY** wait for PR-042. LawDocsComply reads change history here instead of its `cfg` module; its migration 0010 stays for the lower scopes.

## 7an. Breached-password list on Keycloak (PR-LDC-04; R1-D-83)

- **Per realm, opt-in.** Apply the realm with `passwordBlacklist: KEYCLOAK_PASSWORD_BLACKLIST` in `KeycloakRealmSpec` (`@infrabyx/connectors/identity`; `connectors` minor); the policy becomes `length(12) and notUsername and notEmail and passwordHistory(5) and passwordBlacklist(ipb-common-passwords.txt)`. Setting a listed password answers `IPB-PORT-002` (400).
- **The list.** The customer Keycloak image (`infra/keycloak/customer-otp`) carries it read-only at `/opt/keycloak/data/password-blacklists/`: the first 10,000 distinct lower-cased passwords of 12 or more characters from SecLists (MIT, notice vendored; source, derivation and SHA-256 in its README). Nothing is called at runtime or build time (owner approval for LDC-04, R1-D-65).
- **Use the customer image.** Keycloak refuses a realm whose list it does not hold, so set the option only on realms served by the customer image (or a Keycloak with the file mounted at that path); without it the policy is unchanged. LawDocsComply sets it and drops its length-and-history-only fallback.

## 7ao. Bureau EMI, the DDE signer trail and not-stampable DDE (PR-FBX-35; R1-D-84)

- **EMI on each tradeline (BUREAU; `contracts`, `connectors`, `testing` minors).** `Tradeline.emiPaise` is the instalment the bureau reports for the account, in integer paise, or `null` when it reports none (a card, an overdraft, an empty field). The `cibil` adapter maps CIBIL's `emiAmount` (whole rupees; stub-shaped, `[VERIFY]`); a missing, empty, zero, negative or malformed value becomes `null`, never `0`. In FOIR treat `null` as unknown: impute the obligation under your credit policy or refer the case; never count it as zero.
- **The DDE signer trail (`DdeRecord.signers`).** One `DdeSignerEvidence` per signed executant, in the order of `executed`: `signerRef` (your party reference, never a name), `signedAt` (UTC), `method` (ESIGN's `SigningMethod`: `AADHAAR_OTP_ESIGN`, `AADHAAR_BIO_ESIGN` or `DSC`), and `espTransactionId` and/or `signerIp` (at least one). The type is ESIGN's `SignatureRecord` fields, so one evidence table holds both; keep `signerIp` CONFIDENTIAL. `nesl-dde` fails closed: a signed executant without a time, with an unknown method, or with neither an ESP id nor an IP makes the record a vendor error (`IPB-PORT-002`), never a partial trail.
- **Not-stampable registration (`DdeRegistration.notStampable`).** `ddeRegister({ document, notStampable: { reason, note? }, executants, outputPrefix }, idempotencyKey)` with `reason` `NOT_AN_INSTRUMENT` (e.g. a sanction letter), `ACKNOWLEDGEMENT` (e.g. a KFS acknowledgement) or `OTHER` (a `note` of 3 to 500 characters, no personal data). No `certificateId`, no duty quote, no e-stamp: a registration with `notStampable` and a certificate or duty, or with neither path, is refused before anything leaves; a key replayed with another stamping is `IPB-PORT-004`. The record carries `notStampableReason` (`null` for a stamped document). Whether a document bears duty is your decision (your RULES, by instrument and state); the platform records the code. The stamped path and its money-call rules are unchanged.
- **Still off.** `cibil` and `nesl-dde` stay behind `int.bureau.cibil.enabled` and `int.estamp.nesl_dde.enabled`, `unproven`, until the owner's sandboxes confirm the field names.

## 7ap. Rule parameters, publish checkers, as-of evaluation and compiling ahead (PR-LDC-21, 22, 25; R1-D-86, R1-D-88)

- **Parameters (`rules`, `contracts`, `connectors` minors).** Declare tenant parameters in the rule set: `parameters: [{ name, type, setting, default, min?, max?, values? }]` (types `integer`, `number`, `string`, `boolean`, `date`). A row compares an input with a parameter as with a literal (`score >= minScore`, `segment.startsWith(prefix)`, `filedOn < cutOff`, a boolean parameter alone); two parameters cannot be compared, and a parameter is never an input (sending it is `input_invalid`). Register each `setting` key in your `settings-tree.yaml` and pass your `SettingsService` as the `settings` option: a draft naming an unregistered key is refused, and a tenant changes a value through settings' maker-checker and history, with no republish. Each evaluation binds the tenant's value (else the default); a value outside the type, bounds or allowed values makes the decision `UNDETERMINED` (`parameter_invalid`). `Decision.parameters` and `explain(...).parameters` (with `source`: `setting` or `default`) record what was used.
- **Publish checkers (#109).** `new RulesService({ ..., publishCheckerRoles: ["TEN_CCO", "TEN_ADMIN"] })` lets those tenant roles check `rules.ruleset.publish` besides ORG_CHECKER, ORG_ADMIN and ORG_OWNER. Platform, agent, service and operations roles are refused when the service is built; maker ≠ checker, the R4 delay, your tenant's `mc.checker_roles.rules.ruleset.publish` narrowing, any second sign-off you require for statute, regulator or SRO layers, and the ledger entry of every publish are unchanged.
- **Publish event.** `in.<product>.rules.RuleSetPublished.v1` (rule set, key, version, digest, approval id, `effective_from`) is written to your outbox in the transaction that executes the publish, which is the cut-over: pass `outbox` to `RulesService` and subscribe; no polling.
- **As-of evaluation.** `evaluate(ctx, { ruleSetId, asOf }, input)` evaluates the version that was in force at that past instant (published or since retired); never with `version`, never in the future (`IPB-RULE-001`); none in force then is `IPB-RULE-002`. Parameters take the tenant's current values; the decision records `asOf` (migration `rules/0002`).
- **Compiling ahead (PR-LDC-25).** Call `rulesService.prepare(ctx)` at start-up and when `RuleSetPublished` arrives from another instance: it warms the engine and compiles the in-force versions with the tenant's parameters, so the 50 ms evaluation budget covers matching only. An executed publish compiles its own version in the approving instance. Drop the long-budget authoring instance.

## 7aq. Form-layout accessibility lint (PR-LDC-24; R1-D-90)

- **Lint (`a11y` minor).** Describe each form as a `FormLayout` (`FormLayoutSchema`): `id`, optional `title`, `headings` (`id`, `level`, `text`) in DOM order, `groups` (`id`, `legend` or `labelledBy`), `texts` (`id`, `text`) for hints, and `controls` in DOM order (`id`, `kind`, `label`, `labelledBy`, `ariaLabel`, `placeholder`, `describedBy`, `errorId`, `errorText`, `errorMessage`, `invalid`, `required`, `requiredIndicator`, `autocomplete`, `personalData`, `tabIndex`, `group`). `lintForm(layout, { parentHeadingLevel? })` throws a `ZodError` for a non-layout and otherwise returns `{ rule, sc, severity, subject, message, source: "lint" }` findings in a deterministic order. `FORM_RULES` lists each rule with its WCAG 2.2 criterion; `isValidAutocomplete` and `formControlName` are exported.
- **What it checks.** Accessible name (4.1.2), placeholder as the only label (3.3.2), name only from `aria-label` and label in name (warnings), duplicate names (2.4.6; allowed only across groups with distinct legends), error messages associated by `aria-describedby` or `aria-errormessage` (3.3.1), required marking (1.3.1, 3.3.2), positive `tabIndex` (2.4.3), heading levels and empty headings (1.3.1, 2.4.6), radio and checkbox grouping with a legend (1.3.1), autocomplete tokens on personal-data inputs (1.3.5), dangling `labelledBy`, `describedBy` and `errorMessage` ids, duplicate ids, and a missing submit (warning).
- **Rendered form.** `axeFormScan(page.locator("form#apply"), { order })` from `@infrabyx/a11y/playwright` runs axe on that form only, with the gate's WCAG tags plus `heading-order` and `label-content-name-mismatch`, and returns the same finding shape (`source: "axe"`, every violation an error).
- **Adopting.** Replace your `lintForm` in `cfg/form.rules.ts`: map your form config onto `FormLayout`, fail CI on `severity === "error"`, and add `axeFormScan` to the form's Playwright test. No migration, setting or environment variable.

## 7ar. XLSX and DOCX exports (PR-LDC-28; R1-D-90)

- **Workbooks (`export` minor).** `toXlsx(sheets, { created?, title?, creator?, maxBytes? })` returns XLSX bytes. Each sheet is `{ name, columns: [{ header, type, key? }], rows }` (types `string`, `number`, `integer`, `boolean`, `date`, `datetime`; rows as arrays or objects). Sheet names follow Excel's rules (1 to 31 characters, none of `[]:*?/\`, unique). Strings are written inline and no cell is ever a formula: text starting with `=`, `+`, `-`, `@`, tab or CR gets a leading apostrophe (`neutraliseFormula`). Dates are UTC Excel serials with a `yyyy-mm-dd` or `yyyy-mm-dd hh:mm:ss` style. The header row is bold and frozen. Limits: Excel's grid, 32,767 characters a cell, 255 sheets, 64 MiB uncompressed (`maxBytes`, up to 1 GiB); past any limit the call throws `OfficeExportError` with a `reason`.
- **Documents.** `toDocx({ title?, blocks }, { created?, creator?, maxBytes? })` returns DOCX bytes (A4, Calibri 11). Blocks: `heading` (1 to 6), `paragraph` with runs (`{ text, bold?, italic?, underline?, href? }`), `bulletList` and `numberedList` (one nested level), `table` (header plus plain-text rows), `pageBreak`. Links must be `https:` without credentials (`link_invalid` otherwise). No macros, fields, images or other external parts.
- **Both.** All text is XML-escaped and characters XML 1.0 cannot carry are dropped. Pass a fixed `created` time (default 1980-01-01T00:00:00Z): the same input gives the same bytes.
- **CSV.** `toCsv(columns, rows, { neutraliseFormulas: true })` applies the apostrophe rule to a CSV meant for a spreadsheet; it is off by default so archive datasets keep exact values.
- **Retire the shim.** Drop the CSV-in-ZIP fallback. PDF follows in wave 7 after the dependency review (R1-D-87).

## 7as. Tenant brand layer (PR-LDC-26; R1-D-90)

- **What a tenant may set (`brand` minor).** `TenantBrandLayers` adds a tenant's own layer over its product's pack: the colour tokens the pack defines (`primary`, `accent`, `surface`, `on_surface`), a logo and favicon (SVGs stored through the sanitiser with `uploadSvg`; PNG favicons when a MEDIA port can rasterise), a letterhead (PDF, PNG, JPEG or a sanitised SVG in the tenant's own storage), an email identity (from-name and from-address), a domain, and a login message (plain text, at most 280 characters, no markup). The legal entity, terminology, policy set, consent and everything else stay the pack's.
- **Maker-checker.** An ORG_ADMIN or ORG_OWNER calls `propose(ctx, layer)` in the tenant (never an agent or a platform context). Every pack guard runs: contrast on the resulting colours (`IPB-BRD-003`), sanitised SVGs under the tenant's keys (`IPB-BRD-001`, `IPB-STOR-001`), the letterhead type (`IPB-SEC-010`), a verified email domain through the NOTIFY hook (`IPB-BRD-005`), a domain that is neither a pack host nor another tenant's (`IPB-BRD-002`). It raises `brand.tenant_layer.change` at R3; a tenant checker (never the maker) approves; the executor runs the guards again and applies the version, ledgered in the same transaction. `revert(ctx, version)` proposes an earlier version again; `history` and `current` read the versions.
- **Resolution.** `resolveForTenant(ctx)` and `resolveHost(platformCtx, headers)` return the pack with the layer applied and run the contrast guard again (colours a later pack change makes fail are dropped and reported as `tenant_colours_dropped`). `BrandStudio.resolve` now resolves a verified tenant domain to its base pack and returns `tenantId`; `X-Forwarded-Host` never selects a tenant.
- **Wire.** `emailIdentityVerified` (NOTIFY), `domainVerified` (EDGE `verifyDomain`; without it a domain is recorded but never selects the layer), optionally `enabled` (the white-label plan). Apply `brand/0002` before upgrading (`BrandStudio.resolve` reads the new table). Remove the `cfg.brand_layer` shim.

## 7at. Tenant notification templates (PR-LDC-27; R1-D-90)

- **The store (`notify`, `contracts`, `connectors`, `testing` minors; `notify/0004`).** Build `new TenantTemplateStore({ kernel, audit, catalogue, registry, lint?, fallback? })`, pass `store.resolver.resolve` to `NotifyService` as `templates`, and call `store.registerApprovals(approvalsEngine)` once. Each tenant keeps versions per class, channel and locale (proposed, active, superseded; never deleted). Delivery and `dispatchDue` use the active version for the notification's locale, then its language, then the class's first locale; with none, or after a revert, your `fallback` resolver and then the catalogue.
- **Email.** `requestChange(ctx, approvalsEngine, { class, channel: "email", locale, subject, text, html? })` with `{{name}}` placeholders, only from the class's `variables` (declare `variables: [...]` in your catalogue). Plain text is required; subject 150, text 20,000, HTML 100,000 characters. HTML stays within an allow-list: no script, style, iframe, form, embedded content or comments, no `on…` attributes, links only `https:`, `mailto:` or `tel:` (optionally limited to `lint.linkHosts`), images only inline PNG, GIF, JPEG or WebP data, variables only in text. A refusal is `TemplateLintError` (422) with every finding. Security classes keep the catalogue's email.
- **SMS and WhatsApp select, never write.** `{ channel: "sms", dltTemplateId }` or `{ channel: "whatsapp", name, lang }` must name a template your `TemplateRegistry` returns for the tenant; free text is refused; a selection later withdrawn fails the delivery closed (`template_missing`).
- **Maker-checker.** `notify.template.change` is R3 (locked, no delay): makers ORG_OWNER, ORG_ADMIN or ORG_MAKER; checkers ORG_CHECKER, ORG_ADMIN or ORG_OWNER, never the maker, never a platform context. Approval re-checks the digest, the base version and the lint, supersedes the previous version and ledgers `notify.template.activate`; `{ ..., revert: true }` returns the key to the catalogue.
- **Preview.** `notifyService.previewTemplate(ctx, class, channel, locale, vars)` returns exactly the message delivery would send (no address); pass `{ template: await store.resolvedOf(ctx, templateId) }` to preview a proposed version.
- **Adapters.** `ses` and `brevo` send tenant content (`EmailMessage.content`, `capabilities.content: "native"`); an EMAIL adapter without that capability fails tenant overrides closed (`content_unsupported`). Emails now carry the tag `notify_class` (the class id with `-` for `.`). Remove `cfg.notification_template`.

## 7au. Sandbox tenants (PR-LDC-29; R1-D-90)

- **The flag (`tenancy`, `contracts` minors; `tenancy/0018`).** `tenancy.tenant.sandbox` (default false). Set it when the tenant is created, `TenantBootstrap.bootstrap/provision(ctx, { ..., sandbox: true })` (part of the request, so a retry with another value is a conflict), and change it only under maker-checker (§7az). The database refuses any other change, a tenant's own update of its row included.
- **Reading it.** The kernel reads the flag once per read and mutate transaction into `tx.ctx.sandbox`, replacing whatever your context carried; a tenant without a `tenancy.tenant` row reads as not a sandbox. Never set `sandbox` on a context and never trust it outside `tx.ctx`; use `isSandboxed(tx.ctx)` from `@infrabyx/contracts/kernel`, true unless the kernel read the flag as false (a transaction it did not read fails closed).
- **NOTIFY (`notify` minor; `notify/0005`).** In a sandbox tenant, email, SMS, WhatsApp and push deliveries are recorded and ledgered as `sandboxed` and never reach an adapter: `send`, `dispatchDue`, digests and `sendOneTimeCode` alike (the OTP sender refuses with `IPB-NTF-003`). In-app messages are still written.
- **AI gateway (`ai` minor).** In a sandbox tenant a chat or embedding call above INTERNAL (the stated class, or the one the scrubber raises it to) is refused with `IPB-PORT-003` and recorded as `sandbox_refused`; PUBLIC and INTERNAL calls run as usual.
- **Remove** the `cfg.sandbox` guard and your wrapped senders.

## 7av. A shorter approval expiry (PR-LDC-19; OWNER-QUESTIONS #106; R1-D-89)

- **Setting (`config`, `tenancy`, `workflow` minors).** `mc.expiry_hours.{action}` (TENANT tier, 1 to 168 hours, tighten-only, changed by ORG_OWNER under R4) shortens the platform expiry of that action's requests: 72 hours for R4, R5 and financial R3, 7 days otherwise. `settingsApprovalPolicy` reads it as `TenantApprovalPolicy.expiryHours`, and `ApprovalsEngine` clamps it to [1 hour, the action's platform period], so it never lengthens the platform period; a value above 168 hours is refused when it is set. `expiryHoursFor(risk, financial, tenantHours?)` and `APPROVAL_MIN_EXPIRY_HOURS` are exported.
- **Remove** LDC's own expiry of its requests.

## 7aw. Setting history in the tenant export, and erasing a person's USER settings (#110; R1-D-95)

- **Export (`export` minor).** `REF-EXPORT-1.5` adds `01 Data/setting_change.csv` and `.jsonl` (who changed which setting at which scope, when, from what to what, and the approval request). `REF-EXPORT-1.4` is still emitted beside it for the 90-day dual run. A product map adds the same entity in its own next map version.
- **Erasure (`config` minor; `config/0004`).** On a DPDP erasure request, call `settings.eraseUser(ctx, userId, { requestRef, reason })` from your erasure workflow (a service principal) or as ORG_OWNER or ORG_ADMIN, in the person's tenant. It deletes their USER values and USER change history in one ledgered transaction (`settings.user.erase`: counts and the request reference, never a value). Other tiers are untouched; the history accepts no other delete.

## 7ax. Setting scopes below ENTITY (PR-042, PR-LDC-17; R1-D-95)

- **Declare (`config`, `contracts` minors; `config/0005`).** Add `unit_override: true` to a TENANT, ENTITY or USER key in your `settings-tree.yaml` (`SettingDef.unitOverride`). No platform key declares it.
- **Context.** Put the caller's units in `KernelContext.unitIds`, outermost first (an organisation unit, then a department or function), at most 8, built server-side from your organisation model and the verified principal, never from a request body.
- **Resolution.** ENTITY, then each unit outermost first, then USER: the innermost unit wins. A UNIT write needs the key's change role and the unit in the caller's own chain, is tighten-only against the tenant, the entity and the outer units, and goes to the change history (`history(ctx, key, { tier: "UNIT", scopeId })`).
- **Remove** LDC's `cfg` module (its migration 0010) once its keys are moved.

## 7ay. PDF export (PR-LDC-28; #117; R1-D-95, R1-D-96, R1-D-97)

- **`toPdf(doc, { creator, created, maxBytes })` (`export` minor)** renders the `toDocx` block model as a PDF 1.7 file, A4, with no new dependency (review: `docs/phases/R1-pdf-dependency-review.md`). From wave 8 it embeds Noto Sans (OFL; `export/fonts/FONTS.md`), so it shows Latin (including Latin Extended-A), the usual punctuation, the euro and **the rupee sign**, and the text stays searchable and copyable. A character the fonts lack is refused with `char_unsupported`; nothing is ever replaced.
- **Vernacular documents (Devanagari, Gurmukhi and the other Indic scripts).** They need shaping, which `toPdf` does not do: it refuses them with `shaping_required`. Render them with `renderPdf(doc, { docgen, lang, outputPrefix })`: a document with Indic text goes to your DOCGEN adapter's `renderHtml` (Gotenberg's Chromium, with Noto Sans Devanagari and Gurmukhi installed in its image) as the self-contained page `blocksToHtml(doc, { lang })` writes; anything else is rendered in process. Pass `lang` as the document's language (`hi`, `pa`, …). Bind the platform's Gotenberg adapter (§7be) as `docgen`. `pdfNeedsShaping(doc)` tells you which path applies.

## 7az. Sandbox changes under maker-checker (#115; R1-D-95)

- **`tenancy` minor.** Build `new TenantSandbox({ kernel, audit, approvals, appEnv })`. In a production deployment (`prod`, `dr`, `pre-prod`, or when `appEnv` is not given) a change is R4: it can be applied only 60 minutes after its approval (`IPB-SEC-008` before then), in either direction (#118); elsewhere R3. A PLT_SUPER_ADMIN raises `request(platformCtx, tenantId, true | false, reason)`; a different PLT_SUPER_ADMIN or PLT_SECURITY_OFFICER calls `decide(platformCtx, tenantId, requestId, "approve" | "reject", reason?)`; a PLT_SUPER_ADMIN then calls `apply(platformCtx, tenantId, requestId)`, which uses the approval once and sets the flag, ledgered with the reason and the request id. `set` is refused (`IPB-SEC-005`). Setting the flag at tenant creation is unchanged.

## 7ba. Whose return it is (PR-FBX-36; R1-D-97)

- **`contracts` minor.** `classifyReturnCode(channel, code).attribution` and `PresentationResult.returnAttribution`: `BORROWER` (NACH 04, 01, 06; UPI Z9) or `NOT_BORROWER` (NACH 07, 09, every other code and any unknown code). Levy a bounce charge only when `bounceChargeable(result)` is true. The table is the owner's platform floor (#119), `[VERIFY]` against your sponsor bank's specification; to apply a tenant's narrower list, pass it as `classifyReturnCode(channel, code, { borrowerCodes })`: it can only remove codes, never add one.
- **Remove** `pay.return.borrower_codes` as a source of truth; if a tenant keeps one, pass it as `borrowerCodes` (narrowing only).

## 7bb. The purpose-consent purge per tenant, dry run first (PR-FBX-37; R1-D-97)

- **`consent` minor; `consent/0005`.** For each tenant from `purge.tenantsWithPurposesDue()`: `const r = await purge.dryRunPurposes(tenantId)`, keep or show the report (ids, purposes, counts, SHA-256), then `purge.purgePurposesFor(tenantId, { dryRunId: r.runId })` within 72 hours. The live run deletes only what the dry run listed, and every record deleted has its own `consent.purpose.purge.record` ledger entry. The 8-year rule is unchanged.
- **Remove** Finbyx's dry-run table, its per-record ledgering and the hold on relationship-end reports.

## 7bc. The TELEPHONY port (PR-FBX-38; ADR-0007; R1-D-97)

- **`contracts`, `testing` minors.** Program against `TelephonyPort`: `clickToCall({ initiatedBy, agentLine, to, purpose, subjectRef, recording, maxMinutes, idempotencyKey })` (never from an agent), `callOutcome`, `storeRecording` (only when you named a disclosure and the adapter played it; stored under your `outputPrefix` in the tenant's STORAGE with `retentionDays`) and `cancel`. Use `FakeTelephony` below staging and refuse above it until an adapter exists; calling hours and consent to be called stay your rules.
- **Remove** the product-local `TelephonyPort` and its fake.

## 7bd. The detached JWS in `X-Infrabyx-JWS` (Ecosystem Spec v1.4; M61; R1-D-96, R1-D-97)

- **`contracts`, `connectors` minors.** On delivery, send `await hub.deliveryHeaders(event)` (a fresh JWS per attempt). On receipt, call `hub.receiveHttp(body, request.headers)`: a missing, repeated, comma-joined, over-long or malformed header is refused as `signature-invalid` (`IPB-API-018`) before anything is verified. For other regulated messages, read the header with `regulatedJwsFromHeaders(headers)` from `@infrabyx/contracts/events`.

## 7be. The Gotenberg DOCGEN adapter (#120; R1-D-100)

- **`connectors` minor (`@infrabyx/connectors/docgen`).** Run Gotenberg 8.39.0 in your cluster (the pinned image in `infra/docker/TEST_IMAGES.md`; it carries the Noto fonts for Devanagari and Gurmukhi) behind HTTPS, with no egress. Build `new GotenbergDocgen({ baseUrl, storage, enabled })`, `enabled` reading `int.docgen.gotenberg.enabled` (off by default; turned on by PLT_SUPER_ADMIN under R4), and pass it to `renderPdf(doc, { docgen, lang: "hi" | "pa", outputPrefix: "tenant/<id>/<module>" })`. The PDF (or PDF/A-2b with `format: "pdfa"`) lands in the tenant's STORAGE with its SHA-256 and page count. Templates are not offered by this adapter.
- **Remove** your own DOCGEN or HTML-to-PDF adapter for vernacular documents.

## 7bf. Retiring a captured table (#122; `audit/0008`; R1-D-102)

- **`audit` minor; install `audit/0008` as the database owner, as `audit/0003`.** To drop a table registered for statutory capture that you no longer use, empty it first (every delete is captured), then, in one migration applied by the platform runner (`@infrabyx/tenancy` migrate, at this release or later): `select audit.retire_capture('<schema>.<table>'); drop table <schema>.<table>;`. It is refused outside a migration, to any role but `app_migrate`, and while the table has a row. The retirement is a chained capture entry (`audit.capture.retire`) in the platform chain and in each tenant's chain that holds capture rows of the table, every capture row is kept, and the commit fails if the table is not dropped in the same transaction. Every other drop of a registered table is still refused.

## 7bg. The tenant-id rule (PR-FBX-40; `tenancy/0019`; R1-D-103)

- **`tenancy`, `contracts` minors.** A tenant id is `tnt_` followed by 1 to 60 lower-case letters and digits, or a ULID (`TENANT_ID_REGEX`, `isTenantId` in `@infrabyx/contracts/ids`). Every such id fits every port's storage prefix. `tenancy/0019` stops, naming up to ten ids, if an existing tenant breaks the rule: rename them (and every row that carries the id) in your own migration before upgrading, then run it again.
- **Remove** any guard that refused a port call because the tenant id could not name a storage prefix.

## 7bh. The DISPATCH, COURT_DATA and ODR ports (PR-FBX-41, 42, 44; ADR-0008 to 0010; R1-D-104)

- **`contracts`, `testing` minors; interfaces and fakes, no adapters yet.** `DispatchPort`: `dispatch({ initiatedBy, channel, document, addressee, purpose, subjectRef, evidencePrefix, idempotencyKey })` (never from an agent; the document by its SHA-256), `status`, `storeProof(id, "booking_receipt" | "proof_of_delivery" | "proof_of_return")` into your tenant's STORAGE, `cancel` before booking; `FakeDispatch` below staging. `CourtDataPort`: `lookupCase` by CNR or court, type, number and year, `hearings`, `orders`, `fetchOrder` into your STORAGE, `causeList`; every result names its source and time and is not a verified record; `FakeCourtData`. `OdrPort`: `disclosure`, `modes`, `refer` (who chose the provider, never a default; the basis by reference; the provider's disclosure version as shown, required when it has one), `status`, `withdraw`, `outcome` into your STORAGE; `FakeOdr` and `equatorOdrStub()` ("Equator Resolution is an Infrabyx group company"). Show Equator among the other configured providers, never pre-selected (Spec 6.9).
- **Remove** your product-local `DispatchPort`, `CourtDataPort`, `OdrProvider` and their fakes and stubs.

## 7bi. Module lifecycle and tenant entitlements (PR-FBX-43; #123; R1-D-107)

- **`contracts`, `tenancy` minors.** Describe each attachable module with `AttachableModule` (Spec §11.1: `requires`, `retentionClass`, `licenceSku`, …) and move it along `MODULE_EDGES` (`canMoveModule`); emit `ModuleAttached` on ENABLED and `ModuleDetached` on entering READ_ONLY with the schemas in `@infrabyx/contracts/events`, and `LegalHoldChanged` for holds. Licences: `new TenantEntitlements({ kernel, audit, approvals, appEnv, onNotice })`; `request` (PLT_SUPER_ADMIN or PLT_FINANCE), `decide` (a different PLT_SUPER_ADMIN or PLT_SECURITY_OFFICER), `apply` once approved (after the 60-minute delay in production). In every write your module guards, call `assertWritableIn(tx, sku)` (or require `tenancy.entitlement_status('<SKU>') = 'ACTIVE'` in the table's write policy); never refuse reads. Show `forTenant(ctx)` on the tenant's admin page, send the notice from `onNotice`, and run `recordLapses` daily from your platform service. Map PLT_FINANCE in your identity provider.
- **Remove** the product-local entitlement table and service and the licence half of your module guard; keep your own module state machine on the platform's states.

## 7bj. Platform outboxes are relayed (PR-LDC-35; R1-D-112)

Every platform package now registers its outbox for `OutboxRelay` (one `<package>/00nn_register_outbox.sql` each). Run `infrabyx-migrate`; the relay's next pass delivers every event the platform packages have written so far (for example `RuleSetPublished`, approval, notification and workflow events), including rows written before the fix. Keep consumers idempotent on the event id. Register each of your own module outboxes the same way: `ipb-check` style checks in your repository should refuse an outbox without `select tenancy.register_outbox('<schema>')`.

## 7bk. A scheduled cut-over for a rule set (PR-LDC-34; R1-D-113)

`rules.publish(ctx, ruleSetId, version, { effectiveFrom })` takes the instant the version comes into force, now to 366 days ahead; compute it yourself (for example 00:00 in the entity's time zone). The checker sees it in the R4 request. On approval the previous version stays in force until the cut-over (or the new one applies at approval, if that is later), `RuleSetPublished.effective_from` carries the instant, and as-of reads on either side of it return the right version. Only one cut-over per rule set may be pending; `listRuleSets` shows `scheduledVersion` and `scheduledFrom`.

## 7bl. Scanning uploads: the AV port and ClamAV (PR-LDC-41; R1-D-117)

IPB-02-44 makes the upload scan a platform control. Write every upload to the `QUARANTINE` bucket class, then call `FileScanPort.scan({ storageKey, sha256 })` and act only on `scanDecision(result)`: `release` (copy or move the object to its normal class), `reject` (`IPB-SEC-011`; keep the quarantined copy for the security log) or `quarantine` (`IPB-SEC-015`; schedule a re-scan). Never treat `ERROR` as clean.

- **Adapter (`@infrabyx/connectors/av`, `ClamavFileScan`).** Run clamd in your cluster (ClamAV 1.5.x; the test pin is in `infra/docker/TEST_IMAGES.md`) with `freshclam` updating its signatures daily, and a network policy that admits only your scanning service. Pass `host` (a Service name or private address; public addresses are refused), `port` (3310), your `storage`, and `enabled` from `int.av.clamav.enabled` (off by default, R4). Keep `maxBytes` at or below clamd's `StreamMaxLength` (25 MiB by default).
- **Tests.** `FakeFileScan` and `fileScanContractCases(storage)` from `@infrabyx/testing`; `EICAR` is the standard test file.
- **Shim removed (LawDocsComply):** its local ClamAV client.

## 7bm. Cancelling an approval inside your transaction (PR-LDC-37; R1-D-120)

`approvals.cancelIn(tx, requestId, reason)` withdraws a pending or approved request in the same transaction as the change that made it unnecessary: if your write rolls back, the request stays pending. The rules are `cancel`'s (the maker, ORG_OWNER or PLT_SECURITY_OFFICER; never an expired or executed request), the reason is required (1 to 500 characters) and an agent may not cancel. The checker's inbox item closes in the same transaction. `cancel(ctx, id, reason?)` also accepts a reason. Run `infrabyx-migrate` (`tenancy/0022` adds the nullable `cancel_reason` column).

## 7bn. Writing a setting inside your transaction (PR-LDC-42; R1-D-121)

`settings.setIn(tx, key, { tier: "TENANT" | "UNIT", scopeId }, value)` writes a setting in the same transaction as your own records. It makes every check `set` makes: register your keys in your settings tree with the roles that may change them (`change`), and those roles are what authorise the write; platform keys keep the platform's roles. A maker-checker key still answers `pending` and raises its request in your transaction. PLATFORM, ENTITY and USER values go through `set`.

## 7bo. Business ids on the ledger (PR-LDC-30; R1-D-125)

Pass `businessIds` (1 to 16 ids such as an obligation or matter id; never names or personal data) to `audit.record`, and read every entry for one id with `auditService.history(ctx, businessId)` (actor, time, action, before and after digests; paged by `afterSeq`). The ids are part of the entry's hash when present; older entries verify unchanged. Run `infrabyx-migrate`: `audit/0010` adds the column and `audit/0011` builds its index concurrently (writes continue; on a large ledger allow it time).

## 7bp. Workbook forms: widths, validations, named ranges, protection (PR-LDC-31 writer; R1-D-128)

`toXlsx` columns take `width` (1 to 255 characters), `validation` and `editable`; a sheet takes `validationRows` (rows below the header the validations cover, so a template can carry empty validated rows) and `protection`; the options take `namedRanges: [{ name, sheet, range }]`. Validations are typed values only: `list` with `values` (at most 255 characters joined, no comma or double quote) or `namedRange` (one of your `namedRanges`, for a list kept on another sheet), `whole` and `decimal` with `min`/`max`, `date` with ISO `min`/`max`, `textLength` with `max` (and `min`); each may carry a `prompt` and an `error` message. There is no custom-formula validation and no formula text from the caller. `protection` locks every action you do not allow (`sort`, `autoFilter`, `formatCells`, `formatColumns`, `formatRows`, `insertRows`, `deleteRows`) and unlocks only `editable` columns; it never takes a password, because Excel's sheet password is a UI guard, not a control: anything that must not change is checked again when the workbook comes back. A workbook that uses none of these is byte-for-byte what it was before. Refusals are `OfficeExportError` reasons `columns_invalid`, `validation_invalid`, `named_range_invalid`, `protection_invalid`. **Shim removed:** the writer half of an ExcelJS `WorkbookPort`; the bounded reader follows in wave 14 (M84).

## 7bq. Arrows in PDFs (PR-LDC-36; R1-D-129)

`toPdf` now draws the Arrows block (U+2190 to U+21FF: →, ⇒, ↔, ↩ and the rest) from a bundled Noto Sans Math subset, glyph by glyph where Noto Sans has no glyph, so status flows such as “Filed → Accepted” render and stay searchable. The font is embedded only when a document uses an arrow; arrows in bold or italic text are drawn regular. Any other character outside the fonts is still refused with `char_unsupported`. **Shim removed:** replacing arrows with `->` before `toPdf`.

## 7br. Posting to the books: the ACCOUNTING sink (PR-FBX-46; R1-D-130)

`AccountingSinkPort` (`@infrabyx/contracts/ports`) posts a `JournalBatch` (`journalId`, `initiatedBy` a user or your service, `entries` of vouchers with `voucherType`, `date`, `reference` and balanced `lines` in integer paise) and answers `ACKNOWLEDGED` (with the ledger's reference per voucher), `REJECTED` (with a `reasonCode`) or `PENDING`. Post again with the same batch and you get its current result; a changed batch under the same `journalId` is refused (`IPB-PORT-004`), so give a corrected batch a new id. `replay(journalId)` resubmits a pending or rejected batch unchanged; `trialBalance(asOf)` reads balances to reconcile. Run `assertBalancedBatch` in your own code before you queue a batch: the adapter runs it again. Test against `FakeAccountingSink` and `accountingContractCases` (`@infrabyx/testing`). The TallyPrime adapter follows in wave 15; SAP and Zoho Books only when a tenant needs them. **Shim removed:** your own `AccountingSink` interface and fake (keep your TallyPrime file adapter until the platform's ships).

## 7bs. Calendars: the CALENDAR port (PR-LDC-53; R1-D-131)

`CalendarPort` connects a person's own calendar (`beginConnect` with a PKCE S256 challenge, a session-bound `state` and the callback `https://{your console host}/oauth/calendar/{provider}/callback`, then `completeConnect` from that callback) and keeps your entries in it by your external id (`upsertEntry`, `deleteEntry`). Choose each entry's `detail`: `busy` (time only), `title`, or `full` (description and location too); only `calendarPayload(entry)` ever reaches the provider. Only the person connects or disconnects; your service may write entries; agents never write. A disconnected or revoked calendar refuses writes with `IPB-PORT-003` and shows `token_revoked`. Test against `FakeCalendar` and `calendarContractCases`. The Microsoft 365 and Google adapters stay off until the owner registers their OAuth applications (`docs/runbooks/calendar-oauth-apps.md`); keep your ICS export until then. **Shim removed:** none yet (the ICS export goes when an adapter is proven).

## 7bt. A product MFA floor and step-up (PR-LDC-55; R1-D-135)

Build your floor once at boot: `const floor = mfaFloor({ roles: ["<PRODUCT>_PARTNER", ...], smsExcludedRoles: [...] })` (`@infrabyx/contracts`). It holds the platform's roles plus yours and cannot drop one; every SMS-excluded role must be on it. Guard with `assertMfaForRoles(claims, floor, { stepUp: { acrValues: "<your IdP's MFA acr>" } })` (`@infrabyx/connectors/identity`) and map the error with `stepUpChallenge(e)`: when it returns a challenge, answer 401 with its `www-authenticate` header, and your BFF re-runs sign-in with `acr_values=requiredAcr`; otherwise the error keeps its 403. For SMS-excluded roles the IdP must report the factor in `amr` (`otp`, `hwk`, `webauthn`, …); SMS alone, or an `mfa` claim without the factor, is refused. List your routes with `{ path, mfaFloor }` and call `assertStepUpReachable(routes)` in a boot test: it fails when a sign-in callback, MFA enrolment, session refresh or sign-out route is behind the floor (mark a false match `stepUp: false` and say why in review). **Shims removed:** LawDocsComply's product MFA floor; Finbyx's `assertStaffMfa`.

## 7bu. Ordered approval levels (PR-LDC-38; owner answer #125; R1-D-136)

Pass `levels` with `approvals.request(tx, { ..., levels: [{ checkerRoles: ["ORG_CHECKER"] }, { checkerRoles: ["<PRODUCT>_PARTNER"], checkers: 2 }] })`: up to five levels, decided in order. Level 1's roles must be among the action's checker roles; its checkers are at least what the risk class asks. Every checker is a different person: never the maker, never someone who decided at an earlier level, never an agent. A rejection at any level ends the request, and the delay window starts only when the last level approves. `ApprovalRecord.currentLevel` and `currentLevelApprovals` show progress; the Work Inbox gives each level's checkers their item when that level opens. Run migration `tenancy/0023`. **Shims removed:** chaining one request per level (LawDocsComply, Finbyx).

## 7bv. Projections without decision records (PR-LDC-49; R1-D-139)

Create a rule set for forecasts and what-if views with `createRuleSet(ctx, { key, ownerModule, purpose: "projection" })`, publish it as usual (R4), and run `rules.project(ctx, { ruleSetId }, inputs)` for up to 1,000 inputs: you get `{ outcome, outputs, reason }` per input, no decision id, no decision record, no ledger entry and no review item. A projection set cannot be evaluated as a decision, and a decision-grade set cannot be projected (`IPB-RULE-003`), so anything you act on still comes from `evaluate` and is recorded. Run migration `rules/0004`. **Shim removed:** evaluating decision-grade sets in a loop for forecasts (and the decision records it left).

## 7bw. A shared rate limit (PR-LDC-54; owner answer #129; R1-D-149)

For a public or token-authenticated route, build one `RateLimiter({ pool, product, root })` per process (`root` is your blind-index root: `loadBlindIndexRoot(secrets, { appEnv, product })`, `localBlindIndexRoot()` below staging) and call `limiter.consume({ tenantId }, "ldc.public_read", token, { limit, windowSeconds })` before the work. It counts in PostgreSQL, so every pod shares the window; it throws 429 `IPB-SEC-019` past the limit (`rateLimitHeaders(result)` gives `Retry-After` and the `RateLimit-*` headers), and `hit` returns the result without throwing. Read `limit` and `windowSeconds` from settings you register (IPB-07). The key is stored only as a keyed hash, and a hit writes no ledger entry. Schedule `new RateLimitSweep({ kernel, audit }).sweep(tenantSweep)` daily: it deletes only counters whose window has ended and writes one ledger entry per tenant and run. Run migration `tenancy/0024`. **Shim removed:** your in-process counter.

## 7bx. Item bounds on list settings (PR-LDC-56; R1-D-145)

A `string[]`, `enum[]` or `cidr[]` setting may declare `minItems`, `maxItems` and `uniqueItems` (in `settings-tree.yaml`: `min_items`, `max_items`, `unique_items`; in a product's own `SettingDef`, the camel-case names). "At least two different approvers" is `minItems: 2, uniqueItems: true`. Every write path checks them (`set`, `setIn`, the execution of an approved change), a stored value that breaks them is ignored on read like any invalid value, and a registry whose definition puts bounds on a non-list type, inverts them or has a default outside them fails when it is built, so the mistake shows at boot. There is no `validate(value)` hook: product code does not run inside the settings write path. **Shim removed:** your own approver-list check.

## 7by. Rules over a history: prepared facts (PR-LDC-58; R1-D-147)

The rule engines evaluate only the declared inputs a decision records, so replay, `explain`, simulation and as-of evaluation give the same answer later. A rule never reads a history itself: CEL list functions such as `filter` or `size` are refused when the draft is validated. Instead, derive each fact from your own records **as of the decision date** and pass it as an input: for example `late_filings_12m` (integer), `open_filings` (integer) and `facts_as_of` (date), each declared with its data class (above INTERNAL it is sealed in the decision log). Compute the facts once per decision, in the same read that loads the record, and pass the same `asOf` to `evaluate`. Name them for what they count and over which window (`_12m`, `_90d`), never reuse a name with a different window, and keep the derivation in one tested function. `packages/connectors/src/rules/__tests__/prepared-facts.test.ts` is a worked example on all three engines.

## 7bz. The obligation feed (spec v1.5; PR-LDC-33; R1-D-151)

A consumer of `in.infrabyx.grc.ObligationPublished.v1` validates with `obligationPublishedProblems(envelope)` (an empty list means valid), processes each `(obligation_ref, version)` once, stores a lower `version` that arrives after a higher one without applying it, and pulls the obligation's text, citations or owner from `GET /v1/grc/obligations?updated_since=` when it needs them. The event carries ids and keys only (`dataclass = INTERNAL`); anything else, including text, is refused. The producer emits it under the canonical type, never `in.lawdocscomply.cnt.ObligationPublished.v1` (spec §6.17).

## 7ca. Letterhead text, a cover and a subdomain (PR-LDC-43; R1-D-153)

The tenant brand layer takes three more optional fields, proposed and approved like the rest (R3): `letterhead_text: { header?, footer? }` (plain text, at most 2,000 characters each, new lines allowed, no markup and no `javascript:` or `data:` links), `cover` (an asset in the tenant's storage: PDF, PNG, JPEG or an SVG from `uploadSvg`), and `subdomain` (one label, for example `acme`, served as `acme.<your pack's app host>`). `resolveForTenant` and `resolveHost` return `letterheadText`, `cover` and `subdomain`. Your deployment keeps the wildcard DNS record and certificate for the app host; the subdomain resolves once the app host is verified. Reserved labels (`www`, `api`, `admin`, `login`, product codes and similar) and `xn--` labels are refused. **Shim removed:** your letterhead-text, cover and subdomain tables.

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
