---
"@infrabyx/contracts": minor
"@infrabyx/testing": minor
---

The `BUREAU` and `AA_FIU` product ports of IPB-01 §01.4.4.3 (owned by FBX v1.6), with fakes and contract cases (Finbyx PR-FBX-28; R1-D-43; ADR-0003). `contracts`: `CreditBureauPort` (`pull` with a soft or hard enquiry to CIBIL, Experian, Equifax or CRIF, refused without the product's consent receipt; the raw report by STORAGE reference with its SHA-256, the CIC's format version and a normalised summary in integer paise; `status`; `handleWebhook` reads the pull back) and `AccountAggregatorPort`, the FIU side (`requestConsent` with the ReBIT template, `consentStatus`, `revoke` in full or by FI type, `fetch` only under an ACTIVE consent within its range and FI types, each payload by STORAGE reference with its ReBIT schema version and SHA-256, `handleWebhook`); both catalogued (tier 2, owner FBX v1.6, `int.bureau.`, `int.aa_fiu.`) and in `R1_PORTS`. `testing`: `FakeCreditBureau`, `FakeAccountAggregator`, `creditBureauContractCases` and `accountAggregatorContractCases`. Vendor adapters wait for the owner's sandbox documents and accounts.
