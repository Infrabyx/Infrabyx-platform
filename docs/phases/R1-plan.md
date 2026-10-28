# R1 — the 1.x line after the platform exit gate

**Date:** 2026-10-28 · **Owner instruction:** after 1.0.0, continue in continuous mode with the post-1.0 work, one PR each (28 Oct 2026). IPB-14's phases end at PL6; work on the 1.x line is recorded as `R1-D-nn` in `docs/DECISIONS.md`, and each item ships as a minor of the packages it changes.

| #   | Item                                                     | Owner basis               | Packages (minor)                                        | Exit                                                                                                                                                                            |
| --- | -------------------------------------------------------- | ------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `SVC_OUTBOX_RELAY`: the outbox relay as a service reader | #74(e), #75(d) (PL6-D-16) | `contracts`, `tenancy` (migration 0003), `audit` (0002) | the relay reads and updates only registered outboxes, in a tenant context for every write, each batch ledgered; the reference app runs it; integration tests prove the refusals |
| 2   | The visual block editor for CMS pages (PR-038)           | #62 (PL6-D-16)            | `ui` (Studio), `cms` (block forms and rich text codec)  | add, remove, reorder blocks, edit each block in a form, preview; no JavaScript-only path; axe clean; the JSON editor stays as a fallback                                        |

Plans of the 1.x line are `docs/phases/Rn-plan.md`; `pr-checklist` accepts them as the plan link of a Claude-Code PR (IPB-09-04), as it does `docs/phases/PLn-plan.md`.

Every item keeps the IPB-09 required checks green, adds its `@IPB-..` tests where the spec has them, updates the threat model, STATUS and DECISIONS, and stops on a CLAUDE.md stop condition.

## Maintenance: Udofin platform requests PR-UDF-004 to PR-UDF-007 (owner, 28 Oct 2026)

Maintenance mode (R1-D-04). One PR each, in this order, each released as a patch under #81(a) when green and recorded in STATUS under "Releases after 1.0.0".

| #   | Request                         | Packages (patch)                          | Exit                                                                                                                                                              |
| --- | ------------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1  | PR-UDF-007 (security)           | `connectors` (scrubber), `tenancy` (rule) | `account_number` and the other IPB-02 masked fields masked under every usual key spelling and in free text; OTPs redacted by key and in messages; tests (R1-D-05) |
| M2  | PR-UDF-005 (CLI entry)          | every package with a `bin`                | each `infrabyx-*` CLI runs through `pnpm exec` (pnpm's symlinked bins); a test runs each one that way and checks it ran; product guide drops the wrapper          |
| M3  | PR-UDF-006 (scaffold)           | none (`scripts/scaffold-product.mjs`)     | each slip fixed in the scaffold, with a `scaffold` job check for each                                                                                             |
| M4  | PR-UDF-004 (`LENDER_CONNECTOR`) | none (design note)                        | a short note on whether the request belongs in the platform; the owner decides; no code                                                                           |
