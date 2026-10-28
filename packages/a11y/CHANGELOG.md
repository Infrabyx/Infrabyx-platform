# @infrabyx/a11y

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
