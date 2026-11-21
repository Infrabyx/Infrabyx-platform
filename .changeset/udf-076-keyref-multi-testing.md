---
"@infrabyx/testing": minor
---

A built-in STORAGE contract case for `keyRefStatuses` (Udofin PR-UDF-076; R1-D-261): several classes in one call, each equal to `keyRefStatus`'s answer, the disabled key unavailable in each class with `describeKey`, fixed labels only, and a malformed class list refused `IPB-PORT-003`. A leg configures `lender:contract` and `lender:contract-off` in `REGULATED` and `QUARANTINE` (as for PR-UDF-066); an adapter without per-object keys declares `keyRefStatuses` `unsupported`. An adapter without the optional method (a product's own) passes the case unchecked, so existing suites keep passing.
