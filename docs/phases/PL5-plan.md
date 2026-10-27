# PL5 — Public website kit

**Phase:** PL5 (IPB-14 §14.3) · **Packages:** first releases of `ui`, `a11y`, `hlp`, `brand`, `cms`, `consent`, `feedback` and `trust`, plus the reference group site `apps/public`; additions to `contracts`, `config`, `testing` and `seed`.
**Date:** 2026-10-27 · **Branch:** `claude/vibrant-babbage-udtz4j`
**Status:** written and self-reviewed under the continuous-build mode (PL2-D-41). Defaults for open points are logged as PL5-D-01 and OWNER-QUESTIONS #41–#50; implementation starts without waiting (the owner reviews plans in batches). **Owner answers #41–#52 applied on 27 Oct 2026 (PL5-D-05):** the Studio screens and a reference `apps/console` join PL5 (§9.6, sessions 8–9); the approved purge periods are built as ledgered sweeps (§10); the contrast guard checks colours by role (§5.2); `sharp` failed the licence check, so uploads stay as uploaded (#53). **Owner answers #53–#59 applied on 27 Oct 2026 (PL5-D-11):** a licence exception for the libvips binaries, so the MEDIA port (`sharp`, alternative `passthrough`) re-encodes uploads and rasterises favicons with `cms.media.reencode_enabled` on (§1.2, §5.3); the notice for a MAJOR Terms change counts from the date users are notified (§5.7); form consents for marketing leads end 24 months after the last interaction (§6.1, §10); #54, #56, #58 and #59 kept as defaulted.

**Self-review (27 Oct 2026).** Checked against IPB-04-01…103, IPB-05-01…12, IPB-06-01…66, IPB-07-01…60, IPB-08-01…39 and IPB-13-01…20, and against Ecosystem Spec v1.2 §5.4, §6.15, §6.27, §6.34–§6.40 and §13–§15, row by row:

- every M row that a public website or a product shell needs is built, or deferred with a flag that defaults off, a named default and an owner question (§1.2, §13);
- nothing weakens an IPB-02 control: maker-checker stays as specified, agents stay makers only, no tag or pixel can load before consent, and the CSP has no `unsafe-inline`;
- nothing deletes data: soft delete has no purge job, form payloads are never stored, and consent records are kept (§10);
- no new cryptography: preview tokens use the random, server-side, revocable pattern approved for unsubscribe links (PL3-D-06), gated files use STORAGE presign, and evidence-pack signing (ed25519) stays off (§10);
- no external account, paid service or recurring cost: every vendor port ships a `none` or fixture adapter;
- no Ecosystem event is emitted live: v1.2 (N12) events need every product owner's approval first (Ecosystem §6.1), so emitters sit behind flags that default off (§3.6).

Where the IPB files disagree with each other or with the Ecosystem Spec, the Ecosystem Spec wins on the wire. Each choice is a decision row, and each spec fix is a platform request (PR-025 to PR-032).

**Read for this plan:**

- IPB-04, IPB-05, IPB-06, IPB-07, IPB-08 and IPB-13 in full (requirements, design sections, settings, events, error codes, acceptance tests, open items);
- Ecosystem Spec v1.2: §2 principles, §3.2–§3.12 envelope and errors, §4.5 and §4.7 scopes and auditor access, §5.2–§5.4 entities (#29 consent artefact, #55 brand pack, #56 terminology, #57 vendor assurance document) and code tables, §6.14–§6.17, §6.27, §6.29, §6.34–§6.40, §13–§15;
- IPB-01 ports and shared packages; IPB-02 §02.4.3.1 data classes, §02.4.6.1 risk classes, CSP and sanitisation rows; IPB-09 required checks; IPB-10 event naming; IPB-14 §14.2–§14.3;
- `docs/DECISIONS.md`: IPB-D-03, IPB-D-08, IPB-D-10, IPB-D-11, OWN-09, OWN-11, OWN-12, OWN-13, OWN-14, PL2-D-32 (7-day rule), PL3-D-05 (C-23), PL3-D-06 (C-22, unsubscribe token), PL3-D-21 (service readers).

**Owner decisions built in** (27 Oct 2026 instruction, with OWN-09 and OWN-11):

| #   | Decision                                                                                                                                                                                                                                                                        | Where in this plan |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| O-1 | Group website at launch: **Home, About, Group companies, Careers, Trust, Contact, Policies**. **Blog OFF, Investors page OFF** (OWN-11). The other standard pages exist, hidden by setting (IPB-04-65)                                                                          | §9                 |
| O-2 | Cookie banner: **Accept and Reject with equal prominence** (and Manage). **No tracking script before consent; no tag manager at launch**; analytics later through **self-hosted PostHog** (OWN-09)                                                                              | §6, §9.4           |
| O-3 | **WCAG 2.2 AA** and the IPB-06 rules, **checked with axe in CI**                                                                                                                                                                                                                | §2, §11            |
| O-4 | Footer: **legal entity name, CIN and registered office from configuration** (never hard-coded), **Grievance Officer contact**, and the policy links                                                                                                                             | §5.6, §9.3         |
| O-5 | **No customer names, real testimonials or claims** such as "RBI approved", "ISO certified" or "100% secure" in any seed content (Claims Register rule)                                                                                                                          | §5.4, §9.5         |
| O-6 | Officers: the owner is DPO and Grievance Officer for every entity initially (OWN-13); no brand packs for LawDocs Trainings or Shikargah Hospitality yet; Hindi later (OWN-11). The seed carries the officer details from configuration too, with reserved example values in dev | §9.3               |

---

## 1. Scope

### 1.1 What PL5 delivers

| Package              | Delivers                                                                                                                                                                                                                                                                                                                                                                                                                                                 | IPB rows                                       |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `@infrabyx/ui`       | Design tokens for the six products in four themes (light, dark, high-contrast light and dark) with contrast tests; CSS generation; server-renderable React components (AppShell, SkipLinks, Header, Footer, Breadcrumb, Nav, Button, Field, ErrorMessage, Dialog, Popover, HelpButton, LiveRegion, DataTable, ClickToLoad, Chart with table); `ui/i18n` formatters                                                                                       | IPB-06 §06.3.2, 06-16…34; IPB-07-02…13, 26, 31 |
| `@infrabyx/a11y`     | The journey registry and its lint; `mapping.json`; the 40-item checklist; screen-reader script template; the statement generator; hooks; the Playwright gate helpers (axe, HTML_CodeSniffer, reflow, text scale, focus, zero third-party requests); the overlay scan                                                                                                                                                                                     | IPB-06-01…06, 15, 22, 54…63                    |
| `@infrabyx/hlp`      | The glossary registry (schema, platform entries, aliases, `superseded_by`), `infrabyx-hlp lint` (help keys, plain ≤40 words, LAW citations need a reviewer), the public glossary data, the tours registry and its lint                                                                                                                                                                                                                                   | IPB-07-28, 34, 41…50, 53, 57                   |
| `@infrabyx/brand`    | Brand packs in the Ecosystem shape `tenancy/brand_pack/1.0.0` (schema `brand`), revisions, maker-checker publish and rollback, the contrast guard with a suggested colour, the SVG sanitiser, the favicon set and manifest, the host map (unknown host → default pack + `noindex`), terminology, email identity check through NOTIFY                                                                                                                     | IPB-04-21…32; IPB-07-31…33; IPB-06-59          |
| `@infrabyx/cms`      | Content items and immutable revisions (schema `cms`), the named state machine, approvals with legal review, the Claims Register and its lint, the sanitiser, slugs and redirects, SEO and JSON-LD, sitemap, robots and `llms.txt`, preview tokens, the scheduler, the read-only public API, the footer validator, policies (IPB-05) with parameters, lint, versions and the archive, resources with versions, forms hand-off, pricing from the catalogue | IPB-04-01…20, 33…40, 58…74; IPB-05-01…12       |
| `@infrabyx/consent`  | The CMP (banner and preference centre, server-rendered), the consent ledger behind the CONSENT port (local PostgreSQL adapter), versioned consent texts, the acceptance ledger, GPC, region wording, script gating, sensitive routes, the TAG_MANAGER and ANALYTICS ports with `none` adapters                                                                                                                                                           | IPB-04-75…88; IPB-05-05, 18 (T5, T18)          |
| `@infrabyx/feedback` | Feedback items (schema `feedback`) with minimisation (`IPB-FB-001`), the widget and its no-JavaScript fallback, rate limits, NPS rules, the SUPPORT and BACKLOG ports (fixture adapters), the status loop, the accessibility-report channel and its SLA timers                                                                                                                                                                                           | IPB-04-94…99; IPB-06-61…62; IPB-07-58          |
| `@infrabyx/trust`    | The read-only vendor-assurance mirror (schema `trust`) fed through the TRUST port, digest checks, the mirror state machine, the public Trust Centre data (published, public, held only, claim fallback), `security.txt`, NDA acceptance records, document requests                                                                                                                                                                                       | IPB-08-01, 06, 08, 22…29, 34, 38, 39           |
| `apps/public`        | The reference Infrabyx group site on Next.js 16 with every launch page (§9), the footer, the CMP, the CSP nonce and security headers, the generated files (sitemap, robots, `llms.txt`, `security.txt`, `/legal/index.json`, favicon set), and the end-to-end and accessibility gates                                                                                                                                                                    | IPB-04-65…74; IPB-05-02, 04, 09, 11            |

The packages are libraries: products install them and mount them in their own `apps/public`, `apps/web` and `apps/console`. The reference site is the template products copy (IPB-14 §14.2) and the group website itself (OWN-11).

### 1.2 What PL5 is not (deferred, each behind a flag that defaults off)

| Deferred                                                                                                             | Why                                                                                                                                                                      | Flag or setting                                     | Owner question      |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------- | ------------------- |
| ~~The 17-section Studio screens~~ — **now in PL5** (#41, PL5-D-05; §9.6)                                             | Built once as reusable screens plus a reference `apps/console`; products and OH mount them                                                                               | —                                                   | #41 (answered)      |
| Blog bulk import and ZIP handling (IPB-04-44…46, 63), user posts, comments and takedown (IPB-04-47…50)               | Blog is OFF for the group site (OWN-11); the ZIP and antivirus pipeline needs the AV port and a sandboxed worker                                                         | `web.blog.enabled`, `web.blog.user_posts.enabled`   | #42                 |
| Marketing tooling: tag manager adapters, analytics adapters, pixels, attribution, webhooks, A/B tests (IPB-04-85…90) | No tag manager at launch, analytics later through self-hosted PostHog (OWN-09)                                                                                           | `mkt.tag_manager.adapter = none`, `mkt.ab.enabled`  | —                   |
| ~~Media re-encoding to AVIF and WebP (IPB-04-11) and the PNG favicon renditions~~ — **now built** (#53, PL5-D-11)    | The owner approved a licence exception for the unmodified, dynamically loaded libvips binaries; `sharp` sits behind the MEDIA port with `passthrough` as the alternative | `cms.media.reencode_enabled` (now true)             | #43, #53 (answered) |
| Gated vendor-assurance downloads with watermarks, evidence packs, auditor grants, questionnaires (IPB-08-09, 18…20)  | Pre-go-live items before the first regulated tenant (FBX or UDF; #44): a DOCGEN watermark adapter; packs signed ES256 through KMS (C-22 pattern); a grantee realm        | `flg_trust_pack_signing`, `flg_trust_questionnaire` | #44 (answered)      |
| Tutorial pipeline, social clips, "Ask Vidhi" in help (IPB-07-48, 54, 59)                                             | Pipeline needs recorded tutorials and TTS; AI help needs the owner's AI settings per tenant                                                                              | `tut.auto_publish`, `hlp.vidhi.expand_enabled`      | —                   |
| PDF policy downloads (IPB-05-08) and PDF/UA checks (IPB-06-26)                                                       | No DOCGEN adapter yet                                                                                                                                                    | `flg_pdf_ua`                                        | —                   |
| Mermaid block, motion explainers, interactive tutorials (IPB-13-15, 18, 19)                                          | Optional (`O`) rows, off by default in IPB-13                                                                                                                            | `cms.blocks.mermaid.enabled`, `hlp.motion.enabled`  | —                   |
| Twelve-locale readiness beyond en-IN and hi-IN (IPB-06-43)                                                           | Hindi later (OWN-11); UDF needs all twelve, in its own phase                                                                                                             | `flg_i18n_locales_extended`                         | —                   |
| Live captions, ISL booking, voice twins, mobile (IPB-06-08, 12, 42, 48…53)                                           | Product-only rows                                                                                                                                                        | `flg_live_captions`, `flg_isl_booking`              | —                   |

---

## 2. Package changes and dependency order

`contracts` → `config` → `testing` → `ui` → `a11y` → `hlp` → `brand` → `cms` → `consent` → `feedback` → `trust` → `seed` (public site seed module) → `apps/public`.

- `ui` depends only on `contracts`, `react` and `react-dom` (peer). It holds the tokens (IPB-06 and IPB-07 name a `packages/tokens`; IPB-14 §14.2 says "design tokens per product" belong to `ui`), so tokens are the sub-export `@infrabyx/ui/tokens` and the formatters `@infrabyx/ui/i18n` (PL5-D-01 item 2; PR-025).
- `cms` uses the workflow approvals engine pattern but keeps its own `cms.approval` table, because IPB-04 §04.4.1 names it and its rules (legal reviewer, DPO for privacy-class policies) differ from the tenancy approvals.
- Marketing (`packages/marketing` in IPB-04 §04.3.10) is not a PL5 package: the parts needed now (sensitive routes, the TAG_MANAGER and ANALYTICS ports with `none`) live in `consent` (PR-025).
- Tutorials (`packages/tut` in IPB-13) fold into `hlp`, as IPB-07 §07.3.5 has them (PR-025).

**New third-party dependencies** (each at least 7 days old on 27 Oct 2026 and on the licence list; re-checked when added):

| Package                            | Version | Licence      | Used by                                              |
| ---------------------------------- | ------- | ------------ | ---------------------------------------------------- |
| `react`, `react-dom`               | 19.3.1  | MIT          | `ui` (peer), `apps/public`                           |
| `next`                             | 16.4.2  | MIT          | `apps/public` only                                   |
| `@playwright/test`                 | 1.64.1  | Apache-2.0   | `a11y` gate helpers, `apps/public` e2e (dev)         |
| `axe-core`, `@axe-core/playwright` | 4.14.0  | MPL-2.0      | `a11y` (dev and CI)                                  |
| `html_codesniffer`                 | 2.5.1   | BSD-3-Clause | `a11y` (the Pa11y engine; Pa11y itself is LGPL, #45) |
| `lighthouse`                       | 13.5.x  | Apache-2.0   | `a11y` CI gate (dev only; checked when added)        |
| `parse5`                           | 8.0.1   | MIT          | `cms` sanitiser (HTML import to portable text)       |
| `@xmldom/xmldom`                   | 0.9.12  | MIT          | `brand` SVG sanitiser                                |

No hosted CMS, CMP, font CDN, overlay or analytics SDK is added; `ipb:check` gains a rule that rejects them (IPB-04-01, IPB-06-22).

---

## 3. Cross-cutting design

### 3.1 One module, one schema

New schemas: `brand`, `cms`, `consent`, `feedback`, `trust`. `ui`, `a11y` and `hlp` have no tables in PL5 (the glossary registry and journeys are versioned files; IPB-07 §07.4.4 ships the registry with the build). IPB-04 §04.4.1 lists `brand_pack`, `consent_text` and `feedback_item` inside the `cms` schema; PL5 puts each in the schema of the package that owns it, so no package reads another's tables (PL5-D-01 item 3).

### 3.2 Platform-scoped content under RLS

Website content belongs to the platform, not to a tenant. As in `ai` (model and prompt registries), these tables carry `tenant_id` and every row is written under `PLATFORM_TENANT_ID` in a platform-scope kernel context, so forced RLS and `infrabyx-rls-lint` still apply. Public reads go through a read-only service context (`cms.public` reader), never an anonymous database role.

### 3.3 Every mutation through the kernel

Every write is a `kernel.mutate` with an audit ledger entry in the same transaction (IPB-04-18, IPB-08-39). Studio service methods take a `KernelContext` and check roles in the package (IPB-04 §04.3.12 role table); products put their AUTHZ adapter in front (Cerbos in the reference stack).

### 3.4 Agents are makers only

`AGT_*` principals may create drafts and submit them (`draft → in_review`), and nothing else: no approve, publish, unpublish, rollback, takedown, consent change or trust action (IPB-04 §04.4.3, IPB-08-12). The check is in the state machine, not in callers.

### 3.5 Server rendering, no client dependency

Every component in `ui` renders on the server; the only client code on the public site is the CMP controller, the feedback dialog and the click-to-load controller, each a small first-party script under the CSP nonce, and each page works without JavaScript (IPB-04-16, IPB-04-98, IPB-05-11).

### 3.6 Events

Internal events use `in.<product>.<module>.<Event>.v1` through the outbox (IPB-04 §04.6.1, IPB-05 §05.6, IPB-06 §06.6.1, IPB-07 §07.6.1, IPB-08 §08.6.1). The Ecosystem v1.2 events that these packages produce (`BrandPackPublished`, `PolicyEffective`, `MarketingConsentUpdated`, `LeadCaptured`, `CareerApplicationReceived`, `FeedbackSubmitted`, `VendorAssuranceDocumentAcknowledged`, `BlogPostPublished`, `ResourcePublished`, `GlossaryEntryPublished`) get payload schemas in `contracts`, but their emitters are behind `eco.v12.emit_enabled` (new, false) until the owner records v1.2 approval (Ecosystem §6.1 (A) rule; #46).

### 3.7 Fail closed

- Consent ledger unreachable: the choice is kept in the first-party cookie and queued; non-necessary scripts stay off (`IPB-WEB-001`).
- Catalogue unreachable: "pricing temporarily unavailable", never a figure older than 24 hours (`IPB-WEB-006`).
- Unknown host: the default pack with `noindex` (`IPB-BRD-007`, Ecosystem `brand-host-unknown`).
- Claims lint or legal review missing: publish refused.
- Trust mirror stale: served with an "as of" label, never hidden or presented as current.

---

## 4. `@infrabyx/ui` and `@infrabyx/a11y`

### 4.1 Tokens (IPB-07 §07.4.1, IPB-06-16, 06-59)

- One token set per product (LD, LDC, EQ, FBX, UDF, OH and the group pack `GRP`, which uses the OH set) and theme (`light`, `dark`, `hc_light`, `hc_dark`), as JSON under `packages/ui/tokens/<product>/<theme>.json`, with the full semantic list of IPB-07 §07.4.1 (colour pairs, focus, radius, shadow, space, type scale, fonts, durations).
- Every declared foreground/background pair carries contrast metadata; a unit test checks ≥4.5:1 for text and ≥3:1 for non-text in light and dark, and ≥7:1 for text in the high-contrast themes (`@IPB-06-AT-10`).
- `contrastRatio`, `meetsContrast` and `nearestCompliant` (lightness search) are exported for the brand contrast guard.
- `toCss(tokens)` emits CSS custom properties; `prefers-color-scheme` and `prefers-contrast` select a theme until the user chooses (cookie on the public site, profile in apps).
- Where the Ecosystem brand-pack shape differs (`tokens.colour {primary, accent, surface, on_surface}`, `font {sans, mono}`), `brand` maps it to the IPB-07 names (PL5-D-01 item 4; PR-027).

### 4.2 Components

Every component renders on the server, uses tokens only, meets the target size (24×24 CSS px) and the focus ring (2 px, 4 px enhanced), and is covered by the gallery route that the CI gate scans (§11):

- **Shell:** `AppShell` (landmarks, one `main`), `SkipLinks` (main, navigation; first in the DOM), `Header` (≤7 nav items, enforced), `Footer` (§5.6), `Breadcrumb` (every page below top level, IPB-06-02), `pageTitle()` (`<Page> · <Module> · <Product display name>`).
- **Forms:** `Field` (visible label, `helpKey` required, `autocomplete` tokens, error linked with `aria-describedby`), `ErrorSummary`, `ErrorMessage` (what happened, why, what to do, help key, code), `Button` (one primary per screen, IPB-07-06), `Checkbox` (never pre-ticked for consent).
- **Overlays:** `Dialog` (focus trap only while modal, Esc closes, focus returns), `Popover` and `HelpButton` (IPB-07 §07.4.4: dismissible, hoverable, persistent, one at a time).
- **Status and media:** `LiveRegion` and `Toast` (`role="status"`, errors `role="alert"`), `DataTable` (`<caption>`, `<th scope>`, `aria-sort`, reflow at 320 px), `Chart` (data-table toggle, text summary), `ClickToLoad` (poster, provider named, no request before click and consent; IPB-04-54), `MediaPlayer` (captions tracks, no autoplay with sound).
- **Labels:** `AiLabel` and `SgiLabel`, taking the strings from `@infrabyx/vidhi` `disclosure` (IPB-13-04).

`ui/i18n`: message lookup with `en-IN` and `hi-IN` catalogues and fallback `<locale> → hi → en` (IPB-06-43), `formatAmountInr` (Indian grouping, `₹12,34,567.00`), `amountInWords` (en and hi), `formatDate` (`DD MMM YYYY`, Asia/Kolkata). The other ten locales stay behind `flg_i18n_locales_extended`.

### 4.3 `@infrabyx/a11y`

- `journeys/<product>.yaml` with the §06.4.3 schema; `infrabyx-a11y journeys-lint` fails a route that is in no journey and not `out_of_journey`, and a `voice: true` journey without `text_twin_journey_id` (`IPB-A11Y-009`, `@IPB-06-AT-07`).
- `mapping.json` maps each WCAG 2.2 A/AA success criterion to EN 301 549; the IS 17802 column stays `[VERIFY]` until the standard text is bought (OI-06-02, an owner cost).
- `checklist.md` (the 40 items) and `at-scripts/_template.md` (§06.4.4).
- `statement`: `generateStatement(releaseRecord)` builds the accessibility statement (IPB-06-57 and IPB-05 template 10) from the release record: CI results per route, checklist, AT runs and open accessibility feedback. It refuses "Conforms" for a journey with an open P1 or P2 (`IPB-A11Y-010`, `@IPB-06-AT-19`). Conformance is not editable; the narrative is.
- `hooks`: `useReducedMotion`, `useTextScale`, `useAnnounce`, `useShortcut` (single-key shortcuts off by default; remaps; `@IPB-06-AT-14` at component level).
- `playwright` helpers:
  - `axeScan(page, { tags: ['wcag2a', 'wcag2aa', 'wcag22aa'] })` failing with `IPB-A11Y-004: <rule> on <route>` (`@IPB-06-AT-01`);
  - `htmlcsScan` with the WCAG2AA standard (zero errors; #45);
  - `reflowCheck(320×256)`, `textScale(200)`, `focusVisible`, `skipLinkFirst`;
  - `thirdPartyRequests(page)`, which records every request outside the site's own origin.
- `overlay-scan`: `infrabyx-a11y overlay-scan <dir>` fails on any known accessibility-overlay vendor script or domain in the build output or page config (`IPB-A11Y-003`, `@IPB-06-AT-12`).
- Lighthouse: `infrabyx-a11y lighthouse <urls>` fails below `a11y.ci.lighthouse_min` (95, may not be lowered) and over the IPB-04 budgets (LCP 2.5 s, CLS 0.1, INP 200 ms; `@IPB-06-AT-02`).

---

## 5. `@infrabyx/hlp`, `@infrabyx/brand` and `@infrabyx/cms`

### 5.1 Help system (IPB-07 §07.3.4, §07.4.3)

- Registry files `packages/hlp/registry/<module>.yaml`, one entry per key `hlp.<module>.<term>`, with the §07.4.3 fields. Products add their own registry directory; `hlp.shared.*` keys are accepted as resolved (Ecosystem §6.38).
- `infrabyx-hlp lint --registry <dir>... --keys <file|dir>...` reports `IPB-HLP-001` (key used but absent), `IPB-HLP-002` (plain over 40 words), `IPB-HLP-003` (LAW citation without a `PLT_LEGAL_REVIEWER` reviewer of record) and `IPB-HLP-004` (a referenced key deprecated without `superseded_by`). Keys are collected from `helpKey="…"` props, the settings tree, the error catalogue and the notification catalogue (`@IPB-07-AT-02`, `-AT-15`).
- Tours registry with lint: at most 7 steps, never anchored on a regulated-step route (`IPB-TUT-003`, `@IPB-07-AT-19`).
- `publicGlossary(registry, locale)` returns public, published entries grouped A–Z for `/glossary` (`@IPB-07-AT-17`).

### 5.2 Brand packs (IPB-04 §04.3.2, Ecosystem §5.4, §6.35)

- Schema `brand`, migration `brand/0001_init.sql`:
  - `brand.pack` (`brd_`): product, status, `published_revision_id`;
  - `brand.pack_revision` (`brv_`): the shared shape as JSONB, `contrast_guard_passed`, maker, checker;
  - `brand.host`: host unique group-wide, role from APP, PUBLIC, API, SANDBOX_API or MAIL, `verified`.
- `BrandStudio.saveDraft` validates the shape, runs the contrast guard (`IPB-BRD-003` / `IPB-A11Y-006` with the pair, the ratio and a suggested colour; `@IPB-04-AT-23`, `@IPB-06-AT-11`, `@IPB-07-AT-24`) and stores the sanitised SVG logo only (`IPB-BRD-001`; `@IPB-04-AT-21`).
- `BrandStudio.submit` checks the publish preconditions:
  - the contrast guard passes and the SVG is sanitised;
  - the favicon set and `site.webmanifest` exist;
  - the email identity is verified through a NOTIFY hook (`IPB-BRD-005`);
  - the policy set is published (`IPB-BRD-006`);
  - every host is unique (`IPB-BRD-002`);
  - the footer validator passes.
- The contrast guard checks each colour by role (PL5-D-05, #52): the primary keeps ≥3:1 on the surface with text on it ≥4.5:1; the accent is a fill only, with text on it ≥4.5:1, and is never text, an icon, a border or a focus ring on a light surface; a failing use names its role and, where a colour change fixes it, the nearest compliant colour.
- `approve` needs a second `PLT_SUPER_ADMIN` or a `PLT_RELEASE_MANAGER` (checker ≠ maker), and `PLT_LEGAL_REVIEWER` when legal or policy fields changed (Ecosystem §13). Approval publishes the pack.
- `rollback(to)` creates a new revision `rollback_of: <id>` under the same maker-checker rule (`@IPB-04-AT-28`). Events: `in.<p>.tenancy.BrandPackPublished.v1` / `BrandPackRolledBack.v1`.
- `resolveHost(host, forwardedHost)` compares the `Host` header against published hosts only. An unknown or spoofed host gets the product's default pack with `noindex` and a security event (`@IPB-04-AT-27`).
- Favicon set: `icon.svg` and `site.webmanifest` from the sanitised logo, with name = `app_name` and theme colour from the tokens; the PNG sizes come from an uploaded PNG master until the raster library is approved (#43; `@IPB-04-AT-22` at file level).
- `app_name` and `terminology_override` apply to titles, the manifest and labels; kernel ids never change (`@IPB-04-AT-25`).

### 5.3 Content, revisions and the state machine (IPB-04 §04.3.1, §04.4.3)

- Schema `cms`, migration `cms/0001_init.sql`:
  - `content_item` (typed prefixes: `pg_` page, `sec_` section, `nav_` menu, `ftr_` footer, `ofc_` office, `faq_`, `job_`, `tm_` team member, `prs_` press, `res_` resource, `pst_` blog post, `lgl_` legal page, `frm_` form);
  - `revision` (immutable: an update trigger refuses changes; rollback is a new revision with `source = rollback_of:<id>`);
  - `approval`;
  - `redirect` (partial unique on `from_path`);
  - `media` (metadata; alt or `decorative` with reason, `photo_consent`);
  - `claim` (`clm_`);
  - `preview_token`;
  - `policy_set`, `policy_instance`;
  - `resource_version`;
  - `form` and `form_submission` (id, destination ref, consent receipt, state; no field values).
- Content types in PL5: page, section, nav_menu, footer, office, faq, glossary_term (mirrors `hlp`), job, team_member, press_item, legal_page, resource, blog_post (built, off), form, pricing_copy, changelog_entry. vlog_item, case_study, testimonial and landing_page are registered and refuse publish until their gates exist (#42).
- The block library for PL5: hero, feature_grid, steps, rich_text (portable text), media, cta, faq_accordion, resources_list, team_grid, timeline, stats (claim ≥ E1 required), logo_wall and testimonial (both refuse without permission evidence), form, tabs, pricing_table, embed (allow-listed providers only, server fetch through an EGRESS guard with the private-IP block; `@IPB-04-AT-94`).
- The state machine (`packages/cms/src/state.ts`) lists every named transition of §04.4.3 with the 26 October revisions. Anything else is `IPB-CMS-003` (PR-030 asks to split that code). Rules:
  - the author cannot approve (`IPB-CMS-004`);
  - legal_page, pricing_copy, footer, redirect, brand_pack, investors and trust need `PLT_LEGAL_REVIEWER` (`IPB-CMS-005`);
  - privacy-class policies (templates 1, 5, 9, 15, 18) need `PLT_DPO` too (`IPB-POL-006`);
  - an edit of an approved or scheduled item returns it to draft and voids the approval;
  - the scheduler publishes only if `scheduled_revision_id` still equals the approved revision, otherwise skips and ledgers it (`@IPB-04-AT-101`).
- Tests: `@IPB-04-AT-01`, `-02`, `-03`, `-93`, `-101`.
- `Scheduler.tick()` (once a minute, one worker): publish and unpublish at the minute, Asia/Kolkata by default. Each publish regenerates the sitemap and feeds and queues IndexNow when `web.seo.indexnow.enabled`; the IndexNow adapter is `none` until the owner approves it (`@IPB-04-AT-04`).

### 5.4 Claims Register and lint (IPB-04-07, 66; IPB-05 §3h; IPB-08-24; O-5)

- `cms.claim` with evidence class E0–E4, `as_of`, source, evidence document id (`vad_`), review date and state.
- Lint on every publish and on seed content:
  - stats, logo_wall, testimonial, case_study outcomes and certification badges without a claim at E1 or above → `IPB-CMS-010` (`@IPB-04-AT-06`);
  - the IPB-05 banned words (guarantee, assured, risk-free, "fully compliant", forward-looking phrasing) → `IPB-POL-003` / `IPB-CMS-012`;
  - the owner's list (O-5) → `IPB-CMS-012`: "RBI approved" and "RBI-compliant", "ISO certified" and any "certified" without a held certificate, "100% secure", "unhackable", "bank-grade security", "first", "largest", "only", "No. 1";
  - certifications or audits asserted without a `clm_` linked to a current published trust document → `IPB-TRUST-006` (`@IPB-08-AT-04`, unregistered claim).
- The word list is data (`packages/cms/claims/words.json`), so a product can add to it but not remove from it.
- When OH14 exposes `GET /v1/claims-gate/check`, a CLAIMS port adapter calls it; until then the local register decides (#46).

### 5.5 Sanitiser, slugs, redirects, SEO and the public API

- Rich text is stored as portable-text JSON, never as HTML. The one allow-list sanitiser (`@infrabyx/cms/sanitise`) converts imported HTML (parse5) to portable text, strips scripts, event handlers, `javascript:` and `data:` URLs (except media-library images), iframes outside `embed`, and inline styles, and returns a report. It runs at save and again at render (`@IPB-04-AT-20`). Rendering escapes text; there is no `dangerouslySetInnerHTML` path in `ui` (lint).
- Slugs: lower-kebab ASCII with the reserved list of IPB-04-20 (`IPB-CMS-002`). A slug change creates an automatic 301.
- Redirects: 301, 302 and 410; loop and chain detection at save (`IPB-CMS-009`); a CSV dry run that commits nothing until confirmed (`@IPB-04-AT-08`).
- SEO fields on every routable item, with warnings over 60/160 characters. JSON-LD builders for Organization (legal name, logo, `sameAs`, CIN in `identifier`, support and grievance contact points), WebPage, Article, FAQPage, BreadcrumbList, JobPosting and VideoObject (`@IPB-04-AT-07`).
- Generated files: `sitemap.xml` (index and per type, lastmod), `robots.txt` per pack, `llms.txt` and `llms-full.txt`, `/legal/index.json` (IPB-05-09), and RSS and Atom for blog when enabled.
- Preview: a random 32-byte token, stored as its SHA-256, expiring after `cms.preview.ttl_hours` (24), revocable. The page carries the "Preview — not published" banner, `noindex`, `X-Robots-Tag: noindex` and `Cache-Control: no-store`; after expiry it returns 410 `IPB-CMS-006` (`@IPB-04-AT-05`).
- Public read API `/api/public/v1/...`: read-only, published only, ETag, rate-limited. Any write method returns 405 and changes nothing (`@IPB-04-AT-14`).

### 5.6 Footer (IPB-04 §04.3.8, O-4)

- `cms.footer` per pack, with an `office` record per office: label, lines, city, state, PIN, country, phone, hours and the `is_registered_office` flag.
- The entity line ("{legal name} · CIN {cin} · GSTIN {gstin}") and the officers line ("Grievance Officer: {name}, {email}" · "Data Protection Officer: {name}, {email}") are text nodes built from the published brand pack's `legal_entity` and the policy-set parameters. No component holds a literal entity name; a lint test fails on one.
- `infrabyx-cms validate-footer` fails CI on any empty mandatory field for any pack, naming the pack and the field (`@IPB-04-AT-73`):
  - brand block and group link;
  - Product (at least 3 items), Resources, Company and Legal columns;
  - registered office, phone and email;
  - entity line and officers line;
  - at least one text-labelled social link;
  - utilities: status, language switch, "Cookie settings", accessibility statement, sitemap, "Report a problem";
  - copyright line with the current year.
- Delhi, Noida and Jaipur offices (IPB-04-72) are seeded as records whose addresses come from configuration; they can be edited but not deleted without maker-checker.

### 5.7 Policies (IPB-05)

- Templates are versioned Markdown at `packages/cms/policies/<key>/<template_version>.md` with `{{name}}`, `{{#if}}` and `[Option A | Option B]`.
- The platform ships the 18 template skeletons (titles, numbered clause headings, parameters and `[COUNSEL]` markers) taken from IPB-05. The full legal wording of each instance is entered by `PLT_LEGAL_REVIEWER` in Studio › Policies, because counsel review is mandatory before publication (IPB-05 §3g).
- The resolver uses the §05.3.2 parameter block plus the per-template extras.
  - `{{selling_entity_short}}` and `{{escalation_officer}}` are policy-set parameters (PL5-D-01 item 6).
  - The template 18 runtime variables form a separate runtime set (PR-028).
  - An unresolved parameter blocks publish (`IPB-POL-001`, `@IPB-05-AT-03`).
- Other publish errors:
  - a mandatory section missing → `IPB-POL-002`;
  - banned wording → `IPB-POL-003` (`@IPB-05-AT-09`);
  - a stale citation → `IPB-POL-004`, through a LAW_REGISTER hook that is `none` until LDC provides it;
  - MAJOR changes to templates 2 and 3 inside the 30-day notice → `IPB-POL-005` (`@IPB-05-AT-05`);
  - DPO approval missing → `IPB-POL-006` (`@IPB-05-AT-08`);
  - hi-IN missing or machine-translated → `IPB-POL-007` (`@IPB-05-AT-06`), skipped while `pol.full_hindi=false` and Hindi is deferred (OWN-11); the summary rule applies when Hindi starts;
  - an in-place edit → `IPB-POL-008`;
  - an incomplete policy set for a pack → `IPB-POL-009` (`@IPB-05-AT-01`).
- Versions: `version_label` `MAJOR.MINOR`, effective date, last reviewed, "what changed", and immutable prior versions at `/legal/{slug}/v/{version}` with a superseded banner (`@IPB-05-AT-04`, without the PDF hash until DOCGEN).
- Review cadence: Privacy Notice, Cookie Policy, Retention Schedule and AI Use Policy every 6 months, others every 12. Overdue items surface in the Studio queue and emit `PolicyReviewDue` (`@IPB-05-AT-07`).
- Clause headings keep stable anchors (`#clause-7`) across versions (IPB-05-11).

### 5.8 Resources, forms and pricing

- **Resources:** artefact types and metadata of IPB-04-58, with versions at a stable URL plus `?v=` and `cite_as` (`@IPB-04-AT-60`). Gating:
  - `public`;
  - `email_gate` through the CRM port, with the consent text and a lead reference;
  - `login` and `plan`, through hooks;
  - gated files are served by STORAGE presign with a 10-minute expiry (`@IPB-04-AT-61`).
- Download tracking stores the resource, version, gating and the CRM lead reference returned by the port, not a hash of the lead (#47).
- **Forms:** the definition holds fields, the consent text reference and the destination (`crm_lead`, `hr_application`, `support_ticket`, `dpa_request`, `grievance`).
  - A submission needs consent for every personal field (`IPB-WEB-002`) and goes server-side straight to the port.
  - `cms.form_submission` keeps only the id, destination reference, consent receipt and state; field values are never stored, including on failure (the user sees a retry message and nothing is kept; #47) (`@IPB-04-AT-47`).
  - Anti-spam uses a honeypot and a per-IP rate limit (`IPB-WEB-003`) and never a CAPTCHA puzzle (IPB-06-40).
- **Pricing:** `pricing_table` reads plans, features, prices, currencies, trials and coupons from `BILLING_PORT.getCatalogue(product, brand_pack_id)` at render, with a 300-second cache. No editor field accepts a price (`@IPB-04-AT-30`).
  - The GST display rule applies (`exclusive_labelled` by default; `@IPB-04-AT-31` at component level).
  - The dark-pattern lint gives `IPB-CMS-015` for false urgency, stock claims, drip fees and pre-ticked add-ons (`@IPB-04-AT-32`).
  - Fixture catalogues only, with no real prices in this public repository. The group site has no pricing page (`web.pricing.public = false` for the group pack).

---

## 6. `@infrabyx/consent` (IPB-04 §04.3.9, IPB-05 templates 5 and 18, Ecosystem #29, §6.14, §6.39)

### 6.1 Ledger and texts

- Schema `consent`, migration `consent/0001_init.sql`. Every table is append-only: update and delete are refused by trigger for every role.
  - `consent.text` holds the versioned strings of IPB-05 template 18 and the banner text per region, with key, version, locale, body and effective date (spec table `cms.consent_text`).
  - `consent.record` holds one row per choice:
    - receipt id (`cns_`), anonymous id (`ibx_cid`) or principal reference, brand pack;
    - purposes and categories, text key and version, policy version, region;
    - method (`CMP_BANNER`, `FORM`, `PREFERENCE_CENTRE`), GPC flag, user-agent class, timestamp.
  - `consent.acceptance` holds acceptances of Terms-class documents and acknowledgements of Privacy-class ones (IPB-05-05): key, version and the exact text hash shown.
- `CONSENT` port: `recordConsent`, `getConsent(cid)`, `withdraw`. The `pg_local` adapter is built and proven; the `oh_ledger` HTTP adapter runs against a stub and stays unproven until OH exposes the ledger (Ecosystem §6.14).
- A change always appends a new row and never overwrites one (`@IPB-04-AT-82`, `@IPB-05-AT-10`: the stored text never changes when a later version is published).
- Retention: "life of the consent plus 3 years" (IPB-05 template 9) is a deletion rule, so PL5 deletes nothing and asks (#48).

### 6.2 CMP (O-2)

- `CookieBanner` is server-rendered as a non-blocking bottom sheet. **Accept all**, **Reject all** and **Manage** are rendered by one button component with the same size, weight, colour treatment and tab order. A unit test compares their computed classes and the e2e test their bounding boxes (`@IPB-04-AT-80`).
- Closing the banner or pressing Escape records Reject for every non-necessary category. Text is at least 16 px, the banner is announced by screen readers, never auto-dismisses and respects reduced motion (IPB-04-83).
- `PreferenceCentre` lists the four categories: necessary (always on), functional, analytics and marketing. The plain descriptions and the vendor table come from one registry, which also generates the Cookie Policy table (IPB-04-76, IPB-05 template 5).
- "Cookie settings" in the footer and in the Cookie Policy reopens it with the current choices, and withdrawing takes the same number of clicks as consenting.
- GPC: `Sec-GPC: 1` sets analytics and marketing to rejected and the banner says a privacy signal was honoured (`web.consent.honour_gpc` locked on; `@IPB-04-AT-81`).
- Region wording: DPDP by default; GDPR (Reject all on the first layer) and CCPA ("Do Not Sell or Share") when `web.consent.geo_detect` and the edge country say so (`@IPB-04-AT-84`).
- Re-prompt when the banner text version changes (`web.consent.reprompt_on_change`).
- The `ibx_cid` cookie is first-party, `HttpOnly` off (the controller reads it), `Secure`, `SameSite=Lax`, 365 days (`web.consent.cookie_ttl_days`). It never varies the HTML cache.

### 6.3 Script gating (IPB-04-79, 82, 87; Ecosystem §13)

- `ConsentGate` renders a non-necessary script or iframe only as `type="text/plain" data-consent="<category>"` in the server HTML. The first-party controller activates it after consent and the CSP is updated in the same response cycle. No active third-party tag is ever in the SSR output.
- `TAG_MANAGER` and `ANALYTICS` ports ship the `none` adapter only (OWN-09). A self-hosted PostHog adapter is a later session, after the owner approves it and a host exists.
- `sensitiveRoutes` is the locked list (authenticated routes, contact, careers apply, grievance, DPA request, resource email gate) plus product additions. Products may add routes but not remove them. A tag on a sensitive route is blocked with `IPB-WEB-005`.
- The e2e test loads every route with a fresh profile, waits 10 seconds with interaction, and asserts zero requests outside the site's own origin (`@IPB-04-AT-83` with the `none` adapters).

---

## 7. `@infrabyx/feedback` and `@infrabyx/trust`

### 7.1 Feedback (IPB-04 §04.3.11, IPB-06 §06.3.9, Ecosystem §6.40)

- Schema `feedback`, migration `feedback/0001_init.sql`: `feedback.item` (`fbk_`).
  - Fields: type (bug, idea, praise, nps, accessibility, help_content), category (Ecosystem `feedback_category`), route pattern, app version, pack, locale, viewport class, browser family, trace id, consent id or user and tenant, severity, status, OH reference, `contact_ok`, and the SLA due dates for accessibility items.
  - The summary is PII-scanned with the `ai` scrubber's detectors; anything that looks like Aadhaar, PAN, a card or account number, or a mobile number is rejected.
- Minimisation: `page_html`, a full URL with a query string, form values or a screenshot field → `IPB-FB-001`, nothing stored (`@IPB-04-AT-91`). Rate limit → `IPB-FB-002`.
- `FeedbackWidget`: a footer trigger, "Report a problem", and the floating button (`fb.widget.floating`). It is a dialog with labels and errors, and a no-JavaScript `/feedback` form posting to the same handler. It sets no cookie (`@IPB-04-AT-90` presence).
- NPS: never in the first session and at most once every `fb.nps.interval_days` (90).
- `SUPPORT` and `BACKLOG` ports: a fixture adapter (built) and an OH HTTP adapter against a stub (unproven). Items get a reference and a status (received, triaged, planned, shipped, declined). `FeedbackStatusChanged` from OH updates the status (`@IPB-04-AT-92` against the fixture).
- Accessibility reports: the "Report an accessibility problem" form on `/accessibility` (no CAPTCHA puzzle) creates an `accessibility` item with SLA due dates from `a11y.feedback.*` (24-hour acknowledgement, 5-day workaround, 30-day fix for P1 or 90 days otherwise). `SlaSweep.tick()` emits `AccessibilityIssueSlaBreached` (`@IPB-06-AT-20`, platform side; PR-029 for the 24-hour vs 2-working-day conflict).

### 7.2 Trust (IPB-08, Ecosystem §6.34)

- Schema `trust`, migration `trust/0001_init.sql`. The mirror tables are written only by the mirror consumer (read-only to the app role), so no product code can edit a `vad_` (IPB-08-01, `@IPB-08-AT-01`).
  - The mirror: `trust.mirror_type`, `trust.mirror_document` and `trust.mirror_publication`, holding metadata, `sha256`, the storage reference, visibility, targets, the mirror state and `synced_at`.
  - Tenant rows: `trust.acknowledgement` (`vada_`), `trust.nda_acceptance`, `trust.request` (`vadr_`) and `trust.subscription`, all with `tenant_id` under RLS.
- Mirror consumer: it handles `VendorAssuranceDocumentPublished` and `StateChanged` with the Ecosystem enums and runs the state machine ANNOUNCED → FETCHED → VERIFIED → VISIBLE, plus STALE, SUPERSEDED and HIDDEN.
  - A digest mismatch keeps the previous verified version and raises `IPB-TRUST-009` and `mirror-digest-mismatch`.
  - WITHDRAWN hides the document at once, well inside the 60-second rule.
  - Replaying the events rebuilds the mirror identically (IPB-08-27).
  - IPB-08's gating, cadence and state names map to the Ecosystem codes (PL5-D-01 item 7; PR-031).
- `TRUST` port: `listDocuments(updated_since)` and `fileUrl(vad_id)`, with a fixture adapter (built) and an OH adapter against a stub (unproven). The daily reconciliation compares the mirror digest with OH's (IPB-08-29).
- Trust Centre data (`trustCentre(packId)`): only PUBLISHED, PUBLIC items, certifications actually held, the VAPT summary without the report, the sub-processor list, the status link, the DPA request route, the VDP, policy summaries, the accessibility statement and the contacts (IPB-08-23).
  - "In progress" and "planned" appear with a target quarter and never a badge (`@IPB-08-AT-17`).
  - An expired certificate renders its fallback wording (`@IPB-08-AT-04`).
  - A mirror older than 7 days shows "as of" (Ecosystem STALE; `trust.mirror.stale_minutes` 60 drives the label inside the product UI).
- In PL5 the tenant list shows `login`, `nda` and `per_tenant` documents, and NDA acceptance is recorded as a consent-type event (`@IPB-08-AT-06`). Gated downloads answer `IPB-TRUST-012` ("we could not prepare your watermarked copy") until a DOCGEN watermark adapter exists, so no unwatermarked gated original is ever served (#44).
- `securityTxt(pack)` generates `/.well-known/security.txt` (RFC 9116: Contact, Expires within one year, Policy, Preferred-Languages en, hi, Canonical).
- With no live OH, the group site's `/trust` renders from the fixture mirror: a sub-processor list and the accessibility statement, and no certifications, because none are held (O-5).

---

## 8. Contracts, config and testing additions

**`contracts`** (minor):

- Ports: `CONSENT`, `CRM` (`upsertLead`), `HR` (`createApplication`), `SUPPORT`, `BACKLOG`, `TRUST`, `BILLING` (`getCatalogue`, read only), `TAG_MANAGER`, `ANALYTICS`, `EGRESS`, `CLAIMS` (claims gate), `LAW_REGISTER` (stale citations).
- Error codes:
  - `IPB-CMS-001…041`, `IPB-BRD-001…007`, `IPB-WEB-001…006`, `IPB-FB-001…002`;
  - `IPB-POL-001…011`, `IPB-A11Y-001…010`;
  - `IPB-HLP-001…006`, `IPB-TUT-001…003`, `IPB-TRUST-001…015`, `IPB-RES-001…011`;
  - the PL5 subset of `IPB-UX-001…010`.
- New ids: `brd_`, `brv_`, `pg_`, `rev_`, `clm_`, `cns_`, `fbk_`, `vada_`, `vadr_`, `lgl_`, `res_` and the other content prefixes.
- Roles: `PLT_CONTENT_EDITOR`, `PLT_LEGAL_REVIEWER`, `PLT_DPO`, `PLT_GRIEVANCE_OFFICER`, `PLT_ACCESSIBILITY_LEAD` (if not already present).
- Payload schemas for the internal events and the Ecosystem v1.2 events of §3.6.
- Service reader roles: `SVC_CMS_SCHEDULER` (due publish and unpublish), `SVC_TRUST_MIRROR` (mirror reconciliation), `SVC_FEEDBACK_SLA` (accessibility SLA timers).

**`config`** (minor): the IPB-04 §04.5 keys (`web.*`, `cms.*`, `brand.*`, the `mkt.*` keys that exist at launch, `fb.*`); the IPB-05 `pol.*` keys; the IPB-06 `a11y.*` keys; the IPB-07 `ux.*`, `hlp.*` and `tut.*` keys PL5 reads; the IPB-08 `trust.*` keys the mirror and Trust Centre read; the IPB-13 keys for the off-by-default blocks; and `eco.v12.emit_enabled` and `cms.media.reencode_enabled` (both false). The owner's launch values are seeded through the group pack, not changed in the registry:

- `web.blog.enabled = false` and `web.investors.enabled = false` for the group pack (OWN-11);
- `mkt.tag_manager.adapter = none` and `mkt.analytics.adapter = none` (OWN-09);
- `web.pricing.public = false` for the group pack.

The `a11y.*`, `fb.*` and IPB-06 flags (`flg_i18n_locales_extended`, `flg_isl_booking`, `flg_live_captions`, `flg_a11y_sonification`, `flg_pdf_ua`, `flg_a11y_pref_sync`) and the IPB-07 and IPB-08 flags are registered off.

**`testing`** (minor): fakes and fixture adapters for every new port, the fixture vendor-assurance feed, a fixture catalogue with no real prices, and the gallery fixtures.

**`seed`** (patch): `publicSiteSeedModule` (§9.5).

---

## 9. `apps/public` — the Infrabyx group site

### 9.1 Stack

- Next.js 16.4.2 with the App Router and React 19.3.1, server components only except the three controllers of §3.5.
- Content is read in-process from `@infrabyx/cms` through the public reader, the pack is resolved by host (`brand.resolveHost`), and the consent state is read from the cookie.
- `proxy.ts` (Next 16 middleware) sets a per-request CSP nonce: `script-src 'nonce-…' 'strict-dynamic'`, `object-src 'none'`, `base-uri 'none'`, `frame-ancestors 'none'`, `img-src 'self' data:`, `connect-src 'self'`, no `unsafe-inline`.
- Security headers: `X-Content-Type-Options`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` denying camera, microphone and geolocation, and `Strict-Transport-Security` (preload is a production configuration step for the owner).
- Fonts are self-hosted WOFF2 from the package, with no font CDN (IPB-04-25, `@IPB-04-AT-24`), using OFL-licensed families only. _As built (PL5-D-13): the `ui` system font stack, with no font files, until the brand typography is chosen._

### 9.2 Pages at launch (O-1)

| Route                                                     | Template                              | Notes                                                                                                                                                                               |
| --------------------------------------------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`                                                       | home                                  | Hero, what the group does, the group companies teaser, trust teaser, careers teaser, contact CTA. No stats, logo wall or testimonials (O-5)                                         |
| `/about`                                                  | page                                  | Dated timeline, mission, boundary statement, "Part of the Infrabyx Group", contact                                                                                                  |
| `/group-companies` and `/group-companies/{slug}`          | page (new `group_companies` template) | The group's products and divisions as listed by the owner, each with a plain description, its own site link and its legal entity; no client names                                   |
| `/careers` and `/careers/{slug}`                          | careers                               | Open roles from `job` items, the apply form through the HR port with consent (`consent.careers`), `JobPosting` JSON-LD with `validThrough`; closed roles 410                        |
| `/trust`                                                  | trust                                 | From the trust mirror (§7.2)                                                                                                                                                        |
| `/contact`                                                | contact                               | Form through the CRM port with consent; offices with addresses from configuration; grievance officer and DPO named from configuration                                               |
| `/legal` and `/legal/{slug}`, `/legal/{slug}/v/{version}` | legal                                 | The policy set: every template that IPB-05-01 makes mandatory before go-live (1, 2, 5, 6, 7, 8, 9, 10, 11, 18); 3 and 4 only where something is sold online (not on the group site) |

Always present as well: `/accessibility` (the generated statement and the report form), `/grievance`, `/sitemap` (HTML), `/glossary`, `/feedback` (no-JavaScript fallback), `/security`, `/.well-known/security.txt`, `/sitemap.xml`, `/robots.txt`, `/llms.txt`, `/legal/index.json`, the favicon set and a custom 404 with search. Blog and Investors exist in the seed as hidden items (`@IPB-04-AT-70`, `@IPB-04-AT-40`: their routes return 404 and the footer omits them).

Header: logo, at most 7 nav items (Home is the logo; About, Group companies, Careers, Trust, Contact, Policies), "Cookie settings" in the footer, and a language switch shown with Hindi marked unavailable until Hindi starts (`@IPB-04-AT-11` behaviour, OWN-11).

### 9.3 Configuration (O-4, O-6)

- The group pack's legal entity (name, CIN, GSTIN, registered office), its officers (grievance officer and DPO name, email, address) and its office addresses are read by the seed from `SEED_GROUP_*` variables, registered in the seed env schema and documented in `.env.example`. In dev and test they default to clearly fictional, reserved values (`Example Group Private Limited`, an `example.org` mailbox, a placeholder CIN that fails the CIN checksum on purpose) and the footer shows them.
- The seed refuses to run in prod, dr and pre-prod (`SEED_REFUSED_ENVS`, PL1-D-06). There the real values are entered once in Studio › Footer & Contact and Brand, under maker-checker with `PLT_LEGAL_REVIEWER`.
- No component or page contains an entity name, CIN, address or officer name; `validate-footer` and a source lint enforce it.

### 9.4 Consent on the site (O-2)

The banner shows on first visit. With no consent, the site loads nothing from any other origin: no analytics, no tag manager, no fonts, no maps (the offices use a click-to-load static map link) and no video.

The e2e gate asserts zero third-party requests on every route, in a fresh profile and after Reject, Accept and Manage. With the `none` adapters, Accept loads nothing either.

### 9.5 Seed content (O-5)

`publicSiteSeedModule` creates:

- the group pack;
- the pages of §9.2;
- the footer, the Delhi, Noida and Jaipur offices (addresses from configuration) and the policy set, as template skeletons with `[COUNSEL]` markers (placeholders, below);
- a sub-processor fixture and the glossary entries the pages use.

It is deterministic and refused in prod, dr and pre-prod.

Every seeded text passes the claims lint of §5.4. A seed test asserts:

- no stats, logo_wall, testimonial or case_study blocks;
- no client or customer names;
- none of the owner's banned phrases.

Policy instances are seeded as **placeholders**: published by the seed actor with `seeded_placeholder = true`, so the pack's policy-set precondition holds in the environments where seeds run (dev, test, demo, staging). Every placeholder renders with a "Placeholder — not legal advice, not in force" banner and `noindex`. In prod, dr and pre-prod no seed runs, a placeholder can never exist, and every policy is approved in Studio after counsel review (IPB-05-12).

---

### 9.6 Studio screens and `apps/console` (#41, PL5-D-05)

The owner decided that every product needs the same super-admin Studio, so it is built once here:

- `@infrabyx/ui/studio`: server-rendered screen components (list, editor and review screens) for the IPB-04-100 Studio sections the PL5 packages cover — Brand, Pricing (catalogue view only; prices come from `BILLING_PORT`), Pages and sections, Menus, Footer and contact, Policies, Redirects, Media, Claims Register, Resources, Forms, Consent texts, Feedback queue, Trust documents (read-only mirror), Preview links and the approvals queue. Each screen takes a service object (the package's Studio service) and the request's `KernelContext`; it never reads a table. Role checks, maker-checker and lint stay in the services, so a screen cannot loosen them.
- Screens use only the `ui` components and tokens, meet the same accessibility gates as public pages (axe, HTML_CodeSniffer, reflow, keyboard), and work without JavaScript (forms post to server actions).
- `apps/console`: a reference Next.js 16 app that mounts every Studio screen under `/studio/...` behind the product's AUTHZ adapter (a fixture adapter in the reference app), with `noindex` and the same CSP. Products and OH mount the screens in their own consoles instead of building them.

## 10. Locked-list items and how PL5 treats them

| Item                                                                                                                                                                                        | Treatment in PL5                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Owner question      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| Deletion and retention: consent records (life + 3 years), feedback items, trust acknowledgements (10 years), form payloads (72 h), soft delete (30-day restore), import quarantine (7 days) | **Approved by the owner (#48, PL5-D-05):** a ledgered sweep per table under its own `SVC_` reader — soft-deleted CMS content after 90 days (session 4), consent records at consent end + 3 years (session 5), feedback items 3 years after closure and trust acknowledgements after 10 years (session 6). Form payloads are never stored. Imports are deferred **#57 (PL5-D-11):** a form consent for a marketing lead ends 24 months after the last interaction and the consent sweep then applies, unless the person has an active relationship or a legal hold applies (`consent/0002`). | #48, #57 (answered) |
| Cryptography: preview tokens, gated URLs, hashed lead ids, evidence-pack signing, webhook signatures                                                                                        | Preview tokens follow the approved random, server-side, revocable pattern (PL3-D-06) with SHA-256 storage; gated URLs use STORAGE presign; no hashed lead id; signing and webhooks deferred                                                                                                                                                                                                                                                                                                                                                                                                 | #44, #47            |
| Maker-checker policy                                                                                                                                                                        | Implemented exactly as IPB-04 §04.4.3, IPB-05-12 and IPB-08-12 state; nothing loosened                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | —                   |
| Payments and prices                                                                                                                                                                         | Prices only from `BILLING_PORT` fixtures; no price in the repository; no checkout                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | —                   |
| Production configuration                                                                                                                                                                    | HSTS preload, the edge host allow-list, IndexNow pings, the `a11y` required check (branch protection) and DNS are owner steps                                                                                                                                                                                                                                                                                                                                                                                                                                                               | #49                 |
| External accounts and costs                                                                                                                                                                 | None: no PostHog host, no tag manager, no plagiarism or antivirus vendor, no IS 17802 purchase, no AT-user testers                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | #50                 |

---

## 11. CI gates

A new `a11y` job runs on every PR that touches `packages/ui`, `packages/a11y`, `packages/cms`, `packages/brand`, `packages/consent`, `packages/feedback`, `packages/trust` or `apps/public`, and on `main`. _As built (PL5-D-13): on every PR with code changes, so the required check always reports._ It uses the PostgreSQL service like `integration` and runs these steps:

1. `infrabyx-migrate`, then the public-site seed in `test`.
2. Build and start `apps/public`.
3. For every registered route in light and dark themes:
   - axe with `wcag2a`, `wcag2aa` and `wcag22aa`, zero violations;
   - HTML_CodeSniffer WCAG2AA, zero errors;
   - reflow at 320 px and text scale at 200 %;
   - the skip link first in the DOM;
   - zero third-party requests;
   - full content with JavaScript disabled (`@IPB-04-AT-12`).
4. Lighthouse on every public page, with an accessibility score of at least 95 and the performance budgets, once a Lighthouse version resolves under the trust policy without a `trustPolicyExclude` (#51; re-checked each session; until then `@IPB-06-AT-02` runs on fixtures).
5. The `/__gallery` route, scanned the same way, covers every `ui` component in place of Storybook (#45).
6. `overlay-scan` over the build output.
7. `hlp-lint` over the registries and the site.
8. `journeys-lint` over `apps/public/journeys/GRP.yaml`, against the routes the seeded site serves (`scripts/gate-inputs.ts`).
9. `validate-footer` over every published pack (`scripts/gate-inputs.ts`).

The job is named `a11y`; the PR that adds it also adds `a11y` to the `main` ruleset's required checks in `infra/policy/github/rulesets.json`, and the owner applies the ruleset after it merges (#49; IPB-06-54).

`verify` adds `hlp-lint` and `journeys-lint` for the packages (fast, no browser), and `ipb:check` gains the hosted-CMS, overlay and font-CDN dependency rule.

---

## 12. Data model summary (migrations)

| Migration                           | Tables                                                                                                                 | Notes                                                                                                                  |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `brand/0001_init.sql`               | `pack`, `pack_revision`, `host`                                                                                        | Revisions immutable; host unique; platform-scoped under RLS                                                            |
| `cms/0001_init.sql`                 | `content_item`, `revision`, `approval`, `redirect`, `media`, `claim`, `preview_token`, `nav_item`, `office`            | Revisions immutable by trigger; `svc_cms_scheduler` reader                                                             |
| `cms/0002_policies.sql`             | `policy_set`, `policy_instance`                                                                                        | Published instances immutable (`IPB-POL-008`)                                                                          |
| `cms/0003_resources_forms.sql`      | `resource_version`, `form`, `form_submission`                                                                          | No field values in `form_submission`                                                                                   |
| `cms/0004_renditions_notices.sql`   | `media.renditions`, `policy_notice`                                                                                    | Renditions per upload (#53); append-only notice records (#55)                                                          |
| `consent/0001_init.sql`             | `text`, `record`, `acceptance`                                                                                         | Append-only for every role                                                                                             |
| `consent/0002_form_consent_end.sql` | `subject_status`                                                                                                       | Last interaction, active relationship, legal hold; the restrictive delete policy gains the form-lead end of life (#57) |
| `feedback/0001_init.sql`            | `item`                                                                                                                 | Tenant rows under RLS; public items under the platform tenant; `svc_feedback_sla` reader                               |
| `trust/0001_init.sql`               | `mirror_type`, `mirror_document`, `mirror_publication`, `acknowledgement`, `nda_acceptance`, `request`, `subscription` | Mirror written only by the consumer; tenant rows under RLS; `svc_trust_mirror` reader                                  |

All expand-only, with data-class comments on every column, checksums recorded and `infrabyx-migrate` order: … → `vidhi` → `brand` → `cms` → `consent` → `feedback` → `trust`.

---

## 13. Assumptions and owner questions

PL5-D-01 records the defaults below as `[ASSUMED – owner review]`; each open point is in `docs/OWNER-QUESTIONS.md`.

1. **Package layout:** tokens in `@infrabyx/ui/tokens`, formatters in `@infrabyx/ui/i18n`, tutorials in `hlp`, the CMP and the marketing launch parts in `consent` (IPB-04, -06, -07 and -13 name `tokens`, `i18n`, `tut`, `marketing` and `consent-ui`; IPB-14 §14.2 does not). PR-025.
2. **Schemas:** `brand_pack`, `consent_text` and `feedback_item` live in their owning packages' schemas, not `cms` (module = schema). PR-026.
3. **Token names:** the Ecosystem brand-pack token shape maps to the IPB-07 semantic tokens in `brand`; the heading font is product-internal. PR-027.
4. **IPB-05 parameters:** `selling_entity_short` and `escalation_officer` are policy-set parameters; template 18 runtime variables are a separate allowed set. PR-028.
5. **IPB-06 vs IPB-05:** the accessibility-feedback acknowledgement uses 24 hours (IPB-06-62, the stricter); the statement shows "within 24 hours" and the reviewer role stays `PLT_LEGAL_REVIEWER` (held by the Company Secretary, OWN-12). PR-029.
6. **IPB-08 vs Ecosystem §6.34:** the wire uses the Ecosystem names (visibility, cadence, categories, states); the IPB-08 type keys map to `vad_category`; withdrawn documents are hidden at once (the 60-second rule), and acknowledgers' archival copies wait for the OH archive endpoint. PR-031.
7. **Error-code reuse:** `IPB-CMS-003` keeps both meanings with a `reason` field; `IPB-TUT-001` keeps IPB-07's meaning and IPB-13's sandbox failure is `IPB-TUT-001` with `reason: sandbox_policy`. PR-030.
8. **Ecosystem error areas and preference keys:** `IPB-A11Y` and the consent area are missing from Ecosystem §3.12; `UserPreferencesSynced` uses `ui.*`/`notif.*` where IPB-07 uses `ux.*`/`ntf.*` — PL5 maps at the emitter, which is off. PR-032.

| #   | Question                                                                                                                                                                                                                                                                                                                   | Default taken                                                                                         |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| 41  | Studio screens: PL5 ships the Studio service layer (writes, roles, maker-checker, lint) and the `ui` building blocks, not the 17-section `apps/console` screens (IPB-04-100). Build the screens in PL5 as a reference console, or in OH (which hosts the group CMS), or in each product's console?                         | Service layer and components only in PL5; screens in OH's console, which edits the group site         |
| 42  | Blog bulk import, ZIP safety, user posts, comments, takedown, vlog, case studies, testimonials and landing pages are built later, in the phase of the first product that turns them on (blog is OFF for the group site). Keep this deferral?                                                                               | Deferred, flags off; the content types refuse publish until their gates exist                         |
| 43  | Media re-encoding (AVIF/WebP) and PNG favicons need `sharp` (Apache-2.0, native) or `@resvg/resvg-js` (MPL-2.0, native). Approve one, or keep uploads served as uploaded (alt text, EXIF strip and SVG sanitising still apply)?                                                                                            | Served as uploaded; PNG favicons from an uploaded PNG master; `cms.media.reencode_enabled = false`    |
| 44  | Gated vendor-assurance downloads need a DOCGEN watermark adapter; evidence packs need ed25519 signing (a new cryptography item, key custody in KMS); auditor grants need a separate identity realm. Defer all three until a regulated tenant needs them?                                                                   | Deferred: gated downloads answer `IPB-TRUST-012`; public documents only; `flg_trust_pack_signing` off |
| 45  | Pa11y and Pa11y CI are LGPL-3.0 (not on the licence list), and Storybook adds a large toolchain. Accept HTML_CodeSniffer (Pa11y's own engine, BSD-3) run directly by Playwright for the Pa11y gate, and a `/__gallery` route scanned by axe for the Storybook gate?                                                        | Yes to both; recorded as an IPB-06-54 tool substitution with the same zero-error thresholds           |
| 46  | Ecosystem v1.2 events (`BrandPackPublished`, `PolicyEffective`, `MarketingConsentUpdated`, `LeadCaptured`, `FeedbackSubmitted` and others) may not be sent live until every product owner records v1.2 approval (§6.1). Keep emitters off until you confirm the approval, and the claims gate local until OH14 exposes it? | Emitters off (`eco.v12.emit_enabled = false`); local Claims Register decides                          |
| 47  | Forms and downloads: never store form field values (a failed hand-off asks the user to retry), and record the CRM lead reference instead of a hashed lead id (the hash and its key would be a new cryptography use). Keep these?                                                                                           | Yes: no payload storage, no hashed lead id                                                            |
| 48  | Retention: consent records (life + 3 years), feedback items, trust acknowledgements (10 years) and any soft-deleted content are kept; no purge job is built in PL5. Approve purge jobs with these periods now, or keep everything until a later decision?                                                                  | Keep everything; no purge job                                                                         |
| 49  | Owner settings for production: make the new `a11y` check required on `main`; HSTS preload for the group domain; turn on IndexNow pings (an external call to search engines) once the site is live?                                                                                                                         | Not changed; IndexNow adapter `none`                                                                  |
| 50  | Costs and accounts deferred: self-hosted PostHog host (OWN-09), IS 17802 standard text (for `mapping.json`), AT-user testers, ISL interpreters, plagiarism and antivirus vendors. Confirm none is needed for the group-site launch?                                                                                        | None at launch; mapping carries `[VERIFY]` for IS 17802; manual AT runs by the Accessibility Lead     |

---

## 14. Sessions

| Session | Content                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1       | Spike notes `docs/phases/PL5-spike.md` (Next 16 nonce CSP, React 19 server rendering, axe, HTML_CodeSniffer and Lighthouse on the pre-installed Chromium); `contracts` ports, errors, ids, roles, event payloads; `config` keys and flags; `testing` fakes and fixtures                                                                                                                                                                 |
| 2       | `ui` tokens, CSS, components, `ui/i18n`; `a11y` registry, lint, statement generator, hooks, Playwright helpers, overlay scan                                                                                                                                                                                                                                                                                                            |
| 3       | `hlp` registry, lint and tours; `brand` schema, Brand Studio service, contrast guard, SVG sanitiser, favicon set, host map                                                                                                                                                                                                                                                                                                              |
| 4       | `cms` core: content and revisions, state machine and approvals, Claims Register and lint, sanitiser, slugs and redirects, SEO and generated files, preview, scheduler, public API, footer validator, the 90-day soft-delete sweep (#48)                                                                                                                                                                                                 |
| 5       | `cms` policies, resources, forms and pricing; `consent` ledger, texts, CMP, gating, ports                                                                                                                                                                                                                                                                                                                                               |
| 6       | `feedback` and `trust`                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 7       | `apps/public`, the public-site seed, the `a11y` CI job (and its required check in the ruleset file) and the end-to-end acceptance tests. **Built (PL5-D-13)**                                                                                                                                                                                                                                                                           |
| 8       | Studio screens (#41, §9.6): `@infrabyx/ui/studio` screen components for Brand, Pricing, CMS pages and sections, menus, footer and contact, policies, redirects, media, claims, consent texts, feedback queue and trust documents, on the service layers. Built in two parts (PL5-D-14): 8a the frame, Approvals, Brand, Pages and sections, Menus, Footer and contact, Redirects, Media, Claims Register and Preview links; 8b the rest |
| 9       | Reference `apps/console` (#41, §9.6): mounts the Studio screens behind the AUTHZ check, with the gallery and a11y scans of every Studio route                                                                                                                                                                                                                                                                                           |
| 10      | Gate: report `docs/phases/PL5-gate.md`, threat model, at-report, changesets (first releases of the eight packages, minors elsewhere), version PR and release                                                                                                                                                                                                                                                                            |

---

## 15. Acceptance tests and exit gate

**Tagged and passing at the gate** (platform side; product-only rows excluded):

- IPB-04:
  - CMS core: AT-01…14 (AT-04 with IndexNow as a logged `none` push);
  - XSS, SVG, favicon, contrast, fonts, terminology, email identity, host and rollback: AT-20…28;
  - pricing on fixtures: AT-30…32;
  - blog toggle only: AT-40;
  - forms: AT-47;
  - resources: AT-60, 61 (AT-62 when the PDF probe exists);
  - pages, Trust Centre, footer and shell: AT-70, 72, 73, 74;
  - CMP and gating with `none` adapters: AT-80…86;
  - feedback: AT-90…92;
  - unprivileged publish, embed SSRF and edit during countdown: AT-93, 94, 101.
- IPB-05: AT-01, 03, 04 (without PDF hashes), 05 (notice-period and re-consent flag; the read-only mode is product-side), 06 (when Hindi starts; skipped with a reason meanwhile), 07, 08, 09, 10.
- IPB-06: AT-01, 02, 03 (without the Vidhi draft until wired), 04 (gate only), 07, 10, 11, 12, 13, 14, 17 (component level), 19, 20 (platform side), 23 (dependency rule).
- IPB-07: AT-02, 12, 14, 15, 17, 19, 23, 24.
- IPB-08: AT-01, 04, 06, 10, 14 (mirror fallback on fixtures), 15 (hide on withdrawal), 17.
- IPB-13: AT-02 (when the Mermaid block is on; skipped with a reason), 03, 04.
- `@IPB-01-15` contract suites for the new ports (fixture and stub adapters); `@NN-01`, `@NN-02` and `@NN-45` with the new schemas.

**Exit gate:**

1. Every IPB-09 required check green, plus the new `a11y` job and the lints of §11.
2. Every new migration passes migration-lint and rls-lint; `infrabyx-migrate` applies all of them on a fresh PostgreSQL 18 with pgvector.
3. The acceptance tests above present by tag, passing, and listed by `at-report`.
4. The group site renders every launch page server-side with zero axe and HTML_CodeSniffer errors in light and dark themes, zero third-party requests before and after every consent choice, and Lighthouse accessibility ≥95.
5. Threat model updated for every new package, port and data flow (PL2-D-43).
6. Changesets: 0.1.0 for `ui`, `a11y`, `hlp`, `brand`, `cms`, `consent`, `feedback` and `trust`; minors for `contracts`, `config`, `testing`; a patch for `seed`.
7. STATUS, DECISIONS, OWNER-QUESTIONS and platform-requests updated; the gate report written; the release published through the version PR.

---

## 16. Risks

| Risk                                                                                | Mitigation                                                                                                                      |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Next.js and React minors arrive weekly; the 7-day rule may hold a security fix back | Pin exact versions; Renovate within the 7-day policy; a security advisory is a stop condition (CLAUDE.md item 6)                |
| The browser gates are slow or flaky in CI                                           | One build, routes scanned in parallel pages; the job runs only for the listed paths; the same Chromium as Playwright everywhere |
| Legal text is placeholder until counsel reviews it                                  | Seeded policies are placeholders with a banner and `noindex`, and cannot exist where seeds are refused (prod, dr, pre-prod)     |
| IPB and Ecosystem names diverge (trust, tokens, preferences)                        | Ecosystem names on the wire, mappings in one module each, platform requests PR-025 to PR-032                                    |
| A product forgets to mount the CMP or the gating                                    | `apps/public` is the template; the zero-third-party e2e test and `validate-footer` ship as reusable gates in `a11y` and `cms`   |
