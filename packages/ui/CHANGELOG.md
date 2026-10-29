# @infrabyx/ui

## 1.1.9

### Patch Changes

- Updated dependencies [138ae44]
  - @infrabyx/contracts@1.10.0

## 1.1.8

### Patch Changes

- Updated dependencies [2b307e0]
  - @infrabyx/contracts@1.9.0

## 1.1.7

### Patch Changes

- Updated dependencies [cd25633]
  - @infrabyx/contracts@1.8.0

## 1.1.6

### Patch Changes

- Updated dependencies [f5622c9]
  - @infrabyx/contracts@1.7.0

## 1.1.5

### Patch Changes

- Updated dependencies [ceabe3b]
  - @infrabyx/contracts@1.6.0

## 1.1.4

### Patch Changes

- Updated dependencies [849b8f9]
  - @infrabyx/contracts@1.5.0

## 1.1.3

### Patch Changes

- Updated dependencies [7e38652]
  - @infrabyx/contracts@1.4.0

## 1.1.2

### Patch Changes

- Updated dependencies [b6058d3]
  - @infrabyx/contracts@1.3.0

## 1.1.1

### Patch Changes

- Updated dependencies [75e9ea4]
  - @infrabyx/contracts@1.2.0

## 1.1.0

### Minor Changes

- 84e4200: The Studio page editor gains a visual block editor (platform request PR-038, R1-D-02). `ContentEditScreen` takes `blocks: { options, action }`: for a body with blocks it shows each block with its own form (text, numbers, choices, lists of items with a blank row to add and a checkbox to remove, optional groups such as buttons, tables, and rich text written as paragraphs), buttons to move a block up or down or remove it, and a form to add a block of any type at any position. Everything is a plain form post, with no JavaScript. `blockHandlers(cms, options).blocks` applies one operation to the blocks of the current revision and saves the result through `saveDraft`, so the service checks the whole body and voids approvals as before; a post made against an older revision is refused, and the service's field errors land on the field they are about. A block type without a form (tabs) keeps a JSON field, and the whole body stays editable as JSON under "Edit the whole body as JSON". New help keys `hlp.studio.block_*` and `hlp.studio.rich_text` are in the platform registry. Products mount the new action next to `save` (the reference console posts it to `/studio-actions/pages/blocks`).

### Patch Changes

- Updated dependencies [588b509]
  - @infrabyx/contracts@1.1.0

## 1.0.0

### Major Changes

- 9ec9a2c: 1.0.0, the platform baseline release (IPB-14 §14.5 item 1; owner answer #67(4), PL6-D-16). Every `@infrabyx/*` package moves to 1.0.0 together; the public API is unchanged from the 0.x set of the PL6 gate (`docs/phases/PL6-gate.md` §6), so a product upgrades by moving every dependency to 1.0.0 at once. From 1.0.0 on, semantic versioning holds: a breaking change to an export, a migration or a setting is a major release with an ADR (IPB-09-34/35).

### Patch Changes

- Updated dependencies [9ec9a2c]
  - @infrabyx/contracts@1.0.0

## 0.1.0

### Minor Changes

- f1a36a1: Owner answer #52 (PL5-D-05): the accent is a fill only. `buildTheme` keeps a light accent as set (it moves it only when text on it cannot meet the floor), and `DECLARED_PAIRS` no longer contains accent/surface. Components never use `--color-accent` for text, borders, outlines or icon strokes; a unit test enforces it.
- b50922c: PL5 session 8a: `@infrabyx/ui/studio`, the Studio screens every product mounts (OWNER-QUESTIONS #41): the frame and the Approvals, Brand, Pages and sections, Menus, Footer and contact, Redirects, Media, Claims Register and Preview links screens, with their form handlers and `encodeResult`/`decodeResult` for post-redirect-get. Screens take the package services through structural types and work without JavaScript.

  The form primitives gain `SelectField` and `date`/`datetime-local` inputs; optional `error`, `hint` and `defaultValue` accept `undefined`; `DataTable` cells may hold links and buttons.

- 1076df2: PL5 session 8b: the remaining `@infrabyx/ui/studio` screens: Policies (`PoliciesScreen`, `PolicyEditScreen`, `policyHandlers`), Consent texts (`ConsentTextsScreen`, `consentTextHandlers`), the read-only Feedback, Trust documents and Pricing screens, `ResourceVersionsPanel` with `resourceHandlers`, and an `extra` slot on `ContentEditScreen`. `ApprovalsScreen` optionally lists submitted policy versions and consent drafts. `ContentReader.list` takes its filter as optional, like the `cms` service.
- 8dfe167: Design tokens, i18n and server-rendered components for PL5 (IPB-06, IPB-07 §07.4.1). Tokens cover seven product identities in four themes (light, dark and high contrast in light and dark), and every declared pair is checked against its WCAG floor (`@IPB-06-AT-10`). Contrast helpers (`contrastRatio`, `nearestCompliant`) back the brand guard, and stylesheets are built to `dist/tokens/<product>.css` and `dist/styles.css` with no inline styles. `ui/i18n` provides en-IN and hi-IN catalogues, Indian amount grouping from integer paise, `DD MMM YYYY` dates in Asia/Kolkata, and amounts in words. The components are the shell (skip links, header capped at seven items, breadcrumb), the footer, form fields with error summary, a help popover, a live region and notices, the AI label, a data table and chart, and click-to-load media. The package stays private until the PL5 gate.

### Patch Changes

- b7de3c6: PL5 session 7: the base styles hide every element with the `hidden` attribute (`[hidden] { display: none !important; }`), so a component's own `display` rule no longer shows a dismissed banner or a closed panel.
- f1da214: PL5 session 9: every Studio screen takes `sections` (the sections the viewer may open; the menu shows only these), and `StudioPage` accepts it as `undefined` for "all".
- Updated dependencies [de53086]
- Updated dependencies [f1a36a1]
- Updated dependencies [1fecf45]
- Updated dependencies [b0dc390]
- Updated dependencies [686d24b]
- Updated dependencies [e8e83cb]
- Updated dependencies [275d4ba]
- Updated dependencies [36338c3]
- Updated dependencies [934355c]
  - @infrabyx/contracts@0.5.0
