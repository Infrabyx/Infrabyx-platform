---
"@infrabyx/testing": minor
---

IDENTITY contract cases for the refresh-token grant, `identityRefreshContractCases(fixtures, { pauseMs })` (rotation; a reused token is `refresh_reused` and revokes the session, its successor and access tokens then fail; an unknown token is `refresh_invalid`; no token in any error), and `FakeIdentitySessions`, a fake that passes them (PR-LDC-03; R1-D-77).
