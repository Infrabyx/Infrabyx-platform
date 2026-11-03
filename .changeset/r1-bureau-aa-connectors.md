---
"@infrabyx/connectors": minor
---

The first BUREAU and AA_FIU adapters (owner answer #97; R1-D-61), built against stubs and off until the owner's sandboxes exist:

- **`cibil`** (TransUnion CIBIL) from `@infrabyx/connectors/bureau`: CIBIL pulls only, the raw report in the tenant's REGULATED STORAGE by its SHA-256, a normalised summary in integer paise with no PAN, and `pending` pulls completed by read-back. Off behind `int.bureau.cibil.enabled`.
- **`setu-aa`** (Setu FIU) from `@infrabyx/connectors/aa-fiu`: ReBIT consent requests, fetches only under an ACTIVE consent within its range and FI types, payloads in REGULATED STORAGE with their schema version and hash, masked accounts only, and `approvalUrl` for the customer's approval page. Off behind `int.aa_fiu.setu.enabled`.

Both read every event back from the vendor. The exit map lists both ports, with the second vendor pending.
