# @infrabyx/consent

The cookie CMP and the consent ledgers (IPB-04 §04.3.9; IPB-05 template 18; owner rule O-2). It provides:

- the server-rendered banner and preference centre, plus a small first-party controller;
- versioned consent texts;
- the consent ledger behind the CONSENT port;
- the acceptance ledger for Terms-class and Privacy-class documents;
- script gating and the locked sensitive routes;
- the consent-record purge (OWNER-QUESTIONS #48).

**Specified by:** `docs/ipb/` IPB-04 (§04.3.9, IPB-04-75…88) and IPB-05 (template 18, §05.4.19). Its acceptance tests are the `@IPB-04-AT-8x` scenarios tagged in `src`.

**Status:** PL5 session 5c. The package stays private until the PL5 gate (`docs/phases/PL5-plan.md` §6).

## Data

Migration `consent/0001_init.sql` creates:

- `consent.text` (`ctx_`): versioned strings. A PLT_DPO drafts them and a PLT_LEGAL_REVIEWER approves them; the reviewer is never the maker. Approved wording never changes.
- `consent.record` (`cns_`): append-only. Each record keeps the exact text shown.
- `consent.acceptance` (`acc_`): append-only.
- The `svc_consent_sweep` reader, the outbox and the inbox.

A consent record is deleted 3 years after the end of its life (#48). Its life ends when a later record for the same person and pack replaces it, or when its cookie expires. PostgreSQL refuses any other delete.

## Use

- **`ConsentTexts`.** Use `draft`, `approve`, `current` and `version`. `seedDefaults` seeds IPB-05 template 18 and the region banners as drafts.
- **`PgConsentLedger`.** This is the `pg_local` CONSENT adapter: append-only, exact text, `ConsentRecorded`. `OhConsentLedger` is the HTTP adapter for OH; it is unproven until OH exposes the ledger.
- **CMP logic.**
  - `regionFor` returns the region: IN, EU (GDPR) or US-CA (Do Not Sell or Share).
  - `bannerState` works out GPC and re-prompting when the banner version changes. On authenticated routes it drops marketing.
  - `decide`: closing or pressing Escape is Reject.
  - `handleConsentPost` is `POST /api/consent`, used with or without JavaScript. It writes one ledger record per choice and sets the first-party `ibx_cid` and `ibx_consent` cookies.
- **Components.** `CookieBanner` and `PreferenceCentre`. Accept all, Reject all and Manage use the same `Button` with the same variant. `CMP_CSS` and `CMP_CONTROLLER_JS` are served as `/consent.js` under the CSP nonce.
- **Gating.**
  - `gatedScripts` returns the scripts a page may declare, all inert `text/plain` (`renderGatedScripts`).
  - Marketing tags never render on sensitive or authenticated routes (`IPB-WEB-005`). `LOCKED_SENSITIVE_ROUTES` lists those routes; products may add to it, never remove from it.
  - `NoneTagManager` and `NoneAnalytics` are the only adapters at launch (OWN-09).
- **`AcceptanceLedger`.** Use `record`, `pending` and `assertNotRefused`; a refused document gives `IPB-POL-010`, which puts the account in read-only mode with export.
- **`ConsentPurge.sweep()`.** Run it daily.
