---
"@infrabyx/contracts": minor
"@infrabyx/testing": minor
---

The TELEPHONY port (Finbyx PR-FBX-38; ADR-0007; R1-D-97): `TelephonyPort` with `clickToCall` (a person or the product's service places it, never an agent; idempotent on its key), `callOutcome`, `storeRecording` (only when the request named a recording disclosure and the adapter reports it was played; stored in the tenant's STORAGE under the request's output prefix with its retention and `deleteAfter`) and `cancel`; catalogue row `TELEPHONY` (tier 2, `int.telephony.`). `@infrabyx/testing` adds `FakeTelephony` and `telephonyContractCases`. No adapter until a provider is chosen.
