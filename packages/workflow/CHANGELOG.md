# @infrabyx/workflow

## 1.3.5

### Patch Changes

- e86dedf: Wave 10 (R1-plan M72 to M74).

  - **`audit`: retire an empty capture table (OWNER-QUESTIONS #122, R1-D-102; Finbyx PR-FBX-39).** `audit/0008` adds `audit.retire_capture(regclass)`: for `app_migrate` only, only inside a migration applied by the platform runner, refused unless the registered table has no rows. It writes the retirement into the capture chain (`audit.capture_retirement`, itself captured, action `audit.capture.retire`), keeps every capture row, ends the registration, and lets the drop guard admit the drop of that one table in the same transaction only; the commit fails if the table is not dropped. Every other drop is still refused. Use: `select audit.retire_capture('<schema>.<table>'); drop table <schema>.<table>;` in one migration. Install `audit/0008` as the database owner, as `audit/0003`.
  - **`tenancy`: one tenant-id rule (Finbyx PR-FBX-40, R1-D-103).** `tenancy/0019` refuses a tenant id other than `tnt_` followed by 1 to 60 lower-case letters and digits, or a ULID; it first checks the existing tenants and stops, naming them, if one breaks the rule. The migration runner sets `ipb.migration` to the file it applies, for that file's transaction.
  - **`contracts`:** `TENANT_ID_REGEX`, `TENANT_ID_PATTERN`, `isTenantId`; every id they admit fits every port's storage prefix. Three new ports, interfaces only (R1-D-104): DISPATCH (`DispatchPort`, ADR-0008, Finbyx PR-FBX-41), COURT_DATA (`CourtDataPort`, ADR-0009, PR-FBX-42) and ODR (`OdrPort`, ADR-0010, PR-FBX-44; Ecosystem Spec 8.9), with catalogue rows.
  - **`testing`:** `FakeDispatch`, `FakeCourtData`, `FakeOdr`, `equatorOdrStub()` (with the group-company disclosure) and the three contract suites.
  - **`workflow`:** timer ids follow the tenant-id rule.

- Updated dependencies [e86dedf]
  - @infrabyx/tenancy@1.17.0
  - @infrabyx/contracts@1.24.0
  - @infrabyx/config@1.13.1
  - @infrabyx/crypto@1.5.9

## 1.3.4

### Patch Changes

- Updated dependencies [d3888de]
  - @infrabyx/config@1.13.0
  - @infrabyx/tenancy@1.16.1

## 1.3.3

### Patch Changes

- Updated dependencies [67be297]
- Updated dependencies [67be297]
- Updated dependencies [67be297]
- Updated dependencies [67be297]
  - @infrabyx/contracts@1.23.0
  - @infrabyx/tenancy@1.16.0
  - @infrabyx/config@1.12.1
  - @infrabyx/crypto@1.5.8

## 1.3.2

### Patch Changes

- Updated dependencies [3c9bb25]
- Updated dependencies [3c9bb25]
- Updated dependencies [3c9bb25]
- Updated dependencies [3c9bb25]
  - @infrabyx/config@1.12.0
  - @infrabyx/tenancy@1.15.0
  - @infrabyx/contracts@1.22.0
  - @infrabyx/crypto@1.5.7

## 1.3.1

### Patch Changes

- Updated dependencies [bc2c301]
  - @infrabyx/tenancy@1.14.1

## 1.3.0

### Minor Changes

- 1dda4b2: Approval expiry from a product setting (OWNER-QUESTIONS #106; LawDocsComply PR-LDC-19; R1-D-89): the new registered key `mc.expiry_hours.{action}` (TENANT tier, 1 to 168 hours, tighten-only, R4) is read by `settingsApprovalPolicy` as `TenantApprovalPolicy.expiryHours`, and `ApprovalsEngine` uses it only to shorten the action's platform expiry, clamped to [1 hour, the platform period]; it never lengthens it. `expiryHoursFor(risk, financial, tenantHours?)` and `APPROVAL_MIN_EXPIRY_HOURS` are exported.

### Patch Changes

- Updated dependencies [1dda4b2]
- Updated dependencies [1dda4b2]
- Updated dependencies [1dda4b2]
  - @infrabyx/tenancy@1.14.0
  - @infrabyx/config@1.11.0
  - @infrabyx/contracts@1.21.0
  - @infrabyx/crypto@1.5.6

## 1.2.7

### Patch Changes

- Updated dependencies [b8c1f2c]
- Updated dependencies [b8c1f2c]
  - @infrabyx/contracts@1.20.0
  - @infrabyx/tenancy@1.13.0
  - @infrabyx/config@1.10.1
  - @infrabyx/crypto@1.5.5

## 1.2.6

### Patch Changes

- Updated dependencies [c8b8f88]
- Updated dependencies [c8b8f88]
- Updated dependencies [c8b8f88]
- Updated dependencies [c8b8f88]
- Updated dependencies [c8b8f88]
- Updated dependencies [c8b8f88]
- Updated dependencies [c8b8f88]
- Updated dependencies [c8b8f88]
- Updated dependencies [c8b8f88]
  - @infrabyx/tenancy@1.12.0
  - @infrabyx/contracts@1.19.0
  - @infrabyx/config@1.10.0
  - @infrabyx/crypto@1.5.4

## 1.2.5

### Patch Changes

- Updated dependencies [9c368c7]
- Updated dependencies [9c368c7]
- Updated dependencies [9c368c7]
- Updated dependencies [9c368c7]
  - @infrabyx/tenancy@1.11.0
  - @infrabyx/contracts@1.18.0
  - @infrabyx/config@1.9.2
  - @infrabyx/crypto@1.5.3

## 1.2.4

### Patch Changes

- Updated dependencies [714ad01]
  - @infrabyx/contracts@1.17.0
  - @infrabyx/config@1.9.1
  - @infrabyx/crypto@1.5.2
  - @infrabyx/tenancy@1.10.1

## 1.2.3

### Patch Changes

- Updated dependencies [b3edda2]
- Updated dependencies [b3edda2]
- Updated dependencies [b3edda2]
- Updated dependencies [b3edda2]
- Updated dependencies [b3edda2]
  - @infrabyx/config@1.9.0
  - @infrabyx/tenancy@1.10.0
  - @infrabyx/contracts@1.16.0
  - @infrabyx/crypto@1.5.1

## 1.2.2

### Patch Changes

- Updated dependencies [fdd1f1a]
- Updated dependencies [ed143e3]
  - @infrabyx/config@1.8.0
  - @infrabyx/tenancy@1.9.2

## 1.2.1

### Patch Changes

- Updated dependencies [2a95100]
- Updated dependencies [2a95100]
  - @infrabyx/config@1.7.0
  - @infrabyx/crypto@1.5.0
  - @infrabyx/tenancy@1.9.1

## 1.2.0

### Minor Changes

- 87efd77: A product's own durable timer kinds (Udofin PR-UDF-035; Finbyx PR-FBX-13 (1); R1-D-49). `WorkflowTimers.on("<product>.<area>.<name>", handler)` registers a kind; `schedule` and `cancel` take it with a reference of 1 to 64 letters, digits, `_` or `-`, and refuse an unregistered or malformed kind. Migration `workflow/0003` widens the timer table's checks; the platform kinds keep their references. `parseTimerId` reads product kinds for the Temporal engine. Run `infrabyx-migrate`.

### Patch Changes

- Updated dependencies [7910610]
- Updated dependencies [1b99d7a]
- Updated dependencies [c83e9e0]
- Updated dependencies [af2ae98]
- Updated dependencies [c4117e4]
- Updated dependencies [1e721cd]
- Updated dependencies [854e309]
- Updated dependencies [854e309]
- Updated dependencies [0da0398]
- Updated dependencies [05c3122]
  - @infrabyx/tenancy@1.9.0
  - @infrabyx/contracts@1.15.0
  - @infrabyx/config@1.6.0
  - @infrabyx/crypto@1.4.0

## 1.1.0

### Minor Changes

- d66ffad: Named tenant functions under maker-checker (Finbyx PR-FBX-20; IPB-02-33; R1-D-39). Migration `tenancy/0011` adds `tenancy.function_assignment`. `TenantFunctions` assigns `FN:CRO`, `FN:CCO`, `FN:COMPLIANCE_OFFICER` and a product's own functions through an approved R3 `tenancy.function.assign` request (an ORG_OWNER or ORG_ADMIN asks, a different one approves, never the assignee), revokes at once with a reason, and `withFunctions(ctx)` adds the person's active functions to the session's roles (dropping any a token claimed). `ApprovalsEngine` honours an action's `checkerFunctions` and the tenant's `FN:` entries in `mc.checker_roles.<action>` (tighten-only; `checkerFunctionsFor`), and `ApprovalWorkflow` sends inbox items to the function holders. `contracts`: `FUNCTION_ROLE_REGEX`, `PLATFORM_FUNCTIONS`, `isFunctionRole`, and `FN:` roles in `RoleSchema`. Run `infrabyx-migrate`.

### Patch Changes

- Updated dependencies [97e8524]
- Updated dependencies [e41c3bd]
- Updated dependencies [92706c4]
- Updated dependencies [92706c4]
- Updated dependencies [4a87754]
- Updated dependencies [d66ffad]
  - @infrabyx/contracts@1.14.0
  - @infrabyx/tenancy@1.8.0
  - @infrabyx/config@1.5.2
  - @infrabyx/crypto@1.3.1

## 1.0.18

### Patch Changes

- Updated dependencies [32b53ee]
- Updated dependencies [cff2a02]
  - @infrabyx/crypto@1.3.0
  - @infrabyx/contracts@1.13.0
  - @infrabyx/config@1.5.1
  - @infrabyx/tenancy@1.7.2

## 1.0.17

### Patch Changes

- Updated dependencies [63c5ad2]
- Updated dependencies [63c5ad2]
  - @infrabyx/config@1.5.0
  - @infrabyx/contracts@1.12.0
  - @infrabyx/tenancy@1.7.1
  - @infrabyx/crypto@1.2.7

## 1.0.16

### Patch Changes

- Updated dependencies [2e3a2d3]
- Updated dependencies [2e3a2d3]
- Updated dependencies [3f20011]
- Updated dependencies [3f20011]
  - @infrabyx/contracts@1.11.0
  - @infrabyx/tenancy@1.7.0
  - @infrabyx/config@1.4.1
  - @infrabyx/crypto@1.2.6

## 1.0.15

### Patch Changes

- Updated dependencies [138ae44]
- Updated dependencies [138ae44]
- Updated dependencies [138ae44]
  - @infrabyx/config@1.4.0
  - @infrabyx/contracts@1.10.0
  - @infrabyx/tenancy@1.6.0
  - @infrabyx/crypto@1.2.5

## 1.0.14

### Patch Changes

- Updated dependencies [2b307e0]
- Updated dependencies [2b307e0]
  - @infrabyx/contracts@1.9.0
  - @infrabyx/tenancy@1.5.0
  - @infrabyx/config@1.3.2
  - @infrabyx/crypto@1.2.4

## 1.0.13

### Patch Changes

- Updated dependencies [cd25633]
- Updated dependencies [cd25633]
  - @infrabyx/contracts@1.8.0
  - @infrabyx/tenancy@1.4.0
  - @infrabyx/config@1.3.1
  - @infrabyx/crypto@1.2.3

## 1.0.12

### Patch Changes

- Updated dependencies [94b706e]
  - @infrabyx/config@1.3.0
  - @infrabyx/tenancy@1.3.5

## 1.0.11

### Patch Changes

- Updated dependencies [f5622c9]
- Updated dependencies [f5622c9]
  - @infrabyx/config@1.2.0
  - @infrabyx/contracts@1.7.0
  - @infrabyx/tenancy@1.3.4
  - @infrabyx/crypto@1.2.2

## 1.0.10

### Patch Changes

- Updated dependencies [ceabe3b]
  - @infrabyx/contracts@1.6.0
  - @infrabyx/config@1.1.1
  - @infrabyx/crypto@1.2.1
  - @infrabyx/tenancy@1.3.3

## 1.0.9

### Patch Changes

- Updated dependencies [849b8f9]
- Updated dependencies [849b8f9]
- Updated dependencies [849b8f9]
  - @infrabyx/config@1.1.0
  - @infrabyx/contracts@1.5.0
  - @infrabyx/crypto@1.2.0
  - @infrabyx/tenancy@1.3.2

## 1.0.8

### Patch Changes

- Updated dependencies [7e38652]
- Updated dependencies [7e38652]
  - @infrabyx/contracts@1.4.0
  - @infrabyx/crypto@1.1.0
  - @infrabyx/config@1.0.6
  - @infrabyx/tenancy@1.3.1

## 1.0.7

### Patch Changes

- Updated dependencies [b6058d3]
- Updated dependencies [b6058d3]
  - @infrabyx/contracts@1.3.0
  - @infrabyx/tenancy@1.3.0
  - @infrabyx/config@1.0.5
  - @infrabyx/crypto@1.0.3

## 1.0.6

### Patch Changes

- Updated dependencies [1c869a8]
  - @infrabyx/config@1.0.4
  - @infrabyx/tenancy@1.2.1

## 1.0.5

### Patch Changes

- Updated dependencies [75e9ea4]
- Updated dependencies [75e9ea4]
  - @infrabyx/contracts@1.2.0
  - @infrabyx/tenancy@1.2.0
  - @infrabyx/config@1.0.3
  - @infrabyx/crypto@1.0.2

## 1.0.4

### Patch Changes

- Updated dependencies [c0ce8ff]
- Updated dependencies [2724cd6]
  - @infrabyx/tenancy@1.1.3

## 1.0.3

### Patch Changes

- Updated dependencies [8a2587e]
- Updated dependencies [8a2587e]
  - @infrabyx/config@1.0.2
  - @infrabyx/tenancy@1.1.2

## 1.0.2

### Patch Changes

- Updated dependencies [53a973c]
  - @infrabyx/tenancy@1.1.1

## 1.0.1

### Patch Changes

- Updated dependencies [588b509]
- Updated dependencies [588b509]
  - @infrabyx/contracts@1.1.0
  - @infrabyx/tenancy@1.1.0
  - @infrabyx/config@1.0.1
  - @infrabyx/crypto@1.0.1

## 1.0.0

### Major Changes

- 9ec9a2c: 1.0.0, the platform baseline release (IPB-14 §14.5 item 1; owner answer #67(4), PL6-D-16). Every `@infrabyx/*` package moves to 1.0.0 together; the public API is unchanged from the 0.x set of the PL6 gate (`docs/phases/PL6-gate.md` §6), so a product upgrades by moving every dependency to 1.0.0 at once. From 1.0.0 on, semantic versioning holds: a breaking change to an export, a migration or a setting is a major release with an ADR (IPB-09-34/35).

### Patch Changes

- Updated dependencies [9ec9a2c]
  - @infrabyx/config@1.0.0
  - @infrabyx/contracts@1.0.0
  - @infrabyx/crypto@1.0.0
  - @infrabyx/tenancy@1.0.0

## 0.1.3

### Patch Changes

- Updated dependencies [9d8cd8c]
- Updated dependencies [b3934f9]
  - @infrabyx/tenancy@0.6.0
  - @infrabyx/config@0.5.1

## 0.1.2

### Patch Changes

- Updated dependencies [de53086]
- Updated dependencies [de53086]
- Updated dependencies [f1a36a1]
- Updated dependencies [1fecf45]
- Updated dependencies [1fecf45]
- Updated dependencies [b0dc390]
- Updated dependencies [b0dc390]
- Updated dependencies [b0dc390]
- Updated dependencies [275d4ba]
- Updated dependencies [934355c]
- Updated dependencies [686d24b]
- Updated dependencies [686d24b]
- Updated dependencies [e8e83cb]
- Updated dependencies [275d4ba]
- Updated dependencies [36338c3]
- Updated dependencies [934355c]
- Updated dependencies [b7de3c6]
- Updated dependencies [e8e83cb]
- Updated dependencies [275d4ba]
  - @infrabyx/config@0.5.0
  - @infrabyx/contracts@0.5.0
  - @infrabyx/tenancy@0.5.0
  - @infrabyx/crypto@0.4.1

## 0.1.1

### Patch Changes

- Updated dependencies [2b07109]
- Updated dependencies [200b25a]
- Updated dependencies [f6e9a88]
- Updated dependencies [f6e9a88]
- Updated dependencies [200b25a]
- Updated dependencies [9af583a]
- Updated dependencies [288ae44]
- Updated dependencies [b205b1d]
- Updated dependencies [183c532]
- Updated dependencies [f6e9a88]
- Updated dependencies [183c532]
- Updated dependencies [200b25a]
- Updated dependencies [b205b1d]
  - @infrabyx/contracts@0.4.0
  - @infrabyx/config@0.4.0
  - @infrabyx/crypto@0.4.0
  - @infrabyx/tenancy@0.4.0

## 0.1.0

### Minor Changes

- 3951517: Owner answers #21 and #22 (PL3-D-21), migration `workflow/0002_owner_answers_pl3.sql`: inbox items
  raised with `escalateAfterHours` escalate once to ORG_ADMIN through an `inbox.escalate` timer
  (`notifier.itemEscalated`), and the excluded principal never sees or resolves them; the timer
  poller reads as the service reader `SVC_SCHEDULER` instead of `PLT_AUDITOR_RO` (`onServiceRead`).
- dd7a98b: First release (publishable, PL1-D-20): `createWorkflow` wires the approvals engine, the Work Inbox
  (`InboxService`, the `HumanQueue`), scheduled actions and delay windows, durable timers (PostgreSQL
  poller and reconciler; optional Temporal engine), reminders, escalation and expiry, `decideMany`
  with typed confirmation, the settings-backed `mc.*` policy and `engineRefundApprovals`. Migration
  `workflow/0001_init.sql` (PL3-D-19).

### Patch Changes

- Updated dependencies [50093e9]
- Updated dependencies [2725b6c]
- Updated dependencies [dd7a98b]
- Updated dependencies [50093e9]
- Updated dependencies [e268b60]
- Updated dependencies [1ed0659]
- Updated dependencies [2725b6c]
- Updated dependencies [1ed0659]
- Updated dependencies [53697f5]
- Updated dependencies [dd7a98b]
- Updated dependencies [e268b60]
- Updated dependencies [1ed0659]
- Updated dependencies [50093e9]
- Updated dependencies [53697f5]
- Updated dependencies [3951517]
- Updated dependencies [3951517]
- Updated dependencies [dd7a98b]
- Updated dependencies [e268b60]
- Updated dependencies [1ed0659]
- Updated dependencies [53697f5]
- Updated dependencies [dd7a98b]
  - @infrabyx/config@0.3.0
  - @infrabyx/contracts@0.3.0
  - @infrabyx/crypto@0.3.0
  - @infrabyx/tenancy@0.3.0
