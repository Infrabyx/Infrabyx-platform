---
"@infrabyx/testing": minor
---

PR-UDF-054 (E8; R1-D-245): `estampRecordContractCases(fixtures)`, the contract cases of ESTAMP's optional `recordCertificate` (declared, REGULATED and IN; once per key, read back, attached to one document, evidence that parses as `PackStampEvidence`; a certificate used once; the shared refusals), with `StampRecordFixtures`, `BoughtStamp` and `fakeStampRecordFixtures()`. Stubs `startShcilEstampStub()` and `startDigioEstampStub()` answer a read-back of a certificate the RE bought (stub-shaped, to confirm against the sandboxes); neither has a purchase route. Additive.
