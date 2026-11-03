---
"@infrabyx/tenancy": minor
---

`ApprovalsEngine.consumeMandateApproval` and `mandateVerifier` (R1-D-66): an approved `payments.mandate.change` request at R3 or above is consumed once, under the row lock and with a ledger entry, only for the same tenant, operation, mandate and amount; the action is registered by the engine and never executed on approval or by hand.
