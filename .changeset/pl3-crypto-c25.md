---
"@infrabyx/crypto": minor
---

C-25 (PL3-C-02): `verifyLeegalityMac`, HMAC-SHA1 verification only, for Leegality webhooks:
constant-time comparison and a replay window when a timestamp is sent. `hmac-sha1` is in the
algorithm registry for that use only.
