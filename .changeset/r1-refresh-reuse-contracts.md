---
"@infrabyx/contracts": minor
---

`refreshSession` on the IDENTITY port (optional, `IPB-PORT-001` `unsupported` where absent): the refresh-token grant with rotation, returning `RefreshedTokens` with a new refresh token every time; a spent token presented again revokes its session and raises `IPB-IDN-001` with `meta.reason: "refresh_reused"`, any other refused token `"refresh_invalid"` (`REFRESH_REFUSAL_REASONS`); `IdentitySessionRefresh` names the grant with `verifyToken` for contract cases and fakes (PR-LDC-03; R1-D-77).
