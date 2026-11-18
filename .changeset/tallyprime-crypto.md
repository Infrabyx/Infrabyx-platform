---
"@infrabyx/crypto": minor
---

Agent request proofs (PR-FBX-46, R1-D-178): `signAgentRequest`, `verifyAgentRequest`, `generateAgentKeyPair` and `agentPublicJwk`, the C-22 profile with its own `typ` (`ipb-agent-request+jws`), bound to tenant, agent, `seq`, method, path and body digest. No new primitive.
