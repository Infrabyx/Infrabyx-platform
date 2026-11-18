---
"@infrabyx/contracts": minor
"@infrabyx/connectors": minor
---

Owner answer #136 (4) (R1-D-184): how a TallyPrime agent keeps its key, and a 90-day key life. `AgentEnrolRequest.keyProtection` (`dpapi` or `file`; omitted by older agents, read as `file`), `TALLY_AGENT_KEY_MAX_DAYS` (90), `TALLY_AGENT_KEY_WARN_DAYS` (80), `TALLY_KEY_PROTECTIONS`; `TallyAgentView` gains `keyProtection`, `keyExpiresAt`, `rotationDue` and `warnings` (`key_unencrypted`, `key_expired`). `connectors`: migration `connectors/0008` (`tally_agent.key_protection`, set once with the key); the enrolment records the protection and, for `file`, a warning in its ledger entry; from day 90 the gateway refuses the agent's requests until it is enrolled again. The agent (1.1.0, built from source) keeps its key under Windows DPAPI for its service account through Windows PowerShell 5.1, with the key on standard input only; the mode-0600 file is the fallback elsewhere. Runbook `docs/runbooks/tally-agent.md`.
