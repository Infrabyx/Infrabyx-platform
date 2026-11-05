---
"@infrabyx/audit": minor
"@infrabyx/tenancy": minor
"@infrabyx/contracts": minor
"@infrabyx/testing": minor
"@infrabyx/workflow": patch
---

Wave 10 (R1-plan M72 to M74).

- **`audit`: retire an empty capture table (OWNER-QUESTIONS #122, R1-D-102; Finbyx PR-FBX-39).** `audit/0008` adds `audit.retire_capture(regclass)`: for `app_migrate` only, only inside a migration applied by the platform runner, refused unless the registered table has no rows. It writes the retirement into the capture chain (`audit.capture_retirement`, itself captured, action `audit.capture.retire`), keeps every capture row, ends the registration, and lets the drop guard admit the drop of that one table in the same transaction only; the commit fails if the table is not dropped. Every other drop is still refused. Use: `select audit.retire_capture('<schema>.<table>'); drop table <schema>.<table>;` in one migration. Install `audit/0008` as the database owner, as `audit/0003`.
- **`tenancy`: one tenant-id rule (Finbyx PR-FBX-40, R1-D-103).** `tenancy/0019` refuses a tenant id other than `tnt_` followed by 1 to 60 lower-case letters and digits, or a ULID; it first checks the existing tenants and stops, naming them, if one breaks the rule. The migration runner sets `ipb.migration` to the file it applies, for that file's transaction.
- **`contracts`:** `TENANT_ID_REGEX`, `TENANT_ID_PATTERN`, `isTenantId`; every id they admit fits every port's storage prefix. Three new ports, interfaces only (R1-D-104): DISPATCH (`DispatchPort`, ADR-0008, Finbyx PR-FBX-41), COURT_DATA (`CourtDataPort`, ADR-0009, PR-FBX-42) and ODR (`OdrPort`, ADR-0010, PR-FBX-44; Ecosystem Spec 8.9), with catalogue rows.
- **`testing`:** `FakeDispatch`, `FakeCourtData`, `FakeOdr`, `equatorOdrStub()` (with the group-company disclosure) and the three contract suites.
- **`workflow`:** timer ids follow the tenant-id rule.
