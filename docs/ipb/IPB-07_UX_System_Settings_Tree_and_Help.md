# IPB-07 — UX System, Settings Tree and Help  (Infrabyx Platform Baseline Standard v1.0, 25 October 2026)

> **Status:** Binding for LD, LDC, EQ, FBX, UDF, OH unless a product records an `IPB-DEV` deviation.
> **Related:** IPB-01 (stack; shared packages `packages/ui`, `packages/tokens`, `packages/hlp`, `packages/a11y`, `packages/i18n`, `packages/brand`, `packages/feedback`); IPB-06 (accessibility floor; `Settings › Accessibility` sub-section is defined there and mounted here); IPB-08 (Trust Centre and Vendor Assurance Room; `Settings › Security & trust` is defined there and mounted here); the IPB files covering public website/CMS/Brand Studio, AI and Vidhi, engineering and release, integrations, billing (OH8) — each owns the content of the corresponding Settings node and this file owns the tree, names and order; Ecosystem Spec v1.2 (identity, consent, billing, data-class contracts).

## 07.1 Purpose and scope

Six products, one way of working. A compliance officer who learns LawDocsComply must find Settings, help, notifications and the command palette in the same place in Finbyx. A coding agent building a new screen must not invent a layout, an error format or a confirmation dialog. This file fixes:

(a) the **design system rules** every screen follows — layout, typography, navigation limits, forms, tables, Work Inbox, next-best-action, command palette, click budgets, keyboard, mobile parity, dark mode, density, simple mode, dashboards, notifications, errors and confirmations;
(b) the **per-product visual identity** as tokens and the rules for tenant overrides;
(c) the **standard Settings tree** — binding names, order and tier (USER / ORG / PLATFORM) for every node, with purpose, screens, keys, roles and maker-checker;
(d) the **"i" help system** — a glossary registry in which every UI label, field, setting and error has a help key, enforced by CI;
(e) the **help centre and tutorials** — article model, learning paths, onboarding tours, an automated tutorial pipeline, What's new, contextual help and Vidhi-grounded answers;
(f) settings keys, events, errors, adoption notes and acceptance tests.

Scope: `apps/web` (tenant application), `apps/console` (super admin), `apps/public` (public site where it has authenticated or interactive surfaces), `apps/delivery`/`apps/ops`, Expo mobile apps. Generated documents and emails follow the error and terminology rules but not the layout rules.

Relationship to IPB-06: accessibility is the floor; this file is the shape. Where this file states a UX rule that also satisfies a WCAG criterion, the IPB-06 test applies.

## 07.2 Definitions

| Term | Meaning |
|---|---|
| **Design token** | A named value (`--color-primary`, `--space-4`, `--font-body`) resolved per product and theme from `packages/tokens`. Components consume tokens only. |
| **Brand pack** (`brd_`) | The IPB-D-10 object carrying tokens, logo, display name, legal entity and policy set for a product or tenant brand. |
| **Primary action** | The single most important action on a screen, rendered as the one filled button. |
| **Progressive disclosure** | Showing the minimum first; advanced options behind "More", tabs or expandable sections. |
| **Work Inbox** | The unified list of items that need the user: tasks, approvals, mentions, Vidhi suggestions, due items, failed jobs. |
| **Next-best-action (NBA)** | The suggested next step on a record or dashboard, computed by deterministic rules (`RULES_PORT`), never by a model, for regulated steps. |
| **Command palette** | The Cmd/Ctrl+K dialog for search and actions across records, pages, settings and help. |
| **Click budget** | The maximum number of clicks/taps (excluding typing) from the journey's entry point to completion, measured in CI. |
| **Density** | `comfortable` (default) or `compact` spacing and row height. |
| **Simple mode** | A reduced UI preset for occasional users: fewer nav items, no tables of advanced options, larger type, guided flows. |
| **Help key** | `hlp.<module>.<term>` — identifier of a glossary entry. |
| **Glossary entry** | The record behind a help key: term, plain definition, explanation, regulatory reference, links, locales, reviewer of record, effective date. |
| **Help article** | Long-form content in the help centre with `help_article_key`. |
| **Learning path** | An ordered set of articles and tutorials for a persona. |
| **Tour** | An in-app sequence of ≤7 steps highlighting UI elements on first use. |
| **Evidence class** (on a number) | Tag on a dashboard figure: `LEDGER` (from an append-only ledger), `COMPUTED` (derived, with formula link), `EXTERNAL` (from a connector, with source and time), `AI` (model-produced, with run id). |
| **Destructive action** | Deletion, revocation, cancellation with legal or financial effect, bulk changes beyond a threshold, role removal, key rotation. |
| **Tiers** | **USER** = per person; **ORG** = tenant or legal entity (the brief's TENANT/ENTITY tiers); **PLATFORM** = Infrabyx super admin, including BRAND and PLAN tiers. |

## 07.3 Requirements

### 07.3.1 Design system rules

| ID | Requirement | Tier | Test |
|---|---|---|---|
| IPB-07-01 | **Minimal and clutter-free.** Every screen has a stated purpose line in its route spec; anything not serving it is removed or moved behind progressive disclosure. Decorative imagery is banned in `apps/web` and `apps/console`. | P | Design review checklist; route spec has `purpose`. |
| IPB-07-02 | **Contrast** ≥4.5:1 text and ≥3:1 non-text in every theme; high-contrast themes ≥7:1 (IPB-06-16). | P | Token test (IPB-06). |
| IPB-07-03 | **Typography**: base 16 px (`1rem`); type scale 12/14/16/18/20/24/30/36/48 px as `--text-xs … --text-5xl`; line-height 1.5 body, 1.25 headings; max line length 75 characters for reading content; numerals tabular in tables. | P | Lint: no raw `font-size` in components; Storybook typography page. |
| IPB-07-04 | **8-point spacing grid**: all spacing tokens multiples of 4 px with 8 px as the working unit (`--space-1`=4, `--space-2`=8 … `--space-16`=64); no arbitrary margins. | P | Lint rejects non-token spacing. |
| IPB-07-05 | **≤7 top-level navigation items** per product (plus Settings and Help, which live in the shell, not the nav). Additional modules nest or appear only by role. Simple mode shows ≤4. | P | Nav registry test; CI fails at 8. |
| IPB-07-06 | **One primary action per screen**, rendered as the single filled button, placed bottom-right of the form region on desktop and as a sticky bottom bar on mobile; secondary actions are outlined or text buttons; destructive actions never primary unless the screen's purpose is destruction (then red and confirmed per IPB-07-27). | P | Lint: ≤1 `variant="primary"` per route render; screenshot review. |
| IPB-07-07 | **Progressive disclosure**: forms show required fields first; advanced or rare fields under "More options" (expanded state remembered); wizard steps ≤7 with step names and "Save and finish later". | P | Form spec declares `tier: required \| common \| advanced`; lint. |
| IPB-07-08 | **Dropdown-first, auto-complete forms**: prefer select/combobox with search over free text where a controlled vocabulary exists (legal entity type, state, district, loan product, regulation); sensible defaults from tenant and user history; remembered choices (last-used values offered first, WCAG 3.3.7); input masks for PAN, GSTIN, IFSC, PIN, mobile with inline validation. | P | Form lint flags free-text fields for enumerated domains; redundant-entry test. |
| IPB-07-09 | **Autosave**: every form longer than three fields autosaves drafts (debounced 2 s, on blur, on step change) to a server-side draft keyed by user + route + record; a visible "Saved · 14:32" status (`role=status`); restoring a draft on return is offered, never forced. Regulated submissions are never autosubmitted. | P | SCRIPT: fill, reload, draft offered; status text updates. |
| IPB-07-10 | **Optimistic UI with undo**: non-regulated mutations (rename, tag, assign, archive, reorder, mark read) apply instantly with an undo toast (10 s default, `ux.undo.window_s`); on server failure the UI reverts and explains. Regulated or financial mutations are pessimistic with a progress state. | P | Component test; toast timing. |
| IPB-07-11 | **Empty states that teach**: every list or dashboard empty state shows what the area is for (one sentence from `hlp.`), the primary action to create the first item, a link to the relevant tutorial, and sample data toggle where a demo tenant exists. Never a blank table. | P | Snapshot per list route in empty state. |
| IPB-07-12 | **Skeletons not spinners**: loading states render layout skeletons sized to the expected content; spinners only for actions on a single control (<1 s expected) and never full-page. | P | Lint bans `<Spinner>` outside button/inline contexts. |
| IPB-07-13 | **Tables**: dense-but-legible (`compact` row 36 px, `comfortable` 44 px), sticky header, first column pinned, **column chooser** (show/hide/reorder, persisted per user per table), **saved views** (filters + sort + columns, personal and shared, ORG-shareable by `ORG_ADMIN`), inline filters, server-side pagination or virtual scroll, row density toggle, export (CSV/XLSX via `packages/export`) respecting permissions, keyboard navigation (arrows, Enter opens, Space selects). | P | `DataTable` component tests; saved view persistence test. |
| IPB-07-14 | **Bulk actions with preview and undo**: selecting rows reveals a bulk bar; every bulk action shows a preview ("Will change 42 records; 3 skipped because…") before apply; non-regulated bulk actions are undoable for `ux.undo.window_s`; regulated bulk actions (bulk approve, bulk disburse, bulk notice) require maker-checker and a typed confirmation above a threshold (`ux.bulk.confirm_threshold`, default 20). | P | SCRIPT bulk flow; threshold test. |
| IPB-07-15 | **Unified Work Inbox**: one route `/inbox` per product aggregating tasks, approvals (maker-checker items awaiting the user), mentions, Vidhi suggestions (labelled, dismissible), due items and failed jobs; filters by type, product module, due date; keyboard triage (j/k/e/a); every item deep-links to the record with the action pre-focused; "Approvals" tab shows diff of proposed change. Count badge in shell. | P | Inbox aggregates all five sources in test fixture; badge count matches. |
| IPB-07-16 | **Deterministic next-best-action**: NBA cards on records and dashboards come from rules in `RULES_PORT` (GoRules/CEL) with a visible "Why this?" explaining the rule; for regulated steps NBA is **never** AI-decided — Vidhi may add a separate "Suggestion" card labelled AI with sources, which never pre-fills a regulated action. | P | NBA cards carry `rule_id`; Vidhi cards carry `run_id` and label; no AI card on regulated-step routes triggers an action. |
| IPB-07-17 | **Command palette** (Cmd/Ctrl+K and shell button): global search across records, pages, settings, help entries and actions; results **permission-trimmed** at query time (Cerbos), grouped, with keyboard navigation; recent items; "Go to setting" by key or label; **PII-pattern refusal** — the palette refuses to search for strings matching Aadhaar (12 digits, Verhoeff-valid or `\d{4}\s?\d{4}\s?\d{4}`), PAN (`[A-Z]{5}\d{4}[A-Z]`), card PAN (13–19 digits Luhn-valid) and shows "Search by name or reference instead" (`IPB-UX-003`); the refused query is not logged in plaintext. | P | SCRIPT: palette opens, searches, trims; Aadhaar pattern refused and absent from logs. |
| IPB-07-18 | **Click budgets**: every journey in the registry (IPB-06-58) declares `click_budget`; **top journeys ≤3 clicks** from the module landing to completion (excluding typing and regulated confirmations, which count as 1); measured in CI by Playwright (`packages/a11y/playwright/clicks.ts`) counting pointer/keyboard activations; exceeding the budget fails the release (`IPB-UX-001`). | P | CI click-budget report per journey. |
| IPB-07-19 | **Keyboard-first**: every action reachable by keyboard with the shortcut map of IPB-06-29; list pages support j/k, Enter, `/` to focus search; forms submit on Ctrl+Enter; palette on Ctrl+K; inbox on Ctrl+I. Hints shown in tooltips. | P | IPB-06 keyboard journey test. |
| IPB-07-20 | **Mobile parity**: every journey marked `mobile: required` in the registry is completable on a 360×640 CSS px viewport and in the Expo app where one exists, with a sticky primary action, one question per screen for regulated steps, bottom nav ≤5; features marked `mobile: view_only` show a clear "Complete on desktop" message with a magic link to continue. | P | SCRIPT at 360 px; registry lint. |
| IPB-07-21 | **Dark mode** as a full token theme (not inverted); charts and documents previews re-tokenised; `prefers-color-scheme` honoured until the user chooses (`a11y.display.theme`). | P/U | IPB-06 theme tests. |
| IPB-07-22 | **Density toggle** (`ux.density`): `comfortable` default; `compact` for tables, inbox and lists; density never below WCAG target size (24 px) — compact rows keep 24 px row-level targets and 36 px controls. | U | Token test; target-size rule. |
| IPB-07-23 | **Simple mode** (`a11y.ui.simple_mode` / `ux.simple_mode`): ≤4 nav items, guided flows instead of tables, larger type (112.5%), hidden advanced settings, visible step names; offered at onboarding to roles flagged `occasional` (board members, borrowers, parties, witnesses) and switchable any time. | U | Snapshot of simple shell; nav count. |
| IPB-07-24 | **Dashboard widget catalogue**: widgets registered in `packages/ui/widgets` with id, data contract, roles, evidence class; **mandatory widgets per role** (for example `ORG_CHECKER` always sees "Approvals awaiting me"; `ORG_OWNER` always sees "Compliance calendar"); users may add/remove/reorder optional widgets within their role's catalogue; **every number carries an evidence class** badge and a drill-through to its source (ledger query, formula, connector, AI run); no widget shows a figure without one. | P/U | Widget registry test; evidence-class lint; drill-through present. |
| IPB-07-25 | **Notification design**: digest-first (default daily digest for non-urgent classes; immediate only for urgent classes defined in the notification catalogue), quiet hours per user (`ntf.quiet_hours`, default 21:00–08:00 local, urgent classes may override only when the catalogue says `bypass_quiet_hours=true` and the tenant allows), channel preferences per class (in-app, email, push, WhatsApp, SMS), one-click unsubscribe for marketing, mandatory classes (security, regulatory deadlines, maker-checker requests) cannot be disabled but can be routed. No notification without a deep link and a help key. | U/ORG | Catalogue test; quiet-hours test. |
| IPB-07-26 | **Error message standard**: every error shown to a user has four parts — **what happened** (plain, past tense), **why** (cause in user terms), **what to do** (next step or alternative), **help key** (renders an "i" and a reference code `IPB-XXX-NNN`/`<PRODUCT>-XXX-NNN`). Field errors sit beneath the field and are summarised at the top with focus moved (IPB-06, 3.3.1). Technical detail is behind "Details" with a correlation id for support. Errors never blame the user ("you entered an invalid…") — use "The PAN format was not recognised". | P | Error catalogue lint: four parts present; help key exists. |
| IPB-07-27 | **Confirmation standard**: (a) non-destructive, reversible → no dialog, undo toast; (b) destructive or irreversible → dialog naming the object and consequence, requiring a **typed confirmation** (object name or the word shown) when the action affects >1 record, a legal/financial state or any other user; (c) **delay window** for the most destructive actions (tenant deletion, export of full dataset to a new destination, key revocation, legal-hold release, role removal of the last admin): the action is scheduled, visible in Audit trails and Work Inbox, cancellable for `ux.confirm.delay_window_h` (default 24 h, ORG may lengthen, never shorten below 1 h), and requires maker-checker. Dialogs never default-focus the destructive button. | P/ORG | Dialog component tests; scheduled-action test. |
| IPB-07-28 | **Terminology consistency**: UI copy uses the term in the glossary registry; synonyms are banned by copy lint (`packages/hlp/lint`); tenant terminology overrides (Customisation) apply through the same registry. | P | Lint report. |
| IPB-07-29 | **Component source of truth**: all screens compose `packages/ui` components; product-local components are allowed only for domain visualisations and must pass the same Storybook gates; forking a shared component is a deviation. | P | Dependency lint; Storybook coverage. |
| IPB-07-30 | **No dark patterns**: no pre-ticked optional consents, no confirm-shaming, no hidden cancel, no countdown pressure except regulator-mandated windows, no nagging more than once per 30 days for any upsell; cancellation and export are as easy as purchase (same number of clicks ±1). | P | Dark-pattern checklist in release; click-budget comparison purchase vs cancel. |

### 07.3.2 Per-product identity and tenant overrides

| ID | Requirement | Tier | Test |
|---|---|---|---|
| IPB-07-31 | Each product ships a default brand pack with the tokens in §07.4.1; the display name, logo and favicon come from Brand Studio; components never reference a product colour directly. | P | Token lint. |
| IPB-07-32 | **Tenant overrides** (white-label plans; Customisation › Branding): tenants may set `--color-primary`, `--color-accent`, logo, favicon, display name and (on enterprise plans) font from an allow-list of self-hosted fonts. Derived tokens (hover, subtle, on-primary text) are computed, not set. Every override passes the **contrast guard** (text-on-primary ≥4.5:1 via automatic white/black selection; primary-on-surface ≥3:1; focus ring recomputed) or is rejected with `IPB-A11Y-006`. Overrides preview in all four themes before save. | ORG | Brand Studio save test; preview renders four themes. |
| IPB-07-33 | Infrabyx attribution ("Powered by <product>") remains in the footer and About unless the plan is white-label; the Vidhi kernel name stays in About and audit even when the tenant renames the assistant (IPB-D-03). | PLATFORM | Snapshot. |
| IPB-07-34 | Tenant terminology override (Customisation › Terminology) maps glossary terms to tenant words (for example "Matter" → "Case") for display only; help keys, audit and exports keep canonical terms with the tenant term in brackets. | ORG | Rendering test; export unchanged. |

### 07.3.3 Standard Settings tree

| ID | Requirement | Tier | Test |
|---|---|---|---|
| IPB-07-35 | The Settings route `/settings` exists in every product with the **binding order and names** of §07.4.2; nodes a product does not need are hidden, never renamed or reordered; product-specific nodes are added only at the end of their tier group and recorded in the decision log. | P | Settings nav snapshot per product vs tree spec. |
| IPB-07-36 | Each node declares tier (USER / ORG / PLATFORM), roles that may view and change, maker-checker requirement, and the settings keys it owns, in `packages/config/settings-tree.yaml`; a setting not registered there cannot be read by code (IPB non-negotiable: settings registered before code reads them). | P | Registry lint; runtime guard throws on unregistered key. |
| IPB-07-37 | Settings search (within Settings and via the palette) finds any setting by label, key or help text; every setting shows its "i", its scope badge (You / Organisation / Platform) and who last changed it (from the audit ledger) for ORG and PLATFORM settings. | P | SCRIPT search; last-changed renders. |
| IPB-07-38 | **Scope precedence** for a key defined at multiple tiers: PLATFORM floor/ceiling → PLAN → BRAND → TENANT → ENTITY → USER, with explicit `allow_user_override` flags; a lower tier may tighten security and privacy settings only. | P | Resolution unit tests. |
| IPB-07-39 | Changes to ORG and PLATFORM settings write the audit ledger in the same transaction and emit `in.<product>.settings.SettingChanged.v1`; maker-checker is required where §07.4.2 says so; the checker sees a diff. | P | Audit test; maker-checker flow. |
| IPB-07-40 | Tenant customisation (branding, terminology, navigation, dashboards, custom fields, notification routing, maker-checker policy) never requires super admin or a code release. | ORG | End-to-end: `ORG_ADMIN` completes each without platform role. |

### 07.3.4 "i" help system

| ID | Requirement | Tier | Test |
|---|---|---|---|
| IPB-07-41 | **Glossary registry** in `packages/hlp` with entries keyed `hlp.<module>.<term>` and the fields of §07.4.3 (term, plain definition ≤40 words, longer explanation, regulatory citation, links, locale variants, reviewer of record, effective date, status). Entries are content, editable by `PLT_CONTENT_EDITOR` with `PLT_LEGAL_REVIEWER` check for any entry carrying a regulatory citation; published through the CMS pipeline with version history. | P | Registry schema test; publish requires reviewer for cited entries. |
| IPB-07-42 | **Every UI label, field, setting, error, notification class, widget and nav item carries a help key.** Components accept `helpKey` (required prop on `Field`, `SettingRow`, `Column`, `Widget`, `NavItem`, `ErrorMessage`). | P | TypeScript required prop; runtime warning in dev. |
| IPB-07-43 | **CI lint fails the build on a missing key**: `hlp-lint` walks the route registry, form specs, settings tree, error catalogue, notification catalogue and widget registry; any help key absent from the published registry, or any component missing `helpKey`, fails with `IPB-HLP-001`. Draft entries (status `draft`) satisfy lint only on non-production branches. | P | CI job `hlp-lint`. |
| IPB-07-44 | **Per-field "i" button**: 24×24 px target (WCAG 2.5.8), accessible name "Help: <label>", opens a popover that is dismissible (Esc, outside click), hoverable and persistent (WCAG 1.4.13), keyboard reachable in the tab order immediately after the label; popover shows plain definition, "Learn more" (longer explanation and article link), and a **"Regulatory reference" panel** showing instrument, provision, a one-line summary of what the rule requires, and the citation's effective date with a link where a public URL exists. The regulatory panel appears only when the entry has a citation. | P | Popover component tests; AT script. |
| IPB-07-45 | **Plain-language variants** of each entry (`plain`) feed IPB-06 plain-language mode; **locale variants** feed the twelve-locale readiness; missing locale falls back to `hi` then `en` with a "Translation pending" badge. | P | Fallback test. |
| IPB-07-46 | **Public glossary page** at `/glossary` on `apps/public` lists published entries with search, A–Z and module filter; each entry has a stable URL `/glossary/<module>/<term>`; entries marked `internal` are excluded. | P | Page renders from registry; internal excluded. |
| IPB-07-47 | **Search integration**: the palette and help-centre search index glossary entries; typing a term in the palette shows the plain definition inline. | P | SCRIPT. |
| IPB-07-48 | **Vidhi can expand any "i"**: the popover offers "Ask Vidhi about this"; Vidhi answers grounded on the entry, its article and cited instruments (retrieval limited to published help content and the public text of the cited instrument), labels the answer AI-generated with sources and date, and never alters the entry. Available only when the tenant's AI settings allow. | P | Answer carries sources; no write to registry. |
| IPB-07-49 | Errors reference help keys (IPB-07-26); the error popover shows the error code, the four-part message and the regulatory reference where the error enforces a rule (for example the cooling-off window). | P | Error catalogue lint. |
| IPB-07-50 | Help keys are stable identifiers: renaming a term never changes its key; a key is deprecated with `superseded_by`, never deleted while any build references it. | P | Registry lint on delete. |

### 07.3.5 Help centre and tutorials

| ID | Requirement | Tier | Test |
|---|---|---|---|
| IPB-07-51 | **Article model** (`help_article_key`, title, summary, body, module, personas, product versions, locale variants, related glossary keys, related routes, media, reviewer, effective and review-by dates, status) stored in the CMS; article pages at `/help/<module>/<slug>` on `apps/public` and in-app panel. | P | Schema test; render test. |
| IPB-07-52 | **Learning paths per persona** (for example LDC "Compliance officer, first 30 days"; FBX "Credit officer"; UDF "Borrower"; EQ "Neutral"; LD "Advocate"; OH "Support agent") as ordered lists of articles, tutorials and tours with progress tracking per user (`tut.progress`), certificate of completion optional. | P | Path renders; progress persists. |
| IPB-07-53 | **Onboarding tours**: ≤7 steps, each anchored to a UI element with `data-tour-id`, skippable at every step, resumable (progress stored), re-launchable from Help; tours never block regulated actions and never auto-start on a regulated-step screen; tour copy comes from help keys. | P | Tour engine tests; step count lint. |
| IPB-07-54 | **Tutorial pipeline**: tutorials are generated, not hand-made — a Playwright script per tutorial runs on the seeded demo tenant, captures screenshots and a screen recording with narration script, assembles the article (steps with screenshots) and the video (WebVTT en/hi per IPB-06-07), publishes to the help centre; on every release the pipeline re-runs and a **screenshot-diff staleness check** flags tutorials whose screenshots changed beyond a threshold (`tut.staleness_threshold_pct`, default 2%) for re-review before republish; **social clip export** (9:16 and 1:1, ≤60 s, captions burned in, brand frame) for marketing with the Claims Register rule applied to any claim in the clip. | P | Pipeline job; staleness flag; clip artefacts. |
| IPB-07-55 | **Video** always with captions and transcript (IPB-06-07), chapters, playback speed, and the "Open this screen" deep link when watched in-app. | P | Player tests. |
| IPB-07-56 | **What's new**: release notes (`rel_`) generate "What's new" cards shown once per user per release in-app (dismissible, never modal on regulated screens) and a public `/changelog`; each card links to the article or tutorial and carries the release version; tenants may suppress cards for minor releases (`tut.whats_new.min_level`). | P/ORG | Card appears once; suppression respected. |
| IPB-07-57 | **Contextual help panel per route**: every route declares `help_article_key` (lint-enforced like help keys); the "?" shell button opens a side panel with that article, the route's glossary terms, related tutorials, keyboard shortcuts for the route, and "Report a problem". | P | Route registry lint; panel content test. |
| IPB-07-58 | **Feedback on articles**: "Was this helpful?" with optional comment, creating `fbk_` items of type `help_content`; articles below 60% helpful over 50 votes are flagged for review in the OH content queue. | P | Vote recorded; flag raised. |
| IPB-07-59 | **Vidhi-grounded help answers**: the help search box offers "Ask Vidhi"; answers cite articles and glossary entries with links, are labelled, and refuse to answer outside the help corpus ("I can only answer from the help content; here is the closest article"). Tenant data is never retrieved in help answers. | P | Grounding test; out-of-corpus refusal. |
| IPB-07-60 | Help content has a **review-by date** (default 12 months; 6 months for regulatory content); overdue content shows a "Under review" badge and appears in the OH content queue. | P | Badge test. |

## 07.4 Design

### 07.4.1 Per-product identity table and tokens

All products share semantic token names; only values differ. Fonts are self-hosted from first-party origin. Values below are the defaults from IPB-D-11; hover/active/subtle variants are derived by the token build (lightness steps) and contrast-checked.

| Product | `--color-primary` | `--color-accent` | `--font-body` | `--font-heading` | `--font-mono` | Feel |
|---|---|---|---|---|---|---|
| LD — LawDocs | `#0B2545` navy | `#E07A1F` saffron | Inter | Source Serif 4 | JetBrains Mono (code/citations) | Authoritative, document-centred, generous reading measure |
| LDC — LawDocsComply | `#0F4C3A` forest green | `#C9A227` gold | IBM Plex Sans | IBM Plex Sans | IBM Plex Mono | Calm, register-like, status-driven |
| EQ — Equator Resolution | `#0E6E6E` teal | `#F26B5B` coral | Manrope | Manrope | JetBrains Mono | Neutral, procedural, hearing-first |
| FBX — Finbyx | `#1E3A8A` slate blue | `#10B981` emerald | Inter | Inter | JetBrains Mono (all numbers and amounts) | Precise, ledger-like, dense tables |
| UDF — Udofin | `#4338CA` indigo | `#F59E0B` amber | Plus Jakarta Sans | Plus Jakarta Sans | — | Friendly, large type, one question per screen |
| OH — Operations Hub | `#1F2937` charcoal | `#2563EB` electric blue | Inter | Inter | JetBrains Mono | Utilitarian, keyboard-heavy, inbox-first |

Shared semantic tokens (every theme defines all):

| Token | Purpose | Guard |
|---|---|---|
| `--color-primary`, `--color-on-primary` | Primary action and its text | on-primary ≥4.5:1 |
| `--color-accent`, `--color-on-accent` | Highlights, badges | ≥4.5:1 |
| `--color-bg`, `--color-surface`, `--color-surface-raised` | Page, card, popover backgrounds | — |
| `--color-text`, `--color-text-muted` | Body and secondary text | ≥4.5:1 on surface (muted ≥4.5:1 too; no "light grey" text) |
| `--color-border`, `--color-border-strong` | Dividers, control borders | strong ≥3:1 |
| `--color-focus` | Focus ring | ≥3:1 against bg and surface |
| `--color-success`, `--color-warning`, `--color-danger`, `--color-info` + `-bg` variants | Status | icon + text always |
| `--color-link` | Links | ≥4.5:1 and distinguishable from text without colour (underline) |
| `--radius-sm/md/lg` | 4/8/12 px | — |
| `--shadow-1/2` | Elevation | subtle only |
| `--space-1 … --space-16` | 4–64 px | 8-pt grid |
| `--text-xs … --text-5xl` | Type scale | base 16 |
| `--font-body`, `--font-heading`, `--font-mono` | Fonts | self-hosted; dyslexia fonts replace body/heading when `a11y.text.font` set |
| `--duration-fast/base/slow` | 100/200/300 ms | 0 under reduced motion |

Theme files: `packages/tokens/<product>/{light,dark,hc_light,hc_dark}.json`. Tenant overrides are stored in the brand pack and compiled to a CSS variable layer applied after the product theme.

### 07.4.2 Standard Settings tree (binding order and names)

Tier legend: **USER** (per person), **ORG** (tenant or legal entity; `ORG_OWNER`/`ORG_ADMIN` unless stated), **PLATFORM** (visible in `apps/console` to platform roles; mirrored read-only in `apps/web` where noted). "MC" = maker-checker required for changes.

| # | Node (binding name) | Tier | Purpose | Key screens | Settings key prefix | Roles (change) | MC |
|---|---|---|---|---|---|---|---|
| 1 | **Profile** | USER | Who you are to the system | Name, photo, designation, contact, signature block, preferred locale, time zone | `usr.profile.*` | self | no |
| 2 | **Security** | USER (ORG policy view) | Protect the account | Password, MFA (TOTP/passkeys/WebAuthn L3), active sessions with revoke, trusted devices, recovery codes and recovery contact, login history | `sec.user.*` (ORG policy `sec.org.*` shown read-only here) | self; `ORG_ADMIN` for policy via node 8 | policy: yes |
| 3 | **Privacy & consents** | USER | Control personal data | Purpose-wise consents (toggle per purpose with date and notice version), data requests (access, correction, erasure, nomination under DPDP s.14 **[VERIFY section]**), "What this app can access" (device permissions, connected identities), download my data, communication preferences linked to Notifications | `priv.user.*` | self | no |
| 4 | **Accessibility** | USER | Adapt the interface | IPB-06 §06.4.2 sub-section verbatim | `a11y.*` | self | no |
| 5 | **Appearance** | USER | Look and formats | Theme (shortcut to a11y), density, language, date format, number format, first day of week, default landing page, simple mode | `ux.appearance.*`, `ux.density`, `ux.simple_mode` | self | no |
| 6 | **Notifications** | USER (ORG routing) | What reaches you and how | Per-class channel matrix, digest schedule, quiet hours, mandatory classes shown locked, test notification | `ntf.user.*` (ORG `ntf.org.*`) | self; `ORG_ADMIN` routing | routing: yes |
| 7 | **Customisation** | ORG | Make the product the tenant's | Branding (Brand Studio tenant layer with contrast guard), terminology overrides, navigation (hide/reorder within limits, default module per role), dashboards (role defaults, mandatory widgets locked), custom fields (per record type, with type, validation, help key, PII class), templates (document and email), workflow labels | `cst.*` | `ORG_ADMIN` | branding: no; custom fields with PII class: yes; navigation: no |
| 8 | **Organisation & people** | ORG | Who belongs and what they may do | Legal entities (CIN/GSTIN/registered office), departments and locations, roles and permission sets (Cerbos policy view), members and invitations (SCIM status), delegation (time-boxed, scoped), maker-checker policy (which actions, thresholds, segregation rules), security policy (password/MFA/session rules, IP allow-list, SSO/SAML) | `org.*`, `sec.org.*`, `mc.*` | `ORG_OWNER`, `ORG_ADMIN` | yes for roles, maker-checker policy, security policy, entity changes |
| 9 | **Billing** | ORG | Payment arrangements | Payment methods (tokenised, via OH8 hosted page), billing contacts, GST details, auto-pay, credit balance, dunning status | `bil.*` (mirror of OH8) | `ORG_OWNER`, `ORG_ADMIN` with `billing` permission | payment method change: yes |
| 10 | **Invoices** | ORG | Statements of account | Invoice list (OH8), download (PDF, GST-compliant), credit notes, payment history, disputes | `bil.invoices.*` | as Billing (view wider) | no |
| 11 | **Plans & subscription** | ORG | What is purchased | Current plan and limits, usage vs limits, upgrade/downgrade with preview of changes, add-ons, renewal date, cancellation (as easy as purchase), trial status | `pln.*` | `ORG_OWNER` | downgrade/cancel: yes (delay window) |
| 12 | **Storage & data** | ORG | Where data lives and how it leaves | Usage by class, **BYO storage** (connect tenant bucket via `STORAGE_PORT` adapter, test, cut-over), export (`<PRODUCT>-EXPORT-1.0`, scheduled or on demand), retention schedules per record type (floors from regulation locked), legal hold (place/release), data residency statement, **exit** (full export + deletion schedule with delay window and certificate) | `dat.*` | `ORG_OWNER`, `ORG_ADMIN` | BYO storage, retention change, legal hold, exit: yes |
| 13 | **Audit trails** | ORG (PLATFORM for platform ledger) | Prove what happened | Ledger viewer (who/what/when/before/after, hash-chain verification status), filters, export (signed), scheduled actions awaiting delay window, settings-change history, access reviews | `aud.*` | `ORG_AUDITOR_RO`, `ORG_ADMIN`, `ORG_OWNER` (read); nobody edits | n/a (append-only) |
| 14 | **Integrations** | ORG | Connect other systems | API keys (scoped, expiring, last-used), webhooks (Standard Webhooks; endpoints, secrets, retries, delivery log), connected apps (OAuth grants), WhatsApp/Meta (WABA, templates, quality rating), calendar/workspace (Google/Microsoft), connector marketplace (install from catalogue; permissions preview), SFTP/batch | `int.*` | `ORG_ADMIN` with `integrations` permission | API key creation and webhook endpoint change: yes above `int.mc_threshold`; connector install with data egress: yes |
| 15 | **AI & Vidhi** | ORG (PLATFORM ceilings) | Govern the AI employee | Providers and BYOK (allowed providers from platform list; tenant keys; data-class routing shown), autonomy ceilings per skill (view platform ceiling, tighten), locked human-approval list (read-only), agents (enable/disable, scope), schedules (missions), usage and cost, AI disclosure settings, display-name override (white-label) | `ai.*`, `vidhi.*` | `ORG_OWNER`, `ORG_ADMIN` with `ai_governance` | ceilings, providers, agent enablement: yes |
| 16 | **Feedback** | USER (ORG view of own tenant's items) | Tell us | Submit feedback/bug/idea/accessibility problem, my submissions and status, tenant-wide list for admins, roadmap votes (if enabled) | `fb.*` | self; `ORG_ADMIN` view | no |
| 17 | **Tutorials & help** | USER (ORG curation) | Learn | Learning paths and progress, tours (re-launch), tutorials library, keyboard shortcuts, glossary, contact support, tenant-curated "Start here" (ORG) | `tut.*`, `hlp.*` | self; `ORG_ADMIN` curation | no |
| 18 | **Security & trust** | ORG (read) / PLATFORM (publish) | Vendor assurance for the tenant's regulator | Vendor documents (IPB-08), sub-processors, certifications, status/uptime, DPA, incident notices, evidence pack export, auditor grants, questionnaire responder | `trust.*` | view: `ORG_OWNER`, `ORG_ADMIN`, `ORG_AUDITOR_RO`; grants: `ORG_OWNER`/`ORG_ADMIN` | grants: yes (IPB-08) |
| 19 | **What's new** | USER | Changes | Release cards, changelog link, per-release articles, suppression level (ORG) | `tut.whats_new.*` | self; `ORG_ADMIN` suppression | no |
| 20 | **About** | USER | Identity of the software | Product and display name, version and build, licences (open-source notices), legal entity of the provider, Vidhi kernel version, terms/privacy links, support contact, grievance officer (statutory), data residency | `ipb.about.*` | read-only | n/a |

Platform-only nodes in `apps/console` (`PLT_*` roles), placed after node 20 in the console tree and never shown in `apps/web`: **Tenants & plans**, **Brand Studio (platform layer)**, **Pricing Studio**, **CMS**, **Compliance Documents** (IPB-08 Vendor Assurance Room), **Feature flags & releases**, **Platform audit**, **Observability**, **Seed & environments**.

Product variations (what a product hides or adds; additions go at the end of the tier group):

| Node | LD | LDC | EQ | FBX | UDF | OH |
|---|---|---|---|---|---|---|
| Profile | adds Bar Council enrolment no., signature block | adds professional memberships (ICSI/ICAI) | adds neutral credentials, panel memberships, conflict declarations | adds employee code, branch | borrower: minimal (name, mobile, language); lender staff: full | adds product_scope badge (IPB-D-12), HR id |
| Privacy & consents | standard | standard | adds hearing recording/transcript consents per case | adds credit-bureau and KYC consents (view, not revoke within live loan — explained) | adds DL-Directions consents (data use, LSP), revoke path with consequences | staff-only; adds monitoring notice |
| Customisation | templates, letterheads | registers, compliance calendar labels | case types, procedural rules, hearing room branding | loan products naming, branch hierarchy, document checklists | lender white-label (brand pack), app store identity | OH8 billing templates, support macros |
| Organisation & people | firm, offices, teams | entities group structure (holding/subsidiary), compliance owners | panels, neutral rosters, party organisations | legal entities, branches, hierarchy, limits/authority matrix | lender partners (LSP arrangements), agents | Infrabyx entities, product_scope grants |
| Billing/Invoices/Plans | present | present | present; party-side fees via case billing | present; lender plans | lender pays; borrower sees none | OH **is** the billing engine (OH8 admin) |
| Storage & data | DMS retention by matter | regulatory retention floors (Companies Act 2013 s.128 eight years **[VERIFY]**) | case record retention; award archive | RBI record retention floors; BYO storage mandatory on enterprise | borrower data retention per DL Directions; export to borrower | group data; staff records |
| Integrations | DMS, e-sign, courts data, Tally | MCA/SEBI filing portals, ERP | video, e-stamp, e-sign, payment of fees | bureau, bank statement, e-NACH, CKYC, CIMS reporting, accounting | lender APIs, bureau, UPI, account aggregator | all group connectors; marketplace publisher |
| AI & Vidhi | drafting skills | compliance monitoring skills | case-summary skills (no decision support to neutrals without labelling) | underwriting assist (never decision), collections drafting | borrower help only; no credit decision | ops skills |
| Security & trust | present | present | present | present (NBFC due diligence) | lender view only | system of record (IPB-08) |

### 07.4.3 Glossary registry entry schema (`packages/hlp`)

```yaml
key: hlp.ldc.compliance_calendar
term: Compliance calendar
plain: >
  The list of filings and actions your organisation must complete, each with a due date, owner and status.   # ≤40 words
explanation: >
  Entries are generated from the regulations your entities are mapped to. Each entry carries the source rule,
  the evidence it needs and the escalation path if it is late. You can add internal deadlines too.
regulatory_reference:
  - instrument: Companies Act 2013
    provision: s.92 (annual return), s.137 (filing of financial statements)
    summary: Annual return and financial statements must be filed with the Registrar within the statutory period.
    effective_date: 2014-04-01
    url: https://www.mca.gov.in/
    tag: LAW
links:
  - help_article_key: help.ldc.calendar.getting_started
  - route: /compliance/calendar
locales:
  hi: { term: अनुपालन कैलेंडर, plain: ..., explanation: ... }
reviewer_of_record: { role: PLT_LEGAL_REVIEWER, user_id: usr_..., reviewed_at: 2026-10-20 }
effective_date: 2026-10-25
status: published        # draft | in_review | published | deprecated
superseded_by: null
visibility: public       # public | internal
```

Rules: `plain` ≤40 words (lint); `regulatory_reference[].tag` is one of LAW/INTERP/REC; entries with LAW citations require `reviewer_of_record` with `PLT_LEGAL_REVIEWER` role; `effective_date` is the date the definition applies from; `key` immutable.

### 07.4.4 "i" popover anatomy

```
[Label]  (i)
 └─ Popover (role=dialog, aria-labelledby=term)
    ├─ Term (heading)
    ├─ Plain definition
    ├─ "Learn more" → expands explanation; link to article
    ├─ Regulatory reference (panel, only if present)
    │    Instrument · Provision · one-line requirement · effective date · [Open source ↗]
    ├─ "Ask Vidhi about this" (if AI enabled) → opens Vidhi panel grounded on this entry
    └─ Footer: key (monospace, copyable), reviewer initials, effective date, "Suggest a change"
```

Behaviour: opens on click/Enter/Space; stays open while hovered; Esc closes and returns focus to the "i"; only one popover open at a time; on mobile renders as a bottom sheet; content is read from the registry cache shipped with the build and refreshed at runtime (so a definition fix needs no deploy).

### 07.4.5 Tutorial pipeline

```
tut/<product>/<tutorial_id>.spec.ts   (Playwright on seeded demo tenant; steps annotated with narration)
   │ release pipeline (per release, per locale)
   ▼
Capture: screenshots per step (light theme, 1280×800 and 390×844), screen recording, DOM snapshots
   ▼
Assemble: article (steps + screenshots + help keys), video (recording + TTS narration from script in en/hi
          + WebVTT captions en/hi + transcript), ISL rendition slot (manual upload for required tutorials)
   ▼
Staleness check: compare screenshots to the last published set; diff > tut.staleness_threshold_pct → status
          "needs_review" and item in OH content queue; else auto-publish if tut.auto_publish=true
   ▼
Publish: help centre article + video; What's new card if linked to a release note; social clip export
          (9:16, 1:1; ≤60 s; burned-in captions; brand frame; Claims Register check on narration)
```

Seeded demo tenant: deterministic data (`SEED_CREDENTIALS.md` profile `demo`), fixed clock, no real PII; the pipeline refuses to run against any non-demo tenant.

### 07.4.6 Command palette result model

| Group | Source | Trimming | Action on select |
|---|---|---|---|
| Actions | route registry actions for current context | Cerbos check per action | performs or opens the form |
| Records | `SEARCH_PORT` across record types the user may read | RLS + Cerbos at query | opens record |
| Pages | nav registry | role | navigates |
| Settings | settings tree (label, key, help text) | tier/role | opens setting with the row focused |
| Help | glossary + articles | visibility | shows plain definition inline; Enter opens article |
| Recent | user history (client-side, no PII in labels) | — | opens |

PII refusal runs before any network call: patterns Aadhaar (12 digits optionally grouped 4-4-4; Verhoeff check if unspaced), PAN, payment card (13–19 digits passing Luhn), and `aadhaar|आधार` followed by digits. On match: show `IPB-UX-003` message, do not send the query, log only the pattern class (`aadhaar_pattern`), never the string.

### 07.4.7 Error message rendering

```
⚠ The PAN was not recognised.                       ← what happened
   PAN must be 10 characters: 5 letters, 4 digits, 1 letter (for example ABCDE1234F).   ← why / what to do
   [Fix the PAN]  [Details ▸]   (i) hlp.kyc.pan   Ref: FBX-KYC-012
```

"Details" reveals the correlation id and timestamp for support. Field errors are mirrored in a top summary with links to each field; the first error receives focus.

### 07.4.8 Confirmation dialog rendering

Destructive, typed-confirmation variant:

```
Delete legal entity "Ratnaa Finance Pvt Ltd"?
This removes 3 users' access and 1,204 records from active views. Records stay in retention for 8 years and can be restored by a platform request.
To confirm, type the entity name:  [__________________]
This change will take effect in 24 hours and can be cancelled from Audit trails › Scheduled actions until then.
Requires approval from a checker.  (i) hlp.org.delete_entity
[Cancel]   [Schedule deletion]    ← destructive button not default-focused
```

### 07.4.9 Work Inbox item model

`inbox_item { id, type: task|approval|mention|suggestion|due|job_failed, product_module, record_ref, title, due_at, from (user or AGT_), severity, action_hint, deep_link, created_at, read_at, resolved_at }`. Approvals link to the maker-checker request with diff; suggestions carry `run_id` and sources; items resolve automatically when the underlying state changes.

### 07.4.10 Click-budget measurement

The Playwright helper wraps `page` to count `click`, `tap`, `press('Enter')` on actionable elements and `select` interactions; typing keystrokes and scrolls are excluded; a regulated confirmation counts as one. Each journey spec declares `@budget(3)`; the reporter writes `clicks.json` per journey; the release gate compares and fails with `IPB-UX-001` listing journeys over budget and the step at which the budget was exceeded.

## 07.5 Settings keys

Keys owned by this file. Tier `ORG` in this table and in the tree (§07.4) is the registry tier **TENANT** of IPB-07-38 (ENTITY where a key is declared `scope: legal_entity` in `settings-tree.yaml`); `PLATFORM` here covers the registry tiers PLATFORM, BRAND and PLAN, and the registry file records the exact one. *(rev. 26 Oct 2026)* Keys for Accessibility (`a11y.*`) are in IPB-06; Security & trust (`trust.*`) in IPB-08; AI (`ai.*`, `vidhi.*`), integrations (`int.*`), billing (`bil.*`, `pln.*`), data (`dat.*`) in their owning files.

| Key | Tier | Type | Default | Who may change | Maker-checker |
|---|---|---|---|---|---|
| `ux.density` | USER | enum `comfortable\|compact` | `comfortable` | user | no |
| `ux.simple_mode` | USER | bool | false (true offered to occasional roles) | user | no |
| `ux.appearance.language` | USER | locale | brand default | user | no |
| `ux.appearance.date_format` | USER | enum | `DD MMM YYYY` | user | no |
| `ux.appearance.number_format` | USER | enum `en-IN\|en-US\|native` | `en-IN` | user | no |
| `ux.appearance.first_day_of_week` | USER | enum | `monday` | user | no |
| `ux.appearance.landing_route` | USER | route | role default | user | no |
| `ux.undo.window_s` | PLATFORM | int 5–30 | 10 | `PLT_RELEASE_MANAGER` | yes |
| `ux.bulk.confirm_threshold` | ORG | int ≥1 | 20 | `ORG_ADMIN` | yes |
| `ux.confirm.delay_window_h` | ORG | int ≥1 | 24 | `ORG_OWNER` | yes (cannot go below PLATFORM floor 1) |
| `ux.nav.max_top_level` | PLATFORM | int | 7 | `PLT_RELEASE_MANAGER` | yes (ceiling; cannot be raised) |
| `ux.click_budget.enforce` | PLATFORM | bool | true | `PLT_RELEASE_MANAGER` | yes |
| `ux.palette.enabled` | ORG | bool | true | `ORG_ADMIN` | no |
| `ux.palette.pii_refusal` | PLATFORM | bool | true (locked) | — | n/a |
| `ux.tables.saved_views_shared` | ORG | bool | true | `ORG_ADMIN` | no |
| `ux.autosave.enabled` | PLATFORM | bool | true | `PLT_RELEASE_MANAGER` | yes |
| `ux.autosave.debounce_ms` | PLATFORM | int | 2000 | `PLT_RELEASE_MANAGER` | no |
| `ux.dashboard.mandatory_widgets` | PLATFORM/ORG | json role→widget ids | per product | `PLT_RELEASE_MANAGER` (platform floor), `ORG_ADMIN` (add) | yes |
| `ux.nba.ai_cards_enabled` | ORG | bool | true | `ORG_ADMIN` | no |
| `ntf.user.channels` | USER | json class→channels | catalogue defaults | user | no |
| `ntf.user.digest_time` | USER | time | 08:30 local | user | no |
| `ntf.quiet_hours` | USER | range | 21:00–08:00 | user | no |
| `ntf.org.routing` | ORG | json | — | `ORG_ADMIN` | yes |
| `ntf.org.allow_quiet_hours_bypass` | ORG | bool | true | `ORG_ADMIN` | yes |
| `cst.branding.*` | ORG | brand pack layer | product default | `ORG_ADMIN` | no (contrast guard enforces) |
| `cst.terminology.map` | ORG | json term→label | `{}` | `ORG_ADMIN` | no |
| `cst.nav.hidden` / `cst.nav.order` / `cst.nav.default_by_role` | ORG | json | — | `ORG_ADMIN` | no |
| `cst.dashboards.role_defaults` | ORG | json | — | `ORG_ADMIN` | no |
| `cst.custom_fields.<record_type>` | ORG | json | `[]` | `ORG_ADMIN` | yes when `pii_class` ≠ none |
| `hlp.registry.version` | PLATFORM | string | build | pipeline | n/a |
| `hlp.lint.enforce` | PLATFORM | bool | true (locked on `main`) | — | n/a |
| `hlp.vidhi.expand_enabled` | ORG | bool | follows `ai.enabled` | `ORG_ADMIN` | no |
| `hlp.public_glossary.enabled` | PLATFORM/BRAND | bool | true | `PLT_CONTENT_EDITOR` | no |
| `tut.auto_publish` | PLATFORM | bool | true | `PLT_CONTENT_EDITOR` | yes |
| `tut.staleness_threshold_pct` | PLATFORM | decimal | 2.0 | `PLT_CONTENT_EDITOR` | no |
| `tut.tours.auto_start` | ORG | bool | true | `ORG_ADMIN` | no |
| `tut.tours.max_steps` | PLATFORM | int | 7 (ceiling) | — | n/a |
| `tut.whats_new.min_level` | ORG | enum `major\|minor\|patch` | `minor` | `ORG_ADMIN` | no |
| `tut.progress` | USER | json | `{}` | system | n/a |
| `tut.review_by_months` | PLATFORM | json `{default:12, regulatory:6}` | as shown | `PLT_CONTENT_EDITOR` | yes |
| `tut.social_clips.enabled` | PLATFORM | bool | true | `PLT_CONTENT_EDITOR` | no |
| `fb.article_feedback.flag_threshold` | PLATFORM | json `{min_votes:50, helpful_pct:60}` | as shown | `PLT_CONTENT_EDITOR` | no |
| `ipb.settings.tree_version` | PLATFORM | string | `1.0` | pipeline | n/a |

## 07.6 Events and error codes

### 07.6.1 Internal events

| Event | Key payload | When |
|---|---|---|
| `in.<product>.settings.SettingChanged.v1` | key, tier, scope_id, old, new, actor, mc_request_id | Any ORG/PLATFORM setting change (USER changes are audited but emit `UserPreferenceChanged`). |
| `in.<product>.settings.UserPreferenceChanged.v1` | user_id, key, old, new | USER tier change. |
| `in.<product>.settings.ScheduledActionCreated.v1` / `Cancelled.v1` / `Executed.v1` | action_id, type, execute_at, actor | Delay-window actions. |
| `in.<product>.ux.ClickBudgetExceeded.v1` | journey_id, budget, measured, step | CI gate (emitted to release record). |
| `in.<product>.ux.PaletteQueryRefused.v1` | user_id, pattern_class | PII refusal (no query text). |
| `in.<product>.ux.BulkActionApplied.v1` | action, count, skipped, undo_until, mc_request_id | Bulk apply. |
| `in.<product>.inbox.ItemCreated.v1` / `ItemResolved.v1` | item_id, type, record_ref | Work Inbox lifecycle. |
| `in.<product>.hlp.GlossaryEntryPublished.v1` / `Deprecated.v1` | key, version, reviewer | Registry change. |
| `in.<product>.hlp.HelpViewed.v1` | key or article key, route, surface (popover/panel/public) | Analytics for content quality (no PII). |
| `in.<product>.hlp.VidhiHelpAnswered.v1` | run_id, query_hash, sources, grounded=true | Vidhi help answer. |
| `in.<product>.tut.TutorialGenerated.v1` / `TutorialStale.v1` / `TutorialPublished.v1` | tutorial_id, rel_id, diff_pct | Pipeline. |
| `in.<product>.tut.TourCompleted.v1` / `TourSkipped.v1` | tour_id, step | Tours. |
| `in.<product>.tut.WhatsNewShown.v1` | rel_id, user_id | Card shown once. |
| `in.<product>.fb.ArticleFeedbackSubmitted.v1` | help_article_key, helpful, fbk_id | Article vote. |
| `in.<product>.ntf.NotificationDigestSent.v1` | user_id, class_counts, channel | Digest. |

### 07.6.2 Proposed Ecosystem events

| Proposed event | Rationale |
|---|---|
| `in.infrabyx.identity.UserPreferencesSynced.v1` | Appearance and notification preferences follow the person across products (with IPB-06's a11y proposal). |
| `in.infrabyx.content.GlossaryEntryPublished.v1` | Shared legal/regulatory terms (for example "Key Facts Statement") are defined once and consumed by all products' registries. |
| `in.infrabyx.eng.ReleaseNotePublished.v1` | Operations Hub release records drive What's new cards and tutorial regeneration in every product. |
| `in.infrabyx.feedback.FeedbackSubmitted.v1` (registered Spec §6.40; the draft `ops.FeedbackItemCreated` is superseded, Spec §6.17) *(rev. 26 Oct 2026)* | Article and UX feedback flow into OH support and content queues. |

### 07.6.3 Error codes

| Code | Meaning | Where |
|---|---|---|
| `IPB-UX-001` | Journey exceeded click budget | CI release gate |
| `IPB-UX-002` | More than one primary action on a route render, or nav exceeds ceiling | CI lint |
| `IPB-UX-003` | Palette query refused: matches a protected identifier pattern | runtime, 400 |
| `IPB-UX-004` | Destructive action attempted without typed confirmation or maker-checker | runtime, 403 |
| `IPB-UX-005` | Scheduled action still inside delay window (cannot execute early) | runtime, 409 |
| `IPB-UX-006` | Bulk action exceeds threshold without confirmation | runtime, 409 |
| `IPB-UX-007` | Setting key not registered in settings tree | runtime, 500 (dev: throw) |
| `IPB-UX-008` | Settings change violates scope precedence (lower tier loosening a security/privacy floor) | runtime, 422 |
| `IPB-UX-009` | Dashboard widget without evidence class | CI lint |
| `IPB-UX-010` | Draft restore conflict (record changed since draft) | runtime, 409 |
| `IPB-HLP-001` | Missing help key or key not in registry | CI lint |
| `IPB-HLP-002` | Plain definition exceeds 40 words | CI lint |
| `IPB-HLP-003` | Entry with LAW citation lacks legal reviewer of record | publish, 422 |
| `IPB-HLP-004` | Attempt to delete a referenced help key | publish, 409 |
| `IPB-HLP-005` | Route without `help_article_key` | CI lint |
| `IPB-HLP-006` | Vidhi help answer blocked: question outside help corpus | runtime, 200 with refusal body |
| `IPB-TUT-001` | Tutorial pipeline attempted against non-demo tenant | pipeline |
| `IPB-TUT-002` | Tutorial stale beyond threshold; publish held | pipeline |
| `IPB-TUT-003` | Tour exceeds 7 steps or targets a regulated-step screen | CI lint |
| `IPB-NTF-001` | Attempt to disable a mandatory notification class | runtime, 422 |
| `IPB-CST-001` | Custom field with PII class created without checker | runtime, 403 |
| `IPB-CST-002` | Terminology override collides with a reserved legal term | runtime, 422 |

## 07.7 Product adoption notes

### LD — LawDocs
Already has an "i" help registry. Align the key format to `hlp.<module>.<term>` with a one-off migration map (old key → new key) and keep old keys as `superseded_by` aliases for one release. Adopt the settings tree order (its current tree groups Billing and Plans together; split per nodes 9–11). Its document-centred screens keep the serif heading font; apply the 75-character reading measure to document previews. Add the Work Inbox (it has tasks and mentions separately), the click-budget gate on its top journeys (create matter, draft from template, send for e-sign), and the palette PII refusal. Dashboards must add evidence-class badges.

### LDC — LawDocsComply
Has an "i" registry with regulatory citations — the richest source; its entries become the seed for the shared `in.infrabyx.content.GlossaryEntryPublished` proposal. Align key format; ensure every LAW-cited entry carries a reviewer of record (backfill via `PLT_LEGAL_REVIEWER`). Compliance calendar and registers are the heaviest tables — adopt `DataTable` saved views and column chooser; bulk status updates need preview + undo; filing confirmations are regulated steps. Mandatory widgets: compliance calendar (`ORG_OWNER`), overdue items (`ORG_ADMIN`), approvals awaiting (`ORG_CHECKER`). Notifications are deadline-driven — regulatory deadline class is mandatory and bypasses quiet hours only on due day.

### EQ — Equator Resolution
Has `help_article_key` per route (contextual panel) but no per-field "i"; add help keys to every field in case filing, hearing scheduling, settlement and award screens, with regulatory references to the Arbitration and Conciliation Act 1996, the Mediation Act 2023 and forum rules **[COUNSEL: confirm provisions to cite per field]**. Parties and witnesses are occasional users — offer simple mode at first login. The hearing room is the one route permitted to exceed the single-primary-action rule (join, raise hand, captions) under a recorded `IPB-DEV` with the alternative of a grouped action bar. Settlement acceptance and award acknowledgement use typed confirmation.

### FBX — Finbyx
Build the help registry from scratch; the error catalogue (hundreds of LOS/LMS validation errors) must be rewritten to the four-part standard with help keys, with RBI references where the error enforces a rule (KFS, cooling-off, penal charges). Dense tables are the core — compact density default for back-office roles, with monospace amounts. Bulk disbursement and bulk collections notices are regulated bulk actions with maker-checker. Mandatory widgets: approvals awaiting, overdue EMIs by bucket (`LEDGER`), limit utilisation. NBA on loan files is rule-based (next document, next approval) — never AI; Vidhi suggestions appear as labelled cards only.

### UDF — Udofin
Build from scratch for borrowers: simple mode and easy-read on by default; one question per screen; the Settings tree for borrowers shows only Profile, Security, Privacy & consents, Accessibility, Appearance, Notifications, Feedback, Tutorials & help, About (others hidden by role, not removed). The lender console inherits the full tree and Finbyx's conventions. KFS, consent and acceptance screens have an "i" on every line item citing the RBI (Digital Lending) Directions 2025 provision. The palette is hidden in the borrower app (no records to search) and present in the lender console with PII refusal.

### OH — Operations Hub
Inbox-first product: the Work Inbox is the landing route for `OPS_*` roles. Keyboard map and compact density default. OH hosts the glossary registry editor, the tutorial pipeline runner, the content queue (stale tutorials, flagged articles, overdue reviews), the release records that drive What's new, and the settings-tree registry for all products. OH's own Settings tree includes the platform-only nodes. Billing and Invoices nodes in OH are the OH8 administration screens rather than a mirror.

## 07.8 Acceptance tests

```gherkin
@IPB-07-AT-01 @ci @clicks
Feature: Click budget release gate
  Scenario: Top journey exceeds its budget
    Given journey "ldc.officer.mark_filing_complete" declares click_budget 3
    And a change adds an intermediate "Choose entity" dialog making completion take 4 clicks
    When the release pipeline runs the click-budget Playwright suite
    Then the gate fails with "IPB-UX-001"
    And the report names the journey, budget 3, measured 4 and the step "Choose entity"
    And the release cannot proceed while ux.click_budget.enforce is true

@IPB-07-AT-02 @ci @hlp
Feature: Missing help key fails CI
  Scenario: Field without a help key
    Given a new form field "GST state code" is added with helpKey "hlp.fbx.gst_state_code"
    And the registry has no published or draft entry for that key
    When hlp-lint runs on the main branch
    Then the build fails with "IPB-HLP-001" naming the file and key
  Scenario: Component without helpKey prop
    Given a <Field> is rendered without helpKey
    Then TypeScript compilation fails and hlp-lint reports "IPB-HLP-001"

@IPB-07-AT-03 @palette @pii
Feature: Command palette refuses protected identifier patterns
  Scenario Outline: Refused patterns
    Given a user opens the command palette
    When the user types "<query>"
    Then the palette shows "Search by name or reference instead" with code "IPB-UX-003"
    And no search request is sent to the server
    And the analytics event records pattern_class "<class>" and no query text
    Examples:
      | query               | class          |
      | 2345 6789 0123      | aadhaar_pattern|
      | ABCDE1234F          | pan_pattern    |
      | 4111 1111 1111 1111 | card_pattern   |
  Scenario: Permission trimming
    Given a user without access to legal entity "Ratnaa" searches "Ratnaa"
    Then no record from that entity appears in the results

@IPB-07-AT-04 @settings
Feature: Settings tree order and names are binding
  Scenario: Product settings navigation
    Given the FBX application is loaded for an ORG_ADMIN
    When the Settings page renders
    Then the visible nodes appear in the order Profile, Security, Privacy & consents, Accessibility, Appearance, Notifications, Customisation, Organisation & people, Billing, Invoices, Plans & subscription, Storage & data, Audit trails, Integrations, AI & Vidhi, Feedback, Tutorials & help, Security & trust, What's new, About
    And each node shows a scope badge of You, Organisation or Platform

@IPB-07-AT-05 @settings
Feature: Unregistered setting key cannot be read
  Scenario: Code reads an unregistered key
    Given code calls settings.get("ux.experimental.foo") and the key is not in settings-tree.yaml
    Then the call throws "IPB-UX-007" in development and the CI registry lint fails

@IPB-07-AT-06 @settings @mc
Feature: Maker-checker on organisation settings
  Scenario: Changing the maker-checker policy
    Given an ORG_ADMIN changes mc.thresholds.disbursement from 500000 to 1000000
    Then a maker-checker request is created with a diff
    And the value remains 500000 until an ORG_CHECKER who is not the maker approves
    And the audit ledger records both the request and the approval in the same transactions as the writes

@IPB-07-AT-07 @confirm
Feature: Typed confirmation and delay window
  Scenario: Deleting a legal entity
    Given an ORG_OWNER chooses Delete on legal entity "Ratnaa Finance Pvt Ltd"
    Then the dialog names 3 affected users and 1,204 records
    And the Schedule deletion button is disabled until the entity name is typed exactly
    When the owner types the name and schedules
    Then a scheduled action with execute_at 24 hours ahead appears in Audit trails › Scheduled actions and in the Work Inbox of checkers
    And attempting to execute it early returns "IPB-UX-005"
    And the owner can cancel it until execute_at

@IPB-07-AT-08 @tables
Feature: Saved views and column chooser
  Scenario: Personal saved view persists
    Given a user hides two columns, sorts by due date and filters status = Overdue in the compliance register
    When the user saves the view as "My overdue" and reloads
    Then the view is listed and restores columns, sort and filter
  Scenario: Shared view
    Given ux.tables.saved_views_shared is true
    When an ORG_ADMIN shares the view with role ORG_MEMBER
    Then members see "My overdue" under Shared views and cannot edit it

@IPB-07-AT-09 @bulk
Feature: Bulk action preview and undo
  Scenario: Bulk tag
    Given a user selects 42 records and chooses Add tag "Q3"
    Then a preview states "Will change 42 records" before applying
    When applied
    Then an undo toast is shown for 10 seconds and undo restores all 42
  Scenario: Regulated bulk action over threshold
    Given a user selects 25 loans and chooses Approve
    Then typed confirmation is required and a maker-checker request is created with "IPB-UX-006" shown if skipped

@IPB-07-AT-10 @inbox
Feature: Unified Work Inbox
  Scenario: Aggregation
    Given the fixture creates a task, an approval, a mention, a Vidhi suggestion and a failed export job for user U
    When U opens /inbox
    Then five items are listed with type badges and the shell badge shows 5
    And the Vidhi suggestion is labelled "AI suggestion" with a source link and a Dismiss action
    And pressing "j", "k" moves selection and "e" opens the selected record with the action focused

@IPB-07-AT-11 @nba
Feature: Deterministic next-best-action on regulated steps
  Scenario: Loan file
    Given a loan file awaiting sanction
    Then the NBA card reads "Send to sanctioning authority" with "Why this?" citing rule "fbx.los.nba.sanction_ready"
    And any Vidhi card on the route is labelled AI and offers only "Open draft" never "Approve"

@IPB-07-AT-12 @design
Feature: One primary action and nav ceiling
  Scenario: Lint
    Given a route render contains two buttons with variant primary
    Then the design lint fails with "IPB-UX-002"
    Given the nav registry has 8 top-level items for LDC
    Then the design lint fails with "IPB-UX-002"

@IPB-07-AT-13 @autosave
Feature: Autosave and draft restore
  Scenario: Reload mid-form
    Given a user fills six fields of a new matter form and the status shows "Saved · <time>"
    When the browser reloads
    Then the form offers "Restore draft from <time>" and does not restore without consent
  Scenario: Conflict
    Given the record was changed by another user since the draft
    Then restoring shows "IPB-UX-010" with a side-by-side of draft and current values

@IPB-07-AT-14 @hlp
Feature: Per-field "i" popover
  Scenario: Keyboard and WCAG 1.4.13
    Given a field "Penal charge rate" with helpKey hlp.fbx.penal_charge_rate carrying an RBI citation
    When the user tabs from the label to the "i" and presses Enter
    Then a popover opens showing the plain definition and a "Regulatory reference" panel naming the instrument, provision and effective date
    And moving the pointer onto the popover keeps it open
    And pressing Escape closes it and returns focus to the "i"
    And the "i" target measures at least 24 by 24 CSS pixels

@IPB-07-AT-15 @hlp
Feature: Legal citation requires reviewer of record
  Scenario: Publishing a cited entry
    Given a PLT_CONTENT_EDITOR submits hlp.ldc.annual_return with a LAW citation and no reviewer_of_record
    Then publish fails with "IPB-HLP-003"
    When a PLT_LEGAL_REVIEWER reviews and the entry is republished
    Then the popover footer shows the reviewer initials and effective date

@IPB-07-AT-16 @hlp @vidhi
Feature: Vidhi expands an "i" without altering it
  Scenario: Ask Vidhi
    Given hlp.vidhi.expand_enabled is true
    When the user selects "Ask Vidhi about this" on hlp.udf.cooling_off_period and asks "Can I cancel on day 4?"
    Then the answer is labelled AI-generated, dated, cites the glossary entry and the RBI Digital Lending Directions 2025 provision
    And the glossary entry is unchanged
    And a VidhiHelpAnswered event records grounded=true

@IPB-07-AT-17 @glossary
Feature: Public glossary excludes internal entries
    Given entries hlp.ldc.compliance_calendar (public) and hlp.oh.product_scope (internal)
    When /glossary is rendered
    Then the first is listed at /glossary/ldc/compliance_calendar and the second is absent

@IPB-07-AT-18 @tutorials
Feature: Tutorial pipeline staleness check
  Scenario: UI change invalidates screenshots
    Given tutorial "ldc.calendar.add_entry" was published with screenshots from release 1.4
    When release 1.5 moves the Add button and the pipeline re-runs
    Then the screenshot diff exceeds 2% and the tutorial status becomes "needs_review" with "IPB-TUT-002"
    And an item appears in the OH content queue
    And the published tutorial is not replaced until reviewed
  Scenario: Non-demo tenant refused
    When the pipeline is pointed at a production tenant
    Then it aborts with "IPB-TUT-001"

@IPB-07-AT-19 @tours
Feature: Tours are short, skippable and never on regulated steps
    Given a tour definition with 8 steps
    Then the lint fails with "IPB-TUT-003"
    Given a tour step targets the e-sign confirmation screen
    Then the lint fails with "IPB-TUT-003"
    Given a user skips a tour at step 3
    Then the tour can be resumed from Help at step 3

@IPB-07-AT-20 @whatsnew
Feature: What's new shown once
    Given release 1.5 is published with two release notes
    When user U logs in
    Then a What's new card appears once with links to the articles
    And on the next login it does not reappear
    Given the tenant sets tut.whats_new.min_level to major
    Then cards for 1.5.1 are not shown

@IPB-07-AT-21 @help
Feature: Contextual help panel per route
    Given route /loans/:id/kfs declares help_article_key help.fbx.kfs.explained
    When the user presses the "?" shell button
    Then the panel shows that article, the route's glossary terms, the route shortcuts and "Report a problem"
    Given a new route is added without help_article_key
    Then hlp-lint fails with "IPB-HLP-005"

@IPB-07-AT-22 @notifications
Feature: Digest-first and quiet hours
    Given user U has quiet hours 21:00–08:00 and digest at 08:30
    When a non-urgent mention arrives at 22:15
    Then no push or email is sent until the 08:30 digest
    When a maker-checker request (urgent, bypass allowed) arrives at 22:15
    Then an immediate notification is sent
    When U tries to disable the "Security" class
    Then the UI shows the class locked and the API returns "IPB-NTF-001"

@IPB-07-AT-23 @errors
Feature: Four-part error standard
    Given the error catalogue entry FBX-KYC-012
    Then it has what_happened, why, what_to_do and help_key fields
    And rendering shows the four parts, an "i" and the reference code
    And the catalogue lint fails for any entry missing a part

@IPB-07-AT-24 @brand
Feature: Tenant branding override within contrast guard
    Given a white-label tenant sets --color-primary #FFD54F
    When the tenant previews
    Then the on-primary text token is computed as a dark colour meeting 4.5:1
    And the four theme previews render before Save is enabled
    Given the tenant sets --color-primary #FFFBEA on white
    Then Save is rejected with "IPB-A11Y-006"

@IPB-07-AT-25 @dashboard
Feature: Evidence class on every number
    Given a widget renders "Overdue filings: 12"
    Then the number carries badge LEDGER and a drill-through to the ledger query
    Given a widget registered without evidence_class
    Then the Storybook rule and CI lint fail with "IPB-UX-009"

@IPB-07-AT-26 @simple
Feature: Simple mode for occasional users
    Given a party in EQ logs in for the first time
    Then simple mode is offered and, when accepted, the nav shows at most 4 items and type renders at 112.5%
    And every journey marked mobile: required remains completable

@IPB-07-AT-27 @customisation
Feature: Tenant customisation without super admin
    Given an ORG_ADMIN with no platform role
    When they change terminology "Matter" to "Case", hide the Reports nav item and add a custom field "Branch code" (pii_class none)
    Then all three take effect immediately for the tenant
    And exports still use "Matter (Case)" and the audit ledger records each change
    When they add a custom field with pii_class "sensitive"
    Then a checker approval is required and "IPB-CST-001" is returned if bypassed
```

## 07.9 Open items

| ID | Item | Owner | Flag (default OFF) |
|---|---|---|---|
| IPB-OI-07-01 | Confirm the DPDP Act section numbers to cite in Privacy & consents (right of access s.11, correction and erasure s.12, grievance s.13, nomination s.14) **[VERIFY]**. | Company Secretary | — |
| IPB-OI-07-02 | Decide whether saved views are shareable across legal entities within a group tenant. | Owner | `flg_views_cross_entity` |
| IPB-OI-07-03 | Choose the social clip renderer (ffmpeg pipeline vs service) and the brand frame templates. | Platform lead / Marketing | `flg_social_clips` |
| IPB-OI-07-04 | Decide whether the Work Inbox also aggregates external items (email, WhatsApp threads) in v1. | Owner | `flg_inbox_external` |
| IPB-OI-07-05 | EQ hearing room `IPB-DEV` for multiple primary actions — approve wording. | EQ product lead | — |
| IPB-OI-07-06 | Shared glossary via Ecosystem event vs per-product registries with imports. | Ecosystem Spec owner | `flg_shared_glossary` |
| IPB-OI-07-07 | Roadmap voting in Feedback node — include or defer. | Owner | `flg_roadmap_votes` |
| IPB-OI-07-08 | Companies Act 2013 record-retention floor citation for LDC Storage & data (s.128(5) eight years) **[VERIFY]**. | Company Secretary | — |
| IPB-OI-07-09 | Verhoeff validation for Aadhaar pattern refusal — confirm it is applied client-side only and never transmitted. | Security officer | — |
| IPB-OI-07-10 | Decide default digest time per product (borrowers may prefer evening). | Product leads | — |
