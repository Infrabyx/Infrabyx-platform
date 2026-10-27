# @infrabyx/brand

Brand packs and Brand Studio (IPB-04 §04.3.2; Ecosystem §5.4). It covers maker-checker publish and rollback, the contrast guard, the SVG logo sanitiser, the favicon set and web manifest, the per-host brand map, and display-name terminology.

**Specified by:** `docs/ipb/` IPB-04 (§04.3.2, §04.4.1, §04.4.3) with IPB-06-59 and IPB-07-32 for contrast. Its acceptance tests are the `@IPB-..-AT-..` scenarios tagged in `src`.

**Status:** PL5 session 3. The package stays private until the PL5 gate (`docs/phases/PL5-plan.md` §5.2).

## Data

Migration `brand/0001_init.sql` creates:

- `brand.pack` (`brd_`);
- `brand.pack_revision` (`brv_`), immutable once written, with the checker and legal reviewer each set once and never equal to the maker;
- `brand.host`, where a host belongs to one pack group-wide;
- the module outbox and inbox.

All rows are platform rows. Every context reads them, and only a platform context writes them, through the kernel with an audit ledger entry.

## Flow

```
saveDraft ──▶ submit ──▶ [legalReview] ──▶ approve ──▶ published
requestRollback(to) ──▶ new revision (rollback_of) ──▶ approve
```

- `saveDraft` refuses a failing contrast guard (`IPB-BRD-003`, with pair, scheme, ratio and a suggested colour) and records the rejection with `ContrastGuardFailed`. It also refuses a host already mapped to another pack (`IPB-BRD-002`).
- `submit` checks the publish preconditions: a sanitised SVG logo (`IPB-BRD-001`), a verified email domain through the NOTIFY hook (`IPB-BRD-005`), a published policy set (`IPB-BRD-006`), at least one free host, and the footer validator hook.
- `legalReview` is needed when a legal-class field changed. A PLT_LEGAL_REVIEWER performs it.
- `approve` is done by a second PLT_SUPER_ADMIN or a PLT_RELEASE_MANAGER. It publishes the pack, replaces its host rows, and emits `BrandPackPublished` (or `BrandPackRolledBack`).
- `resolve` chooses a pack from the `Host` header against published hosts only. An unknown host gets the product default pack with `noindex`, and the event is logged (`IPB-BRD-007`). `X-Forwarded-Host` never selects a pack.
