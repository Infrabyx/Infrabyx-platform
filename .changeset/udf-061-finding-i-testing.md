---
"@infrabyx/testing": minor
---

The lender contract case on `LoanDisbursed` now requires at least one of `application_id` and `lsp_application_ref`, each naming the application submitted (Udofin PR-UDF-061 finding (i); R1-D-256). A lender endpoint that sent neither passed before and is now refused by this case; the event schema itself still accepts it.
