# STATUS — infrabyx-platform

Updated: 2026-10-28

| Item                  | Value                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Current phase         | **PL6 — infra and release** (2026-10-27): plan `docs/phases/PL6-plan.md` (PL6-D-01, OWNER-QUESTIONS #66 and #67); sessions 1, 2, 3a, 3b and 3c merged (#96, #97, #99, #100, #101); session 4a (`apps/reference` api and worker) in review; next 4b (the gate endpoints, the worker consumers, the `dev:up` bootstrap). 1.0.0 is published only on the owner's word (#67) |
| Spec of record        | `docs/ipb/` (IPB v1.0 + IPB-14 runbook), `docs/ecosystem/` (Spec v1.2)                                                                                                                                                                                                                                                                                                   |
| Packages              | Published to GitHub Packages (PL5 gate, release run 74, `dc51032`): ui, a11y, hlp, brand, cms, consent, feedback and trust 0.1.0 (new); contracts, config, testing and tenancy 0.5.0; connectors 0.4.0; notify and seed 0.3.0; ai and vidhi 0.2.0; crypto 0.4.1; export 0.2.1; audit 0.1.4; rules and workflow 0.1.2. Checksums in `docs/phases/PL5-gate.md` §6          |
| Last exit gate passed | PL5 gate (2026-10-27): report `docs/phases/PL5-gate.md`; PR #94 (report) and PR #79 (version), every required check green; release run 74. Before it: PL4 gate (`docs/phases/PL4-gate.md`)                                                                                                                                                                               |
| Working branch        | `claude/wonderful-franklin-goo59b` (recreate it from `main` after each squash merge and push normally; force-push is refused)                                                                                                                                                                                                                                            |

## Owner answers #53–#59 (2026-10-27, PL5-D-11)

- **#53 (licence exception):** the unmodified, dynamically loaded `@img/sharp-libvips-*` binaries are accepted by `licence:check` (that family and licence only; an SPDX `AND` now needs every part allowed). `NOTICE` names libvips.
  - The MEDIA port is defined (`contracts`); `@infrabyx/connectors/media` ships `SharpMedia` (reference) and `PassthroughMedia` (alternative), both on one contract suite in the port-contract matrix.
  - `cms.media.reencode_enabled` is on: `MediaLibrary` stores AVIF, WebP and a fallback per raster upload (`cms/0004`, `sources()` for `<picture>`), and `BrandStudio.uploadLogo` rasterises the PNG favicons.
- **#55:** the 30-day notice for a MAJOR Terms change counts from when users are notified (the notice published and sent; `cms.policy_notice`), not from approval.
- **#57 (new deletion rule):** a marketing lead's form consent ends 24 months after the last interaction, then the ledgered sweep applies, unless an active relationship or a legal hold (`consent/0002`, `ConsentSubjects`).
- **#54, #56, #58, #59:** defaults kept. The owner sets `trust.gating.nda_version` once legal approves the NDA.
- **New owner question #60** (how #53, #55 and #57 were read where they left a detail open; defaults in PL5-D-12; nothing blocked).
- **Products must, at the PL5 release:** run `infrabyx-migrate` (`cms/0004`, `consent/0002`); add `sharp` 0.35.5 and pass `SharpMedia` to `MediaLibrary` and `BrandStudio` if they re-encode (otherwise uploads stay as uploaded); publish each MAJOR Terms notice in Studio and report the NOTIFY send time (`recordNoticeSent`, or return `sentAt` from `notifyPolicyChange`); report lead interactions and relationships to `ConsentSubjects`.

## PL6 session 4a (2026-10-28, PL6-D-08)

- **`apps/reference/api`** (`@infrabyx/reference-api`, NestJS 11.2.7): the environment through `@infrabyx/config/env` (fixtures refused from staging up, every real adapter required otherwise); the services (kernel, ledger, outbox, settings, approvals, IDENTITY Keycloak or fixture, AUTHZ Cerbos or fixture, STORAGE MinIO/S3 or memory, QUEUE BullMQ or memory); sign-in with PKCE through the IDENTITY port and an HttpOnly session cookie; RFC 9457 problems; the three health probes; the `hello` module end to end (manifest, migration under forced RLS, service through `kernel.mutate`, R2 maker-checker retraction, owner-only delete on the locked verb, the registered setting, help keys, Cerbos policy, seed module); 20 integration tests including the five NN suites against `hello.greeting`.
- **`apps/reference/worker`**: the API's codebase at its worker entrypoint (the hello queue consumer, the same probes).
- **Images and Compose:** `infra/docker/node/Dockerfile` (both apps; hadolint and `trivy config` clean), `api` (53125) and `worker` (53126) in the `apps` profile on fixture adapters; `dev:up` applies the reference migrations and the hello seed; the `containers` job builds and hardens the two node images, the `compose` job signs in and reads the seeded greetings.
- **Platform packages:** `@infrabyx/config` registers `hello.greeting.max_length` (patch changeset). Nothing else changed. A workspace override takes axios 1.20.0 under `@openfga/sdk` (image scan), and two Node findings whose fixes are under the 7-day release age are waived until 2026-11-20.
- **New owner question:** #73 (nothing blocked).
- **Next:** session 4b: the gate endpoints (CMS content, the Vidhi `hello.summarise` L1 skill, the export, the trust mirror), the outbox relay and the Temporal worker, and the `dev:up` bootstrap of the Keycloak realm, the MinIO buckets and the Unleash project so the Compose api runs on the real adapters.

## PL6 session 3c (2026-10-27)

- **tflint 0.64.0** with the Terraform recommended preset and the AWS 0.49.0, AzureRM 0.32.0 and Google 0.40.0 rulesets, installed from pinned versions by `scripts/ci/infra-tools.sh` and run over every module and stack in the `infra` job (`infra/terraform/.tflint.hcl`). Four unused inputs are removed (GCP network, workload identity and secrets; Azure DNS), and the Azure storage accounts and key vaults get `CanNotDelete` locks like the PostgreSQL server (PL6-D-07).
- **Next:** session 4, `apps/reference` `api` and `worker`.

## PL6 session 3b (2026-10-27, PL6-D-06)

- **Azure and GCP:** the twelve modules and `platform` per cloud with the same inputs and the same contract outputs as AWS, each with `tests/contract.tftest.hcl` on a mock provider (`@IPB-01-AT-14`); the contract file check now covers the three clouds.
- **Differences products must know:** secret names are `secrets-<env>-…` (no slash on Key Vault or Secret Manager); on Azure, set `immutability_locked = true` in the apply after the storage accounts exist (`lock_mode` reads `unlocked` until then); Azure Redis is version 6.
- **New owner question:** #72 (nothing blocked).
- **Next:** session 3c, tflint with the three rulesets (Go 1.26 in the `infra` job), then session 4.

## PL6 session 3a (2026-10-27, PL6-D-05)

- **Contract:** `infra/terraform/contract/outputs.schema.json` (IPB-01 §01.4.9.3) and a file check that every cloud's `platform` declares exactly those outputs.
- **AWS:** the twelve modules of §01.4.9.1 and `platform` (region check, every module, the contract), with `tests/contract.tftest.hcl` on mock providers (`@IPB-01-AT-14`). Object Lock in compliance mode for the locked classes, replicated to ap-south-2; one rotated multi-region CMK; private PostgreSQL 18 and Redis 7 with TLS and IAM authentication; private EKS with IRSA; empty secret placeholders.
- **Example stack:** `infra/terraform/envs/example/preview`.
- **CI:** the `infra` job builds OpenTofu 1.13.1 from its checked tag and runs fmt, init and validate for every module, `tofu test` and `trivy config`.
- **New owner question:** #71 (retention defaults, lock files, secrets placeholders; nothing blocked).
- **Next:** session 3b, the Azure and GCP modules with the same contract.

## PL6 session 2 (2026-10-27, PL6-D-04)

- **Chart:** `infra/helm/infrabyx-app` (Helm 4): Deployment, Service (not for workers), ServiceAccount, HPA or KEDA `ScaledObject`, PDB, default-deny NetworkPolicy, `SecretProviderClass`, and the migration hook. The security context is locked; images by digest only; the values schema makes the IPB's required keys required.
- **Refusals:** a seed profile in prod, dr or pre-prod (`IPB-ENV-001`, `@IPB-01-AT-12`), a Supabase host and secret-named plain variables from staging up (`IPB-ENV-002`, `IPB-ENV-003`).
- **Admission policies:** `infra/policy/kyverno` (security context, digest images, probes, no host access; `verify-images` Audit until #67) with an offline `kyverno test`.
- **`@infrabyx/tenancy`:** `infrabyx-migrate --db-file` (minor), so the hook reads the URL from the secrets mount.
- **CI:** the `infra` job (render tests, kubeconform with pinned schemas, `trivy config`, `kyverno test`, `kyverno apply` over every render).
- **New owner question:** #70 (Helm 4, tool builds, the stricter chart rules; nothing blocked).
- **Next:** session 3, the OpenTofu modules for AWS, Azure and GCP.

## PL6 session 1b (2026-10-27, PL6-D-03)

- **Compose:** `infra/compose/docker-compose.yml` with the `core` (PostgreSQL 18 with pgvector, Redis, MinIO built from source, Mailpit, Keycloak, Temporal and its UI, Gotenberg, Unleash, Cerbos with the platform policies), `apps`, `search`, `ai` and `observability` profiles; every image pinned by digest, every port on 127.0.0.1.
- **`pnpm dev:up` / `pnpm dev:down`:** generated local secrets in `infra/compose/.env.local` (never committed), the stack up with health checks, then `infrabyx-migrate` and the `dev` seed.
- **CI:** the `compose` job runs `dev:up` with the apps, checks the seeded site and console through their images and tears down.
- **Fix found by the `compose` job:** `apps/public` answered 404 for `/legal/index.json` (IPB-05-09): the proxy sent it to the CMS lookup. It is now a site route, with a `@IPB-05-09` end-to-end test.
- **New owner question:** #69 (generated secrets instead of SOPS, the `dev` profile, what comes with `apps/reference`; nothing blocked).
- **Next:** session 2, the Helm chart `infra/helm/infrabyx-app` and the Kyverno policies.

## PL6 session 1a (2026-10-27, PL6-D-02)

- **Images:** `infra/docker/next/Dockerfile` builds `apps/public` and `apps/console` (`--build-arg APP=<folder>`): pinned Node base, `pnpm fetch` then a frozen install, `turbo build`, `pnpm deploy --prod`; the runtime runs as UID 10001 on a read-only root, code owned by root, with a `HEALTHCHECK`. `.dockerignore` keeps secrets, local state and build output out of the context.
- **Probes:** `/health/live`, `/health/ready`, `/health/startup` on both apps (database round trip, 503 when down).
- **CI:** the `containers` job (hadolint, `trivy config`, build, `trivy image` with dated waivers, `@IPB-01-AT-15`). It becomes a required check after two green runs on `main`.
- **New owner question:** #68 (one Dockerfile, root-owned code, tool pins, probes, unfixed findings fail; nothing blocked).

## PL5 release and PL6 plan (2026-10-27)

- **Released:** the gate PR #94 (`1e2fe19`) and the version PR #79 (`dc51032`) merged with every required check green; release run 74 re-ran the 20-port contract matrix and `consumer-smoke` and published 22 packages, one tag each. Registry checksums from `registry-dist` run 5 are in the gate report §6.
- **Products can now install** the website packages (`@infrabyx/ui`, `a11y`, `hlp`, `brand`, `cms`, `consent`, `feedback`, `trust` at 0.1.0) with the rest of the set at the §6 versions. **They must:** move every `@infrabyx/*` dependency together; run `infrabyx-migrate` (`brand/0001`, `cms/0001`–`0004`, `consent/0001`–`0002`, `feedback/0001`, `trust/0001`) and then `infrabyx-rls-lint`; take the new `web.*`, `cms.*`, `pol.*`, `a11y.*`, `fb.*` and `trust.*` settings defaults (402 keys); add `sharp` 0.35.5 and pass `SharpMedia` if they re-encode media; move links from `ntf.*` help keys to `hlp.notify.*`; mount the Studio screens behind their own IDENTITY and AUTHZ (never the fixture personas); copy `apps/public` as their site template. No new environment variables are required beyond the site and console examples (`apps/public/.env.example`, `apps/console/.env.example`).
- **PL6 plan:** `docs/phases/PL6-plan.md` (containers, Compose, the Helm chart and Kyverno policies, OpenTofu modules for three clouds, `apps/reference`, the scaffold and its CI proof, BOM and exit runbook). Defaults PL6-D-01 (#66); blocked items #67 (image signing, a hosted preview, pushing images, publishing 1.0.0). Platform requests PR-036 and PR-037.

## Handover (2026-10-27, end of the session that built PL5 sessions 7–9 and the gate)

- **Done:**
  - Owner answers #53–#59 recorded and applied (#89, PL5-D-11, PL5-D-12).
  - Session 7: the group site `apps/public`, its seed, the platform help registry, the `a11y` job (#90).
  - Session 8: `@infrabyx/ui/studio`, every Studio screen (#91, #92).
  - Session 9: the reference console `apps/console` and its gate in the `a11y` job (#93).
  - The gate: `docs/phases/PL5-gate.md`; the eight website packages made publishable; `at-report` covers the apps; the embed host allow-list (`@IPB-04-AT-94`).
- **Next:**
  1. Merge the gate PR when every required check is green (PL2-D-19).
  2. Merge the version PR (`changeset-release/main`) when green; `release.yml` publishes from `main`. Record the versions and checksums here and in the gate report §6, then say what products can install (gate report §5).
  3. PL6: write `docs/phases/PL6-plan.md` from IPB-14 §14.3 and stop for the owner's review of the plan batch as the working mode allows.
- **Owner tasks:** apply `infra/policy/github/rulesets.json` (`a11y` required, #49); answer #60–#65 (defaults in use, nothing blocked); set `trust.gating.nda_version` when legal approves the NDA; counsel replaces the `[COUNSEL]` clauses before any policy leaves placeholder status.
- **Open questions:** #60–#65, all with defaults taken; nothing blocked. Lighthouse (#51) is re-checked at each session.
- **Branch and PR state:** `claude/wonderful-franklin-goo59b` carries the gate PR. Recreate it from `main` after each squash merge.
- **Local tooling:** Node 24.22.1 unpacked in the session scratchpad; PostgreSQL 16 with an older pgvector (the `ai` retrieval tests pass only in CI); the seeded `ipb_site` database serves both apps locally (ports 3123 and 3124); gitleaks is not installed locally (CI runs it). The container's PostgreSQL stops on restarts; `service postgresql start` brings it back.

HANDOVER READY

## PL5 session 9 (2026-10-27, PL5-D-16)

- **`apps/console`** (`@infrabyx/console`, private): every Studio screen under `/studio/<section>` and `/studio/<section>/<id>`, behind the AUTHZ port (`studio_section`, `open`). Forms post to same-origin routes that run the `ui/studio` handlers and redirect back with the result.
  - Reference only: fixture personas and the `FixtureStudioAuthz` role table, in local, dev, test and preview; elsewhere nothing opens until a product wires IDENTITY and AUTHZ.
  - `conform.ts` checks that the package services fit the screens' types.
- **`a11y` job:** also starts the console and runs its gate (every Studio route as the persona that opens it, light and dark; no-JavaScript; the sign-in, 403 and 404 gate; CSP and `noindex`; a maker-checker publish through the forms).
- **`ui/studio`:** screens take `sections` (the menu shows only what the person may open).
- **New owner question:** #64 (the reference console's sign-in, role table and form posts; nothing blocked).

## PL5 session 8b (2026-10-27, PL5-D-15)

- **Screens:** Policies (set, parameters, versions, lint, DPO and checker approvals, the MAJOR-change notice), Consent texts, Feedback (read-only, triage in OH), Trust documents (read-only mirror), Pricing (read-only catalogue plus the pricing copy), Resources (content screens plus file versions and withdrawal) and Forms (content screens). Approvals also lists submitted policies and consent drafts.
- **New service readers:** `PolicyStudio.setFor`, `instances`; `ConsentTexts.list` (DPO or legal reviewer); `FeedbackService.queue` (super admin or Accessibility Lead).
- **Help:** 14 more `hlp.studio.*` entries.
- **New owner question:** #63 (feedback read-only, the role-gated lists, read-only prices; nothing blocked).
- **Next:** session 9, `apps/console`: mount every screen behind the AUTHZ fixture adapter, the type check that the real services fit the screens, and the a11y gate over every Studio route.

## PL5 session 8a (2026-10-27, PL5-D-14)

- **`@infrabyx/ui/studio`** (new sub-export): the Studio frame (section list, notices, error summary) and the screens for Approvals, Brand, Pages and sections, Menus, Footer and contact, Redirects, Media, Claims Register and Preview links.
  - Screens take the package's Studio service, the request context and form actions; handlers turn a posted form into one service call and a notice. Every screen works without JavaScript (post-redirect-get).
  - The content editor shows only the moves the state machine allows; the services still check roles and maker-checker.
  - Bodies, SEO fields and brand packs are edited as JSON, checked by the service on save (#62).
- **New service readers:** `BrandStudio.packs`, `revisions`, `pending`; `CmsStudio.redirects`, `claims`; `MediaLibrary.list` (with the alt-text queue).
- **`ui` primitives:** `SelectField`, date and date-time inputs, table cells with links and buttons.
- **Help:** `hlp.studio.*` entries (internal) in the platform registry.
- **New owner question:** #62 (JSON editing and the read lists' gate; nothing blocked).
- **Next:** session 8b (Pricing, Policies, Resources, Forms, Consent texts, Feedback, Trust documents), then session 9 (`apps/console`, with the a11y gate over every Studio route).

## PL5 session 7 (2026-10-27, PL5-D-13)

- **`apps/public`** (`@infrabyx/public-site`, private): the group site on Next.js 16.4.2 and React 19.3.1, built with webpack.
  - `proxy.ts`: a per-request nonce CSP and the security headers; CMS redirects, and 404 or 410 pages that work without JavaScript.
  - The §9.2 routes: Home, About, Group companies, Careers, Trust, Contact, the policies (`/legal`, versions, `index.json`), Accessibility, Grievances, Glossary, Feedback, Security, Cookie settings, Sitemap with search, and the `/__gallery` of `ui` components.
  - Generated files: `sitemap.xml`, `robots.txt`, `llms.txt`, `security.txt` and the web manifest.
  - Consent, form and feedback endpoints with origin checks, each through its package's service.
  - Fixture adapters only in local, dev, test and preview; elsewhere the site refuses them.
- **Seed:** `apps/public/src/seed/public-site.ts` (profiles dev, demo, test), with reserved example values. It seeds through the Studio maker-checker flows:
  - the GRP brand pack, the policy set with `[COUNSEL]` skeletons and the officers;
  - the pages, menus, footer, offices and group companies;
  - the consent texts and their approval;
  - the trust mirror.
- **Help registry:** `@infrabyx/hlp` ships `registry/*.yaml`, with an entry for every help key in use. `hlp-lint` runs in `verify` over the packages and the site. notify's help keys are now `hlp.notify.*`.
- **Gate:** the journey registry `apps/public/journeys/GRP.yaml`, with an NVDA script per journey (`at-scripts/grp/`); `journeys-lint` runs in `verify`. The new `a11y` job:
  - migrates and seeds PostgreSQL 18;
  - runs `validate-footer` over every published pack, `journeys-lint` against the served routes, and `overlay-scan`;
  - starts the site and runs the e2e suite in Chromium: axe and HTML_CodeSniffer in light and dark themes, reflow, 200 % text, skip link, no third-party requests on any consent path, no-JavaScript content and the CSP headers.
- **Required check:** `a11y` is in `infra/policy/github/rulesets.json`. **Owner task:** apply the ruleset once this PR is merged (#49).
- **Package fixes found by the gate:** `ui` hides `[hidden]` elements. `consent`: the banner controller, the cookie-table region and fieldset reflow. `cms`: `PublicPolicies.officers`. `config`: defaults for absent optional variables. `seed`: `SeedModuleContext.services`.
- **Still blocked:** Lighthouse (#51) still fails the trust policy, through `chromium-bidi` under `puppeteer-core`.
- **New owner question:** #61 (session-7 defaults, PL5-D-13; nothing blocked).

## Handover (2026-10-27, end of the session that built PL5 sessions 4–6)

- **Done:**
  - Owner answers #41–#52 recorded and applied (#83, PL5-D-05).
  - Session 4, `cms` core (#84).
  - Session 5a, policies (#85); 5b, resources, forms and pricing (#86); 5c, `consent` (#87).
  - Session 6, `feedback` and `trust`, is in PR #88.
- **Next:**
  1. Merge #88 when every required check is green (PL2-D-19).
  2. Session 7 (plan §9.1–§9.5, §11):
     - `apps/public` on Next 16 with the nonce CSP, the §9.2 routes and the consent, feedback and trust wiring;
     - `publicSiteSeedModule`: policy placeholders through `PolicyStudio.seedPlaceholder`, consent texts through `ConsentTexts.seedDefaults` plus their approval, and the trust fixture mirror;
     - the platform help registry, including the `hlp.feedback.*` keys, and renaming notify's `ntf.*` help keys;
     - `hlp-lint` and `journeys-lint` in `verify`;
     - the `a11y` CI job, and `a11y` added to the required checks in `infra/policy/github/rulesets.json` (the owner applies the ruleset, #49);
     - re-check whether Lighthouse resolves under the trust policy (#51).
  3. Sessions 8 and 9: the Studio screens (`@infrabyx/ui/studio`) and the reference `apps/console` (#41). Session 10: the gate.
- **Open questions:** #53–#59, all with defaults taken; nothing blocked.
- **Branch and PR state:** `claude/cool-bohr-klglyy` carries #88. Recreate it from `main` after the squash merge.
- **Local tooling:** Node 24.22.1 is unpacked in the session scratchpad (put it first on `PATH`). PostgreSQL 16 at `IPB_TEST_PG_URL` has an older pgvector without `hnsw.iterative_scan`, so the `ai` retrieval integration tests only pass in CI. gitleaks is not installed locally; the CI secret scan runs it.

HANDOVER READY

## PL5 session 6 (2026-10-27, PL5-D-10)

- `@infrabyx/feedback`, migration `feedback/0001_init.sql`:
  - the widget: footer trigger, floating button, dialog with its controller, the no-JavaScript `/feedback` form, the accessibility report form and the status view (`@IPB-04-AT-90`);
  - payload minimisation with `IPB-FB-001`, route patterns, OS and browser families and the PII scan of the text (`@IPB-04-AT-91`); honeypot and rate limits with `IPB-FB-002`; the NPS rules;
  - the hand-off to SUPPORT or BACKLOG, the status loop from OH events or polls, and the status link (`@IPB-04-AT-92`);
  - the accessibility SLA timers with `AccessibilityIssueSlaBreached` once per missed timer (`@IPB-06-AT-20`), and the purge 3 years after closure (#48).
- `@infrabyx/trust`, migration `trust/0001_init.sql`:
  - the read-only mirror: only the mirror consumer can write it (`@IPB-08-AT-01`); ANNOUNCED → FETCHED → VERIFIED → VISIBLE, SUPERSEDED and HIDDEN; digest mismatch `IPB-TRUST-009`; replay rebuilds the same mirror; daily reconciliation and the "as of" label (`@IPB-08-AT-14`, digest scenario);
  - the tenant room: list, NDA acceptance (`@IPB-08-AT-06`), acknowledgements and public downloads with the delivered digest, tenant isolation (`@IPB-08-AT-10`), requests with the SLA and OH ticket (`@IPB-08-AT-09`), and subscriptions. Gated downloads answer `IPB-TRUST-012` (#44);
  - the Trust Centre data (`@IPB-08-AT-04`, `-17`) and `security.txt` (RFC 9116);
  - the sweep: request SLA breaches (`IPB-TRUST-014`), hand-off retries, and the acknowledgement purge 10 years after the version ended, with legal holds (#48).
- `contracts`: service readers `SVC_FEEDBACK_SLA` and `SVC_TRUST_SWEEP`, id prefixes `fbs_` and `vads_`, six payload schemas. `config`: `trust.request.ack_hours` and `trust.request.fulfil_days` (IPB-08 §08.5). `tenancy`: `infrabyx-migrate` applies `feedback` then `trust` after `consent`.
- New owner questions #58 (feedback defaults) and #59 (trust defaults).
- For session 7: register the `hlp.feedback.*` help keys in the platform help registry; serve `FEEDBACK_CONTROLLER_JS` under the nonce CSP.
- Locally the `ai` retrieval integration tests need pgvector 0.8 (`hnsw.iterative_scan`); CI's pgvector image has it. Every other integration suite passes locally.

## PL5 session 5c (2026-10-27, PL5-D-09)

- `@infrabyx/consent`, migration `consent/0001_init.sql`:
  - consent texts (IPB-05 template 18 and the region banners as drafts; DPO maker, legal reviewer checker);
  - the append-only consent ledger (`pg_local`) with the exact text shown, and the OH HTTP adapter (unproven);
  - the CMP: equal Accept all, Reject all and Manage, Escape as Reject, GPC, region wording, re-prompt, no marketing on app routes, the preference centre, the first-party controller and the consent endpoint (`@IPB-04-AT-80`…`-82`, `-84`, `-85`);
  - inert script gating with the locked sensitive routes and `IPB-WEB-005` (`@IPB-04-AT-83`, `-86`), and the `none` tag manager and analytics adapters;
  - the acceptance ledger with `IPB-POL-010`, and the consent purge (life of consent + 3 years, #48).
- `contracts`: service reader `SVC_CONSENT_SWEEP`. `tenancy`: `infrabyx-migrate` applies `consent` after `cms`.
- New owner question #57 (end of life for form consents).

## PL5 session 5b (2026-10-27, PL5-D-08)

- `@infrabyx/cms`, migration `cms/0003_resources_forms.sql`:
  - resources: versions at `?v=`, cite-as, withdrawal, gated downloads by presigned URL (300 s, IPB-02-15; PR-035), download records with the CRM lead reference, and `ResourceReviewDue` (`@IPB-04-AT-60`, `-61`, `-13`);
  - forms: field checks, honeypot and rate limit, consent before the hand-off to CRM, HR or SUPPORT, and no field values stored, on success or failure (`@IPB-04-AT-47`);
  - pricing: catalogue-only prices with a 5-minute cache and a 24-hour stale limit, GST labels and the total payable, and the drip-pricing and false-urgency lint (`@IPB-04-AT-30`, `-31`, `-32`).
- `contracts`: id prefixes `rsv_` and `rdl_`.

## PL5 session 5a (2026-10-27, PL5-D-07)

- `@infrabyx/cms` policies, migration `cms/0002_policies.sql`:
  - the 17 IPB-05 template skeletons (clause headings, parameters, `[COUNSEL]` markers);
  - policy sets with maker-checker parameters, and policy instances with versions, the lint (`IPB-POL-001`…`-005`, `-007`), the DPO co-approval (`-006`), immutable approved versions (`-008`) and the completeness hook for Brand Studio (`-009`);
  - effective dates with supersede and re-consent, the review cadence and `PolicyReviewDue`, the public archive and `/legal/index.json`, and seeded placeholders.
- Tests: `@IPB-05-AT-01`, `-03`…`-09`. New owner question #55.

## PL5 session 4 (2026-10-27, PL5-D-06)

- `@infrabyx/cms` core, migration `cms/0001_init.sql`:
  - content items, immutable revisions and the named state machine with maker-checker and legal review (`@IPB-04-AT-01`, `-02`, `-03`, `-101`);
  - the Claims Register and the publish lint (`@IPB-04-AT-06`), the sanitiser (`@IPB-04-AT-20`) and the media library with alt text, photo consent and EXIF stripping (`@IPB-04-AT-09`);
  - slugs and redirects (`@IPB-04-AT-08`), templates and menus (`@IPB-04-AT-10`), locale fallback (`@IPB-04-AT-11`) and the stale queue (`@IPB-04-AT-13`);
  - preview links (`@IPB-04-AT-05`), the scheduler and IndexNow logging (`@IPB-04-AT-04`), and the read-only public API (`@IPB-04-AT-14`, `-93`);
  - SEO and JSON-LD (`@IPB-04-AT-07`), the generated files, the footer validator with `infrabyx-cms validate-footer` (`@IPB-04-AT-73`) and `brandFooterHook`;
  - the 90-day purge of soft-deleted content (#48).
- `contracts`: the `gls_` prefix and the cms event payloads. `brand`: the footer hook receives the pack id. `tenancy`: `infrabyx-migrate` applies `cms` after `brand`.
- New owner question #54 (session-4 defaults); platform request PR-034 (legal review returns to `in_review`).

## Owner answers #41–#52 (2026-10-27, PL5-D-05)

- **#41:** the Studio screens are built in the platform (`@infrabyx/ui/studio`) with a reference `apps/console`; products and OH mount them. PL5 grows by two sessions.
- **#42, #45, #46, #47, #50:** defaults kept.
- **#43:** `sharp` fails the licence check (its libvips binaries are LGPL-3.0-or-later), so uploads stay as uploaded; #53 asks about a licence exception.
- **#48:** approved ledgered purge sweeps: consent records at consent end + 3 years, trust acknowledgements after 10 years, feedback items 3 years after closure, soft-deleted CMS content after 90 days. Each ships with its package.
- **#49:** the `a11y` required check enters `rulesets.json` with the `a11y` job (session 7); the owner applies the ruleset after that merge. No HSTS preload until 3 months after the group domain is live; IndexNow off until then.
- **#51:** Lighthouse still does not resolve under the trust policy (`chromium-bidi` trust downgrade); fixtures meanwhile.
- **#52:** the contrast guard checks colours by role; all six product accents pass as fills; PR-033 carries the proposed IPB-07-32 wording.

## Pre-go-live items (before the first regulated tenant, Finbyx or Udofin, goes live; #44)

| Item                                         | What is built                                                                                | Flag                      |
| -------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------- |
| Watermarked gated vendor-assurance downloads | A DOCGEN watermark adapter; until then gated downloads answer `IPB-TRUST-012`                | —                         |
| Evidence packs                               | Packs signed ES256 through KMS with the C-22 detached-JWS pattern (no new cryptography item) | `flg_trust_pack_signing`  |
| Auditor grants                               | A separate grantee identity realm for auditors                                               | `flg_trust_questionnaire` |

## Handover (2026-10-27, end of the session that built PL5 sessions 1–3)

- **Done:**
  - PL4 released (release run 56; checksums in `docs/phases/PL4-gate.md` §6), and owner answers #34–#40 applied (#78).
  - The PL5 plan and session 1 (#80), and session 2 (`ui`, `a11y`; #81).
  - Session 3 (`hlp`, `brand`) is in PR #82.
- **Next:**
  1. Merge #82 when green (PL2-D-19).
  2. Session 4, `cms` core (plan §5.3–§5.6): content and revisions with the state machine and approvals; the Claims Register and lint; the sanitiser (`parse5`); slugs and redirects; SEO and generated files; preview; the scheduler (`svc_cms_scheduler`); the public API; the footer validator, wired into `BrandStudio` through `validateFooter`.
  3. Session 5: the rest of `cms`, then `consent`. Session 6: `feedback` and `trust`. Session 7: `apps/public`, the platform help registry, renaming notify's `ntf.*` help keys, `hlp-lint` and `journeys-lint` in `verify`, and the `a11y` CI job. Session 8: the gate.
- **Open questions:** #41–#52, all with defaults taken; nothing blocked. #51 parks only the live Lighthouse step; #52 is the strict brand-contrast reading.
- **Branch and PR state:** `claude/vibrant-babbage-udtz4j` carries #82. Recreate it from `main` after the squash merge.
- **Local tooling:** Node 24.22.1 in the session scratchpad; PostgreSQL 16 with pgvector 0.6 at `IPB_TEST_PG_URL`, where `iterative_scan` is unsupported so the retrieval int tests need CI; Chromium at `/opt/pw-browsers/chromium-1243/chrome-linux64/chrome`; gitleaks 8.30.1 in the scratchpad.

HANDOVER READY

## PL5 session 3 (2026-10-27, PL5-D-04)

- `@infrabyx/hlp`: the glossary entry schema and registry loader, popover content per locale (falling back to Hindi, then English), the public glossary (`@IPB-07-AT-17`), `infrabyx-hlp lint` (`@IPB-07-AT-02`, `@IPB-07-AT-15`) and tours (`@IPB-07-AT-19`).
- `@infrabyx/brand`, with migration `brand/0001_init.sql`:
  - Brand Studio with maker-checker publish, legal review and rollback (`@IPB-04-AT-26`, `-AT-28`);
  - the contrast guard (`@IPB-04-AT-23`, `@IPB-06-AT-11`, `@IPB-07-AT-24`), the SVG sanitiser (`@IPB-04-AT-21`), the favicon set (`@IPB-04-AT-22`), host resolution (`@IPB-04-AT-27`) and terminology (`@IPB-04-AT-25`).
- `contracts`: `ContrastGuardFailedData`. `tenancy`: `infrabyx-migrate` applies `brand` after `vidhi`.
- Carried to session 7: the platform help registry, renaming notify's `ntf.*` help keys, and `hlp-lint` in `verify`.

## PL5 session 2 (2026-10-27, PL5-D-03)

- `@infrabyx/ui`: tokens for seven product identities in four themes, with every declared pair checked against its WCAG floor (`@IPB-06-AT-10`); en-IN and hi-IN formatters and catalogues; the server-rendered shell, footer, form, help, status, data and media components; built CSS with no inline styles.
- `@infrabyx/a11y`:
  - the journey lint (`@IPB-06-AT-07`), `mapping.json` (55 criteria), `checklist.md` (40 items) and the AT script template;
  - the statement generator (`@IPB-06-AT-19`) and the shortcut registry (`@IPB-06-AT-14`);
  - the overlay scan (`@IPB-06-AT-12`) and the Lighthouse evaluator (`@IPB-06-AT-02`);
  - Playwright helpers that run axe and HTML_CodeSniffer under the production CSP (`@IPB-06-AT-01`);
  - the `infrabyx-a11y` CLI.
- `docs/phases/PL5-spike.md`: the browser, CSP and engine findings. Lighthouse is parked behind the trust policy (#51); nothing else is blocked.
- Both packages stay private until the PL5 gate. Products cannot install anything new yet.

## PL5 session 1 (2026-10-27, PL5-D-02)

- `@infrabyx/contracts`: the website ports (CONSENT, CRM, HR, SUPPORT, BACKLOG, TRUST, BILLING catalogue, TAG_MANAGER, ANALYTICS, EGRESS, CLAIMS, LAW_REGISTER), the PL5 error areas, id prefixes, event names and Ecosystem v1.2 payload schemas.
- `@infrabyx/config`: 165 website keys (400 in the registry) with the owner's launch defaults.
- `@infrabyx/testing`: fakes and fixtures for every new port (no real prices, no certification claimed).

## PL5 plan (2026-10-27, PL5-D-01)

- `docs/phases/PL5-plan.md`: first releases of `ui`, `a11y`, `hlp`, `brand`, `cms`, `consent`, `feedback` and `trust`, and the reference group site `apps/public` (Home, About, Group companies, Careers, Trust, Contact, Policies; blog and Investors off), in eight sessions.
- Owner decisions built in: equal Accept, Reject and Manage; nothing from another origin before consent; no tag manager; analytics later through self-hosted PostHog; WCAG 2.2 AA with axe in CI; the footer's entity, CIN, registered office and officers from configuration; no customer names, testimonials or claims in seed content.
- New owner questions #41–#50 (defaults in use; nothing blocked). Platform requests PR-025 to PR-032.

## What products can install (PL4 gate, 2026-10-27)

| Package                | Version   | Tag                          | shasum (SHA-1, registry)                   | integrity (SHA-512, registry)                                                                     |
| ---------------------- | --------- | ---------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `@infrabyx/ai`         | 0.1.0 new | `@infrabyx/ai@0.1.0`         | `ded684f27b5945bcb49e30817e63e8a5dd0d3fd9` | `sha512-Ezzew+kKvAJbY5mJfydLoLO7BzPtZ5wgiTKvq43qLFDdW2A8Vm7whAx3d3XxyVTAYGs8rZ3ct2Yy7IRuJQh3gA==` |
| `@infrabyx/audit`      | 0.1.3     | `@infrabyx/audit@0.1.3`      | `a4ba9ad2b35503b8b4b9d083acd04f3bc6c15dd3` | `sha512-zTgbO6C3w+XfVSKvDlr4LMCoB65kCUQ6O+Z1xxn8b6lIcwmU07NFV4LxoFUW24cx6ks42nhFVjS/TZy8IOtxCg==` |
| `@infrabyx/config`     | 0.4.0     | `@infrabyx/config@0.4.0`     | `afd61fbc2db470ebd3ae23a11c50144007c289d6` | `sha512-noL5XxD5f5dIDkR0qZmf64POTR+8PRPlFARjOOkT7pCFYN+EY0t9vmu4w/biQyATSPz9ZI/ZhmmiGad8nOyj2A==` |
| `@infrabyx/connectors` | 0.3.0     | `@infrabyx/connectors@0.3.0` | `20e80230cb06d6d103637d06b38383128e4ea923` | `sha512-GWZVlxLfDyWTBB1ybmrKWKmyLRAWJd/0+yjRGau2AudTlPhoLyhUeY48ftx6y5kmeE2czRT37R5cb3Z4LIS/CQ==` |
| `@infrabyx/contracts`  | 0.4.0     | `@infrabyx/contracts@0.4.0`  | `81b67306eee66eb656f4834229e34c89cbbb71d7` | `sha512-KHvla+kdbEQGId/4aFnr04Mac4z01Pwu2fcxLa2ejnDbuobNBHzy9wC8+tqr64XR1IlPWb9erNLQhg7Zaaj9kw==` |
| `@infrabyx/crypto`     | 0.4.0     | `@infrabyx/crypto@0.4.0`     | `a489acc131351119c0d7867401df4202a55d1f9e` | `sha512-/X5xrhIhSFWs4cMYephVmEbQzwb91Z0C+meN+aNnTljFX4C9KbaXjvoZuF+Zxbgg3mxNL+gv8+UdYSmBAlh0bg==` |
| `@infrabyx/export`     | 0.2.0     | `@infrabyx/export@0.2.0`     | `0196ba2edd7546edd8f7fb85f3889be7e4761002` | `sha512-YFiFs8hOeSY+QNdj0bwd3NuFSf+F5sAiB6hUKZSENFAghzaUwpVBbIjRkngSYe6ylwdo8bJUIt2iFziqz4bo0A==` |
| `@infrabyx/notify`     | 0.2.0     | `@infrabyx/notify@0.2.0`     | `a75f2516a438b2167530b7e7c9efea1fadf9ab1e` | `sha512-WrmeU9WhRnrriRkPqkV/ngRJ1l7JqJna/hJUhzs3xNaMNACTKBtAuZHOibpHV+wlfTftxFR2S2P0Dby4akMWiA==` |
| `@infrabyx/rules`      | 0.1.1     | `@infrabyx/rules@0.1.1`      | `9a70c9801ea1e6ee11016a2af41ec790ac316f91` | `sha512-iKaHiHX5qsKUL2aqgovdvNUqUjyH2Bo3CsGiVzz2bOQhowpEH6c6JdoHr1icyjVvLmuI9BG4IGJ3i/3hZ51LVA==` |
| `@infrabyx/seed`       | 0.2.2     | `@infrabyx/seed@0.2.2`       | `5b83060b98cb072f5fd1e8a0faac1642080e318a` | `sha512-P3UkJap/ABu4EDBiRjP1Z9/diehHTAPUk8p/dmcQ6grAahKwBy+eNdVz/TUnyXKIECwwNRST8Dw5o7JcbC9akA==` |
| `@infrabyx/tenancy`    | 0.4.0     | `@infrabyx/tenancy@0.4.0`    | `f268cc043d2b8c11a795155efc6841e4deae978b` | `sha512-GRJdp84FHQHpkb40lE5pa42NBzs36wRVnVC8ajpH+zTGB6ODPfUjbdqXfYFsoThr9nqFcVmqgCW2M7BzdciR9w==` |
| `@infrabyx/testing`    | 0.4.0     | `@infrabyx/testing@0.4.0`    | `c312ec3635d24e0b07cbcb591a6f722319d06bcb` | `sha512-YX+d1i+7ZV4imPnfFNxGoubeUupknL8uPDmVZcVHPdoPQoSUoYAEUq/CgG4vdZZrEOBtnS9LeGCJUyjZindlMg==` |
| `@infrabyx/vidhi`      | 0.1.0 new | `@infrabyx/vidhi@0.1.0`      | `661a222e6cb2760ff1119b0de43253ceb4c092be` | `sha512-GFIQycyjD4nq69qlXpu3HCvTe0LOWDruUl4JhgX84K4+YehlTBVqDeUu3WzyYW8RXOeBNqMJ+JHDpRR0iINx/w==` |
| `@infrabyx/workflow`   | 0.1.1     | `@infrabyx/workflow@0.1.1`   | `3fef852df2d9d1d839f5b26e9cc13744ab962d8e` | `sha512-u7RyvN8cD++uih9tZMaOr80xSlyp6CnVcCSf9rsgiNI5CrWtiAzoPYfQjXio/s+mNPqyBAhPqUu3SBLi982Q0A==` |

Registry values from `scripts/registry-dist.mjs` (the script the `release` job writes to its job summary), run read-only in `registry-dist` run 4 against GitHub Packages after release run 56.

**To adopt this release**, products follow `docs/phases/PL4-gate.md` §5. In short:

- **Versions:** move every `@infrabyx/*` package together; add `ai` and `vidhi` if the product uses AI.
- **Database:** PostgreSQL 18 with pgvector 0.8.1 available (`ai/0003` creates the `vector` extension).
- **Migrations:** `infrabyx-migrate` applies `ai/0001`–`0004` and `vidhi/0001`–`0004` after `export`, with the `svc_ai_run_sweep` and `svc_vidhi_sched` readers; run `infrabyx-rls-lint` afterwards.
- **Settings:** 232 keys, including every `ai.*` and `vidhi.*` key; kill switches need an R2 checker to turn off; `ai.obs.capture_content` is locked off.
- **Secrets:** Bedrock through the role's identity; the Vertex service-account key (C-24) or workload identity; vLLM and FLUX tokens once a host exists.
- **Code:** build the gateway, registries and kill switches; run `infrabyx-ai prompts sync` after each release; schedule `RunRetention.sweep`; ship skill manifests; wire `Autonomy`, `TaskRuntime`, `Scheduler.tick`, `Missions.advance`, `McpServer`, `Notebooks`, `QaSampler`, `Digest` and `disclose()`; call `ImageService.assertPublishable` before publishing an image; add `ai_runs` and `vidhi_actions` to the product export map.

## Owner answers #34–#40 (2026-10-27, PL4-D-13; ships in the next release)

- **#34:** `RetrievalService.deleteResource` deletes a deleted resource's chunks in every index version, ledgered (DPDP erasure); `RetrievalRetention.sweep()` deletes retired versions 30 days after retirement, ledgered; PostgreSQL refuses any other delete (migration `ai/0005`, reader `SVC_AI_INDEX_SWEEP`).
- **#35:** `prompts sync` accepts the scripted CI eval result in staging; pre-prod, prod and DR still need a live, owner-approved paid run.
- **#36, #38, #39:** defaults kept.
- **#37:** every skill tool must declare `locked: true` or `false` (`IPB-VID-001` otherwise); new `infrabyx-vidhi manifest-lint`; word matching stays the safety net.
- **#40:** `vidhi.qa.min_reviews` (20), `vidhi.qa.precision_floor` and `vidhi.qa.recall_floor` (0.8) are governed, tighten-only TENANT settings (235 keys).
- **Products must, at the next release:** run `infrabyx-migrate` (`ai/0005`); call `deleteResource` whenever they delete an indexed resource; schedule `RetrievalRetention.sweep()` daily; add `locked` to every tool in their manifests and run `infrabyx-vidhi manifest-lint` in CI; drop any `floor` option passed to `QaSampler`.

## What products could install before (PL3 gate, 2026-10-27)

| Package                | Version   | Tag                          | shasum (SHA-1, registry)                   | integrity (SHA-512, registry)                                                                     |
| ---------------------- | --------- | ---------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `@infrabyx/audit`      | 0.1.2     | `@infrabyx/audit@0.1.2`      | `364123b412b85522cad9d9b3211675c5ca00260b` | `sha512-/VMuOREnBZ78kZBI0YuN8emafhY0W6XjrGYSUmPzWM/0xkF5aNZ/pbXB9BiR+0YVG4dnWWwgmbPM4Htaw4/O9Q==` |
| `@infrabyx/config`     | 0.3.0     | `@infrabyx/config@0.3.0`     | `450b7bd8a3c1fd7e3bfcbe53c0fdfc2ebd2393ef` | `sha512-7Y6tYhslhz1SFg3Sc6MP8/4XrKyPHWGvjSc34Q2PZ6r+VBc8wZu8OF4TO2B/oHDXOvHZN2dFTT+7E7zG5NcW/Q==` |
| `@infrabyx/connectors` | 0.2.0     | `@infrabyx/connectors@0.2.0` | `64285ed7c9f5036d4eab31897905fec622d8b285` | `sha512-jZM2OSNeFL3fYX4QIt6NSlggpSPLjfLgVdC5OYlUXjvMgK0TFGoKu/mC8kDW+wNYtkO74srqXPr+6jAhvwTX6w==` |
| `@infrabyx/contracts`  | 0.3.0     | `@infrabyx/contracts@0.3.0`  | `30bb7dab8be0b9db5fe019c41d7d0f1eb93c37bd` | `sha512-Rm7yAo419irBdybHmEmfXApXyvvecOZw2Tt75x/WxiTxwPLNrngz+GOuO10+9yDu8QEjuuZ4+lw3ghHkmnB34Q==` |
| `@infrabyx/crypto`     | 0.3.0     | `@infrabyx/crypto@0.3.0`     | `01df029fa869e445f03ab632b42bc033e32fec60` | `sha512-rUoWByDScwU7gsygiR1l4kGhbnyhRaCPQ1oQPscJ7xd3rYc1KOs9Z53oKPrM7e4znoYt8tqL8JxF1tO93Bg1hA==` |
| `@infrabyx/export`     | 0.1.0 new | `@infrabyx/export@0.1.0`     | `67b6299f3ef983505a7c56e5227be445b098f69f` | `sha512-fAes+bVSSYe/Fo0MR1oWjzaPHWXcOYpJUwEJBarBBd9LvDNHN+5+zk/E/Xm1XVbXdeD7HIt8+f6NISVttFIwKQ==` |
| `@infrabyx/notify`     | 0.1.0 new | `@infrabyx/notify@0.1.0`     | `4c94637bfcc726b7c35b4a91c039377877f2b456` | `sha512-Lt2i08iTk5OvakshrIojJnjKYFNCMJQq4s8ZUJfM1IikqnBCfT8K2YB1bAaQuB8jtfexSCYkM+dmJsV9Ul9mWg==` |
| `@infrabyx/rules`      | 0.1.0 new | `@infrabyx/rules@0.1.0`      | `6a0905ad30bdebb28d0ab5ea82e78d83f324dc47` | `sha512-eElPyDYZiGfxefVcR6TEIlqhSoKM/XrMnyFJAQlzVu9+hiRQ2xEQuzqZQD66yP1CR+iXMpz+MWyoiFz4w2R+Kw==` |
| `@infrabyx/seed`       | 0.2.1     | `@infrabyx/seed@0.2.1`       | `54e1248b0ff8fc07017ac1e77d91be44d0fc504a` | `sha512-Ru1UYpU8lgiedwhl5re0A9dbJfa1O2ACtmE99FzgcI3V2lP5UK6zC8HxroL3OBTgDXoP3YdfgH2+7JIHHMD15A==` |
| `@infrabyx/tenancy`    | 0.3.0     | `@infrabyx/tenancy@0.3.0`    | `2b7e4494fb60977baf6a71c548e3ebe58e5c480c` | `sha512-+Vn5G88rzrhj3tIetpdgkEPMzADHP7hu95F4OZ/sTAL/5IsGPsMiKDJcD9CkPDiywdcyU5Plo5anHhuATyxTuA==` |
| `@infrabyx/testing`    | 0.3.0     | `@infrabyx/testing@0.3.0`    | `d4cd60c9746127d3ed68144c292e7a04395097d8` | `sha512-t59wVAKPsBpsHnBTYfpKPYsM+netKaU984ar7I1yvbSywfj/3uvIA96YiYLbAAY9EkEAfRcmxRtpdLyWMylbWQ==` |
| `@infrabyx/workflow`   | 0.1.0 new | `@infrabyx/workflow@0.1.0`   | `b414eabbd1fe9bfedf7206fefe4b8043e559a1ae` | `sha512-C54zqmfXgLThjWQgywe/9tCMXdr09SkfbiFyE9kVkLFYqenT7WxeO+KtJaWVBX6Y24Gr8cjJBUAeDlIgI+Lvxw==` |

Registry checksums are the values release run 43 printed in the job summary of its `release` job (122048259420), copied by the owner on 2026-10-27 (PL3-D-25).

**To adopt this release**, products follow `docs/phases/PL3-gate.md` §5. In short:

- **Versions:** move every `@infrabyx/*` package together, and add `rules`, `workflow`, `notify` and `export` as needed.
- **Migrations:** `infrabyx-migrate` applies `tenancy/0002`, `rules/0001`, `workflow/0001`–`0002`, `notify/0001`–`0002` and `export/0001`, with no new command. Run `infrabyx-rls-lint` afterwards.
- **Settings:** 178 keys in the registry, including the new `rules.*`, `workflow.timers.engine`, `int.push.*`, `int.notify.*`, `int.esign.*`, `eng.export.*` and `mc.*` keys, and the `kill.msg.<channel>` flags.
- **Secrets (SECRETS port):**
  - the C-23 group consent key and the C-22 export-signing key id;
  - the FCM service-account key (C-24) and the Expo token;
  - the Leegality auth token and private salt (C-25);
  - the Digio client id and secret, and the Digio callback `ipb_token`.
- **Code:**
  - build approvals with `createWorkflow`;
  - pass the Work Inbox to `RulesService`;
  - wire `NotifyService`, with a catalogue, a contact resolver, the time-zone and contact-window hooks, and a dispatcher worker;
  - wire `ExportService` with a product map, `kmsArchiveSigner` and an export worker, and add `map-gate` and a golden archive to CI;
  - wire `LeegalityEsign` or `DigioEsign` with a persisted `EsignEnvelopeStore`;
  - cross-tenant workers use the `SVC_` service readers, never `PLT_AUDITOR_RO`.

## PL4 session 8b and the PL4 gate (2026-10-27, PL4-D-12)

- `@infrabyx/export`: reference map `REF-EXPORT-1.2` adds `ai_runs` (AI run log, metadata only) and `vidhi_actions` (Vidhi action log); golden archive regenerated; `export_map: REF-EXPORT-1.2` (minor).
- Gate report `docs/phases/PL4-gate.md`: every exit-gate item passes; 58 of 272 spec ATs tagged; no provider was called in PL4.
- Release: version PR #61 carries `ai` and `vidhi` 0.1.0 (new), contracts, crypto, config, tenancy, testing 0.4.0, connectors 0.3.0, notify and export 0.2.0, and dependency patches. It is merged once green; `release.yml` publishes.

## Handover (2026-10-27, end of the session that built PL4 sessions 6–8)

- **Done:** PL4 sessions 6, 7a, 7b, 8a and 8b merged (#72–#76); the PL4 gate report is written. Owner answers #26–#33 and #65 applied earlier in this session (#67, #68).
- **Next:** merge version PR #61 when green (0.x only; under PL2-D-19), record the registry checksums from the `release.yml` job summary in `docs/phases/PL4-gate.md` §6, update "What products can install" above, then write the PL5 plan (`docs/phases/PL5-plan.md`) per IPB-14 §14.3.
- **Open owner questions:** #34 (retrieval chunk deletion), #35 (live evals in staging), #36 (image subject guard), #37 (locked-tool word matching), #38 (schedule re-check strictness, 24 runs a day), #39 (notebook shares and PDF extraction), #40 (QA floor). Defaults in use; nothing blocked.
- **Owner tasks before staging:** AWS Bedrock ap-south-1 model access; a Vertex AI asia-south1 project with zero retention (#27); approval of each paid sandbox run and the first live eval (#35).
- **Branch and PR state:** work on `claude/pl4-session-4-770lm8`, recreated from `main` after each merge. Version PR #61 (`changeset-release/main`) is open and is updated by `release.yml` on every merge to `main`.

## PL4 session 8a (2026-10-27, PL4-D-11)

- `@infrabyx/vidhi`, migration `vidhi/0004_feedback_qa_digest.sql`:
  - `Feedback`: ratings, sealed corrections, the tenant's reference set for the skill owner (never training), `FeedbackReceived`;
  - `QaSampler`: deterministic sampling (10 % for new skills, else `vidhi.qa.sample_rate`), owner reviews, precision and recall, demotion one level below the floor;
  - `Digest`: the daily digest per user and per tenant admin through NOTIFY `vidhi.digest`, and the searchable action log;
  - `disclosure` and `Vidhi.disclose`: the label with run id and the `ai_provenance` sidecar.
- Fix: the promotion evidence window is compared in SQL (microsecond timestamps).
- `@infrabyx/ai`: `usageSummary`. `@infrabyx/contracts`: `FeedbackReceivedData`. `@infrabyx/notify`: class `vidhi.digest`.
- Tests: `@IPB-03-AT-06` (platform side), feedback, QA sampling and demotion, digest and action log; no provider was called.
- New owner question #40 (QA floor); default in use.
- **Products must, at the PL4 gate:** call `QaSampler.maybeSample` when a task finishes and pass their Work Inbox; send `Digest.send` at `vidhi.digest.hour_local`; attach `disclose()` output to every AI artefact.

## PL4 session 7b (2026-10-27, PL4-D-10)

- `@infrabyx/vidhi`:
  - **MCP server** (`McpServer`, `McpToolRegistry`, `checkMcpHeaders`; MCP 2026-07-28, stateless, no SDK): off per tenant; skill tools with the `mcp` surface, filtered by the product's permission check; write and locked tools wait for the product UI's approval at any level (`IPB-VID-040` for a client that tries to execute directly); `vidhi.task_status`; rate limits; a ledger entry per call.
  - **MCP client** (`McpClient`): the platform allow-list narrowed by the tenant, with class ceilings, tool allow-lists and rates (`IPB-VID-041`); results as data blocks.
  - **Notebooks** (`Notebooks`, migration `vidhi/0003_notebooks.sql`): sealed sources (text, Markdown, product PDF extractor, records by reference, URLs through the product's egress); class aggregation with confirmation; grounded outputs through `vidhi.notebook@1` (108 golden cases) with provenance and staleness; read-only platform notebooks; cross-tenant sharing as a locked action (`IPB-VID-060` without approval).
  - `TaskRuntime.callTool` takes `forceApproval`; `TaskRuntime.status`.
- `@infrabyx/contracts`: `NotebookOutputCreatedData`.
- Tests: 11 integration tests (MCP server, client allow-list, notebooks) and MCP header unit tests, on fakes. No provider was called.
- New owner question #39 (cross-tenant shares expose outputs only; PDFs through a product extractor); defaults in use.
- **Products must, at the PL4 gate:** mount `McpServer.handle` on `/mcp` after `checkMcpHeaders` and OAuth; pass `authorize` and `approvalUrl`; give `McpClient` the egress fetch; give `Notebooks` FieldCrypto, the gateway, the approvals engine and, where they have them, `records`, `egress` and `pdfText`.

## PL4 session 7a (2026-10-27, PL4-D-09)

- `@infrabyx/vidhi`, migration `vidhi/0002_missions_schedules.sql`:
  - the in-house RRULE subset (`parseRecurrence`, `nextOccurrence`; DST-correct, refused parts listed);
  - `Scheduler`: recurring and event-triggered schedules, the cross-tenant due-run poller `tick` (`SVC_VIDHI_SCHED`), the IPB-03-65 re-check before every run, skip (`IPB-VID-020`) and pause (`IPB-VID-021`) with NOTIFY and `ScheduleRunSkipped`;
  - `Missions`: the planner prompt `vidhi.mission_plan@1`, budgets with `IPB-VID-070`, the mission level as a cap on its tasks, a halt for any step that needs a human, and a lease for resumable QUEUE-driven runs.
- `@infrabyx/contracts`: `SVC_VIDHI_SCHED`, `ScheduleRunSkippedData`. `@infrabyx/tenancy`: `memberStatus`. `@infrabyx/notify`: classes `vidhi.schedule.skipped` and `vidhi.schedule.paused`.
- Tests: `@IPB-03-AT-03` passes on fakes, with RRULE unit tests across DST zones. No provider was called.
- New owner question #38 (strict owner-role re-check; at most 24 runs a day); defaults in use.
- **Products must, at the PL4 gate:** call `Scheduler.tick` once a minute and `Scheduler.onEvent` from their inbox consumer; pass `authorize`, `entitled` and `connectorsValid` where they have them; run each mission with `Missions.advance` from their QUEUE and again after each approval.

## PL4 session 6 (2026-10-27, PL4-D-08)

- `@infrabyx/vidhi` (first release at the PL4 gate), with migration `vidhi/0001_init.sql`:
  - `SkillRegistry` (manifests validated at boot, `IPB-VID-001`);
  - the frozen locked list, with product additions;
  - product ceilings (Udofin borrowers L1, staff L2);
  - `Autonomy` (effective level, R4 promotion with evidence, automatic demotion);
  - `TaskRuntime` (the IPB-03 state machine, approvals for locked actions and L2 writes, `IPB-VID-012`/`-022`, kill-switch sweep);
  - `Vidhi.answer` with the persona prompts and hand-off cards, and `aiLabel` with the display-name override.
- `@infrabyx/ai`: `infrabyx-ai` takes several prompt sets (`--set`); two guard gaps fixed.
- `@infrabyx/contracts`: payload schemas for the Vidhi events. `@infrabyx/tenancy`: `infrabyx-migrate` applies `vidhi` after `ai`.
- Tests: `@IPB-03-AT-04`, `-AT-09`, `-AT-11` and `-AT-13` pass on fakes. No provider was called.
- New owner question #37 (word matching for locked tools); default in use.
- **Products must, at the PL4 gate:** ship skill manifests; build `Autonomy` and `TaskRuntime` with the approvals engine (with FieldCrypto) and their tool handlers; run `sweepKilled`; sync the Vidhi prompts with `--set packages/vidhi/persona:packages/vidhi/evals` (from `node_modules/@infrabyx/vidhi`).

## PL4 session 5 (2026-10-27, PL4-D-07)

- `@infrabyx/connectors/ai`: IMAGE_GEN adapters `gemini_imagen` (reference, Vertex asia-south1) and `flux_self_hosted` (alternative), on stubs, `unproven` with issues #69 and #70; `contract (IMAGE_GEN)` joins the port matrix.
- `@infrabyx/ai`: migration `ai/0004_image.sql`; `ImageService` (use enum and subject guard `IPB-AI-030`, labelling before storage, R2 `ai.image.publish` approval, `assertPublishable` with `IPB-AI-031`/`-032`); the dependency-free PNG labeller; `SpeechGateway` (`IPB-AI-010` until an adapter exists, #28).
- `@infrabyx/testing`: Imagen and FLUX stubs, `FakeImageGen`, `FakeSpeech`, `FakeRerank`, `imageGenContractCases`.
- Tests: `@IPB-03-AT-10` (platform side) passes on fakes. No provider was called.
- New owner question #36 (the strict rule-based image subject guard); default in use.
- **Products must, at the PL4 gate:** build `ImageService` with STORAGE, the approvals engine and their content roles; call `assertPublishable` before any image is published; never publish from `storage` directly.

## PL4 session 4 (2026-10-27, PL4-D-06)

- `@infrabyx/ai`:
  - the **scrubber** (the owner's list: PAN, Aadhaar including the masked form, mobile, e-mail, bank account with IFSC, card, voter ID, passport, driving licence; plus UPI, GSTIN, DOB, JWT, PEM, API keys), reversible tokens, and detection that raises the data class;
  - **guardrails** in the gateway: the input classifier, the output classifier (new PII, hidden context, unknown citations, reserved advice), per-user and input-size limits, and `structured` with one repair;
  - **platform prompts** `ai.grounded_answer@1`, `ai.summarise@1`, `ai.extract_fields@1` with golden sets, and the `infrabyx-ai` CLI (`prompt-lint`, `eval`, `prompts sync`);
  - **retrieval**: migration `ai/0003_retrieval.sql` (pgvector), `EmbeddingGateway` and `RetrievalService` (hybrid search with RRF, RLS, the product's AUTHZ callback, a data-class ceiling, citations, resumable re-embedding).
- `@infrabyx/testing`: synthetic PII and injection corpora; `startPostgres` uses the pgvector image.
- CI: `ai-prompt-lint` and `ai-eval-gate` in `verify`; `integration` on `pgvector/pgvector:0.8.1-pg18` pinned by digest.
- Tests: `@IPB-03-AT-01` and `@IPB-03-AT-05` pass on fakes. No provider was called.
- New owner questions #34 (deleting retrieval chunks) and #35 (live evals before prompts go ACTIVE in staging and above); defaults in use.
- **Products must, at the PL4 gate:** run PostgreSQL with the `vector` extension available (`ai/0003` creates it); run `infrabyx-ai prompts sync` after each release; give `RetrievalService` FieldCrypto and an `authorize` callback; handle `blocked`, `IPB-AI-042`, `IPB-SEC-013` and `IPB-SEC-019`.

## Owner answers #26–#33 (2026-10-27, PL4-D-05, PL4-C-01; ships at the PL4 gate)

- **#26:** IPB-DEV-08 approved: only Bedrock, Vertex and self-hosted vLLM are built; the other six LLM adapters stay registry rows.
- **#27:** C-24 widened to Vertex AI. `@infrabyx/crypto` signs only for the FCM and cloud-platform scopes; `vertexServiceAccountToken` in `@infrabyx/connectors` gives Vertex a cached token from a service-account key held through SECRETS.
- **#30:** AI run retention built: migration `ai/0002_run_retention.sql`, `RunRetention.sweep()` (daily, one worker) deletes routine runs after 180 days with one ledger entry per run; runs held for an approval, a statutory output or a maker-checker request are kept. PostgreSQL refuses any other delete.
- **#28, #29, #31–#33:** defaults confirmed. **Self-hosted inference host (#65): not now**; vLLM and FLUX stay unproven.
- **Export 0.1.0 role change** accepted as breaking; the export changeset says so.
- **Products must, at the PL4 gate:** run `infrabyx-migrate` (`ai/0002`); schedule `RunRetention.sweep()`; pass `hold` on runs linked to approvals, statutory outputs or maker-checker requests, and call `release` when such a record is deleted; for Vertex, put the service-account key in SECRETS (`secrets/<env>/ai/vertex/service_account_key`) or supply a workload-identity token.

## Handover (2026-10-27, end of the session that started PL4)

**Done (merged).**

- #60:
  - release run 43 checksums recorded (STATUS, PL3 gate report §6);
  - owner answers #24 and #25 applied (PL3-D-25): ORG_ADMIN exports through ORG_OWNER approval, 30-day archive expiry with ledgered deletion, the IST export time in the README, `REF-EXPORT-1.1`, and PR-020 for signature validation;
  - the PL4 plan (PL4-D-01, IPB-DEV-08, questions #26–#33, PR-021 to PR-023).
- #62:
  - PL4 session 1: AI contracts, Vidhi manifest schema, `ai.*`/`vidhi.*` settings, `mc_deactivate` for kill switches, the spike, and PR-024;
  - PL4 session 2: the `@infrabyx/ai` gateway core;
  - CI fixes: a gitleaks false positive on a settings key name, and a 57P01 race in the test kit's teardown.

**Open PR.** #66 is PL4 session 3: the LLM/EMBEDDING adapters on stubs, with issues #63–#65. Merge it under PL2-D-19 once green.

**Next: PL4 session 4** (plan §4.4–§4.7, §4.9):

- prompt files under `packages/ai/prompts/` and `infrabyx-ai prompts sync`;
- the scrubber (Aadhaar with Verhoeff, PAN, card with Luhn, GSTIN, IFSC, mobile, e-mail, JWT, PEM; reversible tokens);
- guardrails: the input classifier, the output classifier (PII leak, reserved advice, hallucinated citation), structured output with one repair (`IPB-AI-041`), and limits;
- the eval harness with `FakeLlm`, the `ai-eval-gate` and `ai-prompt-lint` CI checks, and `--live` refusing to run without an approval reference;
- retrieval: migration `ai/0002` with the `vector` extension, a hybrid pgvector + FTS search with RRF, and citations, which means moving the CI integration job to `pgvector/pgvector:0.8.1-pg18` pinned by digest;
- `@IPB-03-AT-01` and `@IPB-03-AT-05`.

Then sessions 5–8 as in plan §14: IMAGE_GEN; the `vidhi` core; missions, schedules, MCP and notebooks; then digest, feedback, provenance, the export map, and the gate.

**Open owner questions.** #26–#33 (PL4 defaults in use; only live Vertex runs wait on #27). Platform requests PR-020 to PR-024.

**Owner tasks.**

- PL4: an AWS Bedrock account (ap-south-1) and a Vertex AI project (asia-south1); approval of each paid run (#63, #64); a decision on a self-hosted inference host (#65).
- Earlier tasks: the Expo and Firebase accounts, the Leegality and Digio accounts, the PL2 vendor accounts and the GitHub `sandbox` environment.

**Local environment.**

- Node 24.22.1 from nodejs.org, checked against `SHASUMS256.txt`.
- Docker: `docker run -d --name pgs2 -e POSTGRES_PASSWORD=pw -p 55433:5432 mirror.gcr.io/library/postgres:18`. Session 4 needs the pgvector image instead.
- gitleaks 8.30.1 from GitHub releases, checked against the SHA in `ci.yml`.
- Commit subjects must start in lower case (commitlint `subject-case`) and stay within 100 characters.

## PL4 session 3 (2026-10-27, PL4-D-04)

- `@infrabyx/connectors/ai`: `bedrock_claude_in` (reference), `gemini_vertex_asia_south1` (alternative) and `self_hosted_vllm` (the SECRET route), for LLM and EMBEDDING, on stubs.
- `contract (LLM)` and `contract (EMBEDDING)` join the port matrix. All three adapters are `unproven`, with issues #63, #64 and #65.
- Live runs wait for your accounts and your approval of each paid run.

## PL4 session 2 (2026-10-27, PL4-D-03)

- `@infrabyx/ai` (first release at the PL4 gate), with migration `ai/0001_init.sql`:
  - the model registry: R4 promotion and default changes checked by `PLT_SECURITY_OFFICER`, evidence enforced, BLOCKED at once;
  - the prompt registry;
  - `LlmGateway` `chat` and `tools`: data-class routing that fails closed, failover in the band, breaker, caps, kill switches, the tool allow-list, data-block separation, and one run row per call with events;
  - `aiTrace`, with no content.
- `@infrabyx/testing`: `FakeLlm`, `FakeEmbedding`, and a teardown fix for an intermittent 57P01 after tests.
- `@infrabyx/tenancy`: `infrabyx-migrate` applies `ai` after `export`.
- Tests: `@IPB-03-AT-02` (routing table, fail-closed chaos, pin refusal), `@IPB-03-AT-07` and `@IPB-03-AT-08` (gateway side) all pass on stubs. No provider was called.

## PL4 session 1 (2026-10-27, PL4-D-02)

- `@infrabyx/contracts` (minor): the AI ports (LLM, EMBEDDING, IMAGE_GEN, SPEECH, RERANK), `contracts/vidhi`, ids, events and the IPB-03 error codes. `IPB-AI-001` now means "AI paused" (IPB-03); PR-024 asks to reconcile the IPB-02 table.
- `@infrabyx/config` (minor): the `ai.*` and `vidhi.*` keys (232 in the registry) and the new `mc_deactivate` rule for kill switches.
- Spike notes: `docs/phases/PL4-spike.md`. No provider was called.
- **Owner tasks for PL4** (accounts; nothing is blocked while stubs are used):
  - an AWS Bedrock account in ap-south-1 with Claude and embeddings model access, and confirmed data-protection terms;
  - a Google Cloud Vertex AI project in asia-south1 with Gemini and Imagen, the zero-data-retention setting and an identity for the platform (#27);
  - later, GitHub `sandbox` environment secrets for a live run you approve.

## Owner answers #24 and #25 (2026-10-27, PL3-D-25; ships in the next release)

- **#24 export:** `ORG_OWNER` exports directly; `ORG_ADMIN` calls `submit` (R2 approval `export.job.request`, checked only by `ORG_OWNER`); no other role exports (`roles` option removed). Archives are downloadable for 30 days, then `sweep()` deletes them and ledgers each deletion (`IPB-EXP-006` after). The README shows the export time in IST; data stays in UTC. Reference map `REF-EXPORT-1.1`.
- **#25 ESIGN:** confirmed as built; signature validation stays unsupported and is raised as PR-020.
- **Products must, at the next release:** run `infrabyx-migrate` (`export/0002_owner_answers.sql`, which creates `svc_export_sweep`); pass the workflow `approvals` engine to `ExportService`; run `sweep()` every few minutes from one worker; drop any `roles` option.

## What products could install before (PL2 gate A and the 0.1.1 patch, 2026-10-27)

| Package                | Version | shasum (SHA-1, from the registry, PL3-D-14) |
| ---------------------- | ------- | ------------------------------------------- |
| `@infrabyx/contracts`  | 0.2.0   | `812119f57992b4a96a9a06ff5cc25235c6f9b6d1`  |
| `@infrabyx/crypto`     | 0.2.0   | `d999360aa85318cf5835f9bc68cded9817b69d91`  |
| `@infrabyx/config`     | 0.2.0   | `4e3ecaa978abc82d6133270d4ff23c6d280f9b6c`  |
| `@infrabyx/tenancy`    | 0.2.0   | `74125a19c1b64ee8d7d12c802affc590d2f7dea9`  |
| `@infrabyx/audit`      | 0.1.1   | `333771decdbab2ce0e5410efb3c4270d58c24b65`  |
| `@infrabyx/seed`       | 0.2.0   | `abe263d2da43e54456456408b98777f6884255ea`  |
| `@infrabyx/testing`    | 0.2.0   | `ec39fd2e6f61c1329567898faa6e915df5c6f6e2`  |
| `@infrabyx/connectors` | 0.1.0   | `5e97dd5c6a6ed8a53a6f057fc8bf07388d5ad6d7`  |
| `@infrabyx/connectors` | 0.1.1   | `8b41faac6d43444d4fd82ebef4235967748c640d`  |

**Patch 0.1.1 (`@infrabyx/connectors`, PL3-D-02).** Use 0.1.1 instead of 0.1.0. In 0.1.0, `@infrabyx/connectors/workflow` and `./workflow/worker` fail to load in plain Node ESM ("`@temporalio/proto` does not provide an export named `temporal`"). 0.1.1 fixes this and has no API, migration, environment or settings change: bump the version only. Every release now passes `consumer-smoke`, which packs, installs and imports every export with plain Node.

SHA-512 integrity values are in `docs/phases/PL2-gate-A.md` §6 (registry values; three corrected, PL3-D-14). To adopt this release, products must change the following (full list in §5 of that report):

- **Versions:** move all `@infrabyx/*` packages together and add `@infrabyx/connectors`.
- **Migrations:** `connectors/0001_init`, `0002_session_revocation` and `0003_pgboss` run through the existing `infrabyx-migrate` (tenancy 0.2.0), with no new command; run `infrabyx-rls-lint` afterwards.
- **Environment:**
  - `AUTH_SUPER_ADMIN_EMAIL`, in each private product repository's local environment only;
  - the port variables for the adapters routed to: `SECRETS_*`, `AUTH_*`, `FLAGS_*`, `OBS_*`, `STORAGE_*`, `QUEUE_*`, `WORKFLOW_*`, `MSG_*`, `PAYMENTS_*` (test mode only);
  - in production, `_REF` values are SECRETS paths.
- **Settings:** the `int.*`, `eng.otel.*`, `eng.logs.*` and `eng.flags.*` keys, plus `mkt.meta.enabled` (156 keys in the registry).
- **Routing:**
  - one `infra/routing/<env>.routing.yaml` per environment;
  - CI runs `infrabyx-routing check --sandbox-status node_modules/@infrabyx/connectors/sandbox-status.json`;
  - GLOBAL messaging entries need a `dpa_ref`;
  - staging and above may not name an unproven adapter (#28–#39).
- **Code:**
  - PAYMENTS: a `RefundApprovals` view, R3 refund requests, a Cashfree `customerContact` resolver, and `router.portFor` for refunds;
  - IDENTITY: PKCE `codeVerifier` and `assertMfaForRoles`;
  - field encryption v2;
  - `presign` options;
  - redaction of the Gupshup `ipb_token` in ingress logs.

## Done

- PL0 complete (PR #1); Renovate fixes (PR #6); PL1 plan approved and merged (PR #7).
- PL1 implemented (PR #8, merge commit e5d0a1d), one commit and one Changeset per package:
  - `@infrabyx/contracts`: data classes, IDs, environments, roles, tiers, 99 error codes, CloudEvents envelopes, module manifest, kernel interfaces, five port contracts.
  - `@infrabyx/crypto`: single cryptography call-site (IPB-12-05; PL1-C-01), enforced by `ipb/no-direct-crypto`.
  - `@infrabyx/config`: env loader and guards (exit 78), settings registry (103 keys), flag registry (`kill.*`, 39 `fut.*`) with safe state; migration `config/0001_init.sql`.
  - `@infrabyx/tenancy`: context from verified claims, PgKernel with ledger-required commit, outbox/inbox, approvals, break-glass, impersonation, field encryption, masking, `infrabyx-migrate`, `infrabyx-rls-lint`; migration `tenancy/0001_init.sql`.
  - `@infrabyx/audit`: trigger-computed hash chain, append-only for every role, verifier, corrections, signed anchors; migration `audit/0001_init.sql`.
  - `@infrabyx/seed`: refusal-first CLI, deterministic idempotent seeds, synthetic validator, purge, credentials; migration `seed/0001_init.sql`.
  - `@infrabyx/testing`: `startPostgres`, fakes, the five NN suites, port contract harness, `infrabyx-migration-lint`, `infrabyx-at-report`, `@infrabyx/testing/eslint`.
- Exit gate (PL1-plan §12): CI `verify` and `integration` (PostgreSQL 18: migrate, rls-lint, test:int, at-report) green; acceptance tests present and passing — IPB-01-AT-05/11/12/16, IPB-02-AT-04/07/08/10/11/12/15/20, IPB-07-AT-04/05/06, IPB-09-AT-09/10/11/12, IPB-11-AT-01…07, IPB-12-AT-01/03; @NN-01, @NN-02, @NN-18, @NN-45; @IPB-01-15 contract suites.
- Release (PR #10, PL1-D-18): 0.1.0 of the seven packages published by `release.yml` run 10, tags `@infrabyx/<pkg>@0.1.0` pushed.
- Commit subjects checked locally by lefthook `commit-msg` (installed by `pnpm install`, PL1-D-17).
- PL1 accepted by the owner (2026-10-26). Follow-ups: scaffolds private until their phase with an `ipb:check` rule (PL1-D-20); `release.yml` uses `NPM_PUBLISH_TOKEN` so the version PR triggers CI (PL1-D-21).

## Handover (2026-10-27, end of the session that built the 0.1.1 patch and PL3 session 1)

**Done (merged).**

- #42 and #43: the plain-Node ESM fix and `consumer-smoke` (PL3-D-02); `@infrabyx/connectors@0.1.1` published by release run 32.
- #44: owner answers #7–#17 recorded and applied to the PL3 plan (PL3-D-04 to PL3-D-14); the spike (PL3-D-15); registry checksums corrected (#17 closed); PR-018 and PR-019.
- #45: PL3 session 1, the contracts and config (PL3-D-16).

**Next: PL3 session 2**, the `rules` package and the `connectors/rules` adapters. The design was worked out in this session but no code was written:

- **Dependencies** (in `connectors` only, exact pins, all at least 7 days old): `@gorules/zen-engine` 2.1.7, `@marcbachmann/cel-js` 8.0.0, `json-rules-engine` 7.3.1. The ZEN prebuild needs no build script. `json-rules-engine` and the CEL library load in plain Node through named imports. `consumer-smoke` must stay green.
- **CEL subset compiled to both engines.** Parse each row's `when` with a cel-js `Environment` that carries the structural limits (`maxAstNodes` = `rules.cel.max_cost`). Lower the AST (`{ op, args }`; ops `id`, `value`, `list`, `==`, `!=`, `<`, `<=`, `>`, `>=`, `&&`, `||`, `!_`, `in`; int literals are `bigint`) to a small IR covering and, or, not, a comparison of a declared input with a literal (either side), `in` a literal list, a bare boolean input, and a constant. Anything else is refused when the draft is validated, so both engines always run the same rows.
- **ZEN.** One decision-table node; its single input column has no `field`, so each cell is a whole expression (`a == "x" and b >= 10 and not (c in ["X","Y"])`). Outputs are JSON literals, plus a `_rule` output column carrying the row id. `first` returns `{}` on no match; `collect` returns an array; both were tested in the spike. String literals are limited to characters without `"`, `\` or newlines. A missing input evaluates to false without an error, so the service validates the input against the declared inputs first; an invalid input is `UNDETERMINED`, reason `input_invalid`.
- **json-rules-engine.** One rule per row, with conditions as `all`/`any`/`not` trees of `{ fact, operator, value }` and `allowUndefinedFacts`. For `first`, pick the matching row with the lowest index.
- **Memory engine:** direct CEL row walk, placed in `connectors/rules` (not `testing`), because CEL is a vendor import and `testing` cannot import it. A differential test proves that all three engines agree on a fixture table.
- **`RulesPort` change** (contracts minor, unreleased): `evaluate`, `listRuleSets`, `publish`, `simulate` and `explain` take a `KernelContext` first, because the service runs inside tenancy.
- **Errors:** register `IPB-RULE-001` (rule set invalid, 422), `-002` (no effective version, 404) and `-003` (version not a draft, 409), with source "PL3 plan §10 (PR-017)", as `IPB-UX-011` was registered under PR-005.
- **Migration `rules/0001_init.sql`:** `rule_set`, `rule_set_version` (with a body-immutability trigger outside `draft`), `decision_log` and `simulation_run`, with RLS forced. Platform rule sets in `tnt_platform` are readable by every tenant and writable only in platform scope. Add `@infrabyx/rules` (and later `workflow`, `notify`, `export`) to `PLATFORM_MIGRATION_PACKAGES` in `tenancy/src/migrate/index.ts`, the root `migration:lint` paths and `migrations/checksums.json`.
- **Service:**
  - drafts are validated by compiling them on every engine;
  - `publish` creates an R4 approval `rules.ruleset.publish` with the payload `{ ruleSetId, version, digest }` and registers the executor that publishes the version and retires the previous one;
  - after evaluation, a matched `verify` row that drives a statutory output makes the decision `UNDETERMINED` (reason `verify_row`);
  - engine errors, timeouts and limit overruns are `UNDETERMINED` and raise `HumanQueue.raise({ type: "task", productModule: "rules", actionHint: "review_undetermined" })`;
  - every decision is logged (inputs above INTERNAL sealed with FieldCrypto), and `explain` and `@IPB-07-AT-11` read the log.
- **CI:** add `RULES` (and later `PUSH`, `ESIGN`) to `PL2_PORTS` in `scripts/port-matrix.mjs` (rename the list to `PORTS`). In-process engines have no sandbox leg, so they are not listed in `sandbox-status.json`.
- Flip `@infrabyx/rules` to publishable in its first changeset (0.1.0, PL1-D-20).

**Branch and PR state.** No PR is open, and `main` is at `2725b6c`. `claude/optimistic-heisenberg-w0jdgf` equals `main` once this handover merges.

**Open questions:** #18 (FCM token minting), #19 (Leegality HMAC-SHA1) and #20 (snapshot age). Defaults are in use and nothing is blocked.

**Local environment.** The sandbox has Node 22, so download Node 24.22.1 into the scratchpad and check it against `SHASUMS256.txt`, as this session did. `consumer-smoke` needs network access to npmjs.

## Patch 0.1.1 and owner answers (2026-10-27)

- **#42**, the connectors ESM fix and `consumer-smoke` (PL3-D-02, PL3-D-03), and **#43**, the version PR. Release run 32 published `@infrabyx/connectors@0.1.1`. `consumer-smoke` runs in `ci.yml` and before every publish.
- **OWNER-QUESTIONS #17 closed** (PL3-D-14). `registry-dist.yml` read the registry:
  - five of the eight versions matched the gate-A report;
  - `tenancy`, `seed` and `testing` 0.2.0 differed, because of bin file modes and the order of `workspace:*` keys in `package.json`;
  - the report now carries the registry values.
- **Owner answers #7–#16 recorded and applied to the PL3 plan** (PL3-D-04 to PL3-D-13):
  - new cryptography items C-22 (JWS manifests and the signed `ExportCompleted`) and C-23 (keyed address hash);
  - approval expiry, reminder and escalation;
  - tighten-only `mc.*` keys;
  - the persisted flag snapshot with an operations alert.
- **Platform requests:** PR-018 (keyed `principal_hash`) and PR-019 (`IPB-UX-012`, `ApprovalExpired`, `ApprovalEscalated`, `FlagProviderUnreachable`).
- **Session 1 spike** in `docs/phases/PL3-spike.md` (PL3-D-15). New questions #18 (FCM token minting), #19 (Leegality HMAC-SHA1) and #20 (snapshot age); defaults are in use and nothing is blocked.

## Handover (2026-10-27, end of the session that closed PL2 gate A)

**Done.**

- **PL2 session 8 and gate A.** The gate-A walk (`docs/phases/PL2-gate-A.md`) found:
  - the §10 acceptance-test tags missing for five IDs;
  - no `port-contract` issues;
  - `sandbox-status.json` not shipped in the package.

  All three were fixed in #40 (PL2-D-67). Issues #28–#39 track the 12 unproven SaaS adapters.

- **Release.** Version PR #14 was merged, and release run 29 published the 8 packages, with tags (PL2-D-68). The checksums were reproduced locally, and the owner confirms them against the registry (#17). `release.yml` now records registry checksums after each publish.
- **PL3 plan.** `docs/phases/PL3-plan.md` is written and self-reviewed (PL3-D-01). It carries the owner's PL3 decisions: resend classes with default hold, the platform suppression list as the single source of truth, Brevo send-only, and no support-token work until a product needs it. It asks questions #7–#16, and the defaults are in use.

**Next.** PL3 session 1:

- spike on the [VERIFY] items: ZEN prebuilds on Node 24.22.1, the CEL library, the XLSX library licence, and the Expo, FCM, Leegality and Digio API shapes;
- then `contracts` (RULES, NOTIFY, PUSH, ESIGN, `HumanQueue`, catalogue and export schemas, IDs, events, `IPB-NTF-002..006`) and the `config` keys and `kill.msg.*` flags.

Then sessions 2–7 as in plan §12.

**Branch and PR state.** The PR with the PL3 plan and this handover is the only open PR. When it merges, `main` carries everything.

**Open questions.** OWNER-QUESTIONS #7–#17. Only #9 (signing and restricted exports), #13 (retention) and #14 (push accounts) park any work, and only the parts named there.

## Handover (2026-10-27, end of the session that built PL2 sessions 6 and 7)

**Done.** PL2 sessions 1–7 are built and merged:

- #13, #15–#21 (sessions 1–5, field-encryption v2, the MinIO-server leg);
- #23 (flaky base62 test fixed at the draw; public-repository rules, PL2-D-62; OWNER-QUESTIONS #5, PL2-D-63);
- #24 (session 6: EMAIL, SMS, WHATSAPP, PL2-D-64);
- #25 (OWNER-QUESTIONS #6 and the Gupshup conditions, PL2-D-65);
- #26 (session 7: PAYMENTS `razorpay` and `cashfree`, test mode only, PL2-D-66).

All thirteen PL2 ports now have both adapters with green hermetic contract legs in CI. Every SaaS adapter stays `unproven` until its sandbox leg runs (IPB-DEV-04).

Version PR #14 collects every changeset and was green after #23. It is regenerated after each merge, so check it again before gate A. It is merged only at gate A (PL2-D-31). Nothing from PL2 is published yet.

**Branch and PR state.** No PR is open. `claude/funny-cori-6upyrr` equals `main` (`0c4535d`). GitHub deletes it after each squash merge, so push it again from `main` before the next session's first commit.

**Next: PL2 session 8, then gate A** (plan §11, §14 of IPB-14):

1. Walk the PL2 exit-gate checklist in plan §11: the IPB-09 required checks, each port's `@IPB-..-AT-..` acceptance tests, `at-report`, the threat model, `sandbox-status.json`, and the owner tasks for sandbox accounts.
2. Write a short gate-A report with what passed, what is unproven and why, and the owner tasks.
3. When the checklist is green, merge version PR #14 so `release.yml` publishes the 0.x pre-releases.
4. Update STATUS with what products can install and what they must change: migrations `connectors/0002` and `0003`; the settings added in PL2; the env vars `AUTH_SUPER_ADMIN_EMAIL` and the `PAYMENTS_*`/`MSG_*` names; routing `dpa_ref` for GLOBAL messaging; `RefundApprovals` and `customerContact` for PAYMENTS; `router.portFor` for refunds.

Then PL3 (plan first). The owner's PL3 items so far:

- NOTIFY resend classes and the platform suppression list (PL2-D-65);
- the platform-issued support token, when a product first needs it (PL2-D-55).

**Local environment notes.**

- Start Docker with `nohup dockerd &`, then `docker start pgs2` (PostgreSQL 18 on 55433); use `IPB_TEST_PG_URL=postgres://postgres:pw@127.0.0.1:55433/postgres`.
- Docker Hub works; GHCR (Zitadel) and quay.io do not. Vendor documentation hosts are blocked, so vendor facts come from official SDKs on GitHub plus web search (PL2-D-64, PL2-D-66). Clones are in the session scratchpad.
- gitleaks 8.30.1 from GitHub releases, checked against the SHA in `ci.yml`. Run `gitleaks git --log-opts="origin/main..HEAD" .` before pushing. Build credential-shaped test values at run time; stubs use `stubCredential()`.
- Commit subjects are at most 100 characters (commitlint). Force-pushes are refused by the session's permission policy. Pass the exact 40-character head SHA to the squash merge.

**Open questions.** None. OWNER-QUESTIONS #1–#6 are answered (PL2-D-50, PL2-D-55, PL2-D-56, PL2-D-61, PL2-D-63, PL2-D-65).

## Working mode (PL2-D-41)

Continuous build: PL2 closed at gate A; now PL3, then PL4–PL6. Defaults taken for the owner are listed in `docs/OWNER-QUESTIONS.md` (#7–#17 open with defaults in use; #1–#6 answered). Threat model: `docs/security/threat-model.md` (PL2-D-43). CI: this repository is public, so its minutes are free (PL2-D-62); the budget rules bind the private product repositories. Public-content rules apply to everything written here.

## PL3 session 6 (2026-10-27, PL3-D-23)

- `@infrabyx/crypto` (minor): C-25 `verifyLeegalityMac` (HMAC-SHA1, verification only, PL3-C-02).
- `@infrabyx/connectors` (minor, subpath `./esign`): `leegality` (interim reference) and `digio` (alternative), on stubs, test mode, `unproven` with port-contract issues #55 and #56. Both:
  - read the document by reference and check its SHA-256;
  - never downgrade a signature type;
  - treat webhooks as triggers and read the status back;
  - write signed PDFs to STORAGE `REGULATED`.
- `ESIGN` joins the port-contract matrix. `@infrabyx/contracts` (minor): `EsignEnvelopeStore`. `@infrabyx/testing` (minor): the Leegality and Digio stubs and `MemoryEsignEnvelopeStore`. `@infrabyx/config` (minor): `int.esign.provider` and `int.esign.expire_in_days`.
- New owner question #25 (ESIGN defaults); defaults in use, nothing blocked.
- Products at the PL3 gate:
  - wire `LeegalityEsign` or `DigioEsign` with STORAGE, credentials from SECRETS and a persisted `EsignEnvelopeStore`;
  - configure one Leegality workflow per signing method;
  - put `ipb_token` on the Digio callback URL;
  - pass webhooks to `handleWebhook` and act only on the status it returns.

## PL3 session 5 (2026-10-27, PL3-D-22)

- `@infrabyx/crypto` (minor): C-22 `signDetachedJws` and `verifyDetachedJws` (ES256 through KMS `sign`), `spkiToEs256Jwk` and `cloudEventSigningPayload`.
- `@infrabyx/export` 0.1.0 (first release at the PL3 gate):
  - migration `export/0001_init.sql`;
  - `REF-EXPORT-1.0` and `ExportMapRegistry`;
  - the deterministic archive writer to the Ecosystem §12.1 standard, with the signed manifest and an Apache-2.0 offline verifier;
  - `ExportService`: R0 for `ORG_OWNER`, rate-limited, a reconciled REPEATABLE READ snapshot, STORAGE `CONFIDENTIAL`, ledgered downloads (`@IPB-09-37`);
  - `infrabyx-export map-gate | diff | verify`.
- CI: `export-map-gate` in `verify` (`@IPB-09-AT-14`) and `golden-archive-diff` in `integration` (`@IPB-09-AT-15`), with the committed fixture `packages/export/golden/REF-EXPORT-1.0/`. CI also reruns on label changes (`export:unchanged`).
- `@infrabyx/contracts` (minor): `IPB-EXP-001`–`005` and the `snapshot` read option. `@infrabyx/tenancy` (minor): REPEATABLE READ reads; `infrabyx-migrate` applies the export migration.
- New owner question #24 (export defaults); defaults in use, nothing blocked.
- Products at the PL3 gate:
  - install `@infrabyx/export` and ship a `<PRODUCT>-EXPORT-1.0` map;
  - build `ExportService` with STORAGE, the KMS export-signing key and an `ecosystemEvent` builder, and run jobs from a worker;
  - add `map-gate` and a golden archive of their demo tenant to CI.

## Owner answers #21–#23 (2026-10-27, PL3-D-21)

- **#21:** UNDETERMINED review tasks go to `ORG_CHECKER` (or `ORG_ADMIN` when the tenant has no checker), exclude the requesting principal and escalate once to `ORG_ADMIN` after 48 hours (`inbox.escalate` timer, class `inbox.escalated`); one ledger entry per decision stays.
- **#22:** the timer poller, the NOTIFY dispatcher and the unsubscribe link read across tenants as `SVC_SCHEDULER`, `SVC_NOTIFY_DISPATCH` and `SVC_NOTIFY_UNSUBSCRIBE` (`ServiceReader`), each as its own database role with column grants; reads are ledgered per tenant; threat model §3.16.
- **#23:** NOTIFY defaults confirmed; collection and recovery classes go only inside 08:00–21:00 in the recipient's zone, narrowed by a product's `contactWindow` hook, never widened.
- Products at the PL3 gate: run `infrabyx-migrate` (`workflow/0002`, `notify/0002` create the reader roles and grant them to `app_rw` and `app_ro`); pass `itemEscalated` (from `notifyApprovalNotifier`) to `createWorkflow`; optionally `contactWindow` to `NotifyService`.

## Handover (2026-10-27, end of the session that closed PL3)

**Done (merged).**

- #53: owner answers #21–#23 (PL3-D-21), covering:
  - UNDETERMINED review tasks go to ORG_CHECKER (ORG_ADMIN when there is no checker) and escalate after 48 hours;
  - the `SVC_SCHEDULER`, `SVC_NOTIFY_DISPATCH` and `SVC_NOTIFY_UNSUBSCRIBE` service readers replace `PLT_AUDITOR_RO`;
  - the NOTIFY collection contact window.
- #54: PL3 session 5, `export` and C-22 (PL3-D-22).
- #57: PL3 session 6, ESIGN `leegality` and `digio` and C-25 (PL3-D-23).
- #58: the PL3 gate report and the `export-map-gate` scope fix found at the gate (PL3-D-24).
- #47: the version PR. Release run 43 published 12 packages with tags (above).

**Next: PL4.** Read IPB-14 §14.3 for the PL4 package list and the IPB files it names. Then write `docs/phases/PL4-plan.md`, self-review it, commit it, and start under the continuous-build mode. Before that, three items are worth doing:

- Copy the run-43 registry checksums into this file when a registry token is at hand.
- Tell the six products about the release (gate report §5).
- Check the owner's answers to #24 and #25.

**Open questions.** #24 (export defaults) and #25 (ESIGN defaults). Defaults are in use and nothing is blocked.

**Owner tasks before staging.** Expo and Firebase accounts (#50, #51); Leegality and Digio sandbox accounts (#55, #56); plus the PL2 vendor accounts (#28–#39) and the GitHub `sandbox` environment.

**Branch and PR state.** No PR is open, and `main` is at the version commit `4a9bbcb` plus this handover. Work continues on `claude/festive-sagan-x3370c`, pushed again from `main`. When GitHub does not delete the branch after a squash merge, merge its old head instead of force-pushing; the content is already on `main`.

**Local environment.** Use Node 24.22.1 from nodejs.org, checked against `SHASUMS256.txt` and kept in the scratchpad. Use Docker with the `mirror.gcr.io` registry mirror. Start PostgreSQL 18 with `docker run -d --name pgs2 -e POSTGRES_PASSWORD=pw -p 55433:5432 postgres:18` and set `IPB_TEST_PG_URL=postgres://postgres:pw@127.0.0.1:55433/postgres`. Vendor documentation hosts are unreachable from the sandbox.

## Next

- PL4: plan first (`docs/phases/PL4-plan.md`), then build under the continuous-build mode.

## Handover (2026-10-27, end of the session that built PL3 sessions 2–4)

**Done (merged or in the last PR).**

- #48: owner answers #18–#20 (PL3-C-01 C-24, PL3-C-02 C-25, PL3-D-17 alert escalation) and PL3 session 2 (`rules`, RULES engines, PL3-D-18).
- #49: PL3 session 3 (`workflow`, `tenancy/0002`, `TemporalTimers`, PL3-D-19).
- #52: PL3 session 4 (`notify`, PUSH `expo` and `fcm`, C-23 and C-24, PL3-D-20). It merges under PL2-D-19 once CI is green.

**Next: PL3 session 5, `export`** (plan §7):

- `REF-EXPORT-1.0` map, the map registry and `requiredMapBump` from `contracts/export`;
- the archive writer to the Ecosystem §12.1 profile (CSV, JSON Schema 2020-12, JSONL, SHA-256 per file, README in TXT and Markdown), with the manifest signed as a detached JWS through KMS `sign` (C-22, ES256 DIGEST) and the signed `ExportCompleted`;
- jobs on STORAGE with a ledgered SHA-256 per download;
- the `export-map-gate` and `golden-archive-diff` CLIs with CI steps and a committed golden fixture from `tnt_demo` (`@IPB-09-AT-14`, `@IPB-09-AT-15`);
- restricted folders stay refused (PL3-D-06).

**Then:**

- session 6: ESIGN `leegality` with C-25 (HMAC-SHA1, verification only: constant time, replay window, read-back before any state change) and `digio`, both on stubs and `unproven` with port-contract issues;
- session 7: the gate report `docs/phases/PL3-gate.md`, then the version PR and release.

**Open questions:** #21 (RULES review assignee, per-decision ledger), #22 (timer and dispatcher platform context with `PLT_AUDITOR_RO`), #23 (NOTIFY fallback, inbound consent before PR-018, time-zone keys). Defaults are in use and nothing is blocked.

**Branch and PR state.** Work is on `claude/nifty-mayer-xmxxq0`. GitHub deletes the branch after each squash merge, so push it again from `main`.

**Local environment.**

- Node 24.22.1 from nodejs.org, checked against `SHASUMS256.txt` and kept in the scratchpad.
- Docker Hub rate-limits the sandbox. Set `/etc/docker/daemon.json` to `{"registry-mirrors":["https://mirror.gcr.io"]}` and restart `dockerd`; the PostgreSQL 18 and Temporal images (by digest) then pull through the mirror.
- The `consumer-smoke` check needs npmjs.

## PL3 session 4 (2026-10-27)

- `@infrabyx/crypto` (minor): C-23 `addressHash` and C-24 `signServiceAccountAssertion` (PL3-C-01).
- `@infrabyx/connectors` (minor, subpath `./push`): `expo` and `fcm`, payload guard `IPB-NTF-006`, tokens in a `PushTokenStore`; hermetic legs green on the Expo and FCM stubs (the FCM stub checks the C-24 assertion); `unproven` with issues #50 and #51; `PUSH` in the port matrix.
- `@infrabyx/notify` 0.1.0 (first release at the PL3 gate), migration `notify/0001_init.sql`: catalogue and `infrabyx-notify-lint` (CI step), routing and preferences (`IPB-NTF-001`), quiet hours and digest (`@IPB-07-AT-22`), `kill.msg.*`, resend classes with held deliveries, the platform suppression list with an R2 lift, marketing consent and one-click unsubscribe, sealed push tokens, delivery reports, `notifyApprovalNotifier` for workflow reminders.
- `@infrabyx/contracts` (minor): `PushTokenStore`, context-first `NotifyPort`, id prefixes `ptk` and `inm`. `@infrabyx/testing` (minor): Expo and FCM stubs, `MemoryPushTokenStore`.
- New owner question #23 (fallback, inbound consent before PR-018, time-zone keys); defaults in use, nothing blocked.
- Products at the PL3 gate: install `@infrabyx/notify`, ship their catalogue files and lint them, supply a `ContactResolver` and the C-23 group consent key (SECRETS), run `dispatchDue` in a worker, pass `notifyApprovalNotifier` to `createWorkflow`, wire PUSH adapters with `PgPushTokenStore`, verify delivery webhooks with the adapters and hand the events to `handle*`.

## PL3 session 3 (2026-10-27)

- `@infrabyx/tenancy` (minor), migration `tenancy/0002_approvals_pl3.sql` (expand-only): request expiry (7 days; 72 hours for R4, R5 and financial R3), terminal through `expired_at` and a trigger; `remind`, `escalate` (to `ORG_ADMIN`, never decides) and `expire`; `IPB-UX-012`; the checker `diff`; the tighten-only `tenantPolicy` hook (`mc.checker_roles`, `mc.dual_checker_above`); `PLT_SECURITY_OFFICER` may cancel; same-transaction `observers`.
- `@infrabyx/workflow` 0.1.0 (first release at the PL3 gate), migration `workflow/0001_init.sql`: `createWorkflow`; the Work Inbox (`InboxService`, the `HumanQueue`); scheduled actions (`IPB-UX-005` early, cancel by maker, `ORG_OWNER` or `PLT_SECURITY_OFFICER`); durable timers (PostgreSQL poller and reconciler; optional Temporal); reminders, escalation and expiry by timer; `decideMany` (`IPB-UX-006`); `settingsApprovalPolicy`; `engineRefundApprovals`. Tests on PostgreSQL 18: `@IPB-07-AT-06`, `-07`, `-09`, `-10` (backend), `@IPB-02-AT-11/12` through the workflow, `@NN-45`.
- `@infrabyx/connectors` (minor): `TemporalTimers`, the `ipbTimer` workflow and `timerActivities`, proven in the WORKFLOW hermetic leg. `@infrabyx/contracts` (minor): `TimerEngine`, `ApprovalRequestInput.diff`. `@infrabyx/config` (minor): setting approvals carry the diff.
- Deferred: `awaitApproval` to PL4 with Vidhi; reminder and escalation notifications go through `ApprovalNotifier` until NOTIFY (session 4).
- New owner question #22 (the timer poller's read-only platform context); defaults in use, nothing blocked.
- Products at the PL3 gate: install `@infrabyx/workflow`, build the engine with `createWorkflow` instead of `new ApprovalsEngine`, run `timers.start()` in one worker process (and, with `workflow.timers.engine = temporal`, a timer worker on `TIMER_WORKFLOWS_PATH`), register money actions with `financial: true`, pass `engineRefundApprovals` to PAYMENTS, and run `infrabyx-migrate` (tenancy 0002, workflow 0001).

## PL3 session 2 (2026-10-27)

- **Owner answers #18–#20** recorded and closed: C-24 RS256 only for the FCM service-account assertion (PL3-C-01, built in session 4); C-25 HMAC-SHA1 verification of Leegality webhooks only (PL3-C-02, built in session 6); IPB-01's 24-hour snapshot limit kept, with the provider-unreachable alert escalating at 1 h and 12 h (PL3-D-17, built in `FlagService`).
- `@infrabyx/connectors/rules` (minor): `zen` (reference), `json-rules` (alternative) and the memory CEL row walk compile one CEL subset (`@marcbachmann/cel-js` 8.0.0) through a shared IR; strict input checks; `UNDETERMINED` on any fault or timeout; canary health; a differential test across the three engines. `RULES` joins the port-contract matrix.
- `@infrabyx/rules` 0.1.0 (first release at the PL3 gate): `RulesService` with drafts validated on every engine, R4 publish through `rules.ruleset.publish`, evaluation with a decision log (inputs above INTERNAL sealed), `UNDETERMINED` to the Work Inbox, `simulate`, `explain`, platform rule sets in `tnt_platform`; migration `rules/0001_init.sql`; `@IPB-07-AT-11` on PostgreSQL 18.
- `@infrabyx/contracts` (minor): context-first `RulesPort`; `IPB-RULE-001` to `-003` (PR-017). `@infrabyx/tenancy` (minor): `infrabyx-migrate` applies the rules migration. `@infrabyx/testing` (minor): RULES engine contract cases. `@infrabyx/config` (minor): alert escalation.
- New owner question #21 (UNDETERMINED review assignee and the per-decision ledger entry); defaults in use, nothing blocked.
- Products at the PL3 gate: install `@infrabyx/rules`; `infrabyx-migrate` then applies `rules/0001`; settings `rules.engine`, `rules.cel.max_cost`, `rules.eval.timeout_ms` are already registered; wire `HumanQueue` (from `@infrabyx/workflow`, session 3) and FieldCrypto into `RulesService`.

## PL3 session 1 (2026-10-27)

- `@infrabyx/contracts` (minor):
  - the RULES, NOTIFY, PUSH and ESIGN port interfaces;
  - the notification catalogue schema;
  - `HumanQueue` and the Work Inbox item types;
  - the export map (`requiredMapBump`) and `ArchiveManifestV1` (subpath `./export`);
  - ten id prefixes and `IPB-NTF-002`–`006`;
  - `IPB-UX-012`, the new events and the Ecosystem payloads `MarketingConsentUpdated`, `ExportRequested` and `ExportCompleted` (PL3-D-16).
- `@infrabyx/config` (minor):
  - 17 new settings: `rules.*`, `int.push.*`, `int.notify.dedupe_window_h`, `workflow.timers.engine`, `eng.export.*`, and the tighten-only `mc.*` keys (PL3-D-08);
  - the new tighten mode `subset`;
  - exact `kill.msg.*` switches for the five channels;
  - `FlagService.boot()` and `onAlert` (PL3-D-13).
- `@infrabyx/testing` (patch): the PUSH default class in `ipb/port-data-class`.
- Products: nothing to change until the PL3 gate. The new keys and flags ship with the next minor releases.

## PL2 session 7 (2026-10-27)

- `@infrabyx/connectors/payments`: `razorpay` (reference) and `cashfree` (alternative), test mode only, on the approved locked list P-01 to P-18 (PL2-D-66):
  - no live key outside prod/dr (P-03, adapters and env guard);
  - exact integer paise (P-04);
  - references derived from the idempotency key and vendor lookup before any retry (P-05);
  - refunds only with an approved R3 request for the same payload, read against the PA's refund list and never repeated (P-07);
  - unresolved pending refunds go to the human queue;
  - `kill.payments` (P-12);
  - raw-body webhook signatures (P-09);
  - read-only reconciliation (P-11).
- Router: `noFailover` method specs and `router.portFor(port, adapter)` so refunds, mandates and captures stay with their PA (P-08); `@IPB-01-AT-08` Razorpay → Cashfree proven on stubs.
- P-18 manifests `packages/connectors/marketplace/{razorpay,cashfree}.manifest.json` with a lint test.
- Hermetic legs: 29 PAYMENTS cases green on the Razorpay and Cashfree stubs; sandbox legs wait for the test accounts.
- Products: refunds need an approvals-engine view (`RefundApprovals`) and a maker request with payload `{ paymentId, amountMinor, reason }`; Cashfree needs a `customerContact` resolver; refunds of orders taken during failover go through `router.portFor("PAYMENTS", order.adapter)`.

## PL2 session 6 (2026-10-27)

- `@infrabyx/connectors` (subpaths `/email`, `/sms`, `/whatsapp`):
  - EMAIL `ses` (SES v2 ap-south-1, configuration set per brand, SNS events per C-13 with a timestamp window, reputation block as `IPB-PORT-002`) and `brevo` (GLOBAL with DPA reference, idempotencyKey and tag lookup, DKIM-checked failover target, bearer webhooks with Brevo's source ranges);
  - SMS `msg91` and `gupshup-sms` with a shared DLT registry (template, header, entity and variables checked before any request), CRQID, bearer or URL-token delivery reports, credentials never in URLs, failover msg91 → gupshup-sms through the router;
  - WHATSAPP `gupshup` and `meta-cloud`: 24-hour session window, marketing refused while `mkt.meta.enabled` is false (OWN-08), Meta `X-Hub-Signature-256` and handshake, rate card from configuration.
- `@infrabyx/contracts`: `IPB-API-018`; `WebhookRequestMeta` on messaging `verifyWebhook`; `WhatsappEvent.pricingCategory` and `errorCode`.
- `@infrabyx/crypto`: `verifyWebhookSecret` (C-19 in use). `@infrabyx/config`: `mkt.meta.enabled`, `int.sms.low_balance_credits`, `int.whatsapp.rate_card`.
- `@infrabyx/testing`: stub server and stubs for SES v2, Brevo, MSG91, Gupshup SMS and WhatsApp, Meta Graph; SNS test signer.
- Hermetic legs: EMAIL 32, SMS 23, WHATSAPP 27 cases green on the stubs and moto. All six adapters stay `unproven` until their sandbox legs run (IPB-DEV-04); vendor details marked [VERIFY] (PL2-D-64). Owner question #6 opened.
- Products: no migration; new settings above; WhatsApp and Brevo routing entries need a `dpa_ref`; Gupshup webhook URLs carry `ipb_token`, which ingress logs must redact.

## PL2 session 5 (2026-10-26)

- `@infrabyx/connectors`:
  - STORAGE `s3` and `minio`: Object Lock COMPLIANCE, write-once retention and refused overwrite or delete while retained (@IPB-01-AT-09), soft delete, AUDIT anchors survive a version delete (@IPB-02-AT-13), SSE-KMS with the class or tenant key (C-17), presigned URLs bound to method and content type, SHA-256 verified replication, cross-tenant keys refused; parity on moto 5.2.4 (@IPB-01-AT-10, S3-API level) (PL2-D-57);
  - QUEUE `bullmq` (Redis 7.4 and Valkey 8.1) and `pg-boss` (PostgreSQL 18, DML-only role): canary ≤ 5 s, idempotent enqueue, delay, backoff, DLQ and replay, cron, refusal of non-INTERNAL payloads (PL2-D-58, PL2-D-59);
  - WORKFLOW `temporal` and `temporal-cloud`: C-16 codec and encrypted failures, idempotent ids, deterministic replay, 32 KB reference path, input-class rule, worker helper (PL2-D-60).
- `@infrabyx/contracts`: `presign` options `{ bucketClass, contentType }`; KMS purpose `workflow`.
- New for products at gate A: migration `connectors/0003_pgboss.sql`; env `STORAGE_*`, `QUEUE_REDIS_URL`, `WORKFLOW_TEMPORAL_*` (plan §6.7–6.9); settings `int.storage.*`, `int.queue.*`, `int.workflow.*`.
- Owner answer (PL2-D-61): MinIO's last community release from quay.io by digest, else built from source. quay.io refused the pull from CI, so CI builds `RELEASE.2025-09-07T16-13-09Z` from source at a pinned commit and caches the binary; the MinIO-server leg proves presigned-URL enforcement; `minio` stays refused outside dev and test. PR-015 asks to replace MinIO in the catalogue; the production self-hosted alternative is a PL6 decision (SeaweedFS leading, Ceph RGW for bank on-premise).

## PL2 session 4 (2026-10-26)

- `@infrabyx/connectors`:
  - AUTHZ adapters `cerbos` (0.57.0) and `openfga` (v1.22.0) with the platform policy pack in `policy/`; one decision table proven on both engines, agents never decide (@IPB-02-AT-11), PDP failure denies (PL2-D-51, PL2-D-52);
  - IDENTITY adapters `keycloak` (26.8.1) and `zitadel` (v4.19.5) with a shared ES256 verifier, claim mapping, the `assertMfaForRoles` guard (IPB-SEC-001) and the revocation store on migration `0002_session_revocation` (PL2-D-53, PL2-D-54, PL2-D-56);
  - Keycloak leg walks the real login pages: first login forces a password change and TOTP enrolment (@IPB-02-31), the enrolment token is refused for ORG_ADMIN and the next TOTP login passes (@IPB-02-AT-02, API half), SCIM deactivation refuses old tokens (@IPB-02-05), back-channel logout, JWKS across an outage;
  - the Zitadel leg runs only in CI (GHCR).
- `@infrabyx/contracts`: `authenticate` takes the PKCE `codeVerifier`; id prefix `rvk`.
- `@infrabyx/testing`: Keycloak, OpenFGA and Zitadel images; `startNetwork()`.
- New for products at gate A: migration `connectors/0002_session_revocation.sql`; env `AUTH_ADAPTER`, `AUTH_ISSUER_URL`, `AUTH_CLIENT_ID`, `AUTH_ADMIN_CLIENT_ID` and the `AUTH_*` secrets from SECRETS (plan §6.5); settings `int.identity.*` and `int.authz.decision_cache_seconds`.
- Owner answers (26 Oct): impersonation stays off; a platform-issued, read-only, 60-minute, ledgered support token is planned in the phase that first needs it (PL2-D-55). Zitadel keeps MFA for every user; the API MFA guard stays on both IdPs (PL2-D-56).
- Field-encryption format v2 (OWNER-QUESTIONS #1, PL2-D-50) is already merged (#18, 7a36249), ahead of gate A.

## PL2 session 3 (2026-10-26)

- `@infrabyx/crypto`:
  - C-11 JWT/JWS verification on `node:crypto`, tested with RFC 7515 Appendix A and RFC 7520 §4 vectors, the negative cases and a `jose` differential test (`jose` is test-only and `ipb:check` enforces that);
  - C-13 Razorpay, Cashfree and Meta HMAC checks, plus Amazon SNS SignatureVersion 2 with pinned certificate hosts;
  - C-19 webhook secrets;
  - `LocalKms` honours the data-key AAD (PL2-D-48).
- `@infrabyx/contracts`: `KmsPort.generateDataKey(keyId, aad?)` (PL2-D-47).
- `@infrabyx/connectors`:
  - SECRETS adapters: `aws-sm` (platform CMK, CloudTrail audit) and `vault` (KV v2, dynamic PostgreSQL leases), plus `CachedSecrets` (PL2-D-46);
  - KMS adapters: `aws-kms` (encryption context, DIGEST signing, tenant CMKs, 30-day deletion) and `vault-transit` (PL2-D-47);
  - contract legs on moto 5.2.4 with a CloudTrail stub (PL2-D-45), LocalStack 4.12.0 and OpenBao 2.7.1; @IPB-01-AT-19 and @IPB-02-AT-15 re-run.
- `@infrabyx/testing`: OpenBao 2.7.1 test image.
- Open for the owner: OWNER-QUESTIONS #1, the field-envelope context (PL2-D-49).

## PL2 session 2 (2026-10-26)

- `@infrabyx/connectors` (first release at gate A, 0.1.0):
  - Router: data class raise-only, residency and recipient checks before any I/O; per-adapter circuit breaker (PL2-D-33); mode-aware failover with STORAGE writes failing fast; `AdapterFailedOver` and `AdapterRecovered` events; spans `port.<PORT>.<method>`.
  - Idempotency store: pending record first, vendor lookup, and a money call is never re-sent blind. It writes through `kernel.mutate` with ledger entries and seals results at CONFIDENTIAL and above (PL2-D-35).
  - Also: health registry (@IPB-01-AT-13), HTTPS egress client, inbound-webhook helpers.
  - Migration `connectors/0001_init.sql` (`idempotency_record`, forced RLS). `infrabyx-migrate` applies it whenever the package is installed, so products keep one migrate command (PL2-D-34; tenancy minor).
  - OBSERVABILITY `otel`: IPB-02-23 scrubber, C-21 hashed IDs, GenAI spans without content, and the `collector` and `otlp-direct` profiles proven identical against a Collector (PL2-D-38).
  - FEATURE_FLAG `unleash`: registry sync, governed boolean writes, and staleness-bounded freshness, so FlagService falls back to the snapshot and then the safe state (@IPB-02-AT-20 against Unleash). The `config-db` alternative wraps the PL1 provider (PL2-D-39).
  - `test:contract -- --port <PORT>` runs the port-contract legs (PL2-D-40).
- `@infrabyx/crypto`: `telemetryIdHasher` / `deriveSubKey` (C-21 HKDF label `ipb/telemetry-id/v1`, PL2-D-36).
- `@infrabyx/testing`: OTel Collector 0.162.0 and Unleash 8.2.0 test images; `startService` `files` and `configure`.
- OpenTelemetry pinned to the 6 October release set because of the 7-day rule (PL2-D-37).
- PL2-D-07 answered: version PR #14 was opened with `NPM_PUBLISH_TOKEN`, and its `ci` and `port-contract` runs started on their own and passed. The organisation setting "Allow GitHub Actions to create and approve pull requests" is therefore **not needed** for the release flow; it matters only when `GITHUB_TOKEN` opens the PR. The owner may switch it off. #14 stays open until gate A (PL2-D-31).

## PL2 session 1 (2026-10-26)

- Spike on every `[VERIFY]` item: Temporal, BullMQ and Cerbos SDKs work on Node 24.22.1; Valkey works; pg-boss works through a transaction pooler (explicit job ids, PL2-D-28); moto signs KMS `DIGEST` wrongly, so KMS uses LocalStack 4.12.0, and SES needs a small stub (PL2-D-29); Zitadel v4.20.0 has ES256 web keys, token exchange and SCIM Users; AWS KMS ML-DSA in ap-south-1 is unconfirmed and stays `planned`.
- `@infrabyx/contracts`: the thirteen PL2 port interfaces, payload data-class annotations (raise-only, PL2-D-03), delivery recipients (IPB-DEV-05), P-04 paise conversion, `checkRouting`, connector manifest schema (P-18).
- `@infrabyx/config`: 53 new port keys (156 in total), `loadRoutingFile`, `infrabyx-routing check`, reference `local` and `ci` routing files, `sandbox-status.json`.
- `@infrabyx/testing`: leg- and capability-aware contract suites, pinned `TEST_IMAGES`, the sandbox-leg gate, fault-injection proxy, ESLint `ipb/port-data-class`.
- CI: `port-contract.yml` (per-port path filters, nightly, before each release) and `routing-check` in `verify`.
- Supply chain (PL2-D-32, tightens IPB-02-33 to 7 days): pnpm `minimumReleaseAge` 7 days (`@infrabyx/*` exempt), `trustPolicy: no-downgrade`, `blockExoticSubdeps`; Renovate 7 days; lefthook pinned to 2.2.1 (npm provenance); too-new pins moved back (turbo 2.11.9, typescript-eslint 8.71.2, four transitive packages).

## CI minutes (PL2-D-13)

Since 27 Oct 2026 this repository is public and its Actions minutes are free (PL2-D-62); the budget rules now bind the six private product repositories. The table below is kept as history and is no longer updated. Before that: 2,000 a month on GitHub Free, shared by seven repositories, with a 1,000-minute budget here (PL2-D-41).

| Month   | Run                                                         | Minutes (billed, approx.) | Month to date |
| ------- | ----------------------------------------------------------- | ------------------------- | ------------- |
| 2026-10 | used before PL2 (owner, 26 Oct)                             | 88                        | 88            |
| 2026-10 | PR #12, 4 pushes × (verify 3 + integration 2)               | 20                        | 108           |
| 2026-10 | PR #13, 3 pushes × (ci 5 + port-contract 1)                 | 18                        | 126           |
| 2026-10 | main after #13 (ci 5, release 2)                            | 7                         | 133           |
| 2026-10 | version PR #14 (ci 5, port-contract 1)                      | 6                         | 139           |
| 2026-10 | PR #15 (ci 5, port-contract 2 legs 4)                       | 9                         | 148           |
| 2026-10 | main after #15 (ci 5, release 2)                            | 7                         | 155           |
| 2026-10 | PR #16 (ci 5, port-contract 2 legs 4)                       | 9                         | 164           |
| 2026-10 | main after #16 (ci 5, release 2)                            | 7                         | 171           |
| 2026-10 | PR #17, 2 pushes (ci 5, port-contract 4 legs ~10), estimate | 30                        | 201           |
| 2026-10 | main after #17 (ci 5, release 2)                            | 7                         | 208           |
| 2026-10 | PR #18 (ci 5, port-contract KMS ~3), estimate               | 8                         | 216           |
| 2026-10 | main after #18 (ci 5, release 2)                            | 7                         | 223           |
| 2026-10 | PR #19, 4 pushes (ci 6, port-contract 6 legs ~16), estimate | 88                        | 311           |
| 2026-10 | main after #19 (ci 5, release 2)                            | 7                         | 318           |
| 2026-10 | PR #20, 2 pushes (ci 6, port-contract 9 legs ~20), estimate | 52                        | 370           |
| 2026-10 | main after #20 (ci 5, release 2)                            | 7                         | 377           |
| 2026-10 | PR #21, 2 pushes (ci 6, port-contract 9 legs ~22), estimate | 56                        | 433           |
| 2026-10 | main after #21 (ci 5, release 2)                            | 7                         | 440           |

## Owner decisions

- 2026-10-26: owner decisions OWN-01…14 recorded in `docs/DECISIONS.md`.

## Blocked / waiting on owner

- Owner accounts for PL2 sandbox legs: none blocks the PL2 publish (IPB-DEV-04). Latest-by dates and steps in `docs/runbooks/README.md`: GitHub Team and the `sandbox` environment, Temporal Cloud (Mumbai), messaging vendors and DLT, Razorpay and Cashfree test accounts, the AWS Organization and sandbox account.
- Before production: replace `NPM_PUBLISH_TOKEN` in `release.yml` with a dedicated GitHub App token (PL1-D-21, IPB-02-08).
- Platform requests PR-002 to PR-014 open for the IPB editor (`docs/platform-requests.md`).
- `main` ruleset: apply after the GitHub Team upgrade with checks, signed commits and linear history only (PL2-D-12, `infra/policy/github/rulesets.json`).
