---
"@infrabyx/tenancy": minor
---

The Ecosystem inbox (Spec §3.5; G2): migration `0006` adds `tenancy.create_ecosystem_inbox('<schema>')`, and `EcosystemInbox` stores each event before processing, de-duplicates by `(source, id)` and business key, processes in `seq` order per subject, parks gaps for 15 minutes, replays them through the product's callback and turns a gap still open into a reconciliation break. Every write is ledgered.
