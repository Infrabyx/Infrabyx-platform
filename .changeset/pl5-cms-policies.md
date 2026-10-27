---
"@infrabyx/cms": minor
---

Policies (PL5 session 5a, IPB-05), with migration `cms/0002_policies.sql`.

- **Templates and sets:** the 17 template skeletons, and policy sets whose parameters go through maker-checker.
- **Versions:** each policy instance has its versions and its lint, approval by the legal reviewer, super admin and DPO, an immutable approved text, effective dates with supersede and re-consent, and the review cadence.
- **Brand Studio hook:** `policySetHook()` for Brand Studio.
- **Public reader:** `PublicPolicies` serves the current version, prior versions and `/legal/index.json`.
- **What to wire:** run `PolicyStudio.tick()` with the CMS scheduler, and `emitReviewDue` daily.
