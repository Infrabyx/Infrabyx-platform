---
"@infrabyx/contracts": minor
---

Optional `lsp_application_ref` on `LoanDisbursedData` (Udofin PR-UDF-061 finding (i); R1-D-256), the LSP's own application reference with the shape it has on `CoolingOffExitAnswered`, so an LSP can tell which application was disbursed. `application_id` stays optional: making it required, or adding a rule that one of the two is present, would refuse a payload valid before, so the schema documents that a lender sends one or both and the lender contract cases require it. The envelope subject is unchanged (`loan_id`, R1-D-236).
