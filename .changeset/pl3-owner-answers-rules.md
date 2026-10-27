---
"@infrabyx/rules": minor
---

Owner answer #21 (PL3-D-21): an UNDETERMINED decision's review task goes to ORG_CHECKER, or to
ORG_ADMIN when the tenant has no checker (`hasRoleHolder`); the principal whose request produced
it is excluded; it escalates to ORG_ADMIN after 48 hours. One `rules.decision.record` ledger entry
per decision stays.
