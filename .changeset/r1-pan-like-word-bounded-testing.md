---
"@infrabyx/testing": patch
---

The BUREAU and COMPANY_DATA contract cases match a PAN only as a whole word, so a PAN-shaped run inside a random ULID (a consent id) no longer fails the "known subject" case at random.
