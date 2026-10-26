# IPB-04 — Public Website and Super-Admin Studio  (Infrabyx Platform Baseline Standard v1.0, 25 October 2026)

> **Status:** Binding for LD, LDC, EQ, FBX, UDF, OH unless a product records an `IPB-DEV` deviation.
> **Related:** IPB-01 (reference stack, ports, shared packages `packages/cms`, `packages/brand`, `packages/feedback`), IPB-02 (security baseline — CSP, sanitisation, ASVS controls referenced here), IPB-03 (AI Gateway and Vidhi AI kernel — labelling of AI-generated content, `LLM_PORT`), IPB-05 (legal policy templates rendered by this module), IPB-06 (accessibility and inclusive design), IPB-07 (UX system, settings tree and help — `Settings › Feedback`, `hlp.` keys, `/help` and `/tutorials` content), IPB-08 (Vendor Assurance Room and Trust Centre — `trust` module mirrors `vad_mirror_*` rendered on `/trust`), the engineering/observability and integrations IPB files (trace ids captured by the feedback widget; incident timelines), Ecosystem Spec v1.2 Part 3 (CloudEvents envelope), Part 5 (billing catalogue and OH8), Part 6 (consent ledger), Part 7 (CRM lead contract).

## 04.1 Purpose and scope

Every Infrabyx product ships a public website at `apps/public` and a super-admin **Studio** inside `apps/console` (owner decision IPB-D-08). This file is the binding specification for both. It covers the headless CMS module, Brand Studio, Pricing Studio, Blog, Vlog, Resources library, standard pages, the footer, the cookie consent manager (CMP), marketing tooling, the feedback widget, the Studio information architecture, settings keys, events, error codes, product adoption notes and acceptance tests.

The purpose is simple. Non-engineers must be able to add, remove, reorder and rewrite public pages, menus, legal pages, pricing copy, blog posts, videos and downloadable resources without a code release, while the platform guarantees that nothing unlawful, unevidenced, inaccessible or privacy-hostile can reach production. The super admin holds the keys; the platform holds the guard-rails.

In scope:

- `packages/cms` (shared implementation; one code base used by all six products, never forked) and the `cms` PostgreSQL schema.
- `packages/brand` and the `brand_pack` object (IPB-D-10).
- `apps/public` rendering (Next.js 16, App Router, React 19, server-rendered).
- Studio screens in `apps/console`.
- Server-side marketing capture, consent-gated tag loading and lead hand-off to Operations Hub CRM.
- The feedback widget shipped in `packages/feedback` and mounted on public and authenticated surfaces.

Out of scope (specified elsewhere): legal text of the policies (IPB-05 holds the templates; this file holds the rendering, versioning and re-consent plumbing); the help centre and tutorials content model (IPB-07; this file only reserves the `/help` and `/tutorials` routes and the navigation entries); the Vendor Assurance Room (IPB-08; this file renders what IPB-08 publishes); billing engine logic (OH8; this file reads the catalogue read-only).

Research used: `R_Jupitice_and_ODR_Websites.md` (sitemap, footer, trust-page patterns, investor-page contents, documentation layers) and `R_Standards_Quick_Reference.md` (DPDP Rules dates, IT Rules synthetic-media labelling, GTM server-side, GIGW 3.0). The Jupitice review shows what to avoid: client-rendered trust blocks that never reach crawlers or screen readers, undated statistics, a privacy policy that predates the DPDP Act, no footer address or CIN, typos frozen into URLs. Every one of those failure modes is a hard requirement here.

## 04.2 Definitions

| Term | Meaning in this file |
|---|---|
| **Studio** | The super-admin surface in `apps/console` that edits everything a public site shows. Roles: `PLT_SUPER_ADMIN`, `PLT_CONTENT_EDITOR`, `PLT_LEGAL_REVIEWER`, `PLT_DPO`, `PLT_RELEASE_MANAGER`, `PLT_AUDITOR_RO`. |
| **Public site** | `apps/public`. Anonymous, server-rendered, cacheable. Never holds tenant data. |
| **Content item** | Any row in `cms.content_item`; typed by `content_type`. Pages, posts, resources, people, jobs, legal pages are all content items. |
| **Block** | A typed JSON node inside a page body (`cms.block`), validated against a registered block schema. Payload-style: ordered array of blocks, each with `blockType`, `props`, `children`. |
| **Revision** | Immutable snapshot of a content item (`cms.revision`). Publishing promotes a revision; rollback promotes an older one. Nothing is edited in place after publication. |
| **Brand pack** | `brd_` object: host map, tokens, logo/favicon, display name, legal entity, policy set, consent config, sitemap, store identity, email identity. One per host. The default pack is the product's own brand (IPB-D-11). |
| **Claims Register** | The product's register of factual public claims (numbers, certifications, customers, awards) with evidence class, source, as-of date and owner. Publish lint rejects any statistic or badge not registered. |
| **Evidence class** | `E0` none (forbidden on public pages) · `E1` internal measurement, dated · `E2` third-party source cited · `E3` certificate or audit report held (document id in IPB-08 room) · `E4` statutory filing. |
| **Maker-checker** | Two distinct humans: the maker proposes, the checker approves. `AGT_*` agents are makers only. Applies to publish of legal pages, pricing copy, brand pack, redirects, footer entity data, coupons, user-post approvals and bulk imports. |
| **Legal review gate** | A publish state that requires `PLT_LEGAL_REVIEWER` sign-off. Mandatory for legal pages, pricing copy, Investors page, Trust Centre, any page containing a Claims Register reference, and any blog post flagged by lint. |
| **CMP** | Consent management platform: the cookie banner, preference centre, script blocker and the consent ledger write. |
| **Sensitive route** | Any authenticated route in `apps/web`, `apps/console`, `apps/delivery`, `apps/ops`; plus public routes that capture personal data (contact, careers apply, grievance, DPA request, resource email gate). No marketing tags ever load on sensitive routes. |
| **Tier (requirements table)** | Obligation level: **M** mandatory for every product; **S** should, deviation needs an `IPB-DEV` entry; **O** optional, controlled by a settings toggle but, where built, must meet the row. |
| **Test column** | How compliance is proven: `AT-xx` refers to §04.8; `CI` means a build-time check; `MAN` means a manual checklist item in the release runbook. |

## 04.3 Requirements

### 04.3.1 Headless CMS module (`packages/cms`, schema `cms`)

The CMS is our own code. It is not a third-party SaaS. It follows the Payload-style block model: strongly typed collections, a block library with JSON schemas, revisions, drafts, scheduled publishing and a REST + typed server API consumed by `apps/public`. Products that already run Payload (EQ) align their collections to this contract (§04.7).

**Content types** (each is a `content_type` enum value with a registered field schema):

| Type | Key fields beyond the common set | Route pattern |
|---|---|---|
| `page` | `template`, `blocks[]`, `nav_hidden` | `/{slug}` or nested `/{parent}/{slug}` |
| `landing_page` | `blocks[]`, `campaign_ref`, `noindex` default true, expiry | `/lp/{slug}` |
| `section` | reusable block group, `blocks[]` | embedded only |
| `nav_menu` | `location` (`header`, `footer_col_*`, `mobile`, `legal`), `items[]` (label, target, external, new_tab, icon, badge) | n/a |
| `footer` | one per brand pack; columns, entity fields (§04.3.8) | n/a |
| `blog_post` | `category_ids[]`, `tag_ids[]`, `author_ids[]`, `excerpt`, `hero_media`, `reading_time` (computed), `canonical_external`, `user_authored`, `source_import_id` | `/blog/{category}/{slug}` |
| `vlog_item` | `provider` (`youtube`, `vimeo`, `self`), `video_id`, `captions[]` (lang, vtt_media_id), `isl_rendition_media_id`, `transcript`, `duration` | `/vlog/{slug}` |
| `resource` | `artefact_type`, `file_media_id`, `version`, `gating`, `cite_as`, `review_due`, `expires_at`, `topics[]`, `pages`, `language` | `/resources/{type}/{slug}` |
| `faq` | `question`, `answer_rich`, `group`, `order`, `json_ld_eligible` | embedded; `/faq` |
| `glossary_term` | `term`, `definition_rich`, `aliases[]`, `hlp_key` link | `/glossary/{slug}` |
| `job` | `department`, `location`, `type`, `description_rich`, `apply_mode` (`form`, `url`, `email`), `closes_at`, `salary_disclosed` | `/careers/{slug}` |
| `team_member` | `name`, `role`, `group` (`leadership`, `team`, `advisory`, `board`), `bio_rich`, `photo_media_id` (optional), `linkedin_url`, `din` (optional, directors), `order` | `/team`, `/leadership` |
| `press_item` | `kind` (`release`, `coverage`), `outlet`, `published_on`, `url` or `body_rich`, `pdf_media_id` | `/press/{slug}` |
| `case_study` | `client_ref` (Claims Register entry), `sector`, `problem`, `approach`, `outcome_stats[]` (each with evidence class), `quote_ids[]` | `/case-studies/{slug}` |
| `testimonial` | `quote`, `person`, `org`, `consent_doc_id` (written permission), `logo_media_id` | embedded |
| `legal_page` | `policy_key` (IPB-05 template id), `effective_at`, `version_label`, `supersedes_revision_id`, `reconsent_required`, `summary_of_changes` | `/legal/{slug}` |
| `changelog_entry` | `release_ref` (`rel_` id), `version`, `released_on`, `audience` (`public`, `tenant`), `items[]` (type, text) | `/changelog` |
| `pricing_copy` | per-plan copy, bullets, FAQ refs, comparison rows, CTA labels, banners, thresholds (§04.3.3) | `/pricing` |
| `form` | `fields[]` (typed), `consent_text_ref`, `destination` (`crm_lead`, `hr_application`, `support_ticket`, `dpa_request`, `grievance`, `webhook`), `anti_spam` config, `success_action` | embedded |
| `redirect` | `from_path`, `to_path`, `status` (301/302/410), `source` (`manual`, `legacy_import`, `slug_change`) | n/a |
| `media` | `kind`, `alt_text` (mandatory for images), `focal_point`, `renditions[]`, `sha256`, `licence_note`, `uploaded_by` | `/m/{id}/{rendition}` |

Common field set on every content item: `id` (prefixed ULID), `brand_pack_id`, `locale`, `translation_group_id`, `slug`, `title`, `status`, `seo` (JSON, §SEO), `owner_user_id`, `created_at`, `updated_at`, `published_revision_id`, `scheduled_revision_id`, `legal_review_status`, `claims_refs[]`, `tags[]`.

**Block library** (registered in `cms.block_type` with JSON schema, a11y rules, and a render component in `packages/ui`):

| Block | Props (abridged) | Guard-rails |
|---|---|---|
| `hero` | eyebrow, heading (h1 only once per page), sub, primary_cta, secondary_cta, media | one `hero` per page; CTA labels from a vetted list or free text passed through dark-pattern lint |
| `feature_grid` | items[] (icon, title, text, link), columns 2–4 | icon from the token icon set only |
| `steps` | ordered items, numbering style | renders `<ol>` |
| `pricing_table` | plan_refs[] from `BILLING_PORT`, copy overlay from `pricing_copy` | prices never typed by hand (§04.3.3) |
| `faq_accordion` | faq_ids[] or inline | emits FAQPage JSON-LD only if all items `json_ld_eligible` |
| `testimonial` | testimonial_ids[] | refuses items without `consent_doc_id` |
| `logo_wall` | logos[] (media, org, claims_ref) | each logo needs a Claims Register entry with permission evidence |
| `cta` | heading, text, button, variant | copy passes dark-pattern lint (no false urgency, no confirm-shaming) |
| `rich_text` | Portable-text JSON | sanitised on save and on render (allow-list) |
| `media` | image or video; click-to-load for third-party video | alt text mandatory; no autoplay with sound; no third-party request before consent |
| `mermaid` | source, caption, fallback_text | rendered server-side to SVG at publish; sanitised; `aria-label` and long description required |
| `embed` | provider from allow-list, url, consent_category | placeholder until consent; URL fetched server-side only through `EGRESS_PORT` allow-list (SSRF guard) |
| `form` | form_id | anti-spam, consent text mandatory for any personal field |
| `resources_list` | filters, limit, gating badge | shows gating state before click |
| `team_grid` | group, layout | photo optional; name and role rendered as text, never only in image |
| `timeline` | items[] (date, title, text, evidence class if numeric) | dates mandatory |
| `stats` | items[] (value, label, claims_ref) | **refuses any item without a Claims Register reference with class ≥E1**; as-of date rendered beside the value |
| `comparison_table` | columns, rows, footnotes | competitor names allowed only with `PLT_LEGAL_REVIEWER` sign-off |
| `tabs` | tabs[] (label, blocks[]) | keyboard operable, WAI-ARIA tabs pattern |

| ID | Requirement | Tier | Test |
|---|---|---|---|
| IPB-04-01 | Build `packages/cms` as own code with the content types and blocks above. No third-party hosted CMS holds public content. | M | CI (dependency scan rejects hosted CMS SDKs) |
| IPB-04-02 | Every write creates an immutable `cms.revision`. Published content is served from `published_revision_id`. Rollback promotes an older revision and records a new revision pointing to it; nothing is edited in place. | M | AT-01 |
| IPB-04-03 | Support `draft → in_review → legal_review → approved → scheduled → published → archived` with the state machine in §04.4.3. Transitions are maker-checker where §04.4.3 says so. | M | AT-02, AT-03 |
| IPB-04-04 | Scheduling: `publish_at` and optional `unpublish_at` in Asia/Kolkata by default; worker promotes at the minute; sitemap and IndexNow update within 60 seconds of publish. | M | AT-04 |
| IPB-04-05 | Preview URLs: signed, expiring (≤24 h), `noindex`, `X-Robots-Tag: noindex`, never cached by the CDN, show a "Preview — not published" banner, show the exact revision id. | M | AT-05 |
| IPB-04-06 | Publish of `legal_page`, `pricing_copy`, `footer`, `redirect`, `brand_pack`, Investors page, Trust Centre page requires maker-checker (two distinct humans) and, for the first five, `PLT_LEGAL_REVIEWER` approval. | M | AT-03 |
| IPB-04-07 | Claims Register lint runs on every publish: any `stats`, `logo_wall`, `testimonial`, `case_study` outcome, or certification badge without a registered claim of class ≥E1 blocks publish with `IPB-CMS-010`. | M | AT-06 |
| IPB-04-08 | SEO/GEO field set on every routable item: `title` (≤60 chars warn), `description` (≤160 warn), `canonical`, `robots` (index/noindex, follow/nofollow), `json_ld_type` (Organization, WebPage, Article, FAQPage, Product, JobPosting, BreadcrumbList, VideoObject, SoftwareApplication), `hreflang` map from translation group, OG title/description/image, Twitter card, `last_reviewed_at`. | M | AT-07 |
| IPB-04-09 | Generate `/sitemap.xml` (index + per-type sitemaps, `lastmod` from published revision), `/robots.txt` (per brand pack), `/llms.txt` and `/llms-full.txt` (curated list of public pages and resources with one-line summaries, regenerated on publish), and push IndexNow on publish/unpublish when `web.seo.indexnow.enabled`. | M | AT-04, CI |
| IPB-04-10 | Redirects manager: 301/302/410 map, CSV import of legacy URLs with dry-run report (conflicts, loops, chains >1), automatic 301 on slug change (maker-checker to disable), loop and chain detection at save, hit counter per redirect, export. | M | AT-08 |
| IPB-04-11 | Media library: alt text mandatory for every image (empty alt allowed only when `decorative=true` is explicitly set with a reason); server-side re-encode of raster images to AVIF + WebP + fallback at fixed widths; EXIF stripped; focal point stored and honoured in crops; SVG passed through sanitiser (§04.3.2); PDFs scanned by `AV_PORT`; `sha256` deduplication; licence note field. | M | AT-09, AT-21 |
| IPB-04-12 | Pages, menus and footer columns are created, removed, reordered and nested in Studio by drag and drop. No code release is needed to add a page, change navigation, or retire a page (retire creates a 410 or a redirect, chosen by the editor). | M | AT-10 |
| IPB-04-13 | Page templates per product (`home`, `product`, `solution`, `article`, `legal`, `landing`, `people`, `resource_index`, `pricing`, `contact`, `trust`, `investors`, `careers`, `press`, `changelog`, `blank`). Templates define required and optional block slots; Studio shows the required slots as a checklist; publish blocks until required slots are filled. | M | AT-10 |
| IPB-04-14 | Multi-locale: every item belongs to a `translation_group`; `en-IN` is the fallback; `hi-IN` is the second supported locale for all products; others optional. Untranslated fields fall back to `en-IN` with `lang` attribute set correctly. Machine translation via `LLM_PORT` creates a draft marked `machine_translated=true` that cannot publish without human review. | M | AT-11 |
| IPB-04-15 | Rich text and all string props are sanitised with a single allow-list sanitiser in `packages/cms/sanitise` at save and at render. Scripts, event handlers, `javascript:` URLs, `data:` URLs (except images from the media library), `<iframe>` outside the `embed` block, and inline styles are stripped. CSP on `apps/public` is nonce-based with no `unsafe-inline` for scripts. | M | AT-20 |
| IPB-04-16 | Every public page server-renders all content in the HTML response. Client-side-only rendering of any content block (the Jupitice "Loading…" failure) is a build failure detected by the SSR snapshot test. | M | CI, AT-12 |
| IPB-04-17 | Every content item records `last_reviewed_at` and an owner; pages not reviewed for `cms.review.stale_days` (default 365) are listed in the Studio "Stale content" queue and emit `ContentStale`. Legal pages use the shorter IPB-05 cadence. | S | AT-13 |
| IPB-04-18 | Studio writes go through the audit ledger (append-only, hash-chained, same transaction) with before/after revision ids, actor, role, IP class and reason. `PLT_AUDITOR_RO` can read and export. | M | AT-01 |
| IPB-04-19 | Public API for the site is read-only, versioned (`/api/public/v1/...`), returns published revisions only, cached with ETag, rate-limited; the Studio API requires an authenticated session with role checks via Cerbos. | M | AT-14 |
| IPB-04-20 | Slug rules: lower-kebab, ASCII or transliterated, reserved slugs blocked (`api`, `admin`, `login`, `m`, `lp`, `legal`, `_next`, `assets`, `sitemap.xml`, `robots.txt`, `llms.txt`, `.well-known`), spell-check warning on slug tokens not in title. Slug changes create a 301 automatically. | M | AT-08 |

### 04.3.2 Brand Studio (`packages/brand`, `brand_pack`)

Brand Studio edits the `brand_pack` object. The product's default pack carries the IPB-D-11 identity. White-label and multi-brand packs (UDF and FBX resale, OH internal brands) are additional packs keyed by host.

**`brand_pack` object (binding shape):**

```json
{
  "id": "brd_01J...",
  "product": "UDF",
  "hosts": ["app.partnerbank.in", "www.partnerbank.in"],
  "status": "published",
  "app_name": "PartnerBank Loans",
  "terminology": { "vidhi": "Sahayak", "workspace": "Branch" },
  "legal_entity": { "name": "...", "cin": "...", "gstin": "...", "registered_office": "...", "entity_type": "private_limited" },
  "logo": { "svg_media_id": "...", "png_media_ids": {"32": "...", "64": "...", "192": "...", "512": "..."}, "dark_variant_media_id": "..." },
  "favicon_set_id": "...",
  "og_default_media_id": "...",
  "tokens": { "colour": { "primary": "#4338CA", "accent": "#F59E0B", "surface": "#FFFFFF", "on_surface": "#111827", "...": "..." }, "font": { "sans": "Plus Jakarta Sans", "mono": "JetBrains Mono", "serif": null }, "density": "comfortable", "radius": "md" },
  "fonts_self_hosted": true,
  "email_identity": { "from_name": "...", "from_address": "no-reply@...", "reply_to": "...", "dkim_selector": "...", "verified": true },
  "policy_set_id": "pol_...",
  "consent_banner": { "region_default": "IN", "regions": ["IN", "EU", "US-CA"], "categories": ["necessary", "functional", "analytics", "marketing"], "style": "bottom_sheet" },
  "footer_id": "...",
  "sitemap": { "include_blog": true, "include_resources": true },
  "store_identity": { "ios_bundle_id": "...", "android_package": "...", "store_listing_name": "..." },
  "analytics": { "tag_manager_adapter": "none", "analytics_adapter": "none" },
  "published_revision_id": "...",
  "created_by": "...", "approved_by": "..."
}
```

| ID | Requirement | Tier | Test |
|---|---|---|---|
| IPB-04-21 | Logo upload accepts SVG and PNG. SVG is sanitised server-side with an allow-list (no `<script>`, `<foreignObject>`, event attributes, external `href`, `<use>` to external, `<style>` with `url()`, `<a>`); the sanitised output is re-serialised and stored; the original is discarded. PNG fallbacks 32/64/192/512 are generated from the sanitised SVG. | M | AT-21 |
| IPB-04-22 | Favicon set generation: `favicon.ico` (16/32), `icon.svg`, `apple-touch-icon.png` (180), `icon-192.png`, `icon-512.png`, `site.webmanifest` with `name` = `brand.app_name`, theme colour from tokens, `maskable` 512. Served per host. | M | AT-22 |
| IPB-04-23 | OG image: default per brand pack plus per-page override; auto-generated 1200×630 template (title, product mark, brand colours) via `IMAGE_GEN_PORT` or deterministic SVG→PNG; alt text stored. | M | AT-07 |
| IPB-04-24 | Colour tokens edited with live preview of six reference screens (home, pricing, article, form, console sidebar, email). **Contrast guard** rejects any text/background token pair below 4.5:1 (normal text) or 3:1 (large text, UI components) per WCAG 2.2 SC 1.4.3 and 1.4.11, computed for light and dark schemes; publish is blocked with `IPB-BRD-003`. Tenant overrides on white-label plans are subject to the same guard. | M | AT-23 |
| IPB-04-25 | Fonts are self-hosted from `STORAGE_PORT` under the brand host (no Google Fonts or other third-party font CDN requests on any route). Allowed formats: WOFF2. Licence note mandatory per font family. `font-display: swap` with size-adjust fallbacks. | M | AT-24, CI |
| IPB-04-26 | Density (`compact`, `comfortable`, `spacious`) and radius tokens apply to `apps/web`/`apps/console` as well through `packages/tokens`; the public site uses `comfortable` unless the pack overrides. | S | MAN |
| IPB-04-27 | `brand.app_name` is the application display name in the browser title, manifest, email subject prefix, PDF headers, store listing and the login screen. The kernel brand "Vidhi AI" is displayed as `terminology.vidhi` when set (white-label), otherwise "Vidhi" (IPB-D-03). Terminology overrides are a flat key→string map applied via `packages/i18n` message interpolation; the kernel identifiers never change. | M | AT-25 |
| IPB-04-28 | Email sender identity per pack: from name, from address, reply-to; the domain must pass SPF, DKIM and DMARC verification through `NOTIFY_PORT` before the pack can publish; unverified identity blocks publish with `IPB-BRD-005`. | M | AT-26 |
| IPB-04-29 | **Per-host brand map**: the server resolves `brand_pack` from the request `Host` header against the published host list only. Unknown hosts receive the product default pack and a `noindex` response; a host listed in two packs is a save-time error. The `Host` and `X-Forwarded-Host` headers are validated against the allow-list at the edge; spoofed hosts never select a pack. | M | AT-27 |
| IPB-04-30 | Each brand pack carries its own legal entity, policy set (IPB-05 instance), footer, consent banner config, sitemap, robots and store identity. The policy set must be published before the pack can publish. | M | AT-27 |
| IPB-04-31 | Brand pack publish is maker-checker with preview (signed URL rendering the six reference screens with the draft pack) and one-click rollback to any prior published pack revision. Rollback is itself audited and maker-checker. | M | AT-28 |
| IPB-04-32 | Default product packs embed the IPB-D-11 palette and type pairings as the seed; they are editable within the contrast guard. | M | CI |

### 04.3.3 Pricing Studio

Prices are facts owned by the billing engine of record, Operations Hub OH8 (IPB-D-07). Pricing Studio never stores a price. It stores copy, layout and presentation rules, and reads plans, features, prices, trials and coupons through `BILLING_PORT`.

| ID | Requirement | Tier | Test |
|---|---|---|---|
| IPB-04-33 | `pricing_table` and `pricing_copy` read plans, features, list prices, currencies, billing periods, trial lengths and active coupons from `BILLING_PORT.getCatalogue(product, brand_pack_id)` at render (cached ≤5 min, revalidated on `in.infrabyx.billing.CatalogueChanged.v1`). Hand-typed prices are impossible: the editor has no price field. | M | AT-30 |
| IPB-04-34 | Studio edits per plan: display name override, tagline, feature bullets (mapped to catalogue feature keys so a removed feature cannot stay on the page), FAQ refs, comparison table rows, CTA label and target, trial text, "most popular" flag, discount banner text, currency display order, "contact sales" threshold (seats, volume or turnover above which the CTA becomes "Talk to sales"). | M | AT-30 |
| IPB-04-35 | GST display rule: for India brand packs every displayed price states whether GST is included and the rate label ("₹4,999/month + 18% GST" or "₹5,899/month incl. GST"), set per pack by `web.pricing.gst_display` (`exclusive_labelled` default, `inclusive`). The total payable including GST is shown before any checkout hand-off. Pricing for business plans may default to exclusive; consumer-facing UDF must use `inclusive`. | M | AT-31 |
| IPB-04-36 | **No drip pricing** (Guidelines for Prevention and Regulation of Dark Patterns, 2023, CCPA, Annexure 1 — drip pricing, basket sneaking, false urgency, confirm shaming, subscription trap, interface interference [LAW]). Lint rejects: mandatory fees not shown on the pricing page, countdown timers without a real catalogue end date, "only N left" without stock semantics, pre-ticked add-ons, cancel flows harder than sign-up. | M | AT-32 |
| IPB-04-37 | Coupons, trials and discounts are created in OH8 by a super admin with maker-checker; the Studio only chooses which active ones to surface and how. A coupon that expires in OH8 disappears from the page on the next revalidation. | M | AT-30 |
| IPB-04-38 | Currency display: INR default; others only if the catalogue has a price in that currency (no client-side FX conversion); currency switcher writes a `functional` cookie only after consent or uses URL state. | M | AT-31 |
| IPB-04-39 | Every pricing page links to Payment & Subscription Terms and the Refund & Cancellation Policy (IPB-05 templates 3 and 4) above the fold on mobile and desktop. | M | AT-31 |
| IPB-04-40 | Pricing copy publish requires `PLT_LEGAL_REVIEWER` approval and maker-checker. | M | AT-03 |

### 04.3.4 Blog

| ID | Requirement | Tier | Test |
|---|---|---|---|
| IPB-04-41 | `web.blog.enabled` toggles the blog. Off: routes return 404, nav items hide, sitemap omits, RSS endpoint returns 404; existing posts stay in the CMS. | O | AT-40 |
| IPB-04-42 | Categories (hierarchical, one level), tags (flat), authors (`team_member` or `author_profile` for user posts), series (optional). | M | AT-40 |
| IPB-04-43 | Editorial workflow: `draft → review → legal_check → scheduled → published`. `legal_check` is mandatory when lint flags the post (statute citations, statistics, named third parties, product comparisons, medical/financial/legal advice phrasing) or when the category is marked `legal_review_required`. Otherwise `review` by a second editor suffices (maker-checker). | M | AT-41 |
| IPB-04-44 | **Bulk import**: accepts DOCX, Markdown (with front matter), CSV (title, slug, body, category, tags, date, author), and ZIP of these plus images, ≤200 files and ≤500 MB per job; folder name → category mapping screen with preview; images extracted into the media library requiring alt text before publish; each imported post lands as `draft`; re-import of a matching `slug` or `source_id` creates a new revision, never a duplicate. | M | AT-42 |
| IPB-04-45 | Import lint gates (per post, results shown and exportable): outdated-law detector (citations to repealed or superseded instruments from the product's law register — e.g., IT Act s.66A, Companies Act 1956, RBI 2017 NBFC outsourcing directions, Privacy Shield); plagiarism check hook (`PLAGIARISM_PORT`, adapter may be "none" → warning only); unsupported claims (statistics without source); missing alt text; broken links; reading level warning. Blocking vs warning per gate is configurable except outdated-law and missing alt text, which always block. | M | AT-42, AT-43 |
| IPB-04-46 | ZIP safety: reject archives whose uncompressed size exceeds 10× compressed or 2 GB, nested archives, path traversal (`../`), symlinks, files over 50 MB, more than 200 entries; extraction in a sandboxed worker with CPU/memory limits; `IPB-CMS-021` on rejection. | M | AT-44 |
| IPB-04-47 | **User-authored posts** behind `web.blog.user_posts.enabled`. Eligible roles per product setting `web.blog.user_posts.eligible_roles` (default: verified tenant `ORG_OWNER`/`ORG_ADMIN`/`ORG_MEMBER` with ≥30-day-old account). Flow: author accepts Blog & UGC Terms (IPB-05 template 12, version recorded) → writes in the app editor (same sanitiser) → submits → moderation queue (Studio › Blog › Moderation) → moderator approves (maker-checker: submitter is maker) → publish. Posts carry an "Author's view" label and author profile. | O | AT-45 |
| IPB-04-48 | User-post anti-spam: rate limit (≤3 submissions/day/author), link cap (≤5 external links, all `rel="ugc nofollow"`), disposable-email block, `AV_PORT` scan of images, Vidhi pre-screen (maker only: flags, never publishes), honeypot and proof-of-work on the submission form. | O | AT-45 |
| IPB-04-49 | Takedown: any published user post can be unpublished immediately by `PLT_CONTENT_EDITOR` (single actor, because unpublishing is non-destructive) with a reason code; a notice goes to the author; the post becomes a 410 with a dated takedown notice; the IT Rules 2021 timelines (24-hour acknowledgement, 15-day disposal; 72 hours for listed content classes; 3 hours for synthetically generated unlawful content under the Feb 2026 amendment) are tracked in the grievance module [LAW: IT (Intermediary Guidelines and Digital Media Ethics Code) Rules 2021 r.3(2), as amended; VERIFY current r.3(2) text and the 2026 amendment numbering]. | M where user posts are enabled | AT-46 |
| IPB-04-50 | Comments optional (`web.blog.comments.enabled`), pre-moderated by default, same anti-spam, no third-party comment SaaS that sets cookies. | O | AT-40 |
| IPB-04-51 | RSS 2.0 and Atom feeds per blog and per category, full-text or summary per setting; `<lastBuildDate>` from last publish. | M | AT-40 |
| IPB-04-52 | Related posts (same category/tags, pgvector similarity optional), computed reading time (words/200, shown as "N min read"), table of contents from headings, author box, "last updated" and "first published" both shown, structured data `Article` with `dateModified`. | M | AT-40 |
| IPB-04-53 | Newsletter capture: form block with explicit unticked consent → `CRM_PORT.upsertLead` with `consent_ref` from the consent ledger; double opt-in email through `NOTIFY_PORT`; unsubscribe link in every send; list stored in OH CRM, never in the CMS. | M | AT-47 |

### 04.3.5 Vlog

| ID | Requirement | Tier | Test |
|---|---|---|---|
| IPB-04-54 | Video embeds (YouTube, Vimeo) render as a click-to-load poster (poster image from media library, title, duration, provider name, "Loads content from YouTube — see Cookie Policy"). No request to the provider until the viewer clicks and the `functional` or `marketing` category (per provider mapping) is consented; use `youtube-nocookie.com` and Vimeo `dnt=1` once loaded. | M | AT-50 |
| IPB-04-55 | Captions: WebVTT files for `en` and `hi` are mandatory before publish; ISL (Indian Sign Language) rendition optional via `isl_rendition_media_id` shown as a picture-in-picture toggle for self-hosted video or a link for provider video. | M | AT-51 |
| IPB-04-56 | Transcript page at `/vlog/{slug}/transcript`, generated from the VTT (speaker labels optional), indexable, linked from the player. `VideoObject` JSON-LD with `transcript`. | M | AT-51 |
| IPB-04-57 | Self-hosted video (`provider=self`) uses `STORAGE_PORT` with HLS renditions via `MEDIA_PORT`; never autoplay with sound; respects `prefers-reduced-motion`. | S | MAN |

### 04.3.6 Resources library

| ID | Requirement | Tier | Test |
|---|---|---|---|
| IPB-04-58 | Artefact types: `report`, `whitepaper`, `presentation`, `brief`, `template`, `checklist`, `webinar`, `policy_sample`, `transparency_report`, `rules_and_fees` (EQ), `kfs_sample` (UDF/FBX), `other`. Each has metadata: title, abstract, authors, published_on, version, language, pages/duration, topics, sector, file (PDF/DOCX/XLSX/PPTX/MP4/ZIP ≤200 MB), `cite_as` (auto-generated APA-style string with version and URL), `review_due`, `expires_at`, `supersedes`. | M | AT-60 |
| IPB-04-59 | Gating levels: `public`, `email_gate` (name, work email, consent, → CRM lead), `login` (any authenticated user of the product), `plan` (entitlement check through `BILLING_PORT`). The gating state is shown on the card before click. Email-gated downloads honour the Resources Download Terms (IPB-05 template 13) with a link, not a forced tick. | M | AT-61 |
| IPB-04-60 | Download tracking: server-side event with resource id, version, gating level, hashed lead id (if gated), UTM/click-id context; counts shown in Studio; never a third-party pixel. | M | AT-61 |
| IPB-04-61 | Versions: uploading a new file creates version n+1; old versions remain downloadable from the version history (unless `withdrawn`); the `cite_as` string includes the version; the URL is stable per resource with `?v=` for a specific version. | M | AT-60 |
| IPB-04-62 | Expiry and review: `review_due` default 12 months; at expiry the card shows "Under review — may be out of date" or the item is auto-withdrawn per setting; `ResourceReviewDue` event to the owner 30 days before. | M | AT-13 |
| IPB-04-63 | Bulk upload: ZIP or multi-file drop with a CSV manifest (filename, type, title, abstract, topics, gating); same ZIP guards as IPB-04-46; AV scan; all land as draft. | M | AT-44 |
| IPB-04-64 | Each PDF published is checked for a text layer, document title, language tag and tagged structure (PDF/UA heuristics); missing title or text layer blocks publish; untagged PDFs publish with a visible "accessible version on request" link to the Accessibility Statement channel. | S | AT-62 |

### 04.3.7 Standard pages

Every product publishes the pages below from the templates in IPB-04-13. The "Required sections" column lists block slots the template marks as required; publish blocks until they are filled. Content guidance is binding on tone: plain, dated, sourced, no superlatives, no category claims ("first", "largest", "only") without an E2+ claim.

| Page | Route | Required sections | Content guidance |
|---|---|---|---|
| Home | `/` | hero; what it does (feature_grid); who it is for; proof (logo_wall or stats with claims); how it works (steps); security & trust teaser linking Trust Centre; pricing teaser (if public pricing); resources teaser; CTA; FAQ | One h1. No autoplay video. Trust badges only for certifications actually held (E3) with issuer and scope on hover and in the Trust Centre. |
| About | `/about` | story (dated milestones via timeline); mission; what we do not do (boundary statement, e.g., "not a law firm", "not a lender" per product); group context ("Part of the Infrabyx Group"); leadership teaser; contact | Narrative is fine; every date and number sourced. |
| Team | `/team` | team_grid of `team_member` with `group=team`; photos optional; role; LinkedIn | Names and roles as text (never only in images). Consent for photo recorded in the person record. |
| Leadership | `/leadership` | team_grid `group=leadership`, bios; `group=advisory` if any; `group=board` with DIN optional | Verifiable bios. No "advisory board" block that is empty or client-rendered. |
| Governance | `/governance` | board and committees (if any); policies list (code of conduct, whistle-blower, related-party, information security, AI use, POSH) each linking to the published policy or stating "adopted — available on request"; auditor name (optional); grievance and DPO identities | Acknowledge gaps rather than omit; "not applicable to a private company" is acceptable wording. |
| Investors | `/investors` | toggle `web.investors.enabled`; sections: vision; market (E2 sourced); products; governance; leadership; milestones (timeline); documents (gated: `login` or `email_gate` with NDA flag, backed by IPB-08 room); IR contact (named person, direct email); disclaimer block (mandatory, locked copy from IPB-05 Annex) | No forward-looking promises, projections, returns language or invitation to subscribe. Disclaimer must state the page is informational and is not an offer or invitation to subscribe to securities (Companies Act 2013 s.42 private placement regime and s.23/s.26 public offer rules [LAW]; SEBI (ICDR) Regulations 2018 where applicable [LAW]) **[COUNSEL]**. Legal review gate mandatory. |
| Careers | `/careers` | culture (short); open roles list (`job` items with filters department/location/type); benefits (facts only); apply form → OH HR (`HR_PORT.createApplication`) with consent text; equal-opportunity statement | Closed roles return 410 with a link to open roles; `JobPosting` JSON-LD with `validThrough`. |
| Press / Media kit | `/press` | dated releases (`press_item kind=release`); coverage list (dated, outlet named, no undated "3000+ coverage" walls); media kit (logos in SVG/PNG from the brand pack, boilerplate text, leadership photos with permission, product screenshots); named spokesperson contact | Each coverage item must have a date and a URL to the article, not an outlet homepage. |
| Partners | `/partners` | partner types; logo_wall (each with claims_ref permission); "become a partner" form → CRM | No implied endorsement by regulators or courts. |
| Contact | `/contact` | form (name, work email, phone optional, message, consent) → CRM; offices block (CMS-managed addresses: Delhi, Noida, Jaipur plus brand-pack additions) with map as click-to-load static image (no map provider request before consent); WhatsApp CTA that opens `wa.me` only after an explicit click on a labelled button and shows the WhatsApp opt-in notice (IPB-05 template 18); support hours; grievance officer link | Named grievance officer and DPO with email on this page as well as the footer. |
| Documentation / Developer portal | `/docs` | link-out to the product's developer portal (`web.docs.url`) and help centre (IPB-07); API status link; changelog link; for EQ also "Rules, Procedures and Fees" | External portal must share the brand pack and CMP. |
| Trust Centre | `/trust` | certifications actually held (from IPB-08 room: name, issuer, scope, certificate id or "available on request", valid until); sub-processor list (name, purpose, region, DPA status) with change-notice subscription; VAPT summary (date, scope, severity counts, remediation status — no raw report); data residency statement; uptime link (status page); DPA request form; security.txt link; responsible disclosure link; Vendor Assurance Room entry for tenants (login) | Server-rendered. Every badge links to its entry. No badge for a standard "in progress" unless labelled "in progress". |
| Help / Tutorials | `/help`, `/tutorials` | routes reserved; content model in IPB-07 | Share brand pack, CMP, footer. |
| Pricing | `/pricing` | pricing_table; comparison_table; FAQ; terms links (IPB-04-39); contact sales | §04.3.3. |
| Compare | `/compare/{slug}` | comparison_table against named alternative; methodology note; as-of date; legal review | Competitor names allowed only after `PLT_LEGAL_REVIEWER` sign-off; factual, dated, sourced rows. |
| Case studies | `/case-studies` | list + detail (`case_study`) | Client named only with written permission (claims_ref E2/E3 with the permission document id). |
| Changelog | `/changelog` | `changelog_entry` list, filter by product area, RSS | Public audience only; tenant-only entries render inside `apps/web`. |
| Accessibility statement | `/accessibility` | IPB-05 template 10 rendered as `legal_page`; known issues table from the a11y backlog (IPB-06); feedback channel | Updated at least every 6 months (`last_reviewed_at`). |
| Sitemap (HTML) | `/sitemap` | auto-generated tree of published routable items | Always present; also linked from footer. |
| Legal pages | `/legal/{slug}` | all IPB-05 templates adopted for the product, each with version label, effective date, "what changed" summary and prior-version archive link | Rendered from `legal_page` items; versions immutable. |
| Grievance | `/grievance` | Grievance Officer name, designation, email, postal address, hours, form → OH support (`grievance` destination), escalation path and regulator references per product | Required by IT Rules 2021 r.3(2) and r.4 as applicable, DPDP Act 2023 s.13, RBI Digital Lending Directions 2025 (UDF/FBX), Consumer Protection (E-Commerce) Rules 2020 r.4(4)–(5) where applicable [LAW]; **[COUNSEL]** on which apply to each product. |
| Status | external | status page URL per brand pack | Linked from footer and Trust Centre. |

| ID | Requirement | Tier | Test |
|---|---|---|---|
| IPB-04-65 | Ship every page in the table above with its template; toggled pages (`Investors`, blog, vlog, compare) exist in the CMS from day one and are hidden by setting, not absent. | M | AT-70 |
| IPB-04-66 | `web.investors.enabled` default false. When true, the Investors page requires the locked disclaimer block and legal review before every publish; any numeric claim requires E2+; the words "guarantee", "assured return", "will achieve", "projected" trigger lint `IPB-CMS-012`. | O | AT-71 |
| IPB-04-67 | Contact and Careers forms post server-side to Operations Hub through `CRM_PORT` / `HR_PORT` with the consent text version and consent ledger receipt id; nothing is stored in the CMS except the submission id and status. | M | AT-47 |
| IPB-04-68 | Trust Centre certifications and sub-processors are not typed into the CMS; they are read from the IPB-08 Vendor Assurance Room registry through `TRUST_PORT` and rendered. The Studio may only reorder and add plain-language descriptions. | M | AT-72 |
| IPB-04-69 | Team and Leadership pages consume `team_member` items with a `photo_consent` flag; a photo without consent recorded cannot publish. | M | AT-09 |
| IPB-04-70 | Every standard page carries `BreadcrumbList` JSON-LD, a visible last-reviewed date in the footer region of the page, and `Organization` JSON-LD at site level with legal name, logo, `sameAs` (social URLs from footer), `contactPoint` (support, grievance). | M | AT-07 |

### 04.3.8 Footer specification (binding)

The footer is one `footer` content item per brand pack, rendered on every public route and on the public shell of `apps/web` (login, sign-up, legal). Build fails if a mandatory field is empty.

| Column / region | Content | Source | Mandatory |
|---|---|---|---|
| Brand block | Logo (sanitised SVG), one-line description, "Part of the Infrabyx Group" with link to the group site (`web.footer.group_url`) | brand pack | Yes |
| Product | Links: features/products, pricing, changelog, status page, documentation, integrations | nav_menu `footer_col_product` | Yes (≥3 items) |
| Solutions | By sector / use-case pages | nav_menu `footer_col_solutions` | S |
| Resources | Blog (if enabled), vlog (if enabled), resources library, help, tutorials, glossary, case studies | nav_menu `footer_col_resources` | Yes |
| Company | About, team, leadership, governance, investors (if enabled), careers, press, partners, contact, trust centre | nav_menu `footer_col_company` | Yes |
| Legal | Privacy Notice, Terms of Use, Payment & Subscription Terms, Refund & Cancellation, Cookie Policy, AI Use & Transparency, Grievance Redressal, Acceptable Use, Accessibility Statement, Security & Responsible Disclosure, DPA (request), plus product-specific (EQ: Rules, Procedures & Fees; UDF/FBX: Digital Lending disclosures, KFS sample, LSP/partner list) | policy set of the brand pack | Yes (all adopted IPB-05 templates must appear) |
| Contact | Registered office (full postal address), offices Delhi / Noida / Jaipur (CMS-managed `office` records: label, address, map link, hours), phone, WhatsApp number (button with consent notice), support email, sales email | footer item + offices | Registered office, one phone, one email mandatory |
| Entity line | "{legal name} · CIN {cin} · GSTIN {gstin}" — one line, text, copyable | brand pack `legal_entity` | Yes (Companies Act 2013 s.12(3)(c): name and registered office address, CIN, telephone, e-mail and website on business letters and official publications [LAW]; GSTIN per GST invoicing practice [REC]) |
| Officers line | "Grievance Officer: {name}, {email}" · "Data Protection Officer: {name}, {email}" each linking to `/grievance` and the Privacy Notice section | brand pack policy set | Yes (DPDP Act 2023 s.8(9), s.13; IT Rules 2021 r.3(2); RBI Digital Lending Directions 2025 for UDF/FBX [LAW]) |
| Social | LinkedIn, X, YouTube, Instagram, Facebook, WhatsApp Channel — any subset, CMS-managed list with URL, label, icon; each `<a>` has `aria-label="Infrabyx on LinkedIn (opens in new tab)"` style text, `rel="noopener"` | footer item | At least one; labels mandatory |
| Utilities | Status page link; language switch (`en`/`hi` + pack extras); "Cookie settings" (reopens CMP); "Accessibility" link; "Sitemap" link; "Report a problem" (feedback widget trigger) | computed | Yes |
| Disclaimer | Product boundary statement (LD: "LawDocs is a technology platform and not a law firm; it does not provide legal advice" [COUNSEL]; EQ: "Equator Resolution is an ODR institution and platform; neutrals are independent" [COUNSEL]; UDF: "Udofin is a Lending Service Provider; loans are provided by our regulated lending partners listed here" [LAW: RBI Digital Lending Directions 2025 — LSP disclosure; VERIFY paragraph]; FBX/LDC/OH: "not a regulated entity; software provider" [COUNSEL]) | policy set | Yes |
| Copyright | "© {auto year} {legal name}. All rights reserved." year computed at render | computed | Yes |

| ID | Requirement | Tier | Test |
|---|---|---|---|
| IPB-04-71 | Footer renders the regions above on every public route and public shell route; the build-time footer validator (`pnpm cms:validate-footer`) fails CI when any mandatory field is empty for any published brand pack. | M | CI, AT-73 |
| IPB-04-72 | Office addresses are `office` records (label, lines, city, state, PIN, country, phone, hours, map URL, is_registered_office) managed in Studio › Footer & Contact; Delhi, Noida and Jaipur are seeded for every product and may be edited, not deleted, without maker-checker. | M | AT-73 |
| IPB-04-73 | Footer links are keyboard reachable in reading order, grouped under `<nav aria-label="Footer">` with headed columns (`<h2>` visually styled); social icons have text labels (visible or `aria-label`); contrast guard applies to footer tokens. | M | AT-74 |
| IPB-04-74 | The footer entity line and officers line are text nodes (not images), machine-readable, and mirrored into `Organization` JSON-LD. | M | AT-07 |

### 04.3.9 Cookie consent CMP (`packages/consent-ui` + consent ledger)

| ID | Requirement | Tier | Test |
|---|---|---|---|
| IPB-04-75 | Banner shows three equal-prominence controls: **Accept all**, **Reject all**, **Manage** — same size, same visual weight, same tab order position, no colour bias toward Accept; closing the banner without a choice equals Reject for all non-necessary categories. | M | AT-80 |
| IPB-04-76 | Categories: `necessary` (always on, listed), `functional`, `analytics`, `marketing`; each with a plain description and a vendor list drawn from the Cookie Policy (IPB-05 template 5) table so the two never diverge. | M | AT-80 |
| IPB-04-77 | Global Privacy Control: when `Sec-GPC: 1` is present, `analytics` and `marketing` default to rejected and the banner says so; the user may still opt in. | M | AT-81 |
| IPB-04-78 | Every choice writes a consent ledger record through `CONSENT_PORT` (Ecosystem Spec Part 6): anonymous consent id (first-party cookie `ibx_cid`, 12-month expiry), categories, banner text version, policy version, region, timestamp, user agent class, GPC flag; the receipt id is returned to the browser. Changing a choice writes a new record; nothing is overwritten. | M | AT-82 |
| IPB-04-79 | Script blocking: all non-necessary scripts and iframes are declared with `type="text/plain" data-consent="analytics"` (or via the tag manager consent mode) and activated only after consent; server-rendered HTML never contains an active third-party tag; a CI test loads every public route with no consent and asserts zero third-party network requests except the self-hosted CDN. | M | AT-83 |
| IPB-04-80 | "Cookie settings" link in the footer and in the Cookie Policy reopens the preference centre; withdrawal is as easy as consent (DPDP Act 2023 s.6(4), s.6(6) [LAW]). | M | AT-80 |
| IPB-04-81 | Region switch: the server sets `region` from the brand pack default and, where `web.consent.geo_detect` is on, from edge country (`IN`, `EU`/`EEA`/`UK`, `US-CA`, `other`); wording variants: DPDP (consent for all non-necessary; purpose list), GDPR (lawful basis per category; reject all first-layer), CCPA/CPRA ("Do Not Sell or Share" link, GPC honoured). Default is DPDP wording. | M | AT-84 |
| IPB-04-82 | On authenticated app routes (`apps/web`, `apps/console`, `apps/delivery`, `apps/ops`, mobile web views) the CMP never asks for `marketing` consent; `analytics` on authenticated routes means first-party product analytics only (self-hosted PostHog/Matomo adapter or none), disclosed in the Privacy Notice; no banner is shown for marketing on those routes. | M | AT-85 |
| IPB-04-83 | Banner meets WCAG 2.2 AA: focus trapped only while modal, Escape closes as Reject, screen-reader announced, no auto-dismiss, text ≥16px, respects `prefers-reduced-motion`. | M | AT-74 |
| IPB-04-84 | Consent texts (banner, categories, preference centre) are CMS `legal_page`-linked strings with versions; a change to any text of substance bumps `consent_text_version` and re-prompts on next visit (`web.consent.reprompt_on_change` default true). | M | AT-82 |

### 04.3.10 Marketing tooling (`packages/marketing`, `mkt.` keys)

| ID | Requirement | Tier | Test |
|---|---|---|---|
| IPB-04-85 | `TAG_MANAGER_PORT` adapters: `none` (default), `gtm_web` (GTM web container with Consent Mode v2 defaults denied), `gtm_server` (server-side container on our infrastructure; first-party endpoint; IP truncation; redaction of personal fields). Only one adapter per brand pack. | M | AT-83 |
| IPB-04-86 | Analytics adapters behind `ANALYTICS_PORT`: `ga4`, `matomo` (self-hosted), `plausible` (self-hosted or EU cloud), `posthog` (self-hosted preferred), `none`. Cookieless/aggregate adapters may run under `necessary` only when they set no identifier and the Cookie Policy says so [INTERP: DPDP consent attaches to personal data; truly aggregate counters without identifiers are not personal data — **[COUNSEL]** before relying on this]. | M | AT-83 |
| IPB-04-87 | Pixels (Meta, LinkedIn Insight, Google Ads) load only in the `marketing` category after consent, only on public marketing routes, never on sensitive routes (IPB-04-82), never with hashed personal identifiers unless the lead gave marketing consent recorded in the ledger. | M | AT-86 |
| IPB-04-88 | UTM and click-id capture (`utm_*`, `gclid`, `fbclid`, `li_fat_id`, `msclkid`, `ttclid`) is server-side: the first request with parameters stores a first-touch record keyed to the anonymous consent id (functional category) and the latest a last-touch record; both attach to any lead or sign-up created from that session and flow to OH CRM. No client-side storage of click ids before consent. | M | AT-87 |
| IPB-04-89 | Lead forms post to `CRM_PORT.upsertLead` with: fields, consent receipt id, consent text version, source page, first/last touch, brand pack, product, locale; a server-side webhook fan-out (`mkt.webhooks`, Standard Webhooks v1 signatures) notifies external systems per form event; retries with backoff; dead-letter queue visible in Studio › Forms & Leads. | M | AT-47 |
| IPB-04-90 | A/B testing: variants are CMS revisions of the same item, each legal-approved before the experiment starts; assignment server-side by consent-id hash (functional category) or URL; experiments have an owner, hypothesis, end date and a single primary metric; results stored in OH; no experiment on legal pages, pricing figures, consent UI or forms' consent text. | S | AT-88 |
| IPB-04-91 | SEO health checks run nightly: broken internal links, orphan pages, missing alt, duplicate titles, missing canonical, thin pages (<150 words non-legal), Core Web Vitals from field data (self-hosted RUM in `functional` category) and lab (Lighthouse CI budget: LCP ≤2.5 s, CLS ≤0.1, INP ≤200 ms on mid-range mobile), sitemap/robots validity, structured-data validation, redirect chains. Results in Studio › SEO & Redirects with owner assignment. | M | AT-89 |
| IPB-04-92 | Lead magnets are implemented only through Resources gating (`email_gate`) — no separate capture mechanism; all gated downloads reuse the consent text and CRM contract. | M | AT-61 |
| IPB-04-93 | Outbound email for marketing goes through OH CRM/`NOTIFY_PORT` with double opt-in, unsubscribe in every message, suppression list honoured; no marketing email to `support_only` contacts. | M | AT-47 |

### 04.3.11 Feedback widget (`packages/feedback`, `fb.` keys)

| ID | Requirement | Tier | Test |
|---|---|---|---|
| IPB-04-94 | A feedback trigger is present on every public page (footer "Report a problem" and a floating button toggled by `fb.widget.floating`) and on every authenticated surface (help menu → "Send feedback"). Types: `bug`, `idea`, `praise`, `nps` (0–10 plus comment; shown at most once per 90 days per user, never on first session). | M | AT-90 |
| IPB-04-95 | Captured automatically: route pattern (not full URL with query), app version (`rel_` id), brand pack id, locale, viewport class, OS/browser family, OpenTelemetry trace id of the last request, consent id (public) or user id and tenant id (authenticated), timestamp. **Never captured**: page content, form values, screenshots by default (screenshot is opt-in with a redaction step), query strings, document ids beyond the route pattern. | M | AT-91 |
| IPB-04-96 | Items (`fbk_` ids) go to OH support (`bug`) or product backlog (`idea`, `praise`, `nps`) through `SUPPORT_PORT`/`BACKLOG_PORT`; the submitter gets a reference and can see status (received, triaged, planned, shipped, declined) in the app or by emailed link; status changes emit `FeedbackStatusChanged`. | M | AT-92 |
| IPB-04-97 | Idea board optional (`fb.idea_board.enabled`): public or tenant-scoped list of accepted ideas with voting (one vote per authenticated user), no comments unless moderated; voting data stays in OH. | O | AT-92 |
| IPB-04-98 | Widget is accessible (dialog pattern, labelled fields, error messages), works without JavaScript (falls back to `/feedback` form), rate-limited, anti-spam, and respects the CMP (sets no cookie; uses the existing consent id or session). | M | AT-74 |
| IPB-04-99 | Feedback text is classified by Vidhi (maker only) into a suggested area and severity; the suggestion is visible to triage staff and never auto-closes or auto-replies beyond the acknowledgement. | S | MAN |

### 04.3.12 Super-admin Studio information architecture

Left navigation in `apps/console` › **Studio** (order fixed; items hide by role, never by product):

| # | Section | Contents | Roles with write |
|---|---|---|---|
| 1 | Content | All items list with type/status/locale/owner filters; stale queue; search | `PLT_CONTENT_EDITOR` |
| 2 | Pages & Menus | Page tree (drag to reorder/nest), templates, header/footer/mobile menus, redirects shortcut | `PLT_CONTENT_EDITOR` |
| 3 | Blog | Posts, categories, tags, authors, moderation queue (user posts), comments queue, bulk import jobs, feeds | `PLT_CONTENT_EDITOR` |
| 4 | Vlog | Items, caption uploads, transcript editor | `PLT_CONTENT_EDITOR` |
| 5 | Resources | Artefacts, versions, gating, bulk upload, download reports, review-due queue | `PLT_CONTENT_EDITOR` |
| 6 | Brand | Brand packs list, tokens editor with preview, logo/favicon/OG, fonts, terminology, email identity, host map, publish/rollback | `PLT_SUPER_ADMIN` (maker), checker any other `PLT_SUPER_ADMIN` or `PLT_RELEASE_MANAGER` |
| 7 | Pricing | Plan copy per brand pack, comparison, FAQ refs, banners, thresholds, catalogue view (read-only from OH8), surfaced coupons | `PLT_CONTENT_EDITOR` maker; `PLT_LEGAL_REVIEWER` approval |
| 8 | Policies | Policy set per brand pack, IPB-05 template instances, parameters, versions, effective dates, re-consent triggers, diff view | `PLT_LEGAL_REVIEWER` maker; `PLT_SUPER_ADMIN` checker; `PLT_DPO` co-approver for Privacy, Cookie, DPA, Retention |
| 9 | Footer & Contact | Footer regions, offices, officers, social links, disclaimer, entity line (from legal entity record) | `PLT_CONTENT_EDITOR`; entity/officers fields maker-checker with `PLT_LEGAL_REVIEWER` |
| 10 | SEO & Redirects | Redirect map, legacy import, health check results, sitemap/robots/llms.txt preview, IndexNow log, structured-data validator | `PLT_CONTENT_EDITOR` |
| 11 | Forms & Leads | Form builder, destinations, consent texts, submissions log (ids and status only), webhooks, dead-letter queue | `PLT_CONTENT_EDITOR`; webhook secrets `PLT_SUPER_ADMIN` |
| 12 | Cookie & Consent | Banner texts per region, categories, vendor table (shared with Cookie Policy), GPC behaviour, preview, consent ledger stats (aggregate) | `PLT_DPO` maker; `PLT_LEGAL_REVIEWER` checker |
| 13 | Analytics & Tags | Adapter selection, container ids, consent mapping, route exclusion list (sensitive routes are locked), pixel inventory, test mode | `PLT_SUPER_ADMIN` maker-checker; `PLT_DPO` veto |
| 14 | Feedback inbox | Items by type/status/area, triage, link to OH ticket/backlog, NPS trend, idea board moderation | `OPS_SUPPORT`, `OPS_PRODUCT` |
| 15 | Media library | Upload, alt-text queue, renditions, usage ("where used"), licence notes, sanitiser log | `PLT_CONTENT_EDITOR` |
| 16 | Publish queue | Pending approvals (maker-checker), scheduled items, legal review queue, Claims Register lint failures, preview links | checkers per item type |
| 17 | Audit | Ledger view filtered to Studio actions; export; revision diff | `PLT_AUDITOR_RO` read |

| ID | Requirement | Tier | Test |
|---|---|---|---|
| IPB-04-100 | Implement the Studio IA above in `apps/console`; sections never disappear by product — a product that has not enabled a feature sees the section with the toggle and a one-line explanation. | M | AT-100 |
| IPB-04-101 | Every Studio list supports keyboard navigation, column sort, saved filters, and a "where used" panel for media, sections and forms before deletion; deletion is soft with a 30-day restore window and Object Lock on the revision store. | M | AT-100 |
| IPB-04-102 | Studio shows the Claims Register inline: when an editor inserts a number or badge, the block editor demands a claims reference and offers to create one (which goes to `PLT_LEGAL_REVIEWER` for evidence class assignment). | M | AT-06 |
| IPB-04-103 | Studio help keys `hlp.cms.*`, `hlp.brand.*`, `hlp.pricing.*` are registered for every field (IPB-07). | S | CI |

## 04.4 Design

### 04.4.1 Data model (`cms` schema, PostgreSQL, Drizzle, RLS)

The `cms` schema is platform-scoped (no tenant rows) except `cms.user_post_submission` and `cms.comment`, which carry `tenant_id` and `user_id` and are RLS-protected. All tables have `created_at`, `updated_at`, `created_by`, `updated_by`.

| Table | Purpose | Key columns |
|---|---|---|
| `cms.brand_pack` | brand packs | `id brd_`, `product`, `status`, `published_revision_id`, JSON body per §04.3.2 |
| `cms.brand_pack_host` | host → pack map, unique on `host` | `host`, `brand_pack_id`, `is_primary` |
| `cms.brand_pack_revision` | immutable pack snapshots | `id`, `brand_pack_id`, `body`, `created_by`, `approved_by`, `approved_at` |
| `cms.content_item` | all content | `id` (typed prefix), `brand_pack_id`, `content_type`, `locale`, `translation_group_id`, `slug`, `title`, `status`, `published_revision_id`, `scheduled_revision_id`, `publish_at`, `unpublish_at`, `legal_review_status`, `owner_user_id`, `last_reviewed_at`, `seo jsonb`, `claims_refs text[]`, `deleted_at`; unique (`brand_pack_id`, `locale`, `content_type`, `slug`) where `deleted_at is null` |
| `cms.revision` | immutable body snapshots | `id`, `content_item_id`, `seq`, `body jsonb` (blocks or typed fields), `summary_of_changes`, `created_by`, `source` (`editor`, `import`, `rollback_of:<id>`, `machine_translation`) |
| `cms.block_type` | registered blocks | `name`, `schema jsonb`, `a11y_rules jsonb`, `version` |
| `cms.approval` | maker-checker records | `id`, `subject_type`, `subject_id`, `revision_id`, `action` (`publish`, `unpublish`, `rollback`, `brand_publish`, `redirect_change`, `user_post_approve`, `import_commit`, `coupon_surface`), `maker_id`, `checker_id`, `legal_reviewer_id`, `dpo_id`, `state`, `reason`, `decided_at` |
| `cms.nav_menu`, `cms.nav_item` | menus | `location`, parent/child order, target (`content_item_id` or URL), `label` per locale |
| `cms.footer`, `cms.office`, `cms.social_link` | footer regions | per §04.3.8 |
| `cms.media`, `cms.media_rendition` | library | `sha256`, `mime`, `bytes`, `alt_text`, `decorative`, `focal_x`, `focal_y`, `licence_note`, `sanitiser_report jsonb`, `av_scan_status`, renditions (`width`, `format`, `storage_key`) |
| `cms.redirect` | redirects | `from_path` unique per pack, `to_path`, `status`, `source`, `hits`, `last_hit_at` |
| `cms.import_job`, `cms.import_item` | bulk import | `kind` (`blog`, `resources`, `redirects`), `file_storage_key`, `mapping jsonb`, `state`, `lint_report jsonb`, per-item result and target revision |
| `cms.claim` | Claims Register | `id clm_`, `text`, `value`, `unit`, `as_of`, `evidence_class`, `source_url`, `evidence_doc_id` (IPB-08 `vad_`), `owner_id`, `review_due`, `status` |
| `cms.resource_version`, `cms.resource_download` | resources | version files; download events (hashed lead id, gating, utm context) |
| `cms.user_post_submission` | UGC | `tenant_id`, `user_id`, `content_item_id`, `terms_version`, `state`, `moderator_id`, `decision_reason`, RLS by tenant and submitter |
| `cms.comment` | comments | `content_item_id`, `author_user_id`, `body`, `state`, RLS |
| `cms.form`, `cms.form_submission` | forms | definition; submission `id`, `destination_ref` (CRM lead id / HR application id / ticket id), `consent_receipt_id`, `state` — no field values retained after hand-off succeeds (`mkt.forms.retain_payload_hours` default 72 for retry only) |
| `cms.consent_text` | banner/preference texts | `region`, `version`, `body jsonb`, `effective_at` |
| `cms.seo_check_run`, `cms.seo_issue` | health checks | run metadata; issue type, url, severity, owner, state |
| `cms.policy_set`, `cms.policy_instance` | IPB-05 instances | `policy_key`, `template_version`, `params jsonb`, `rendered_revision_id`, `effective_at`, `reconsent_required`, `supersedes_id` |
| `cms.ab_experiment`, `cms.ab_assignment` | A/B | hypothesis, variants (revision ids), metric, dates; assignment by consent-id hash |
| `cms.feedback_item` (mirror) | local mirror of `fbk_` items for status display | `id fbk_`, `type`, `route_pattern`, `status`, `oh_ref` |

Indexes: GIN on `revision.body` for search in Studio; trigram on `content_item.title`; btree on (`brand_pack_id`, `status`, `publish_at`) for the scheduler; partial unique on `redirect.from_path`.

Storage: media and resource files in `STORAGE_PORT` buckets `public-media` (public read via CDN, immutable keys by `sha256`) and `gated-resources` (signed URLs, 10-minute expiry, Object Lock for published versions). Import uploads land in `quarantine` with 7-day lifecycle.

### 04.4.2 Ports consumed

| Port | Methods used here | Reference adapter | Second adapter |
|---|---|---|---|
| `BILLING_PORT` | `getCatalogue(product, brandPackId)`, `getEntitlement(userId, featureKey)`, `listSurfaceableCoupons()` | OH8 HTTP client | Fixture adapter for non-prod |
| `CRM_PORT` | `upsertLead`, `recordConsent`, `attachTouchpoints` | OH CRM | Fixture |
| `HR_PORT` | `createApplication` | OH HRMS | Fixture |
| `SUPPORT_PORT`, `BACKLOG_PORT` | `createTicket`, `createIdea`, `getStatus` | OH support/backlog | Fixture |
| `CONSENT_PORT` | `recordConsent`, `getConsent(cid)` | Ecosystem consent ledger | Local PostgreSQL ledger (dev) |
| `TRUST_PORT` | `listCertifications`, `listSubProcessors`, `getVaptSummary`, `listRoomDocuments` | Product `trust` module reading its read-only `vad_mirror_*` tables fed by OH14.6 events (IPB-08) | Fixture |
| `TAG_MANAGER_PORT` | `renderHead(consentState)`, `renderBody` | `none` | `gtm_web`, `gtm_server` |
| `ANALYTICS_PORT` | `track(event, props, consentState)` server and client | `none` | `posthog_selfhosted`, `matomo`, `plausible`, `ga4` |
| `STORAGE_PORT` | put/get/sign/lock | S3 ap-south-1 | MinIO (dev), Azure Blob, GCS |
| `MEDIA_PORT` | re-encode raster, SVG sanitise, PDF probe, HLS | sharp + own sanitiser + pdf.js probe | Gotenberg for PDF rendering |
| `AV_PORT` | scan file | ClamAV container | Cloud scanner adapter |
| `PLAGIARISM_PORT` | `check(text)` | `none` (warning) | Vendor adapter [OWNER: pick vendor; default off] |
| `EGRESS_PORT` | server-side fetch with allow-list, DNS pinning, private-IP block, 5 s timeout, 2 MB cap | own | own |
| `LLM_PORT` | machine translation draft, lint assist (maker only), feedback classification | per IPB-D-06 | per IPB-D-06 |
| `IMAGE_GEN_PORT` | OG image generation | per IPB-D-06 | deterministic SVG template |
| `NOTIFY_PORT` | double opt-in, author notices, reviewer notices, SPF/DKIM/DMARC checks | per IPB-01 | per IPB-01 |
| `SEARCH_PORT` | public site search over published revisions | PostgreSQL FTS | OpenSearch |
| `FEATURE_FLAG_PORT` | gradual rollout of new blocks/templates | OpenFeature → Unleash | Flagsmith |

### 04.4.3 State machines

**Content publish (all content types)**

```
draft ──submit──▶ in_review ──approve(checker≠maker)──▶ approved ──schedule──▶ scheduled ──at publish_at──▶ published
  ▲                  │                                      │                                                │
  │                  └──request_changes──▶ draft            └──publish_now (checker)──────────────────────▶ published
  │                                                                                                           │
  │  in_review ──needs_legal──▶ legal_review ──legal_approve(PLT_LEGAL_REVIEWER)──▶ approved                 │ unpublish / archive
  └───────────────────────────────── rollback (new revision pointing to older body; maker-checker) ◀──────────┘
```

Rules: `needs_legal` is automatic for the item types in IPB-04-06 and for any lint flag; `legal_approve` and `approve` may be the same person only if that person is `PLT_LEGAL_REVIEWER` and a second `PLT_CONTENT_EDITOR`/`PLT_SUPER_ADMIN` has approved; `AGT_*` may move `draft → in_review` only. Published items remain served until a newer revision is published or the item is unpublished (410 or redirect). Scheduled unpublish moves to `archived`.

Additional transitions and guards *(rev. 26 Oct 2026)* (each is a named transition in `packages/cms/state`; anything not listed is `IPB-CMS-003`):

| From → To | Trigger | Guard |
|---|---|---|
| `legal_review → draft` | `request_changes` by `PLT_LEGAL_REVIEWER` | reason mandatory; author notified |
| `scheduled → approved` | `unschedule` by a checker | clears `publish_at`; approval stays valid |
| `approved`/`scheduled → draft` | any edit of body, slug, SEO or blocks | creates a new revision and voids the approval and legal sign-off; the previously published revision keeps serving |
| `scheduled → published` by the worker | `publish_at` reached | only if the item is still `scheduled` **and** `scheduled_revision_id` equals the approved revision (optimistic lock); otherwise the run is skipped and ledgered |
| `published → published` (rollback) | maker-checker | the target revision must have been published under the current policy set and brand pack version; otherwise the rollback enters `legal_review` first |
| validation | save | `unpublish_at` must be later than `publish_at`; a `publish_at` in the past publishes immediately only through `publish_now` |

| Scenario | Expected behaviour |
|---|---|
| Happy path | draft → in_review → approved → scheduled → published at the minute; sitemap and IndexNow within 60 s |
| Failure — lint flag after approval | editing to fix the flag returns the item to `draft`; a fresh approval is required |
| Concurrency — edit during countdown | editor saves at 09:59 for a 10:00 publish: the item is `draft` on a new revision, the worker skips the 10:00 run, nothing unapproved is served |
| Concurrency — unpublish racing publish | `unpublish` wins if committed first (state no longer `scheduled`); the worker's skip is ledgered |
| Rollback | rollback to revision r-2 creates r+1 pointing to r-2's body; if the legal template parameters changed since r-2 was published, the rollback waits in `legal_review` |

**User-authored post**

```
authoring (app) ──accept_terms(v)──▶ submitted ──prescreen(Vidhi flags)──▶ queued ──approve(moderator)──▶ published
                                        │                                      │
                                        └── rejected (reason to author)        └── changes_requested ──▶ authoring
published ──takedown(reason)──▶ taken_down (410 + notice) ──grievance outcome──▶ restored | removed
```

**Bulk import job**

```
uploaded ──av_scan──▶ scanned ──extract(sandbox, limits)──▶ extracted ──map(folder→category)──▶ mapped ──lint──▶ linted
linted ──commit(maker-checker when >20 items or any legal flag)──▶ drafts_created ──editor publishes per item──▶ done
any ──fail(reason)──▶ failed (report downloadable)
```

**Brand pack**

```
draft ──preview──▶ draft ──submit──▶ pending_approval ──approve(second PLT_SUPER_ADMIN or PLT_RELEASE_MANAGER)──▶ published
published ──rollback(to revision; maker-checker)──▶ published(older body)
```

Preconditions for `submit`: contrast guard pass; SVG sanitised; favicon set generated; email identity verified; policy set published; host list non-empty and unique; footer validator pass.

**Legal page / policy instance**

```
draft ──legal_review(PLT_LEGAL_REVIEWER + PLT_DPO for privacy-class)──▶ approved ──set effective_at──▶ scheduled ──▶ effective
effective ──supersede(new instance)──▶ superseded (archived, still linked as prior version)
reconsent_required=true ⇒ on effective: emit PolicyEffective(reconsent=true) ⇒ apps/web prompt on next login (IPB-05 §05.3)
```

### 04.4.4 Rendering and caching

- `apps/public` renders every route on the server from published revisions. ISR with tag-based revalidation: publishing a revision revalidates its route, its parents, index pages, sitemap, feeds and `llms.txt`. Preview bypasses the cache.
- CDN caches HTML by host + path + locale cookie; `Vary: Accept-Language, Cookie(ibx_lang)`; the consent cookie never varies HTML (consent state is applied client-side by the loader and server-side only for tag rendering through a cookie-aware edge function).
- Security headers: CSP nonce-based (`script-src 'nonce-…' 'strict-dynamic'`; `frame-src` limited to consented providers; `img-src 'self' data: https://{cdn}`; `connect-src 'self'` plus adapters after consent through CSP update on consent), `X-Content-Type-Options`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` denying camera/microphone/geolocation on public routes, HSTS preload.
- Image delivery via `/m/{sha}/{width}.{format}`, long-lived immutable cache.
- Fonts via `/fonts/{family}/{file}.woff2` on the brand host.
- `/.well-known/security.txt` (RFC 9116) from the Security & Responsible Disclosure instance; `/.well-known/change-password` → app route.

### 04.4.5 Public site screens (binding structure)

Header: logo (home), primary nav (≤7 items from `nav_menu location=header`), language switch, "Log in", primary CTA. Mobile: disclosure menu, same items. Skip link first in DOM. Breadcrumbs under header on nested pages. Page body from blocks. Footer per §04.3.8. CMP bottom sheet on first visit (not blocking content). Feedback trigger in footer.

Blog index: category tabs, search, cards (title, excerpt, author, date, reading time, category). Post: title, meta, TOC, body, author box, related, feedback. Vlog: grid of posters; item: click-to-load player, captions selector, transcript link. Resources: faceted index (type, topic, sector, language, gating), card with gating badge; detail: abstract, metadata table, "cite as" copy button, version history, download CTA (gate step if required). Pricing: toggle monthly/annual, table, GST label, comparison, FAQ, legal links. Trust: certifications table, sub-processors table, VAPT summary card, residency, status, DPA request form, disclosure link. Investors: sections in IPB-04-66 order, disclaimer visible without scrolling on desktop and before documents on mobile.

## 04.5 Settings keys

All keys are registered in `packages/config` before code reads them. Tier names per the brief. MC = maker-checker required to change.

| Key | Tier | Type | Default | Who may change | MC |
|---|---|---|---|---|---|
| `web.site.enabled` | BRAND | bool | true | PLT_SUPER_ADMIN | yes |
| `web.site.default_locale` | BRAND | enum | `en-IN` | PLT_SUPER_ADMIN | no |
| `web.site.locales` | BRAND | string[] | `["en-IN","hi-IN"]` | PLT_SUPER_ADMIN | no |
| `web.site.timezone` | PLATFORM | string | `Asia/Kolkata` | PLT_SUPER_ADMIN | no |
| `web.seo.indexnow.enabled` | BRAND | bool | true | PLT_CONTENT_EDITOR | no |
| `web.seo.llms_txt.enabled` | BRAND | bool | true | PLT_CONTENT_EDITOR | no |
| `web.seo.health.schedule_cron` | PLATFORM | string | `0 2 * * *` | PLT_SUPER_ADMIN | no |
| `web.seo.budget.lcp_ms` / `cls` / `inp_ms` | PLATFORM | number | 2500 / 0.1 / 200 | PLT_RELEASE_MANAGER | no |
| `cms.review.stale_days` | PLATFORM | int | 365 | PLT_SUPER_ADMIN | no |
| `cms.preview.ttl_hours` | PLATFORM | int | 24 | PLT_SUPER_ADMIN | no |
| `cms.publish.legal_review_types` | PLATFORM | string[] | `[legal_page,pricing_copy,footer,redirect,brand_pack,investors,trust]` | PLT_LEGAL_REVIEWER | yes (may only add) |
| `cms.import.max_files` | PLATFORM | int | 200 | PLT_SUPER_ADMIN | no |
| `cms.import.max_bytes` | PLATFORM | int | 524288000 | PLT_SUPER_ADMIN | no |
| `cms.import.zip_ratio_max` | PLATFORM | int | 10 | PLT_SECURITY_OFFICER | yes |
| `cms.import.plagiarism_adapter` | PLATFORM | enum | `none` | PLT_SUPER_ADMIN | yes |
| `cms.media.formats` | PLATFORM | string[] | `[avif,webp,jpeg]` | PLT_SUPER_ADMIN | no |
| `cms.media.widths` | PLATFORM | int[] | `[320,640,960,1280,1920]` | PLT_SUPER_ADMIN | no |
| `cms.media.max_upload_mb` | PLATFORM | int | 200 | PLT_SUPER_ADMIN | no |
| `cms.soft_delete.restore_days` | PLATFORM | int | 30 | PLT_SUPER_ADMIN | yes |
| `brand.app_name` | BRAND | string | product name | PLT_SUPER_ADMIN (ORG_OWNER on white-label plan) | yes |
| `brand.terminology` | BRAND | map | `{}` | PLT_SUPER_ADMIN (ORG_OWNER on white-label plan) | yes |
| `brand.contrast.min_text` / `min_ui` | PLATFORM | number | 4.5 / 3.0 | PLT_SUPER_ADMIN | yes (may only raise) |
| `brand.fonts.self_hosted_only` | PLATFORM | bool | true | — (locked) | — |
| `brand.email.require_dmarc` | PLATFORM | bool | true | PLT_SECURITY_OFFICER | yes |
| `brand.hosts.unknown_behaviour` | PLATFORM | enum | `default_pack_noindex` | PLT_SECURITY_OFFICER | yes |
| `web.pricing.public` | BRAND | bool | true | PLT_SUPER_ADMIN | yes |
| `web.pricing.gst_display` | BRAND | enum | `exclusive_labelled` (UDF: `inclusive`) | PLT_LEGAL_REVIEWER | yes |
| `web.pricing.contact_sales_threshold` | BRAND | json | per product | PLT_CONTENT_EDITOR | no |
| `web.pricing.catalogue_cache_seconds` | PLATFORM | int | 300 | PLT_SUPER_ADMIN | no |
| `web.blog.enabled` | BRAND | bool | true (OH: false) | PLT_SUPER_ADMIN | no |
| `web.blog.user_posts.enabled` | BRAND | bool | false | PLT_SUPER_ADMIN | yes |
| `web.blog.user_posts.eligible_roles` | BRAND | string[] | `[ORG_OWNER,ORG_ADMIN,ORG_MEMBER]` | PLT_SUPER_ADMIN | yes |
| `web.blog.user_posts.min_account_age_days` | BRAND | int | 30 | PLT_SUPER_ADMIN | no |
| `web.blog.user_posts.daily_limit` | BRAND | int | 3 | PLT_SUPER_ADMIN | no |
| `web.blog.comments.enabled` | BRAND | bool | false | PLT_SUPER_ADMIN | no |
| `web.blog.feed.full_text` | BRAND | bool | false | PLT_CONTENT_EDITOR | no |
| `web.vlog.enabled` | BRAND | bool | true | PLT_SUPER_ADMIN | no |
| `web.vlog.require_captions` | PLATFORM | bool | true | — (locked) | — |
| `web.resources.enabled` | BRAND | bool | true | PLT_SUPER_ADMIN | no |
| `web.resources.review_due_months` | BRAND | int | 12 | PLT_CONTENT_EDITOR | no |
| `web.resources.expired_behaviour` | BRAND | enum | `banner` (`withdraw`) | PLT_CONTENT_EDITOR | no |
| `web.investors.enabled` | BRAND | bool | false | PLT_SUPER_ADMIN | yes |
| `web.docs.url` | BRAND | url | per product | PLT_CONTENT_EDITOR | no |
| `web.status_page.url` | BRAND | url | per product | PLT_RELEASE_MANAGER | no |
| `web.footer.group_url` | PLATFORM | url | Infrabyx group site | PLT_SUPER_ADMIN | yes |
| `web.consent.geo_detect` | BRAND | bool | true | PLT_DPO | no |
| `web.consent.region_default` | BRAND | enum | `IN` | PLT_DPO | no |
| `web.consent.reprompt_on_change` | BRAND | bool | true | PLT_DPO | yes |
| `web.consent.cookie_ttl_days` | PLATFORM | int | 365 | PLT_DPO | yes |
| `web.consent.honour_gpc` | PLATFORM | bool | true | — (locked) | — |
| `mkt.tag_manager.adapter` | BRAND | enum | `none` | PLT_SUPER_ADMIN | yes (PLT_DPO veto) |
| `mkt.tag_manager.container_id` | BRAND | string | null | PLT_SUPER_ADMIN | yes |
| `mkt.analytics.adapter` | BRAND | enum | `none` | PLT_SUPER_ADMIN | yes |
| `mkt.pixels.enabled` | BRAND | string[] | `[]` | PLT_SUPER_ADMIN | yes (PLT_DPO veto) |
| `mkt.sensitive_routes` | PLATFORM | glob[] | locked list + additions | PLT_DPO | yes (may only add) |
| `mkt.attribution.window_days` | BRAND | int | 90 | PLT_CONTENT_EDITOR | no |
| `mkt.forms.retain_payload_hours` | PLATFORM | int | 72 | PLT_DPO | yes |
| `mkt.webhooks` | BRAND | json[] | `[]` | PLT_SUPER_ADMIN | yes |
| `mkt.ab.enabled` | BRAND | bool | false | PLT_SUPER_ADMIN | yes |
| `fb.widget.floating` | BRAND | bool | false (public) / true (app) | PLT_CONTENT_EDITOR | no |
| `fb.nps.interval_days` | PLATFORM | int | 90 | OPS_PRODUCT | no |
| `fb.screenshot.enabled` | PLATFORM | bool | false | PLT_DPO | yes |
| `fb.idea_board.enabled` | BRAND | bool | false | PLT_SUPER_ADMIN | no |
| `tut.public_route_enabled` | BRAND | bool | true | PLT_CONTENT_EDITOR | no |

Tenant-tier keys for white-label (`brand.*` on a `white_label` plan) are editable by `ORG_OWNER` in `apps/web` › Settings › Customisation › Branding (IPB-07 node 7) and still pass the same guards; no super admin involvement and no code release.

## 04.6 Events and error codes

### 04.6.1 Internal events (`in.<product>.cms.*`, `in.<product>.brand.*`, `in.<product>.mkt.*`, `in.<product>.fb.*`)

| Event | When | Payload (abridged) |
|---|---|---|
| `in.<p>.cms.RevisionCreated.v1` | any save | item id, revision id, source, actor |
| `in.<p>.cms.PublishRequested.v1` | submit | item id, revision id, needs_legal |
| `in.<p>.cms.ContentPublished.v1` | published | item id, revision id, routes[], locale |
| `in.<p>.cms.ContentUnpublished.v1` | unpublish/archive/410 | item id, reason |
| `in.<p>.cms.RollbackPerformed.v1` | rollback | item id, from, to, maker, checker |
| `in.<p>.cms.ClaimsLintFailed.v1` | lint block | item id, failures[] |
| `in.<p>.cms.ContentStale.v1` | stale queue | item id, last_reviewed_at |
| `in.<p>.cms.ImportJobStateChanged.v1` | import | job id, state, counts |
| `in.<p>.cms.UserPostSubmitted.v1` / `UserPostModerated.v1` / `UserPostTakenDown.v1` | UGC | submission id, tenant id, state, reason |
| `in.<p>.cms.ResourceDownloaded.v1` | download | resource id, version, gating, hashed lead |
| `in.<p>.cms.ResourceReviewDue.v1` | 30 days before | resource id, due |
| `in.<p>.cms.RedirectChanged.v1` | redirect map | from, to, status, actor |
| `in.<p>.cms.PolicyEffective.v1` | legal page effective | policy key, version, reconsent |
| `in.<p>.tenancy.BrandPackPublished.v1` / `BrandPackRolledBack.v1` | brand | pack id, revision, hosts[] |
| `in.<p>.brand.ContrastGuardFailed.v1` | token save | pack id, pairs[] |
| `in.<p>.web.ConsentRecorded.v1` | CMP choice | receipt id, categories, region, version |
| `in.<p>.mkt.LeadCaptured.v1` | form | lead ref, source, consent receipt |
| `in.<p>.mkt.WebhookDeliveryFailed.v1` | DLQ | webhook id, attempts |
| `in.<p>.mkt.SeoIssueOpened.v1` | nightly | issue id, type, url |
| `in.<p>.fb.FeedbackSubmitted.v1` / `FeedbackStatusChanged.v1` | widget | fbk id, type, status |

### 04.6.2 Proposed Ecosystem events (for the Ecosystem Spec editor; not to be emitted until accepted)

| Proposed | Direction | Purpose |
|---|---|---|
| `in.infrabyx.billing.CatalogueChanged.v1` | OH8 → products | revalidate pricing pages |
| `in.infrabyx.crm.LeadCaptured.v1` | products → OH | lead with consent receipt and touchpoints |
| `in.infrabyx.privacy.ConsentRecorded.v1` (product consents, Spec §6.14) and `in.infrabyx.consent.MarketingConsentUpdated.v1` (marketing and analytics purposes, Spec §6.39); the draft `consent.Recorded` is superseded (Spec §6.17) *(rev. 26 Oct 2026)* | products → ledger | CMP and form consents |
| `in.infrabyx.trust.VendorAssuranceDocumentPublished.v1` | OH14.6 → products | refresh Trust Centre |
| `in.infrabyx.feedback.FeedbackSubmitted.v1` / `ItemStatusChanged.v1` | both | widget ↔ OH support/backlog |
| `in.infrabyx.workforce.CareerApplicationReceived.v1` | products → OH | careers form |
| `in.infrabyx.grc.PolicyEffective.v1` | products → OH | compliance calendar and re-consent tracking |

### 04.6.3 Error codes

| Code | Meaning | HTTP | Remedy shown |
|---|---|---|---|
| `IPB-CMS-001` | Invalid block against registered schema | 422 | field path and schema message |
| `IPB-CMS-002` | Slug reserved or duplicate | 422 | suggest alternative |
| `IPB-CMS-003` | Required template slot empty | 422 | list missing slots |
| `IPB-CMS-004` | Checker equals maker | 403 | choose another approver |
| `IPB-CMS-005` | Legal review required and missing | 403 | route to legal queue |
| `IPB-CMS-006` | Preview token expired or invalid | 410 | request new preview |
| `IPB-CMS-007` | Alt text missing on non-decorative image | 422 | open alt-text queue |
| `IPB-CMS-008` | Sanitiser removed disallowed content (saved with report) | 200 + warning | show report |
| `IPB-CMS-009` | Redirect loop or chain >1 | 422 | show chain |
| `IPB-CMS-010` | Claims Register reference missing or below E1 | 403 | create/upgrade claim |
| `IPB-CMS-011` | Machine-translated draft cannot publish | 403 | human review |
| `IPB-CMS-012` | Prohibited wording on Investors/legal page (forward-looking, guarantee) | 422 | rewrite |
| `IPB-CMS-013` | Captions missing (en/hi) on vlog item | 422 | upload VTT |
| `IPB-CMS-014` | Testimonial/logo without permission evidence | 403 | attach consent doc |
| `IPB-CMS-015` | Dark-pattern lint failure | 422 | list rule |
| `IPB-CMS-020` | Import file type unsupported | 415 | list accepted |
| `IPB-CMS-021` | Archive rejected (ratio, nesting, traversal, size, count) | 422 | reason |
| `IPB-CMS-022` | Import lint blocking failure | 422 | per-item report |
| `IPB-CMS-023` | AV scan failed or positive | 422 | quarantined |
| `IPB-CMS-030` | User post: terms not accepted / ineligible role / rate limit | 403/429 | explain |
| `IPB-CMS-031` | Takedown reason code required | 422 | choose reason |
| `IPB-CMS-040` | Resource gating entitlement failed | 403 | upgrade or log in |
| `IPB-CMS-041` | Resource withdrawn / expired version | 410 | link current version |
| `IPB-BRD-001` | SVG failed sanitisation (script/foreignObject/external ref) | 422 | upload clean SVG |
| `IPB-BRD-002` | Host already mapped to another pack | 409 | which pack |
| `IPB-BRD-003` | Contrast guard failed | 422 | pairs and ratios |
| `IPB-BRD-004` | Font not WOFF2 or licence note missing | 422 | fix |
| `IPB-BRD-005` | Email identity not verified (SPF/DKIM/DMARC) | 403 | DNS records |
| `IPB-BRD-006` | Policy set not published for pack | 403 | publish policies |
| `IPB-BRD-007` | Unknown host (served default pack, noindex) | 200 | n/a (logged) |
| `IPB-WEB-001` | CMP: consent ledger unavailable (banner shows, choice queued locally with retry; no non-necessary scripts run) | 503 | retry |
| `IPB-WEB-002` | Form: consent not given for personal fields | 422 | tick consent |
| `IPB-WEB-003` | Form: anti-spam challenge failed | 429 | retry |
| `IPB-WEB-004` | Embed provider not on allow-list / SSRF guard blocked | 422 | allowed list |
| `IPB-WEB-005` | Tag adapter attempted load on sensitive route (blocked, security event) | — | audited |
| `IPB-WEB-006` | Pricing catalogue unavailable (page renders "pricing temporarily unavailable", never stale figures older than 24 h) | 503 | retry |
| `IPB-FB-001` | Feedback payload contains disallowed field (page content/query) — rejected server-side | 422 | n/a |
| `IPB-FB-002` | Feedback rate limit | 429 | wait |

Products re-export as `<PRODUCT>-CMS-nnn` etc.

## 04.7 Product adoption notes

### LD — LawDocs (lawdocs.in)

LD already has a **Content Studio** (document templates, clause library, article content). Map, do not duplicate: Content Studio's article type becomes `blog_post`; its page builder blocks are migrated to the IPB-04 block library with a one-time migration script that emits a lint report (unsupported blocks become `rich_text` with a review flag). Content Studio keeps ownership of *legal document templates* (those are product content, not website content) and must not be confused with the website CMS: the Studio section labels in `apps/console` read "Website Studio" for IPB-04 and "Document Studio" for the existing product feature. LD must add: Claims Register, footer validator, CMP region switch, pricing from OH8 (LD currently types prices — migrate to `BILLING_PORT` within the first release), Resources gating, Trust Centre from IPB-08. Footer disclaimer: "technology platform, not a law firm; no advocate–client relationship" **[COUNSEL]**; blog lint must flag any post that reads as legal advice to a specific reader and any content that could be construed as advertising by advocates in breach of Bar Council of India Rules, Part VI, Chapter II, Rule 36 [LAW] where advocates author posts.

### LDC — LawDocsComply (lawdocscomply.com)

LDC has a headless CMS of its own build. Extend it to this contract rather than replacing: add `revision` immutability if missing, the state machine of §04.4.3, the block schema registry, `legal_page` versioning with re-consent, and `brand_pack`. LDC's compliance-calendar content (due dates by statute) stays a product feature but may be surfaced on the public site through a `resources_list`-style block reading the product API — numbers and dates shown publicly must carry E2 claims (source: the statute or regulator notification). The outdated-law lint uses LDC's own law register as the authoritative list for all six products (`LAW_REGISTER_PORT`, LDC as provider) — cross-file assumption for IPB-03 and IPB-07 authors.

### EQ — Equator Resolution

EQ runs **Payload**. Align: keep Payload as the editor runtime only if its collections are mapped one-to-one to `cms.content_item` types and its data lives in the `cms` schema of EQ's PostgreSQL (Payload supports PostgreSQL via Drizzle). Where Payload's native versioning differs (drafts per document), wrap it so that `cms.revision` semantics (immutable, rollback by new revision) hold; otherwise replace Payload's admin with the Studio and use `packages/cms`. Decision deadline: EQ phase 1 (`IPB-DEV-04` if Payload admin is retained, recording what the Studio IA maps to). EQ-specific standard pages: **Rules, Procedures & Fees** (versioned by year, as SAMA and Presolv360 do — research §2.1, §2.2), **Panel of Neutrals** (directory with consent, qualifications, empanelment date; no fee negotiation on page), **Code of Conduct for Neutrals**, **ODR Standards**. Footer disclaimer per §04.3.8. The Investors page must not describe EQ's dispute outcomes as "guaranteed" or cite settlement rates without E1 method notes.

### FBX — Finbyx

Build new from `packages/cms`. FBX's public site addresses regulated lenders; marketing claims about regulatory compliance ("RBI-compliant") are banned words in lint unless phrased as "designed to support compliance with …" and backed by an E2/E3 claim. Trust Centre must show the RBI outsourcing-related assurance documents from IPB-08 (SOC 2/ISO 27001 status, BCP summary, sub-contractor list, exit-assistance statement) because FBX's NBFC and bank customers must perform due diligence under the RBI (NBFC – Managing Risks in Outsourcing) Directions, 2025 and the commercial-bank equivalent [LAW; VERIFY chapter references]. White-label brand packs for resale are a first-release requirement (IPB-D-10): per-host policy set, legal entity, DPO and grievance officer.

### UDF — Udofin

Build new. Consumer-facing and an LSP: pricing display `inclusive` GST; the footer must list regulated lending partners and link to each partner's grievance officer and the RBI Sachet / CMS portals as the escalation path [LAW: RBI (Digital Lending) Directions, 2025; VERIFY paragraph numbers for LSP website disclosures, KFS, grievance officer naming and cooling-off disclosures]; the public site shows a **KFS sample** resource and the **list of lending partners** as CMS-managed items that require `PLT_LEGAL_REVIEWER` approval. Marketing pixels: `mkt.pixels.enabled` may be used on the public site only; the mobile app and all authenticated routes are sensitive routes. All loan-related numbers (APR examples) are E2 claims with the formula shown. Brand packs for partner-bank white-label are mandatory, including store identity per pack.

### OH — Infrabyx Operations Hub

Build new but minimal: OH's public site is the group corporate site (Infrabyx Group) plus internal brand packs for group verticals that lack a product (LawDocs Trainings, Shikargah Hospitality — [OWNER] confirm which get packs). Blog default off. OH is the **provider** of `BILLING_PORT`, `CRM_PORT`, `HR_PORT`, `SUPPORT_PORT`, `BACKLOG_PORT`, `TRUST_PORT`, and of the shared consent ledger; OH's Studio additionally shows cross-product dashboards (leads by product, feedback by product, policy versions in force per brand pack). OH's Investors page is the group-level one; product Investors pages link to it when `web.investors.enabled` is false for the product. Hub staff `OPS_*` roles see only their `product_scope` in the feedback inbox and leads (IPB-D-12).

## 04.8 Acceptance tests

```gherkin
@IPB-04-AT-01 Revision immutability and audit
  Given a published page with revision r1
  When an editor saves changes
  Then revision r2 is created and r1 is byte-identical to before
  And the audit ledger has an entry with actor, r1→r2 and a valid hash chain

@IPB-04-AT-02 State machine
  Given a draft page
  When the author submits it
  Then its status is in_review and the author cannot approve it
  And an AGT_* principal cannot move it beyond in_review

@IPB-04-AT-03 Maker-checker and legal gate
  Given a legal_page in in_review submitted by user A
  When user A attempts to approve
  Then the response is IPB-CMS-004
  When user B (PLT_CONTENT_EDITOR) approves without legal review
  Then the response is IPB-CMS-005
  When PLT_LEGAL_REVIEWER approves and user B approves
  Then the page may be published

@IPB-04-AT-04 Scheduling and sitemap
  Given an approved post scheduled for 09:00 Asia/Kolkata
  When the clock passes 09:00
  Then the post is live within 60 seconds, appears in sitemap.xml with lastmod, in the RSS feed, in llms.txt, and an IndexNow ping is logged

@IPB-04-AT-05 Preview URL
  Given a preview link for draft revision r3
  When fetched after 24 hours
  Then it returns 410 IPB-CMS-006
  When fetched within 24 hours by an anonymous client
  Then it renders r3 with a visible preview banner, noindex meta and X-Robots-Tag: noindex, Cache-Control: no-store

@IPB-04-AT-06 Claims Register lint
  Given a stats block with value "10,000+ customers" and no claims_ref
  When the editor submits for publish
  Then the response is IPB-CMS-010 and the block is highlighted
  Given a claims_ref of class E1 with as_of date
  Then publish succeeds and the rendered page shows the as-of date beside the figure

@IPB-04-AT-07 SEO and structured data
  Given any published standard page
  Then the HTML has exactly one h1, title, meta description, canonical, hreflang for each locale, OG tags, and valid JSON-LD of the declared type
  And the Organization JSON-LD contains legalName, CIN in identifier, contactPoint for grievance

@IPB-04-AT-08 Redirects
  Given a redirect A→B and an attempt to add B→A
  Then the response is IPB-CMS-009
  Given a legacy CSV import with 500 rows
  Then the dry run lists conflicts and chains and nothing is committed until confirmed
  Given a published page whose slug changes
  Then the old path returns 301 to the new path

@IPB-04-AT-09 Media alt text and consent
  Given an image uploaded without alt text and decorative=false
  When used in a page submitted for publish
  Then the response is IPB-CMS-007
  Given a team_member with a photo and photo_consent=false
  Then publish fails with IPB-CMS-014

@IPB-04-AT-10 Pages and menus without code
  Given a PLT_CONTENT_EDITOR
  When they create a page from the "product" template, fill required slots, add it to the header menu and publish
  Then it is live at its slug and in navigation with no deployment
  When they remove it choosing "redirect to /products"
  Then the slug returns 301

@IPB-04-AT-11 Locale fallback
  Given a page translated only in en-IN
  When requested with hi-IN
  Then the en-IN content renders with lang="en-IN" on the content region and the language switch shows hi as unavailable
  Given a machine-translated hi-IN draft
  Then publish fails with IPB-CMS-011 until a human marks it reviewed

@IPB-04-AT-12 Server rendering
  Given every published route
  When fetched with JavaScript disabled
  Then all text content of all blocks is present in the HTML, including trust badges, team grids and stats

@IPB-04-AT-13 Stale and review-due
  Given a resource with review_due in 30 days
  Then ResourceReviewDue is emitted to the owner
  Given a page unreviewed for 366 days
  Then it is listed in the stale queue and ContentStale is emitted

@IPB-04-AT-14 Public API read-only
  Given an anonymous client
  When it attempts POST /api/public/v1/content
  Then the response is 405/403 and no row changes

@IPB-04-AT-20 XSS in blog (adversarial)
  Given a blog post body containing <script>, an <img onerror=...>, a javascript: link and an SVG with <script> inline
  When saved and published
  Then the rendered HTML contains none of them, the sanitiser report lists each removal, and CSP has no unsafe-inline for scripts
  And the same payload submitted through the user-post API by an ORG_MEMBER is sanitised identically

@IPB-04-AT-21 SVG logo script (adversarial)
  Given an SVG logo containing <script>, onload=, <foreignObject>, and <use href="https://evil/">
  When uploaded in Brand Studio
  Then the response is IPB-BRD-001 or the stored SVG has all of them removed and the sanitiser report shows the removals
  And the original upload is not retained in storage

@IPB-04-AT-22 Favicon set
  Given a published brand pack
  Then /favicon.ico, /icon.svg, /apple-touch-icon.png, /icon-192.png, /icon-512.png and /site.webmanifest are served on each mapped host and manifest.name equals brand.app_name

@IPB-04-AT-23 Contrast guard
  Given a token change making body text on surface 3.9:1
  When saved
  Then the response is IPB-BRD-003 naming the pair and ratio for light and dark schemes
  And an ORG_OWNER on a white-label plan gets the same result in apps/web Settings › Customisation › Branding

@IPB-04-AT-24 Self-hosted fonts
  Given every public route
  Then no request is made to any third-party font host; all fonts load from the brand host as WOFF2

@IPB-04-AT-25 Application display name and terminology
  Given brand_pack.app_name="PartnerBank Loans" and terminology.vidhi="Sahayak"
  Then the browser title, manifest name, login page, email subject prefix and PDF header show "PartnerBank Loans" and the assistant is labelled "Sahayak" while audit records still reference the Vidhi kernel ids

@IPB-04-AT-26 Email identity
  Given a brand pack with an unverified from-domain
  When submitted for publish
  Then the response is IPB-BRD-005

@IPB-04-AT-27 Host-header brand spoof (adversarial)
  Given host "app.partnerbank.in" mapped to pack P2 and the product default pack P1
  When a request arrives with Host: evil.example and X-Forwarded-Host: app.partnerbank.in
  Then the edge rejects or serves P1 with noindex; P2 is never selected; a security event is logged
  When a request arrives for an unmapped host "unknown.example"
  Then P1 renders with noindex and IPB-BRD-007 is logged

@IPB-04-AT-28 Brand rollback
  Given published pack revisions b1 and b2
  When a super admin requests rollback to b1 and a second super admin approves
  Then b1 is the served pack, a new revision b3 (rollback_of:b1) exists and BrandPackRolledBack is emitted

@IPB-04-AT-30 Prices from catalogue only
  Given the pricing editor
  Then no field accepts a numeric price
  Given OH8 changes the Pro plan price
  When CatalogueChanged is received
  Then the pricing page shows the new price within 5 minutes
  Given a coupon expires in OH8
  Then its banner disappears on the next revalidation

@IPB-04-AT-31 GST and legal links
  Given an India brand pack with gst_display=exclusive_labelled
  Then every price shows "+ 18% GST" (or the catalogue rate) and the total payable including GST is displayed before any checkout hand-off
  And links to Payment & Subscription Terms and Refund & Cancellation Policy are visible above the fold at 360px width

@IPB-04-AT-32 Dark-pattern guard
  Given a CTA block with text "Only 2 seats left — hurry!" and no catalogue stock semantics
  When submitted
  Then the response is IPB-CMS-015
  Given a pricing page where a mandatory onboarding fee exists in the catalogue but is hidden from the table
  Then publish fails with IPB-CMS-015 (drip pricing)

@IPB-04-AT-40 Blog toggle
  Given web.blog.enabled=false
  Then /blog, /blog/feed.xml and category routes return 404, the footer omits Blog, sitemap omits posts, and posts remain in Studio

@IPB-04-AT-41 Editorial workflow
  Given a post citing "Section 66A of the IT Act"
  When submitted
  Then the outdated-law lint blocks with IPB-CMS-022 and requires legal_check
  Given a post with no flags
  Then review by a second editor is sufficient to publish

@IPB-04-AT-42 Bulk import mapping and versions
  Given a ZIP with folders "RBI/" and "DPDP/" containing 120 DOCX and MD files with images
  When imported with folder→category mapping
  Then 120 drafts exist in the mapped categories, images are in the media library in the alt-text queue, and no draft can publish until alt text is filled
  When the same ZIP is imported again
  Then each matching slug receives a new revision and the draft count stays 120

@IPB-04-AT-43 Import lint report
  Given an imported post with an uncited statistic and a link to a 404 page
  Then the lint report lists "unsupported claim" and "broken link" with locations and the report is exportable as CSV

@IPB-04-AT-44 Zip bomb (adversarial)
  Given a 2 MB ZIP expanding to 5 GB, a ZIP with a nested ZIP, and a ZIP with an entry "../../etc/passwd"
  When each is uploaded
  Then each is rejected with IPB-CMS-021 before extraction completes, the worker memory stays under its limit and the files are deleted from quarantine

@IPB-04-AT-45 User-authored posts
  Given web.blog.user_posts.enabled=true and an ORG_MEMBER with a 10-day-old account
  When they attempt to submit
  Then the response is IPB-CMS-030
  Given an eligible author who has not accepted the UGC Terms
  Then the response is IPB-CMS-030
  Given an eligible author who accepts terms v1.2 and submits a 4th post today
  Then the response is 429
  Given a queued post approved by a moderator who is not the author
  Then it is published with an "Author's view" label and the author profile

@IPB-04-AT-46 Takedown
  Given a published user post
  When PLT_CONTENT_EDITOR takes it down with reason "defamation complaint"
  Then the URL returns 410 with a dated notice, the author is notified, and a grievance record with IT Rules timelines is opened

@IPB-04-AT-47 Lead and consent hand-off
  Given a contact form submitted with the consent box unticked
  Then the response is IPB-WEB-002
  Given a submission with consent
  Then a CRM lead exists in OH with consent receipt id, consent text version, first-touch and last-touch; no field values remain in cms.form_submission after successful hand-off plus retention window
  And a newsletter sign-up receives a double opt-in email with an unsubscribe link

@IPB-04-AT-50 Click-to-load video
  Given a vlog item
  When the page loads without consent
  Then no request is made to youtube.com, youtube-nocookie.com or vimeo.com
  When the viewer clicks play and the mapped category is not consented
  Then the preference centre opens; after consent the player loads from youtube-nocookie.com

@IPB-04-AT-51 Captions and transcript
  Given a vlog item without a hi VTT
  Then publish fails with IPB-CMS-013
  Given a published item
  Then /vlog/{slug}/transcript renders the transcript text and VideoObject JSON-LD includes it

@IPB-04-AT-60 Resource versions and cite-as
  Given a resource at version 2
  When version 3 is uploaded
  Then the stable URL serves v3, ?v=2 serves v2, the cite-as string shows "v3" and the version history lists both

@IPB-04-AT-61 Gating and download tracking
  Given an email-gated whitepaper
  When downloaded after submitting name, work email and consent
  Then a CRM lead and a ResourceDownloaded event with hashed lead id exist; the file is served by a signed URL expiring in 10 minutes
  Given a plan-gated template requested by a user without entitlement
  Then the response is IPB-CMS-040 with an upgrade link

@IPB-04-AT-62 PDF accessibility probe
  Given a PDF without a text layer
  When published
  Then publish fails until a text layer is present or the item is marked "accessible version on request" with the link rendered

@IPB-04-AT-70 Standard pages present
  Given a fresh product install
  Then every page in §04.3.7 exists in Studio with its template; toggled pages are hidden on the public site, not absent

@IPB-04-AT-71 Investors page
  Given web.investors.enabled=true and a draft containing "we project 40% growth"
  When submitted
  Then the response is IPB-CMS-012
  Given a compliant draft without the disclaimer block
  Then the response is IPB-CMS-003
  Given a compliant draft with disclaimer and legal approval
  Then it publishes and the disclaimer is visible before the documents section on a 360px viewport

@IPB-04-AT-72 Trust Centre from registry
  Given the Studio Trust Centre editor
  Then no field allows typing a certification name; certifications and sub-processors appear only from TRUST_PORT
  When IPB-08 publishes a new sub-processor
  Then the page updates and the change-notice subscribers are emailed

@IPB-04-AT-73 Footer validator
  Given a brand pack with an empty GSTIN
  When CI runs cms:validate-footer
  Then the build fails naming the pack and field
  Given a published footer
  Then it shows the entity line, officers line, registered office, Delhi/Noida/Jaipur offices, at least one social link with a text label, status link, language switch, cookie settings, accessibility, sitemap, group link and the current year

@IPB-04-AT-74 Accessibility of shell
  Given the header, footer, CMP and feedback widget
  Then axe-core reports zero WCAG 2.2 A/AA violations, all controls are keyboard operable, the skip link is first in DOM, and focus order is logical

@IPB-04-AT-80 CMP equal prominence
  Given the first visit
  Then Accept all, Reject all and Manage have equal size and weight; pressing Escape or closing without choice records reject for all non-necessary categories
  And the Cookie settings footer link reopens the preference centre with current choices

@IPB-04-AT-81 GPC
  Given a request with Sec-GPC: 1
  Then analytics and marketing default to rejected and the banner says a privacy signal was honoured

@IPB-04-AT-82 Consent ledger and re-prompt
  Given a choice is made
  Then a ledger record exists with categories, banner text version, policy version, region and receipt id; changing the choice creates a second record
  Given the banner text version is bumped
  Then the next visit re-prompts

@IPB-04-AT-83 Pixel firing before consent (adversarial)
  Given every public route and a fresh profile with no consent, and GTM web adapter configured with Meta, LinkedIn and Google Ads tags
  When each route is loaded and interacted with for 10 seconds
  Then zero network requests are made to any third-party analytics or pixel domain; the only external hosts are the brand CDN
  Given consent to analytics only
  Then GA4/PostHog requests occur and pixel domains remain silent

@IPB-04-AT-84 Region wording
  Given edge country=DE
  Then the banner uses GDPR wording with Reject all on the first layer
  Given edge country=US and state=CA
  Then a "Do Not Sell or Share" control is present

@IPB-04-AT-85 No marketing on authenticated routes
  Given a logged-in user in apps/web
  Then no marketing consent is requested, no pixel script is present in the HTML or network log, and only the first-party analytics adapter (if enabled) runs

@IPB-04-AT-86 Pixel scope
  Given mkt.pixels.enabled=[meta] and a route matching mkt.sensitive_routes (e.g., /contact)
  Then the pixel is not rendered and IPB-WEB-005 is logged if any adapter attempts it

@IPB-04-AT-87 Attribution
  Given a first visit via ?utm_source=li&li_fat_id=abc and a later visit via ?gclid=xyz
  When a lead is created
  Then the CRM lead carries first-touch (li) and last-touch (gclid) recorded server-side and nothing was stored client-side before consent

@IPB-04-AT-88 A/B constraints
  Given an experiment proposed on the Privacy Notice
  Then creation is refused
  Given an experiment on the home hero with two legal-approved revisions
  Then assignment is stable per consent id and the result report shows the primary metric only

@IPB-04-AT-89 SEO health
  Given a nightly run
  Then broken links, orphans, duplicate titles, missing canonicals and CWV budget breaches are listed with owners, and a Lighthouse CI run over budget fails the release pipeline

@IPB-04-AT-90 Feedback presence
  Given every public page and every authenticated page
  Then a feedback trigger is reachable by keyboard and NPS is never shown in a first session

@IPB-04-AT-91 Feedback payload minimisation (adversarial)
  Given a crafted request to the feedback endpoint including "page_html" and a full URL with query string
  Then the server rejects with IPB-FB-001 and stores nothing; a normal submission stores route pattern, version, trace id and no query string

@IPB-04-AT-92 Feedback status loop
  Given a bug submitted by a tenant user
  Then an OH support ticket exists, the user sees a reference, and when the ticket is marked shipped the user's view shows "shipped"

@IPB-04-AT-93 Unprivileged publish (adversarial)
  Given an ORG_ADMIN of a tenant with a stolen Studio URL
  When they call the Studio publish endpoint with their session
  Then the response is 403 via Cerbos and the attempt is in the audit ledger
  Given a PLT_CONTENT_EDITOR
  When they attempt to publish a legal_page alone
  Then the response is IPB-CMS-005

@IPB-04-AT-94 SSRF via embed (adversarial)
  Given an embed block with url "http://169.254.169.254/latest/meta-data" and another with "http://10.0.0.5/admin" and a DNS name resolving to a private IP
  When saved or previewed
  Then each is rejected with IPB-WEB-004; no server-side request is made beyond the allow-listed providers; the fetch layer blocks private ranges after DNS resolution

@IPB-04-AT-101 Edit during scheduled countdown (concurrency)
Feature: Approval is voided by any edit
  Scenario: Editor changes a scheduled post
    Given post P is scheduled for 10:00 on revision r5
    When the editor saves a body change at 09:59 creating revision r6
    Then P is in state draft with scheduled_revision_id cleared
    And the 10:00 worker run skips P and writes a ledger row "skipped: not scheduled"
    And the public site still serves the last published revision of P
  Scenario: Legal reviewer requests changes
    Given P is in legal_review
    When PLT_LEGAL_REVIEWER requests changes with a reason
    Then P returns to draft and the author is notified with the reason

@IPB-04-AT-100 Studio IA
  Given a PLT_CONTENT_EDITOR in a product with blog disabled
  Then the Blog section is visible with the toggle explanation and editing is possible for drafts
  Given a media item used on three pages
  When deletion is requested
  Then "where used" lists the three pages and soft-delete with 30-day restore applies
```

## 04.9 Open items

| ID | Item | Owner | Default |
|---|---|---|---|
| IPB-OI-04-01 | Choose the plagiarism-check vendor (or none) for `PLAGIARISM_PORT`. | [OWNER] | OFF (`cms.import.plagiarism_adapter=none`, warning only) |
| IPB-OI-04-02 | Whether aggregate, identifier-free analytics may run under `necessary` under DPDP; counsel view required before any adapter is so classified. | [COUNSEL] | OFF (all analytics require consent) |
| IPB-OI-04-03 | ISL (Indian Sign Language) rendition production pipeline and vendor; currently optional upload only. | [OWNER] | OFF |
| IPB-OI-04-04 | EQ: retain Payload admin (wrapped) or migrate to Studio; record as `IPB-DEV-04` if retained. | EQ lead | Migrate to Studio |
| IPB-OI-04-05 | OH: which group verticals without a product (LawDocs Trainings, Shikargah Hospitality) receive brand packs and sites. | [OWNER] | OFF (no packs) |
| IPB-OI-04-06 | GTM server-side container hosting (own Cloud Run/ECS vs none) and cost; adapter exists, default `none`. | PLT_SUPER_ADMIN | `none` |
| IPB-OI-04-07 | Public idea board exposure (public vs tenant-scoped) and moderation staffing. | OPS_PRODUCT | OFF |
| IPB-OI-04-08 | LD: migration path and sunset date for Content Studio's page builder. | LD lead | Dual-run one release, then IPB-04 only |
| IPB-OI-04-09 | Exact IT Rules 2021 r.3(2) timelines after the Feb 2026 synthetic-media amendment; confirm 3-hour class applies to UGC on our blogs. | [COUNSEL] [VERIFY] | Treat all takedown complaints at the strictest timeline |
| IPB-OI-04-10 | Comments feature: whether to ship at all in v1 given moderation load. | [OWNER] | OFF |
| IPB-OI-04-11 | `hreflang` strategy for white-label hosts that serve one locale only. | PLT_CONTENT_EDITOR | Emit `x-default` only |
| IPB-OI-04-12 | Ecosystem Spec acceptance of the proposed events in §04.6.2. | Ecosystem Spec editor | Products buffer locally until accepted |
