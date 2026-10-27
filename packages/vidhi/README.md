# @infrabyx/vidhi

The Vidhi AI kernel: skills, tasks and approvals, autonomy L0–L4 with product ceilings, the immutable locked-action list, the persona and reserved-advice routing. Missions, schedules, MCP and notebooks follow in PL4 session 7.

**Specified by:** IPB-03 §03.3.I–K, §03.4.6–§03.4.8 and §03.4.11. Plan: `docs/phases/PL4-plan.md` §8. Migration `vidhi/0001_init.sql` is applied by `infrabyx-migrate` after `ai`.

**Status:** PL4 session 6. First release (0.1.0) at the PL4 gate.

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
- **Prompts:** `persona/vidhi.persona/1.0.0.md` and `persona/vidhi.plain_language/1.0.0.md`, with golden sets in `evals/` (110 cases each). CI grades them with `ai-eval-gate`, and `infrabyx-ai prompts sync --set packages/vidhi/persona:packages/vidhi/evals` loads them.

## For products

1. Ship your skill manifests, and load them with `SkillRegistry.load` at boot. Pass `promptExists` and `evalSetExists`.
2. Build `Autonomy` and `TaskRuntime` with the approvals engine (with FieldCrypto: tool arguments travel in the sealed approval payload), the AI kill switches and your tool handlers.
3. Run `sweepKilled` on every kill-switch change and once a minute.
4. Pass your contacts to `Vidhi` (for Udofin, the grievance officer), and override the neutral hand-off text after counsel review.
