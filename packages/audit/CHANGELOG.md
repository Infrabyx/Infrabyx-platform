# @infrabyx/audit

## 1.13.6

### Patch Changes

- Updated dependencies [fa389d6]
  - @infrabyx/contracts@1.56.0
  - @infrabyx/config@1.24.10
  - @infrabyx/crypto@1.15.8

## 1.13.5

### Patch Changes

- Updated dependencies [bdd282a]
  - @infrabyx/contracts@1.55.0
  - @infrabyx/config@1.24.9
  - @infrabyx/crypto@1.15.7

## 1.13.4

### Patch Changes

- Updated dependencies [c45aaa0]
- Updated dependencies [4e319d1]
  - @infrabyx/config@1.24.8
  - @infrabyx/contracts@1.54.0
  - @infrabyx/crypto@1.15.6

## 1.13.3

### Patch Changes

- Updated dependencies [f4f525b]
  - @infrabyx/contracts@1.53.0
  - @infrabyx/config@1.24.7
  - @infrabyx/crypto@1.15.5

## 1.13.2

### Patch Changes

- Updated dependencies [95acbf9]
  - @infrabyx/contracts@1.52.0
  - @infrabyx/config@1.24.6
  - @infrabyx/crypto@1.15.4

## 1.13.1

### Patch Changes

- Updated dependencies [fc9e98c]
  - @infrabyx/contracts@1.51.0
  - @infrabyx/config@1.24.5
  - @infrabyx/crypto@1.15.3

## 1.13.0

### Minor Changes

- 9abffba: Every refused retrieval host is recordable: `retrievalHostRecord(url)` never returns null or throws (the DNS name or IPv6 literal in clear; any other host as `sha256:` + the SHA-256 of `URL.hostname` without one trailing dot, with `host_length`; `RETRIEVAL_HOST_UNPARSABLE` (`unparsable.invalid`) when there is no host to read), and `retrievalHostRefusedEventOf({ partner_tenant_id, document_id, version, url })` builds the checked `connector.retrieval.host_refused` event from it. PR-UDF-082; R1-D-279.

### Patch Changes

- Updated dependencies [9abffba]
  - @infrabyx/contracts@1.50.0
  - @infrabyx/config@1.24.4
  - @infrabyx/crypto@1.15.2

## 1.12.3

### Patch Changes

- Updated dependencies [4fbcf73]
  - @infrabyx/contracts@1.49.0
  - @infrabyx/config@1.24.3
  - @infrabyx/crypto@1.15.1

## 1.12.2

### Patch Changes

- Updated dependencies [e98dfeb]
- Updated dependencies [24c16c4]
- Updated dependencies [5fc6afe]
- Updated dependencies [daa13b9]
  - @infrabyx/crypto@1.15.0
  - @infrabyx/contracts@1.48.0
  - @infrabyx/config@1.24.2

## 1.12.1

### Patch Changes

- Updated dependencies [5ee71f6]
  - @infrabyx/contracts@1.47.0
  - @infrabyx/config@1.24.1
  - @infrabyx/crypto@1.14.1

## 1.12.0

### Minor Changes

- 25ba32e: Udofin PR-UDF-072 (R1-D-262): migration `audit/0013` widens `audit.security_event`'s kind check to admit `connector.retrieval.host_refused` (expand-only; existing rows pass). `PgSecurityEvents.record` refuses an event of a kind with a typed shape whose detail or resource does not fit it, before it takes a connection, so a URL, query or credential never reaches the table. Apply the migration before recording the new kind.

### Patch Changes

- Updated dependencies [2769b78]
- Updated dependencies [5aba118]
- Updated dependencies [2a0ea72]
- Updated dependencies [21a2bc4]
- Updated dependencies [ef3adc2]
- Updated dependencies [01f9313]
- Updated dependencies [200a8a4]
  - @infrabyx/config@1.24.0
  - @infrabyx/contracts@1.46.0
  - @infrabyx/crypto@1.14.0

## 1.11.9

### Patch Changes

- Updated dependencies [75cbd9a]
- Updated dependencies [beca045]
- Updated dependencies [5b1257d]
- Updated dependencies [199c930]
- Updated dependencies [27057c2]
- Updated dependencies [a702fdc]
- Updated dependencies [f3293a2]
  - @infrabyx/contracts@1.45.0
  - @infrabyx/crypto@1.13.0
  - @infrabyx/config@1.23.1

## 1.11.8

### Patch Changes

- Updated dependencies [d4636a3]
- Updated dependencies [ae319d5]
- Updated dependencies [2d543fe]
- Updated dependencies [98a1d62]
- Updated dependencies [461fe2c]
  - @infrabyx/contracts@1.44.0
  - @infrabyx/config@1.23.0
  - @infrabyx/crypto@1.12.0

## 1.11.7

### Patch Changes

- Updated dependencies [648c511]
- Updated dependencies [9be2fc7]
- Updated dependencies [f0edee3]
- Updated dependencies [2d2729b]
  - @infrabyx/crypto@1.11.0
  - @infrabyx/contracts@1.43.0
  - @infrabyx/config@1.22.3

## 1.11.6

### Patch Changes

- Updated dependencies [2cb5b3f]
- Updated dependencies [a38f921]
- Updated dependencies [f62dcaa]
- Updated dependencies [dbb08e6]
  - @infrabyx/contracts@1.42.0
  - @infrabyx/crypto@1.10.0
  - @infrabyx/config@1.22.2

## 1.11.5

### Patch Changes

- Updated dependencies [98c9416]
  - @infrabyx/contracts@1.41.0
  - @infrabyx/config@1.22.1
  - @infrabyx/crypto@1.9.2

## 1.11.4

### Patch Changes

- Updated dependencies [053e16a]
- Updated dependencies [ce8ca22]
- Updated dependencies [b135555]
- Updated dependencies [48810fd]
- Updated dependencies [1ffb012]
  - @infrabyx/contracts@1.40.0
  - @infrabyx/config@1.22.0
  - @infrabyx/crypto@1.9.1

## 1.11.3

### Patch Changes

- Updated dependencies [5fd012a]
- Updated dependencies [3b57c29]
- Updated dependencies [4d509e6]
  - @infrabyx/contracts@1.39.0
  - @infrabyx/crypto@1.9.0
  - @infrabyx/config@1.21.0

## 1.11.2

### Patch Changes

- Updated dependencies [3c4b588]
  - @infrabyx/contracts@1.38.0
  - @infrabyx/crypto@1.8.0
  - @infrabyx/config@1.20.1

## 1.11.1

### Patch Changes

- Updated dependencies [82dc7ef]
- Updated dependencies [1cdbf0f]
- Updated dependencies [2f9d3f8]
- Updated dependencies [b0e0b72]
- Updated dependencies [9e626ef]
- Updated dependencies [aac1c2c]
- Updated dependencies [d58d5f0]
- Updated dependencies [dbaecff]
- Updated dependencies [80a843a]
- Updated dependencies [1cdbf0f]
- Updated dependencies [ff2a74b]
- Updated dependencies [d35f7e9]
  - @infrabyx/contracts@1.37.0
  - @infrabyx/crypto@1.7.0
  - @infrabyx/config@1.20.0

## 1.11.0

### Minor Changes

- 4af2688: Owner answer #132 (4) and (5) (R1-D-187). A reveal names a purpose code (`RevealRequest.purposeCode`; `RevealRule.purposeCodes`, default `REVEAL_PURPOSE_CODES`; refused `purpose_code_invalid`), recorded as the business id `purpose:<code>`. Refused reveals are kept as security audit events in `audit.security_event` (migration `audit/0012`; `PgSecurityEvents`, `SecurityEventSink`), outside the business ledger, never with the value; the threshold-th refusal of one principal within the window raises `RevealRefusalsRepeated` (settings `rules.reveal.refusal_alert_threshold`, `rules.reveal.refusal_alert_window_minutes`). A `revealRule` now requires `securityEvents`, `refusalCounter` and `outbox`. `defineRulesRevealContract` sends a purpose code and checks its refusal.

### Patch Changes

- Updated dependencies [4af2688]
- Updated dependencies [955cc67]
  - @infrabyx/contracts@1.36.0
  - @infrabyx/config@1.19.0
  - @infrabyx/crypto@1.6.2

## 1.10.6

### Patch Changes

- Updated dependencies [a6929eb]
  - @infrabyx/contracts@1.35.0
  - @infrabyx/config@1.18.1
  - @infrabyx/crypto@1.6.1

## 1.10.5

### Patch Changes

- Updated dependencies [3e69471]
- Updated dependencies [3e69471]
- Updated dependencies [3e69471]
  - @infrabyx/config@1.18.0
  - @infrabyx/contracts@1.34.0
  - @infrabyx/crypto@1.6.0

## 1.10.4

### Patch Changes

- Updated dependencies [34f5e49]
- Updated dependencies [34f5e49]
  - @infrabyx/config@1.17.0
  - @infrabyx/contracts@1.33.0
  - @infrabyx/crypto@1.5.18

## 1.10.3

### Patch Changes

- Updated dependencies [6bb68c1]
- Updated dependencies [6bb68c1]
  - @infrabyx/config@1.16.0
  - @infrabyx/contracts@1.32.0
  - @infrabyx/crypto@1.5.17

## 1.10.2

### Patch Changes

- Updated dependencies [32097cb]
  - @infrabyx/contracts@1.31.0
  - @infrabyx/config@1.15.2
  - @infrabyx/crypto@1.5.16

## 1.10.1

### Patch Changes

- Updated dependencies [c79fef5]
  - @infrabyx/contracts@1.30.0
  - @infrabyx/config@1.15.1
  - @infrabyx/crypto@1.5.15

## 1.10.0

### Minor Changes

- 1089dc7: Business ids on ledger entries (PR-LDC-30): `businessIds` on `record`, inside the hash when present; `AuditService.history(ctx, businessId)` and `LedgerFilter.businessId`. Migrations `audit/0010` (column, check, chain trigger) and `audit/0011` (concurrent partial GIN index).

### Patch Changes

- Updated dependencies [1089dc7]
- Updated dependencies [1089dc7]
- Updated dependencies [1089dc7]
- Updated dependencies [1089dc7]
- Updated dependencies [1089dc7]
- Updated dependencies [1089dc7]
- Updated dependencies [1089dc7]
- Updated dependencies [1089dc7]
- Updated dependencies [1089dc7]
- Updated dependencies [1089dc7]
- Updated dependencies [1089dc7]
- Updated dependencies [1089dc7]
  - @infrabyx/contracts@1.29.0
  - @infrabyx/config@1.15.0
  - @infrabyx/crypto@1.5.14

## 1.9.0

### Minor Changes

- 15be78b: Business ids on ledger entries (PR-LDC-30): `businessIds` on `record`, inside the hash when present; `AuditService.history(ctx, businessId)` and `LedgerFilter.businessId`. Migrations `audit/0010` (column, check, chain trigger) and `audit/0011` (concurrent partial GIN index).

### Patch Changes

- Updated dependencies [15be78b]
- Updated dependencies [15be78b]
- Updated dependencies [15be78b]
- Updated dependencies [15be78b]
- Updated dependencies [15be78b]
  - @infrabyx/contracts@1.28.0
  - @infrabyx/config@1.14.0
  - @infrabyx/crypto@1.5.13

## 1.8.3

### Patch Changes

- Updated dependencies [043a348]
- Updated dependencies [043a348]
- Updated dependencies [043a348]
  - @infrabyx/contracts@1.27.0
  - @infrabyx/config@1.13.4
  - @infrabyx/crypto@1.5.12

## 1.8.2

### Patch Changes

- 0aa0f1d: Register `audit.outbox` for the outbox relay (`audit` migration `register_outbox`; LawDocsComply PR-LDC-35, R1-D-112). The outbox was never registered, so `OutboxRelay` neither found nor delivered its events; run `infrabyx-migrate` and the next relay pass delivers the backlog.
- Updated dependencies [0aa0f1d]
- Updated dependencies [0aa0f1d]
  - @infrabyx/config@1.13.3
  - @infrabyx/contracts@1.26.0
  - @infrabyx/crypto@1.5.11

## 1.8.1

### Patch Changes

- Updated dependencies [496180e]
  - @infrabyx/contracts@1.25.0
  - @infrabyx/config@1.13.2
  - @infrabyx/crypto@1.5.10

## 1.8.0

### Minor Changes

- e86dedf: Wave 10 (R1-plan M72 to M74).

  - **`audit`: retire an empty capture table (OWNER-QUESTIONS #122, R1-D-102; Finbyx PR-FBX-39).** `audit/0008` adds `audit.retire_capture(regclass)`: for `app_migrate` only, only inside a migration applied by the platform runner, refused unless the registered table has no rows. It writes the retirement into the capture chain (`audit.capture_retirement`, itself captured, action `audit.capture.retire`), keeps every capture row, ends the registration, and lets the drop guard admit the drop of that one table in the same transaction only; the commit fails if the table is not dropped. Every other drop is still refused. Use: `select audit.retire_capture('<schema>.<table>'); drop table <schema>.<table>;` in one migration. Install `audit/0008` as the database owner, as `audit/0003`.
  - **`tenancy`: one tenant-id rule (Finbyx PR-FBX-40, R1-D-103).** `tenancy/0019` refuses a tenant id other than `tnt_` followed by 1 to 60 lower-case letters and digits, or a ULID; it first checks the existing tenants and stops, naming them, if one breaks the rule. The migration runner sets `ipb.migration` to the file it applies, for that file's transaction.
  - **`contracts`:** `TENANT_ID_REGEX`, `TENANT_ID_PATTERN`, `isTenantId`; every id they admit fits every port's storage prefix. Three new ports, interfaces only (R1-D-104): DISPATCH (`DispatchPort`, ADR-0008, Finbyx PR-FBX-41), COURT_DATA (`CourtDataPort`, ADR-0009, PR-FBX-42) and ODR (`OdrPort`, ADR-0010, PR-FBX-44; Ecosystem Spec 8.9), with catalogue rows.
  - **`testing`:** `FakeDispatch`, `FakeCourtData`, `FakeOdr`, `equatorOdrStub()` (with the group-company disclosure) and the three contract suites.
  - **`workflow`:** timer ids follow the tenant-id rule.

### Patch Changes

- Updated dependencies [e86dedf]
  - @infrabyx/contracts@1.24.0
  - @infrabyx/config@1.13.1
  - @infrabyx/crypto@1.5.9

## 1.7.5

### Patch Changes

- Updated dependencies [d3888de]
  - @infrabyx/config@1.13.0

## 1.7.4

### Patch Changes

- Updated dependencies [67be297]
- Updated dependencies [67be297]
- Updated dependencies [67be297]
  - @infrabyx/contracts@1.23.0
  - @infrabyx/config@1.12.1
  - @infrabyx/crypto@1.5.8

## 1.7.3

### Patch Changes

- Updated dependencies [3c9bb25]
- Updated dependencies [3c9bb25]
- Updated dependencies [3c9bb25]
  - @infrabyx/config@1.12.0
  - @infrabyx/contracts@1.22.0
  - @infrabyx/crypto@1.5.7

## 1.7.2

### Patch Changes

- Updated dependencies [1dda4b2]
- Updated dependencies [1dda4b2]
- Updated dependencies [1dda4b2]
  - @infrabyx/config@1.11.0
  - @infrabyx/contracts@1.21.0
  - @infrabyx/crypto@1.5.6

## 1.7.1

### Patch Changes

- Updated dependencies [b8c1f2c]
  - @infrabyx/contracts@1.20.0
  - @infrabyx/config@1.10.1
  - @infrabyx/crypto@1.5.5

## 1.7.0

### Minor Changes

- c8b8f88: `AuditService.externalReadSummary(ctx, day)` summarises one tenant's external reads on one UTC day from the `platform.external_read` ledger entries that `ExternalReads` writes: reads per grant and table, per grantee and per table, each with the first and last read time. It reads in the tenant's context under the ledger's RLS, refuses an external principal (IPB-SEC-005) and returns ids, counts and times only, never the grantee's name, IP or user-agent hashes, trace ids or digests. The entries keep the row count only inside a digest, so reads are counted, not rows (PR-LDC-10; R1-D-81).

### Patch Changes

- Updated dependencies [c8b8f88]
- Updated dependencies [c8b8f88]
- Updated dependencies [c8b8f88]
- Updated dependencies [c8b8f88]
- Updated dependencies [c8b8f88]
- Updated dependencies [c8b8f88]
- Updated dependencies [c8b8f88]
  - @infrabyx/contracts@1.19.0
  - @infrabyx/config@1.10.0
  - @infrabyx/crypto@1.5.4

## 1.6.5

### Patch Changes

- Updated dependencies [9c368c7]
- Updated dependencies [9c368c7]
  - @infrabyx/contracts@1.18.0
  - @infrabyx/config@1.9.2
  - @infrabyx/crypto@1.5.3

## 1.6.4

### Patch Changes

- Updated dependencies [714ad01]
  - @infrabyx/contracts@1.17.0
  - @infrabyx/config@1.9.1
  - @infrabyx/crypto@1.5.2

## 1.6.3

### Patch Changes

- Updated dependencies [b3edda2]
- Updated dependencies [b3edda2]
- Updated dependencies [b3edda2]
  - @infrabyx/config@1.9.0
  - @infrabyx/contracts@1.16.0
  - @infrabyx/crypto@1.5.1

## 1.6.2

### Patch Changes

- Updated dependencies [fdd1f1a]
- Updated dependencies [ed143e3]
  - @infrabyx/config@1.8.0

## 1.6.1

### Patch Changes

- Updated dependencies [2a95100]
- Updated dependencies [2a95100]
  - @infrabyx/config@1.7.0
  - @infrabyx/crypto@1.5.0

## 1.6.0

### Minor Changes

- bdcdbe4: Chain lanes for the audit ledger and the statutory capture (Finbyx PR-FBX-32; IPB-02-51; ADR-0005; R1-D-58). Each tenant's two chains become 32 lanes (`audit.lane_setting`, raised only with `audit.set_chain_lanes`), so up to 32 of a tenant's transactions append at once instead of queuing on one head row. Each lane is the same SHA-256 chain (PL1-C-01) with the lane and the position (`lane`, `lane_seq`) hashed. A transaction takes a free lane (`FOR UPDATE SKIP LOCKED`) and keeps it until it ends. `seq` becomes a global sequence: unique and increasing in each lane, but no longer a count. Existing chains continue as lane 0 and nothing written is changed. Migrations `audit/0006` (lane heads, sequences, triggers; briefly locks the ledger and the capture) and `audit/0007` (two unique indexes, built concurrently). `verifyChain` and `verifyCaptureChain` verify lane by lane and return `lanes` (`head.hash` is now `lanesRoot`). `AuditService.verify` and `StatutoryCapture.verify` also compare each lane's end with its stored head, so a deleted tail is reported. Anchors are format 3 (`ANCHOR_FORMAT_LANES`: every lane head of both chains), and verification accepts formats 1 to 3. New exports: `lanePosition`, `lanesRoot`, `laneHeadMismatch`, `captureLanes`, the `LaneHead` type. Run `infrabyx-migrate`.

## 1.5.1

### Patch Changes

- Updated dependencies [1b99d7a]
- Updated dependencies [c83e9e0]
- Updated dependencies [af2ae98]
- Updated dependencies [c4117e4]
- Updated dependencies [1e721cd]
- Updated dependencies [854e309]
- Updated dependencies [854e309]
  - @infrabyx/contracts@1.15.0
  - @infrabyx/config@1.6.0
  - @infrabyx/crypto@1.4.0

## 1.5.0

### Minor Changes

- 92706c4: One ledger entry for a job step over many resources (Finbyx PR-FBX-30; IPB-02-51; R1-D-41). Migration `audit/0005` adds `audit.batch_member`, append-only for every role. `PgAuditSink.recordBatch(tx, { action, run, step, resourceType, resourceIds })` writes one `job_step` entry (`<run>/<step>/<type>`) whose digest covers the full id list (1 to 100,000), and lists the ids in order; `verifyBatch(tx, ledgerId)` recomputes it. Run `infrabyx-migrate`.

### Patch Changes

- Updated dependencies [97e8524]
- Updated dependencies [92706c4]
- Updated dependencies [4a87754]
- Updated dependencies [d66ffad]
  - @infrabyx/contracts@1.14.0
  - @infrabyx/config@1.5.2
  - @infrabyx/crypto@1.3.1

## 1.4.4

### Patch Changes

- Updated dependencies [32b53ee]
- Updated dependencies [cff2a02]
  - @infrabyx/crypto@1.3.0
  - @infrabyx/contracts@1.13.0
  - @infrabyx/config@1.5.1

## 1.4.3

### Patch Changes

- Updated dependencies [63c5ad2]
- Updated dependencies [63c5ad2]
  - @infrabyx/config@1.5.0
  - @infrabyx/contracts@1.12.0
  - @infrabyx/crypto@1.2.7

## 1.4.2

### Patch Changes

- 3f20011: An `external` principal is recorded as a `user` actor in the ledger (R1-D-29); its entries name the grant it reads under.
- Updated dependencies [2e3a2d3]
- Updated dependencies [3f20011]
  - @infrabyx/contracts@1.11.0
  - @infrabyx/config@1.4.1
  - @infrabyx/crypto@1.2.6

## 1.4.1

### Patch Changes

- Updated dependencies [138ae44]
- Updated dependencies [138ae44]
  - @infrabyx/config@1.4.0
  - @infrabyx/contracts@1.10.0
  - @infrabyx/crypto@1.2.5

## 1.4.0

### Minor Changes

- 2b307e0: The ledger records the context's branch (`audit/0004`, `branch_id`, R1-D-26). The chain covers it only when it is set, so existing entries verify unchanged.

### Patch Changes

- Updated dependencies [2b307e0]
  - @infrabyx/contracts@1.9.0
  - @infrabyx/config@1.3.2
  - @infrabyx/crypto@1.2.4

## 1.3.0

### Minor Changes

- cd25633: Database-level statutory audit capture (Finbyx PR-FBX-10 item 2; R1-D-25). Migration `audit/0003` adds `audit.register_capture('<schema>.<table>')`: every insert, update and delete on a registered table is captured with before and after values, actor, entity, branch, break-glass grant, trace, action, reason, database login and role, and transaction id. Rows go into a per-tenant hash chain that only `audit.capture_row()` writes and nobody changes. Event triggers refuse disabling it. `StatutoryCapture`, `AuditService.verifyCapture` and `AuditSweep.verifyCaptureAll` are the gap detector. The daily anchor's format 2 signs the capture head, and `verifyCaptureAgainstAnchor` checks an export against it.

### Patch Changes

- Updated dependencies [cd25633]
  - @infrabyx/contracts@1.8.0
  - @infrabyx/config@1.3.1
  - @infrabyx/crypto@1.2.3

## 1.2.7

### Patch Changes

- Updated dependencies [94b706e]
  - @infrabyx/config@1.3.0

## 1.2.6

### Patch Changes

- Updated dependencies [f5622c9]
- Updated dependencies [f5622c9]
  - @infrabyx/config@1.2.0
  - @infrabyx/contracts@1.7.0
  - @infrabyx/crypto@1.2.2

## 1.2.5

### Patch Changes

- Updated dependencies [ceabe3b]
  - @infrabyx/contracts@1.6.0
  - @infrabyx/config@1.1.1
  - @infrabyx/crypto@1.2.1

## 1.2.4

### Patch Changes

- Updated dependencies [849b8f9]
- Updated dependencies [849b8f9]
- Updated dependencies [849b8f9]
  - @infrabyx/config@1.1.0
  - @infrabyx/contracts@1.5.0
  - @infrabyx/crypto@1.2.0

## 1.2.3

### Patch Changes

- Updated dependencies [7e38652]
- Updated dependencies [7e38652]
  - @infrabyx/contracts@1.4.0
  - @infrabyx/crypto@1.1.0
  - @infrabyx/config@1.0.6

## 1.2.2

### Patch Changes

- Updated dependencies [b6058d3]
  - @infrabyx/contracts@1.3.0
  - @infrabyx/config@1.0.5
  - @infrabyx/crypto@1.0.3

## 1.2.1

### Patch Changes

- Updated dependencies [1c869a8]
  - @infrabyx/config@1.0.4

## 1.2.0

### Minor Changes

- 75e9ea4: `AuditSweep` (PR-UDF-013): `verifyAll()` for the weekly chain verification and `anchorAll(date)` for the daily anchor of every tenant (IPB-02-51), over `TenantSweep`.

### Patch Changes

- Updated dependencies [75e9ea4]
  - @infrabyx/contracts@1.2.0
  - @infrabyx/config@1.0.3
  - @infrabyx/crypto@1.0.2

## 1.1.1

### Patch Changes

- Updated dependencies [8a2587e]
  - @infrabyx/config@1.0.2

## 1.1.0

### Minor Changes

- 588b509: Migration `audit/0002` lets the outbox relay (`svc_outbox_relay`, R1-D-01) append the ledger entry of each batch it dispatches, under the ledger's tenant and actor policy; no read and no other table.

### Patch Changes

- Updated dependencies [588b509]
  - @infrabyx/contracts@1.1.0
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

## 0.1.5

### Patch Changes

- Updated dependencies [b3934f9]
  - @infrabyx/config@0.5.1

## 0.1.4

### Patch Changes

- Updated dependencies [de53086]
- Updated dependencies [de53086]
- Updated dependencies [f1a36a1]
- Updated dependencies [1fecf45]
- Updated dependencies [1fecf45]
- Updated dependencies [b0dc390]
- Updated dependencies [b0dc390]
- Updated dependencies [275d4ba]
- Updated dependencies [934355c]
- Updated dependencies [686d24b]
- Updated dependencies [e8e83cb]
- Updated dependencies [275d4ba]
- Updated dependencies [36338c3]
- Updated dependencies [934355c]
- Updated dependencies [b7de3c6]
  - @infrabyx/config@0.5.0
  - @infrabyx/contracts@0.5.0
  - @infrabyx/crypto@0.4.1

## 0.1.3

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
  - @infrabyx/contracts@0.4.0
  - @infrabyx/config@0.4.0
  - @infrabyx/crypto@0.4.0

## 0.1.2

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
  - @infrabyx/config@0.3.0
  - @infrabyx/contracts@0.3.0
  - @infrabyx/crypto@0.3.0

## 0.1.1

### Patch Changes

- Updated dependencies [5482043]
- Updated dependencies [efd00ab]
- Updated dependencies [2969424]
- Updated dependencies [858a76a]
- Updated dependencies [9ac878e]
- Updated dependencies [ded1ae2]
- Updated dependencies [9c774b9]
- Updated dependencies [9ac878e]
- Updated dependencies [9ac878e]
- Updated dependencies [858a76a]
- Updated dependencies [7a36249]
- Updated dependencies [7a36249]
- Updated dependencies [13c7379]
- Updated dependencies [13c7379]
- Updated dependencies [13c7379]
- Updated dependencies [0c4535d]
- Updated dependencies [0c4535d]
  - @infrabyx/crypto@0.2.0
  - @infrabyx/config@0.2.0
  - @infrabyx/contracts@0.2.0

## 0.1.0

### Minor Changes

- 7dc104c: PL1 audit ledger: database-computed SHA-256 hash chain over RFC 8785 canonical JSON with per-tenant heads, insert-only for every role, actor bound to the verified context, correction entries, a TypeScript verifier that reports the first break and emits LedgerChainBroken, and signed daily anchors written with retention through the STORAGE and KMS ports. Migration `audit/0001_init.sql`.

  Audience: developer · Reg: none · Notice class: standard

### Patch Changes

- c2cf60a: PL0 toolchain baseline: pnpm 9 lockfile, Turborepo pipeline, ESLint 10 flat config with the IPB
  rules `ipb/vendor-import`, `ipb/schema-boundary` and `ipb/no-process-env` (placeholders),
  Vitest, Prettier, Renovate per IPB-01 §01.4.1.2, SHA-pinned CI and release workflows, and the
  `ipb:check` structural checks. Released with the seven PL1 packages at 0.1.0 (PL1-D-02 / D-06); the fifteen later-phase packages stay unpublished scaffolds until their own phase.

  Audience: internal · Reg: none · Notice class: standard

- Updated dependencies [c2cf60a]
- Updated dependencies [542194d]
- Updated dependencies [a17086c]
- Updated dependencies [8f44a2c]
  - @infrabyx/config@0.1.0
  - @infrabyx/contracts@0.1.0
  - @infrabyx/crypto@0.1.0
