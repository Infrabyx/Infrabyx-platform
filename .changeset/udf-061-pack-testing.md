---
"@infrabyx/testing": minor
---

Lender contract cases for PR-UDF-061 items 12 to 17 (R1-D-236): the envelope `subject` is the aggregate id and `seq` counts per subject from 1, also with two applications interleaved; the signed `ExecutionPackIssued` follows the acceptance, names the accepted KFS and lists the CF para 9(3) set of shared documents; a business-purpose loan's pack declares the wilful-defaulter covenant; the KFS and the sanction letter name their shared file by id and version; `CoolingOffExitAnswered` verifies as a regulated message; a v2 document JWS binds the type, media type, size and application; the retrieval answer's size matches the bytes. The document cases now accept the application first (the pack follows the acceptance). `lspEvent` sets `subject` to the aggregate id and counts `seq` per subject unless `seq` is given.
