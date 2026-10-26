## Summary

<what and why>

## Plan

Plan file: docs/phases/PLn-plan.md · Phase exit gate: <link or "n/a"> · Change class: standard | normal | emergency
Regulatory impact: none | reg:dpdp | reg:rbi | reg:sebi | reg:cert-in | reg:gst
IPB files read for this change: IPB-01, IPB-02, IPB-09, <others>

## IPB conformance checklist (mandatory)

Tick every item. Write `n/a — <reason>` after an item that does not apply and tick it; the `pr-checklist` check blocks any unticked item (IPB-09-03).

- [ ] Nothing under `docs/ipb/` or `docs/ecosystem/` is edited (request goes to `docs/platform-requests.md`)
- [ ] No vendor SDK outside `packages/connectors/` (IPB-01-14, `vendor-import` lint)
- [ ] Module = schema = bounded context respected; no cross-module table access (IPB-01-09, `schema-boundary` lint)
- [ ] All new tables tenant-scoped with RLS enabled + forced (IPB-02-12, `rls-lint`)
- [ ] All new columns tagged with a data class (IPB-02-19)
- [ ] Settings keys registered in `packages/config` before read (IPB-07; no `process.env` outside `packages/config`, IPB-01-19)
- [ ] Flags registered with owner and expiry (IPB-09-24)
- [ ] Migrations: expand-only in this PR; contract tracked separately; nothing destructive in the same release (IPB-09-28)
- [ ] Backfills idempotent and batched (IPB-09-29)
- [ ] Export map unchanged OR version bumped with a changeset (IPB-09-34/35)
- [ ] Audit ledger written in the same transaction for every mutation (IPB-02)
- [ ] Maker-checker applied for R2+ actions (IPB-02 §02.4.6.1)
- [ ] Errors use RFC 9457 with code / help_key / trace_id (IPB-10)
- [ ] Events follow `in.<product>.<module>.<Event>.v<n>`; Ecosystem events proposed, not improvised (IPB-10)
- [ ] Accessibility: axe clean on changed screens (IPB-06)
- [ ] Help keys added for new terms (IPB-07)
- [ ] Acceptance tests for the IPB IDs implemented added or updated (`@IPB-nn-AT-xx`)
- [ ] Changeset added (or label `no-changeset` with reason)
- [ ] Threat model `docs/security/threat-model.md` updated for any new port, adapter, package or data flow, and whenever CONFIDENTIAL+ data is touched (IPB-02 §02.4.10, PL2-D-43)
- [ ] No secrets, `.env` values or `SEED_CREDENTIALS.md` in the diff
- [ ] `docs/STATUS.md` updated; assumptions logged in `docs/DECISIONS.md`

## Tests

<unit / contract / e2e added, and the IPB acceptance-test IDs they cover>

## Rollback

<how to roll back: flag, image digest, migration phase>
