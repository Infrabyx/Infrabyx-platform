---
"@infrabyx/testing": minor
---

The lender contract case on the signed execution pack also checks each stamp certificate's `certificate_document_id` against the rule of R1-D-258 (Udofin PR-UDF-075 (4)): a shared document of the same application and, when the pack lists it, not stamp-required and not itself stamped. A lender endpoint that shared the certificate under another application passed before and fails now.
