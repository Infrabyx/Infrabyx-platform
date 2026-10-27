---
"@infrabyx/consent": minor
---

PL5 session 7: the preference centre's category help keys are literal strings (`hlp.consent.functional`, `.analytics`, `.marketing`), so `hlp-lint` checks them against the platform registry.

`ConsentTexts.drafts(ctx)` lists the texts waiting for the PLT_LEGAL_REVIEWER (the Studio queue and the public-site seed).
