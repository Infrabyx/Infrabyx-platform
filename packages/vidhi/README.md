# @infrabyx/vidhi

The Vidhi AI kernel: skills, tasks and approvals, autonomy L0–L4 with product ceilings, the immutable locked-action list, the persona and reserved-advice routing, scheduled tasks, missions, MCP (server and client), knowledge notebooks, feedback, QA sampling, the daily digest and AI disclosure.

**Specified by:** IPB-03 §03.3.I–K, §03.4.6–§03.4.8 and §03.4.11. Plan: `docs/phases/PL4-plan.md` §8. Migrations `vidhi/0001_init.sql` to `vidhi/0004_feedback_qa_digest.sql` are applied by `infrabyx-migrate` after `ai`.

**Status:** PL4 session 8. First release (0.1.0) at the PL4 gate.

## What it does

- **`SkillRegistry`** validates `skill.manifest.json` files at boot (`SkillManifest` in `@infrabyx/contracts/vidhi`). An invalid manifest is disabled with `IPB-VID-001`; the others load. A tool that is `locked: true`, or whose name matches the locked list, is capped at L2.
- **The locked list** (`KERNEL_LOCKED_LIST`, frozen) covers the IPB-03-71 categories and the owner's floor:
  - payments, credit decisions, collections, HR pay, hiring and discipline;
  - legal filings, signatures, deletions, external sharing and pricing;
  - approvals and access grants.

  Tool names are matched by their words, and product additions (§03.4.11) only add. Nothing in settings, plan or BYOK can unlock it.

- **Product ceilings** (`productCeiling`) are platform constants:
  - Udofin: L1 for borrowers, L2 for staff (owner decision);
  - EQ: L2 (L3 for scheduling and reminders);
  - FBX: L2 (L3 for data checks, classification and narratives);
  - LD, LDC, OH: L2, or L3 for internal drafting, triage and reminders.

  No product reaches L4.

- **`Autonomy`**:
  - the effective level is the minimum of the skill, tool, product, operating (kernel) and tenant levels, and of the schedule cap;
  - promotion to L3/L4 is an R4 approval checked by `ORG_OWNER`, refused with `IPB-AI-013` without the IPB-03-70 evidence or inside the 30-day cool-down;
  - demotion is automatic: a locked-action attempt or guardrail incident lands at L2.
- **`TaskRuntime`** runs the IPB-03 state machine with compare-and-set transitions:
  - a locked action at any level, or a write at L2, moves the task to NEEDS_APPROVAL through the approvals engine (`vidhi.action.<tool>`, R3 for locked actions), and the executor runs the tool exactly once under the approver's identity;
  - an agent never approves (`IPB-VID-012`), and a decision for a task that is no longer waiting is `IPB-VID-022`;
  - kill switches cancel tasks at every step (`sweepKilled`);
  - an agent that insists on a locked action fails the task, emits `LockedActionAttempted` and demotes the skill.
- **`Vidhi.answer`** asks the gateway with `vidhi.persona@1` (or `vidhi.plain_language@1`). A question asking for advice on the user's own matter, or a recommendation the output classifier caught, adds a hand-off card to a qualified professional and the product's contacts. `aiLabel` and `assistantName` give the disclosure text; a display-name override ("Astra, an AI assistant") never changes the kernel id `vidhi` in runs, events or the ledger.
- **`Scheduler`** (IPB-03-64 to 03-67) runs a skill for its owner on a recurrence or when an event arrives:
  - recurrences are an RFC 5545 subset in the schedule's time zone (`parseRecurrence`; DAILY, WEEKLY or MONTHLY with INTERVAL, BYDAY, BYHOUR, BYMINUTE, BYMONTHDAY, COUNT, UNTIL and EXDATE; at most 24 runs a day); anything else is refused at save;
  - event triggers match a CloudEvents type and an optional CEL condition over `{type, data}`;
  - `tick` finds due runs across tenants as `SVC_VIDHI_SCHED`; each occurrence runs at most once;
  - before every run the owner must still be active and hold every role they had when they created the schedule, the plan must include the skill, and no kill switch may be on. Otherwise the run is skipped (`IPB-VID-020`, NOTIFY `vidhi.schedule.skipped`), and the third skip in a row pauses the schedule (`IPB-VID-021`);
  - scheduled tasks run at L2 at most (L3 only for ORG_OWNER or ORG_ADMIN owners where the tenant allows), never L4.
- **`Missions`** (IPB-03-63) break a goal into steps with the `vidhi.mission_plan@1` planner. Each step is a task at no more than the mission's level (the lowest ceiling of its skills). A step that needs a human makes the mission wait. Running out of budget (tokens, cost, wall-clock, tool calls) stops it with `IPB-VID-070`. `advance` is safe to call from a QUEUE at any time.
- **`McpServer`** (IPB-03-75; MCP 2026-07-28, stateless) is the JSON-RPC handler products mount on `/mcp`, after `checkMcpHeaders` and OAuth:
  - it is off until `ai.mcp.server_enabled`;
  - it offers one tool per tool of the skills that list the `mcp` surface, filtered by your permission check, plus `vidhi.task_status`;
  - read tools run as a Vidhi task for the caller;
  - write and locked tools only return `{status: "needs_approval", approval_url, tsk_id}`, at any autonomy level, and a client that asks to execute directly gets `IPB-VID-040`.
- **`McpClient`** (IPB-03-76) calls only servers on `vidhi.mcp.client_allowlist` (a tenant list can only narrow the platform list), within each server's class ceiling, tool allow-list and rate (`IPB-VID-041` otherwise). Results come back as `tool_result` data blocks.
- **`Notebooks`** (IPB-03-79 to 03-82):
  - sources are sealed text, Markdown, PDF through your extractor, records by reference (re-read through your permission check at every use) and URLs through your egress fetcher;
  - the notebook's class is its highest source's;
  - outputs (Q&A, FAQ, briefing, timeline, Mermaid mind map, flashcards) are grounded through `vidhi.notebook@1`, with provenance, and show as stale when a source changes;
  - platform notebooks are read-only to tenants;
  - sharing with another organisation is a locked action (`IPB-VID-060` until approved), and exposes the outputs only.
- **`Feedback`** (IPB-03-84): one thumbs up or down per person and run, with an optional reason. Corrections are sealed, and the ones marked "use this as reference" form the tenant's reference set, which the skill's owner reads. They are never used for training.
- **`QaSampler`** (IPB-03-85) queues finished tasks for the skill owner's review: 10 % in a skill's first 30 days, otherwise `vidhi.qa.sample_rate`, chosen deterministically. Precision and recall are tracked since the last level change, and below the floor the skill drops one level.
- **`Digest`** (IPB-03-83) builds "What Vidhi did today" per user and per tenant admin (counts only) and sends it once a day through NOTIFY `vidhi.digest`. `actionLog` searches the action log.
- **`disclosure` / `Vidhi.disclose`** (IPB-03-53) give every artefact's label, with its run id, and the `ai_provenance` sidecar.
- **Prompts:** `persona/vidhi.persona/1.0.0.md` and `persona/vidhi.plain_language/1.0.0.md` (110 golden cases each), `persona/vidhi.mission_plan/1.0.0.md` (41) and `persona/vidhi.notebook/1.0.0.md` (108), with golden sets in `evals/`. CI grades them with `ai-eval-gate`, and `infrabyx-ai prompts sync --set packages/vidhi/persona:packages/vidhi/evals` loads them.

## For products

1. Ship your skill manifests, and load them with `SkillRegistry.load` at boot. Pass `promptExists` and `evalSetExists`.
2. Build `Autonomy` and `TaskRuntime` with the approvals engine (with FieldCrypto: tool arguments travel in the sealed approval payload), the AI kill switches and your tool handlers.
3. Run `sweepKilled` on every kill-switch change and once a minute.
4. Pass your contacts to `Vidhi` (for Udofin, the grievance officer), and override the neutral hand-off text after counsel review.
5. Call `Scheduler.tick` once a minute and `Scheduler.onEvent` from your inbox consumer. Pass `authorize`, `entitled` and `connectorsValid` where you have them, and the rules engine's `evaluateCel`.
6. Run each mission with `Missions.advance` from your QUEUE, and again after each approval of one of its steps.
7. Mount `McpServer.handle` on `/mcp` (Streamable HTTP, OAuth 2.1 with PKCE, resource `urn:infrabyx:<product>:mcp`) after `checkMcpHeaders`; pass `authorize` and `approvalUrl`. Give `McpClient` your egress fetch.
8. Give `Notebooks` FieldCrypto, the gateway, the approvals engine and, where you have them, `records`, `egress` and `pdfText`.
9. Call `QaSampler.maybeSample` when a task finishes, with your Work Inbox. Send `Digest.send` at each person's `vidhi.digest.hour_local`, and attach `disclose()` to every AI artefact you store or export.
