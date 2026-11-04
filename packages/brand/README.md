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

Migration `brand/0002_tenant_layer.sql` (PR-LDC-26) adds the tenant brand layer:

- `brand.tenant_layer_version`, a tenant's layer versions (one active, at most one pending), each immutable once written, with its base pack, approval request and the version it reverts to;
- `brand.tenant_host`, the applied tenant domains. A host is unique group-wide across `brand.host` and tenant domains, in code and by trigger.

Both are tenant rows with RLS enabled and forced. A tenant sees only its own; a context in the platform tenant also reads `brand.tenant_host` (the host resolver runs before any tenant is known), never the layers.

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

## Tenant brand layer

`TenantBrandLayers` (PR-LDC-26, R1-D-87) lets a tenant set a layer over its product's pack: colour tokens the pack already defines, a logo and a favicon (SVGs through the sanitiser, `uploadSvg`), a letterhead (PDF, PNG, JPEG or a sanitised SVG in the tenant's own storage), an email identity, a domain and a login message (plain text, at most 280 characters). The legal entity, terminology, policy set, consent, store identity and everything else stay the pack's.

```
propose ──▶ pending_approval ──approve──▶ active (the previous version superseded)
revert(to) ──▶ a new version with that body ──approve──▶ active
```

- `propose` is made by ORG_ADMIN or ORG_OWNER in the tenant (never an agent or a platform context). It runs every guard a pack publish uses: the contrast guard on the resulting colour set (`IPB-BRD-003`), sanitised SVGs under the tenant's own keys (`IPB-BRD-001`; another tenant's or a changed asset is `IPB-STOR-001`), the letterhead type (`IPB-SEC-010`), a verified email domain through the NOTIFY hook (`IPB-BRD-005`), and a domain that is no pack host and no other tenant's domain (`IPB-BRD-002`). It raises a `brand.tenant_layer.change` request at R3.
- A tenant checker (ORG_CHECKER, ORG_ADMIN or ORG_OWNER, never the maker) approves through the approvals engine. The executor runs the guards again, applies the version, replaces the tenant's domain row, and records `brand.tenant_layer.apply` (or `.revert`) in the same transaction. A guard that fails then refuses the approval and the request stays pending.
- A domain is recorded verified only when the `domainVerified` hook (EDGE `verifyDomain`) says so; an unverified domain never selects the layer.
- `resolveForTenant` and `resolveHost` return the pack with the layer applied and run the contrast guard again; when a pack change makes the layer's colours fail, the pack's colours are served and `tenant_colours_dropped` is reported. `BrandStudio.resolve` resolves a verified tenant domain to its base pack and names the tenant.
