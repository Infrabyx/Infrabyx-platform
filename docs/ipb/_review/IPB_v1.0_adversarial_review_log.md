# IPB v1.0 and Ecosystem Spec v1.2 — Adversarial Review Log (26 October 2026)

Reviewer: independent adversarial pass (Claude Code) over the 14 IPB files and `Infrabyx_Ecosystem_Integration_Spec_v1.2.md`. Method: scripted checks (ID uniqueness, table cell counts, code fences, heading hierarchy, cross-references, event-name registry diff, port and tier token census), then manual red-team of the controls and a logic walk of every state machine. Every fix is marked `*(rev. 26 Oct 2026)*` in the IPB files and `*(v1.2 rev. 26 Oct 2026)*` in the Spec. Unmodified originals are in the reviewer's scratch backup; nothing was deleted.

Severity: **H** = would mislead a coding agent into an insecure or broken build; **M** = contradiction or undefined behaviour the agent would have to guess; **L** = cosmetic or documentation.

## 1. Findings and actions

| # | File §/line | Finding | Sev | Action taken | Residual |
|---|---|---|---|---|---|
| 1 | IPB-01 §01.2, IPB-02 §02.2, IPB-03 §03.2, IPB-13 header; Spec §13.2 | Data-class taxonomy mismatch: IPB uses five handling tiers (PUBLIC/INTERNAL/CONFIDENTIAL/REGULATED/SECRET) and cites "Spec §5"; the Spec §13.2 uses ten wire classes (PII, SPI, FINANCIAL, LEGAL, HR, WELLNESS, CONSUMER_HELP …) and has no SECRET. §5 is the entity catalogue. | H | Mapping table added to IPB-02 §02.4.3.1 (each Spec class → exactly one tier); definitions in IPB-01/02/03/13 re-pointed to §13.2 and the mapping; Spec §13.2 gained the reciprocal paragraph and clarifies that `REGULATED` as a data class means the IPB tier (6.29 change class is unrelated). | None |
| 2 | IPB-01 L519, L1060; IPB-02 AT L676 vs IPB-03 §03.6 | Two codes for one error: `IPB-LLM-003` (IPB-01/02) and `IPB-AI-021` (IPB-03) both mean "no eligible model, failed closed"; `IPB-LLM` is not an area any file owns. | M | `IPB-LLM-003` replaced by `IPB-AI-021` everywhere; IPB-01 row now records the retirement; Spec 3.12 prefix table says `IPB-LLM` retired. | None |
| 3 | IPB-09-15 / §09.4.3 vs IPB-11 §11.2 + zod enum vs IPB-01 §01.2 | Three different environment lists (IPB-09: 8 names with `preview`, `pre-prod`; IPB-11: 7 names with `demo`, no `preview`/`pre-prod`; IPB-01: 7 names). A `pre-prod` or `preview` deployment would fail IPB-11's `APP_ENV` enum at boot. | H | Canonical nine-name list fixed in IPB-09-15 (binding) with a `demo` row in §09.4.3; IPB-11 definition, `APP_ENV` enum and `.env.example` updated; IPB-01 §01.2 aligned. | None |
| 4 | IPB-11-14, IPB-11-22 | Seed guard covered only `prod`/`dr`; `pre-prod` holds a production snapshot with REGULATED data and would accept `SEED_PROFILE`, mixing synthetic super-admin credentials into real data. | H | `pre-prod` added to both guards; "guard groups" sentence makes every prod/dr rule apply to pre-prod and every staging rule to pre-prod and demo. | None |
| 5 | IPB-02 §02.6.2, IPB-04 §04.6, IPB-06 §06.6, IPB-07 §07.6 | "Proposed Ecosystem events" tables still carried names the Spec §6.17 declares superseded and never emitted (`security.EvidenceCollected`, `security.VulnerabilityRecorded`, `consent.Recorded`, `ops.AccessibilityIssueOpened`, `trust.AccessibilityStatementPublished`, `ops.FeedbackItemCreated`); IPB-01 L468 used `billing.PaymentCaptured` (all `billing.Payment*` superseded). | M | Each replaced by the registered canonical name with the Spec section cited and the superseded name noted. Event-catalogue diff now clean (remaining hits are "registered unchanged" or the deliberate negative test in IPB-10 AT). | None |
| 6 | Spec §3.12 ports row | Capability-port list omitted eight IPB-01 §01.4.4.2 ports (`LLM`, `SPEECH`, `PAYMENTS`, `PAYOUTS`, `BILLING`, `CRM`, `GEO/MAPS`, `WORKSPACE`). | M | Added. IPB-01 catalogue is complete against every `*_PORT` used in IPB-02…13 (APP/MSG_SMTP/OBS_METRICS correctly flagged as TCP env vars). | None |
| 7 | Spec §3.12 prefix table | Shared-baseline problem-code prefixes listed 13 areas; IPB files use 33. | L | Full list added. | None |
| 8 | IPB-08 requirements and §08.5; IPB-07 §07.5 | Tier token `ORG` used where the brief's registry tiers are PLATFORM/BRAND/PLAN/TENANT/ENTITY/USER. IPB-07 defines `ORG` as a UI grouping (legend exists); IPB-08 had no legend. | M | IPB-08: 11 `ORG` cells → `TENANT`. IPB-07 §07.5: sentence binding `ORG` = registry tier TENANT (ENTITY where the key is entity-scoped) and `PLATFORM` = PLATFORM/BRAND/PLAN as recorded in `settings-tree.yaml`. | IPB-07 tree still displays ORG as a UI label (acceptable, documented) |
| 9 | IPB-03 §03.3 L157/L179; IPB-04 L555/L780; IPB-05 ×10; IPB-09-44; IPB-10-45, §10.4 ×2 | Settings paths did not match IPB-07's binding node names (`Settings › Vidhi`, `› Branding`, `› Legal & privacy`, `› Privacy`, `› AI`, `› Help`, `› Plan`, `› Engineering › Beta/Sandbox`, `› API`). IPB-05 instances are user-facing policy text. | M | All re-pointed: `AI & Vidhi`, `Customisation › Branding`, `Privacy & consents › Legal documents` / `› Nominee`, `Tutorials & help`, `Plans & subscription`, `What's new › Beta programme`, `Integrations › API keys` / `› Sandbox`. | None |
| 10 | IPB-01 L76, L313; IPB-06 L145, L249–264; IPB-07 L56, L327, L331, L364; IPB-08 L301; IPB-10 L78, L107; IPB-11 L74 | Unescaped `|` inside back-ticked enums broke 14 table rows (cell counts 5–8 against 4–6 headers). | L | Escaped as `\|`. Table scan now reports zero broken rows in all 15 files; no unclosed fences; no heading jumps. | None |
| 11 | IPB-03 §03.4.7 task state machine | Undefined transitions: QUEUED permission-check failure had no target; NEEDS_INPUT timeout only in a comment; no RUNNING/NEEDS_INPUT/NEEDS_APPROVAL → CANCELLED on kill switch; approval racing a cancel undefined. | M | Transitions added; terminal-state rule; `IPB-VID-022` for late/duplicate approval; `vidhi.task.input_timeout_h` key; scenario table (happy, failure, concurrency ×2, rollback); @IPB-03-AT-13. | None |
| 12 | IPB-03-70 vs IPB-03-85 vs @IPB-03-AT (L629) | Auto-demotion target contradictory: "demoted to L2" (AT), "one level" (03-85), unspecified (03-70); no cooldown, so a sponsor could re-promote immediately. | M | 03-70 now: locked-action/guardrail → L2; rate/QA breach → one level; evidence counters reset; `vidhi.autonomy.repromotion_cooldown_days` (30). | None |
| 13 | IPB-04 §04.4.3 content state machine | Missing: `legal_review → draft`, `scheduled → approved`, approval invalidation on edit, optimistic lock for the scheduler, `unpublish_at > publish_at`, rollback to a revision published under an older policy set. | M | Transition table, scenario table and @IPB-04-AT-101 added. | None |
| 14 | IPB-08 §08.4.3 vendor-document state machine | Missing: APPROVED → DRAFT on edit; publish of a stale APPROVED version after a newer one is PUBLISHED; EXPIRED extension; reinstatement after withdrawal; withdraw from REVIEW. | M | Five transition rows, scenario table, `IPB-TRUST-015`, @IPB-08-AT-19. | None |
| 15 | IPB-09 §09.4.5 | No explicit release (`rel_`) state machine: halt/resume ownership, second-halt rule, one-train-per-product, rollback ordering with a live `migrate` phase were implicit. | M | State machine, guard table, scenario table and @IPB-09-AT-24 added. | None |
| 16 | Spec §4.9 delegation state machine | Cross-over of `CANCEL` and `VidhiTaskCompleted` undefined; consent withdrawn mid-task had no rejection reason. | M | Terminal-state precedence row, `CONSENT_WITHDRAWN`, two scenarios. | None |
| 17 | Spec §6.32 eSign hand-off | Stamp verification failure had no exit (only DECLINED/EXPIRED/WITHDRAWN); sha256 mismatch at `POST` undefined. | M | WITHDRAWN with actor `SYSTEM`, reason `STAMP_VERIFICATION_FAILED`; `schema-validation-failed` at CREATED. | None |
| 18 | IPB-10 §10.3 (API keys) | Red-team GAP: nothing stopped an `ORG_MEMBER` creating a key with scopes above their own, or a key holding `approve`/`admin`; a demoted creator kept a wide key. | H | IPB-10-46 (subset at creation and at use; `approve`/`delete`/`admin` never on keys or MCP tools; maker-checker above `read`); `IPB-API-020/021`; @IPB-10-AT-26. | None |
| 19 | IPB-10-35 (MCP) | Red-team GAP: a locked human-approval action could be marked `x-mcp.write: true` and executed after a generic per-action confirmation outside the product UI. | H | Lint + runtime refusal (`IPB-MCP-005`); locked actions can only be prepared (L2) via MCP. | None |
| 20 | IPB-03-79 (notebooks) | Prompt injection via notebook source: IPB-03-34 covered uploads and web content generally; notebooks did not say so and did not fix autonomy. | L | Sources enter only as IPB-03-34 data blocks via `EGRESS_PORT`; notebook skills L1, no write tools. | None |
| 21 | IPB-01-06 | PG14 EOL date not in the research notes. | L | `[VERIFY]` tag added. | Owner to verify |
| 22 | IPB-01, -02, -09, -10 vs IPB-04, -05 vs IPB-06, -07 | Requirement-table "Tier" column has three semantics (owner PLATFORM/PRODUCT/TENANT; obligation M/S/O; P/U). Each file has its own legend, so no agent error, but cross-file filtering is impossible. | L | Not changed (would touch ~700 rows). | Open: IPB-OI candidate — add an `Obligation` column in v1.1 |
| 23 | IPB-06-05 | Role `PLT_ACCESSIBILITY_LEAD` is not in the brief's role list; defined inline as a specialisation of `PLT_RELEASE_MANAGER`. | L | Not changed; legitimate product tightening. | Record in role registry at build time |
| 24 | IPB-01 header | "Related" line pointed identity to Spec §2 and events to §3 only. | L | Re-pointed to §4, §3/§6, §13.2. | None |

## 2. Red-team results (controls checked)

| Attack | Result | Requirement and acceptance test |
|---|---|---|
| Tenant A reads tenant B's vendor document / acknowledgement | PASS | IPB-08-14, IPB-08-34 (RLS), `IPB-TRUST-001`; @IPB-08-AT-10 |
| Tenant A reads tenant B's blog draft or UGC submission | PASS | `cms` platform-scoped; `cms.user_post_submission` and `cms.comment` carry `tenant_id` + RLS (IPB-04 §04.4.1); IPB-02-12/13; @IPB-04-AT-05, AT-45, AT-93 |
| Tenant reads or edits another brand pack | PASS | Brand packs are platform objects; white-label `brand.*` keys are TENANT-tier (IPB-04 §04.5); Spec 5.4 host uniqueness; @IPB-04-AT-25 |
| Super admin publishes without checker | PASS | IPB-04-06, §04.4.3 rules; IPB-08-12, `IPB-TRUST-005`; @IPB-04-AT-03, @IPB-08-AT-02/12 |
| SVG logo with script | PASS | IPB-04-21 allow-list sanitiser, re-serialise, discard original; @IPB-04-AT-21 |
| SSRF via CMS embed or webhook URL | PASS | IPB-02-43 `safeFetch` (private ranges, redirects, schemes, ports), IPB-04 `EGRESS_PORT` embed, IPB-10-23; @IPB-04-AT-94, IPB-10 "Webhook SSRF guard" |
| Host-header brand spoof | PASS | IPB-04-29, IPB-02-17 (`Host` and `X-Forwarded-Host` validated at edge; unknown host → default pack + noindex); @IPB-04-AT-27 |
| Seed profile in production | PASS after fix | IPB-11-14/22 (+ `pre-prod`), `IPB-ENV-001`; @IPB-11-AT-01/02 |
| MCP write tool executes a locked action | GAP → fixed | IPB-10-35 + `IPB-MCP-005`; IPB-10-46 |
| Prompt injection via notebook source | PASS (strengthened) | IPB-03-34, IPB-03-79; @IPB-03-AT-01 |
| Scheduled Vidhi task after permission revoked | PASS | IPB-03-65 run-time re-check, `IPB-VID-020`; IPB-03 AT "Scheduled task after permission revoked" |
| Webhook replay | PASS | IPB-10-21 (timestamp > 5 min rejected; signature over id.timestamp.body), IPB-10-07 idempotency 24 h, IPB-10-27 inbound dedupe by vendor event ID; IPB-10 AT L626 |
| Pixel before consent | PASS | IPB-04-54, embed/media blocks, Analytics & Tags route lock; @IPB-04-AT-83/85/86 |
| API key scope escalation | GAP → fixed | IPB-10-46, `IPB-API-020/021`; @IPB-10-AT-26 |
| `.env` committed | PASS | IPB-11-08/09 (gitignore, lefthook block, gitleaks, push protection) |
| Migration dropping a column in the same release | PASS | IPB-09-28 `no-expand-contract-same-release`, RB-REL-05 |
| Export-map change altering customer download | PASS | IPB-09-34/35/37 (CI gate, golden-archive diff, hash stability) |
| Investors page with forward-looking claims | PASS | IPB-04-66 (locked disclaimer, legal review, E2+ evidence, `IPB-CMS-012` lint words); @IPB-04-AT-71 |

## 3. Mechanical checks (after fixes)

* Requirement, acceptance-test, open-item and error-code IDs: unique within every file; file-number prefixes match; new IDs continue each sequence (IPB-03-AT-13, IPB-04-AT-101, IPB-08-AT-19, IPB-09-AT-24, IPB-10-46 / AT-26, IPB-VID-022, IPB-TRUST-015, IPB-API-020/021, IPB-MCP-005).
* Markdown: 0 unclosed fences, 0 heading-level jumps, 0 table rows with wrong cell counts (15 files).
* Cross-references: 581 `nn.x.y` references resolved; 0 dangling (one false positive was an IP address).
* Event names: every `in.infrabyx.*` name in the IPB files is registered in Spec §6 or is the deliberate negative example in IPB-10 AT.
* Node pin: 24.22.1 everywhere; 26.12.1 only as the ADR path (IPB-01, IPB-12, Spec 3.12).
* Autonomy levels: L0–L4 definitions identical in IPB-03-69, §03.4.8 and Spec 4.9 (read skills L0–L1 only pre-ADR; L4 never for scheduled tasks matches the L0–L3 CHECK constraint).
* Regulatory facts verified against `R_Standards_Quick_Reference.md`: DPDP Rules 13 Nov 2025 / consent managers 13 Nov 2026 / duties 13 May 2027; CERT-In 6 h and 180-day logs; PCI DSS v4.0.1; WCAG 2.2; RBI Managing Risks in Outsourcing Directions 2025 (28 Nov 2025); IT Rules SGI amendment 20 Feb 2026; Node 24.22.1 / 26.12.1 / 22.23.4 (Oct 2026). PG14 EOL tagged [VERIFY].

## 4. Left open

1. Requirement-table "Tier" column semantics differ by file (finding 22) — propose an explicit `Obligation` column in IPB v1.1.
2. `PLT_ACCESSIBILITY_LEAD` to be added to the platform role registry (finding 23).
3. PG14 EOL date [VERIFY] (finding 21).
4. IPB-07 tree keeps `ORG` as a display label; the registry mapping sentence in §07.5 is the binding reconciliation.
