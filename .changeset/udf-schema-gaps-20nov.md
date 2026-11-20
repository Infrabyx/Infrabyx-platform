---
"@infrabyx/contracts": minor
"@infrabyx/fakes": minor
"@infrabyx/testing": minor
---

Owner's addendum of 20 Nov 13:10 (R1-D-231), all optional and additive. `contracts/events`: the shared offer schema is exported as `OriginationOffer` and takes `monthly_instalment { amount_paise, frequency }` (`INSTALMENT_FREQUENCIES`), `penal_charges` (`PenalCharge`, at most 20: a basis code, exactly one of `rate_bp` or `amount_paise`, a description; `PENAL_CHARGE_BASES`, [VERIFY] against RBI's Penal Charges directions) and `kfs_link { document_id, version? }` (a document reference, never a URL) (PR-UDF-051); each `ExecutionPackManifest.documents[]` item takes `stamp_evidence` (`StampEvidence`: `STAMP_EVIDENCE_MODES` `ESTAMP`, `PAPER`, `FRANKING`, State, certificate number, duty in paise, stamped document SHA-256, optional vendor reference; `STAMP_EVIDENCE_MODE_OF` maps the pack-level `STAMP_MODES`) and `not_stampable` with `not_stampable_reason`, refused with stamp evidence or `stamp_required: true` (PR-UDF-053). `fakes`: `FakeLender`'s offers carry an EMI and a penal charge, its sanctioned offer a KFS link, its loan agreement stamp evidence and its KFS `not_stampable`. `testing`: two lender contract cases for them.
