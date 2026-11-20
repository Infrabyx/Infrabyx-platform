---
"@infrabyx/contracts": minor
---

A customer step-up for sensitive borrower actions (Udofin PR-UDF-056; R1-D-244). New `CUSTOMER_ACR_VALUES` (`otp`), `CustomerAcr`, `CustomerStepUpPolicy` (`acr`, `maxAgeSeconds` 60 to 3600, default 300), `CUSTOMER_STEP_UP_DEFAULT`, `CUSTOMER_STEP_UP_MAX_AGE`, `CustomerStepUpAction`, `customerStepUpPolicies(table)` (validates and freezes a product's table at boot) and `CustomerStepUp`. `CustomerIdentityPort` gains optional `startStepUp` and `confirmStepUp`, and `verifyRequest` an optional `fresh` flag; `VerifiedCustomerClaims` gains an optional `auth_time`, and its `acr` is now the platform's customer level. An adapter without the new methods refuses with IPB-PORT-001 `unsupported`; nothing existing changes for implementers.
