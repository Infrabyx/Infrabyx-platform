# R1 — PR-FBX-57: connectors scan what they write before it is `ready`

**Status: approved by the owner, 27 Nov 2026 16:10 IST, with one change to Design 3 (R1-D-302). Built 27 Nov 2026 (R1-D-304): the tags are hyphenated (`ipb-scan-verdict`, as `ipb-key-ref`), the quarantined copy has its own key, and the Connector Agent [VERIFY] closed (it stores no file).** Finbyx PR-FBX-57, accepted by the owner (27 Nov 2026 07:45 IST, B.1; R1-D-295). No owner stop is needed: it applies the existing IPB-02-44 rules (`IPB-SEC-011`, `IPB-SEC-015`) to files the connectors write themselves.

## Today

| Writer                                                             | Writes                                                                                                                                                                | Where                                                  | Scanned |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ------- |
| BUREAU `cibil` (`connectors/src/bureau/cibil.ts`)                  | the raw report JSON, then `state: "ready"`                                                                                                                            | STORAGE `REGULATED`, `report: { storageKey, sha256 }`  | no      |
| ACCOUNT_AGGREGATOR `setu` (`connectors/src/aa-fiu/setu.ts`)        | each FI payload JSON                                                                                                                                                  | STORAGE `REGULATED`, `payloads[].{storageKey, sha256}` | no      |
| The Connector Agent (`apps/tally-agent`, the accounting agent API) | **[VERIFY]** which files the agent hands the platform (today vouchers arrive as bounded JSON bodies, `TALLY_AGENT_MAX_BODY_BYTES`); every file it uploads is in scope | —                                                      | no      |
| ACCOUNTING agent adapter                                           | not shipped yet; follows the same rule when it ships                                                                                                                  | —                                                      | —       |

## Design

1. **One shared step**, `writeScanned(storage, scan, { key, bytes, contentType, bucketClass }, port, adapter)` in `connectors/src/core`:
   1. write the bytes to `QUARANTINE` under the key (same named key reference, `promotedObjectMeta`, R1-D-240);
   2. `FILE_SCAN.scan({ storageKey, sha256 })` (the port never throws for a failed scan);
   3. `CLEAN`: promote to the target class with the scan recorded as object tags (`ipb:scan_verdict`, `ipb:scan_engine`, `ipb:scanned_at`, `ipb:scan_sha256`) and return `{ storageKey, sha256, scan }`;
   4. `INFECTED`: refuse `IPB-SEC-011` (reason `infected`), leave the quarantined object for the AV owner, nothing `ready`;
   5. `ERROR` or an outage: refuse `IPB-SEC-015` (reason `not_clean`), nothing `ready`; the pull or fetch can be retried and scans again.
2. **The ref carries the scan:** `BureauFileRef` and `FiPayload` gain `scan: ScanProof` (verdict, file, engine, scanned at), so `assertScannedClean(ref.scan, ref.sha256, port)` verifies it anywhere. `contracts` minor (an added field; whole-object assertions gain `scan`).
3. **Adapters take `scan?: FileScanPort`, optional in 1.x** (owner, 27 Nov 2026 16:10 IST; R1-D-302). A required argument would break every product that builds these adapters today, so:
   - without `scan`, construction does not fail, but every write refuses `IPB-SEC-015` (reason `scan_required`) and nothing becomes `ready`: fail closed at run time, in every environment;
   - outside local and test, the adapter logs one warning at start-up naming itself and the missing FILE_SCAN port, so a product notices before the first pull;
   - the changeset says plainly that a product must pass its FILE_SCAN adapter to the bureau and account aggregator adapters, or their pulls refuse;
   - `scan` becomes required at construction in **2.0.0**, a major that needs the owner's approval.
4. **Fakes:** `FakeBureau` and the AA fake attach a CLEAN scan from the in-memory scanner; `fakes` patch.

## Contract cases (`testing`, `@IPB-02-AT-16` style)

- EICAR as the vendor's report body: refused `IPB-SEC-011`, no `ready` state, no object at the clean key.
- The scanner down (`ERROR`, `unavailable`): refused `IPB-SEC-015`, retried later, then `ready` once CLEAN.
- The record verifiable: `assertScannedClean(ref.scan, ref.sha256)` passes on a `ready` ref; it fails on a ref whose bytes changed.
- The same three on the AA leg and on each agent upload.

## Release

`connectors`, `contracts` and `testing` minors, `fakes` patch, threat model §3.196, guide section, DECISIONS row. Products adopt by passing their FILE_SCAN adapter to the bureau and AA adapters.

## Addendum: removing the quarantined copy (owner answer #216, 27 Nov 2026 22:55 IST; R1-D-309, R1-D-310)

The owner changed #216: once a promotion is verified, the quarantined copy is deleted, with an audit event in the same unit of work. The owner's answer is the approval the locked list needs for this deletion; nothing else is deleted and the promoted record's retention is unchanged. A `connectors` and `testing` patch, as the owner directed.

1. **Read-back, always:** after the CLEAN promotion, `writeScanned` reads the promoted object back. Only if its SHA-256 equals the scanned one is the file `ready`. A read-back that fails or differs keeps both copies and refuses `IPB-SEC-015` (reason `promotion_unverified`, `readBack` `failed` or `differs`, the quarantine key in `meta`).
2. **Removal, when the adapter has a unit of work:** `CibilBureau` and `SetuAccountAggregator` take `removal?: { kernel, audit, context }` (the `PgDigilockerPullStore` pattern). In one `kernel.mutate`, the audit entry (`connectors.scanned_write.quarantine_removed`, resource the quarantine key; after: reason `promoted_clean_copy_removed`, both keys, the SHA-256, port and adapter) is written, then STORAGE deletes the quarantined copy. If the delete or the entry fails, the transaction rolls back, both copies stay, and the write refuses `IPB-SEC-015` (reason `quarantine_not_removed`). A context that names another tenant is refused `IPB-PORT-001` (`tenant_mismatch`), both copies kept.
3. **Without `removal` (1.x):** the copy is kept, as in 1.38.0, and the constructor warns once outside local and test. A patch cannot require a new argument; making `removal` required belongs with `scan` in 2.0.0.
4. **INFECTED and ERROR copies are never deleted** (no code path reaches the delete before the read-back of a CLEAN promotion).

**Contract cases** (`testing`, `quarantineRemovalHarness`): CLEAN leaves no quarantined copy and exactly one entry naming it; a read-back that differs or fails keeps both copies with no entry; a failed delete rolls its entry back and keeps the copy; INFECTED and ERROR keep their copies with no entry. Run on the CIBIL and Setu hermetic legs beside the existing cases (which still run without `removal`).
