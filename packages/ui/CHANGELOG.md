# @infrabyx/ui

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
