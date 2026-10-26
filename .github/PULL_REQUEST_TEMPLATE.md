## What and why

## IPB conformance checklist (IPB-09 PR template)

- [ ] The change implements requirements by ID (list: `IPB-nn-xx`) and does not edit anything under `docs/ipb/` or `docs/ecosystem/`
- [ ] Acceptance tests for those IDs added or updated (`@IPB-nn-AT-xx`)
- [ ] No vendor SDK imported outside `packages/connectors/` (vendor-import lint)
- [ ] No cross-module table access (schema-boundary lint); RLS lint green
- [ ] Migrations follow expand → migrate → contract; no destructive change in the same release
- [ ] No secrets, `.env` values or seed credentials in the diff
- [ ] Changeset added; `docs/STATUS.md` updated; assumptions logged in `docs/DECISIONS.md`
