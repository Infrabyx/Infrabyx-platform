---
"@infrabyx/testing": minor
---

PR-FBX-57 (R1-D-304): `bureauScannedWriteContractCases` and `aaScannedWriteContractCases`: EICAR in the vendor's answer refused `IPB-SEC-011` with nothing promoted, a scanner outage refused `IPB-SEC-015` and then ready on retry, and the scan record verifiable by `assertScannedClean` and on the object. The CIBIL and Setu stubs gain `reportRemarks` and `payloadRemarks` to put text (the EICAR string) in the vendor's answer.
