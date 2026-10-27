# PL4 gate — publish report

**Date:** 2026-10-27 · **Checked against:** `main` at `9af583a` (after #75) plus this PR (REF-EXPORT-1.2) · **Checklist:** `docs/phases/PL4-plan.md` §15 (acceptance tests and exit gate) · **Split gate:** IPB-DEV-04 (gate B per SaaS adapter)

The gate closes PL4 and publishes the first 0.x releases of `@infrabyx/ai` and `@infrabyx/vidhi`, with minor releases of the packages they build on. No model provider was called in PL4. Each adapter stays `unproven` until a sandbox leg with an owner-approved paid run (O-6) goes green; gate B is per adapter and comes later (§3).

## 1. Result

Every item passes or does not apply. Two items depend on deferred owner decisions, and both are named below: live evals need a paid run (#35), and the self-hosted host waits for a product that needs one (#65).

| #   | Exit-gate item (plan §15)                                                                                                          | Result   | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --- | ---------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | All IPB-09 required checks green, including `ai-eval-gate`, `ai-prompt-lint` and the pgvector integration job                      | **pass** | Every PL4 PR, most recently #72–#75, merged with every required check green. `verify (24.22.1)` runs lint, typecheck, unit, ipb-check, migration-lint, notify-lint, **ai-prompt-lint**, **ai-eval-gate**, export-map-gate and the changeset and checklist checks. `integration` runs on `pgvector/pgvector:0.8.1-pg18`: migrate, rls-lint, golden-archive-diff, `test:int` and at-report. `consumer-smoke` and the `port-contract` matrix also ran: 19 ports on #72 and #74, including LLM, EMBEDDING and IMAGE_GEN |
| 2   | LLM, EMBEDDING and IMAGE_GEN hermetic legs green; every adapter `unproven` with a port-contract issue; no sandbox leg runs         | **pass** | `contract (LLM)`, `contract (EMBEDDING)` and `contract (IMAGE_GEN)` are green on #74. `packages/connectors/sandbox-status.json` lists `bedrock-claude-in` #63, `gemini-vertex-asia-south1` #64, `self-hosted-vllm` #65, `gemini-imagen` #69 and `flux-self-hosted` #70, all `unproven`. No sandbox leg ran (O-6)                                                                                                                                                                                                    |
| 3   | The §15 tests present by tag, passing, and listed by `at-report`                                                                   | **pass** | §4. `at-report` counts **58 of 272** spec ATs (46 at the PL3 gate)                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 4   | `ai` and `vidhi` migrations pass migration-lint and rls-lint; `infrabyx-migrate` applies them on a fresh pgvector PostgreSQL 18    | **pass** | `ai/0001`–`0004` and `vidhi/0001`–`0004`, all expand-only, with checksums recorded. migration-lint finds 0 problems. `infrabyx-migrate` applies all 23 platform migrations to a fresh database, and `rls-lint` is clean                                                                                                                                                                                                                                                                                             |
| 5   | Threat model updated: gateway, every AI adapter, retrieval, MCP, the scheduler reader, the image flow, content egress to providers | **pass** | `docs/security/threat-model.md` §3.19–§3.25 and the §4 port rows for LLM, EMBEDDING and IMAGE_GEN                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 6   | Changesets: `ai` and `vidhi` 0.1.0; minors for the §2 packages; an `export_map` line for the map bump                              | **pass** | §6. This PR adds `export_map: REF-EXPORT-1.2` (export minor)                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 7   | STATUS, DECISIONS, OWNER-QUESTIONS and platform-requests updated; this report                                                      | **pass** | PL4-D-01 to PL4-D-12 and PL4-C-01 are in `docs/DECISIONS.md`. Owner questions #26–#33 are answered; #34–#40 are open with defaults in use, and nothing is blocked. `platform-requests.md` carries PR-021 to PR-024                                                                                                                                                                                                                                                                                                  |
| 8   | Published through the version PR and `release.yml`                                                                                 | see §6   | Version PR #61 is updated by `release.yml` after this PR merges; it is merged once green                                                                                                                                                                                                                                                                                                                                                                                                                            |

Also checked:

- **No paid model call.** Every eval and guardrail test runs on the scripted fake model (`ai-eval-gate`, 7 prompt sets: `ai.extract_fields` 36, `ai.grounded_answer` 110, `ai.summarise` 36, `vidhi.mission_plan` 41, `vidhi.notebook` 108, `vidhi.persona` 110, `vidhi.plain_language` 110; all at 1.0). `eval --live` refuses to start without `--approved-by`.
- **Content capture is off by construction** (A-08): run rows hold metadata only, and source, chunk, output, correction and approval-payload text is sealed with FieldCrypto.
- **Owner answers #26–#33 and #65** applied (PL4-D-05, PL4-C-01).

## 2. What PL4 built

| Package                                                         | Content                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Sessions |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| `@infrabyx/ai` 0.1.0 (new)                                      | Model registry and routing that fails closed by data class and residency; kill switches; caps and metering; `aiTrace`; the scrubber (PAN, Aadhaar including the masked form, mobile, e-mail, UPI, bank account with IFSC, card, voter ID, passport, driving licence and more); input and output guardrails; structured output; prompt files and evals (`infrabyx-ai`); embeddings and tenant-scoped hybrid retrieval with RLS and a class ceiling; run retention (180 days, held runs kept); IMAGE_GEN with labelling and the publish approval; the SPEECH and RERANK interfaces; `usageSummary` | 1–5, 8a  |
| `@infrabyx/vidhi` 0.1.0 (new)                                   | Skills, the frozen locked list, product ceilings, autonomy with R4 promotion and automatic demotion, tasks with approvals, persona and reserved advice, schedules (RRULE subset, re-check, skip and pause), missions with budgets, the MCP server and client (2026-07-28), knowledge notebooks, feedback, QA sampling, the daily digest, and disclosure                                                                                                                                                                                                                                          | 6–8a     |
| `@infrabyx/connectors`                                          | LLM and EMBEDDING adapters `bedrock_claude_in`, `gemini_vertex_asia_south1` and `self_hosted_vllm`; IMAGE_GEN adapters `gemini_imagen` and `flux_self_hosted`; the shared Google token provider (C-24)                                                                                                                                                                                                                                                                                                                                                                                           | 3, 5     |
| `@infrabyx/export`                                              | `REF-EXPORT-1.2`: `ai_runs` and `vidhi_actions`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | 8b       |
| `contracts`, `config`, `crypto`, `tenancy`, `notify`, `testing` | Ports, events, error codes and roles; 232 settings keys; C-24 scopes; `memberStatus`; the Vidhi notification classes; fakes, stubs, corpora and the pgvector image                                                                                                                                                                                                                                                                                                                                                                                                                               | 1–8      |

## 3. Proven and unproven adapters

- **Proven by the hermetic legs** (stubs and local fakes, no vendor): every request shape, region check, error mapping and the token exchange of the five AI adapters.
- **Unproven until their sandbox legs** (staging and above refuse them, IPB-DEV-04): `bedrock_claude_in` #63, `gemini_vertex_asia_south1` #64, `self_hosted_vllm` #65, `gemini_imagen` #69, `flux_self_hosted` #70, plus the PL2 and PL3 SaaS adapters. Vendor facts are marked [VERIFY] in the adapters.
- **Owner tasks before staging:**
  - AWS Bedrock model access in ap-south-1;
  - a Vertex AI asia-south1 project with zero data retention and an identity (#27);
  - the owner's approval of each paid sandbox run and of the first live eval (#35);
  - no self-hosted inference host until a product needs one (#65).

## 4. Acceptance tests (plan §15)

Tagged and passing:

- `@IPB-03-AT-01`: injection through `FakeLlm` with a forged tool call;
- `@IPB-03-AT-02`: the routing table and the fail-closed chaos test;
- `@IPB-03-AT-03`: a demoted schedule owner leads to skips and then a pause;
- `@IPB-03-AT-04`: a locked action needs a human, and an agent's attempt demotes the skill;
- `@IPB-03-AT-05`: zero cross-tenant retrieval;
- `@IPB-03-AT-06`: the label with run id and the provenance sidecar (platform side);
- `@IPB-03-AT-07`: promotion without evidence;
- `@IPB-03-AT-08`: kill-switch propagation, with a checker for deactivation;
- `@IPB-03-AT-09`: reserved advice is routed;
- `@IPB-03-AT-10`: image labelling and the publish gate (platform side);
- `@IPB-03-AT-11`: a display-name override keeps the kernel id;
- `@IPB-03-AT-13`: the task lifecycle edge cases;
- `@IPB-01-15`: the LLM, EMBEDDING and IMAGE_GEN contract suites;
- `@NN-01`, `@NN-02`, `@NN-45` with the `ai` and `vidhi` schemas;
- `@IPB-09-AT-14` and `-AT-15` on `REF-EXPORT-1.2`;
- the content-capture log scan and the PII golden corpus.

Deferred, as the plan says:

- `@IPB-03-AT-12`, with the audio overviews (#32);
- DOCX and PDF placement for `@IPB-03-AT-06` and the CMS side of `@IPB-03-AT-10`, to docgen and PL5 `cms`;
- the Vidhi UI components and the screen-reader script for IPB-03-86, to PL5 `ui`;
- calendar, workspace, WhatsApp, e-mail and voice surfaces, until a product needs them (#31).

## 5. What each product must change to adopt this release

Applies to Udofin, Finbyx, LawDocs, LawDocsComply, Equator and Operations Hub.

**Package versions.** Move every `@infrabyx/*` dependency together to the versions in §6. Add `@infrabyx/ai` and `@infrabyx/vidhi` if the product uses AI.

**Database.** PostgreSQL 18 with the `vector` extension (pgvector 0.8.1) is needed for `ai/0003_retrieval.sql`.

**Migrations,** through `infrabyx-migrate`. The order is tenancy → audit → config → seed → connectors → rules → workflow → notify → export → ai → vidhi.

- `ai/0001_init.sql`, `0002_run_retention.sql` (the `svc_ai_run_sweep` reader), `0003_retrieval.sql` and `0004_image.sql`.
- `vidhi/0001_init.sql`, `0002_missions_schedules.sql` (the `svc_vidhi_sched` reader), `0003_notebooks.sql` and `0004_feedback_qa_digest.sql`.

Reader roles are granted to `app_rw` and `app_ro`. Run `infrabyx-rls-lint` afterwards.

**Settings** (232 keys in the registry): every `ai.*` and `vidhi.*` key of IPB-03 §03.5, plus `trust.privacy.cross_border_ai_allowed` (default false) and the token caps.

- Kill switches turn on at once; turning one off needs an R2 checker.
- `ai.obs.capture_content` is locked off.
- `ai.mcp.server_enabled` is off by default.

**Secrets** (through SECRETS, never environment variables in production):

- Bedrock access through the role's identity, with no stored keys;
- the Vertex service-account key (C-24) or a workload-identity token;
- the vLLM and FLUX endpoint tokens when a host exists;
- the KMS keys that FieldCrypto already uses.

**Code.**

- **ai:**
  - Build `ModelRegistry`, `PromptRegistry`, `KillSwitches` and `LlmGateway` with the connectors adapters.
  - Sync platform prompts with `infrabyx-ai prompts sync --set packages/ai/prompts:packages/ai/evals --set packages/vidhi/persona:packages/vidhi/evals`, using the paths under `node_modules`. In staging and above, prompts stay DRAFT until a live eval is approved (#35).
  - Run `RunRetention.sweep` daily from one worker.
  - Pass `hold` for runs tied to approvals or statutory outputs.
  - Use `RetrievalService` with your `authorize` callback.
  - Call `ImageService.assertPublishable` before a CMS publishes.
- **vidhi:**
  - Ship skill manifests and load them with `SkillRegistry.load`.
  - Build `Autonomy` and `TaskRuntime` with the approvals engine (with FieldCrypto) and your tool handlers, and run `sweepKilled`.
  - Pass your contacts to `Vidhi`, and override the hand-off text after counsel review (#33).
  - Call `Scheduler.tick` once a minute and `onEvent` from your inbox consumer.
  - Run `Missions.advance` from the QUEUE.
  - Mount `McpServer.handle` on `/mcp` after `checkMcpHeaders` and OAuth, and give `McpClient` your egress fetch.
  - Give `Notebooks` FieldCrypto, the gateway and the approvals engine.
  - Call `QaSampler.maybeSample` when a task finishes.
  - Send `Digest.send` daily.
  - Attach `disclose()` to every AI artefact.
- **export:** `REF-EXPORT-1.2` now emits `ai_runs` and `vidhi_actions`. Product maps add the same entities when they adopt `ai` and `vidhi`, with a minor bump of the product map.

## 6. Release

`pnpm changeset status` on this PR's head (the versions version PR #61 will carry):

| Package                | From  | To                           |
| ---------------------- | ----- | ---------------------------- |
| `@infrabyx/contracts`  | 0.3.0 | **0.4.0**                    |
| `@infrabyx/crypto`     | 0.3.0 | **0.4.0**                    |
| `@infrabyx/config`     | 0.3.0 | **0.4.0**                    |
| `@infrabyx/tenancy`    | 0.3.0 | **0.4.0**                    |
| `@infrabyx/testing`    | 0.3.0 | **0.4.0** (dev)              |
| `@infrabyx/connectors` | 0.2.0 | **0.3.0**                    |
| `@infrabyx/notify`     | 0.1.0 | **0.2.0**                    |
| `@infrabyx/export`     | 0.1.0 | **0.2.0** (REF-EXPORT-1.2)   |
| `@infrabyx/audit`      | 0.1.2 | **0.1.3** (dependency patch) |
| `@infrabyx/seed`       | 0.2.1 | **0.2.2** (dependency patch) |
| `@infrabyx/rules`      | 0.1.0 | **0.1.1** (dependency patch) |
| `@infrabyx/workflow`   | 0.1.0 | **0.1.1** (dependency patch) |
| `@infrabyx/ai`         | —     | **0.1.0** (new)              |
| `@infrabyx/vidhi`      | —     | **0.1.0** (new)              |

The later-phase scaffolds stay private until their phase (PL1-D-20). Version PR #61 is merged under the standing authority (PL2-D-19) once its CI is green. `release.yml` then re-runs the full `port-contract` matrix and `consumer-smoke`, publishes to GitHub Packages, pushes one tag per package and prints the registry checksums in its job summary.

**Published.** Version PR #61 was merged as `25771c8` after all 24 checks went green on its head `3037f84` (based on `main` with #76). `release.yml` run 56 (id 40489202908) then:

- re-ran the full `port-contract` matrix: 19 of 19 ports green, including LLM, EMBEDDING and IMAGE_GEN;
- published the 14 packages above to GitHub Packages (no package skipped, no publish error);
- pushed one tag per package (`@infrabyx/<name>@<version>`);
- printed the registry's `dist.shasum` and `dist.integrity` for each version in the job summary of its `release` job (job id 122139655138), through `scripts/registry-dist.mjs`.

**Registry checksums:** owner task — copy them from that job summary into this section and into STATUS, as at the PL3 gate (this session cannot read job summaries or the private registry).
