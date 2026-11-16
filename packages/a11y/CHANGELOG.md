# @infrabyx/a11y

## 1.1.6

### Patch Changes

- Updated dependencies [043a348]
- Updated dependencies [043a348]
- Updated dependencies [043a348]
  - @infrabyx/contracts@1.27.0

## 1.1.5

### Patch Changes

- Updated dependencies [0aa0f1d]
  - @infrabyx/contracts@1.26.0

## 1.1.4

### Patch Changes

- Updated dependencies [496180e]
  - @infrabyx/contracts@1.25.0

## 1.1.3

### Patch Changes

- Updated dependencies [e86dedf]
  - @infrabyx/contracts@1.24.0

## 1.1.2

### Patch Changes

- Updated dependencies [67be297]
- Updated dependencies [67be297]
- Updated dependencies [67be297]
  - @infrabyx/contracts@1.23.0

## 1.1.1

### Patch Changes

- Updated dependencies [3c9bb25]
  - @infrabyx/contracts@1.22.0

## 1.1.0

### Minor Changes

- 1dda4b2: Form-layout accessibility lint (PR-LDC-24, M56): `lintForm(layout)` checks a declarative form layout (`FormLayoutSchema`: title, headings, groups, help texts and controls in DOM order) for accessible names, visible labels, unique names (allowed only across groups with distinct legends), error-message association, required marking, positive or negative tabindex, heading order, grouped radio and checkbox sets, autocomplete tokens on personal-data inputs and id references, returning findings with a rule id, the WCAG 2.2 success criterion (`FORM_RULES`), severity, subject id and message in a fixed order; `isValidAutocomplete` and `formControlName` are exported, and `@infrabyx/a11y/playwright` adds `axeFormScan(locator)`, which runs axe on the rendered form only and returns the same finding shape. No new dependency.

### Patch Changes

- Updated dependencies [1dda4b2]
- Updated dependencies [1dda4b2]
  - @infrabyx/contracts@1.21.0

## 1.0.20

### Patch Changes

- Updated dependencies [b8c1f2c]
  - @infrabyx/contracts@1.20.0

## 1.0.19

### Patch Changes

- Updated dependencies [c8b8f88]
- Updated dependencies [c8b8f88]
- Updated dependencies [c8b8f88]
- Updated dependencies [c8b8f88]
- Updated dependencies [c8b8f88]
- Updated dependencies [c8b8f88]
  - @infrabyx/contracts@1.19.0

## 1.0.18

### Patch Changes

- Updated dependencies [9c368c7]
- Updated dependencies [9c368c7]
  - @infrabyx/contracts@1.18.0

## 1.0.17

### Patch Changes

- Updated dependencies [714ad01]
  - @infrabyx/contracts@1.17.0

## 1.0.16

### Patch Changes

- Updated dependencies [b3edda2]
- Updated dependencies [b3edda2]
  - @infrabyx/contracts@1.16.0

## 1.0.15

### Patch Changes

- Updated dependencies [1b99d7a]
- Updated dependencies [c83e9e0]
- Updated dependencies [af2ae98]
- Updated dependencies [c4117e4]
  - @infrabyx/contracts@1.15.0

## 1.0.14

### Patch Changes

- Updated dependencies [97e8524]
- Updated dependencies [92706c4]
- Updated dependencies [4a87754]
- Updated dependencies [d66ffad]
  - @infrabyx/contracts@1.14.0

## 1.0.13

### Patch Changes

- Updated dependencies [cff2a02]
  - @infrabyx/contracts@1.13.0

## 1.0.12

### Patch Changes

- Updated dependencies [63c5ad2]
  - @infrabyx/contracts@1.12.0

## 1.0.11

### Patch Changes

- Updated dependencies [2e3a2d3]
- Updated dependencies [3f20011]
  - @infrabyx/contracts@1.11.0

## 1.0.10

### Patch Changes

- Updated dependencies [138ae44]
  - @infrabyx/contracts@1.10.0

## 1.0.9

### Patch Changes

- Updated dependencies [2b307e0]
  - @infrabyx/contracts@1.9.0

## 1.0.8

### Patch Changes

- Updated dependencies [cd25633]
  - @infrabyx/contracts@1.8.0

## 1.0.7

### Patch Changes

- Updated dependencies [f5622c9]
  - @infrabyx/contracts@1.7.0

## 1.0.6

### Patch Changes

- Updated dependencies [ceabe3b]
  - @infrabyx/contracts@1.6.0

## 1.0.5

### Patch Changes

- Updated dependencies [849b8f9]
  - @infrabyx/contracts@1.5.0

## 1.0.4

### Patch Changes

- Updated dependencies [7e38652]
  - @infrabyx/contracts@1.4.0

## 1.0.3

### Patch Changes

- Updated dependencies [b6058d3]
  - @infrabyx/contracts@1.3.0

## 1.0.2

### Patch Changes

- Updated dependencies [75e9ea4]
  - @infrabyx/contracts@1.2.0

## 1.0.1

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

- 8dfe167: The accessibility gate kit for PL5 (IPB-06):

  - **Journeys and mapping:** the journey registry schema and `journeys-lint`, which catches uncovered routes, voice journeys without a text twin (`IPB-A11Y-009`, `@IPB-06-AT-07`) and missing AT scripts. `mapping.json` maps the 55 WCAG 2.2 A and AA criteria to EN 301 549, with IS 17802 marked `[VERIFY]`.
  - **Release documents:** the 40-item release `checklist.md` and the AT script template.
  - **Statement:** `generateStatement` computes conformance from the release record. Status cannot be typed in, and an open P1 or P2 downgrades "Conforms" (`IPB-A11Y-010`, `@IPB-06-AT-19`).
  - **Shortcuts and hooks:** `ShortcutRegistry` handles remappable shortcuts with single keys off in text fields (`@IPB-06-AT-14`). The client hooks are `useReducedMotion`, `useTextScale`, `useAnnounce` and `useShortcut`.
  - **Gates:** the overlay scan (`IPB-A11Y-003`, `@IPB-06-AT-12`) and the Lighthouse evaluator (`@IPB-06-AT-02`).
  - **Playwright helpers:** axe, HTML_CodeSniffer, reflow, text scale, text spacing, skip link, focus visibility and third-party request recording, failing with `IPB-A11Y-004` (`@IPB-06-AT-01`).

  The package stays private until the PL5 gate.

### Patch Changes

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
