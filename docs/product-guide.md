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
  - From the next `tenancy` minor the inbox can verify it and keep it beside the event instead: `receive(ctx, envelope, { jws })` with the `regulated` option (§7eh).
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

1. **Run Keycloak with the extension.** Build `infra/keycloak/customer-otp` (`docker build -t <you>/keycloak-customer:26.8.2-0 infra/keycloak/customer-otp`) and run that image instead of the stock one. Apply the realm in your deploy job: `KeycloakCustomerIdentity.applyCustomerRealm({ baseUrl, masterAdmin, spec: { realm: "<product>-customers", apiClientId, adminClientId, audience, customerRoles: ["<P>_CUSTOMER"] } })`. It refuses a Keycloak without the extension. Keep the two client secrets it returns in SECRETS. On Zitadel, `ZitadelCustomerIdentity.applyCustomerOrg(...)` creates the customer organisation, application and login client.
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
7. **Upgrade note.** Rebuild the image whenever the platform moves the Keycloak pin. It moved to Keycloak 26.8.2 on 12 Nov 2026 (R1-D-134): `keycloak/keycloak:26.8.2-0@sha256:3879c623…`, the 26.8.2 image as first pushed. Pin it by digest, not by the `26.8.2` tag, which Keycloak has since moved to later rebuilds. Rebuild now, and run the IdP with the same digest wherever you pinned 26.8.1-2. Before that it moved to the 26.8.1-2 rebuild on 7 Nov 2026 (R1-D-110). The rebuild clears CVE-2026-91415; four base-image findings stay waived to 20 Dec 2026 by the owner (#124, R1-D-109; CVE-2026-91403 is an accepted risk, see the threat model) until a Keycloak or UBI release carries their fixes (`infra/docker/trivyignore.yaml`), so carry the same waivers in your own image scan.
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
- **Services that open their own mutation (PR-UDF-033, PR-FBX-21; R1-D-48).** Use `kernel.ambient(ctx, (tx) => idempotent(tx, req.idempotency, work, { audit }), { action })` in place of `kernel.mutate`. Every `kernel.mutate` your services and the platform's engines make inside `work`, on the same `PgKernel`, then joins that transaction in a kernel savepoint. Each joined call keeps its own action, reason and ledger check. A joined call that throws rolls back alone, and the handler decides. Joined calls must be the same tenant and person, and run one at a time (no `Promise.all`); from the next `tenancy` minor another person of the tenant joins as themselves, another tenant runs on its own and a `Promise.all` is queued (§7dq). Reads keep their own read-only transaction, so they do not see the handler's uncommitted writes, unless the handler passes `joinReads: true` (§7cm). Run `infrabyx-migrate` (`tenancy/0015`): keys now belong to the person who first used them. `IdempotencyKeyInterceptor` hashes the route parameters too, so a request in flight across the upgrade may get 409 instead of a replay.
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

### The realm half (PR-FBX-49; R1-D-182)

Give the IdP the same floor, so it challenges your staff for a second factor instead of the API refusing them:

```ts
const floor = mfaFloor({
  roles: ["<PRODUCT>_MAKER", "<PRODUCT>_AUDITOR"],
  smsExcludedRoles: ["ORG_CHECKER"],
});
await KeycloakIdentity.applyRealm({
  baseUrl,
  masterAdmin,
  spec: { ...spec, productRoles, mfaFloor: floor },
});
const identity = new KeycloakIdentity({ ...options, mfaFloor: floor });
await identity.requireMfaEnrolment(); // once after a new or wider floor; ledger the counts
```

- **Keycloak:** every role on the floor carries the MFA marker role, and a user who gets one (on creation or through a sync) gets the MFA enrolment action; applying the realm again adds missing roles and markers to a realm that already exists (never removes one). A floor role the realm does not have fails `ipbRealm` (add it to `productRoles`). `requireMfaEnrolment()` gives the action to users who already hold a floor role and have no OTP or WebAuthn credential, and returns `{ checked, flagged }`. For an SMS-excluded role the enrolment action is always TOTP or WebAuthn (`KEYCLOAK_NON_SMS_ENROLMENT_ACTIONS`); Keycloak itself offers no SMS factor. Tokens report RFC 8176 `amr` (`pwd`, `otp`, `hwk`).
- **Zitadel:** every organisation forces MFA for every user, so every floor role is covered, and the only second factors are TOTP and U2F (`readSettings()` reads them back; never SMS or email OTP). The adapter now keeps Zitadel's own `amr` values (`otp`, `user`, plus `webauthn` for `user`), so an SMS-excluded role signs in with TOTP or a security key; with `connectors` 1.19 and earlier every such session was refused (fail closed).
- **Local stacks:** staff who enrolled a factor by hand keep it; re-apply the realm and run the sweep once.
- **Assign floor roles directly (owner answer #138 (4)).** The platform assigns realm roles to users directly, and `requireMfaEnrolment()` reads only direct holders of a floor role: a role granted through a Keycloak group is not seen by the sweep. Do not grant a floor role through a group until the platform's sweep walks groups (a backlog item, built before any tenant needs it).

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

## 7cb. Reading an uploaded workbook (PR-LDC-31 reader; R1-D-154)

After the upload passes the AV scan, call `readXlsx(bytes, limits?)` (`@infrabyx/export`) to get `[{ name, rows }]`, where each row is an array of `string | number | boolean | null` (dates as `YYYY-MM-DD`, or a full ISO time when the cell has one). `xlsxRecords(sheet)` keys rows by the header row. Formulas are never returned, only their cached values. Raise or lower the limits for your use (defaults: 25 MiB file, 100,000 rows, 1,024 columns, 32,767 characters a cell). Map `IPB-SEC-013` to "the file is too large", `IPB-SEC-012` to "macros or active content are not accepted" and `IPB-SEC-010` to "this is not a readable workbook". **Shim removed:** the reader half of your `WorkbookPort`, so ExcelJS is no longer needed.

## 7cc. Evidence and provider-incident payloads (PR-LDC-45, PR-LDC-51; owner answer #131; R1-D-155)

Validate `in.infrabyx.grc.EvidenceSubmitted.v1` with `EvidenceSubmittedData` and `in.infrabyx.platform.ProviderIncident.v1` with `ProviderIncidentData` (`@infrabyx/contracts/events`). Evidence carries `https` or `storage:` references with their SHA-256, never files. A provider incident is `dataclass = INTERNAL` and never carries a tenant id.
**Severity scale** (`PROVIDER_INCIDENT_SEVERITIES`; the Specification names none, the owner fixed this one). Choose by the impact on your callers when you emit, and emit again with the same `incident_id` when it changes:

| Severity                                                                                                    | Meaning                                                                                 |
| ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `SEV1`                                                                                                      | A capability is unavailable and no adapter is serving it (no failover)                  |
| `SEV2`                                                                                                      | The capability works for few callers, or a failover is serving it with reduced function |
| `SEV3`                                                                                                      | Partial or intermittent degradation; the capability works for most callers              |
| `SEV4`                                                                                                      | No caller-visible impact: a failover with full function, or a precautionary block       |
| This is not the `CRITICAL` to `LOW` scale of `VulnerabilityRecorded`, which rates a finding, not an outage. |

## 7cd. Storage compartments for board papers and sealed material (PR-LDC-60; R1-D-158)

Put an object in a compartment with `storage.put(key, body, { bucketClass: "CONFIDENTIAL", compartment: "BOARD_CONFIDENTIAL" })` (or `SEALED`; either in `CONFIDENTIAL` or `REGULATED`, which keep their lock and retention rules). `get` returns the compartment in `meta`, `presign(key, "put", ttl, { bucketClass, compartment, contentType })` gives an upload URL bound to it, and an object never moves between compartments or out of one.

- **Configure** each compartment you use: `compartmentBuckets` (setting `int.storage.bucket.{class}.{compartment}`) and, on `s3`, `compartmentKmsKeyIds`. Every compartment bucket and key must differ from every other bucket and key, or the adapter refuses to start. A write to a compartment you have not configured is refused (`IPB-PORT-001`), never sent to the class bucket.
- **Tenants with their own CMK:** `tenantKmsKeyId(tenantId, { bucketClass, compartment })` must return a separate key for each compartment. If it returns the tenant's general key, no key, or a key another compartment uses, the write is refused. A single-argument function written before compartments therefore fails closed for compartment writes and works as before for the rest.
- **Infrastructure:** turn on the locations you use with the `platform` module's `storage_compartments` input (AWS, Azure and GCP alike; default `[]`, nothing created), for example `storage_compartments = [{ class = "CONFIDENTIAL", compartment = "BOARD_CONFIDENTIAL" }]`. Each location gets its own bucket (Azure: storage account with the container `objects`) with its class's lock, retention, DR copy and access controls, under its own key, never the platform key. The output `storage.compartments` maps `"<CLASS>.<COMPARTMENT>"` to `{ bucket, key_id }`: write `bucket` to the setting `int.storage.bucket.<class>.<compartment>` (lower case, for example `int.storage.bucket.confidential.board_confidential`) and, on AWS, `key_id` to `compartmentKmsKeyIds[<COMPARTMENT>][<CLASS>]`. On Azure and GCP the key is the account's or bucket's default encryption and the adapter needs no key id. Creating them in an environment is your production configuration (and adds a key and a bucket per location to the bill). Limit each compartment key's policy to the workloads that handle that material.

## 7ce. An accessible data grid (PR-LDC-32; R1-D-159)

`DataGrid` (`@infrabyx/ui`, a client component) edits rows on the WAI-ARIA grid pattern. Pass `id`, `label`, `columns` and `rows` (each row has a stable `id`). A column has `key`, `header` and a `type`: `text` (`maxLength`), `number` (`min`, `max`), `date` (ISO `YYYY-MM-DD`, `min`, `max`), `enum` (`options`) or `boolean`, plus `required`, `readOnly`, `rowHeader` and an optional `validate(value, row)` that returns a message to refuse the value. `onCellChange(rowId, columnKey, value)` receives typed, valid values only; a refused edit stays open with its message linked to the editor (`aria-invalid`, `aria-describedby`) and announced politely. `selection` (`"single"` or `"multiple"`) with `onSelectionChange` adds row selection. Only a window of rows is in the DOM (`viewportRows`, default 10, plus `overscan`, default 5), with `aria-rowcount` and `aria-rowindex` giving the full size, so 10,000 rows stay fast. Server code can check a posted value with the same rules through `checkCell(column, draft, row, t)`.

- **Keyboard:** one tab stop; the arrows move a cell; Home and End go along the row, Ctrl+Home and Ctrl+End to the first and last cell; PageUp and PageDown move a page; Enter or F2 edits, Enter saves and Escape cancels; Space selects the row and Ctrl+A every row (multi-select). Tab out of an editor keeps a valid value and drops a refused one with an announcement.
- **Column mapping:** `ColumnMapper` (`sources`, `targets`, `defaultMapping`, `onMappingChange`) maps file columns to fields by drag and drop, and never only by dragging (WCAG 2.2 SC 2.5.7): each field has a `<select>` of every column (with `name`, the selects post as `<name>.<field key>` without script); on a column, Space picks it up, the arrows choose the field, Enter drops and Escape cancels; or click a column and then the field's "Map ... to ..." button. A column feeds one field at most, and `unmappedRequired(mapping, targets)` lists the required fields still empty.
- Labels come from the `ui.grid.*` and `ui.mapper.*` catalogue keys (en-IN, hi-IN); pass `locale` from a server component, or `t`. Validators and callbacks are functions, so pass them from a client component.

## 7cf. Text from uploaded PDFs (PR-LDC-39; R1-D-160)

After the upload passes the AV scan, call `extractText({ file, scan, limits? })` on `PdfTextExtractor` (`@infrabyx/connectors/pdf`, built with your tenant's STORAGE), where `scan` is the `FileScanResult` that `FileScanPort.scan` returned for the same file. You get `{ pages: [{ index, text, needsOcr }], pageCount, truncated? }`: `index` counts from 1, lines end with `\n`, and a page with no readable text layer (a scan, an image, a filter other than FlateDecode) is `needsOcr`, for the OCR port when it comes. `truncated` means the text limit was reached and later pages are missing. Lower the limits for your use if you like (defaults: 25 MiB file, 500 pages, 30 s; the platform caps every limit). Map `IPB-SEC-011` to "this file contains malware", `IPB-SEC-015` to "the file has not been scanned yet, or changed since", `IPB-SEC-013` to "the file is too large or too complex" (`meta.reason` is `limit`, `timeout` or `memory`) and `IPB-SEC-010` to "this is not a readable PDF" (`meta.reason` `encrypted` for a password-protected one). Test against `new FakePdf(storage)` with `pdfFixture(pages)` and `pdfTextContractCases(storage)` (`@infrabyx/testing`). **Shim removed:** your local PDF text parser.

## 7cg. Showing a CONFIDENTIAL input in "Why this?" (PR-LDC-59; owner answer #130; R1-D-173)

`explain` still returns values for PUBLIC and INTERNAL inputs only. To show one CONFIDENTIAL input of one decision to a person your own access policy allows (for example a board secretary reviewing a classification), register your rule once and ask for a grant each time:

```ts
const rules = new RulesService({
  ...options,
  revealRule: {
    id: "ldc.board.reveal", // your rule's stable id, recorded in the ledger
    allows: async (ctx, { decisionId, input, purpose }) => myPolicy.canSee(ctx, decisionId, input),
  },
});
const grant = await rules.entitleReveal(ctx, {
  decisionId,
  input: "score",
  purpose: "board review",
});
const why = await rules.explain(ctx, decisionId, { reveal: grant }); // inputs[i].revealed === true
```

- **What is refused** (`IPB-RULE-004`, `meta.reason`): REGULATED, INTERNAL or undeclared inputs, a decision whose inputs were not recorded, another tenant's decision, agents, platform contexts and `PLT_*` roles, break-glass, impersonation and external principals, a purpose outside 3 to 200 printable characters, your rule saying no or throwing; and at `explain`, a grant that is reused, older than 60 seconds, from another service instance, for another decision or principal, or a copy of a grant.
- **Grants are in-process objects.** Do not send one to a browser or store it; ask and use it in the same request, on the same instance.
- **Ledger:** each reveal writes `rules.decision.input_revealed` with the decision, grant, `input:<name>` and `rule:<id>` as business ids (`AuditService.history`), and the purpose under the entry's digest. Keep the purpose text in your own record of the request if you need it readable. Never put personal data in the purpose.
- **Nothing is written back:** show the value and drop it; do not store it unsealed. Test your wiring with `defineRulesRevealContract` from `@infrabyx/testing`.
- **LawDocsComply:** wire `revealRule` to your board-paper access policy, and use it only where a CONFIDENTIAL input is needed in the classification trace.

### The purpose code and refused reveals (owner answer #132 (4), (5); R1-D-187)

Take the `contracts`, `audit`, `rules`, `config` and `testing` minors after 1.35.0, 1.10.6, 1.5.4, 1.18.1 and 1.21.0, and run `infrabyx-migrate` for `audit/0012`. A service with `revealRule` now needs the security record and the alert, or it refuses to start:

```ts
import { PgSecurityEvents } from "@infrabyx/audit";
import { RateLimiter } from "@infrabyx/tenancy";

const rules = new RulesService({
  ...options, // with `outbox`
  revealRule: {
    id: "ldc.board.reveal",
    purposeCodes: ["board_review", "internal_audit"], // optional; default REVEAL_PURPOSE_CODES
    allows: async (ctx, { decisionId, input, purposeCode }) =>
      myPolicy.canSee(ctx, decisionId, input, purposeCode),
  },
  securityEvents: new PgSecurityEvents({ pool }),
  refusalCounter: rateLimiter, // your shared RateLimiter
  revealRefusalAlert: {
    threshold: await settings.get(platformCtx, "rules.reveal.refusal_alert_threshold"), // 5
    windowMinutes: await settings.get(platformCtx, "rules.reveal.refusal_alert_window_minutes"), // 15
  },
});
await rules.entitleReveal(ctx, {
  decisionId,
  input: "score",
  purpose: "board review",
  purposeCode: "board_review",
});
```

- **Purpose code.** Every request names a code from your list (`^[a-z][a-z0-9_]{2,31}$`; the platform list is `customer_request`, `complaint`, `dispute`, `internal_audit`, `external_audit`, `regulatory_request`, `legal_proceedings`, `fraud_review`, `quality_review`). A missing or unlisted code is refused `purpose_code_invalid`. The reveal's ledger entry carries `purpose:<code>` as a business id, readable in `AuditService.history`; the free text stays under the digest.
- **Refused reveals.** Every refusal (`IPB-RULE-004`) is kept in `audit.security_event` (kind `rules.reveal.refused`): who, when, which decision and input, the reason, the purpose code and your rule's id; never the value or the purpose text, and no business-ledger row. Read it in the tenant's context (RLS); nobody can change or delete a row.
- **Repeated refusals.** The refusal that reaches the threshold for one principal within the window raises one internal event `in.<product>.security.RevealRefusalsRepeated.v1` (principal, count, window, last reason), once per window, ledgered as `rules.reveal.refusals_repeated` by `svc_rules_security`. Route it to your security on-call as you route `BreakGlassGranted`.
- **Your own contract tests** (`defineRulesRevealContract`) now send `purposeCode: "internal_audit"`; a fixture with its own `purposeCodes` must include that code.

## 7ch. Dated, cited and locked rule parameters (PR-LDC-57; R1-D-146, R1-D-175)

A threshold fixed by an instrument (a statute, a regulation, a circular) is not a tenant choice. Declare it as a **dated parameter**: it names a platform parameter schedule instead of a setting, and takes the entry in force on the decision's day.

```ts
// In the rule set body: no `setting`, no `default`.
parameters: [{ name: "auditThreshold", type: "integer", schedule: "stat.companies.audit_threshold", min: 0 }],
```

**Publishing a schedule (platform staff, a platform context).**

```ts
await rules.createSchedule(platformCtx, { key: "stat.companies.audit_threshold" });
const { version } = await rules.saveScheduleDraft(platformCtx, "stat.companies.audit_threshold", {
  format: "ipb.parameter_schedule.v1",
  type: "integer",
  entries: [
    {
      value: 1000,
      effectiveFrom: "2025-04-01",
      citation: { instrumentRef: "…", section: "…", url: "https://…" },
    },
    { value: 2000, effectiveFrom: "2026-04-01", citation: { instrumentRef: "…", section: "…" } },
  ],
});
const { approvalId } = await rules.publishSchedule(
  platformCtx,
  "stat.companies.audit_threshold",
  version,
  {
    effectiveFrom, // optional cut-over of the version, as for rule sets (§7bk)
  },
);
// A second platform checker approves `rules.ruleset.publish` (R4); it executes after the delay.
```

- **Entries:** 1 to 500, in strictly ascending `effectiveFrom` (YYYY-MM-DD) without overlap; each value of the schedule's `type`; each with `instrumentRef` (1 to 128 printable characters) and `section` (1 to 64), `url` https only. An entry is in force from 00:00 IST on its date until the next entry's date; the last one is open-ended.
- **Corrections:** a published version never changes. Save a new version with `reason` (required from version 2 on); the type cannot change. A rejected request is returned to draft with `reopenSchedule`.
- **Keys:** dotted lower case under your own prefix; never a product or tenant name in platform code.

**Evaluating.** `evaluate(ctx, { ruleSetId, asOf })` takes the entry in force on `asOf`'s calendar day in India time (or today), from the schedule version in force at that instant, so an old decision replays with the value known then. The parameter is locked: a setting of the same name is never read and there is no default. With no entry in force the decision is `UNDETERMINED` with reason `parameter_not_in_force` and goes to the human queue. A schedule version applies only from its publication, so an `asOf` before the schedule's first publication is `parameter_not_in_force` (as a rule set before its first publication is `IPB-RULE-002`). If you work in another time zone, pass `asOf` at your own midnight.

**"Why this?"** `explain` returns, for each dated parameter, `{ name, value, source: "schedule", schedule: { key, version, effectiveFrom, citation } }`. Show the citation beside the value.

**Drafting a rule set** that names a schedule is refused (`IPB-RULE-001`, `meta.parameter`, `meta.schedule`) when the schedule is unknown or has no published version, is of another type, or has an entry in force now or later outside the parameter's `min`, `max` or `values`. Read schedules with `listSchedules(ctx)` and `getSchedule(ctx, key, version?)` from any context.

**LawDocsComply:** move your dated parameter table into platform schedules under your own key prefix, declare those parameters with `schedule`, and remove the shim once every rule set reads them (PR-LDC-57). Migration `rules/0005` comes with `rules` (run `infrabyx-migrate`); no setting or environment variable is added.

## 7ci. Web snapshots as evidence (PR-LDC-40; R1-D-176)

Keep a dated, hashed copy of a public page (a regulator's circular, a notice) with `PlatformWebSnapshot` from `@infrabyx/connectors/web-snapshot`, over the `governed` EGRESS adapter (`@infrabyx/connectors/egress`), your STORAGE and AV adapters and the shared `RateLimiter`:

```ts
// readSetting: your product's read of a registered setting (SettingsService) for the tenant.
const egress = new GovernedEgress({
  enabled: () => readSetting(null, "int.egress.governed.enabled"),
});
const snapshots = new PlatformWebSnapshot({
  kernel,
  audit,
  egress,
  storage,
  av,
  rateLimiter,
  enabled: () => readSetting(null, "int.web_snapshot.enabled"),
  allowHosts: (tenantId) => readSetting(tenantId, "int.web_snapshot.allow_hosts"),
  perHour: () => readSetting(null, "int.web_snapshot.per_hour"),
});
const s = await snapshots.archive(ctx, {
  url: "https://www.example.gov.in/notification/123",
  outputPrefix: `tenant/${ctx.tenantId}/evidence`,
  reference: obligationId, // ledger business id
});
// s.state: RELEASED, QUARANTINED (scan ERROR: call rescan later) or REJECTED (infected)
const { body, headers } = await snapshots.open(ctx, s.id); // serve exactly these headers
```

- **Allow-list first.** Nothing is fetched until the tenant's ORG_ADMIN lists hosts in `int.web_snapshot.allow_hosts` (exact names or `*.suffix`; R4 maker-checker). Seed the regulator hosts your product needs per tenant. Both switches (`int.egress.governed.enabled`, `int.web_snapshot.enabled`) are off by default and PLT_SUPER_ADMIN turns them on under R4, once the deployment's network policy for egress is in place.
- **What is kept.** Only HTTP 200, only HTML, XHTML, plain text, PDF, PNG, JPEG, GIF or WebP (a binary type must start with its signature), at most 10 MB and 20 seconds by default (`limits`, capped at 25 MB and 60 seconds), up to 5 redirects. The record holds the requested and final URL, the redirect chain, the media type, charset, encoding, size, SHA-256 and `fetchedAt`; `fetchedAt` is the evidence time.
- **Serving a copy.** Always use the headers `open` returns (an attachment, `nosniff`, a sandboxing CSP, `no-store`); never render the HTML inline on your origin.
- **Retention.** The platform sets none. Pass `retainUntil` for a write-once copy under your retention schedule.
- **Who.** A tenant user or service in its own tenant. Agents, impersonation, external principals, break-glass and platform staff are refused.
- **Migration and export.** Run `infrabyx-migrate` for `connectors/0006`, and add `connectors.web_snapshot` to your product's export map (the copies themselves are in your tenant's STORAGE).
- **Tests.** `defineWebSnapshotContract` and `FakeWebSnapshot` from `@infrabyx/testing`.
- **Shim removed:** your own fetch-and-store.

## 7cj. Inbound email replies (PR-LDC-50; R1-D-177)

Invite a reply by email and receive it as a ledgered, scanned record. Ask for replies on the notification, wire the inbound route, and read each accepted reply:

```ts
// 1. Ask for replies: each email delivery carries reply+<token>@<ntf.reply.domain>.
await notify.send(ctx, {
  class: "matter.note_requested",
  to: [{ ref: userId }],
  vars: { matter: "M-42" },
  deepLink: "/matters/M-42",
  idempotencyKey: `note-${noteId}`,
  reply: { threadRef: matterId },
});

// 2. The inbound webhook route (SES receiving through its own SNS topic).
const ses = new SesEmail({
  ...sesOptions,
  inbound: { topicArn, bucket: { name, region: "ap-south-1" } },
});
app.post("/hooks/email/inbound", async (req, res) => {
  const messages = await ses.verifyInbound(req.rawBody, req.headers); // throws if unverified: answer 400
  const r = await notify.receiveReplies(messages); // { accepted, duplicate, dropped }
  res.status(200).end();
});

// 3. React to the outbox event NotificationReplyReceived { reply_id, thread_ref, recipient_ref, attachments }.
const reply = await notify.getReply(ctx, replyId); // { threadRef, recipientRef, text, attachments[] }
```

- **Wiring.** Pass `replies: { storage, av, onDrop }` to `NotifyService` (attachments are quarantined in your tenant's STORAGE and scanned; `onDrop(reason)` feeds your metrics). Without `replies`, a reply with an attachment is dropped.
- **Settings (per tenant, off by default).** `ntf.reply.enabled` and `ntf.reply.domain` (ORG_ADMIN, R4 maker-checker); `ntf.reply.token_days` (30, 1 to 90). Each address accepts at most 50 replies.
- **DNS and SES (your production configuration).** Point the reply subdomain's MX at SES receiving in ap-south-1 (`inbound-smtp.ap-south-1.amazonaws.com`), add a receipt rule for that domain with an SNS action (messages up to 150 KB) or an S3 action into a bucket in India (up to 10 MiB), and publish to an SNS topic of its own, never the delivery-events topic. The adapter refuses the events topic for inbound.
- **What is accepted.** One reply address among the recipients; a live token in the tenant whose `ntf.reply.domain` it names; the original recipient as the only `From`; DMARC pass from SES's signed verdict (or, where the sender's domain has no enforcing policy, aligned DKIM and SPF on the sender's own domain); the size bounds. Everything else is dropped and counted; nothing of it is stored.
- **What you get.** The reply's own text (quoted history and signature removed, HTML converted to text, at most 20 000 characters) and its attachments with their scan state: only `RELEASED` attachments may be offered for download; `QUARANTINED` ones are rescanned by you later, `REJECTED` ones never served. Treat the text as untrusted input: never render it as HTML.
- **Migration and export.** Run `infrabyx-migrate` for `notify/0007`, and add `notify.reply` and `notify.reply_token` to your export map. The platform sets no retention on replies; that is your retention schedule.
- **Brevo.** Brevo sends with the reply address, but has no inbound route (owner question #135).
- **Tests.** `FakeInboundEmail` and `defineEmailInboundContract` from `@infrabyx/testing`.
- **Shim removed:** your own inbound mailbox parser.

## 7ck. Posting to TallyPrime through the agent (PR-FBX-46; R1-D-137, R1-D-178)

Post journal batches into a tenant's TallyPrime books and read the trial balance back, through an agent the tenant runs next to TallyPrime. The agent dials out to your API; nothing dials into the tenant's office.

```ts
import {
  TallyAccountingSink,
  TallyAgentGateway,
  TallyAgentService,
} from "@infrabyx/connectors/accounting";

// 1. Enrolment (people only): R3 maker-checker, then a one-time code shown once to an admin.
const agents = new TallyAgentService({ kernel, audit, approvals });
const { approvalId, agentId } = await agents.requestEnrolment(ctx, { name: "Head office", company: "Acme Finance Pvt Ltd" });
// … a different person approves approvalId in the Work Inbox …
const { code, expiresAt } = await agents.issueCode(adminCtx, agentId); // show once; 30 minutes

// 2. The agent API, mounted under your own API (raw body, lower-case headers).
const gateway = new TallyAgentGateway({
  kernel, audit, pool,
  enabled: (tenantId) => settings.get(tenantCtx(tenantId), "int.accounting.tally.enabled"),
  pollTimeoutSeconds: () => settings.get(platformCtx, "int.accounting.tally.poll_timeout_seconds"),
});
app.all("/v1/accounting/agent/*", async (req, res) => {
  const r = await gateway.handle({ method: req.method, path: req.path, headers: req.headers, body: req.rawBody });
  res.status(r.status).set(r.headers).send(r.body);
});

// 3. The port, as any ACCOUNTING sink.
const sink = new TallyAccountingSink({ kernel, audit, enabled: (t) => settings.get(…, "int.accounting.tally.enabled") });
const r = await sink.post(batch); // PENDING until the agent reports; then ACKNOWLEDGED with TallyPrime's GUIDs
await sink.status(batch.journalId);
await sink.trialBalance("2026-11-30"); // in paise
```

- **What the tenant runs.** The image built from `infra/docker/tally-agent/Dockerfile` (build, sign and attest it in your own release, as for your other images), with `config.json` mounted read-only at `/etc/infrabyx-tally-agent/config.json` (`{"platformUrl": "https://<your API>", "tallyUrl": "http://<TallyPrime host>:9000"}`; TallyPrime must be on a loopback or private address), a volume of its own at `/data`, and the one-time code written to `/data/enrol-code`. It listens on no port. No Windows installer is shipped (owner answer #128).
- **Scheduler.** Call `sink.expireStale(ctx)` per tenant daily: postings no agent took within `int.accounting.tally.job_expiry_days` (7) are rejected `agent_unreachable`, so people see them.
- **Outcomes.** `REJECTED` carries a reason code: `ledger_unknown`, `voucher_type_unknown`, `period_closed`, `company_not_open`, `duplicate_voucher`, `remote_mismatch` (a different voucher already has the REMOTEID), `remote_duplicate` (two do), `tally_unreachable`, `tally_error`, `agent_unreachable`. Fix the cause and `replay(journalId)`: vouchers already in TallyPrime are found and acknowledged, never created twice. Nothing is ever altered or deleted in TallyPrime.
- **Settings.** `int.accounting.tally.enabled` (TENANT, off, ORG_ADMIN, R4); `int.accounting.tally.poll_timeout_seconds` (25, 1 to 55); `int.accounting.tally.job_expiry_days` (7, 1 to 30).
- **Revocation and rotation.** `agents.revoke(ctx, agentId, reason)` refuses the agent's next call; enrolling again replaces the active agent (one per tenant).
- **Migration and export.** Run `infrabyx-migrate` for `connectors/0007`, and add `connectors.tally_journal`, `connectors.tally_read` and `connectors.tally_agent` to your export map.
- **Not yet proven.** No real TallyPrime runs in CI: the adapter is tested against a TallyPrime stub and stays off until a sandbox company exists (#128). Run your own pilot against a test company before you turn it on.
- **Tests.** `TallyPrimeStub` from `@infrabyx/tally-agent/stub` (in this repository) and `accountingContractCases` from `@infrabyx/testing`.

### The agent's key (owner answer #136 (4); R1-D-184)

Take `contracts` and `connectors` (the minors after 1.34.0 and 1.19.0), run `infrabyx-migrate` for `connectors/0008`, and build agent 1.1.0. Show the agent's `warnings` and `rotationDue` (from `TallyAgentService.list` or `get`) in your console: `key_unencrypted` when the agent keeps its key in a file, a rotation notice from day 80, `key_expired` from day 90, when the gateway refuses the agent until it is enrolled again. Give tenants `docs/runbooks/tally-agent.md`: on Windows run the agent as a service under its own account so DPAPI protects the key, re-enrol before day 90, and revoke at once if the machine is lost or compromised.

### Key notices and re-enrolment (owner answer #139 (1); R1-D-186)

Take the `contracts`, `connectors` and `notify` minors after 1.35.0, 1.20.0 and 1.4.2, run `infrabyx-migrate` for `connectors/0009`, and build agent 1.2.0.

```ts
const agents = new TallyAgentService({
  kernel,
  audit,
  approvals,
  notify,
  agentLink: (id) => `/accounting/tally/agents/${id}`,
});
// Daily (or hourly), per tenant, as the job's own service principal:
await new TenantSweep({ kernel, audit }).run((ctx) => agents.sendKeyNotices(ctx));
```

- **Notices.** On day 80 and again on day 85 of an active agent's key, the tenant's active ORG_ADMIN and ORG_OWNER members (`adminRoles`) get `accounting.agent_key_expiring` (mandatory; in-app and email; variables `id`, `name`, `day`, `expires_on`), once each. Add the email template `accounting.agent_key_expiring` (en, hi) and the in-app title `ntf.accounting.agent_key_expiring.title` to your templates. The view's `keyNoticeDay` is the latest notice sent. Without `notify`, `sendKeyNotices` refuses (`IPB-UX-004`, `notify_missing`).
- **The 403.** From day 90 the refusal's `detail` tells the agent's operator how to re-enrol; agent 1.2.0 logs it.
- **Re-enrolment in place.** Agent 1.2.0 takes a new code from `<stateDir>/enrol-code` while it runs; no restart and no deleting of `agent.json`.

## 7cl. Runtime fakes without the test kit (PR-FBX-48; R1-D-181)

The fakes you wire in a fixture environment (below staging) now come from `@infrabyx/fakes`, a package with no `vitest`, Testcontainers or database driver in its tree. `@infrabyx/testing` re-exports the same objects, so test files change nothing.

1. Take `@infrabyx/fakes` 1.0.1 (its first published version) and `@infrabyx/testing` 1.21.0.
2. In runtime code, change `import { MemoryStorage, FakeKyc, … } from "@infrabyx/testing"` to `from "@infrabyx/fakes"`.
3. Put `@infrabyx/fakes` in `dependencies` and move `@infrabyx/testing` to `devDependencies`. If a Next.js app lists server-only packages in `next.config`, list `@infrabyx/fakes` there instead of `@infrabyx/testing`.
4. Run `pnpm audit --prod --audit-level high`: the `@infrabyx/testing > vitest > picomatch` path (GHSA-fc5q-39xc-vjpf) is gone, so the time-boxed audit exception for it can be removed.

Contract cases (`kycContractCases`, `defineContractSuite`, …), the NN suites, `startPostgres` and the vendor stubs stay in `@infrabyx/testing`.

## 7cm. Reads that see the handler's own writes (PR-UDF-037; R1-D-188)

From `tenancy` 1.21.0, `kernel.ambient(ctx, fn, { action, joinReads: true })` makes every `kernel.read` inside `fn` join the handler's transaction, so a later read sees an earlier call's uncommitted write. Without `joinReads` nothing changes.

- A joined read runs read-only, as the kernel's read role, with its own `app.*` settings, in a savepoint that is always rolled back: a write inside it fails (`25006`) and the handler's transaction carries on as it was.
- Joined reads run one at a time with the joined mutations, as joined mutations already do: no `Promise.all` of reads inside a `joinReads` handler (the second is refused with "one at a time"; queued from the next `tenancy` minor, §7dq). A read inside a joined mutation is fine.
- A `snapshot` read, a read for another tenant, person, scope or break-glass grant, and a support, external or platform service read keep their own transaction.
- **Udofin:** with `joinReads: true` on the handlers that need it, `AmbientKernel` (UDF-D-142) can go.

## 7cn. Refusal codes and retry waits in problem responses (PR-UDF-038; R1-D-189)

From `contracts` 1.37.0, `toProblem` adds two RFC 9457 extension members, and leaves the rest of `meta` inside the platform as before:

- `reason`: the error's `meta.reason` when it is a fixed snake-case label (`hash_mismatch`, `purpose_code_invalid`), so a client can branch on it. Anything else (a value, a sentence) is left out.
- `retry_after_seconds`: on a 429 or 503 whose `meta.retryAfterSeconds` is a whole number of seconds from 1 to 86400 (for example `IPB-SEC-019` from the customer sign-in limits).
- `problemHeaders(problem)` returns `{ "Retry-After": "<n>" }` when the wait is set. Set it on the response with the status, as the reference API's `ProblemFilter` now does.
- **Udofin:** its own `ProblemFilter` additions (UDF-D-146) can go; keep only the call to `problemHeaders`.

## 7co. The Aadhaar Secure QR beside the Offline e-KYC ZIP (PR-UDF-039; R1-D-190)

From the `contracts` minor that carries PR-UDF-039 (its version is in the STATUS release record), `kyc.verifyAadhaarOffline({ kind, file, shareCode })` names the form: `xml_zip` (the default, with its four-digit share code) or `secure_qr` (no share code; one is refused). The result's `kind` says which was verified.

- The adapter checks the stored object's SHA-256 against `file.sha256` before it parses or sends anything, and refuses a mismatch (`meta.reason: "hash_mismatch"`). No result field carries more than the last four digits (`aadhaarLast4`).
- **Secure QR is not verified by any platform adapter yet:** Digio and IDfy refuse it with `meta.reason: "unsupported"`, so keep offering the ZIP. `FakeKyc` accepts both forms, so a product can build the Secure QR path below staging now.
- **Udofin:** no shim to remove; offer the Secure QR only once an adapter verifies it.

## 7cp. OpenJDK images and CVE-2026-114938 ("Java4Shell"; owner answer #143, R1-D-192)

CVE-2026-114938 is memory corruption in HotSpot's Base64 intrinsic on x86-64 CPUs with AVX-512 VBMI, in unpatched OpenJDK 17.0.6 and later (21 and 25 included). Keycloak decodes Base64 from requests before authentication, and pre-authentication remote code execution on Keycloak has been demonstrated (Red Hat RHSB-2026-018; keycloak.org advisory of Nov 2026). No fixed Red Hat OpenJDK build was published on 19 Nov 2026. The mitigation is to turn the intrinsic off with `-XX:-UseBASE64Intrinsics` on **every** host, whatever its CPU: never decide by CPU type, because a node can be rescheduled onto another CPU.

1. **Keycloak:** run the platform's customer image (`infra/keycloak/customer-otp`, rebuilt from this release). Its entrypoint appends the flag last on every start, refuses `_JAVA_OPTIONS`, `JDK_JAVA_OPTIONS` or `JAVA_TOOL_OPTIONS` values that name it, and its build fails without it. Keep the image's entrypoint. If you run the stock Keycloak image, or must replace the entrypoint, set `JAVA_OPTS_APPEND` so that it **ends** with `-XX:-UseBASE64Intrinsics` on every node: cluster members, failover nodes, rolling-update replacements, and the job or init container that runs `kc.sh build`.
2. **Gotenberg** (its pdftk is a JVM): set `JAVA_TOOL_OPTIONS=-XX:-UseBASE64Intrinsics`. **OpenSearch**: append the flag to `OPENSEARCH_JAVA_OPTS` (it ignores `JAVA_TOOL_OPTIONS`). The platform's Compose file and test harness already do both, and LocalStack's in tests.
3. **Check the running JVM**, not only the definition: `jcmd <pid> VM.flags -all | grep UseBASE64Intrinsics` must print `false {command line}` (Keycloak, OpenSearch) or `false {environment}` (`JAVA_TOOL_OPTIONS`). For Gotenberg, whose JVM lives for one request, see `infra/docker/jvm-mitigation.e2e.test.mjs`.
4. **Check your own scans.** The platform's waiver (OWNER-WAIVER-CRIT-01 in `infra/docker/trivyignore.yaml`) covers only `java-21-openjdk-headless` 1:21.0.13.0.9-1.2.el9 in the pinned Keycloak 26.8.2-0 base, and only while the mitigation is proven. Copy it only if your image is that image with the same mitigation and its test; any other image with an OpenJDK runtime is your own decision. It ends when a fixed Keycloak image is published and pinned, 15 Dec 2026 at the latest; the platform then moves to that image in its own release, and you rebuild.

## 7cq. DigiLocker start, document evidence and keyed pulls (PR-UDF-040; R1-D-193)

From the next release (`contracts`, `fakes`, `testing` and `connectors` minors; versions in the STATUS release record), the KYC port starts a DigiLocker session for you and makes the pull safe to retry.

- **Start:** `kyc.startDigilocker({ docTypes, returnUrl }, call)` returns `{ consentSession, signInUrl, expiresAt }` with the usual evidence (`vendorRef`, `adapter`, `modelVersion`, `checkedAt`). Send the customer to `signInUrl`; once they are back at `returnUrl`, call `digilockerPull` with `consentSession`. The method is optional on the `KycPort` type (an implementer outside the platform does not break), but every platform adapter and `FakeKyc` have it; IDfy refuses it `unsupported`, and `kycMethodRouter` routes it with `digilockerPull` (the `digilocker` entry of its `order`).
- **Return address:** `https:`, no user name or password, no 12-digit run, and its host exactly one of the hosts you give the adapter: `new DigioKyc({ …, digilockerReturnHosts: (tenantId) => hosts, digilockerTemplate: (tenantId) => "<the tenant's Digio template with the DigiLocker step>" })`. Anything else is refused `IPB-PORT-001` with `meta.reason: "return_url_not_allowed"`; without a template the start is `not_configured`. Both default to nothing, so starts are refused until you set them.
- **Each document** now carries `evidence` (the pull's vendor reference, adapter, model version and time) and `signatureValid` (the issuer's signature as the vendor checked it, or `null` when the vendor does not report it: record "not reported"). Both are optional in the type and always set by the platform's adapters and the fake. Documents are in the STORAGE the adapter was built with, under the call's tenant, REGULATED; no storage key or issuer carries a 12-digit run.
- **Retries:** pass `call.idempotencyKey` on `digilockerPull`. A retry with the same key and request within 24 hours returns the documents the first pull stored, with no new vendor pull, instead of `consent_used`; the same key with another session or other document types is `IPB-PORT-004` (`meta.reason: "idempotency_conflict"`). `consent_incomplete` does not use the session up: retry it while the session lives.
- **Production store:** give the Digio adapter `pulls: new PgDigilockerPullStore({ kernel, audit, context: (tenantId) => <your KYC service context for the tenant> })`, so a retry on another instance finds the first pull (the default is an in-memory store of the adapter instance). The table comes with the `connectors` migration `0010_kyc_digilocker_pull.sql`; run your migrations. Call `purgeExpired(tenantId)` from a daily job, as for the idempotency records.
- **Tests:** `FakeKyc` starts sessions that stay incomplete until `fake.completeDigilocker(consentSession)`; `kycContractCases` gains the start, evidence and retry cases, and `KycFixtures.digilockerReturnUrl` (optional, default `DIGILOCKER_CONTRACT_RETURN_URL`) names a return address your adapter allows.
- **Udofin:** `DigilockerConsentPort` can call `startDigilocker` and pass its idempotency key to `digilockerPull`; record `signatureValid: null` as not reported (UDF-D-151). The Digio adapter stays off until the sandbox confirms its DigiLocker request and gateway address.

## 7cr. Aadhaar OTP e-KYC for a notified RE (PR-UDF-041; R1-D-194)

From the next release (`contracts`, `fakes`, `testing` and `connectors` minors; versions in the STATUS release record), the KYC port can run Aadhaar OTP e-KYC through the adapter's KUA, for a reporting entity notified under PML Act s.11A only.

- **Off unless you say so:** build the adapter with `notifiedEntity: true` (`new DigioKyc({ …, notifiedEntity: true })`, the same on `IdfyKyc` and `FakeKyc`). Without it every call is refused `IPB-PORT-001` `meta.reason: "not_configured"` before anything is sent. Set it only where the RE is notified (KYC Directions 2025 para 23 proviso (i); check the paragraph against the Directions as published). The adapters are also behind their `int.kyc.<vendor>.enabled` flags, off by default.
- **Step one:** `kyc.aadhaarOtpRequest({ uid, uidKind: "AADHAAR" | "VID", consent: { version, textHash, at } }, call)` returns `{ txn, expiresAt }` with the evidence. `uid` is digits only: strip spaces and hyphens first; a malformed number (12 digits, first 2 to 9, Verhoeff; 16 digits with Verhoeff for a VID) is `uid_invalid` before any vendor call. `aadhaarUidValid(uid, kind)` in `contracts` is the same check. Never log the number; the platform does not keep it.
- **Step two:** `kyc.aadhaarOtpVerify({ txn, otp }, call)` returns `{ ekyc, signatureValid, uidLast4 }` with the evidence. `ekyc` is UIDAI's signed e-KYC response, unchanged, in the adapter's STORAGE under the call's tenant, REGULATED, with its SHA-256; `signatureValid` is `null` when the KUA does not report it. A response that carries a full Aadhaar number or VID is not stored and is refused `ekyc_holds_number` (it would belong in your Aadhaar Data Vault).
- **Refusals,** all definite (do not retry the same request): `uid_invalid`, `mobile_not_linked` (ask for another method), `otp_invalid` (ask for the code again), `otp_expired` (expired, used or unknown: request a new OTP), `not_configured`.
- **Retries:** pass `call.idempotencyKey` on `aadhaarOtpVerify`. A retry with the same key, transaction and code within 24 hours gets the first answer (the result, or the `otp_invalid` or `otp_expired` refusal) with no vendor call; the same key with another code or transaction is `IPB-PORT-004` (`idempotency_conflict`). Use a new key for each code the resident types.
- **Production store:** give the adapter `aadhaarOtpVerifies: new PgAadhaarOtpVerifyStore({ kernel, audit, context: (tenantId) => <your KYC service context> })` (default: in memory per instance). The table comes with the `connectors` migration `0011_kyc_aadhaar_otp_verify.sql`; run your migrations and call `purgeExpired(tenantId)` daily. `IdfyKyc` gains `currentTenant` for the tenant it stores under.
- **Routing:** `kycMethodRouter` routes both steps as `aadhaar_otp` (a new `KycMethod`); keep one order for both, so the verify reaches the KUA that sent the OTP.
- **Tests:** `new FakeKyc({ notifiedEntity: true })` sends any well-formed number an OTP that `FAKE_AADHAAR_OTP` verifies (the fixtures' `unlinkedUid` has no mobile; `fake.expireAadhaarOtp(txn)` expires one). `KycFixtures.aadhaarOtp` (optional in the type; `syntheticUid(body)` makes test numbers) drives five new contract cases.
- **Udofin:** `AadhaarOtpEkycPort` can call these with the semantics of its UDF-D-152. The vendor request and response shapes are `[VERIFY]` and built against stubs only; both adapters stay off until the sandboxes confirm them.

## 7cs. One no-Aadhaar rule, a scanner and a test-database sweep (PR-UDF-042; R1-D-195)

From the next release (`contracts`, `testing` and `ai` minors, a `connectors` patch; versions in the STATUS release record), the platform has one rule for what reads as an Aadhaar number or a VID, and the tools to keep them out of your fixtures and test data.

- **The rule:** `findAadhaarLike(text, { letters? })` from `@infrabyx/contracts/aadhaar` returns `{ kind: "AADHAAR" | "VID", start, end, masked }[]`: 12 digits with the first 2 to 9 and a valid Verhoeff digit, or 16 Verhoeff digits, plain or grouped in fours (one space, other whitespace character or hyphen per gap), bounded by a non-digit on both sides (a letter or `+` is a boundary; a longer digit run is never split). `masked` is `XXXX XXXX dddd` (or four groups for a VID); nothing returns more digits. `letters: "join"` reads a letter as part of the run, so a hash or base64 run does not count. `holdsAadhaarLike(text)` is the yes-or-no form; `verhoeffValid` now lives here too (the old imports still work).
- **The AI scrubber** uses it: a 16-digit VID is now tokenised as `AADHAAR`, and twelve digits right after a `+` are no longer missed. Expect a few more `<PII:AADHAAR:n>` tokens, never fewer.
- **The e-KYC check** (§7cr) uses it with `letters: "join"`: a grouped number in the response is now refused `ekyc_holds_number` too.
- **Scan your repository:** `infrabyx-aadhaar-scan <path>...` (in `@infrabyx/testing`'s bin) prints `file:line: KIND masked` and exits 1 on a find, 0 on none, 2 on a usage error. It skips `node_modules`, `.git`, `dist`, symbolic links, binary files and files over 5 MiB (`--max-bytes`), naming each skipped file; `--letters boundary` reads letters as the scrubber does. Add it to CI over your fixtures and recorded responses, as the platform's `pnpm aadhaar:scan` does; it also reads log files.
- **Sweep your test databases:** `startPostgres({ beforeDrop: async (admin) => expect(await scanDatabaseForAadhaar(admin)).toEqual([]) })`. `beforeDrop(admin)` runs in `end()` before the database is dropped; if it throws, the database is still dropped and `end()` rejects with its error. `scanDatabaseForAadhaar(admin, { skip: ["schema.table", "schema.table.column"] })` reads every text-like column of every table as the superuser (test databases only).
- **Udofin:** its own detector script and its `startPostgres` wrapper (UDF-D-153) can give way to `findAadhaarLike`, `infrabyx-aadhaar-scan` and `beforeDrop`.

## 7ct. Bank account checks by mode, keyed retries and who funds a penny drop (PR-UDF-043; R1-D-196)

From the next release (`contracts`, `fakes`, `testing` and `connectors` minors; versions in the STATUS release record), you can ask the KYC port for a verification mode, rely on keyed retries, and read who funds a penny drop with each adapter.

- **Mode:** `kyc.bankAccountVerify({ ifsc, accountNumber, name?, mode? }, call)`, where `mode` is `"pennyless"` or `"penny_drop"`. The answer's `mode` is the mode used. An adapter that cannot honour the mode asked refuses `IPB-PORT-002` with `reason: "mode_unsupported"` before anything is sent; it never quietly uses another mode. Without `mode`, the adapter's configured mode is used and reported, so you can require pennyless for an RE by asking for it.
- **The platform's adapters are pennyless only:** `DigioKyc` and `IdfyKyc` now verify bank accounts pennyless (their shapes are `[VERIFY]`, built against stubs; both adapters stay off behind `int.kyc.<vendor>.enabled`) and refuse `penny_drop` `mode_unsupported`, because a penny drop moves money. `kycMethodRouter` routes `bank_account` to the first adapter in its order and moves past one that refuses the mode.
- **Retries:** pass `call.idempotencyKey`. A retry with the same key and request within 24 hours gets the first answer with no vendor call; the same key with another account, IFSC, name or mode is `IPB-PORT-004` (`idempotency_conflict`). An omitted mode counts as the configured one. A keyed penny drop whose first call did not finish is refused `pending_unresolved` rather than sent again: check it with the provider. Reuse a step's key on its retry (as Udofin's UDF-D-154 does) and use a new key for a new account.
- **Production store:** give the adapter `bankAccountVerifies: new PgBankAccountVerifyStore({ kernel, audit, context: (tenantId) => <your KYC service context> })` (default: in memory per instance). The table comes with the `connectors` migration `0012_kyc_bank_account_verify.sql`; run your migrations and call `purgeExpired(tenantId)` daily.
- **Funding:** `kycAdapterFunding(adapter)` (or `KYC_ADAPTER_FUNDING`) from `@infrabyx/contracts/ports` returns `{ pennyDrop: "provider" | "tenant" | "unknown", source }`. Digio and IDfy are `unknown` until the provider's documentation and your agreement with it confirm who funds the credit; record what you confirm in your LSP agreement. The platform moves no money.
- **Statuses** are unchanged: `valid`, `invalid`, `closed`, `not_found` (`BANK_ACCOUNT_STATUSES`). No field of an answer carries the account number or an Aadhaar-like number.
- **Tests:** `new FakeKyc({ bankAccountModes, bankAccountMode })` honours both modes by default (pennyless when none is asked) and counts `bankAccountVendorCalls`; nothing is credited. `KycFixtures.bankAccount` (optional in the type) drives four new contract cases; keep test account numbers non-Aadhaar-like (for example a leading 0), or the sweep will flag them.

## 7cu. Liveness by mode, the threshold applied, keyed retries and what the vendor keeps (PR-UDF-044; R1-D-197)

From the next release (`contracts`, `fakes`, `testing` and `connectors` minors; versions in the STATUS release record), you can ask the KYC port for a liveness mode, read the threshold each score was judged against, rely on keyed retries for both scoring methods, and read whether each vendor keeps a face template.

- **Mode:** `kyc.livenessCheck({ frames, mode? }, call)`, where `mode` is `"passive"`, `"active_gesture"` or `"active_voice"`. The answer's `mode` is the mode used. An adapter that cannot honour the mode asked refuses `IPB-PORT-002` with `reason: "mode_unsupported"` before anything is sent; it never quietly uses another mode. Without `mode`, the adapter's configured mode is used and reported, so ask for the mode your RE requires (a non-blink check) rather than relying on configuration.
- **What the platform's adapters do:** `IdfyKyc` honours `passive` only (IDfy's photo liveness; `[VERIFY]` against its sandbox) and refuses an active mode; `DigioKyc` has no liveness or face-match path (both `unsupported`). `kycMethodRouter` sends `liveness` to the first adapter in its order and moves past one that refuses the mode, so an active check goes to an adapter that offers one, or is refused.
- **Threshold and score:** every `ScoreResult` from `livenessCheck` or `faceMatch` carries `threshold` (the pass mark applied; set with `IdfyKyc({ livenessThreshold, faceMatchThreshold })`, 0.8 by default, each from 0 to 1) and `passed` (`score >= threshold`). `score` is always a finite number from 0 to 1 (`kycScoreValid`); a vendor score off its known scale is refused `IPB-PORT-003` (`reason: "score_out_of_range"`), never clamped. If IDfy's sandbox reports 0 to 100, build the adapter with `scoreScale: 100`.
- **Retries:** pass `call.idempotencyKey` (for example the step's key plus `.liveness` and `.face`, as Udofin's UDF-D-155 does). A retry with the same key and request within 24 hours gets the first answer with no vendor call; the same key with other frames, another mode or other images is `IPB-PORT-004` (`idempotency_conflict`). An omitted mode counts as the configured one, frames count in order, and a key is scoped to its method. A call that failed at the vendor is asked again on its retry. With a key, the router does not move the check to another adapter when one is unavailable: retry later.
- **Production store:** give the adapter `scoreChecks: new PgKycScoreCheckStore({ kernel, audit, context: (tenantId) => <your KYC service context> })` (default: in memory per instance). The table comes with the `connectors` migration `0013_kyc_score_check.sql`; run your migrations and call `purgeExpired(tenantId)` daily. It keeps no image, template, embedding or file reference in clear, only the key's hash, a keyed binding and the answer.
- **What the vendor keeps:** `kycAdapterRetention(adapter)` (or `KYC_ADAPTER_RETENTION`) from `@infrabyx/contracts/ports` returns `{ template: "none" | "kept" | "unknown", source }`. Digio and IDfy are `unknown` until each vendor gives a written statement; record what you obtain in your own records. The statement changes nothing that is sent or kept.
- **Tests:** `new FakeKyc({ livenessModes, livenessMode, livenessThreshold, faceMatchThreshold })` honours every mode by default (`passive` when none is asked), counts `livenessVendorCalls` and `faceMatchVendorCalls`, and `offScaleNext()` makes its next score off the scale. `KycFixtures.scores` (optional in the type) drives seven new contract cases.

## 7cv. The RE-hosted V-CIP launcher and its signed hand-off (PR-UDF-045; R1-D-198)

From the next release (`contracts`, `fakes`, `testing` and `connectors` minors; versions in the STATUS release record), an LSP can hand a customer to the RE's V-CIP without hosting any V-CIP component, and V-CIP manifests carry reason codes and the liveness mode.

- **As the LSP:** build a `VcipHandoffContext` (`tenantId`, `reId`, `lspId`, `customerRef`, `journeyId`, `issuedAt`, `expiresAt` at most 15 minutes later, and a fresh `nonce` of 22 to 64 base64url characters; ids and times only, never a name or a number), sign it with `signRegulatedMessage({ event: context, kid, sign })` from `@infrabyx/crypto` under your KMS key, right before you hand over (the signature must be presented within five minutes), and call `kyc.launchVcip({ context, jws }, { tenantId })`. Send the customer to the answer's `launchUrl` before `expiresAt`, and keep only `vcipId`. A hand-off is single use: to retry, sign a new context with a new nonce. Refusals are `IPB-PORT-001` with `reason` `handoff_invalid`, `handoff_replayed` or `handoff_expired`.
- **As the RE (on `VcipConductor`):** build it with `handoff: { reId, issuers: { [lspId]: new RegulatedKeyRing([...the LSP's public keys]) }, replay: <a durable, shared ReplayStore>, launchBaseUrl: "https://<your V-CIP page>/" }`. `launchVcip` schedules a session (state `scheduled`, `sessionId` the LSP's journey id) and answers `launchBaseUrl` plus its id. Your official starts it with `startVcip({ …, vcipId })` (the hand-off's tenant and customer only) and then runs the call as before (`assess`, now with an optional liveness `mode`, then `complete` or `drop`). A session no official starts before the hand-off lapses reads `expired` (`launch_expired`).
- **What the platform's adapters do:** `DigioKyc` and `IdfyKyc` refuse `launchVcip` `unsupported` (no RE-hosted launcher is known at either, `[VERIFY]`); `kycMethodRouter` routes it under `vcip` and never moves a launch to another adapter.
- **Reading the session:** `kyc.vcipStatus(vcipId, { tenantId })` now takes the call; another tenant's session is not found. Read `reasonCode` (one of `VCIP_REASON_CODES`) for why a session was rejected, dropped or expired, and `liveness.mode` for the mode used. The old free-text `reason` is deprecated: never show it to anyone. On the conductor, pass `reasonCode` to `complete` and `drop` (defaults `official_rejected` and `connection_lost`); a rejection reason holding an identity number is refused `reason_unsafe`.
- **Tests:** `FakeKyc` takes hand-offs signed with `signFakeVcipHandoff(fakeVcipHandoffContext())` (a development key, `FAKE_VCIP_HANDOFF`) or, with `new FakeKyc({ vcipHandoff: { reId, issuers, replay, launchHosts } })`, your own; it counts `vcipLaunchVendorCalls`. `KycFixtures.vcipLaunch` (optional in the type) drives three new contract cases.

## 7cw. V-CIP webhooks verified without a vendor call (PR-UDF-046; R1-D-199)

From the next release (`contracts`, `crypto`, `fakes`, `testing` and `connectors` minors; versions in the STATUS release record), a V-CIP webhook can be verified cheaply, recorded and acknowledged, and read back later from the queue.

- **In the webhook handler:** call `kyc.verifyWebhook(rawBody, headers)` with the raw request bytes (at most 64 KiB; refuse a larger body at the gateway too) and the request headers. On `IPB-API-018` (`reason` one of `body_too_large`, `signature_invalid`, `timestamp_stale`, `event_replayed`) answer 401 and log the label; never log the body. On success the receipt is `{ eventId, vcipId, receivedAt }` only: record `eventId` in your module inbox (`PgInbox.firstSeen`), enqueue `vcipId` on QUEUE_PORT, and answer 2xx within 2 s (IPB-10-27). A verified event that names no session is `IPB-PORT-001` `malformed_event`: acknowledge it and drop it.
- **In the queue worker:** read the session with `kyc.vcipStatus(vcipId, { tenantId })` and act on that, never on the event's own claims. A provider's retry of an event verifies again (same `eventId`, new timestamp); the inbox has it already, so skip it. `handleWebhook` still works and now verifies first, then reads back in the request.
- **What the platform's adapters do:** the platform verifies Standard Webhooks only (`webhook-id`, `webhook-timestamp`, `webhook-signature` with `v1` HMAC-SHA-256, five minutes). `DigioKyc` and `IdfyKyc` refuse `verifyWebhook` `unsupported` until each provider's V-CIP webhook scheme is known (`[VERIFY]`); RFC 9421 is not offered yet (#150). For a provider that signs with Standard Webhooks, build the method with `standardWebhookKycVerifier({ adapter, secrets: () => [current, previous], replay: <a durable, shared ReplayStore>, vcipIdOf: (body) => … })` from `@infrabyx/connectors/kyc`, the secrets read from SECRETS. Send each provider's webhooks to its own adapter, not through `kycMethodRouter`.
- **Tests:** `FakeKyc` verifies Standard Webhooks with `FAKE_KYC_WEBHOOK.secret`, or `new FakeKyc({ webhook: { secrets, replay } })`; sign a delivery with `signFakeKycWebhook(body, { id?, at? })`. Its `handleWebhook` now refuses an unsigned event, so sign the bodies your tests post. `vcipStatusVendorCalls` counts read-backs. `KycFixtures.webhook` (optional in the type) drives two new contract cases.

## 7cx. The approvals a checker may check, paged (PR-UDF-047; R1-D-200)

From the next release (`tenancy` minor; versions in the STATUS release record), a checker can find the requests they may decide without being given an id.

- **Listing:** `engine.listCheckable(ctx, { limit?, cursor? })` answers `{ items, nextCursor }`: the tenant's pending, unexpired requests that the signed-in principal may decide now, oldest first. A request is left out when the principal made it, has already decided it, or `decide` would refuse them its checker rule (the action's checker roles after your tenant's `mc.checker_roles.<action>`, its checker functions, and for a levelled request the open level's roles). An agent gets an empty list.
- **Each item:** `id`, `action`, `summary`, `riskClass`, `makerId`, `createdAt`, `expiresAt`, `currentLevel` (null for a single-level request), `requiredCheckers` and `approvals` (given so far, at every level). It never carries the payload, its digest or data class, or the diff: open the request with `get(ctx, id)` or your own screen to show the change, and decide with `decide` as before (it checks everything again).
- **Paging:** `limit` 1 to 100 (default 25); pass `nextCursor` back as `cursor` until it is null. The cursor is opaque: do not build or change one. A bad cursor or limit throws a `RangeError` before any read: answer it with a 400.
- **Migration:** run `infrabyx-migrate` for `tenancy/0025` (a partial index built concurrently; no table or column, so your export map is unchanged).
- **Work Inbox:** `InboxService` is unchanged and takes no other sources; your checkers' approval items still come from `ApprovalWorkflow`. For a page of requests to check (Udofin's Approvals page), call `listCheckable` directly, and retire any list you keep of your own held decisions.

## 7cy. Bank statement analysis behind a port (PR-UDF-048; R1-D-202)

From the next release (`contracts`, `config`, `fakes`, `testing` and `connectors` minors; versions in the STATUS release record), a product analyses a borrower's bank statements through `STATEMENT_ANALYSIS` instead of calling an analyser itself.

- **Call:** put each statement in STORAGE in the REGULATED class (AA_FIU's payloads already are), then `port.analyse({ subjectRef, inputs: [{ fiType, storageKey, sha256 }], reportPrefix }, { idempotencyKey })`. The inputs and `reportPrefix` must be in one tenant; `subjectRef` is your own reference, never an identity number. The answer is `{ analysisId, state, report?, failureReason?, adapter, method, vendorRef, checkedAt }`: on `COMPLETED`, `report` is a STORAGE reference in the REGULATED class with its SHA-256 (verify it when you read); on `FAILED`, `failureReason` is `unreadable_input`, `unsupported_input` or `vendor_failed`; on `PENDING`, call `status(analysisId, { tenantId })` later. Keep the answer in your own records: the platform keeps its record 24 hours.
- **Retries:** reuse the idempotency key: the same request answers the same analysis with one analyser call; the key with other statements, subject or prefix is `IPB-PORT-004`.
- **Refusals** (`meta.reason`): `residency` (`IPB-PORT-003`: an input outside the REGULATED class, or a `dataClass` other than REGULATED), `input_missing` and `hash_mismatch` (fix the reference or the digest), `adapter_disabled`, `adapter_unconfigured`, `unknown_analysis`, `tenant_mismatch`, `unsupported`. Nothing reached an analyser when any of these is thrown.
- **Adapters:** `platform-statement` (`PlatformStatementAnalyser`, the reference) runs in the platform with no vendor: its report is a checksum summary of the statements (FI type, digest, length, format), not a credit analysis. `http-statement` (`HttpStatementAnalyser`) is a vendor-neutral HTTP client whose shapes are not yet confirmed against any vendor. Both are off (`int.statement_analysis.platform.enabled`, `int.statement_analysis.http.enabled`, and `int.statement_analysis.http.host` for the HTTP host); no analyser is chosen yet (owner question #152), so build against `FakeStatementAnalysis` (a statement holding `FAKE_STATEMENT_ANALYSIS.pendingMarker` answers PENDING until `settle`).
- **Webhooks:** the real adapters refuse `handleWebhook` `unsupported`; poll `status` for a pending analysis. The fake's notifications are signed (`signFakeStatementAnalysisNotification`) and only the state read back is trusted, which is what a real adapter will do once its vendor's scheme is approved.
- **Wiring:** `@infrabyx/connectors/statement-analysis`; give the adapters `PgStatementAnalysisStore` (run `infrabyx-migrate` for `connectors/0014`, `connectors.statement_analysis`) and route the port as `IN`, REGULATED. Your adapter's contract: `statementAnalysisContractCases(fixtures)` from `@infrabyx/testing`.

## 7cz. Your own consent artefact beside the bureau consent receipt (PR-UDF-049; R1-D-203, owner answer #153)

From the next release (`contracts`, `fakes`, `testing` and `connectors` minors; versions in the STATUS release record), a bureau pull can carry your own purpose-consent artefact beside the platform's `cpr_`. `consentRef` itself is unchanged: still the required `cpr_…` string, so nothing you or an outside adapter wrote breaks.

- **Call:** `port.pull({ …, consentRef: "cpr_…", consentArtefact: { kind: "udf.purpose_consent", id: "<your artefact id>" } })`. Without `consentArtefact` a pull works exactly as before. `kind` is a label of one to four dot-separated lower-case segments (3 to 64 characters; `cpr` and `cns` are reserved); `id` is 3 to 128 characters of letters, digits, `.`, `_` and `-`. Use your ledger's own opaque id (a prefixed ULID is ideal), never a mobile, account, Aadhaar, VID or PAN number: a standalone run of 10 or more digits, an Aadhaar-like number or a PAN-shaped run is refused before anything leaves (`CONSENT_ARTEFACT_REFUSALS` lists the labels; `consentArtefactProblem(kind, id)` tells you which).
- **What the platform checks:** the artefact's shape only. It cannot see your ledger, so passing the artefact is your assertion that it is granted, for this purpose and RE, unexpired and not withdrawn: check that first, as you check a `cpr_` with `PurposeConsents` today.
- **Answer:** `BureauReport.consentRef` is your `cpr_` as asked, and `consentArtefact` is your `{ kind, id }` when you passed it. Record both with the pull in your own ledger entry. CIBIL's pull record keeps them side by side; `consentInForce(req)` gives the one an adapter keys by (the artefact when present, else `consentRef`).
- **Implementers:** an adapter outside the platform needs no change to keep working; to support artefacts, keep and echo `consentArtefact` with `consentEcho(req)` and run `creditBureauContractCases` again (it covers calls with and without an artefact and the refusals; `contractConsentArtefact` and `malformedConsentArtefacts` are exported for your own tests).

## 7da. The AA consent's FIU check, approval link and your own consent artefact (PR-UDF-050; R1-D-204)

From the next release (`contracts`, `fakes`, `testing` and `connectors` minors; versions in the STATUS release record), an AA consent request can name the FIU it is for, the consent answers the AA's approval page, and your own purpose-consent artefact can go beside the `cpr_`.

- **FIU:** pass `fiuId` (your RE's FIU id as registered in the AA ecosystem) in `requestConsent`. The consent answers `fiuId` as the AA reports it. If the AA reports another FIU, or none, the call is refused `IPB-PORT-001` with `meta.reason: "fiu_mismatch"` and nothing is kept or returned: do not retry with the same RE, raise it with the AA. A consent you asked with a FIU is checked again on every `consentStatus`, `revoke`, `fetch` and notification, with the same refusal. Without `fiuId` nothing is compared (as before), so always pass it.
- **Approval link:** while the consent is PENDING, `approvalUrl` is the AA's page where the customer approves it (`https:`, on the adapter's approval hosts; an AA's UUIDs in it are accepted whatever their hex digits, an all-digit last group included, while any other 12-digit run is refused); it is absent in every other state. Send the customer there and do not log it or put it in an event. With Setu, list the host Setu's sandbox shows for its links in the adapter's `approvalHosts` if it is not `fiu.setu.co` or `fiu-sandbox.setu.co` (still to be confirmed); a link elsewhere is refused `approval_url_not_allowed` before anything is kept. Replace calls to the deprecated `SetuAccountAggregator.approvalUrl(consentId)` (§7w) with the consent's `approvalUrl`.
- **Consent reference:** `consentRef` is unchanged (the required `cpr_`); pass your own artefact as `consentArtefact: { kind, id }` as in §7cz (the same rules and refusals). Neither is sent to the AA.
- **Testing:** `FakeAccountAggregator({ fiuId, approvalHost })` reports its own FIU (`fake-fiu` by default), so a request naming another is refused; `reportFiu(consentId, fiuId)` plays the AA reporting another FIU later. Your adapter's contract: `accountAggregatorContractCases(fixtures)`, with `fiuId` (and, for a stub, `reportFiu`) in the fixtures.

## 7db. Snooze, ordering and the by-record list in the Work Inbox (PR-LDC-46; R1-D-206)

From the next `workflow` minor (version in the STATUS release record; migration `workflow/0005_inbox_snooze.sql`, applied by `infrabyx-migrate`), the Work Inbox snoozes an item for one person, orders by due time or severity, and lists one module or record. Remove your own inbox overlay.

- **Snooze:** `inbox.snooze(ctx, itemId, until)` hides the item from the caller only, until `until` (a `Date`, in the future, at most `INBOX_SNOOZE_MAX_DAYS` = 30 days ahead, and no later than the item's `dueAt`, else `RangeError`). Other holders of a role item still see it. The caller must see the item (`NotFoundError` otherwise, as `markRead`). An escalated item, an escalation and an item past its due time are refused `ConflictError`. Snoozing again replaces the time; `inbox.unsnooze(ctx, itemId)` clears it. Map `RangeError` to 400, `ConflictError` to 409, `NotFoundError` to 404.
- **Reappearing:** nothing to schedule. Reads compare the time with the clock, so the item is back once its time passes, and once it is escalated or falls due even before that. `InboxItem.snoozedUntil` is the caller's active snooze (null when none).
- **Reads:** `list(ctx, { productModule, recordRef, orderBy, snoozed })`: `orderBy` is `newest` (default, as before), `due` (soonest due first, none last, then severity) or `severity` (critical first, then due time); `snoozed` is `exclude` (default), `include` or `only` (a "Snoozed" tab). `badgeCount` leaves the caller's snoozed items out.
- **Audit:** `inbox.item.snooze` and `inbox.item.unsnooze` ledger entries, in the same transaction.

## 7dc. Layout and formula cells in `toXlsx` (PR-LDC-52; R1-D-207)

From the next `export` minor (version in the STATUS release record; no migration, no setting), `toXlsx` lays a register out the way your own ExcelJS code did. Remove that code; nothing changes for a workbook that uses none of it (the bytes are the same).

- **Freeze and filter:** `freezeColumns: n` keeps the first n columns in view beside the frozen header row; `autoFilter: true` adds filter buttons over the header and data rows.
- **Grouping and fills:** `rowLayout[i] = { outlineLevel, fill }` for data row i (0 is the row under the header; levels 0 to 7), `outlineSummary: "above"` when the group's summary row is above it; `headerFill` and a column's `fill` take six hex digits (`"FFF2CC"`), and a row fill wins over a column fill. Dates keep their format when filled.
- **Printing:** `page: { paper: "A4", orientation: "landscape", fitToWidth: true, repeatHeader: true, printArea: true }` (`printArea` may also be a range such as `"A1:F200"`).
- **Conditional formats:** `conditionalFormats: [{ column: "due", when: { op: "lt", value: { today: 0 } }, style: { fill: "F8CBAD", bold: true }, wholeRow: true }]`. `column` is a key or header; comparisons take a value of the column's type (a number, a `yyyy-mm-dd` date or `{ today: n }`, text, a boolean); also `between`, `notBetween`, `containsText`, `blank`, `notBlank`. There is no free expression: if a rule you need is missing, raise a platform request.
- **Formulas:** put `xlsxFormula("SUM(D2:D200)", { result: 1234 })` in a cell (no leading `=`). Never build the formula text from user input without quoting it yourself; external references, any `|` outside a string literal (DDE), and `WEBSERVICE`, `IMAGE`, `HYPERLINK`, `INFO`, `CELL` and the other `XLSX_BLOCKED_FUNCTIONS` are refused `formula_invalid`. Formula text is yours alone: user text goes in ordinary cells, where the writer's formula-injection protection stays on. A string such as `"=SUM(A1)"` from your data is still written as text with a leading apostrophe.
- **Refusals:** `OfficeExportError` with `layout_invalid`, `conditional_format_invalid` or `formula_invalid` (and `cell_invalid` for a cached result of the wrong type).

## 7dd. glob and minimatch on their fixed majors (PR-FBX-50; R1-D-216)

The platform's own tree is clear of GHSA-3g3m-2fjr-6pw4 (glob) and GHSA-g3hv-75wg-m249 (minimatch) from the next release, through three `pnpm` overrides; the published `@infrabyx/*` packages keep their dependency ranges, so **your lockfile resolves the old majors until you add the same overrides** (overrides are not inherited from a dependency). In your `pnpm-workspace.yaml`:

```yaml
overrides:
  unleash-client>make-fetch-happen: ^16.0.1
  archiver-utils>glob: ^14.0.3
  "minimatch@>=7.0.0 <11.0.1": ^11.0.8
```

- `make-fetch-happen` 16 is the same HTTP client on `cacache` 21, whose glob is 14; the FEATURE_FLAG `unleash` contract leg passes on it. `archiver-utils` (under `testcontainers`, tests only) calls glob's `sync`, which glob 14 still exports for CommonJS.
- Run `pnpm install` and `pnpm audit`; both advisories should be gone. Finbyx can then drop its SEC-08 waiver.
- Each override goes once its parent ships the fixed major (`unleash-client` on `make-fetch-happen` 16, `testcontainers` on `archiver` 8); the STATUS release record says when the platform drops them.
- The same release moves `fast-uri` to 3.1.9 (four advisories, via `ajv`); a lockfile refresh (`pnpm update fast-uri`) does the same for you.

## 7de. The origination contract and the mock lender (PR-UDF-051; R1-D-217)

From the next release (`contracts`, `crypto`, `fakes` and `testing` minors), `@infrabyx/contracts/events` carries the loan journey of Ecosystem Specification §6.2 and §6.3, and `@infrabyx/fakes` a mock lender that plays Finbyx's side of it.

- **`EligibilityCheck` is a synchronous call** (`POST /v1/eligibility-checks`, `EligibilityCheckRequest` and `EligibilityCheckAnswer`), with an `Idempotency-Key` header and a 3 s budget (`ELIGIBILITY_CHECK_BUDGET_MS`); past it, treat the lender as unavailable (`ELIGIBILITY_LENDER_UNAVAILABLE`). There is no event pair (owner question #157).
- **Events, v1:** `ORIGINATION_EVENTS` gives each type, its data schema, the Specification's idempotency fields and its direction. Money is integer paise, rates `apr_bp` (basis points), hashes SHA-256 hex, applicants `applicant_ref` only. `BorrowerAccepted` needs `explanation_acknowledged: true`.
- **Regulated:** `DecisionMade`, `KFSIssued`, `SanctionLetterIssued` and `LoanDisbursed` (`ORIGINATION_REGULATED`) come with a detached JWS (`X-Infrabyx-JWS`); verify each with `verifyRegulatedMessage` against the lender's key ring before you act on it, and store the JWS with the event.
- **Testing:** `new FakeLender()` answers `eligibilityCheck`, takes `submitApplication(ApplicationSubmitted)`, `accept(BorrowerAccepted)`, `coolingOffExit(CoolingOffExitRequested)`, and `disburse(applicationId)`; read what it sent with `outbox()` and verify with `fake.keys`. `script({ decision, infoRequest, latencyMs, outcome })` steers the next calls. Build your own messages with `lspEvent(name, data)` from `@infrabyx/testing`, and run `lenderContractCases()` against any lender client you write.
- **KFS loan amount (R1-D-229):** `KFSIssued` may carry `loan_amount_paise`, the "Loan amount" of the RBI KFS format (Annex A, Part 1) in integer paise (the owner's `loanAmount`; Ecosystem payloads are snake case). It is the loan's amount, not the net disbursed amount (`LoanDisbursed.amount_paise`, less any upfront fees). It is optional: read it when present, never assume it. A fractional, zero or negative value is not a valid message. `FakeLender` sends it, equal to the sanctioned amount.
- **Offer fields (R1-D-231):** an offer (`OriginationOffer`, in `EligibilityCheckAnswer.offers` and `DecisionMade.offers`) may carry `monthly_instalment { amount_paise, frequency }` (`INSTALMENT_FREQUENCIES`), `penal_charges` (at most 20 `{ basis, rate_bp | amount_paise, description }`: exactly one of the rate in basis points or the amount in paise; a penal charge, not penal interest, never capitalised) and `kfs_link { document_id, version? }`. All are optional: show them when present, never assume them.
- **Penal-charge basis:** `basis` is a code; `PENAL_CHARGE_BASES` lists `PER_INSTANCE`, `PER_MONTH_ON_OVERDUE`, `FLAT` and `OTHER` ([VERIFY] against RBI's Penal Charges in Loan Accounts directions), and another code is not refused, so handle an unknown one as `OTHER`.
- **KFS link:** a document reference, never a URL (a value starting `https:`, `storage:` or `www.`, or a `url` beside it, is refused). Fetch the KFS through `GET /v1/documents/{id}` (§7df). `FakeLender` links its sanctioned offer to the KFS it shares right after the decision; its eligibility offer has none.
- **Udofin:** `u21_connector/port.ts` can import these types instead of its local copies.

## 7df. Documents, eSign and eStamp evidence and the execution pack (PR-UDF-053; R1-D-219)

From the next release (`contracts`, `crypto`, `fakes` and `testing` minors), building on §7de:

- **Documents travel by reference** (§6.13): `DocumentShared` (`in.infrabyx.documents.DocumentShared.v1`, `DocumentSharedData`, keyed by `document_id` and `version`) carries the type, `sha256`, retention class, legal hold and a **document JWS**. Verify it with `verifyDocumentJws(jws, { document_id, version, sha256 }, producerKeys)` before you fetch, then check the bytes' SHA-256 against `sha256`. Sign your own with `signDocumentJws` (your KMS key; C-22, `typ: ipb-document+jws`).
- **Fetching:** `GET /v1/documents/{id}` answers `DocumentRetrieval`: an India-hosted `https` URL valid at most 15 minutes, with the hash and JWS. Treat the URL as a secret: never log it or put it in an event.
- **Execution evidence:** `ESignCompleted` and `EStampCompleted` are in `ORIGINATION_EVENTS` (UD → FX, regulated, so `ORIGINATION_REGULATED` now has six). Send each with its detached JWS (`X-Infrabyx-JWS`). `ESignCompleted` needs the ESP transaction id, the certificate summary and the signed hash; a bare "signed" flag is not a valid message.
- **The execution pack:** `ExecutionPackManifest` lists the documents to execute (kind, hash, execution mode, stamp requirement, signers by role), the stamp details, the page of the loan agreement with the KFS summary box, the covenant declaration and the countersignature rule. Until the Specification names a carrier (PR-047), the lender shares it as a document of type `EXECUTION_PACK_MANIFEST` whose bytes are the JCS form of the manifest; parse it with `ExecutionPackManifest.parse(JSON.parse(text))`.
- **Testing:** `const lsp = lspSigner(); const lender = new FakeLender({ lspKeys: lsp.keys })`. After a sanction, `lender.sharedDocuments()` lists the shared documents (`outbox()` is unchanged), `getDocument(id)` and `fetchDocument(url)` serve them, `executionPack(applicationId)` returns the manifest, and `eSignCompleted(event, await lsp.sign(event))` and `eStampCompleted(...)` take your evidence. Run `lenderContractCases({ lsp })` against any lender client you write.
- **Disbursement clause (R1-D-229):** `ExecutionPackManifest` may carry `disbursement_clause: { document_id, page_or_clause_ref, amount_stated_paise }` (the owner's `disbursementClause { documentId, pageOrClauseRef, amountStated }`): the pack document (it must be one of `documents`) and the page or clause (`p.3`, `cl.4.2`; 1–64 characters) that states the amount to be disbursed, in integer paise. Compare it with `LoanDisbursed.amount_paise` before you book the loan. `FakeLender` points it at its loan agreement with the application's amount.
- **Stamp evidence (R1-D-231):** a pack document may carry `stamp_evidence { mode, state, certificate_number, duty_paise, stamped_document_sha256, vendor_ref? }` (`StampEvidence`; `mode` `ESTAMP`, `PAPER` or `FRANKING`). The pack-level `stamp.mode` keeps `E_STAMP`, `PHYSICAL_PAPER` and `FRANKING`; map with `STAMP_EVIDENCE_MODE_OF`. Check `stamped_document_sha256` against the document's `sha256` and the State and duty against the pack's `stamp`.
- **Not stampable:** `not_stampable: true` needs `not_stampable_reason` (1–200 characters); such a document is never `stamp_required` and carries no `stamp_evidence`. `FakeLender` stamps its loan agreement (`ESTAMP`) and marks its KFS not stampable.

## 7dl. Per-lender keys in STORAGE (PR-UDF-058; R1-D-227)

From the next release (`contracts`, `connectors`, `fakes` and `testing` minors), a STORAGE write can name one of its tenant's own keys, so a vault keeps each lender's files under that lender's KMS key, including a key in the lender's own account. Nothing changes for a write that names none.

- **Write:** `storage.put(key, body, { bucketClass: "REGULATED", keyRef: "lender:lnd_01…" })` (also `putWithRetention`, and `presign(key, "put", ttl, { bucketClass, contentType, keyRef })`). A reference is a name, `[a-z0-9][a-z0-9_.:-]{2,63}` (`isValidStorageKeyRef`), never a key id: an ARN, `mrk-…` or UUID is refused. Named keys are allowed in `CONFIDENTIAL` and `REGULATED` (`NAMED_KEY_CLASSES`), and from PR-UDF-066 in `QUARANTINE` (§7dt).
- **Configure** the `s3` adapter with `tenantNamedKmsKeyIds(tenantId, { bucketClass, compartment })`, returning `{ [keyRef]: keyId }` for that location, and optionally `tenantKeyRefPrefixes(tenantId)`, returning `{ [prefix]: keyRef }` (each prefix under `tenant/<tenantId>/`): a write that names no reference takes the longest matching prefix's, and one that names another is refused, so a lender's prefix holds that lender's files only. The reference resolves in the object key's tenant only. No setting is involved.
- **Refusals** (fail closed, never the class key; `meta.reason` reaches the problem response as `reason`): `IPB-PORT-003` for `key_ref_invalid`, `key_ref_class`, `key_ref_prefix_conflict`, `key_ref_changed` (an overwrite must keep the reference, or its absence) and `key_ref_tenant_cmk` (a tenant with its own CMK keeps it on every object, C-17); `IPB-PORT-001` for `key_ref_unknown`, `key_ref_prefix_invalid` and `key_ref_shared` (a named key equal to a class or compartment key, to another reference's key, or in a compartment to the same reference's key elsewhere; one reference may use one key across `CONFIDENTIAL` and `REGULATED`). `minio` refuses any reference with `IPB-PORT-001` `unsupported` (capability `put.keyRef`).
- **Read:** `get` returns `meta.keyRef` (the reference, never the key id), so audit and export can show which key protected a file; `get` and presigned gets work as before. A key that is disabled, scheduled for deletion or no longer granted to the platform answers `IPB-KMS-001` (503) with `reason: "storage_key_unavailable"` for an object under a named key: tell the user the lender's key is unavailable, do not retry blindly (a transient KMS error stays `IPB-PORT-002`, and objects under platform keys fail as before).
- **Uploads:** a presigned upload URL under a named key signs the `x-amz-server-side-encryption-aws-kms-key-id` header (as for a compartment), so the uploader sends `x-amz-server-side-encryption: aws:kms`, that header with the key id, and `x-amz-server-side-encryption-bucket-key-enabled: true`; the reference is signed into the URL.
- **Replication and DR:** `replicateTo` carries the reference, so the target must have the same named key (an AWS multi-Region key or the lender's DR key), or the copy is refused.
- **A lender-controlled key:** the lender creates the key in its own account and grants the platform's STORAGE role `kms:GenerateDataKey` and `kms:Decrypt` on it (key policy or grant); revoking that grant stops reads and writes of that lender's files (after S3's bucket-level data key expires, as S3 Bucket Keys stay on). Revocation also makes retained files unreadable while Object Lock still keeps them: agree that in the lender contract. Creating keys or grants in an environment is your production configuration. **Testing:** `new MemoryStorage(undefined, { keyRefs: (tenantId) => [...], keyRefPrefixes })`; with no `keyRefs`, every reference is unknown.
- **Bucket Key switch (R1-D-229, #165 (3)):** a value of `tenantNamedKmsKeyIds` may also be `{ keyId, bucketKey: false }` (the string form is unchanged and keeps S3 Bucket Keys on, the default). With `bucketKey: false`, `put`, `putWithRetention` and presigned uploads under that reference send `x-amz-server-side-encryption-bucket-key-enabled: false` (an uploader sends that header with `false`), so revoking the lender's grant stops access at once and CloudTrail records each object's KMS call. The cost: every object read and write then makes its own KMS request, a recurring KMS charge that grows with traffic. Decide it per lender, with that lender's key policy; leave it on otherwise.

## 7dg. The GRC port and the §6.15 events (PR-FBX-51; R1-D-220)

From the next release (`contracts`, `config`, `connectors`, `fakes` and `testing` minors), a product reports to its GRC system of record (LawDocsComply, Finbyx's embedded module, or a regulated entity's own tool) through one port on the Ecosystem Specification §9.2 generic connector contract.

- **Events, v1** (`@infrabyx/contracts/events`): `ControlTestResultPublished`, `ComplianceIssueRaised`, `ReturnStatusUpdated`, `PolicyAttested` and `SecurityIncidentNotified`, listed with `EvidenceSubmitted` and `ObligationPublished` in `GRC_EVENTS` (type, schema, the Specification's idempotency fields; `grcIdempotencyKey`). People travel as `user_ref` or an owner role code, samples as masked ids (`ln_XXXXXXXX4821`), evidence as a `storage:` key or https URI with its SHA-256. Every schema refuses an Aadhaar-like number or a PAN anywhere in the data. Severity is `SEV1` (most severe) to `SEV4`, as for `ProviderIncident`. Send OH13 its incident copy with `securityIncidentClockCopy(data)`.
- **The port** (`GrcPort`, `@infrabyx/contracts/ports`): `listObligations({ updatedSince, cursor, limit })` returns pages of obligations (references, `text_sha256`, dates; never the text); follow `nextCursor` until it is absent, with the same query. `publishControlTestResult`, `submitEvidence`, `raiseIssue`, `notifyIncident`, `updateReturnStatus` and `recordPolicyAttestation` take the event data and answer a `GrcReceipt` (the GRC system's `ref`). Each POST is keyed by your `call.idempotencyKey` or, if you pass none, the event's own key, so a resend is safe; the key with a changed body is refused `IPB-PORT-004`. Send incident updates in `update_seq` order: a lower one is refused `out_of_order`. Calls above CONFIDENTIAL are refused.
- **Adapter:** `@infrabyx/connectors/grc` `GenericGrc` (`generic-grc`), off until `int.grc.generic.enabled` is true and `int.grc.generic.host` names the GRC system (India-resident); its token comes from SECRETS (`secrets/<env>/grc/generic/token`). Its REST paths and answers beyond what §9.2 fixes are stub-shaped until the first counterparty's sandbox confirms them (owner question #159), so keep it off outside development until then.
- **CERT-In fields (R1-D-229, #159 (a)):** `SecurityIncidentNotified` may carry `cert_in_category` (`CERT_IN_INCIDENT_CATEGORIES`: codes for the incident types of Annexure I of the CERT-In Directions of 28 April 2022 under IT Act s.70B(6), with `OTHER`; the list is marked `[VERIFY: current Annexure list]`) and `cert_in_report_by` (RFC 3339). `certInReportBy(noticedAt)` gives noticed + 6 h; a `cert_in_report_by` later than `detected_at` + 6 h is refused. Both are clock fields with no personal data and travel in `securityIncidentClockCopy`.
- **Before staging (R1-D-229):** the `generic-grc` bearer token is acceptable only while the adapter is off and unproven. The §9.2 mTLS-bound client credentials are a blocking condition before any connection from staging or above; do not enable `int.grc.generic.enabled` there until the platform ships them.
- **Testing:** `new FakeGrc()` (`@infrabyx/fakes`) holds what you send (`records`, `accepted`) and serves seeded obligations (`seedObligations`); `grcContractCases()`, `grcSamples` and `grcObligations()` from `@infrabyx/testing` check any GRC client you write.
- **Finbyx:** replace the product-local shim with the port; keep the evidence in your own STORAGE and send only its reference and hash.

## 7dh. Staff and RE-administrator notifications (PR-UDF-052; R1-D-222)

From the next release (`contracts` and `notify` minors; no migration, no setting), NOTIFY reaches staff by role in a tenant: "the RE's admins", a named function such as the compliance officer, or your operations team.

- **Declare a staff class** in your notify catalogue: `audience: staff`, channels `inapp` and `email` only, `variables` (required) and `subject_variables` (the only variables the subject and titles may carry; default none). A staff class is never marketing. Make it `mandatory` only for operational messages people must not switch off (IPB-07-25: they can still be routed with `ntf.org.routing`); otherwise each person's `ntf.user.channels` applies. Digest-first, quiet hours, `kill.msg.*` and suppression apply as for any class.
- **Send by role:** `notify.notifyStaff(ctx, { class, roles: ["ORG_ADMIN"], vars, deepLink, idempotencyKey, exclude? })`, or `enqueueStaff(tx, …)` inside your own transaction (sent by `dispatchDue`). NOTIFY finds the active people (never agents or service accounts) who hold a role in the context's tenant at send time, plus the current holders of a function for `FN:<CODE>`; `exclude` drops the person who acted. Roles may be `ORG_*`, `OPS_*`, your product roles or `FN:<CODE>`; `PLT_*`, `SVC_*` and `AGT_*` are refused. One call never reaches another tenant.
- **No personal data:** variables are references and codes. NOTIFY refuses (`IPB-NTF-007`, 422, with `meta.reason`) an undeclared variable, any value with an e-mail address, a phone number, a PAN, an Aadhaar number or VID, and a subject variable that is not a reference or code (no spaces, no run of 10 or more digits). Your in-app titles for a staff class may use only `subject_variables` (checked when `NotifyService` starts), and so may a tenant's own email subject (checked when the template is saved and at every delivery). Keep your vendor email template's subject to the same variables; put everything else behind the deep link.
- **Nobody holds the role:** the result is `outcome: "no_recipients"` with no delivery; it is recorded and ledgered, and the same key replays it. To fall back (for example to your operations team), send again with a new key.
- **Receipt:** `notify.deliveryReceipt(ctx, notificationId)` gives each recipient's deliveries (state, attempt, adapter, error code, time) and `reached` (any `sent` or `delivered`); vendor reports update the states as before. `send` and `enqueue` refuse a staff class.
- **Addresses:** your `ContactResolver` resolves `usr_…` references to the person's work e-mail at delivery, as for approval reminders; nothing is stored.
- **Your operations team:** give them `OPS_*` roles in your operator tenant and call `notifyStaff` in that tenant's context, carrying only references to the RE's record (owner question #160).

```ts
const r = await notify.notifyStaff(ctx, {
  class: "udf.re_admin.lender_action_needed",
  roles: ["ORG_ADMIN"],
  vars: { application: app.id, count: 3 },
  deepLink: `/applications/${app.id}`,
  idempotencyKey: `udf.re_admin.lender_action_needed:${app.id}`,
  exclude: [{ ref: ctx.principal.id }],
});
if (r.outcome === "no_recipients") await escalateToOperations(app.id);
```

## 7di. Borrower email with attachments and the verified email (PR-UDF-055; R1-D-224)

From the next release (`contracts`, `config`, `connectors`, `notify` and `testing` minors; migrations `notify/0008` and `connectors/0015`, both expand-only), a borrower email can carry stored documents byte-identical, with a receipt, and a signed-in borrower can prove an email address. Both are **off** until you turn them on.

- **Attach documents:** turn on `ntf.email.attachments.enabled` for the tenant, give `NotifyService` your tenant STORAGE (`attachments: { storage }`), and send with `attachments: [{ storageKey, sha256, filename, mediaType }]` (at most 10; PDF, PNG or JPEG; a plain file name whose extension fits the type). The class must be `urgent` and not marketing: attachments go with the immediate email only, never a digest. In-app, SMS, WhatsApp and push carry the deep link as before.
- **What NOTIFY checks at send**, before the vendor: the EMAIL adapter declares `attachments: "native"` (`ses` and `brevo` do; otherwise the email fails `IPB-PORT-001` `unsupported`); each key is in your tenant; the object is `GENERAL` or `PUBLIC_ASSETS`, outside any compartment; its stored type and its first bytes are the declared type; its SHA-256 is the one you sent; 10 MiB together at most. Any failure fails that email (`IPB-PORT-003`) and nothing is sent. The bytes go to the adapter as read, and the adapter checks the SHA-256 again over the bytes it hands to the vendor: no decoding, re-encoding or re-rendering.
- **The receipt:** `deliveryStatus(ctx, notificationId)` gives the email delivery's `state`, `adapter`, `vendorRef` (the vendor's message id) and `attachments: [{ sha256, bytes }]`, in order. Delivery reports (`delivered`, bounces) update the same record. Show the borrower the document's SHA-256 beside the download so the copy can be checked.
- **Loan documents (KFS, sanction letter):** these are `CONFIDENTIAL`, and IPB-01 sends CONFIDENTIAL content by secure link, never inline. They are refused as attachments; send the email with the deep link. The platform setting `ntf.email.attachments.confidential` (off) would allow them only to an EMAIL adapter that is `IN` and carries CONFIDENTIAL, which none does today (owner question #161).
- **The verified email:** turn on `int.identity.customer.email_capture.enabled` (platform, security officer) and pass `emailCapture: await readCustomerEmailCapture((k) => settings.get(ctx, k))` to `KeycloakCustomerIdentity` or `ZitadelCustomerIdentity`. From the signed-in borrower's request, call `startEmailVerification({ tenantId, userId, email, dpopProof })` (the proof is for `signInProofTarget`, as at sign-in, made with the key of the device the borrower is signed in on; any other key is `IPB-IDN-001` `device`); the code goes through your `notifyOtpSender`'s `email` class, so word that template for both sign-in and verification. Then `confirmEmailVerification({ tenantId, userId, challengeId, email, code, dpopProof })` returns `{ email, verifiedAt }` and records it on the account (a later proof replaces it). The sign-in code rules apply: `int.identity.customer.otp.*` tries per code, resend interval, back-off and lockout (`IPB-SEC-019`); a wrong code or another address is `IPB-IDN-001`.
- **Send only to the verified address:** have your `ContactResolver` answer a borrower's `email` with `verifiedEmail(tenantId, userId)` (null means no email). A `PgCustomerAuthStore` needs `connectors/0015`; a store of your own needs `saveVerifiedEmail` and `verifiedEmail`, or the capture is `unsupported`.
- **How long the address is kept (owner answer #161 (3)):** while the account is open, replaced by a later proof. It is **deleted** when the account is closed (`retireLogin`) or on the borrower's erasure request (`eraseVerifiedEmail`), each deletion ledgered without the address (§7do).
- **Testing:** the SES and Brevo stubs record each attachment's `sha256` over the bytes they decoded, so a test can compare it with the stored object's.

## 7dm. No-cache presigned downloads (PR-UDF-060; R1-D-230)

From the next release (`contracts`, `connectors`, `fakes` and `testing` minors; no setting, no migration), `storage.presign(key, "get", ttl)` for an object in `REGULATED` or `CONFIDENTIAL` (`NO_CACHE_PRESIGN_CLASSES`, compartments included) signs S3's response overrides `response-cache-control=no-store, private` and `response-expires=Thu, 01 Jan 1970 00:00:00 GMT`, so S3 and MinIO answer the download with `Cache-Control: no-store, private` and an `Expires` in the past, and iOS, Android webviews and browsers keep no copy of the document. Nothing changes for `GENERAL`, `PUBLIC_ASSETS`, `AUDIT` and `QUARANTINE`, or for upload URLs. The headers follow the bucket the URL reads from, so nothing you pass can drop them; the URL is longer by about 110 characters. S3 has no `Pragma` override: `Cache-Control: no-store` supersedes it for HTTP/1.1 clients, and if a client of yours needs `Pragma: no-cache`, serve the bytes through your own endpoint instead of handing out the URL. Your app's own download code must not copy the file to a cache directory either. `MemoryStorage` puts the same two parameters on its `memory://` URLs, so a test can check them.

## 7dn. Udofin's `udf_ext` v1 fields in the origination contract (PR-UDF-061; R1-D-232)

From the next release (`contracts`, `fakes` and `testing` minors; no setting, no migration), every item of the `udf_ext` v1 list is an optional field of `@infrabyx/contracts/events`, or the new `CoolingOffExitAnswered`. Move each field out of your extension as you adopt the release; a lender that does not send a field is still valid.

| Your extension field                                                                                                  | Now                                                                                                                                                                          |
| --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Offer `monthly_instalment_paise`                                                                                      | `OriginationOffer.monthly_instalment_paise` (agrees with `monthly_instalment` when both are sent)                                                                            |
| Offer penal charges text and list `{ basis, rate_or_amount, description }`                                            | `penal_charges_text`; `penal_charges[]` with exactly one of `rate_bp` or `amount_paise`                                                                                      |
| Offer `kfs_url` or KFS document ref                                                                                   | `kfs_url` (`https` only) or `kfs_link { document_id, version? }`                                                                                                             |
| Two-character `product_code`                                                                                          | Taken (`PRODUCT_CODE_PATTERN`)                                                                                                                                               |
| `ApplicationSubmitted` chosen offer, request, profile, household, KYC, credit modes, consent purposes                 | `offer_ref`, `product_code`, `request`, `economic_profile`, `household.monthly_household_income_paise` and `is_microfinance`, `kyc`, `credit_data_modes`, `consent_purposes` |
| `BorrowerAccepted` application ref, KFS version and hash, acknowledgement time, device ref                            | `lsp_application_ref`, `kfs_version`, `kfs_sha256`, `acknowledged_at`, `device_ref`                                                                                          |
| `CoolingOffExitRequested` application ref                                                                             | `lsp_application_ref`                                                                                                                                                        |
| The lender's answer to an exit request                                                                                | The new event `CoolingOffExitAnswered` (`in.infrabyx.servicing.CoolingOffExitAnswered.v1`, key `(loan_id, exit_ref)`)                                                        |
| Status text, reason texts                                                                                             | `ApplicationStatusChanged.status_text`; `DecisionMade.reason_texts[]`                                                                                                        |
| KFS issue time, language, document ref, tenor in days, cash flows, charges, cooling-off days, exit terms, Annex items | `KFSIssued.issued_at`, `language`, `document_ref`, `tenor_days`, `cash_flows`, `charges`, `cooling_off_days`, `exit_terms`, `nodal_gro`, `co_lending`, `lsp_recovery_agent`  |
| Sanction letter document ref                                                                                          | `SanctionLetterIssued.document_ref`                                                                                                                                          |
| `LoanDisbursed` application id and time                                                                               | `application_id`, `disbursed_at`                                                                                                                                             |
| Manifest `stampEvidence`, `notStampable`, `disbursementClause`; no-cache presigned GETs                               | Already in 1.40.0 (§7df, §7dm)                                                                                                                                               |

**What to do with them:**

- Show the lender's words (`status_text`, `reason_texts`, `penal_charges_text`, `exit_terms`, `payment_instruction`) as text, never as markup, and say they are the lender's.
- `CoolingOffExitAnswered` is not signed until the Specification lists it (owner question #166; signed from the next minor, §7dp). Take it only from the lender's authenticated channel, show the amount and instruction to the borrower, and never collect the money into an account of your own (CF para 10). The instruction never carries a link.
- `kfs_url` is a link for the borrower's browser. Do not fetch it from your servers; fetch the KFS bytes through `GET /v1/documents/{id}` with `kfs_link` or `document_ref`, and check them against `document_sha256`.
- Send `economic_profile` and the household figures only under the purpose consent that `consent_purposes` names; `device_ref` is your own reference, never an IMEI, advertising id or other device identifier.
- Send `kfs_version` and `kfs_sha256` on acceptance: the lender refuses an acceptance of a KFS other than the one it issued (`kfs_mismatch`).

## 7do. Deleting the verified email at account closure or on erasure (owner answer #161 (3); R1-D-235)

From the next release (`contracts` and `connectors` minors; migration `connectors/0016`, expand-only; no setting), the borrower's verified email (§7di) is deleted when the account closes or the borrower asks for erasure.

- **Run the migration:** `connectors/0016` (with the rest of the platform migrations). It grants `app_rw` DELETE on `connectors.customer_verified_email` only, and adds a trigger that lets a row go only inside the platform's deletion (kernel action `identity.customer.verified_email.delete`). Your own SQL cannot delete the row; call the methods below.
- **Account closure:** nothing new to call. `retireLogin({ tenantId, userId, channel, login })` now deletes the address after forgetting the devices and before the IdP frees the login, ledgered with reason `account_closed`. A retry after an IdP failure is safe.
- **Erasure request:** from your erasure workflow, call `eraseVerifiedEmail({ tenantId, userId, requestRef })` on the customer IDENTITY adapter. `requestRef` is your erasure request's reference (1 to 128 of `[A-Za-z0-9_.:-]`, no personal data). It returns `{ erased }`, false when there was nothing to delete; every call is ledgered with reason `erasure_request` and the reference (`found: false` on a repeat), so the request's handling is on the record. It works with the capture setting off. Erase the borrower's settings (`SettingsService.eraseUser`) and your own copies in the same workflow.
- **A store of your own:** add `deleteVerifiedEmail(tenantId, userId, reason, requestRef?)`. A store with `saveVerifiedEmail` but without it makes `retireLogin` and `eraseVerifiedEmail` refuse with `IPB-PORT-001` `unsupported` before anything changes. A store that keeps no address retires as before.
- **After an erasure** the borrower can prove an address again; that records a fresh row.

## 7dp. The signed execution pack, the v2 document JWS and per-subject envelopes (PR-UDF-061 items 12 to 17; R1-D-236)

From the next release (`contracts`, `crypto`, `fakes` and `testing` minors; no setting, no migration, no environment variable). The owner approved PR-047 (Ecosystem Spec v1.6 proposal) on 20 Nov 2026: products adopt the Specification text when the owner's process publishes it in `docs/ecosystem`, and the signed behaviour below applies from this minor.

**Install:** bump `@infrabyx/contracts`, `@infrabyx/crypto`, `@infrabyx/fakes` and `@infrabyx/testing` to the release's minors together (the mock lender and the contract cases expect the new contracts).

**What changes for a consumer (Udofin):**

- **Two more regulated messages.** `ExecutionPackIssued` and `CoolingOffExitAnswered` are in `REGULATED_MESSAGE_EVENTS`, so `isRegulatedMessage` is true for them: verify `X-Infrabyx-JWS` with `verifyRegulatedMessage` before your `2xx`, store it beside the event, and refuse an unsigned one with `signature-invalid`. `payment_instruction` still carries no link; show it as the lender's words and never collect the money yourself (CF para 10).
- **Take the pack from `ExecutionPackIssued`** (`in.infrabyx.origination.ExecutionPackIssued.v1`, key `(pack_id, version)`; parse with `ExecutionPackIssuedData`). Execute only the latest version, within the KFS validity, and check `kfs_version` and `kfs_sha256` against the KFS your borrower accepted. The interim `EXECUTION_PACK_MANIFEST` document and `ExecutionPackManifest` stay for now, unchanged; move off them, they go in a major.

| Your PR-UDF-061 item (12)                                          | Field of `ExecutionPackIssuedData`                                                                                                   |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| The accepted KFS's version and `kfs_sha256`                        | `kfs_version`, `kfs_sha256` (a `KFS` document in the pack has that hash)                                                             |
| `items[].instrument_code`, `enclosure_code`                        | `documents[].instrument_code` (required when executed; never eSign or DSC for `IT_ACT_FIRST_SCHEDULE_INSTRUMENTS`), `enclosure_code` |
| `covenant { business_purpose, declared }`, conditional declaration | `covenant` (strict); `covenant_declaration` present exactly when `declared`, which a business purpose requires                       |
| `enclosure_list { code, clause_ref }`                              | `enclosure_list` (each code furnished by exactly one document's `enclosure_code`)                                                    |
| Per-document `stamp_evidence { channel, certificate_no, … }`       | `documents[].stamp_evidence` (`PackStampEvidence`; `channel` in `STAMP_MODES`; duty paid at least `stated_duty_paise`)               |
| `not_stampable { document_id, reason }`                            | `not_stampable[]` at pack level                                                                                                      |
| Signers as an enum                                                 | `documents[].signers` in `PACK_SIGNER_ROLES`, each once                                                                              |

- **Documents.** `DocumentShared` may carry `language`; `application_id` is on every document of a loan application. Lenders now sign a **v2 document JWS** that also binds `type`, `media_type`, `size_bytes` and `application_id`: keep calling `verifyDocumentJws(jws, data, keys)` with the `DocumentShared` data or the `GET /v1/documents/{id}` answer as they are (both carry the fields), check the downloaded bytes' length against `size_bytes` as well as their hash, and pass `{ requireV2: true }` once your lender signs v2. A producer signs with `signDocumentJwsV2`.
- **`KFSIssued` and `SanctionLetterIssued`** name their file by `document_ref` and `document_version`: fetch that document and check it against `document_sha256`.
- **Envelopes (§3.2).** The `subject` is the aggregate id (`originationSubject(name, data)`; `ORIGINATION_EVENTS[name].subject` names the field, `subjectFallback` the fields used when it is absent) and `seq` counts per subject from 1. The lender's origination events for one application (status changes, info requests, decision, KFS, sanction letter, execution pack) are one stream on `application_id`; `LoanDisbursed` and the cooling-off events are on `loan_id`; `DocumentShared` is on `document_id`. Order, park gaps and replay per `(source, subject)`, never across a producer. Your own outbox puts `ApplicationSubmitted` and `BorrowerAccepted` on your `lsp_application_ref` (send it on `BorrowerAccepted`; without it the subject falls back to `kfs_id`), `ESignCompleted` and `EStampCompleted` on `application_id` (send it; else `document_id`) and `CoolingOffExitRequested` on `loan_id`; `lspEvent` in `@infrabyx/testing` already does.

**Tests against `FakeLender` that change:** its envelopes' `subject` and `seq` (above); its documents are small real PDFs, so a hash is over PDF bytes, not a string; the KFS and the sanction letter are shared after the sanction, while the agreement, terms and conditions, product summary, privacy policy, e-stamp certificate, `ExecutionPackIssued` and the interim manifest follow `BorrowerAccepted` (`executionPack()` is refused `pack_unknown` before it); `CoolingOffExitAnswered` carries a JWS. A request purpose starting `BUSINESS` gets the covenant declared.

## 7dq. Another person, another tenant and `Promise.all` inside `kernel.ambient` (PR-UDF-062; R1-D-237)

From the next `tenancy` minor (no migration, no setting, no type change), three things that `kernel.ambient` refused now work. A call that was accepted before behaves as before.

| Inside `kernel.ambient(ctx, fn, opts)`                               | Before                         | Now                                                                                                                                                                                                                              |
| -------------------------------------------------------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kernel.mutate` by another person of the same tenant                 | Refused ("ambient mutation's") | Joins in a savepoint as that person: its own `app.*` settings, so RLS and the ledger see that person, and its ledger entries name them. The handler's settings come back after it, whether it succeeded, threw or failed in SQL. |
| `kernel.read` by another person of the same tenant, with `joinReads` | Its own transaction            | Joins as that person, read-only, as the read role (§7cm)                                                                                                                                                                         |
| `kernel.mutate` or `kernel.read` for another tenant                  | Refused (`mutate`)             | Runs in its own transaction, as if no ambient mutation were open: it commits or rolls back on its own, and neither tenant sees the other's uncommitted rows                                                                      |
| `Promise.all` of joined calls                                        | Refused ("one at a time")      | Queued: they run one at a time, in the order made. A call made inside a running joined call runs at once.                                                                                                                        |

**What to know:**

- Still refused: another person when they or the handler hold a break-glass grant or support access, an external person or a service reader, another scope (platform or tenant), and a role other than the app role. Their own transactions check a grant that a joined call would skip (owner question #169).
- While a joined call runs, the handler's own `tx.query` and `tx.unit` wait for it, so no statement runs under another person's settings.
- Another tenant's call needs a free pool connection: with a pool of one it waits for ever. Never `await` a sibling that was queued after the call doing the waiting; it waits for ever too.
- Do not leave a call or statement running after the joined call that started it has returned: it is refused ("has ended").
- If a joined call's settings cannot be put back (a broken connection), the whole handler fails and rolls back, even if you caught the error.
- **Udofin:** work you kept outside `kernel.ambient` for these three cases can move inside it.

## 7dr. Partner mTLS client certificates and the Standard Webhooks receiver (PR-UDF-064; R1-D-238)

From the next release (a `crypto` minor; no setting, no migration), partner calls authenticated by client certificate and inbound Standard Webhooks are verified the same way in every product.

**Partner mTLS.**

1. **Configure the edge** as `docs/platform/mtls-edge-header.md` §3 says: verify the client certificate, strip any client copy of `X-IPB-Client-Cert`, forward the verified leaf in it (percent-encoded PEM), only on the partner mTLS routes, and make the edge the only way to your partner listener. Check the nginx, ALB or Envoy lines marked [VERIFY] against your edge version.
2. **Read it** in your partner-API guard: `readClientCertificate({ header: req.headers["x-ipb-client-cert"] })` (Envoy: `req.headers["x-forwarded-client-cert"]` with `format: "xfcc"`; your own TLS listener: `{ socket: req.socket }`). On `ok: false` answer `IPB-API-009` (401) and log the `reason` only, never the header.
3. **Authorise on `certificate.x5tS256`**, looked up in your partner registry; never on `subject`. For an RFC 8705 token, compare `cnf["x5t#S256"]` with it. Register a partner's next certificate's `x5tS256` before its rotation.
4. **Optional, defence in depth:** pass `trust: PinnedCaSet.fromPem([partnerCaPem], { intermediates })`, built once at start-up. It accepts only ECDSA P-256 / SHA-256 issuer signatures today; a partner CA that signs with RSA is refused `issuer_algorithm` until the owner answers #170, so leave `trust` out for such a partner and rely on the edge's verification.
5. **Tests:** `mtlsTestAuthority()` from `@infrabyx/crypto/mtls-test` issues throwaway client certificates, and `edgeHeaderValueForTest(pem)` makes the header value.

**Standard Webhooks.** For a sender that signs with Standard Webhooks v1 (`webhook-id`, `webhook-timestamp`, `webhook-signature`), use one receiver per endpoint:

```ts
const receiver = new StandardWebhookReceiver({
  name: "partner-events",
  secrets: () => secrets.read("partner-events/webhook"), // current and, during a rotation, previous whsec_
  replay: redisReplayStore, // RedisReplayStore.fromUrl(…) from @infrabyx/connectors/identity
});
const r = await receiver.receive(rawBody, req.headers); // the raw bytes, before JSON parsing
if (!r.ok) return reply.status(401).send(); // log r.reason only
// then: inbox.firstSeen(tx, schema, "partner-events", r.id), queue the work and answer 2xx (IPB-10-27)
```

The default replay key is the delivery (id and signed timestamp): a captured delivery sent again is refused `replayed`, while the sender's signed retry verifies, so de-duplicate by `r.id` in your module inbox. A module without an inbox for these events passes `replayKey: "event"`. Use `MemoryReplayStore` only in tests or a single instance.

## 7ds. Checking a lender's key before you use it (PR-UDF-068; R1-D-239)

From the next release (`contracts`, `connectors`, `fakes` and `testing` minors; no setting, no migration), `storage.keyRefStatus?.(tenantId, keyRef, { bucketClass, compartment?, describeKey? })` tells you whether a write naming that reference (§7dl) would resolve, without writing anything. Call it when you onboard a lender and before you accept an upload into that lender's vault.

- **Answer:** `{ status: "resolves" }`, or `{ status: "refused", reason }` with the label the write would be refused with: `key_ref_invalid`, `key_ref_class`, `key_ref_prefix_invalid`, `key_ref_unknown` (also for another tenant's reference), `key_ref_shared` or `key_ref_tenant_cmk`. Labels only: the key id or ARN never appears in the answer or in an error. `key_ref_changed` and `key_ref_prefix_conflict` concern one object and are still checked by the write.
- **Key state:** with `describeKey: true`, the `s3` adapter also reads the key's state with one read-only KMS `DescribeKey`: `Enabled` answers `{ status: "resolves", keyState: "Enabled" }`; any other state (`Disabled`, `PendingDeletion`, …) answers `{ status: "refused", reason: "storage_key_unavailable", keyState }`, the same reason a read or write of that lender's files gets (`IPB-KMS-001`). Show the user that the lender's key is unavailable; do not retry blindly. A key the platform role may not describe also answers `storage_key_unavailable`, so a lender key policy must grant the platform's STORAGE role `kms:DescribeKey` as well as `kms:GenerateDataKey` and `kms:Decrypt` (your production configuration). A throttled or failed KMS call throws `IPB-PORT-002`. Without `describeKey` no KMS call is made: the answer is the configuration alone, and a disabled key still resolves.
- **Errors, not answers:** a tenant other than the caller's, a malformed tenant id or class, or a compartment outside its classes throws `IPB-PORT-003`; a location without a bucket throws `IPB-PORT-001`, as a write would.
- **Adapters:** `minio` declares `keyRefStatus` `unsupported` (`IPB-PORT-001`), since it refuses every named key. `MemoryStorage` resolves the references in its `keyRefs` option and, with `describeKey`, reports `Enabled` or the state its new `keyStates(tenantId, keyRef)` option gives (only the status uses it). The method is optional on `StoragePort`: call it as `storage.keyRefStatus?.(…)`, or require it of your adapter.
- **Ledger:** the check is a read of configuration and is not ledgered; when your product decides something on it (a lender onboarded, an upload refused), ledger that decision in your own transaction. An answer is valid at the moment it is given: a key disabled later still fails the write with `storage_key_unavailable`, so keep that handling.

## 7dt. Named keys in QUARANTINE, and the AV engine's grant (PR-UDF-066; R1-D-240)

From the next release (`contracts`, `connectors` and `testing` minors; no setting, no migration), `NAMED_KEY_CLASSES` includes `QUARANTINE`, so a lender's upload is under the lender's key (§7dl) from its first byte: `storage.put(key, body, { bucketClass: "QUARANTINE", keyRef })`, a presigned upload with `keyRef`, or no `keyRef` under a prefix of your `tenantKeyRefPrefixes` (before this release such a put was refused `key_ref_class`). `AUDIT`, `GENERAL` and `PUBLIC_ASSETS` still refuse a reference; compartments are unchanged.

- **Configure** `tenantNamedKmsKeyIds(tenantId, { bucketClass: "QUARANTINE" })` to return the lender's reference. The same key may serve `QUARANTINE` and the clean class, or you may give the reference a separate key there (one more KMS key per lender, a recurring cost); a named key equal to the `QUARANTINE` class key is refused `key_ref_shared`. `keyRefStatus(tenantId, keyRef, { bucketClass: "QUARANTINE" })` (§7ds) checks it.
- **Promote** a clean upload with `get` then `put` and build the clean write's meta with `promotedObjectMeta(quarantined.meta, { bucketClass: "REGULATED" })`: it carries the reference (and the content type, SHA-256 and tags), so the copy is re-encrypted under that reference's key at the clean location, or refused (`key_ref_unknown` if the reference has no key there, `key_ref_class` for a class without named keys). It never lands under the clean class's key. If you build the meta yourself, keep `keyRef`: outside a prefix map, a put without it is written under the class key. A prefix map that covers both the upload's key and the clean key gives both writes the reference without naming it. Delete the quarantined object afterwards as you do today.
- **The AV engine needs the decrypt grant.** The ClamAV adapter reads the object through STORAGE and streams it to clamd, so the IAM role of the workload that runs the AV adapter (clamd itself never touches S3 or KMS) needs `kms:Decrypt` on every named key used in `QUARANTINE`; if that is your app's own STORAGE role, it already has it. Without the grant, or once a lender revokes or disables its key, the read is `IPB-KMS-001` `storage_key_unavailable` and the scan answers `ERROR` (`unavailable`): the file stays quarantined and is never released.
- **Key policy statement** (your production configuration, in each lender's key policy, alongside the platform STORAGE role's `kms:GenerateDataKey` and `kms:Decrypt`): allow the scanner's role `kms:Decrypt`, with the conditions `kms:ViaService` = `s3.<region>.amazonaws.com` and `kms:EncryptionContext:aws:s3:arn` = the quarantine bucket's ARN (S3 Bucket Keys on, the default) or `StringLike` the bucket ARN followed by `/*` (a reference with `bucketKey: false`). The condition keeps the scanner from decrypting that lender's clean files when the lender uses one key for both classes; give the scanner's role `s3:GetObject` on the quarantine bucket only. The reference OpenTofu modules provision no `QUARANTINE` bucket, scanner role or per-lender key, so nothing there changes: add the statement where you manage the lender's key.
- **Risk:** every workload with that grant can read the lender's uploads while they wait for a scan, and a lender-controlled key means the lender can stop scanning (and so the release) of its own uploads by revoking the grant. Keep the scanning workload separate and its network policy tight (threat model §3.113, §3.164).
- **Testing:** `MemoryStorage` accepts a reference in `QUARANTINE` as in the other named classes; the STORAGE contract case covers the upload and its promotion.

## 7du. Text from a PDF under a revoked lender key (PR-UDF-067; R1-D-241)

From the next release (`connectors` minor, `contracts` patch; no setting, no migration), `PdfTextExtractor.extractText` (adapter `pdf-text`) no longer reports a file whose named lender key is disabled, deleted or no longer granted (§7dl) as a storage outage.

- **Was:** `IPB-PORT-002` (`reason: "unavailable"`) for any STORAGE read failure.
- **Now:** `IPB-KMS-001` (503) with `reason: "storage_key_unavailable"` when the read was refused for that key, and nothing else about the key (no key reference, key id or vendor error). Tell the user the lender's key is unavailable and do not retry blindly, as for a direct `storage.get` (§7dl).
- **Unchanged:** any other read failure is still `IPB-PORT-002` `unavailable` (retry as before); a corrupt, unreadable or encrypted PDF is still `IPB-SEC-010`; the size, time and memory limits `IPB-SEC-013`; an unscanned or swapped file `IPB-SEC-015`.
- **Adopt:** if you mapped `IPB-PORT-002` from `extractText` to a retry, add a case for `IPB-KMS-001` with `reason: "storage_key_unavailable"`. The AV scan of such a file still answers `ERROR` with `reason: "unavailable"` (R1-D-241 (4)).

## 7dv. The no-Aadhaar sweep's gaps closed: named fields, every column, look-alikes by choice (PR-UDF-063; R1-D-242)

From the next release (`contracts` and `testing` minors; no setting, no migration), the sweep of §7cs is stricter by default; nothing is looser unless your product asks.

- **Named fields.** A column or JSON field named like an Aadhaar carrier is a find whenever it holds a value, whatever the value (a checksum is not needed): `aadhaar` or `aadhar`, alone or with `_no`, `_num`, `_number`, `_id`, `_uid`, `_vid`, `_virtual_id`, `_token`, `_card`, `_card_no` or `_card_number`; `uid`, alone or with `_no`, `_num`, `_number` or `_token`; in any case and with any separators (`aadhaarNumber`, `UID_TOKEN`). Not `aadhaar_last_digits`, `uid_kind` or `user_uid`. `isAadhaarFieldName` and `findAadhaarNamedFields(json)` in `@infrabyx/contracts/aadhaar` give you the same check for your own data. The sweep reports it as `kind: "FIELD"`, `masked: "(value withheld)"`, with `field` the JSON key path when it is inside a document. Booleans, nulls, blank strings and empty arrays or objects hold nothing. If you use `uid` for a user id, rename the column or skip it (`skip: ["schema.table.uid"]`); there is no Aadhaar vault token format on the platform to exempt.
- **Every column.** `scanDatabaseForAadhaar` now reads every column of every type of every table (numbers, arrays, `json` as written, `jsonb`, composites, `bytea` as hex and decoded), in batches, and rejects instead of passing: `AadhaarScanEmptyError` when it read no table or no row (`allowEmpty: true` if your suite's database is legitimately empty at the end), `AadhaarScanLimitError` past `maxRows` (default 100 000). Expect new finds where a numeric column holds twelve-digit values. `sweepDatabaseForAadhaar` returns `{ finds, tables, rows }`.
- **UUIDs.** A UUID is blanked only when it stands alone; digits glued to a UUID-shaped string (a letter or digit next to it, or a four-digit group joined to it by one space or hyphen) are read as the rule reads them.
- **The CLI fails closed.** `infrabyx-aadhaar-scan` exits **0** when every file was read and nothing found, **1** on a find, and **2** when nothing is proven: a usage error, no file read at all (empty directories, only `node_modules`/`.git`/`dist`, or every file skipped), or a file that could not be read. Before, an empty scan exited 0 and a read error 1: check your CI step treats 2 as a failure (any non-zero does). `--help` lists the options and codes.
- **Look-alikes, your choice.** By default `+91` and ten digits (`+91dddddddddd`) and digits next to a decimal point (`0.dddddddddddd`, `dddddddddddd.50`) are finds when they pass the Aadhaar check. If your data holds Indian E.164 phone numbers or long decimals, you may let them through: `findAadhaarLike(text, { allow: ["e164_in", "decimal"] })`, the same `allow` on the scan functions and `beforeDrop` sweep, and `--allow e164_in,decimal` on the CLI. Only the ungrouped forms pass; `91dddddddddd` without the `+` is still a find, and an unknown name is refused. The risk is yours: an Aadhaar number written as `+<number>` or next to a `.` is then missed, so allow only what your data needs, record the choice in your decisions log, and keep the default in the scans over fixtures that come from vendors or borrowers.
- **`TestDatabase.end()`** is idempotent: a second call, later or at the same time, returns the first call's promise (rejecting the same way if the hook failed), so `beforeDrop` and the drop run once. An `afterAll(() => db.end())` beside an explicit `end()` is now safe.
- **Udofin:** the request's six items are covered; drop any wrapper that guarded `end()` against a second call.

## 7dw. The fake AA's FI payloads in STORAGE, for statement analysis (PR-UDF-065; R1-D-243)

From the next release (`fakes` and `testing` minors; no setting, no migration), `FakeAccountAggregator.fetch` stores each FI payload the way `setu-aa` does, so you can wire the AA to statement analysis in a fixture environment or a test with no adapter of your own.

- **Share one STORAGE:** `const storage = new MemoryStorage(); const aa = new FakeAccountAggregator({ storage }); const sa = new FakeStatementAnalysis({ storage });`. Each payload is a synthetic ReBIT-shaped JSON object (`fakeFiPayload`) in the `REGULATED` class under `<dataPrefix><ULID>.json` (an IPB-01-27 key), and `payload.sha256` is the SHA-256 of exactly those bytes.
- **Analyse by reference:** pass `inputs: result.payloads.map(({ fiType, storageKey, sha256 }) => ({ fiType, storageKey, sha256 }))` with a `reportPrefix` in the same tenant as the fetch's `dataPrefix`. Never copy the payload's content into your own records or events.
- **Without `storage`** the fake keeps its own `MemoryStorage` (read it as `aa.storage`), so existing tests run unchanged, except a test that matched the old key shape (`<dataPrefix><sessionId>-<fiType>.json`) or the old digest: read the payload from `storage` instead.
- **Your own adapter's tests:** `accountAggregatorContractCases` now checks that every payload key is IPB-01-27's; give `storageOf: (p) => yourStorage` in the fixtures to have each payload read back (REGULATED, bytes matching the SHA-256). `aaStatementAnalysisJoinCases({ storage, dataPrefix, reportPrefix, calls })` runs your STATEMENT_ANALYSIS adapter against the fake AA over the same STORAGE: a tampered or removed payload, one outside `REGULATED` or a key outside IPB-01-27 must be refused before any analyser call.

## 7dx. A step-up for sensitive borrower actions (PR-UDF-056; R1-D-244)

From the next release (`contracts` and `connectors` minors; migration `connectors/0017`, expand-only; no setting), a sensitive borrower action can require a fresh one-time code on the borrower's current device session, and every verified customer request says how strong and how old its authentication is. Nothing changes until you declare a policy.

- **Run the migration:** `connectors/0017` adds `step_up_at` and `step_up_acr` to `connectors.customer_device`. Run it before upgrading; a store of your own needs `recordStepUp(tenantId, deviceId, acr, at)` (without it the step-up refuses `IPB-PORT-001` `unsupported`).
- **Claims:** `verifyRequest` now answers `acr` (`"otp"`) and `auth_time` (epoch seconds) on `VerifiedCustomerClaims`: the later of the device's sign-in and its last step-up. A refresh does not change it. `acr` is the platform's level, not the IdP's value.
- **Declare your policies once, at boot:** `const STEP_UP = customerStepUpPolicies({ "document.original.download": {}, "loan.agreement.view": { maxAgeSeconds: 900 } })`. The default is `{ acr: "otp", maxAgeSeconds: 300 }`; `maxAgeSeconds` is 60 to 3600. A bad name or value throws at start.
- **On the sensitive route:** `const claims = await customer.verifyRequest({ authorization, dpopProof, method, url, fresh: true })` (`fresh` reads the device past the 15 s cache, so a step-up made through another replica counts at once), then `assertCustomerStepUp(claims, STEP_UP["document.original.download"])`. On `IPB-SEC-001` answer `customerStepUpChallenge(e)`: status 401 with `WWW-Authenticate: DPoP error="insufficient_user_authentication", …, acr_values="otp", max_age=300, algs="ES256"`. The refusal names only the level and max age; do not add the session's age to your problem body.
- **Your step-up routes** (keep them outside the step-up check; `assertStepUpReachable` flags `otp` paths): start with `startStepUp({ tenantId, userId: claims.sub, deviceId: claims.deviceId, channel, login, dpopProof })`, where `login` is the borrower's **registered** login (the platform checks it is this account's) and the proof is the app's usual sign-in proof (`signInProofTarget`) by the device key. The borrower gets a six-digit code through NOTIFY. Finish with `confirmStepUp({ tenantId, userId, deviceId, challengeId, code, dpopProof })`, which returns `{ deviceId, acr, authTime }`; then the app retries the action.
- **Refusals:** `IPB-IDN-001` with `meta.reason` `device` (the proof is not by that signed-in device, or it was signed out), `login`, `challenge` (expired, used, another account's or another device's), `code` (wrong), `dpop_*`; `IPB-SEC-019` (the account's sign-in code limits, shared with sign-in: the resend interval, 10 codes per 10 minutes, 5 tries per code, back-off and lockout).
- **Scope:** a step-up holds for that device session only (other devices, and a new sign-in, start from their own sign-in) and for every sensitive action whose max age it meets. The codes are never sign-in codes. No IdP, Keycloak extension or realm change is needed.

## 7dy. Recording paid stamps, and the NSDL eSign shell (PR-UDF-054; R1-D-245)

From the next `contracts`, `config`, `fakes`, `testing` and `connectors` minors (no migration, no environment variable). Four new adapters, **all off by default and `unproven`**; nothing changes for a product that does not switch them on. None buys stamp duty, stamp paper or an e-stamp, and none adds cryptography.

| Adapter        | Port and setting                          | What it does                                                                                                                       |
| -------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `shcil-estamp` | ESTAMP, `int.estamp.shcil.enabled`        | Records an e-stamp you bought through your own SHCIL channel and checks it with SHCIL (number, State and issue date only are sent) |
| `digio-estamp` | ESTAMP, `int.estamp.digio.enabled`        | Records an e-stamp Digio already issued to you, by Digio's id; never orders or affixes one                                         |
| `manual-paper` | ESTAMP, `int.estamp.manual_paper.enabled` | Records physical stamp paper or franking you hold; calls nothing outside                                                           |
| `nsdl-esign`   | ESIGN, `int.esign.nsdl.enabled`           | Keeps Aadhaar eSign envelopes locally; cannot sign yet (the request signature needs the owner's approval, #177)                    |

**Recording a stamp** (`recordCertificate(record, idempotencyKey)`, optional on ESTAMP): `channel` (`E_STAMP`, `FRANKING`, `PHYSICAL_PAPER`), `state` (`MH`), `instrument` (the Stamp Act article), `certificateNumber`, `dutyMinor`, `statedDutyMinor?`, `issuedAt`, `purchaser`, `stampedDocument` (STORAGE key and SHA-256), and for paper and franking `vendorLicence` and `certificateDocumentId` (the scan); `vendorCertificateId` for Digio; `recordedBy` (a user or a service). Then `stampEvidenceOf(certificate)` gives the execution pack's `stamp_evidence` (§7dp).

**What to know:**

- `purchase` on these adapters is refused with `purchase_not_permitted`; buy through your own channel, then record.
- A certificate number is recorded once per State and channel; a second instrument with the same stamp is refused (`certificate_reused`). Give your stamp table a unique index on State, channel and number, implement `StampRecordStore`, and write the record inside your `kernel.mutate`, so the ledger entry is in the same transaction.
- Refusals: `deficient_stamping` (duty below the stated duty), `hash_mismatch` (the stored document changed), `certificate_mismatch`, `certificate_not_found`, `certificate_not_usable` (cancelled), `channel_unsupported`, an agent recorder (`IPB-SEC-004`).
- Vendor shapes are to be confirmed against each sandbox: keep the adapters off until the owner's accounts exist. Whether a manually keyed stamp needs a checker before it enters a pack is the owner's question #177.
- **Udofin:** keep Leegality or Digio for eSign until #177 decides NSDL's request signing.

## 7dz. Checking a PDF's embedded signature locally (PR-UDF-059; C-28, R1-D-246)

From the next `crypto` minor (no migration, no setting), `@infrabyx/crypto` verifies a PDF's embedded PAdES/CMS signatures without an ESP call. It only verifies; it never signs.

```ts
import { verifyPadesSignatures } from "@infrabyx/crypto";

const result = verifyPadesSignatures(pdfBytes, {
  revocation: { crls, ocsp }, // optional DER you fetched; nothing is fetched for you
});
if (!result.valid) {
  // result.outcome: "invalid" | "incremental_update_after_signature" | "no_signature" | …
}
```

- **Read the bytes yourself** (from STORAGE, after the AV and hash checks you already run). Files up to 32 MiB by default (`maxBytes`, at most 64 MiB) and 16 signatures.
- **`result.valid`** is true only when every signature is valid and one covers the whole file. Per signature you get `outcome` (a fixed label, `PADES_OUTCOMES`), `signer` (subject, serial, issuer, certificate SHA-256), `signedAt` with `timeSource` (`timestamp`, `signing_time_attribute`, `signature_dictionary` or `verification_time`), `timestamp`, `chain`, `revocation` (`good`, `revoked` or `not_checked`) and `algorithm`. Do not log the signer block with document identifiers if your privacy notice does not cover it.
- **Not trusted yet:** the pinned CCA India store (`CCA_INDIA_TRUST`) is empty until the owner supplies CCA's root and intermediates (owner question #178), so every signature reports `chain_untrusted` today. Do not switch a business decision to this verifier before a release says the pins are in.
- **Revocation** is `not_checked` unless you pass CRLs or OCSP responses for every certificate below the root; a listed certificate makes the signature `certificate_revoked`.
- **B-LT and B-LTA files** (a DSS or document timestamp added after signing) report `incremental_update_after_signature` (or `unsupported_subfilter` for the document timestamp); treat them as needing review.
- **Tests:** `@infrabyx/crypto/pades-test` (dev only) gives `padesTestAuthority()`, which signs any classic-xref PDF (for example `pdfFixture`'s) and makes timestamps, CRLs and OCSP responses; pass its `trust` (results then say `trustStore: "custom"`). Never use it outside tests.

## 7ea. PDF/A-2b from `toPdf`, the same bytes on every render (PR-FBX-52; R1-D-248)

From `@infrabyx/export` 1.9 (a minor; no migration, setting or environment variable), `toPdf` can write PDF/A-2b with a tagged structure. It is opt-in: without `pdfa`, every byte is as in 1.8.5.

```ts
const pdf = toPdf(statement, {
  created: statementDate, // a fixed instant: it becomes /CreationDate, /ModDate and the XMP dates
  creator: "Finbyx",
  pdfa: "2b",
  lang: "en-IN", // BCP 47; default "en"
  pdfua: true, // optional: also claim PDF/UA-1
});
```

**What you get:** XMP metadata (PDF/A-2 part 2, conformance B) consistent with /Info; an sRGB output intent (bundled CC0 profile); every font embedded (as before); printable link annotations; and tags for IPB-06-26: /Lang, headings H1 to H6, paragraphs, lists with labels, tables with column headers, links, reading order, and rules and repeated table headers as artifacts. The same blocks, options and `created` give the same bytes in any process, on any day: hash a statutory statement once and re-render it to prove it (master prompt Part 7C AC3.1 step 6). veraPDF 1.30.3 passes the files as PDF/A-2b, and as PDF/UA-1 with `pdfua`.

**What to know:**

- Pass `created` from the statement's own date, never `new Date()`: the bytes, the ids and /ID all follow from it.
- `pdfua: true` needs a title and headings that start at level 1 and skip no level; otherwise `block_invalid`. Write link text that makes sense on its own (the annotation is described by its URL).
- New refusal `pdfa_invalid`: an unknown `pdfa` value, a `lang` that is not a BCP 47 tag, or `pdfua` without `pdfa`. A title or creator with characters XML cannot carry is `block_invalid`.
- The title, creator and language are written twice (/Info and XMP): if you redact metadata, redact both, or keep personal data out of them.
- `renderPdf` passes `pdfa` and `lang` to the in-process path; documents with Indic text still go to DOCGEN (§7ay), whose PDF/A is not byte-deterministic.
- **Adopt** with all `@infrabyx/*` pins moved together. To check your own templates, run the pinned veraPDF image the way `packages/export/src/__tests__/pdfa.int.test.ts` does (`TEST_IMAGES.verapdf`, `withJvmMitigation("verapdf")`, `--flavour 2b`, and `ua1` with `pdfua`).

## 7eb. Calling a partner over mTLS (PR-UDF-069; R1-D-250)

From the next `connectors` and `crypto` minors (no setting, migration or environment variable), one class makes an outbound call to a partner with the platform's client certificate: `PartnerMtlsClient` from `@infrabyx/connectors/egress`. The inbound side is §7dr.

```ts
import { PartnerMtlsClient } from "@infrabyx/connectors/egress";

const lender = new PartnerMtlsClient({
  hosts: ["api.lender.example"], // exact names; no wildcard
  clientCertificateRef: "secret://vault/partners/lender/mtls#certificate", // PEM, leaf first
  clientKeyRef: "secret://vault/partners/lender/mtls#key", // unencrypted P-256 PEM
  resolveSecret: secretsResolver(secretsAdapters), // from @infrabyx/config
  serverCa: lenderServerCaPem, // optional: pin the partner's server CA
});
await lender.checkCredentials(); // at start-up: dates and x5tS256, no partner call

const res = await lender.request({
  method: "POST", // or PUT; nothing else
  url: "https://api.lender.example/v1/disbursement-requests",
  body: JSON.stringify(payload),
  idempotencyKey: requestId, // required; reuse it on a retry
  headers: { authorization: `Bearer ${token}` }, // optional (RFC 8705 token)
  signal, // optional; the 15 s deadline applies as well
});
if (res.status >= 400) /* the partner's answer: decide */ ;
```

**What it enforces:** https on port 443 to the configured hosts; DNS once, every address public, the socket pinned to it, the server certificate verified against the host name (and your pinned CA); TLS 1.2 or later; no redirect followed (any 3xx is `IPB-SEC-018` `redirect`); the answer capped at 1 MiB (`maxResponseBytes`, up to 16 MiB; `IPB-SEC-013`); a body of at most 1 MiB (`maxRequestBytes`). Every refusal is a `PortError` with a fixed `meta.reason`; log the reason, never the URL's query or the body.

**What to know:**

- **The client key must be ECDSA P-256, in SECRETS.** RSA and P-384 keys are refused `key_type`, and a KMS-held key cannot be used (Node's TLS signs with an in-memory key only), until the owner answers #180. Ask the partner to issue the platform's client certificate on a P-256 key, and register its `x5tS256` (from `checkCredentials()`) with the partner.
- **Rotation:** the certificate and key are re-read from SECRETS every 5 minutes (`credentialTtlMs`, up to an hour) and at the certificate's notAfter; call `forgetCredentials()` after a rotation to use the new one at once.
- **Timeouts and aborts** are `IPB-PORT-002` with `reason` `timeout` or `aborted` and `meta.maybeSent`. When `maybeSent` is true the partner may have the request: retry with the same `idempotencyKey`, or reconcile.
- **Record the call** in your module's own kernel mutation (the ledger entry is yours, as for every adapter call), with the partner, the idempotency key and the status; never the body or the certificate.
- **Tests:** run a local `node:https` server with `requestCert: true` and certificates from `mtlsTestAuthority()` (`@infrabyx/crypto/mtls-test`), and pass the test-only `resolve`, `testAllowLoopback` and `testConnectPort` options, as `packages/connectors/src/egress/__tests__/partner-mtls.test.ts` does. Never set those options in a deployment.

## 7ec. ESIGN: the signer's certificate on each record, the fake in STORAGE, multi-document envelopes (PR-UDF-070; R1-D-251)

Minors of `contracts`, `crypto`, `fakes`, `testing` and `connectors`; no migration, setting or environment variable. Nothing changes for a caller that does not read the new fields.

**The signer certificate.** `downloadSigned` records may now carry `signerCertificate`:

```ts
const { signatures } = await esign.downloadSigned(envelopeId);
for (const s of signatures) {
  s.signerCertificate; // { serialNumber, issuer, notBefore, notAfter, sha256, subjectCommonName? } | undefined
}
```

- `leegality` and `digio` read it from the signed PDF's own signatures, so it is the certificate the ESP actually signed with. It is set only when each signature can be tied to one signer for certain (sequential: envelope order; parallel: the ESP's distinct signing times); otherwise it is absent, never guessed. `nsdl-esign` sets nothing until it can sign (#177).
- It names the certificate; it does not say it is trusted. To decide, run `verifyPadesSignatures` on the stored file (its `signer.serial`, `signer.issuer` and `signer.certSha256` equal `serialNumber`, `issuer` and `sha256`).
- `subjectCommonName` is usually the signer's name: keep it with your signing evidence (CONFIDENTIAL, like `signerIp`) and out of logs.
- For a certificate you hold yourself (an ESP response, a PEM file), `signerCertificateSummary(derOrPem)` from `@infrabyx/crypto` gives the same shape; `padesSignerCertificates(pdf)` lists the certificate of each signature in a PDF.

**The fake.** `new FakeEsign({ storage })` (from `@infrabyx/fakes` or `@infrabyx/testing`) reads your document from STORAGE (put it there first, with an IPB-01-27 key; a wrong SHA-256 is refused `hash_mismatch`), signs it with a real PAdES signature per signer, and on the first `downloadSigned` writes the signed PDF and each signer's PEM chain to STORAGE as REGULATED objects under the document's tenant (`certChainRef` is the chain's key). Verify its files with `verifyPadesSignatures(body, { trust: fake.trustStore() })`. Hooks: `signedObjects()`, `failNextDownload()`, `setSignerCertificate(ref, cert)` (a `pades-test` `TestSigner` signs; DER or PEM bytes are only named, to test a mismatch), `decline()`, `signDocument()`. `new FakeEsign()` without storage behaves as before; signing twice for the same signer is now a no-op.

**Multi-document envelopes.** Where an adapter supports them (today only the fake; the vendor adapters refuse `unsupported` until verified, so check `descriptor.capabilities.createMultiDocumentEnvelope`):

```ts
const { envelopeId } = await esign.createMultiDocumentEnvelope!(
  [
    { doc: loanAgreement, fields: [] },
    {
      doc: keyFactStatement,
      fields: [{ signerRef: "usr_b", page: 1, x: 40, y: 60, width: 160, height: 48 }],
    },
  ],
  signers,
  "sequential",
);
const { documents } = await esign.downloadSignedDocuments!(envelopeId); // after `completed`
```

One to ten documents, unique ids and storage keys. **All or nothing:** a signer is `signed` only after signing every document, the envelope completes only when every document is signed by every signer, a decline declines the whole envelope, and nothing downloads before completion (`not_completed`). `getStatus(...).documents` shows each document's progress; `downloadSigned` on several documents is refused `multi_document`.

## 7ed. Why a pack document needs a physical step, and the lender's instructions (PR-UDF-061 item 18; R1-D-252)

From the next `@infrabyx/contracts` minor (no migration, setting or environment variable), each document of an execution pack may carry two optional fields, in both carriers: `ExecutionPackManifest.documents[]` (the interim `DocumentShared` manifest) and `ExecutionPackIssuedData.documents[]` (the signed `ExecutionPackIssued` event).

| Field             | Values                                                                                                             |
| ----------------- | ------------------------------------------------------------------------------------------------------------------ |
| `physical_reason` | `REGISTRATION_REQUIRED` or `NOTARISATION_REQUIRED` (`PACK_PHYSICAL_REASONS`)                                       |
| `re_instructions` | The lender's words: plain text, 1 to 1,000 characters (`PACK_RE_INSTRUCTIONS_MAX`), no control characters, no link |

```ts
{
  document_id: "doc_mod_0001",
  kind: "MORTGAGE_DEED",
  execution_mode: "WET_INK", // required with a physical_reason
  physical_reason: "REGISTRATION_REQUIRED",
  re_instructions: "Bring the signed deed and two photo IDs to the Sub-Registrar office on a working day.",
  // … the document's other fields as before
}
```

**What is refused:**

- A `physical_reason` on a document whose `execution_mode` is not `WET_INK` (eSign, DSC or `NONE`), on `documents[i].physical_reason`.
- Any other `physical_reason` value.
- `re_instructions` that are empty, longer than 1,000 characters, carry a control character other than tab or a line break, or contain a link (a URL with a scheme, `www.`, `upi:` or a domain with a path): the same rule as `CoolingOffExitAnswered.payment_instruction` (R1-D-232).

**What to know:**

- Both fields are optional and independent: `re_instructions` may be sent without a `physical_reason`, on any execution mode. A pack valid before stays valid.
- Show `re_instructions` as the lender's words, escaped as text, never as HTML or Markdown; the schema refuses links but not every way of naming a place or a number.
- The mock lender (`@infrabyx/fakes`) sets neither field today.
- **Adopt** with all `@infrabyx/*` pins moved together.

## 7eg. Telling which application a `LoanDisbursed` is for (PR-UDF-061 finding (i); R1-D-256)

From the next `@infrabyx/contracts` minor (no migration, setting or environment variable), `LoanDisbursedData` takes an optional `lsp_application_ref`: the LSP's own application reference, as on `CoolingOffExitAnswered`.

```ts
{
  loan_id: "ln_0001", // still the envelope subject (R1-D-236)
  utr: "FAKE0123456789AB",
  // … amount, value date, beneficiary, kind, cooling-off end as before
  application_id: "app_0001", // the lender's id (optional, R1-D-232)
  lsp_application_ref: "lspapp_0001", // the LSP's own reference (optional, new)
}
```

**What to know:**

- Neither reference is required by the schema: `application_id` was optional, and requiring it (or one of the two) would refuse a payload valid before. A lender sends one or both; the lender contract cases in `@infrabyx/testing` require at least one, each naming the application.
- **An LSP** matches `lsp_application_ref` against its own application first, else `application_id` against the id the lender gave in `ApplicationStatusChanged`; with neither, it holds the disbursal for review rather than guessing from the amount.
- The mock lender (`@infrabyx/fakes`) sends both.
- **Adopt** with all `@infrabyx/*` pins moved together.

## 7eh. The inbox keeps the verified JWS beside the event (PR-UDF-073; R1-D-257)

From the next `@infrabyx/tenancy` minor (migration `tenancy/0026`; no setting, no environment variable). §7dp says to store a regulated message's `X-Infrabyx-JWS` beside the event; `EcosystemInbox` now does it for you, in the same row and transaction as the event.

```ts
const inbox = new EcosystemInbox({
  kernel,
  audit,
  schema: "lending",
  environment: "live",
  regulated: { keys: lenderKeys, replay: sharedReplayStore }, // RegulatedKeyRing, durable ReplayStore
});
const h = regulatedJwsFromHeaders(req.headers); // refuse !h.ok with signature-invalid (§7dp)
const r = await inbox.receive(ctx, body, { businessKey, jws: h.jws }); // then answer 2xx
// r.jws: the JWS stored with the event
await inbox.drain(ctx, async (tx, event) => keepProof(event.envelope, event.jws));
```

**What you get:**

- `receive(ctx, raw, { jws })` checks the value against the envelope's own limits (one compact detached JWS, at most 1,024 octets, as `X-Infrabyx-JWS`), verifies it with `verifyRegulatedMessage` and your `regulated` keys and replay store, and only then stores the event with it in the new nullable `jws` column. A JWS that fails is refused with IPB-API-018 (`meta.reason` `signature-invalid`, `meta.jws` the reason) and nothing is stored. Without `regulated`, a `jws` is refused rather than stored unverified.
- The handler (`drain`, `sweep`) and `list` get it as `event.jws`; `null` for an event received unsigned.
- A redelivery of a stored event is a `duplicate` whose `r.jws` is the JWS stored at the first receipt: its own fresh JWS must still verify; the very same JWS again (its `jti` already claimed) is a duplicate too, in the same tenant only.
- The column is written once: the database refuses any later change of it, even from null to a value, and any value over 1,024 octets or not in compact detached form.

**What to change:**

1. Run `infrabyx-migrate`: `tenancy/0026` adds the column to every inbox `tenancy.create_ecosystem_inbox` made, and new inboxes get it.
2. Pass the `X-Infrabyx-JWS` value to `receive` instead of calling `verifyRegulatedMessage` yourself first: a JWS you already verified with the same replay store has its `jti` claimed and is refused as `replay`.
3. Keep refusing an unsigned regulated message yourself (`isRegulatedMessage`, `regulatedJwsFromHeaders`); `receive` without `jws` stores the event with none, as before.
4. If you kept the JWS in a table of your own, you can read it from `event.jws` instead; rows received before 0026 have `null` (nothing is backfilled).

## 7ei. Pack evidence: e-stamp system, not-stampable codes, page and clause, the JWS profile (PR-UDF-075; R1-D-258)

From the next `@infrabyx/contracts` and `@infrabyx/crypto` minors (no migration, setting or environment variable). Every field is optional; a pack valid before stays valid.

| Where                                                  | New                                                                                                                         |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `PackStampEvidence` and the manifest's `StampEvidence` | `estamp_system`: `SHCIL`, `STATE_PORTAL`, `NESL_DDE` or `GRAS` (`ESTAMP_SYSTEMS`), only with an e-stamp                     |
| `ExecutionPackIssuedData.not_stampable[]`              | `reason_code`: `NOT_AN_INSTRUMENT`, `ACKNOWLEDGEMENT` or `OTHER` (`NOT_STAMPABLE_REASON_CODES`); `reason` is still required |
| Manifest item                                          | `not_stampable_reason_code`, the same codes, only with `not_stampable: true`                                                |
| `disbursement_clause` (both carriers)                  | `page` (1 to 2000) and `clause_ref` (`4.2`, `4.2(a)`, no `cl.`), beside the still-required `page_or_clause_ref`             |
| `verifyDocumentJws` with `reportProfile: true`         | the success names `profile: "v1" \| "v2"`; without the option the result is unchanged                                       |

**`page_or_clause_ref` forms** (read by `parsePageOrClauseRef`, case-insensitive): `p.3`, `p 3`, `pg.3`, `page 3`; `cl.4.2`, `cl 4.2(a)`, `clause 4.2`; or both in either order, separated by a space, `,`, `;` or `/` (`p.3 cl.4.2`, `cl.4.2, p.3`). Other text is still accepted and not read. When it is readable, a `page` or `clause_ref` beside it must name the same page or clause, else the pack is refused on `disbursement_clause.page` or `.clause_ref`.

**`certificate_document_id`** names the stamp certificate as a document the lender shared (`DocumentShared`, type `ESTAMP_CERTIFICATE` by convention) **for the same application**: check that its `application_id` is the pack's before you file it. It need not be listed in the pack's `documents`; when it is, it is not stamp-required and carries no stamp evidence. It is never the stamped document (refused).

**Verifying a v2 document JWS from a `DocumentShared` announcement:**

```ts
const data = DocumentSharedData.parse(event.data); // the announcement as it arrived
const r = verifyDocumentJws(data.jws, data, lenderKeys, new Date(event.time), {
  requireV2: true,
  reportProfile: true, // opt-in: the success names the profile
});
if (!r.ok) refuse(r.reason); // malformed, wrong_typ (a v1 JWS), unknown_key, signature_invalid
// r.profile === "v2": type, media_type, size_bytes and application_id are bound as announced
```

Pass the parsed data as it is (it carries the v2 fields; a v2 JWS without `media_type` or `size_bytes` on the event is `malformed`), and the event's `time` so a key rotated since still verifies a document announced while it was valid. Until your lender signs v2 everywhere, drop `requireV2`, keep `reportProfile` and log `r.profile` to see which documents are still v1. After the download, check the bytes' SHA-256 against `sha256` and their length against `size_bytes`.

**What to know:**

- Without `reportProfile` the result is exactly as before (`{ ok: true, kid }`, no `profile` key), so existing tests are unaffected; `DocumentJwsResult` values built by hand still type-check (`profile` is optional there).
- No `physical_marks` list: the pack is issued before execution, so a notary's seal or a registration endorsement does not yet exist; use item 18's `re_instructions` (§7ed) for where the lender wants it (owner question #187).
- The mock lender sends `estamp_system: "SHCIL"`, `reason_code: "NOT_AN_INSTRUMENT"` and `clause_ref: "4.2"`.
- **Adopt** with all `@infrabyx/*` pins moved together.

## 7ej. Executed documents, real files from `FakeDocgen`, and reading a PDF's PDF/A and PDF/UA claim (PR-UDF-077; R1-D-259)

From `@infrabyx/contracts`, `@infrabyx/fakes`, `@infrabyx/testing` and `@infrabyx/export` minors (no migration, setting or environment variable).

**Document type codes.** Spell the shared codes with their constants: `EXECUTED_DOCUMENT_TYPE` (the lender's document as the eSign Service Provider returned it, signatures included), `EXECUTION_EVIDENCE_SUMMARY_TYPE` (the human-readable record of how it was executed; it summarises the signed `ESignCompleted` and `EStampCompleted` events and never replaces them) and `PRIVACY_POLICY_LSP_TYPE` (an LSP's privacy policy; no `application_id`). `SHARED_DOCUMENT_TYPES` lists them with `EXECUTION_PACK_MANIFEST_TYPE`. `type` stays an open code.

**The link from an executed file to the lender's document is `ESignCompleted.signed_sha256`.** Share the executed file as a `DocumentShared` of type `EXECUTED_DOCUMENT` whose `sha256` is the `signed_sha256` of the `ESignCompleted` of the **last** signature (earlier signatures name intermediate files); that signed event's `document_id` is the lender's document. Optionally add `source_document: { document_id, version }` (the lender's document and its version, which `ESignCompleted` does not carry) for filing; an `EXECUTION_EVIDENCE_SUMMARY` names the document it covers the same way. A consumer verifies both signatures, then:

```ts
const problems = executedDocumentMismatches(shared, esign); // [] when they agree
// labels: "type", "sha256", "source_document", "application_id"
```

`source_document` is not signed by the document JWS: treat it as a pointer that must agree, never as proof.

**Real files from `FakeDocgen`.** Pass STORAGE and the renderers (fakes cannot depend on export, so you wire them):

```ts
import { FakeDocgen, FAKE_TEMPLATES, MemoryStorage } from "@infrabyx/testing";
import { toDocx, toPdf } from "@infrabyx/export";

const storage = new MemoryStorage();
const docgen = new FakeDocgen(FAKE_TEMPLATES, { storage, renderers: { pdf: toPdf, docx: toDocx } });
const r = await docgen.render({
  templateId: "kfs",
  data,
  format: "pdfa",
  outputPrefix: "tenant/tnt_a/docs",
});
// r.file.storageKey = tenant/tnt_a/docs/0<25 hex>.pdf; r.file.sha256 = SHA-256 of the stored bytes
```

`pdfa` is PDF/A-2b claiming PDF/UA-1, `pdf` plain PDF, `docx` needs the `docx` renderer, `html` writes the escaped page. The layout is a fake's: the template and version as title and heading, one paragraph per data field in key order (for `renderHtml`, the page's title and block text), with text outside printable ASCII and the rupee sign shown as `?`. The same request gives the same key and bytes. The prefix must be `tenant/<tenant>/<module>` (one module segment). Without the second argument the fake behaves as before. Your own DOCGEN adapter can run `docgenStorageContractCases(storage)` from `@infrabyx/testing`.

**Reading the claim.** `pdfIdentification(bytes)` from `@infrabyx/export` returns what the catalog's XMP metadata claims, for example `{ pdfa: { part: 2, conformance: "B" }, pdfua: { part: 1 } }`; `pdfUaClaimed(bytes)` is `true` when PDF/UA is claimed. It is a claim, not a validation: a file can claim what it does not meet, so gate a statutory acceptance on veraPDF (§7ea), not on this. It reads files up to 64 MiB by default (`maxBytes`; over it `too_large`), follows a catalog in an object stream and FlateDecode metadata, ignores page, image and font metadata, and answers `{}` for anything else, including a damaged file. Read the bytes from STORAGE after your AV and hash checks, as for any upload.

## 7ek. ESIGN: the signed file under the lender's key (PR-UDF-074; R1-D-260)

Minors of `contracts`, `connectors`, `fakes` and `testing`; no migration, setting or environment variable. Nothing changes for a download that names no key.

```ts
const out = await esign.downloadSigned(envelopeId, { keyRef: "lender:lnd_01…" });
(await storage.get(out.storageKey)).meta.keyRef; // "lender:lnd_01…"
// multi-document envelopes: esign.downloadSignedDocuments!(envelopeId, { keyRef })
```

- **What happens:** the adapter writes the ESP's signed PDF to `REGULATED` at `tenant/<tenant of the original>/esign/<ULID>.pdf` with `put(…, { bucketClass: "REGULATED", keyRef })`, so it is under that lender's key from its first byte (§7dl). `leegality`, `digio` and the fake support it; `nsdl-esign` still refuses `downloadSigned`.
- **Fail closed:** a malformed reference is refused `IPB-PORT-003` `key_ref_invalid` before the ESP is called. Any STORAGE refusal fails the download with that error and its `reason` (`key_ref_unknown`, `key_ref_prefix_conflict`, `key_ref_shared`, `key_ref_tenant_cmk`, or `IPB-KMS-001` `storage_key_unavailable` for a disabled or revoked key): nothing is written and nothing falls back to the class key. The envelope stays `completed`, so download again once the key is fixed. Check the key first with `storage.keyRefStatus?.(tenantId, keyRef, { bucketClass: "REGULATED", describeKey: true })` (§7ds) if you want to tell the user before the ESP is called.
- **Or the prefix map (no code change):** yes, a `tenantKeyRefPrefixes` entry `{ "tenant/<lender>/esign/": "lender:<lender>" }` (where your tenant is the lender) already puts every signed file of that tenant under the lender's key, today and without `keyRef`, and a download naming another reference is then refused `key_ref_prefix_conflict`. Use it when every signed file of the tenant belongs under one key. The ESIGN key has no lender segment, so when one tenant holds files for several lenders, name the key on each download instead (or as well: the same reference passes).
- **Not through QUARANTINE:** the signed file is the contracted ESP's answer over its authenticated API, so it goes straight to `REGULATED`, as KYC, bureau, AA and e-stamp files do; the scan of IPB-02-44 is for uploads. If your policy also scans it, run `FileScanPort.scan({ storageKey, sha256 })` on the stored key, or write it to `QUARANTINE` yourself and promote it with `promotedObjectMeta` (§7dt), which keeps the reference (owner question #189).
- **Testing:** `new FakeEsign({ storage })` over `new MemoryStorage(undefined, { keyRefs })` writes the PDF and the chains under the reference (`signedObjects()[i].keyRef`); an unknown reference fails as STORAGE does. The fake writes once, so a second download naming another reference (or none) is refused `key_ref_changed`. `esignFakeStorageCases(storage, { keyRef })` runs the cases.

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
