---
"@infrabyx/contracts": minor
"@infrabyx/connectors": minor
"@infrabyx/fakes": minor
"@infrabyx/testing": patch
---

A return URL on the ESP's hosted signing page (Udofin PR-UDF-086; R1-D-287). `contracts`: `Signer.returnUrl`, an optional `returnUrl` on `aadhaarEsign` and `dscSign`, `returnUrlProblem` and `ESIGN_RETURN_URL_MAX` (https with a host; no query string, fragment or `@`; at most 2,048 characters). `connectors`: Digio passes it in the hosted page's own `redirect_url` parameter, Leegality per invitee at creation (a different session return URL is refused `return_url_fixed`); an invalid one is refused `IPB-PORT-001` `return_url_invalid` before any vendor call. `fakes`: `FakeEsign` checks and records it (`returnUrlOf`). `testing`: tests only.
