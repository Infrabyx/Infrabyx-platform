# IPB-13 — Claude Artefacts and Collaborative Content  (Infrabyx Platform Baseline Standard v1.0, 25 October 2026)

> **Status:** Binding for LD, LDC, EQ, FBX, UDF, OH unless a product records an `IPB-DEV` deviation. **Every capability in this file is optional — "if feasible". What is binding is the rule set that applies *when* a capability is used: export formats, accessibility, review gates, versioning and storage.**
> **Related:** IPB-03 (Vidhi notebooks → slide outline, mind map, audio overview; SGI labelling), IPB-04 (public website and super-admin studio: CMS, Blog, Resources library), IPB-06 (accessibility), IPB-07 (UX system, help, tutorials, Academy), IPB-08 (Trust Centre, Claims Register, legal review), IPB-09 (engineering governance, decision logs), IPB-12 (ADRs for watchlist adoption), IPB-11 (no secrets in artefacts); Ecosystem Spec v1.2 §13.2 (data classes).
> **Owner decisions applied:** IPB-D-08 (public website with CMS, Blog, Vlog, Resources, Tutorials), IPB-D-11 (visual identity per product), IPB-D-03 (Vidhi), IPB-D-06 (image generation via `IMAGE_GEN_PORT`).

## 13.1 Purpose and scope

Infrabyx builds with Claude and ships products that contain Claude-style collaborative artefacts. This file says where each artefact type is used, (a) in the **build process** and (b) as **in-product features**, and the rules that apply so that artefacts are accessible, reviewed, versioned and stored like any other deliverable.

Artefact types covered: **Claude Docs** (living documents), **Slides** (decks), **Design** (visual mock-ups and prototypes on a canvas), **Code / interactive tools** (HTML, React, small apps), **Mermaid and SVG diagrams**, **Dashboards** (data pages) and **Motion** (animated explainers, short video).

Two principles:

1. **An artefact is a record.** Anything that informs a decision, a screen or a public claim is versioned and stored (docs repo or Resources library), never left only in a chat.
2. **An artefact is content.** It carries the same obligations as any content: accessibility (WCAG 2.2 AA, IS 17802 per IPB-06), Claims Register for public statements, legal review where IPB-08 requires it, SGI labelling for AI-generated media (IPB-03-53), and data-class rules (no `CONFIDENTIAL`+ data in a shared artefact unless the sharing surface is tenant-scoped).

Out of scope: the CMS block model itself (IPB-04), the help-key system (IPB-07), and Vidhi's generation logic (IPB-03).

## 13.2 Definitions

| Term | Meaning |
|---|---|
| **Build artefact** | An artefact created while building a product: phase plans, ADRs, decks, mock-ups, state machines, prototypes, test dashboards. Owner: the build team; stored in the docs repo (`docs/`) or Claude Docs with a repo copy. |
| **Product artefact** | An artefact produced by or inside a product for its users: a Mermaid block in a KB article, a PPTX from a notebook, an exploratory dashboard, an interactive tutorial, an animated explainer. Owner: a tenant or `PLT_CONTENT_EDITOR`; stored as `res_` in the Resources library or the tenant's document store. |
| **Claude Docs** | Living document edited collaboratively; exported to Markdown and PDF for the repo. |
| **Slides** | Deck artefact; exported to PPTX and PDF. |
| **Design** | Canvas mock-up or prototype; exported to PNG/SVG, PDF and (where supported) a design-system token file. |
| **Interactive tool** | HTML/React artefact (calculators, prototypes, quizzes); exported as a self-contained HTML file plus source. |
| **Mermaid / SVG** | Text-defined diagrams (`flowchart`, `sequenceDiagram`, `stateDiagram-v2`, `erDiagram`, `mindmap`, `gantt`, `timeline`) rendered client-side; SVG as the static export. |
| **Dashboard** | A data page for reading, not a form; in-product dashboards read product data through the reporting module. |
| **Motion** | Animated explainer (Lottie, MP4/WebM, animated SVG) with captions and a static fallback. |
| **ADR** | Architecture Decision Record, `docs/decisions/ADR-<area>-<slug>-<yyyy>.md` (format in 13.4.2). |
| **Claims Register** | IPB-08 register of every public factual claim with evidence; any artefact that will be shown outside the group is checked against it. |
| **Tier (requirements)** | `M` mandatory when the capability is used; `S` should; `O` optional. All capabilities themselves are optional. |

## 13.3 Requirements

### 13.3.A General rules (apply to any artefact actually used)

| ID | Requirement | Tier | Test |
|---|---|---|---|
| IPB-13-01 | Every artefact that informs a decision, a screen or a public claim has a stored, versioned copy: build artefacts in `docs/` (Markdown, Mermaid source, exported PDF/PPTX/PNG) with a commit; product artefacts as `res_` in the Resources library or the tenant document store with `version`, `author`, `created_at`, `source_ref`. A chat-only artefact is not a record. | M | Repo and library checks: artefact referenced in an ADR or phase plan exists in `docs/`. |
| IPB-13-02 | Every exported artefact names its format from the allowed set in 13.4.1; proprietary-only formats are not accepted as the sole copy. | M | Export format test. |
| IPB-13-03 | Accessibility: every image, diagram and chart carries alt text (or a long description for complex diagrams); every video and audio has captions and a transcript; every interactive artefact is keyboard-operable with visible focus and passes axe-core with zero critical issues; colour is never the only carrier of meaning; Mermaid diagrams ship with a text equivalent (the Mermaid source counts when exposed, plus a one-paragraph description). | M | axe-core; alt-text presence; caption file presence. |
| IPB-13-04 | AI-generated media (images, audio, video) in any artefact is labelled SGI and carries provenance per IPB-03-53; AI-drafted text in a product artefact shows the Vidhi label. | M | IPB-03-AT-06, IPB-03-AT-10. |
| IPB-13-05 | Data class: build artefacts contain no customer data and no secrets (IPB-11); product artefacts inherit the data class of their sources; a `CONFIDENTIAL`+ artefact is shareable only inside the tenant; external sharing is a locked action for Vidhi (IPB-03-71) and needs `ORG_ADMIN` for humans. | M | Share attempt tests; secret scanner on `docs/`. |
| IPB-13-06 | Review gates before publication outside the group: Claims Register check for every factual statement, legal review (`PLT_LEGAL_REVIEWER`) for pricing, regulatory, comparative or guarantee statements, brand check against the brand pack, accessibility check. The gate record is stored with the artefact (`review jsonb`). | M | Publish without gate record → `IPB-RES-010`. |
| IPB-13-07 | Artefacts never replace the system of record: a deck's numbers come from OH8 or the reporting module with a `source_ref`; a design mock never defines behaviour that the phase file does not state. | M | Source refs present; design review checklist. |
| IPB-13-08 | Fonts, colours and logos follow the product's brand pack (IPB-D-11); contrast ≥ 4.5:1 for text, 3:1 for large text and UI components. | M | Contrast check in export pipeline. |

### 13.3.B Build-process uses

| ID | Requirement | Tier | Test |
|---|---|---|---|
| IPB-13-09 | Phase plans and ADRs are authored as Claude Docs (optional) and committed as Markdown in `docs/phases/` and `docs/decisions/` with the ADR template (13.4.2). The Markdown in the repo is the authoritative copy. | M | ADR lint (required headings). |
| IPB-13-10 | Board, investor and pricing decks are built as Slides from numbers with `source_ref`; exported PPTX and PDF are stored under `docs/decks/<yyyy>/` (internal) or the Resources library (if external); pricing decks pass legal review. | S | Deck has sources slide; review record. |
| IPB-13-11 | UI mock approval: before a new screen is coded, a Design artefact (or Figma frame) is approved by the product lead and checked for WCAG 2.2 AA; the approval link is cited in the implementing PR. Exceptions: trivial CRUD screens that reuse an approved pattern. | S | PR template field "Design approval"; empty requires justification. |
| IPB-13-12 | State machines, sequence diagrams and ER diagrams for every bounded context are Mermaid files committed in `docs/diagrams/<module>/` and rendered in the docs site; the Mermaid is the source; PNG/SVG are generated in CI. | M | Diagram file exists per module; CI render passes. |
| IPB-13-13 | Interactive prototypes for UX tests are HTML/React artefacts with synthetic data only, labelled "PROTOTYPE — synthetic data", stored under `docs/prototypes/`, and never deployed to a product domain. | S | Label present; host check. |
| IPB-13-14 | Test and release dashboards (CI health, eval scores, flag states) are artefact dashboards reading from exported JSON, not from production databases. | O | Data source check. |

### 13.3.C In-product uses

| ID | Requirement | Tier | Test |
|---|---|---|---|
| IPB-13-15 | **Mermaid diagram block** in the CMS, Blog, KB and Tutorials (`cms.block.mermaid`): author writes Mermaid; server validates syntax and size; rendering happens client-side with a sanitised SVG; a static SVG fallback is generated at publish for RSS, email and no-JS; `alt` and a long description are required fields. | O | Block render test; fallback present; alt required. |
| IPB-13-16 | **Slide-outline → PPTX export** from Vidhi notebooks (IPB-03-80) uses `packages/export` with the product's brand theme, speaker notes from the outline, alt text on every image, a sources slide with citations, and the Vidhi label on the title slide. | O | PPTX opens in PowerPoint and LibreOffice; alt text present. |
| IPB-13-17 | **Exploratory dashboards module** (`rpt.dashboards`): tenants compose dashboards from approved metrics (not raw SQL), with permission-scoped data, export to CSV/XLSX/PDF, and alt text or a data table alternative for every chart. Vidhi may propose a dashboard (L1) but cannot share it externally. | O | Metric allow-list test; export test; table alternative. |
| IPB-13-18 | **Interactive tutorials and quizzes** in Academy (`tut.*`): HTML/React artefacts embedded via a sandboxed iframe (`sandbox="allow-scripts"`, no same-origin), scored client-side with results posted to the tutorials module; keyboard-operable; progress saved per user; quizzes are not assessments of professional competence and say so. | O | Sandbox attributes; axe; disclaimer text. |
| IPB-13-19 | **Animated explainers** in Help (`hlp.*`): Motion artefacts ≤ 90 seconds, captions (VTT), transcript, static poster, reduced-motion alternative (static steps), no autoplay with sound. | O | Caption file; `prefers-reduced-motion` test. |
| IPB-13-20 | **Diagram and image generation by Vidhi** for KB and blog drafts is L1 (draft) only; publishing requires `PLT_CONTENT_EDITOR` or tenant editor approval and the SGI label. | M (when used) | IPB-03-AT-10. |

## 13.4 Design

### 13.4.1 Allowed export formats

| Artefact | Primary export | Also | Never as sole copy |
|---|---|---|---|
| Claude Docs | Markdown (`.md`) | PDF/A, DOCX | Proprietary doc link only |
| Slides | PPTX | PDF, PNG per slide | Keynote-only, Google Slides link only |
| Design | PNG + SVG | PDF, tokens JSON | Figma link only |
| Interactive tool | Self-contained HTML + source (TS/TSX) | PDF screenshot pack | Hosted URL only |
| Mermaid / SVG | `.mmd` source | SVG, PNG | Rendered image only |
| Dashboard | JSON definition + data snapshot (CSV) | PDF, XLSX | Live-only view |
| Motion | WebM/MP4 + VTT + poster PNG | Lottie JSON, animated SVG | Video without captions |

### 13.4.2 ADR template (`docs/decisions/ADR-<area>-<slug>-<yyyy>.md`)

```markdown
# ADR-<area>-<slug>-<yyyy> — <Title>
- Status: Proposed | Accepted | Superseded by ADR-… | Rejected
- Date: <yyyy-mm-dd>   - Deciders: <roles/names>   - Products: LD LDC EQ FBX UDF OH
- Related: IPB-nn-xx, fut.<slug>, Ecosystem Spec §n
## Context  (what forces this; cite sources with URLs; mark [VERIFY] where needed)
## Decision (one paragraph, imperative)
## Options considered (table: option | pros | cons | cost)
## Consequences (positive, negative, follow-ups with owners and dates)
## Compliance and risk ([LAW]/[INTERP]/[REC]/[COUNSEL] tags; Claims Register impact)
## Flags and settings changed (key | from | to)
## Diagrams (Mermaid, committed alongside)
```

The `fut.` ADRs of IPB-12 use area `FUT`. Phase plans use `docs/phases/<product>/P<nn>-<slug>.md` with the sections: Goal, Scope, Out of scope, Deliverables, Acceptance (Gherkin tags), Risks, Dependencies, Artefacts (links to decks, designs, diagrams).

### 13.4.3 Build-process artefact flow

```mermaid
flowchart LR
  A[Idea / requirement] --> B[Claude Doc: phase plan or ADR]
  B --> C{Needs a screen?}
  C -->|yes| D[Design artefact → product lead approval → WCAG check]
  C -->|no| E
  D --> E[Mermaid: state/sequence/ER in docs/diagrams]
  E --> F[Code; PR cites Doc, Design approval, diagrams]
  F --> G[Interactive prototype for UX test optional]
  B --> H[Slides for board/investor/pricing — numbers with source_ref]
  H --> I[Claims Register + legal review]
  I --> J[Export PPTX/PDF → docs/decks or Resources library]
  F --> K[Export Doc → docs/ (Markdown authoritative)]
```

### 13.4.4 In-product artefact architecture

| Feature | Module / package | Storage | Rendering | Vidhi role |
|---|---|---|---|---|
| Mermaid block | `packages/cms` block `mermaid` | Block JSON in CMS; SVG fallback as `res_` | Client-side Mermaid with strict sanitiser; server SVG at publish | Drafts diagram from text (L1) |
| Notebook → PPTX | `packages/vidhi/notebooks` + `packages/export` | `res_` PPTX + outline JSON | Download; preview images | Generates outline (L1); export on user click |
| Exploratory dashboards | `rpt.dashboards` (reporting module) | Dashboard definition JSON per tenant; data via metric API | Chart library in `packages/ui` with data-table toggle | Proposes definition (L1) |
| Interactive tutorials | `packages/tut` (Academy) | Artefact bundle as `res_`; scores in `tut.progress` | Sandboxed iframe | Suggests tutorial, summarises progress |
| Animated explainers | `packages/hlp` | `res_` video + VTT + poster | `<video>` with captions; reduced-motion fallback | Drafts script (L1) |
| Diagrams in KB | `packages/cms` | as Mermaid block | as above | L1 draft |

Resources library record (`res_`) fields relevant here: `kind` (`doc`, `deck`, `design`, `tool`, `diagram`, `dashboard`, `motion`, `image`, `audio`), `format`, `version`, `author_id`, `ai_provenance`, `sgi_label`, `alt_text`, `long_description`, `captions_ref`, `transcript_ref`, `review jsonb` (claims, legal, brand, a11y with reviewer and date), `data_class`, `visibility`, `source_ref`.

### 13.4.5 Versioning and storage

- **Build artefacts:** Git is the version system. Claude Docs and Slides are exported on every material change and committed; the commit message references the Doc link. Decks live in `docs/decks/<yyyy>/`, prototypes in `docs/prototypes/`, diagrams in `docs/diagrams/<module>/`, decisions in `docs/decisions/`, phases in `docs/phases/`. Large binaries (> 5 MB) go to the Resources library with a pointer file in the repo.
- **Product artefacts:** the Resources library (IPB-04) stores each version as a new `res_` revision with immutable prior versions; publication state (`draft`, `in_review`, `published`, `retired`); retired artefacts stay downloadable at their old URLs (code changes never alter what customers download, brief §6).
- **Decision log linkage:** every ADR and `DL-FUT-<yyyy>` entry (IPB-12) lists the artefacts it relied on by path or `res_` ID.

### 13.4.6 Per-product recommended uses

| Product | Build process | In-product |
|---|---|---|
| **LD** | ADRs for eSign/stamp adapters; Design approval for the editor and redline screens; Mermaid state machines for document lifecycle and eSign envelope | Mermaid in KB ("how eSign works"); notebook → PPTX for client briefings; explainers for template use; tutorials on redlining |
| **LDC** | Docs for obligation taxonomy; Slides for board-pack format approval; Mermaid for control lifecycle and finding states | Board-pack narrative to PPTX; exploratory dashboards on compliance status; Mermaid regulatory-process diagrams in KB; quizzes for compliance training (Academy) |
| **EQ** | Mermaid case-state machines per scheme; Design approval for hearing room; prototypes for party onboarding UX tests | Mermaid "how the process works" for parties (plain language, Hindi/English); explainers for hearing etiquette; notebook → PPTX for neutral training; no dashboards exposing case merits |
| **FBX** | ADRs for rails and data-source adapters; Mermaid for loan lifecycle, disbursement, collections states; Design approval for maker-checker screens | Exploratory portfolio dashboards (metric allow-list, no PII); Mermaid product-flow diagrams in KB; tutorials for credit officers; KFS explainer motion |
| **UDF** | Design approval for every borrower screen (no dark patterns check); prototypes for onboarding tests; Mermaid for application and cooling-off states | Plain-language explainers (KFS, cooling-off, grievance) with Hindi captions; tutorials ("understanding your statement"); no dashboards for borrowers beyond their own account; Mermaid kept simple |
| **OH** | Slides for investor and pricing decks (legal review); Docs for runbooks and SOPs; Mermaid for OH8 billing states and onboarding | Exploratory dashboards for staff within `product_scope`; KB Mermaid for processes; onboarding tutorials for staff; weekly KPI narrative to PPTX |

## 13.5 Settings keys

| Key | Tier | Type | Default | Who may change | Maker-checker |
|---|---|---|---|---|---|
| `cms.blocks.mermaid.enabled` | PLATFORM / TENANT | bool | false | PLT_CONTENT_EDITOR; ORG_ADMIN | No |
| `cms.blocks.mermaid.max_nodes` | PLATFORM | int | 200 | PLT_RELEASE_MANAGER | No |
| `cms.blocks.mermaid.require_long_description` | PLATFORM | bool | true | PLT_CONTENT_EDITOR | Yes |
| `res.review.claims_required_for_public` | PLATFORM | bool | true | PLT_LEGAL_REVIEWER | Yes |
| `res.review.legal_required_kinds` | PLATFORM | json | ["deck_pricing","deck_investor","comparative"] | PLT_LEGAL_REVIEWER | Yes |
| `res.export.formats_allowed` | PLATFORM | json | per 13.4.1 | PLT_RELEASE_MANAGER | Yes |
| `vidhi.notebooks.pptx_export` | PLAN | bool | false | PLT_SUPER_ADMIN | No |
| `rpt.dashboards.enabled` | PLAN / TENANT | bool | false | ORG_ADMIN | No |
| `rpt.dashboards.metric_allowlist` | PLATFORM | json | seeded | PLT_RELEASE_MANAGER | Yes |
| `rpt.dashboards.external_share` | TENANT | bool | false | ORG_OWNER | Yes |
| `tut.interactive.enabled` | PLATFORM / TENANT | bool | false | PLT_CONTENT_EDITOR; ORG_ADMIN | No |
| `tut.interactive.sandbox_flags` | PLATFORM | string | `allow-scripts` | PLT_SECURITY_OFFICER | Yes |
| `hlp.motion.enabled` | PLATFORM | bool | false | PLT_CONTENT_EDITOR | No |
| `hlp.motion.max_seconds` | PLATFORM | int | 90 | PLT_CONTENT_EDITOR | No |
| `hlp.motion.autoplay` | PLATFORM | bool | false | PLT_CONTENT_EDITOR | No |
| `a11y.artefacts.alt_required` | PLATFORM | bool | true | PLT_CONTENT_EDITOR | Yes |
| `a11y.artefacts.captions_required` | PLATFORM | bool | true | PLT_CONTENT_EDITOR | Yes |
| `eng.docs.adr_required_headings` | PLATFORM | json | per 13.4.2 | PLT_RELEASE_MANAGER | No |

## 13.6 Events and error codes

| Event | When | Payload |
|---|---|---|
| `in.<p>.res.ArtefactVersionCreated.v1` | New `res_` revision | res_id, kind, format, version, author_id, ai_provenance? |
| `in.<p>.res.ArtefactReviewRecorded.v1` | Gate step completed | res_id, gate (claims, legal, brand, a11y), reviewer_id, outcome |
| `in.<p>.res.ArtefactPublished.v1` | State → published | res_id, visibility |
| `in.<p>.res.ArtefactRetired.v1` | State → retired | res_id, replacement_res_id? |
| `in.<p>.cms.MermaidBlockRendered.v1` | Server fallback generated | pg_id, block_id, svg_res_id |
| `in.<p>.vidhi.NotebookExported.v1` | PPTX produced | nbk_id, res_id, slide_count |
| `in.<p>.rpt.DashboardCreated.v1` / `DashboardExported.v1` | Dashboard lifecycle | dashboard_id, metrics[], format |
| `in.<p>.tut.InteractiveCompleted.v1` | Tutorial/quiz finished | tut_id, user_id, score, duration_s |

| Code | Meaning | HTTP |
|---|---|---|
| `IPB-RES-001` | Export format not allowed | 400 |
| `IPB-RES-002` | Alt text or long description missing | 422 |
| `IPB-RES-003` | Captions or transcript missing for media | 422 |
| `IPB-RES-004` | SGI label missing on AI-generated media | 422 |
| `IPB-RES-005` | Data class forbids this sharing scope | 403 |
| `IPB-RES-010` | Publish blocked: review gate incomplete (claims/legal/brand/a11y) | 409 |
| `IPB-RES-011` | Artefact lacks `source_ref` for numeric content | 422 |
| `IPB-CMS-030` | Mermaid syntax invalid or exceeds node limit | 422 |
| `IPB-CMS-031` | Mermaid fallback SVG generation failed | 500 |
| `IPB-RPT-001` | Metric not in allow-list | 403 |
| `IPB-RPT-002` | Dashboard export exceeds row limit | 413 |
| `IPB-TUT-001` | Interactive bundle fails sandbox policy | 422 |
| `IPB-HLP-010` | Motion exceeds max duration or lacks reduced-motion fallback | 422 |

## 13.7 Product adoption notes

### LD — LawDocs
Start with Mermaid in KB and ADRs/diagrams for the eSign and redline bounded contexts. Notebook → PPTX is useful for advocates briefing clients; keep it `vidhi.notebooks.pptx_export` plan-gated. No dashboards in v1.

### LDC — LawDocsComply
Best fit for exploratory dashboards (compliance status by obligation, control, entity) and board-pack to PPTX. Mermaid regulatory-process diagrams in platform notebooks and KB. Quizzes in Academy for compliance training with the "not a competence assessment" disclaimer.

### EQ — Equator Resolution
Use artefacts for party education, not case analytics: plain-language process diagrams and explainers in Hindi and English with captions. Dashboards, if any, show only institutional throughput (counts, durations) and never merits or party identity. Design approval is mandatory for the hearing room because of accessibility obligations to parties.

### FBX — Finbyx
Mermaid state machines for every loan-lifecycle module are mandatory build artefacts (IPB-13-12). Exploratory dashboards use the metric allow-list and never expose borrower PII. Explainers for KFS and maker-checker flows. Design approval includes a maker-checker usability check.

### UDF — Udofin
Every borrower screen needs Design approval with a dark-pattern checklist (RBI (Digital Lending) Directions 2025 **[LAW]**, no dark patterns). Explainers must have Hindi captions and a static alternative. No interactive quizzes that could read as credit assessments. Mermaid diagrams limited to simple flows (≤ 12 nodes) for comprehension on small screens.

### OH — Operations Hub
Owns investor and pricing decks (legal review required), SOP docs, and the staff Academy. Dashboards respect `product_scope` (IPB-D-12). OH stores the group-wide Resources library and the review gate records that the Trust Centre and Claims Register reference.

## 13.8 Acceptance tests

```gherkin
@IPB-13-AT-01
Feature: Artefacts informing decisions are stored and versioned
  Scenario: ADR references a deck
    Given ADR-FUT-passkeys-default-2027 cites docs/decks/2027/passkeys-board.pptx
    Then the file exists in the repo or a pointer file resolves to a res_ id
    And the ADR has all required headings

@IPB-13-AT-02
Feature: Accessibility gate on artefacts
  Scenario: Diagram without long description
    Given an editor adds a Mermaid block with alt text but no long description
    And cms.blocks.mermaid.require_long_description is true
    When the page is published
    Then publish fails with IPB-RES-002

  Scenario: Explainer without captions
    Given a motion artefact uploaded without a VTT file
    When it is attached to a help key
    Then the attachment fails with IPB-RES-003

@IPB-13-AT-03
Feature: Review gate before public publication
  Scenario: Pricing deck without legal review
    Given a deck of kind deck_pricing with claims review done and legal review missing
    When PLT_CONTENT_EDITOR publishes it to the Resources library with visibility public
    Then publish fails with IPB-RES-010 naming the legal gate

@IPB-13-AT-04
Feature: Mermaid block renders safely with fallback
  Scenario: Script injection in Mermaid
    Given a Mermaid block containing a click handler with javascript:
    When rendered
    Then the sanitiser strips the handler and the diagram renders without script execution
    And the server fallback SVG contains no script elements

@IPB-13-AT-05
Feature: Notebook to PPTX export
  Scenario: Export
    Given a tenant notebook with a slide outline of 8 slides including two images
    When the user exports to PPTX
    Then the file opens in LibreOffice without repair
    And every image has alt text
    And the title slide carries the Vidhi label and the last slide lists citations

@IPB-13-AT-06
Feature: Exploratory dashboard respects metric allow-list and permissions
  Scenario: Disallowed metric
    Given a tenant user composes a dashboard with metric "borrower.pan"
    Then creation fails with IPB-RPT-001
  Scenario: Table alternative
    Given a published dashboard with three charts
    Then each chart has a data-table toggle and alt text

@IPB-13-AT-07
Feature: Interactive tutorial sandbox
  Scenario: Bundle requests same-origin
    Given an interactive bundle whose manifest asks for allow-same-origin
    When uploaded
    Then it is rejected with IPB-TUT-001

@IPB-13-AT-08
Feature: Design approval cited in PR
  Scenario: New screen without approval
    Given a PR adds a new route under apps/web with new UI components
    And the PR template field "Design approval" is empty with no justification
    Then the PR check fails
```

## 13.9 Open items

| ID | Open item | Owner | Flag (default OFF) |
|---|---|---|---|
| IPB-OI-13-01 | Decide the canonical collaborative editor for build docs (Claude Docs with repo export vs repo-only Markdown) and the export cadence. **[OWNER]** | PLT_RELEASE_MANAGER | n/a |
| IPB-OI-13-02 | Mermaid sanitiser and renderer version policy (client-side library pinned; server fallback renderer choice). | PLT_SECURITY_OFFICER | `cms.blocks.mermaid.enabled` |
| IPB-OI-13-03 | Exploratory dashboards metric allow-list per product and PII-safe aggregation thresholds (minimum group size). | PLT_DPO | `rpt.dashboards.enabled` |
| IPB-OI-13-04 | Motion production pipeline (Lottie vs video) and Hindi caption workflow. | PLT_CONTENT_EDITOR | `hlp.motion.enabled` |
| IPB-OI-13-05 | Whether Academy quizzes may issue certificates (if yes, wording to avoid implying professional competence). **[COUNSEL]** | PLT_LEGAL_REVIEWER | `tut.certificates.enabled` |
| IPB-OI-13-06 | Design-system token export from Design artefacts into `packages/tokens` (automation feasibility). | Platform architect | `eng.design.token_sync` |
