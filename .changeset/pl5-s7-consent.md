---
"@infrabyx/consent": minor
---

PL5 session 7: the preference centre's category help keys are literal strings (`hlp.consent.functional`, `.analytics`, `.marketing`), so `hlp-lint` checks them against the platform registry.

`ConsentTexts.drafts(ctx)` lists the texts waiting for the PLT_LEGAL_REVIEWER (the Studio queue and the public-site seed).

Fixes found by the group site's accessibility gate: the banner controller posts to the form's `action` attribute (a `<button name="action">` no longer hides `form.action`), the cookie table scrolls inside a labelled region, and the category fieldsets shrink to 320 px (`min-width: 0`).
