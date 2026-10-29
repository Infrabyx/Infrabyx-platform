---
"@infrabyx/testing": minor
---

`startDigioKycStub()` for the Digio KYC adapter's hermetic leg. The KYC contract cases now name a minimal call for each method, so an adapter that declares a method `unsupported` is checked to refuse it with the typed error (R1-D-24).
