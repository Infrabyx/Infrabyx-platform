---
"@infrabyx/testing": minor
---

AA_FIU to STATEMENT_ANALYSIS by reference (Udofin PR-UDF-065; R1-D-243). New `aaStatementAnalysisJoinCases(fixtures)`: contract cases for a STATEMENT_ANALYSIS adapter fed by an Account Aggregator over the same STORAGE (`FakeAccountAggregator` by default): the AA's FI payloads are REGULATED objects under IPB-01-27 keys whose bytes match their SHA-256, the analysis reads them by reference into a REGULATED report, a payload altered or removed after the fetch is refused (`hash_mismatch`, `input_missing`) before any analyser call, and so are a payload outside the REGULATED class (`residency`), a key outside IPB-01-27 and an AA fetch to a prefix outside it. `accountAggregatorContractCases` now checks that every payload's `storageKey` is an IPB-01-27 key, and, when the fixtures give the new optional `storageOf`, reads each payload back (REGULATED, bytes matching its SHA-256). Re-exports `fakeFiPayload`.
