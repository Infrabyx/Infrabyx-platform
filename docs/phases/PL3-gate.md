# PL3 gate — publish report

**Date:** 2026-10-27 · **Checked against:** `main` at `50093e9` (after #57) and version PR #47 · **Checklist:** `docs/phases/PL3-plan.md` §12 (exit gate and acceptance tests) · **Split gate:** IPB-DEV-04 (gate B per SaaS adapter)

The gate closes PL3 and publishes the 0.x pre-releases of `rules`, `workflow`, `notify` and `export`, with minor releases of the packages they build on. Gate B is per adapter: it needs a vendor test account and comes later (§3).

## 1. Result

Every item passes or does not apply. One gate fix was needed: version PR #47 failed `export-map-gate` (IPB-ENG-006), because the gate counted any file under `packages/export/` as an export change, including the version bump in `package.json` and `CHANGELOG.md`. The gate PR #58 narrows the trigger to the package's source, maps, verifier and migrations (tests, the golden fixture, the README, the changelog and `package.json` no longer trigger it), with a test that replays the version PR's file list. The export checks and the ESIGN port-contract issues were otherwise built into sessions 5 and 6.

| #   | Exit-gate item (plan §12)                                                                                               | Result   | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --- | ----------------------------------------------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | All IPB-09 required checks green, including `export-map-gate` and `golden-archive-diff`                                 | **pass** | #53, #54 and #57 merged with every check green (#57: `ci` run 40459944467 and `port-contract` run 40459944491, 21 of 21 check runs): `verify (24.22.1)` (lint, typecheck, unit, policy rules, licence, `ipb-check`, migration-lint, registry, routing, notify-lint, dev keys, env example, changeset, PR checklist, **export-map-gate**), `integration` (PostgreSQL 18: migrate, rls-lint, **golden-archive-diff**, `test:int`, at-report), `consumer-smoke`, and the `port-contract` matrix. Version PR #47: see §6 |
| 2   | RULES, PUSH and ESIGN hermetic legs green; each SaaS adapter without a sandbox account has an issue                     | **pass** | `contract (RULES)`, `contract (PUSH)` and `contract (ESIGN)` green on #57 (`port-contract` run 40459944491, §2); `release.yml` run 41 on `main` re-runs the full matrix. `expo` #50, `fcm` #51, `leegality` #55 and `digio` #56 are `unproven` in `sandbox-status.json`, each with its issue                                                                                                                                                                                                                         |
| 3   | Acceptance tests present by tag and passing; `at-report` lists them                                                     | **pass** | §4. Every §12 ID has a tagged, passing test; `at-report` counts 46 of 272 spec ATs (39 at PL2 gate A)                                                                                                                                                                                                                                                                                                                                                                                                                |
| 4   | Migrations `tenancy/0002`, `rules/0001`, `workflow/0001`, `notify/0001`, `export/0001` pass migration-lint and rls-lint | **pass** | Also `workflow/0002` and `notify/0002` (owner answers #21 and #22). migration-lint: 0 findings except two `drop-requires-contract-label` warnings for the widened timer CHECKs in `workflow/0002` (a wider CHECK accepts every row; PL3-D-21). `infrabyx-migrate` applies all 14 files on a fresh PostgreSQL 18 database; `rls-lint` clean                                                                                                                                                                           |
| 5   | Threat model updated (four packages, PUSH and ESIGN adapters, the export data flow, the suppression hash)               | **pass** | `docs/security/threat-model.md` §3.13–§3.18 (rules, workflow, notify and PUSH, cross-tenant service readers, export and C-22, ESIGN and C-25) and the §4 port rows; R3-05 and R3-06 in the plan                                                                                                                                                                                                                                                                                                                      |
| 6   | Changesets: four packages at 0.1.0 (publishable); minors for contracts, config, testing, connectors, tenancy            | **pass** | `rules`, `workflow`, `notify`, `export` have `"private": false` and a first `minor` changeset (0.0.0 → 0.1.0); `contracts`, `crypto`, `config`, `testing`, `connectors`, `tenancy` minor (§6)                                                                                                                                                                                                                                                                                                                        |
| 7   | STATUS, DECISIONS, OWNER-QUESTIONS and platform-requests updated; this report                                           | **pass** | PL3-D-01 to PL3-D-23 and PL3-C-01/02 in `docs/DECISIONS.md`; owner questions #7–#23 answered, #24 and #25 open with defaults (nothing blocked); `platform-requests.md` carries PR-017 to PR-019 from PL3                                                                                                                                                                                                                                                                                                             |
| 8   | Published through the version PR and `release.yml`                                                                      | see §6   | Version PR #47 merged once green; `release.yml` publishes and tags                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

Also checked:

- **`consumer-smoke`**: 12 packages packed, installed with plain npm in a clean directory and every JavaScript export imported with plain Node 24.22.1: 70 exports, 0 failed (4 non-JavaScript exports skipped). It also runs in `ci.yml` and before every publish.
- **Owner answers #21–#23** applied in #53 (PL3-D-21): the UNDETERMINED review assignee and the 48-hour escalation; dedicated `SVC_` cross-tenant readers instead of `PLT_AUDITOR_RO`; the NOTIFY collection contact window.

## 2. Hermetic legs (PL3 ports)

| Port  | Reference → alternative                  | Hermetic leg runs on                                                                | Tests |
| ----- | ---------------------------------------- | ----------------------------------------------------------------------------------- | ----- |
| RULES | `zen` → `json-rules` (+ memory CEL walk) | in process; a differential test across the three engines                            | 24    |
| PUSH  | `expo` → `fcm`                           | Expo push API v2 stub; FCM HTTP v1 stub with Google's token endpoint (C-24 checked) | 16    |
| ESIGN | `leegality` → `digio`                    | Leegality and Digio stubs (the Leegality `mac` made with openssl, checked by C-25)  | 24    |

The thirteen PL2 ports ran unchanged in the same matrix (the PR touched shared paths, so every port ran).

## 3. Proven and unproven adapters

- **Proven by the hermetic legs** (in-process, no vendor): `zen`, `json-rules`.
- **Unproven until their sandbox legs** (staging and above refuse them, IPB-DEV-04): `expo` (#50), `fcm` (#51), `leegality` (#55), `digio` (#56), plus the twelve PL2 SaaS adapters (#28–#39). Vendor facts for these are marked [VERIFY] in the adapters.
- **Owner tasks before staging:** Expo and Firebase accounts (PL3-D-11); Leegality and Digio sandbox accounts with one Leegality workflow per signing method (PL3-D-04); the GitHub `sandbox` environment (PL2-D-12).

## 4. Acceptance tests (plan §12)

Tagged and passing:

- `@IPB-07-AT-06`, `-AT-07`, `-AT-09`, `-AT-10` (backend), `-AT-11`, `-AT-22`;
- `@IPB-02-AT-10`, `-AT-11`, `-AT-12` (through the workflow wrappers and timers), `@IPB-02-AT-20` (pattern, `kill.msg.*`);
- `@IPB-09-AT-14` (export map gate), `@IPB-09-AT-15` (golden archive, scenario (a)), `@IPB-09-37` (download hash);
- `@IPB-01-15` (RULES, PUSH, ESIGN contract suites), `-16`, `-17`, `-18`, `@IPB-01-AT-04`, `-AT-13`, `-AT-19`;
- `@IPB-10-27` (push and ESIGN webhooks; delivery reports into NOTIFY);
- `@NN-01`, `@NN-02`, `@NN-45` with the new schemas;
- PL3-specific: `@PL3-NTF-RESEND`, `-SUPPRESSION`, `-CONSENT`, `-NEVER-WHATSAPP`, `-CONTACT-WINDOW`, the push payload guard (`IPB-NTF-006`), `@PL3-RULES-REVIEW`, `@PL3-RULES-ESCALATE`, `@PL3-SVC-READER`.

Deferred, as the plan says:

- `@IPB-09-AT-15` scenario (b), folder deletion: a product test (IPB-09-36 is PRODUCT); the platform proves that `views` never bump and never enter an archive;
- the Work Inbox, Approvals and preference screens: PL5 (`ui`);
- `awaitApproval` with Vidhi: PL4.

## 5. What each product must change to adopt this release

Applies to Udofin, Finbyx, LawDocs, LawDocsComply, Equator and Operations Hub.

**Package versions.** Move every `@infrabyx/*` dependency together to the versions in §6, and add the four new packages as needed.

**Migrations, through `infrabyx-migrate`** (no new command; tenancy → audit → config → seed → connectors → rules → workflow → notify → export):

- `tenancy/0002_approvals_pl3.sql`: approval expiry, reminder and escalation;
- `rules/0001_init.sql`;
- `workflow/0001_init.sql` and `workflow/0002_owner_answers_pl3.sql` (inbox escalation and the `svc_scheduler` reader role);
- `notify/0001_init.sql` and `notify/0002_service_readers.sql` (`svc_notify_dispatch`, `svc_notify_unsubscribe`);
- `export/0001_init.sql`.

The reader roles are granted to `app_rw` and `app_ro`, so login users that hold those roles need nothing new. Run `infrabyx-rls-lint` afterwards.

**Settings** (178 keys in the registry): `rules.*`, `workflow.timers.engine`, `int.push.*`, `int.notify.dedupe_window_h`, `int.esign.provider`, `int.esign.expire_in_days`, `eng.export.*`, the tighten-only `mc.*` keys, and the `kill.msg.<channel>` flags.

**Secrets** (through SECRETS, never environment variables in production): the C-23 group consent key; the platform export-signing key id (KMS, ES256, C-22); the FCM service-account key (C-24) or a workload-identity token; the Expo access token; the Leegality auth token and private salt; the Digio client id and secret; a C-19 URL token for the Digio callback.

**Code.**

- **workflow:** build the engine with `createWorkflow` instead of `new ApprovalsEngine`; run `timers.start()` in one worker; pass `notifyApprovalNotifier(...)` as `notifier` (it now also sends `inbox.escalated`); register money actions with `financial: true`; pass `engineRefundApprovals` to PAYMENTS.
- **rules:** construct `RulesService` with the `HumanQueue` (the workflow `InboxService`) and FieldCrypto. UNDETERMINED tasks go to `ORG_CHECKER`, or `ORG_ADMIN` when the tenant has none.
- **notify:** ship the catalogue files and lint them (`infrabyx-notify-lint`); supply a `ContactResolver`, a `timezone` hook (default Asia/Kolkata) and optionally a narrower `contactWindow` for collection classes; run `dispatchDue` in a worker; wire PUSH with `PgPushTokenStore`; hand verified delivery events to `handle*`. Products apply inbound `MarketingConsentUpdated` themselves until PR-018.
- **export:** ship a `<PRODUCT>-EXPORT-1.0` map; build `ExportService` with STORAGE, `kmsArchiveSigner(kms, keyId)`, the pseudonym key and an `ecosystemEvent` builder; run `run(tenantId, jobId)` from a QUEUE worker; add `infrabyx-export map-gate` and a golden archive of the demo tenant to CI.
- **ESIGN:** wire `LeegalityEsign` (one workflow `profileId` per signing method) or `DigioEsign` (callback URL with `ipb_token`) with STORAGE and a persisted `EsignEnvelopeStore`; act only on the status `handleWebhook` returns.
- **Cross-tenant workers** use the `SVC_` service readers (`ServiceReader`); never `PLT_AUDITOR_RO`.

## 6. Release

`pnpm changeset status` on `main` at `50093e9` (the versions version PR #47 carries):

| Package                | From  | To                           |
| ---------------------- | ----- | ---------------------------- |
| `@infrabyx/contracts`  | 0.2.0 | **0.3.0**                    |
| `@infrabyx/crypto`     | 0.2.0 | **0.3.0**                    |
| `@infrabyx/config`     | 0.2.0 | **0.3.0**                    |
| `@infrabyx/tenancy`    | 0.2.0 | **0.3.0**                    |
| `@infrabyx/testing`    | 0.2.0 | **0.3.0** (dev)              |
| `@infrabyx/connectors` | 0.1.1 | **0.2.0**                    |
| `@infrabyx/audit`      | 0.1.1 | **0.1.2** (dependency patch) |
| `@infrabyx/seed`       | 0.2.0 | **0.2.1** (dependency patch) |
| `@infrabyx/rules`      | —     | **0.1.0** (new)              |
| `@infrabyx/workflow`   | —     | **0.1.0** (new)              |
| `@infrabyx/notify`     | —     | **0.1.0** (new)              |
| `@infrabyx/export`     | —     | **0.1.0** (new)              |

The 10 later-phase scaffolds stay private until their phase (PL1-D-20). Version PR #47 is merged under the standing authority (PL2-D-19) once its CI is green on the new `main`; `release.yml` then re-runs the full `port-contract` matrix and `consumer-smoke`, publishes to GitHub Packages and pushes one tag per package.
**Published.** Version PR #47 was merged as `4a9bbcb` after all 21 checks went green on its head `8779557`. `release.yml` run 43 (id 40461661687) then:

- re-ran the full `port-contract` matrix: 16 of 16 ports green, including RULES, PUSH and ESIGN;
- published the 12 packages above to GitHub Packages;
- pushed one tag per package (`@infrabyx/<name>@<version>`);
- printed the registry's `dist.shasum` and `dist.integrity` for each version in the job summary of its `release` job (job id 122048259420), through `scripts/registry-dist.mjs`.

No package was skipped and no publish error was logged.

**Registry checksums** (from the job summary of run 43's `release` job, copied by the owner on 2026-10-27; PL3-D-25). Compare with `npm view <name>@<version> dist`:

| Package                | Version   | shasum (SHA-1, registry)                   | integrity (SHA-512, registry)                                                                     |
| ---------------------- | --------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `@infrabyx/audit`      | 0.1.2     | `364123b412b85522cad9d9b3211675c5ca00260b` | `sha512-/VMuOREnBZ78kZBI0YuN8emafhY0W6XjrGYSUmPzWM/0xkF5aNZ/pbXB9BiR+0YVG4dnWWwgmbPM4Htaw4/O9Q==` |
| `@infrabyx/config`     | 0.3.0     | `450b7bd8a3c1fd7e3bfcbe53c0fdfc2ebd2393ef` | `sha512-7Y6tYhslhz1SFg3Sc6MP8/4XrKyPHWGvjSc34Q2PZ6r+VBc8wZu8OF4TO2B/oHDXOvHZN2dFTT+7E7zG5NcW/Q==` |
| `@infrabyx/connectors` | 0.2.0     | `64285ed7c9f5036d4eab31897905fec622d8b285` | `sha512-jZM2OSNeFL3fYX4QIt6NSlggpSPLjfLgVdC5OYlUXjvMgK0TFGoKu/mC8kDW+wNYtkO74srqXPr+6jAhvwTX6w==` |
| `@infrabyx/contracts`  | 0.3.0     | `30bb7dab8be0b9db5fe019c41d7d0f1eb93c37bd` | `sha512-Rm7yAo419irBdybHmEmfXApXyvvecOZw2Tt75x/WxiTxwPLNrngz+GOuO10+9yDu8QEjuuZ4+lw3ghHkmnB34Q==` |
| `@infrabyx/crypto`     | 0.3.0     | `01df029fa869e445f03ab632b42bc033e32fec60` | `sha512-rUoWByDScwU7gsygiR1l4kGhbnyhRaCPQ1oQPscJ7xd3rYc1KOs9Z53oKPrM7e4znoYt8tqL8JxF1tO93Bg1hA==` |
| `@infrabyx/export`     | 0.1.0 new | `67b6299f3ef983505a7c56e5227be445b098f69f` | `sha512-fAes+bVSSYe/Fo0MR1oWjzaPHWXcOYpJUwEJBarBBd9LvDNHN+5+zk/E/Xm1XVbXdeD7HIt8+f6NISVttFIwKQ==` |
| `@infrabyx/notify`     | 0.1.0 new | `4c94637bfcc726b7c35b4a91c039377877f2b456` | `sha512-Lt2i08iTk5OvakshrIojJnjKYFNCMJQq4s8ZUJfM1IikqnBCfT8K2YB1bAaQuB8jtfexSCYkM+dmJsV9Ul9mWg==` |
| `@infrabyx/rules`      | 0.1.0 new | `6a0905ad30bdebb28d0ab5ea82e78d83f324dc47` | `sha512-eElPyDYZiGfxefVcR6TEIlqhSoKM/XrMnyFJAQlzVu9+hiRQ2xEQuzqZQD66yP1CR+iXMpz+MWyoiFz4w2R+Kw==` |
| `@infrabyx/seed`       | 0.2.1     | `54e1248b0ff8fc07017ac1e77d91be44d0fc504a` | `sha512-Ru1UYpU8lgiedwhl5re0A9dbJfa1O2ACtmE99FzgcI3V2lP5UK6zC8HxroL3OBTgDXoP3YdfgH2+7JIHHMD15A==` |
| `@infrabyx/tenancy`    | 0.3.0     | `2b7e4494fb60977baf6a71c548e3ebe58e5c480c` | `sha512-+Vn5G88rzrhj3tIetpdgkEPMzADHP7hu95F4OZ/sTAL/5IsGPsMiKDJcD9CkPDiywdcyU5Plo5anHhuATyxTuA==` |
| `@infrabyx/testing`    | 0.3.0     | `d4cd60c9746127d3ed68144c292e7a04395097d8` | `sha512-t59wVAKPsBpsHnBTYfpKPYsM+netKaU984ar7I1yvbSywfj/3uvIA96YiYLbAAY9EkEAfRcmxRtpdLyWMylbWQ==` |
| `@infrabyx/workflow`   | 0.1.0 new | `b414eabbd1fe9bfedf7206fefe4b8043e559a1ae` | `sha512-C54zqmfXgLThjWQgywe/9tCMXdr09SkfbiFyE9kVkLFYqenT7WxeO+KtJaWVBX6Y24Gr8cjJBUAeDlIgI+Lvxw==` |
