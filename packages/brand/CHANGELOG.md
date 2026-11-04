# @infrabyx/brand

## 1.1.0

### Minor Changes

- 1dda4b2: `TenantBrandLayers` (R1-plan M57; PR-LDC-26; R1-D-90): a tenant layer over the product's pack (colour tokens the pack defines, a sanitised SVG logo and favicon, a letterhead asset, an email identity on a verified domain, a domain, a plain-text login message), never the legal entity or terminology. `propose` and `revert` raise a `brand.tenant_layer.change` R3 approval (ORG_ADMIN or ORG_OWNER make, the default tenant checkers check); the executor runs every guard again (contrast on the resulting colours, SVG sanitiser, verified email domain, host uniqueness across pack hosts and tenant domains) and applies the version with an audit ledger entry in the same transaction. `resolveForTenant` and `resolveHost` return the pack with the layer applied, re-running the contrast guard (`tenant_colours_dropped` when a pack change makes the layer's colours fail). `BrandStudio.resolve` now resolves a verified tenant domain to its base pack and names the tenant (`HostResolution.tenantId`), and pack saves refuse a tenant's domain (`IPB-BRD-002`). Migration `brand/0002` adds `brand.tenant_layer_version` and `brand.tenant_host` (expand-only, RLS forced); apply it before upgrading, as `BrandStudio.resolve` reads the new table.

### Patch Changes

- Updated dependencies [1dda4b2]
- Updated dependencies [1dda4b2]
- Updated dependencies [1dda4b2]
  - @infrabyx/tenancy@1.14.0
  - @infrabyx/config@1.11.0
  - @infrabyx/contracts@1.21.0
  - @infrabyx/crypto@1.5.6
  - @infrabyx/ui@1.2.9

## 1.0.27

### Patch Changes

- Updated dependencies [b8c1f2c]
- Updated dependencies [b8c1f2c]
  - @infrabyx/contracts@1.20.0
  - @infrabyx/tenancy@1.13.0
  - @infrabyx/config@1.10.1
  - @infrabyx/crypto@1.5.5
  - @infrabyx/ui@1.2.8

## 1.0.26

### Patch Changes

- Updated dependencies [c8b8f88]
- Updated dependencies [c8b8f88]
- Updated dependencies [c8b8f88]
- Updated dependencies [c8b8f88]
- Updated dependencies [c8b8f88]
- Updated dependencies [c8b8f88]
- Updated dependencies [c8b8f88]
- Updated dependencies [c8b8f88]
- Updated dependencies [c8b8f88]
  - @infrabyx/tenancy@1.12.0
  - @infrabyx/contracts@1.19.0
  - @infrabyx/config@1.10.0
  - @infrabyx/crypto@1.5.4
  - @infrabyx/ui@1.2.7

## 1.0.25

### Patch Changes

- Updated dependencies [9c368c7]
- Updated dependencies [9c368c7]
- Updated dependencies [9c368c7]
- Updated dependencies [9c368c7]
  - @infrabyx/tenancy@1.11.0
  - @infrabyx/contracts@1.18.0
  - @infrabyx/config@1.9.2
  - @infrabyx/crypto@1.5.3
  - @infrabyx/ui@1.2.6

## 1.0.24

### Patch Changes

- Updated dependencies [714ad01]
  - @infrabyx/contracts@1.17.0
  - @infrabyx/config@1.9.1
  - @infrabyx/crypto@1.5.2
  - @infrabyx/tenancy@1.10.1
  - @infrabyx/ui@1.2.5

## 1.0.23

### Patch Changes

- Updated dependencies [b3edda2]
- Updated dependencies [b3edda2]
- Updated dependencies [b3edda2]
- Updated dependencies [b3edda2]
- Updated dependencies [b3edda2]
  - @infrabyx/config@1.9.0
  - @infrabyx/tenancy@1.10.0
  - @infrabyx/contracts@1.16.0
  - @infrabyx/crypto@1.5.1
  - @infrabyx/ui@1.2.4

## 1.0.22

### Patch Changes

- Updated dependencies [fdd1f1a]
- Updated dependencies [ed143e3]
  - @infrabyx/config@1.8.0
  - @infrabyx/tenancy@1.9.2

## 1.0.21

### Patch Changes

- Updated dependencies [2a95100]
- Updated dependencies [2a95100]
  - @infrabyx/config@1.7.0
  - @infrabyx/crypto@1.5.0
  - @infrabyx/tenancy@1.9.1

## 1.0.20

### Patch Changes

- Updated dependencies [7910610]
- Updated dependencies [1b99d7a]
- Updated dependencies [c83e9e0]
- Updated dependencies [af2ae98]
- Updated dependencies [c4117e4]
- Updated dependencies [1e721cd]
- Updated dependencies [854e309]
- Updated dependencies [854e309]
- Updated dependencies [0da0398]
- Updated dependencies [05c3122]
  - @infrabyx/tenancy@1.9.0
  - @infrabyx/contracts@1.15.0
  - @infrabyx/config@1.6.0
  - @infrabyx/crypto@1.4.0
  - @infrabyx/ui@1.2.3

## 1.0.19

### Patch Changes

- Updated dependencies [97e8524]
- Updated dependencies [e41c3bd]
- Updated dependencies [92706c4]
- Updated dependencies [92706c4]
- Updated dependencies [4a87754]
- Updated dependencies [d66ffad]
  - @infrabyx/contracts@1.14.0
  - @infrabyx/tenancy@1.8.0
  - @infrabyx/config@1.5.2
  - @infrabyx/crypto@1.3.1
  - @infrabyx/ui@1.2.2

## 1.0.18

### Patch Changes

- Updated dependencies [32b53ee]
- Updated dependencies [cff2a02]
  - @infrabyx/crypto@1.3.0
  - @infrabyx/contracts@1.13.0
  - @infrabyx/config@1.5.1
  - @infrabyx/tenancy@1.7.2
  - @infrabyx/ui@1.2.1

## 1.0.17

### Patch Changes

- Updated dependencies [63c5ad2]
- Updated dependencies [63c5ad2]
- Updated dependencies [63c5ad2]
  - @infrabyx/config@1.5.0
  - @infrabyx/contracts@1.12.0
  - @infrabyx/ui@1.2.0
  - @infrabyx/tenancy@1.7.1
  - @infrabyx/crypto@1.2.7

## 1.0.16

### Patch Changes

- Updated dependencies [2e3a2d3]
- Updated dependencies [2e3a2d3]
- Updated dependencies [3f20011]
- Updated dependencies [3f20011]
  - @infrabyx/contracts@1.11.0
  - @infrabyx/tenancy@1.7.0
  - @infrabyx/config@1.4.1
  - @infrabyx/crypto@1.2.6
  - @infrabyx/ui@1.1.10

## 1.0.15

### Patch Changes

- Updated dependencies [138ae44]
- Updated dependencies [138ae44]
- Updated dependencies [138ae44]
  - @infrabyx/config@1.4.0
  - @infrabyx/contracts@1.10.0
  - @infrabyx/tenancy@1.6.0
  - @infrabyx/crypto@1.2.5
  - @infrabyx/ui@1.1.9

## 1.0.14

### Patch Changes

- Updated dependencies [2b307e0]
- Updated dependencies [2b307e0]
  - @infrabyx/contracts@1.9.0
  - @infrabyx/tenancy@1.5.0
  - @infrabyx/config@1.3.2
  - @infrabyx/crypto@1.2.4
  - @infrabyx/ui@1.1.8

## 1.0.13

### Patch Changes

- Updated dependencies [cd25633]
- Updated dependencies [cd25633]
  - @infrabyx/contracts@1.8.0
  - @infrabyx/tenancy@1.4.0
  - @infrabyx/config@1.3.1
  - @infrabyx/crypto@1.2.3
  - @infrabyx/ui@1.1.7

## 1.0.12

### Patch Changes

- Updated dependencies [94b706e]
  - @infrabyx/config@1.3.0
  - @infrabyx/tenancy@1.3.5

## 1.0.11

### Patch Changes

- Updated dependencies [f5622c9]
- Updated dependencies [f5622c9]
  - @infrabyx/config@1.2.0
  - @infrabyx/contracts@1.7.0
  - @infrabyx/tenancy@1.3.4
  - @infrabyx/crypto@1.2.2
  - @infrabyx/ui@1.1.6

## 1.0.10

### Patch Changes

- Updated dependencies [ceabe3b]
  - @infrabyx/contracts@1.6.0
  - @infrabyx/config@1.1.1
  - @infrabyx/crypto@1.2.1
  - @infrabyx/tenancy@1.3.3
  - @infrabyx/ui@1.1.5

## 1.0.9

### Patch Changes

- Updated dependencies [849b8f9]
- Updated dependencies [849b8f9]
- Updated dependencies [849b8f9]
  - @infrabyx/config@1.1.0
  - @infrabyx/contracts@1.5.0
  - @infrabyx/crypto@1.2.0
  - @infrabyx/tenancy@1.3.2
  - @infrabyx/ui@1.1.4

## 1.0.8

### Patch Changes

- Updated dependencies [7e38652]
- Updated dependencies [7e38652]
  - @infrabyx/contracts@1.4.0
  - @infrabyx/crypto@1.1.0
  - @infrabyx/config@1.0.6
  - @infrabyx/tenancy@1.3.1
  - @infrabyx/ui@1.1.3

## 1.0.7

### Patch Changes

- Updated dependencies [b6058d3]
- Updated dependencies [b6058d3]
  - @infrabyx/contracts@1.3.0
  - @infrabyx/tenancy@1.3.0
  - @infrabyx/config@1.0.5
  - @infrabyx/crypto@1.0.3
  - @infrabyx/ui@1.1.2

## 1.0.6

### Patch Changes

- Updated dependencies [1c869a8]
  - @infrabyx/config@1.0.4
  - @infrabyx/tenancy@1.2.1

## 1.0.5

### Patch Changes

- Updated dependencies [75e9ea4]
- Updated dependencies [75e9ea4]
  - @infrabyx/contracts@1.2.0
  - @infrabyx/tenancy@1.2.0
  - @infrabyx/config@1.0.3
  - @infrabyx/crypto@1.0.2
  - @infrabyx/ui@1.1.1

## 1.0.4

### Patch Changes

- Updated dependencies [c0ce8ff]
- Updated dependencies [2724cd6]
  - @infrabyx/tenancy@1.1.3

## 1.0.3

### Patch Changes

- Updated dependencies [8a2587e]
- Updated dependencies [8a2587e]
  - @infrabyx/config@1.0.2
  - @infrabyx/tenancy@1.1.2

## 1.0.2

### Patch Changes

- Updated dependencies [53a973c]
  - @infrabyx/tenancy@1.1.1

## 1.0.1

### Patch Changes

- Updated dependencies [84e4200]
- Updated dependencies [588b509]
- Updated dependencies [588b509]
  - @infrabyx/ui@1.1.0
  - @infrabyx/contracts@1.1.0
  - @infrabyx/tenancy@1.1.0
  - @infrabyx/config@1.0.1
  - @infrabyx/crypto@1.0.1

## 1.0.0

### Major Changes

- 9ec9a2c: 1.0.0, the platform baseline release (IPB-14 §14.5 item 1; owner answer #67(4), PL6-D-16). Every `@infrabyx/*` package moves to 1.0.0 together; the public API is unchanged from the 0.x set of the PL6 gate (`docs/phases/PL6-gate.md` §6), so a product upgrades by moving every dependency to 1.0.0 at once. From 1.0.0 on, semantic versioning holds: a breaking change to an export, a migration or a setting is a major release with an ADR (IPB-09-34/35).

### Patch Changes

- Updated dependencies [9ec9a2c]
  - @infrabyx/config@1.0.0
  - @infrabyx/contracts@1.0.0
  - @infrabyx/crypto@1.0.0
  - @infrabyx/tenancy@1.0.0
  - @infrabyx/ui@1.0.0

## 0.1.1

### Patch Changes

- Updated dependencies [9d8cd8c]
- Updated dependencies [b3934f9]
  - @infrabyx/tenancy@0.6.0
  - @infrabyx/config@0.5.1

## 0.1.0

### Minor Changes

- f1a36a1: Owner answer #52 (PL5-D-05): the contrast guard checks each colour against the roles it is used in. A primary keeps the strict rule (at least 3:1 on the surface, text on it at least 4.5:1). An accent may be lighter, but only as a filled background with text on it at least 4.5:1; on a light surface it is never text, an icon, a border or a focus ring. Each failure carries its `role` and `reason` (`contrast` with the nearest compliant colour, or `role_not_permitted`). `contrastGuard` takes `roles` for a product's extra uses; `COLOUR_ROLES`, `DEFAULT_ROLES` and `isLightSurface` are exported.
- 1fecf45: Owner answer #53 (PL5-D-11): with a MEDIA port, `BrandStudio.uploadLogo` rasterises the sanitised logo into the 32, 64, 180, 192 and 512 px PNG favicons and returns them as `png` for the revision's `logo.png` (`reencodeEnabled` reads `cms.media.reencode_enabled`).
- e8e83cb: Brand packs for PL5 (IPB-04 §04.3.2):

  - **Data:** migration `brand/0001_init.sql` (packs, immutable revisions and the group-wide host map).
  - **Brand Studio:** maker-checker publish with legal review for legal-class fields, and rollback through a new revision (`@IPB-04-AT-28`). Publish preconditions cover the email identity (`@IPB-04-AT-26`) and the policy set.
  - **Contrast guard:** refuses low-contrast colours with a suggested colour (`@IPB-04-AT-23`, `@IPB-06-AT-11`, `@IPB-07-AT-24`).
  - **Media:** the allow-list SVG sanitiser (`@IPB-04-AT-21`) and the favicon set and manifest (`@IPB-04-AT-22` at file level).
  - **Hosts and names:** host resolution that ignores `X-Forwarded-Host` (`@IPB-04-AT-27`), and display-name terminology (`@IPB-04-AT-25`).

  The package stays private until the PL5 gate.

- b0dc390: `BrandStudioHooks.validateFooter(ctx, body, packId)` now receives the pack id, so `@infrabyx/cms` `brandFooterHook` can check that pack's published footer before a brand pack is submitted.
- b50922c: PL5 session 8a: Studio readers `BrandStudio.packs(ctx, { product? })` (`PackSummary`), `revisions(ctx, packId)` (newest first) and `pending(ctx)` (revisions waiting for approval).

### Patch Changes

- Updated dependencies [de53086]
- Updated dependencies [de53086]
- Updated dependencies [f1a36a1]
- Updated dependencies [f1a36a1]
- Updated dependencies [1fecf45]
- Updated dependencies [1fecf45]
- Updated dependencies [b0dc390]
- Updated dependencies [b0dc390]
- Updated dependencies [b0dc390]
- Updated dependencies [275d4ba]
- Updated dependencies [934355c]
- Updated dependencies [686d24b]
- Updated dependencies [686d24b]
- Updated dependencies [e8e83cb]
- Updated dependencies [275d4ba]
- Updated dependencies [36338c3]
- Updated dependencies [934355c]
- Updated dependencies [b7de3c6]
- Updated dependencies [b7de3c6]
- Updated dependencies [b50922c]
- Updated dependencies [1076df2]
- Updated dependencies [f1da214]
- Updated dependencies [e8e83cb]
- Updated dependencies [275d4ba]
- Updated dependencies [8dfe167]
  - @infrabyx/config@0.5.0
  - @infrabyx/contracts@0.5.0
  - @infrabyx/ui@0.1.0
  - @infrabyx/tenancy@0.5.0
  - @infrabyx/crypto@0.4.1
