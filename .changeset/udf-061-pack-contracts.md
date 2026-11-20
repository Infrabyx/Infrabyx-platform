---
"@infrabyx/contracts": minor
---

PR-UDF-061 items 12 to 17 and the owner's approval of PR-047 (Ecosystem Spec v1.6 proposal), 20 Nov 2026 18:50 IST (R1-D-236). Additive: no existing field, type or export changes shape.

- **Regulated from v1.6:** `ExecutionPackIssued` and `CoolingOffExitAnswered` join `REGULATED_MESSAGE_EVENTS` (59 names). A consumer of either now verifies its detached JWS (`X-Infrabyx-JWS`) and refuses it unsigned with `signature-invalid`, as for the other regulated messages; a lender signs both from this minor.
- **New §6.2 event `ExecutionPackIssued`** (`in.infrabyx.origination.ExecutionPackIssued.v1`, FX → UD, key `(pack_id, version)`, signed): `ExecutionPackIssuedData` with the accepted KFS (`kfs_version`, `kfs_sha256`, which a `KFS` document in the pack must match), `documents[].instrument_code` (required on an executed document; an IT Act First Schedule instrument, `IT_ACT_FIRST_SCHEDULE_INSTRUMENTS`, is never executed by eSign or DSC) and `enclosure_code`, `covenant { business_purpose, declared }` with `covenant_declaration` present exactly when declared and required for a business purpose, `enclosure_list [{ code, clause_ref }]` (each furnished by exactly one pack document), per-document `stamp_evidence` (`PackStampEvidence`: channel, certificate number, State, duty, stated duty, stamped-document hash, issue time, vendor certificate id, certificate document), the pack-level `not_stampable [{ document_id, reason }]`, and `signers` as the `PACK_SIGNER_ROLES` enum. `CF_PARA_9_3_DOCUMENT_KINDS` names the CF para 9(3) set. `ExecutionPackManifest` is unchanged and now documented as the deprecated interim carrier.
- **Subjects (§3.2):** each `ORIGINATION_EVENTS` entry names its `subject` field (the aggregate id) and `originationSubject(name, data)` answers it; `DOCUMENT_EVENTS.DocumentShared.subject` is `document_id`. `seq` counts per subject.
- **Documents:** `DocumentSharedData.language` (optional, BCP 47); `DocumentRetrieval` takes optional `media_type`, `size_bytes`, `type` and `application_id` (the fields a v2 document JWS binds); the doc comment states when `application_id` may be omitted.
- **`KFSIssued` and `SanctionLetterIssued`:** optional `document_version` beside `document_ref`.

No setting, no migration.
