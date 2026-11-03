---
"@infrabyx/consent": minor
---

Consent to a product's own purposes (Finbyx PR-FBX-26; IPB-04-78; DPDP Act 2023 s.5–6; R1-D-38). Migration `consent/0003` adds `consent.purpose_notice` (a tenant's notice per purpose and language, versioned, approved by a person other than its maker, immutable once approved, SHA-256 computed by the database) and `consent.purpose_record` (append-only grants and withdrawals, each grant naming the exact notice version, language and SHA-256). `PurposeConsents` takes the product's purposes (`<product>.<area>[.<detail>]`), drafts, approves, retires and serves notices (`currentNotice`), records `grant` and `withdraw`, and reads `consentState(subject, purpose)`; each change is ledgered, and with an outbox emits `PurposeConsentChanged`. Run `infrabyx-migrate`.
