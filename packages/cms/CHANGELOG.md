# @infrabyx/cms

## 1.1.6

### Patch Changes

- Updated dependencies [b6058d3]
- Updated dependencies [b6058d3]
  - @infrabyx/contracts@1.3.0
  - @infrabyx/tenancy@1.3.0
  - @infrabyx/brand@1.0.7
  - @infrabyx/config@1.0.5
  - @infrabyx/crypto@1.0.3
  - @infrabyx/ui@1.1.2

## 1.1.5

### Patch Changes

- Updated dependencies [1c869a8]
  - @infrabyx/config@1.0.4
  - @infrabyx/brand@1.0.6
  - @infrabyx/tenancy@1.2.1

## 1.1.4

### Patch Changes

- Updated dependencies [75e9ea4]
- Updated dependencies [75e9ea4]
  - @infrabyx/contracts@1.2.0
  - @infrabyx/tenancy@1.2.0
  - @infrabyx/brand@1.0.5
  - @infrabyx/config@1.0.3
  - @infrabyx/crypto@1.0.2
  - @infrabyx/ui@1.1.1

## 1.1.3

### Patch Changes

- Updated dependencies [c0ce8ff]
- Updated dependencies [2724cd6]
  - @infrabyx/tenancy@1.1.3
  - @infrabyx/brand@1.0.4

## 1.1.2

### Patch Changes

- Updated dependencies [8a2587e]
- Updated dependencies [8a2587e]
  - @infrabyx/config@1.0.2
  - @infrabyx/tenancy@1.1.2
  - @infrabyx/brand@1.0.3

## 1.1.1

### Patch Changes

- Updated dependencies [53a973c]
  - @infrabyx/tenancy@1.1.1
  - @infrabyx/brand@1.0.2

## 1.1.0

### Minor Changes

- 84e4200: `BLOCK_EDITOR` (the block forms `BLOCK_EDITOR_SPECS` and `RICH_TEXT_CODEC`) gives the Studio block editor (PR-038, R1-D-02) a form for every block type of the library, and a rich text codec: `textToPortableText` reads paragraphs, `##` headings, `-` and `1.` lists, `>` quotations, `**bold**`, `_italic_`, `` `code` ``, `[links](/path)` and media-library images into portable text and runs the sanitiser over the result; `portableTextToText` writes portable text back the same way, escaping anything that would read as markup. Each new block starts from a template that is valid once its reference (a media, form, testimonial or plan id) is filled. No schema, migration or setting changes.

### Patch Changes

- Updated dependencies [84e4200]
- Updated dependencies [588b509]
- Updated dependencies [588b509]
  - @infrabyx/ui@1.1.0
  - @infrabyx/contracts@1.1.0
  - @infrabyx/tenancy@1.1.0
  - @infrabyx/brand@1.0.1
  - @infrabyx/config@1.0.1
  - @infrabyx/crypto@1.0.1

## 1.0.0

### Major Changes

- 9ec9a2c: 1.0.0, the platform baseline release (IPB-14 §14.5 item 1; owner answer #67(4), PL6-D-16). Every `@infrabyx/*` package moves to 1.0.0 together; the public API is unchanged from the 0.x set of the PL6 gate (`docs/phases/PL6-gate.md` §6), so a product upgrades by moving every dependency to 1.0.0 at once. From 1.0.0 on, semantic versioning holds: a breaking change to an export, a migration or a setting is a major release with an ADR (IPB-09-34/35).

### Patch Changes

- Updated dependencies [9ec9a2c]
  - @infrabyx/brand@1.0.0
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
  - @infrabyx/brand@0.1.1

## 0.1.0

### Minor Changes

- 1fecf45: Owner answers #53 and #55 (PL5-D-11), with migration `cms/0004_renditions_notices.sql`.

  - **Renditions (#53):** with a MEDIA port, `MediaLibrary` stores AVIF, WebP and a JPEG or PNG fallback at the fixed widths for each raster upload, refuses images the port cannot decode or above the pixel limit, and `sources()` returns the `<picture>` sources. The 90-day purge removes renditions with their media.
  - **Notice period (#55):** a MAJOR change to the Terms or Payment Terms takes effect only 30 days (`pol.notice_days`) after users are notified, the later of `PolicyStudio.publishNotice` and `recordNoticeSent` (or the `notifyPolicyChange` hook returning `sentAt`). `noticeStatus` and `PublicPolicies.upcoming` show where a change stands.
  - **What to wire:** pass `media` and `settings` to `MediaLibrary`; publish each MAJOR Terms notice in Studio and report the NOTIFY send time.

- b0dc390: The CMS core (PL5 session 4, IPB-04 §04.3.1).

  - **Migration and content:** migration `cms/0001_init.sql` (`infrabyx-migrate` applies it after `brand`). Content items have immutable revisions and the named publish state machine, with maker-checker and legal review.
  - **Lint:** the Claims Register and the publish lint (`claims/words.json`), plus the allow-list sanitiser (`@infrabyx/cms/sanitise`).
  - **Routing and SEO:** slugs, redirects with loop and chain detection, and a CSV dry run. SEO, JSON-LD, the sitemap, robots.txt, `llms.txt` and RSS builders.
  - **Preview and publishing:** preview links. The scheduler, `CmsScheduler.tick()`, runs every minute. The public reader and the read-only `/api/public/v1` handler.
  - **Media and footer:** the media library, which strips EXIF and serves uploads as uploaded. The footer validator with `infrabyx-cms validate-footer`, and `brandFooterHook` for Brand Studio.
  - **Purge:** soft-deleted content, redirects and media are deleted 90 days after deletion by `CmsPurge.sweep()`, run daily (OWNER-QUESTIONS #48).

- db4c83f: Policies (PL5 session 5a, IPB-05), with migration `cms/0002_policies.sql`.

  - **Templates and sets:** the 17 template skeletons, and policy sets whose parameters go through maker-checker.
  - **Versions:** each policy instance has its versions and its lint, approval by the legal reviewer, super admin and DPO, an immutable approved text, effective dates with supersede and re-consent, and the review cadence.
  - **Brand Studio hook:** `policySetHook()` for Brand Studio.
  - **Public reader:** `PublicPolicies` serves the current version, prior versions and `/legal/index.json`.
  - **What to wire:** run `PolicyStudio.tick()` with the CMS scheduler, and `emitReviewDue` daily.

- 36338c3: Resources, forms and pricing (PL5 session 5b), with migration `cms/0003_resources_forms.sql`.

  - **`ResourceService`:**
    - versions at `?v=`, with cite-as text;
    - withdrawal of a version;
    - gated downloads (public, email gate, login, plan) served by 300-second presigned URLs;
    - download records that keep the CRM lead reference;
    - `ResourceReviewDue`.
  - **`FormService`:** consent comes before the hand-off to CRM, HR or SUPPORT, and no field values are stored.
  - **`PricingService`:**
    - catalogue-only prices with GST labels;
    - a 5-minute cache and a 24-hour stale limit;
    - a drip-pricing and false-urgency lint, wired through the new `CmsStudio` option `extraLint`.
  - **Media:** `MediaLibrary.upload({ gated: true })` stores the file in a private bucket.
  - **Pricing copy:** `pricing_copy` is now a strict schema with no price field.

- b7de3c6: PL5 session 7: `PublicPolicies.officers(packId)` reads the Grievance Officer and Data Protection Officer from the pack's policy set parameters (`grievance_officer`, `grievance_email`, `grievance_address`, `dpo_name`, `dpo_email`), so a site's footer shows the officers from the policy set and never from code.
- b50922c: PL5 session 8a: Studio readers `CmsStudio.redirects(ctx, packId, { state? })` (`RedirectSummary`), `CmsStudio.claims(ctx, { status? })` (`ClaimSummary`) and `MediaLibrary.list(ctx, { kind?, missingAlt? })` (`MediaSummary`; `missingAlt` is the alt-text queue).
- 1076df2: PL5 session 8b: Studio readers `PolicyStudio.setFor(ctx, packId)` (`PolicySetSummary`, with pending parameters) and `PolicyStudio.instances(ctx, setId)` (every version by key, newest first).

### Patch Changes

- 1e2fe19: PL5 gate: an `embed` block's URL must be an https address on its provider's own hosts (`EMBED_HOSTS`; no IP literal, private name, port, credentials or look-alike host), so it is refused on save and never fetched (`@IPB-04-AT-94`).
- Updated dependencies [de53086]
- Updated dependencies [de53086]
- Updated dependencies [f1a36a1]
- Updated dependencies [f1a36a1]
- Updated dependencies [f1a36a1]
- Updated dependencies [1fecf45]
- Updated dependencies [1fecf45]
- Updated dependencies [1fecf45]
- Updated dependencies [e8e83cb]
- Updated dependencies [b0dc390]
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
- Updated dependencies [b50922c]
- Updated dependencies [1076df2]
- Updated dependencies [f1da214]
- Updated dependencies [e8e83cb]
- Updated dependencies [275d4ba]
- Updated dependencies [8dfe167]
  - @infrabyx/config@0.5.0
  - @infrabyx/contracts@0.5.0
  - @infrabyx/brand@0.1.0
  - @infrabyx/ui@0.1.0
  - @infrabyx/tenancy@0.5.0
  - @infrabyx/crypto@0.4.1
