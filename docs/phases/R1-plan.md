# R1 — the 1.x line after the platform exit gate

**Date:** 2026-10-28 · **Owner instruction:** after 1.0.0, continue in continuous mode with the post-1.0 work, one PR each (28 Oct 2026). IPB-14's phases end at PL6; work on the 1.x line is recorded as `R1-D-nn` in `docs/DECISIONS.md`, and each item ships as a minor of the packages it changes.

| #   | Item                                                     | Owner basis               | Packages (minor)                                        | Exit                                                                                                                                                                            |
| --- | -------------------------------------------------------- | ------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `SVC_OUTBOX_RELAY`: the outbox relay as a service reader | #74(e), #75(d) (PL6-D-16) | `contracts`, `tenancy` (migration 0003), `audit` (0002) | the relay reads and updates only registered outboxes, in a tenant context for every write, each batch ledgered; the reference app runs it; integration tests prove the refusals |
| 2   | The visual block editor for CMS pages (PR-038)           | #62 (PL6-D-16)            | `ui` (Studio), `cms` if the block schema needs it       | add, remove, reorder blocks, edit each block in a form, preview; no JavaScript-only path; axe clean; the JSON editor stays as a fallback                                        |

Plans of the 1.x line are `docs/phases/Rn-plan.md`; `pr-checklist` accepts them as the plan link of a Claude-Code PR (IPB-09-04), as it does `docs/phases/PLn-plan.md`.

Every item keeps the IPB-09 required checks green, adds its `@IPB-..` tests where the spec has them, updates the threat model, STATUS and DECISIONS, and stops on a CLAUDE.md stop condition.
