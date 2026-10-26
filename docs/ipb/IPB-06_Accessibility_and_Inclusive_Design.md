# IPB-06 — Accessibility and Inclusive Design  (Infrabyx Platform Baseline Standard v1.0, 25 October 2026)

> **Status:** Binding for LD, LDC, EQ, FBX, UDF, OH unless a product records an `IPB-DEV` deviation.
> **Related:** IPB-01 (reference stack, shared packages `packages/a11y`, `packages/ui`, `packages/tokens`, `packages/i18n`); IPB-07 (UX system, Settings tree, help system — the Accessibility settings sub-section defined here is mounted at `Settings › Accessibility`); IPB-08 (Trust Centre — the accessibility statement is published there); the IPB file covering the public website, CMS and Brand Studio (alt-text and caption gates in the CMS; contrast guard on brand overrides); Ecosystem Spec v1.2 Part on identity and consent (live-caption consent records); research note `R_Standards_Quick_Reference.md` §D.

## 06.1 Purpose and scope

Every Infrabyx product serves people who cannot see, hear, move or read the way a default UI assumes. Lenders' borrowers in Udofin include first-generation smartphone users and people who read no English. Equator Resolution hearings include parties who are deaf or hard of hearing. LawDocs and LawDocsComply are used by professionals who are blind and work with screen readers all day. Finbyx branch staff work on low-end Android devices in sunlight. Operations Hub staff include people with repetitive-strain injuries who cannot use a mouse for long periods.

Accessibility is also a legal and commercial obligation:

- **[LAW]** Rights of Persons with Disabilities Act 2016, s.40 (Central Government to lay down accessibility standards for, among other things, information and communication technology), s.42 (access to electronic media and ICT), s.46 (service providers to comply with accessibility standards within two years of notification of rules). **[VERIFY: current status of the 2026 enforcement proceedings and the Supreme Court direction in *Rajive Raturi v Union of India* (Nov 2024) that accessibility rules be made mandatory, not merely recommendatory.]**
- **[LAW]** Rights of Persons with Disabilities Rules 2017, Rule 15 (standards of accessibility for ICT; websites to conform to the Guidelines for Indian Government Websites) **[VERIFY: 2023 amendment to Rule 15 and whether IS 17802 is now named as the standard]**.
- **[REC]** IS 17802 Part 1:2021 (Accessibility for ICT products and services — Requirements) and Part 2:2022 (Determination of conformance) are the Indian national standard and are referenced in government and public-sector procurement **[VERIFY: edition years against BIS catalogue]**.
- **[REC]** GIGW 3.0 (Guidelines for Indian Government Websites and Apps) governs any court-facing, government or STQC-certified deployment; it cites WCAG 2.1, ISO 23026 and the RPwD Act. Equator Resolution deployments for courts or MIIs, and LawDocs deployments for government legal departments, must meet it.
- **[REC]** EN 301 549 (V3.2.1, 2021-03) is the harmonised European standard and the basis of the European Accessibility Act (Directive (EU) 2019/882, applicable from 28 June 2025) **[VERIFY: whether a later EN 301 549 version aligned to WCAG 2.2 has been published]**. International tenants of Equator Resolution and LawDocs will ask for conformance against it.
- **[REC]** RBI (Digital Lending) Directions 2025 do not prescribe accessibility, but the Key Facts Statement, cooling-off and grievance-officer disclosures they require must be readable by every borrower, which this file operationalises for Udofin and Finbyx.
- Procurement: NBFCs, banks, listed companies and government bodies increasingly require a conformance report. The accessibility statement auto-generated under this file (§06.4.9) is the artefact we hand them.

This file sets the **floor** (WCAG 2.2 Level AA, every success criterion), adopts three Level AAA criteria where the cost is low, and specifies how each product makes its journeys usable for people with hearing, vision, motor, cognitive and literacy barriers. It covers `apps/public`, `apps/web`, `apps/console`, `apps/delivery`/`apps/ops`, Expo mobile apps, generated documents (PDF, DOCX), emails, WhatsApp templates, IVR/voice flows, video content and video meetings. It does not cover physical premises or printed material.

**Precedence.** A product may tighten any rule here, never loosen it. The LawDocs build already meets most of this file; it aligns naming and tooling. Other products adopt in full.

## 06.2 Definitions

| Term | Meaning |
|---|---|
| **Assistive technology (AT)** | Software or hardware used to access content: screen readers (NVDA, JAWS, VoiceOver, TalkBack, Narrator), screen magnifiers, switch access, voice control, braille displays. |
| **Success criterion (SC)** | A testable WCAG statement, numbered `x.y.z`, with a conformance level A, AA or AAA. |
| **Conformance** | A page or screen satisfies every applicable SC at the claimed level. Partial conformance is not conformance; the statement must say so. |
| **Persona journey** | A named end-to-end task (for example "Borrower completes KYC and e-signs loan agreement") for one of the product's personas, used as the unit of accessibility testing. |
| **Caption** | Synchronised text of spoken audio and meaningful non-speech sound, in WebVTT. "Subtitles" translate speech only; we require captions. |
| **Transcript** | Full text of audio with speaker labels and descriptions of relevant visuals, published as HTML beside the media. |
| **Live caption** | Real-time machine or human captioning of a live meeting or hearing. |
| **Audio description** | Narration of visual content a blind user would otherwise miss. |
| **Indian Sign Language (ISL)** | The sign language used in India; ISLRTC is the national body. An **ISL rendition** is a video with an interpreter signing the content. |
| **Plain-language mode** | An alternative rendering of content at a lower reading level (target: lower-secondary) using the `hlp.` plain definitions of IPB-07. |
| **Easy-read** | Plain language plus icons, short lines and one idea per sentence; used in Udofin. |
| **Accessibility overlay** | A third-party script that claims to make a site accessible by injecting a widget. **Prohibited** (§06.3.7). |
| **Target** | The clickable or tappable region of a control. |
| **Reflow** | Content presented without horizontal scrolling at 320 CSS px width (vertical) or 256 CSS px height (horizontal). |
| **Regulated step** | A step whose completion has legal or financial effect: e-sign, payment, consent, loan acceptance, filing, award acceptance, approval in a maker-checker chain. |
| **Evidence class** | The audit tag on a test result: `AUTO` (axe/Pa11y/Lighthouse), `SCRIPT` (Playwright AT script), `MANUAL` (human tester), `AT-USER` (tester who relies on AT daily). |

## 06.3 Requirements

Tier column: **P** = PLATFORM (shared packages, CI, all products), **T** = TENANT-configurable within guard-rails, **U** = USER preference.

### 06.3.1 Standards floor and governance

| ID | Requirement | Tier | Test |
|---|---|---|---|
| IPB-06-01 | Every web surface, mobile screen, generated document, email and message template conforms to **WCAG 2.2 Level AA** (all Level A and AA success criteria in §06.3.2). Conformance is measured per persona journey and per release. | P | Release gate §06.3.8 passes; statement §06.4.9 shows "Conforms" for every journey. |
| IPB-06-02 | Adopt three Level AAA criteria as baseline: **1.4.6 Contrast (Enhanced)** as a user-selectable theme; **2.4.8 Location** (breadcrumb or equivalent on every page below the top level); **3.1.5 Reading Level** via plain-language mode on every public page and every regulated-step screen. | P | Theme toggles to ≥7:1; breadcrumb present; plain-language toggle present and content differs. |
| IPB-06-03 | Map every WCAG SC to the corresponding IS 17802 Part 1 clause and EN 301 549 clause in `packages/a11y/mapping.json`; the accessibility statement cites all three. **[VERIFY: clause numbers against the purchased IS 17802 text before publication.]** | P | Mapping file has an entry for every SC in §06.3.2; statement renders three columns. |
| IPB-06-04 | Deployments flagged `gov_facing=true` (court, MII, government department) additionally pass the GIGW 3.0 compliance matrix and keep the STQC audit checklist artefacts in the Vendor Assurance Room (IPB-08). | T | GIGW checklist attached to release; STQC readiness report present. |
| IPB-06-05 | Appoint a named **Accessibility Lead** per product (role `PLT_ACCESSIBILITY_LEAD`, a specialisation of `PLT_RELEASE_MANAGER`) who signs off the manual checklist each release; the Company Secretary's office is reviewer of record for the statement. | P | Release record carries lead's sign-off; statement carries reviewer. |
| IPB-06-06 | Accessibility is a definition-of-done item on every user story that touches UI, content or documents. Pull requests touching `apps/*` or `packages/ui` include the "a11y impact" section of the PR template. | P | CI lint rejects PRs with empty a11y section. |

### 06.3.2 WCAG 2.2 Level A and AA success criteria — implementation rule and test method

Every row is binding. "Rule" states how Infrabyx products implement the criterion; "Test" states the method and evidence class. Shared implementation lives in `packages/ui` (components), `packages/a11y` (hooks, lint rules, test harness) and `packages/tokens` (contrast-checked colour tokens).

| SC | Level | Name | Implementation rule | Test method |
|---|---|---|---|---|
| 1.1.1 | A | Non-text Content | Every `<img>`, icon button, chart, CAPTCHA alternative and uploaded media carries alt text or `aria-label`; decorative images use `alt=""`. CMS refuses to publish an image without alt text (`IPB-A11Y-001`). Charts render a data table (§06.3.4). | AUTO axe `image-alt`, `button-name`; SCRIPT: screen reader announces purpose; CMS publish test. |
| 1.2.1 | A | Audio-only and Video-only (Prerecorded) | Audio-only content ships a transcript; video-only content ships a transcript or audio description track. | MANUAL per media item in release; CMS gate. |
| 1.2.2 | A | Captions (Prerecorded) | WebVTT captions in **English and Hindi** mandatory on every video, tutorial and vlog; additional locales optional. CMS refuses publish without both tracks (`IPB-A11Y-002`). | CMS publish test; SCRIPT checks `<track kind="captions" srclang="en">` and `hi`. |
| 1.2.3 | A | Audio Description or Media Alternative (Prerecorded) | Tutorials are produced with narration that describes on-screen action (built into the tutorial pipeline, IPB-07 §07.4.5) so a separate description track is rarely needed; where it is, publish an extended transcript. | MANUAL review of tutorial narration script. |
| 1.2.4 | AA | Captions (Live) | Live captions available in every Infrabyx-hosted video meeting and hearing (§06.3.3). | SCRIPT: caption pane appears within 5 s of enablement; MANUAL accuracy check. |
| 1.2.5 | AA | Audio Description (Prerecorded) | As 1.2.3; narration standard requires that nothing visible-only carries meaning. | MANUAL. |
| 1.3.1 | A | Info and Relationships | Semantic HTML: headings in order, `<label for>`, `<fieldset>/<legend>`, `<table>` with `<th scope>`, lists as lists. No layout tables. Form groups and required markers conveyed programmatically. | AUTO axe `label`, `th-has-data-cells`, `heading-order`; SCRIPT heading tree snapshot. |
| 1.3.2 | A | Meaningful Sequence | DOM order equals visual order; no CSS `order` reordering of interactive content; RTL-safe. | SCRIPT: tab order snapshot equals visual order list in test spec. |
| 1.3.3 | A | Sensory Characteristics | Instructions never rely only on shape, colour, size or position ("click the green button" is banned; use labels). | MANUAL copy review; `packages/a11y` lint flags colour-only words in instruction strings. |
| 1.3.4 | AA | Orientation | No orientation lock on web or mobile except signature capture, which offers both orientations. | SCRIPT: viewport rotate; Expo `orientation: default`. |
| 1.3.5 | AA | Identify Input Purpose | `autocomplete` tokens on name, email, tel, address, postal code, birthday fields; mobile `textContentType`/`autoComplete`. | AUTO axe `autocomplete-valid`; form lint. |
| 1.4.1 | A | Use of Color | Status always has icon + text (success, error, warning, info). Links in body text underlined. Charts use pattern or label in addition to hue. | AUTO `link-in-text-block`; MANUAL on charts. |
| 1.4.2 | A | Audio Control | No autoplay with sound. Media players expose pause/stop/volume. | SCRIPT. |
| 1.4.3 | AA | Contrast (Minimum) | Text ≥4.5:1, large text ≥3:1 in every theme and every tenant brand override (contrast guard, `IPB-A11Y-006`). | AUTO axe `color-contrast` on every theme; token test in `packages/tokens`. |
| 1.4.4 | AA | Resize Text | Text scales 100–200% with browser zoom and with the in-app `a11y.text.scale` setting without loss of content or function. All sizes in `rem`. | SCRIPT at 200%: no clipped text, no overlap, all controls operable. |
| 1.4.5 | AA | Images of Text | No text in images except logos; the CMS flags uploads whose OCR shows >20 words. | CMS gate; MANUAL. |
| 1.4.10 | AA | Reflow | Content reflows at 320 CSS px wide with no two-dimensional scroll; data tables use a responsive pattern (stacked rows or horizontal scroll inside the table with a visible instruction). | SCRIPT viewport 320×256 per route. |
| 1.4.11 | AA | Non-text Contrast | Control boundaries, focus rings, icons and chart marks ≥3:1 against adjacent colour. | Token test; AUTO for borders where supported; MANUAL on charts. |
| 1.4.12 | AA | Text Spacing | Layout survives line-height 1.5, paragraph spacing 2×, letter 0.12 em, word 0.16 em; exposed as `a11y.text.line_spacing`. | SCRIPT injects spacing CSS; no clipping. |
| 1.4.13 | AA | Content on Hover or Focus | Tooltips and "i" popovers are dismissible (Esc), hoverable (pointer can move onto them) and persistent (stay until dismissed). Implemented once in `packages/ui/Popover`. | SCRIPT component test; IPB-07 help button test. |
| 2.1.1 | A | Keyboard | Every function available by keyboard. Custom widgets implement WAI-ARIA Authoring Practices patterns. Drag has a keyboard alternative (2.5.7). | SCRIPT keyboard-only run of every persona journey. |
| 2.1.2 | A | No Keyboard Trap | Modals trap focus intentionally and release on Esc/close; third-party embeds (payment iframes, video) are verified to release focus. | SCRIPT: Tab cycles out of every component. |
| 2.1.4 | A | Character Key Shortcuts | Single-character shortcuts are off by default and only active when a non-text element has focus; all shortcuts remappable (§06.3.5). | SCRIPT: typing in a text field triggers no shortcut. |
| 2.2.1 | A | Timing Adjustable | Session timeouts warn ≥2 minutes before expiry with extend option; users may set `a11y.timeouts.multiplier` up to 10×; OTP windows are regulator-fixed and stated as such with a resend path. | SCRIPT: warning dialog appears; extension works. |
| 2.2.2 | A | Pause, Stop, Hide | Carousels, tickers and auto-updating dashboards have pause; `prefers-reduced-motion` and `a11y.motion.reduced` stop auto-advance. | SCRIPT. |
| 2.3.1 | A | Three Flashes or Below Threshold | No flashing content. Lint bans CSS animations with >3 opacity cycles per second. | Lint. |
| 2.4.1 | A | Bypass Blocks | "Skip to main content" and "Skip to navigation" links first in tab order on every page; landmarks (`main`, `nav`, `aside`, `header`, `footer`). | AUTO `bypass`, `landmark-one-main`, `region`. |
| 2.4.2 | A | Page Titled | `<title>` pattern: `<Page> · <Module> · <Product display name>`; dynamic routes update the title on navigation. | SCRIPT title snapshot per route. |
| 2.4.3 | A | Focus Order | Focus moves to the dialog on open, returns to the trigger on close, moves to the first error on failed submit, moves to the new region after route change. | SCRIPT focus-position assertions. |
| 2.4.4 | A | Link Purpose (In Context) | No "click here"/"read more" without context; `aria-describedby` where visible text is generic. | AUTO `link-name`; lint on link copy. |
| 2.4.5 | AA | Multiple Ways | Navigation menu, command palette (Cmd/Ctrl+K), site map and search on `apps/public`; menu + palette + Work Inbox in apps. | MANUAL per release. |
| 2.4.6 | AA | Headings and Labels | Headings describe the section; labels describe the field; every label has a help key (IPB-07). | MANUAL copy review; help-key lint. |
| 2.4.7 | AA | Focus Visible | 2 px solid focus ring in `--color-focus` with ≥3:1 contrast on both themes; never `outline: none` without replacement; `a11y.focus.enhanced` thickens to 4 px with offset. | Token test; SCRIPT screenshot of focus on every component in Storybook. |
| 2.4.11 | AA | Focus Not Obscured (Minimum) | Sticky headers, cookie banners and chat bubbles never fully cover the focused element; `scroll-padding-top` set to header height. | SCRIPT: focused element bounding box intersects viewport minus sticky regions. |
| 2.5.1 | A | Pointer Gestures | Multipoint and path gestures (pinch, swipe) always have single-pointer alternatives (buttons). | MANUAL on mobile and maps. |
| 2.5.2 | A | Pointer Cancellation | Actions fire on `up`, not `down`; drag can be aborted by Esc or releasing outside. | Component test. |
| 2.5.3 | A | Label in Name | Accessible name starts with the visible label text. | AUTO `label-content-name-mismatch`. |
| 2.5.4 | A | Motion Actuation | Shake/tilt never the only way to act; mobile shake-to-report has a menu item twin. | MANUAL. |
| 2.5.7 | AA | Dragging Movements | Every drag (kanban, reorder, file drop, slider) has a non-drag alternative (move menu, arrow keys, file picker, number input). | SCRIPT per drag component in Storybook. |
| 2.5.8 | AA | Target Size (Minimum) | Every target ≥24×24 CSS px or has 24 px spacing; mobile ≥44×44 pt; inline text links exempt. | AUTO `target-size`; Storybook rule. |
| 3.1.1 | A | Language of Page | `<html lang>` set from the active locale; generated PDFs set document language. | AUTO `html-has-lang`, `html-lang-valid`; PDF/UA check. |
| 3.1.2 | AA | Language of Parts | Mixed-language content (Hindi clause in English form, Latin maxims) wrapped with `lang`. The CMS editor has a "mark language" tool. | MANUAL; lint for Devanagari runs without `lang="hi"`. |
| 3.2.1 | A | On Focus | Focus never triggers navigation or submission. | SCRIPT. |
| 3.2.2 | A | On Input | Changing a select or checkbox never auto-submits or navigates without prior notice; dependent-field updates announced via live region. | SCRIPT. |
| 3.2.3 | AA | Consistent Navigation | Shared `AppShell` from `packages/ui` enforces identical nav order across pages within a product. | Snapshot test. |
| 3.2.4 | AA | Consistent Identification | Icon registry maps one icon to one meaning per product; lint rejects a second icon for the same action. | Lint. |
| 3.2.6 | A | Consistent Help | Help entry point (the "?" menu: help centre, tutorials, feedback, contact grievance officer) at the same position in `AppShell` on every page. | Snapshot test. |
| 3.3.1 | A | Error Identification | Errors identified in text, linked to the field, summarised at top with focus moved there; `aria-invalid` and `aria-describedby`. Error message standard IPB-07 §07.3.1. | SCRIPT invalid submit. |
| 3.3.2 | A | Labels or Instructions | Visible labels always (no placeholder-only); format hints before the field; required marked in text, not only asterisk colour. | AUTO `label`; lint bans placeholder-as-label. |
| 3.3.3 | AA | Error Suggestion | Error text states how to fix (format example, allowed range), never only "invalid". | Copy lint: error strings must have a `fix` segment. |
| 3.3.4 | AA | Error Prevention (Legal, Financial, Data) | Every regulated step shows a review screen listing all entered data with edit links, requires explicit confirmation, and is reversible within the stated window or confirmed by typed confirmation (IPB-07 confirmation standard). | SCRIPT per regulated step. |
| 3.3.7 | A | Redundant Entry | Previously entered data in the same session is auto-filled or offered as a choice (except passwords and re-entry required by regulation, which is labelled). | SCRIPT multi-step forms. |
| 3.3.8 | AA | Accessible Authentication (Minimum) | No cognitive function test as sole factor: passkeys first, password with paste allowed and manager-friendly autocomplete, OTP with autofill (`autocomplete="one-time-code"`, WebOTP on Android); no CAPTCHA puzzles without alternative. | SCRIPT login journey. |
| 4.1.2 | A | Name, Role, Value | Custom components expose role, name, state via ARIA; implemented once in `packages/ui`, tested in Storybook. | AUTO axe `aria-*` rules; SCRIPT accessibility tree snapshot. |
| 4.1.3 | AA | Status Messages | Toasts, autosave indicators, search result counts, progress use `role="status"` or `aria-live="polite"`; errors `role="alert"`. | SCRIPT: live region text asserted. |

Note: 4.1.1 Parsing is obsolete in WCAG 2.2 and is treated as always satisfied; HTML validity is still enforced by lint.

### 06.3.3 Hearing

| ID | Requirement | Tier | Test |
|---|---|---|---|
| IPB-06-07 | Every video, tutorial, vlog and product demo published through the CMS or help centre carries **WebVTT captions in English and Hindi** (1.2.2) and an HTML transcript with speaker labels (`res_` artefact `transcript`). Machine-generated captions are permitted only after human review; the artefact stores `caption_review_by` and date. | P | Publish without both tracks returns `IPB-A11Y-002`; transcript link present. |
| IPB-06-08 | **Live captions** in every Infrabyx-hosted video meeting and hearing (Equator Resolution hearings, LawDocs consultations, Finbyx video-KYC, OH support calls). Captions are **consent-based and ephemeral**: enabling live captions prompts a consent notice to all participants; caption text is rendered client-side and **not stored** unless the hearing record rules of the forum require a transcript, in which case the stored transcript is a separate, consented artefact logged as `in.eq.hearing.TranscriptRecorded.v1`. Live captions route to an India-resident speech-to-text adapter behind `SPEECH_PORT`; the regulated data-class routing rules of IPB-D-06 apply. | P | Enable captions → consent banner; network trace shows no caption persistence; EQ transcript requires explicit consent record. |
| IPB-06-09 | Every audio alert has a **visual and a haptic twin**: incoming call/hearing start, OTP arrival, timer expiry, payment success/failure, new message. Web: visual banner + title-bar flash; mobile: Expo Haptics pattern per alert class + banner. Users may disable sound without losing the other two channels. | P | Alert catalogue test: each alert fires three channels; sound-off still fires two. |
| IPB-06-10 | **Every voice journey has a chat/text twin.** IVR menus, voice-bot collections calls (Finbyx), voice guidance (Udofin) and Vidhi voice interactions have an equivalent text or chat path with the same outcomes, reachable from the same entry point. A voice-only journey is a release blocker. | P | Journey registry: `voice=true` journeys must reference `text_twin_journey_id`. |
| IPB-06-11 | **Indian Sign Language renditions** for the key tutorials of each product (the onboarding path and every regulated-step tutorial), produced by a qualified ISL interpreter, embedded as picture-in-picture with a toggle. Key tutorials are listed in `tut.isl.required_tutorials` per product. | P | Each listed tutorial has an `isl` rendition artefact. |
| IPB-06-12 | **ISL interpreter booking** for hearings and consultations in Equator Resolution and LawDocs: a party or client may request an interpreter when scheduling or at any time ≥48 hours before the session (`a11y.isl.lead_time_hours`, default 48); the system books from the interpreter roster (an `ORG_MEMBER` with skill tag `isl_interpreter` or an external roster connector) and adds the interpreter as a non-party participant with a visible role label. Shorter notice is accepted on best-effort with a clear message (`IPB-A11Y-005`). The request is never visible to the opposing party beyond the interpreter's presence. | T | Request → booking → participant list shows interpreter; opposing party's view shows role only. |
| IPB-06-13 | Phone numbers published for support, grievance officers and nodal officers are accompanied by a text channel (email, chat, WhatsApp) of equal service level. | P | Footer and grievance pages show text channel beside every number. |
| IPB-06-14 | Hearing and meeting UIs show **speaker identification** (name badge on active speaker) and a **raise-hand** text signal, so a deaf participant can follow turn-taking. | P | SCRIPT: active speaker badge updates; raise-hand appears as text and icon. |

### 06.3.4 Vision

| ID | Requirement | Tier | Test |
|---|---|---|---|
| IPB-06-15 | **Screen-reader support matrix**: NVDA + Firefox and NVDA + Chrome (Windows), JAWS + Chrome (Windows), VoiceOver + Safari (macOS, iOS), TalkBack + Chrome (Android). Each persona journey has a **test script** in `packages/a11y/at-scripts/<product>/<journey>.md` listing: steps, expected announcements, expected focus position, pass/fail. Scripts run on every minor release (MANUAL or AT-USER) and on every major release with at least one AT-USER tester per product. | P | Script exists for every journey in the registry; release record stores results. |
| IPB-06-16 | **Themes**: light (default), dark, high-contrast light (≥7:1 text, 1.4.6), high-contrast dark. Themes are token sets in `packages/tokens`; no component hard-codes colour. System preference (`prefers-color-scheme`, `prefers-contrast`) is honoured until the user chooses. | U | Token contrast test across four themes; SCRIPT theme switch persists. |
| IPB-06-17 | **Text scaling** 100–200% in 10% steps via `a11y.text.scale`, applied as root `font-size`; mobile honours Dynamic Type (iOS) and font scale (Android) up to 200% without truncation of labels or clipped buttons. | U | SCRIPT 200%: every persona journey completes. |
| IPB-06-18 | **Reflow** at 320 CSS px (1.4.10) for every route, including data-heavy tables (responsive table pattern from `packages/ui/DataTable`: column chooser retains the first column, others stack or scroll within the table). | P | SCRIPT 320 px per route; no page-level horizontal scroll. |
| IPB-06-19 | **Dyslexia-friendly font option**: `a11y.text.font = default \| lexend \| opendyslexic`, self-hosted (no third-party font CDN on authenticated routes), applied to all UI text; monospace numerals in Finbyx remain. | U | Font switch changes computed `font-family`; fonts served from first-party origin. |
| IPB-06-20 | **Text-to-speech read-aloud** on every content page (help articles, KFS, loan agreement preview, award, policy text) and on long form screens: a "Read aloud" control using the platform speech API or the `SPEECH_PORT` TTS adapter (Indic voices via Sarvam/Bhashini adapter), with play/pause, rate (`a11y.tts.rate`), and current-sentence highlight. | U | Control present on content templates; sentence highlight follows audio. |
| IPB-06-21 | **Focus visible** everywhere (2.4.7) plus enhanced mode (`a11y.focus.enhanced`); the focus ring is a token, not a component property. | P | Storybook focus screenshots for every component. |
| IPB-06-22 | **No accessibility overlays.** Third-party overlay scripts (widget-based "make accessible" products) are banned; CSP and the dependency allow-list block known overlay domains; CI fails on detection (`IPB-A11Y-003`). | P | CI scan of bundle and CSP for overlay signatures. |
| IPB-06-23 | **Alt text mandatory in CMS**: the media library requires alt text (≤125 characters) or an explicit "decorative" flag with reason; Vidhi may draft alt text, a `PLT_CONTENT_EDITOR` must confirm. Alt text is locale-variant. | P | Publish without alt returns `IPB-A11Y-001`; Vidhi draft labelled. |
| IPB-06-24 | **Data tables** use `<th scope>`, `<caption>`, row headers where rows are entities, and expose sort state via `aria-sort`; cell content never depends on colour alone. | P | AUTO + SCRIPT table announcement test. |
| IPB-06-25 | **Charts** ship with (a) a toggle to the underlying data table, (b) a text summary (`aria-describedby`) stating the trend, (c) pattern fills or direct labels so series are distinguishable without hue, and (d) optional **sonification** (pitch-mapped playback) behind `a11y.charts.sonification`, default OFF, flag `flg_a11y_sonification`. | P/U | Chart component test: table toggle, summary present; sonification plays when flag ON. |
| IPB-06-26 | **Generated documents** (PDF/A via `DOCGEN_PORT`) are tagged PDF (PDF/UA-1) with document language, heading structure, alt text on images and reading order; DOCX exports keep styles-based headings. Signed PDFs preserve tags. | P | veraPDF PDF/UA profile passes on template corpus. |
| IPB-06-27 | **Emails and WhatsApp templates**: semantic HTML emails with text alternative, ≥4.5:1 contrast, no image-only content; WhatsApp templates never rely on an image to carry the message. | P | Template lint; MANUAL per template release. |
| IPB-06-28 | **Magnification compatibility**: no content depends on hover alone; at 400% browser zoom the page still reflows (not required by AA but tested). | P | SCRIPT 400% smoke. |

### 06.3.5 Motor and cognitive

| ID | Requirement | Tier | Test |
|---|---|---|---|
| IPB-06-29 | **Full keyboard map** published per product at `Settings › Accessibility › Keyboard shortcuts` and in help (`hlp.a11y.keyboard_map`): global (palette, inbox, help, search), navigation (go to module), list (next/previous/open/select), editor and record actions. Every shortcut uses a modifier or is active only outside text fields (2.1.4). | P | Map page renders from the shortcut registry; registry test ensures no duplicates. |
| IPB-06-30 | **Remappable shortcuts**: users may rebind any shortcut (`a11y.keyboard.remaps`, JSON), disable all single-key shortcuts (`a11y.keyboard.single_key_enabled`, default OFF), and reset to defaults; conflicts with browser/OS shortcuts are warned. | U | Rebind persists and functions; conflict warning shown. |
| IPB-06-31 | **Skip links** (2.4.1): skip to main, skip to navigation, skip to filters on list pages, skip to table on data pages. | P | AUTO + SCRIPT. |
| IPB-06-32 | **Target size** ≥24×24 CSS px web, ≥44×44 pt mobile (2.5.8), enforced in `packages/ui` primitives and Storybook rule; dense tables use row-level targets. | P | Storybook rule; AUTO `target-size`. |
| IPB-06-33 | **Drag alternatives** (2.5.7) for every drag interaction: move-to menu, arrow-key reordering with live announcements, file picker beside drop zone, numeric input beside slider. | P | SCRIPT per drag component. |
| IPB-06-34 | **Reduced motion**: honour `prefers-reduced-motion` and `a11y.motion.reduced`; replace transitions with instant state change; no parallax; no auto-advance. | U | SCRIPT: animation duration 0 when set. |
| IPB-06-35 | **Adjustable timeouts** (2.2.1): `a11y.timeouts.multiplier` 1–10× on session idle timeout and UI timers; regulator-fixed windows (OTP validity, cooling-off) are not extendable and say so with help key; a pending extension never silently discards entered data (autosave, IPB-07). | U | SCRIPT: idle warning at multiplier; data retained after re-auth. |
| IPB-06-36 | **Plain-language / easy-read mode** (`a11y.reading.plain_language`): every public page, help article, error message and regulated-step screen has a plain-language variant drawn from `hlp.<module>.<term>.plain` (IPB-07); easy-read adds icons and one-idea sentences (Udofin default for borrower screens). Legal text itself (contract, KFS) is never altered; the plain variant is a labelled explanation beside it. | U | Toggle changes rendered copy; legal text unchanged; label "Explanation, not the legal text" present. |
| IPB-06-37 | **Consistent help** (3.2.6): "?" menu in the same `AppShell` slot on every page; contextual help panel per route (IPB-07). | P | Snapshot. |
| IPB-06-38 | **Error prevention for legal and financial submissions** (3.3.4): review screen → explicit confirmation → receipt, for e-sign, payment, consent, loan acceptance, filing, award acceptance, approvals; destructive actions follow the IPB-07 typed-confirmation and delay-window standard; a user may cancel within the regulator-permitted window (for example the RBI Digital Lending cooling-off period) from the same screen that confirmed. | P | SCRIPT per regulated step: review, confirm, receipt, cancel path. |
| IPB-06-39 | **Cognitive load limits** (shared with IPB-07): one primary action per screen, ≤7 top-level navigation items, progressive disclosure, no unexpected context change (3.2.1, 3.2.2), consistent terminology from the glossary registry. | P | Design review checklist; IPB-07 gates. |
| IPB-06-40 | **Authentication** (3.3.8): passkeys offered first; password managers never blocked (no `autocomplete="off"` on credentials, paste allowed); OTP autofill; no image/puzzle CAPTCHA without an accessible alternative; account recovery has a human-assisted path through the grievance officer. | P | SCRIPT login; MANUAL recovery. |

### 06.3.6 Low literacy and multilingual (Udofin and Finbyx borrower-facing surfaces especially)

| ID | Requirement | Tier | Test |
|---|---|---|---|
| IPB-06-41 | **Icon + text** on every borrower-facing action; icons from the product's icon registry with one meaning each; never icon-only buttons on Udofin borrower screens. | P | Lint: `IconButton` without visible label banned in `apps/mobile` borrower routes. |
| IPB-06-42 | **Voice guidance** on Udofin borrower journeys: each screen has a "Listen" control that reads the screen's purpose, fields and next action in the user's locale (TTS via `SPEECH_PORT`); voice guidance is never the only path (IPB-06-10). | P | Control present on every borrower screen; text twin exists. |
| IPB-06-43 | **12-locale readiness** via `packages/i18n`: English, Hindi, Bengali, Marathi, Telugu, Tamil, Gujarati, Kannada, Malayalam, Odia, Punjabi, Assamese **[OWNER: confirm the twelve]**. All strings externalised; no concatenated sentences; ICU MessageFormat plurals and gender; locale fallback chain `<locale> → hi → en`. Udofin ships all twelve at launch for borrower journeys; other products ship en + hi and add locales by plan. | P | Pseudo-locale build passes (no hard-coded strings); length expansion 40% survives layout. |
| IPB-06-44 | **Numerals and formats**: Indian digit grouping (₹12,34,567.00) with `Intl.NumberFormat('en-IN')`; dates `DD MMM YYYY` default, user-selectable (Appearance settings, IPB-07); Devanagari numerals optional per locale (`a11y.locale.native_numerals`); amounts also shown in words on regulated steps (KFS, loan acceptance, payments) in the active locale. | U | Snapshot of formatted values per locale; amount-in-words present on regulated screens. |
| IPB-06-45 | **Reading-level target** for borrower copy: lower-secondary; copy lint computes a readability score for English and flags above threshold; Hindi and other locales reviewed by a native reviewer of record (`hlp` registry field). | P | Copy lint report attached to release. |
| IPB-06-46 | **Form simplification**: dropdown-first with sensible defaults, one question per screen on mobile borrower flows, progress indicator with step names, remembered choices (3.3.7). | P | Journey review; SCRIPT redundant-entry test. |
| IPB-06-47 | **Assisted mode**: a borrower may hand the device to a lender's agent or a family member; assisted mode shows the agent's name, requires the borrower's own OTP for regulated steps, and logs `assisted_by` on the audit event. Udofin and Finbyx only. | T | Assisted-mode flag on event; OTP owner is borrower. |

### 06.3.7 Mobile (Expo)

| ID | Requirement | Tier | Test |
|---|---|---|---|
| IPB-06-48 | TalkBack and VoiceOver: every interactive element has `accessibilityLabel`, `accessibilityRole`, `accessibilityState`; grouped elements use `accessible` containers; images have labels or are hidden from AT. | P | Detox/Maestro AT scripts per journey; `eslint-plugin-react-native-a11y` clean. |
| IPB-06-49 | **Dynamic type**: all text uses scalable units; layouts tested at 200% font scale; no fixed-height text containers. | P | Screenshot test matrix at 100/150/200%. |
| IPB-06-50 | **Haptics**: Expo Haptics patterns per alert class (success, warning, error, incoming); user may disable (`a11y.alerts.haptic`). | U | Device test. |
| IPB-06-51 | Minimum target 44×44 pt; bottom navigation ≤5 items with labels always visible; no gesture-only navigation. | P | Lint + MANUAL. |
| IPB-06-52 | Mobile honours OS settings: reduce motion, bold text, increase contrast, screen reader on (adjust timeouts automatically). | P | Device test matrix. |
| IPB-06-53 | Low-end device budget: borrower journeys operable on Android 10, 2 GB RAM, 3G; offline queueing for form entries with clear sync status announced to AT. | P | Performance test on reference device profile. |

### 06.3.8 Engineering gates, testing and release

| ID | Requirement | Tier | Test |
|---|---|---|---|
| IPB-06-54 | **CI gates** on every PR and release: (a) `axe-core` via Playwright on every route in the route registry at light and dark themes with zero violations of `wcag2a`, `wcag2aa`, `wcag22aa` tags; (b) `Pa11y` CI on `apps/public` with WCAG2AA standard, zero errors; (c) Lighthouse accessibility score ≥95 (`a11y.ci.lighthouse_min`) on every public page and the ten most-used app routes; (d) Storybook a11y addon clean for every `packages/ui` component; (e) overlay scan (IPB-06-22); (f) help-key lint (IPB-07). Any failure blocks merge. | P | CI logs; branch protection requires `a11y` check. |
| IPB-06-55 | **Manual checklist per release** (`packages/a11y/checklist.md`, 40 items covering the SCs automation cannot reach: 1.3.3, 2.4.4 copy, 2.4.6, 3.2.x, 3.3.3, media) signed by the Accessibility Lead; stored as release artefact. | P | Release record has checklist with signatures. |
| IPB-06-56 | **Assistive-technology test plan**: per release, the AT matrix (IPB-06-15) × persona journeys; minor releases may sample 30% of journeys plus every changed journey; major releases 100% with at least one AT-USER tester. Results stored with evidence class. | P | Test plan and results in release record. |
| IPB-06-57 | **Accessibility statement auto-generated** from test results per product and per release: standards claimed (WCAG 2.2 AA, IS 17802, EN 301 549; GIGW where `gov_facing`), conformance status per journey, known issues with target dates, AT tested, date, reviewer of record, feedback channel. Published at `/accessibility` on `apps/public` and in the Trust Centre (IPB-08) and registered in the Claims Register. Manual editing of the conformance status is impossible; only the known-issues narrative is editable by `PLT_CONTENT_EDITOR` with `PLT_LEGAL_REVIEWER` check. | P | Statement regenerates on release; status fields read-only in CMS. |
| IPB-06-58 | **Journey registry** (`packages/a11y/journeys.yaml` per product) is the single list of persona journeys, each with route list, regulated steps, voice/text twins, AT scripts and click budget (IPB-07). Adding a route to the app without a journey or marking it `out_of_journey` fails lint. | P | Lint. |
| IPB-06-59 | **Design tokens** carry contrast metadata; `packages/tokens` tests every foreground/background pair declared in a theme and every tenant brand override at creation (`IPB-A11Y-006`). | P | Token test; Brand Studio save test. |
| IPB-06-60 | **Regression**: any accessibility defect reported through the feedback channel becomes an automated test before closure where automatable. | P | Defect record links to test ID. |

### 06.3.9 Accessibility feedback channel and SLA

| ID | Requirement | Tier | Test |
|---|---|---|---|
| IPB-06-61 | Every product exposes an **accessibility feedback channel**: the "?" menu item "Report an accessibility problem", the `/accessibility` page form, an email alias `accessibility@<product domain>`, and a phone/WhatsApp text route. The form asks for page, assistive technology, what happened, what was expected; attachments optional; no CAPTCHA puzzle. It creates an `fbk_` item of type `accessibility` in Operations Hub. | P | Submit → `fbk_` item with type; acknowledgement sent. |
| IPB-06-62 | **SLA** (`a11y.feedback.ack_hours` default 24; `a11y.feedback.workaround_days` default 5; `a11y.feedback.fix_days` default 30 for blocking issues on regulated steps, 90 otherwise). Blocking issue on a regulated step = severity P1 and gets an interim human-assisted path within 1 business day. SLA breaches appear on the OH controls dashboard and in the next accessibility statement. | P | SLA timers on `fbk_` item; breach event emitted. |
| IPB-06-63 | The accessibility statement lists the feedback channel and the escalation route to the grievance officer; complaints under the RPwD Act are routed to the `PLT_GRIEVANCE_OFFICER` with a 30-day resolution target **[VERIFY: statutory timeline, if any, for RPwD grievances against private service providers]**. | P | Statement content test. |

### 06.3.10 Procurement rule for third-party components

| ID | Requirement | Tier | Test |
|---|---|---|---|
| IPB-06-64 | Before adopting any third-party UI library, widget, embed (payment checkout, video player, e-sign widget, map, chatbot, analytics UI) or SaaS surface shown to users, the owner records in the ADR: (a) the vendor's current Accessibility Conformance Report (VPAT 2.5 template or equivalent) **[VERIFY: current VPAT template version]**; (b) our own axe run on the component in Storybook or a sandbox; (c) keyboard operability and screen-reader test; (d) whether it can be replaced behind a port. Components without an ACR and failing (b)–(c) are rejected or wrapped with a remediated adapter and listed as a known issue in the statement. | P | ADR template fields mandatory; dependency allow-list requires `a11y_reviewed=true`. |
| IPB-06-65 | Hosted payment pages (IPB-D-07) are tested with the AT matrix on every gateway adapter; a gateway whose checkout fails keyboard or screen-reader use is not the default adapter for any tenant. | P | AT scripts for checkout per adapter. |
| IPB-06-66 | Contracts with content producers (video, ISL, translation) include deliverable acceptance criteria referencing IPB-06-07 and IPB-06-11. | P | Procurement template clause present. |

## 06.4 Design

### 06.4.1 Shared package layout

```
packages/a11y/
  journeys/<product>.yaml        # journey registry (IPB-06-58)
  at-scripts/<product>/*.md      # screen-reader scripts (IPB-06-15)
  checklist.md                   # manual release checklist (IPB-06-55)
  mapping.json                   # WCAG 2.2 ↔ IS 17802 ↔ EN 301 549 (IPB-06-03)
  lint/                          # eslint + copy lint rules
  playwright/                    # axe runner, reflow, zoom, focus, live-region helpers
  statement/                     # generator for /accessibility (IPB-06-57)
  hooks/                         # useReducedMotion, useTextScale, useAnnounce, useShortcut
packages/tokens/                 # four themes with contrast tests
packages/ui/                     # AppShell, Popover, DataTable, Dialog, Toast, Chart, MediaPlayer, SkipLinks
packages/i18n/                   # locales, ICU messages, formatters
```

### 06.4.2 Accessibility settings sub-section (mounted at `Settings › Accessibility`)

The sub-section is identical across products; products may add rows below, never remove. All keys are USER tier, persisted server-side on the user profile and mirrored to the device (`localStorage`/SecureStore) for pre-login screens. A guest on `apps/public` gets device-only persistence. Changes emit `in.<product>.a11y.AccessibilityPreferenceChanged.v1`.

| Group | Control | Key | Values |
|---|---|---|---|
| Vision | Theme | `a11y.display.theme` | `system \| light \| dark \| hc_light \| hc_dark` |
| Vision | Text size | `a11y.text.scale` | 100–200 (step 10) |
| Vision | Font | `a11y.text.font` | `default \| lexend \| opendyslexic` |
| Vision | Line and paragraph spacing | `a11y.text.line_spacing` | `normal \| relaxed \| loose` |
| Vision | Enhanced focus indicator | `a11y.focus.enhanced` | bool |
| Vision | Large cursor and pointer | `a11y.cursor.large` | bool |
| Vision | Read aloud | `a11y.tts.enabled`, `a11y.tts.rate`, `a11y.tts.voice` | bool; 0.5–2.0; voice id |
| Vision | Chart sonification | `a11y.charts.sonification` | bool (flag-gated) |
| Hearing | Captions on by default | `a11y.captions.enabled` | bool |
| Hearing | Caption language | `a11y.captions.language` | locale |
| Hearing | Caption size and background | `a11y.captions.style` | `small \| medium \| large`, `opaque \| translucent` |
| Hearing | Visual alerts | `a11y.alerts.visual` | bool (default true) |
| Hearing | Haptic alerts | `a11y.alerts.haptic` | bool (default true on mobile) |
| Hearing | Sound alerts | `a11y.alerts.sound` | bool |
| Hearing | Prefer ISL interpreter when available | `a11y.isl.preferred` | bool |
| Motor | Reduce motion | `a11y.motion.reduced` | `system \| on \| off` |
| Motor | Timeout multiplier | `a11y.timeouts.multiplier` | 1–10 |
| Motor | Keyboard shortcuts | `a11y.keyboard.enabled`, `a11y.keyboard.single_key_enabled`, `a11y.keyboard.remaps` | bool; bool; JSON map |
| Motor | Sticky keys hint and shortcut map | link to `hlp.a11y.keyboard_map` | — |
| Cognitive | Plain-language mode | `a11y.reading.plain_language` | bool |
| Cognitive | Easy-read mode (icons, one idea per line) | `a11y.reading.easy_read` | bool (default true on UDF borrower) |
| Cognitive | Simple mode (fewer options; IPB-07) | `a11y.ui.simple_mode` | bool |
| Cognitive | Confirm before leaving unsaved forms | `a11y.forms.confirm_leave` | bool (default true) |
| Language | Native numerals | `a11y.locale.native_numerals` | bool |
| Language | Voice guidance (borrower apps) | `a11y.voice.guidance` | bool |
| — | Reset to defaults | — | action |
| — | Report an accessibility problem | — | link (IPB-06-61) |
| — | Accessibility statement | — | link (IPB-06-57) |

Rule: the sub-section is itself the most-tested screen in the product; every control is reachable with keyboard and screen reader, and changes apply instantly with a live-region announcement ("Text size set to 150 percent").

### 06.4.3 Journey registry schema

```yaml
product: UDF
journeys:
  - id: udf.borrower.kyc_and_sign
    persona: borrower
    title: Complete KYC and sign the loan agreement
    routes: [/onboard/kyc, /onboard/kfs, /onboard/sign, /onboard/receipt]
    regulated_steps: [/onboard/kfs, /onboard/sign]
    voice: true
    text_twin_journey_id: udf.borrower.kyc_and_sign
    click_budget: 3                 # IPB-07
    at_scripts: [talkback.md, voiceover.md]
    isl_tutorial_required: true
    locales_required: all12
```

### 06.4.4 Assistive-technology test script template

Each script: preconditions (device, AT version, browser, theme, text scale); numbered steps; for each step the expected announcement (verbatim pattern), the expected focus position and the pass criterion; a results block with tester, evidence class, date, defects raised. Scripts are Markdown so they can be read aloud by the tester's own screen reader.

### 06.4.5 Live-caption and transcript flow (hearings and meetings)

1. Host or any participant selects "Live captions". A consent notice appears to all participants: who provides the captions (adapter name, India-resident), that caption text is not stored, and how to object. The session proceeds only after the host acknowledges; a participant who objects may leave or ask the host to disable. Consent decisions are logged as consent events (Ecosystem Spec consent part) with purpose `live_captions`.
2. Audio is streamed to `SPEECH_PORT` (adapter chosen by data class and locale; EQ hearings are `CONFIDENTIAL`, so India-resident, zero-retention only). Caption segments are returned to clients and rendered in a resizable pane; nothing is written to storage or logs beyond operational metrics (latency, error counts).
3. If the forum's rules require a hearing transcript (EQ), the host starts "Record transcript" separately; this requires every party's affirmative consent in-session, produces a `doc_` artefact in the case record, and is announced on screen. This is a different consent purpose (`hearing_transcript`) and a different event.
4. Caption adapter failure degrades to a visible "Captions unavailable" banner and offers the text chat as a channel; it never silently stops.

### 06.4.6 Alert channel matrix

| Alert class | Sound | Visual | Haptic (mobile) | Live region |
|---|---|---|---|---|
| Incoming call / hearing start | ring (optional) | full-screen banner + title flash | heavy pattern | assertive |
| OTP received | chime | banner with code autofill offer | light | polite |
| Timer about to expire | tone | countdown banner with extend | medium | assertive |
| Payment or e-sign result | tone | result card with reference | success/error pattern | polite |
| New message / mention | soft | badge + toast | light | polite |
| System error | none | inline error + alert | error pattern | assertive |

### 06.4.7 Chart component contract

`<Chart data= spec= summary= tableToggle sonification?>` renders: the SVG with `role="img"` and `aria-describedby` pointing to the summary; a "View as table" toggle that swaps in a `DataTable` with the same data; direct labels or legend with pattern swatches; a sonification control when the flag and the user preference are both on. Dashboard widgets (IPB-07) must use this component; a widget that bypasses it fails the Storybook rule.

### 06.4.8 CMS gates (shared with the public-website IPB file)

| Gate | Error | Behaviour |
|---|---|---|
| Image without alt or decorative flag | `IPB-A11Y-001` | Publish blocked; Vidhi offers draft alt text; editor confirms. |
| Video without `en` and `hi` WebVTT | `IPB-A11Y-002` | Publish blocked; machine captions can be generated for review; publish allowed after `caption_review_by` set. |
| Video without transcript | `IPB-A11Y-002` | As above. |
| Overlay script in page config | `IPB-A11Y-003` | Save blocked. |
| Heading level skipped in rich text | warning | Editor shown outline; publish allowed with warning logged. |
| Link text generic | warning | Editor prompted. |
| Image contains >20 words of text (OCR) | warning | Editor prompted to use HTML text. |

### 06.4.9 Accessibility statement generator

Input: latest release record (CI results per route, manual checklist, AT test results, open defects with `fbk_` type `accessibility`, journeys). Output: HTML page at `/accessibility` and PDF artefact `res_` for the Trust Centre with sections: scope; standards (WCAG 2.2 AA; IS 17802 Parts 1–2; EN 301 549; GIGW 3.0 where applicable); conformance status table per journey (Conforms / Partially conforms with listed exceptions / Does not conform); assistive technologies tested with versions; known issues and target dates; feedback channel and SLA; date, version, reviewer of record; legal notice (RPwD Act reference). The generator refuses to publish "Conforms" for a journey whose last AT run has an open P1 or P2 defect. The statement is a Claims Register entry (IPB-08); the register links to the evidence set.

### 06.4.10 ISL interpreter booking (EQ, LD)

States: `REQUESTED → MATCHING → BOOKED → CONFIRMED → COMPLETED | CANCELLED | UNFULFILLED`. Roster sources: internal members tagged `isl_interpreter`; external roster via `INTERPRETER_PORT` adapter **[VERIFY: candidate ISL interpreter agencies and whether ISLRTC maintains a referral list]**. Lead time check against `a11y.isl.lead_time_hours`. The booking appears on the session as a participant with role `INTERPRETER`, bound by the same confidentiality undertaking as the platform's neutral; the interpreter's view excludes case documents unless the requesting party shares them. Cost allocation is a product decision (**[OWNER]**: platform-absorbed, party-paid, or plan-included).

## 06.5 Settings keys

| Key | Tier | Type | Default | Who may change | Maker-checker |
|---|---|---|---|---|---|
| `a11y.display.theme` | USER | enum | `system` | user | no |
| `a11y.text.scale` | USER | int 100–200 | 100 | user | no |
| `a11y.text.font` | USER | enum | `default` | user | no |
| `a11y.text.line_spacing` | USER | enum | `normal` | user | no |
| `a11y.focus.enhanced` | USER | bool | false | user | no |
| `a11y.cursor.large` | USER | bool | false | user | no |
| `a11y.tts.enabled` | USER | bool | false | user | no |
| `a11y.tts.rate` | USER | decimal 0.5–2.0 | 1.0 | user | no |
| `a11y.tts.voice` | USER | string | locale default | user | no |
| `a11y.charts.sonification` | USER | bool | false | user (flag `flg_a11y_sonification`) | no |
| `a11y.captions.enabled` | USER | bool | false | user | no |
| `a11y.captions.language` | USER | locale | UI locale | user | no |
| `a11y.captions.style` | USER | json | medium/opaque | user | no |
| `a11y.alerts.visual` | USER | bool | true | user | no |
| `a11y.alerts.haptic` | USER | bool | true (mobile) | user | no |
| `a11y.alerts.sound` | USER | bool | true | user | no |
| `a11y.isl.preferred` | USER | bool | false | user | no |
| `a11y.motion.reduced` | USER | enum | `system` | user | no |
| `a11y.timeouts.multiplier` | USER | int 1–10 | 1 | user | no |
| `a11y.keyboard.enabled` | USER | bool | true | user | no |
| `a11y.keyboard.single_key_enabled` | USER | bool | false | user | no |
| `a11y.keyboard.remaps` | USER | json | `{}` | user | no |
| `a11y.reading.plain_language` | USER | bool | false (UDF borrower: true) | user | no |
| `a11y.reading.easy_read` | USER | bool | false (UDF borrower: true) | user | no |
| `a11y.ui.simple_mode` | USER | bool | false | user | no |
| `a11y.forms.confirm_leave` | USER | bool | true | user | no |
| `a11y.locale.native_numerals` | USER | bool | false | user | no |
| `a11y.voice.guidance` | USER | bool | true (UDF borrower) | user | no |
| `a11y.isl.lead_time_hours` | TENANT | int | 48 | `ORG_ADMIN` | no |
| `a11y.isl.roster_source` | TENANT | enum | `internal` | `ORG_ADMIN` | yes |
| `a11y.live_captions.enabled` | TENANT | bool | true | `ORG_ADMIN` | yes (disabling) |
| `a11y.live_captions.adapter` | PLATFORM | string | india-resident default | `PLT_SUPER_ADMIN` | yes |
| `a11y.gov_facing` | TENANT | bool | false | `PLT_SUPER_ADMIN` on tenant request | yes |
| `a11y.feedback.ack_hours` | PLATFORM | int | 24 | `PLT_SUPER_ADMIN` | yes |
| `a11y.feedback.workaround_days` | PLATFORM | int | 5 | `PLT_SUPER_ADMIN` | yes |
| `a11y.feedback.fix_days` | PLATFORM | json | `{p1:30, other:90}` | `PLT_SUPER_ADMIN` | yes |
| `a11y.ci.lighthouse_min` | PLATFORM | int | 95 | `PLT_RELEASE_MANAGER` | yes (lowering forbidden below 95) |
| `a11y.ci.axe_tags` | PLATFORM | list | `[wcag2a, wcag2aa, wcag22aa]` | `PLT_RELEASE_MANAGER` | yes |
| `a11y.statement.auto_publish` | PLATFORM | bool | true | `PLT_RELEASE_MANAGER` | yes |
| `a11y.statement.reviewer_role` | PLATFORM | role | `PLT_LEGAL_REVIEWER` | `PLT_SUPER_ADMIN` | yes |
| `a11y.locales.required` | PLATFORM/BRAND | list | `[en, hi]` (UDF: all twelve) | `PLT_SUPER_ADMIN` | yes |
| `a11y.at_matrix` | PLATFORM | json | NVDA/JAWS/VoiceOver/TalkBack set | `PLT_RELEASE_MANAGER` | yes |
| `tut.isl.required_tutorials` | PLATFORM | list | per product | `PLT_CONTENT_EDITOR` | yes |

Tenant brand overrides (Brand Studio) are not `a11y.*` keys but are subject to the contrast guard in IPB-06-59 and `IPB-A11Y-006`.

## 06.6 Events and error codes

### 06.6.1 Internal events

| Event | Payload (key fields) | Emitted when |
|---|---|---|
| `in.<product>.a11y.AccessibilityPreferenceChanged.v1` | user_id, key, old, new, surface | User changes any `a11y.*` USER key. |
| `in.<product>.a11y.AccessibilityIssueReported.v1` | fbk_id, route, at_name, severity, journey_id | Feedback item of type `accessibility` created. |
| `in.<product>.a11y.AccessibilityIssueSlaBreached.v1` | fbk_id, sla_type, due_at | SLA timer expires. |
| `in.<product>.a11y.AccessibilityStatementPublished.v1` | rel_id, statement_res_id, conformance_summary | Statement generated and published. |
| `in.<product>.a11y.AssistiveTechTestRunCompleted.v1` | rel_id, journey_id, at_name, result, evidence_class, tester_id | AT script result recorded. |
| `in.<product>.a11y.LiveCaptionsEnabled.v1` | session_id, enabled_by, adapter, consent_event_ids | Live captions turned on (no caption text). |
| `in.<product>.a11y.IslInterpreterRequested.v1` / `Booked.v1` / `Unfulfilled.v1` | session_id, request_id, lead_time_hours, roster_source | Interpreter lifecycle (EQ, LD). |
| `in.<product>.cms.MediaPublishBlocked.v1` | res_id, error_code | CMS gate fired. |
| `in.<product>.brand.ContrastGuardRejected.v1` | brd_id, pair, ratio | Brand override rejected. |

### 06.6.2 Proposed Ecosystem events

| Proposed event | Rationale |
|---|---|
| `in.infrabyx.identity.UserPreferencesSynced.v1` | Carry a user's `a11y.*` preferences across products on shared identity so a blind LawDocs user does not reconfigure LawDocsComply. Payload: preference set, source product. |
| `in.infrabyx.feedback.FeedbackSubmitted.v1` with `category = ACCESSIBILITY` (registered Spec §6.40; the draft `ops.AccessibilityIssueOpened` is superseded, Spec §6.17) *(rev. 26 Oct 2026)* | Route accessibility feedback from any product into Operations Hub support with SLA metadata. |
| `in.infrabyx.trust.VendorAssuranceDocumentPublished.v1` with `category = ACCESSIBILITY_STATEMENT` (registered Spec §6.34; draft `trust.AccessibilityStatementPublished` superseded) *(rev. 26 Oct 2026)* | Allow IPB-08 Trust Centre and Vendor Assurance Room to ingest the statement as a `vad_` document automatically. |

### 06.6.3 Error codes

| Code | Meaning | HTTP | User-facing message pattern |
|---|---|---|---|
| `IPB-A11Y-001` | Media published without alt text or decorative flag | 422 | "This image needs a short description before it can be published. Add alt text or mark it decorative." |
| `IPB-A11Y-002` | Video published without English and Hindi captions or transcript | 422 | "Add English and Hindi captions and a transcript before publishing." |
| `IPB-A11Y-003` | Accessibility overlay script detected | 400 | "Third-party accessibility overlays are not permitted. Remove the script." |
| `IPB-A11Y-004` | Component or route failed the accessibility gate in CI | build | "Accessibility gate failed: <rule> on <route>." |
| `IPB-A11Y-005` | ISL interpreter request inside lead time | 409 | "Requests under 48 hours are best-effort. We will try to find an interpreter and tell you by <time>." |
| `IPB-A11Y-006` | Brand override fails contrast guard | 422 | "This colour pair has contrast <ratio>:1; at least 4.5:1 is required. Try <suggested colour>." |
| `IPB-A11Y-007` | Timeout extension refused for a regulator-fixed window | 409 | "This step must be completed within <n> minutes by regulation. You can request a new code." |
| `IPB-A11Y-008` | Live captions unavailable (adapter failure or disabled by tenant) | 503 | "Captions are unavailable right now. Use the text chat; we have logged the problem." |
| `IPB-A11Y-009` | Voice journey registered without a text twin | build | "Journey <id> has voice=true but no text_twin_journey_id." |
| `IPB-A11Y-010` | Statement generation refused: open P1/P2 defect on a journey marked Conforms | build | "Journey <id> has open defect <fbk_id>; status downgraded to Partially conforms." |

## 06.7 Product adoption notes

### LD — LawDocs
Already the strongest: existing WCAG 2.2 AA work, help registry and keyboard navigation. Actions: move its a11y utilities into `packages/a11y` so others inherit; rename its preference keys to the `a11y.*` scheme (migration map in its decision log); add ISL interpreter booking for consultations (IPB-06-12) and live captions with the consent flow (IPB-06-08); PDF/UA tagging on generated legal documents (IPB-06-26) and on e-sign output; adopt the statement generator in place of its hand-written statement. Its AT scripts become the template for other products.

### LDC — LawDocsComply
Dense compliance dashboards and registers. Priorities: `DataTable` responsive pattern and column chooser at 320 px (IPB-06-18); every compliance chart through the `Chart` contract with data table (IPB-06-25); regulated steps (filing confirmation, board-approval evidence upload) through the 3.3.4 review-confirm-receipt pattern; plain-language variants for regulatory terms via `hlp.` (it already has a registry — align key format, IPB-07). Government or listed-company tenants may need `gov_facing` (IPB-06-04).

### EQ — Equator Resolution
Hearing-centric: live captions with consent and ephemerality (IPB-06-08, §06.4.5); speaker identification and raise-hand (IPB-06-14); ISL interpreter booking (IPB-06-12); separate consented transcript flow; award and settlement acceptance as regulated steps; MII/court deployments require GIGW 3.0 (IPB-06-04) and the STQC artefacts in the Vendor Assurance Room. International parties: statement cites EN 301 549.

### FBX — Finbyx
Branch and back-office users on mixed hardware; borrower-facing surfaces share Udofin's low-literacy rules (§06.3.6) where Finbyx powers a lender's own app. Priorities: keyboard-first data entry with full keyboard map (IPB-06-29); monospace numerals retained under dyslexia fonts (IPB-06-19); loan acceptance, KFS display, repayment and collections flows as regulated steps; voice-bot collections calls require text twins (IPB-06-10); video-KYC with live captions; assisted mode (IPB-06-47); PDF/UA on sanction letters, KFS and statements.

### UDF — Udofin
Highest inclusion bar: all twelve locales at launch for borrower journeys (IPB-06-43); easy-read and plain-language ON by default for borrowers; icon + text everywhere (IPB-06-41); voice guidance with text twin (IPB-06-42); amount in words on KFS and acceptance (IPB-06-44); low-end device budget (IPB-06-53); TalkBack/VoiceOver scripts for every borrower journey; cooling-off cancellation from the confirmation screen (IPB-06-38); assisted mode with borrower-held OTP (IPB-06-47). The RBI Digital Lending Directions 2025 disclosures (KFS, grievance officer, LSP identity) must pass the AT matrix.

### OH — Operations Hub
Internal staff tool but held to the same floor (staff with disabilities; `PLT_AUDITOR_RO` external auditors). Priorities: keyboard map and remapping for high-volume operators (IPB-06-29, -30); Work Inbox and dense tables; receives all `fbk_` accessibility items and runs the SLA (IPB-06-62); hosts the AT test plan results and the statement generator's inputs (release records); support calls with live captions. OH's controls dashboard shows a11y SLA breaches.

## 06.8 Acceptance tests

```gherkin
@IPB-06-AT-01 @ci
Feature: Automated accessibility gate
  Scenario: A route with a WCAG violation blocks the build
    Given a pull request adds a button with no accessible name on route "/settings/privacy"
    When the CI job "a11y" runs axe-core with tags wcag2a, wcag2aa, wcag22aa
    Then the job fails with error "IPB-A11Y-004"
    And the failure names rule "button-name" and route "/settings/privacy"
    And the pull request cannot be merged

@IPB-06-AT-02 @ci
Feature: Lighthouse accessibility threshold
  Scenario: Score below 95 blocks release
    Given the public pricing page scores 92 on Lighthouse accessibility
    When the release pipeline evaluates a11y.ci.lighthouse_min
    Then the release is blocked and the report lists the failing audits

@IPB-06-AT-03 @cms
Feature: Alt text mandatory
  Scenario: Publishing an image without alt text
    Given a content editor uploads "team.jpg" with empty alt text and no decorative flag
    When the editor publishes the page
    Then the publish is rejected with "IPB-A11Y-001"
    And Vidhi offers a draft alt text labelled "AI draft — confirm"
    And the page publishes only after the editor confirms or edits the alt text

@IPB-06-AT-04 @cms
Feature: Captions mandatory
  Scenario: Video without Hindi captions
    Given a tutorial video has an English WebVTT track and no Hindi track
    When the editor publishes it
    Then the publish is rejected with "IPB-A11Y-002"
    When Hindi captions are generated and "caption_review_by" is set by a human reviewer
    Then the publish succeeds and the player exposes tracks "en" and "hi"

@IPB-06-AT-05 @hearing @EQ
Feature: Live captions are consent-based and ephemeral
  Scenario: Enabling captions in a hearing
    Given a hearing with three participants is in progress
    When the host enables live captions
    Then every participant sees a consent notice naming the caption provider and stating captions are not stored
    And a consent event with purpose "live_captions" is recorded for each acknowledgement
    And no caption text is written to any store or log
    And the hearing record contains no transcript unless "Record transcript" is separately consented by all parties

@IPB-06-AT-06 @alerts
Feature: Audio alerts have visual and haptic twins
  Scenario: User has sound off
    Given a mobile user sets a11y.alerts.sound to false
    When an OTP arrives
    Then a visual banner is shown, a light haptic fires and the live region announces "Code received"

@IPB-06-AT-07 @journeys
Feature: Voice journeys need a text twin
  Scenario: Registry lint
    Given journey "fbx.collections.voicebot_reminder" has voice=true and no text_twin_journey_id
    When the registry lint runs
    Then the build fails with "IPB-A11Y-009"

@IPB-06-AT-08 @isl @EQ @LD
Feature: ISL interpreter booking
  Scenario: Request within lead time
    Given a party requests an ISL interpreter 72 hours before a hearing
    When the request is submitted
    Then an interpreter from the roster is booked and appears as participant with role "INTERPRETER"
    And the opposing party sees only the role label, not the requesting party's reason
  Scenario: Request inside lead time
    Given a party requests an ISL interpreter 20 hours before a hearing
    Then the system returns "IPB-A11Y-005" and still attempts a best-effort match

@IPB-06-AT-09 @vision
Feature: Text scaling and reflow
  Scenario Outline: Persona journey completes at scale and width
    Given a11y.text.scale is <scale> and the viewport width is <width> px
    When the Playwright script runs journey "<journey>"
    Then every step completes, no text is clipped and no horizontal page scroll exists
    Examples:
      | scale | width | journey                      |
      | 200   | 1280  | udf.borrower.kyc_and_sign    |
      | 100   | 320   | ldc.officer.file_return      |
      | 200   | 320   | eq.party.accept_settlement   |

@IPB-06-AT-10 @vision
Feature: Four themes meet contrast
  Scenario: Token pairs
    Given the themes light, dark, hc_light and hc_dark
    When the token contrast test runs over every declared foreground/background pair
    Then light and dark pairs are ≥4.5:1 for text and ≥3:1 for non-text
    And hc_light and hc_dark text pairs are ≥7:1

@IPB-06-AT-11 @brand
Feature: Tenant brand override contrast guard
  Scenario: Low-contrast primary colour
    Given a tenant sets --color-primary to #F5D28A on a white background in Brand Studio
    When the tenant saves
    Then the save is rejected with "IPB-A11Y-006" stating the ratio and a suggested nearest compliant colour

@IPB-06-AT-12 @overlay
Feature: No accessibility overlays
  Scenario: Overlay script added
    Given a page config includes a script from a known overlay vendor domain
    When the CI overlay scan runs
    Then the build fails with "IPB-A11Y-003"

@IPB-06-AT-13 @motor
Feature: Drag has an alternative
  Scenario: Reordering with keyboard
    Given a kanban board with three columns
    When a keyboard-only user focuses a card and opens the "Move to" menu
    Then the card can be moved to any column and the live region announces the new position

@IPB-06-AT-14 @motor
Feature: Remappable shortcuts and no single-key triggers in text fields
  Scenario: Typing in a text field
    Given a11y.keyboard.single_key_enabled is false
    When the user types "g" inside a comment field
    Then no navigation shortcut fires
  Scenario: Rebinding
    Given the user rebinds "Open Work Inbox" from Ctrl+I to Ctrl+Shift+W
    Then Ctrl+Shift+W opens the inbox and Ctrl+I does nothing, after reload

@IPB-06-AT-15 @timeouts
Feature: Adjustable timeouts respect regulated windows
  Scenario: Session idle timeout
    Given a11y.timeouts.multiplier is 5 and the base idle timeout is 15 minutes
    Then the idle warning appears at 73 minutes with an "Extend" button
  Scenario: OTP window
    When the user asks to extend the OTP validity
    Then the system returns "IPB-A11Y-007" and offers "Resend code"

@IPB-06-AT-16 @regulated
Feature: Error prevention on legal and financial submissions
  Scenario: Loan acceptance
    Given a borrower has reviewed the KFS
    When the borrower proceeds to accept
    Then a review screen lists every entered value with an Edit link beside each
    And acceptance requires an explicit confirm action
    And the receipt screen shows the cooling-off end time and a "Cancel this loan" action usable until then

@IPB-06-AT-17 @cognitive
Feature: Plain-language mode never alters legal text
  Scenario: Toggle on KFS screen
    Given a11y.reading.plain_language is true
    Then the KFS legal text is byte-identical to the default rendering
    And an "Explanation, not the legal text" panel appears using hlp.*.plain definitions

@IPB-06-AT-18 @at
Feature: Screen-reader scripts per journey
  Scenario: Release record completeness
    Given a major release of LDC
    When the release checklist is evaluated
    Then every journey in the LDC registry has an AT result for NVDA, JAWS, VoiceOver and TalkBack
    And at least one result per product carries evidence class AT-USER

@IPB-06-AT-19 @statement
Feature: Accessibility statement is generated, not written
  Scenario: Open P1 defect
    Given journey "eq.party.join_hearing" has an open P1 accessibility defect
    When the statement is generated for the release
    Then the journey status is "Partially conforms" with the defect listed and a target date
    And the status field is not editable in the CMS
    And the statement is published at /accessibility and registered in the Claims Register

@IPB-06-AT-20 @feedback
Feature: Accessibility feedback SLA
  Scenario: Blocking issue on a regulated step
    Given a user reports that the e-sign button is not reachable by keyboard
    When the report is triaged as P1 on a regulated step
    Then an acknowledgement is sent within 24 hours
    And an interim human-assisted path is offered within 1 business day
    And if no fix ships within 30 days an "AccessibilityIssueSlaBreached" event appears on the OH controls dashboard

@IPB-06-AT-21 @mobile @UDF
Feature: TalkBack borrower journey
  Scenario: KYC with TalkBack at 200% font scale
    Given TalkBack is on and font scale is 200%
    When the borrower completes "udf.borrower.kyc_and_sign" by swipe navigation only
    Then every control is announced with label, role and state and no label is truncated

@IPB-06-AT-22 @i18n @UDF
Feature: Twelve-locale readiness and numerals
    Given the borrower locale is "ta"
    When the KFS renders a loan amount of 1234567
    Then it shows "₹12,34,567.00" and the amount in words in Tamil
    And every string on the screen is externalised (pseudo-locale build shows no untranslated text)

@IPB-06-AT-23 @procurement
Feature: Third-party component procurement rule
  Scenario: Adding a checkout widget
    Given an ADR proposes a new payment checkout widget without an ACR
    When the dependency allow-list check runs
    Then the dependency is rejected until a11y_reviewed=true and the axe and keyboard results are attached
```

## 06.9 Open items

| ID | Item | Owner | Flag (default OFF) |
|---|---|---|---|
| IPB-OI-06-01 | Confirm the twelve launch locales for Udofin and the order of rollout for other products. | Owner | `flg_i18n_locales_extended` |
| IPB-OI-06-02 | Verify IS 17802 Part 1/2 clause numbering for `mapping.json`; purchase the standard text. | Company Secretary | — |
| IPB-OI-06-03 | Confirm current EN 301 549 version and whether a WCAG 2.2-aligned revision is in force for EU tenants. | Accessibility Lead (EQ) | — |
| IPB-OI-06-04 | Decide cost allocation for ISL interpreters (platform, party, plan). | Owner | `flg_isl_booking` |
| IPB-OI-06-05 | Select the India-resident speech-to-text and TTS adapters for `SPEECH_PORT` (Sarvam/Bhashini first; verify zero-retention terms). | Platform lead | `flg_live_captions` |
| IPB-OI-06-06 | Chart sonification library choice and whether it ships in v1. | Platform lead | `flg_a11y_sonification` |
| IPB-OI-06-07 | Verify RPwD Act 2016 enforcement developments (2024 Supreme Court direction; any 2025–26 rules amendment naming IS 17802) and update §06.1 citations. | Company Secretary | — |
| IPB-OI-06-08 | PDF/UA tooling in `DOCGEN_PORT` (Gotenberg tagging capability vs post-processing). | Platform lead | `flg_pdf_ua` |
| IPB-OI-06-09 | Recruit AT-USER testers (contract or partner organisation) for major-release testing. | Accessibility Lead (group) | — |
| IPB-OI-06-10 | Decide whether `a11y.*` preference sync across products uses the proposed Ecosystem event or the shared identity profile. | Ecosystem Spec owner | `flg_a11y_pref_sync` |
