---
"@infrabyx/connectors": minor
---

The TallyPrime adapter of the ACCOUNTING sink (PR-FBX-46, R1-D-178), at `@infrabyx/connectors/accounting`: `TallyAccountingSink` (`tallyprime`), `TallyAgentService` (enrolment under R3 maker-checker, one-time codes, revocation) and `TallyAgentGateway` (the framework-free agent API). Migration `connectors/0007` (`tally_agent`, `tally_journal`, `tally_read`, role `svc_tally_poll`). Off until a tenant sets `int.accounting.tally.enabled`; unproven until a TallyPrime sandbox company exists.
