---
"@infrabyx/contracts": minor
"@infrabyx/connectors": minor
"@infrabyx/fakes": minor
"@infrabyx/testing": minor
---

Owner answers of 20 Nov 10:50 (R1-D-229), all optional and additive. `contracts/events`: `KfsIssuedData.loan_amount_paise` (the KFS "Loan amount", integer paise, distinct from the net disbursed amount; PR-UDF-051); `ExecutionPackManifest.disbursement_clause { document_id, page_or_clause_ref, amount_stated_paise }`, whose document must be in the pack (PR-UDF-053); `SecurityIncidentNotifiedData.cert_in_category` (`CERT_IN_INCIDENT_CATEGORIES`, CERT-In Directions Annexure I) and `cert_in_report_by` (at most `detected_at` + 6 h), with `certInReportBy(noticedAt)` and `CERT_IN_REPORT_WINDOW_MS`, carried by `securityIncidentClockCopy` (PR-FBX-51, #159 (a)). `connectors`: a `tenantNamedKmsKeyIds` value may be `{ keyId, bucketKey?: boolean }` (`NamedKmsKey`); `bucketKey: false` writes and presigned uploads under that reference with S3 Bucket Keys off (a KMS request per object operation); the string form is unchanged, Bucket Keys on (PR-UDF-058, #165 (3)). `fakes`: `FakeLender` sends the KFS loan amount and the manifest's disbursement clause. `testing`: two lender contract cases for them; the GRC incident case sends the CERT-In fields.
