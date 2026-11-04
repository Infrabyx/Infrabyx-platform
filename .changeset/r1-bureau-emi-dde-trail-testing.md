---
"@infrabyx/testing": minor
---

BUREAU and ESTAMP DDE for PR-FBX-35 (R1-D-84): the bureau fake and the CIBIL stub report an EMI on one tradeline and none on another, with a contract case for both; the ESTAMP fake keeps each signer's evidence and takes a not-stampable registration; the NeSL DDE stub records signing evidence (`execute(ddeId, ref, evidence?)`) and non-stampable registrations; `estampDdeContractCases` gains the signer-trail and not-stampable cases.
