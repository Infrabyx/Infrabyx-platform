---
"@infrabyx/a11y": minor
---

The accessibility gate kit for PL5 (IPB-06):

- **Journeys and mapping:** the journey registry schema and `journeys-lint`, which catches uncovered routes, voice journeys without a text twin (`IPB-A11Y-009`, `@IPB-06-AT-07`) and missing AT scripts. `mapping.json` maps the 55 WCAG 2.2 A and AA criteria to EN 301 549, with IS 17802 marked `[VERIFY]`.
- **Release documents:** the 40-item release `checklist.md` and the AT script template.
- **Statement:** `generateStatement` computes conformance from the release record. Status cannot be typed in, and an open P1 or P2 downgrades "Conforms" (`IPB-A11Y-010`, `@IPB-06-AT-19`).
- **Shortcuts and hooks:** `ShortcutRegistry` handles remappable shortcuts with single keys off in text fields (`@IPB-06-AT-14`). The client hooks are `useReducedMotion`, `useTextScale`, `useAnnounce` and `useShortcut`.
- **Gates:** the overlay scan (`IPB-A11Y-003`, `@IPB-06-AT-12`) and the Lighthouse evaluator (`@IPB-06-AT-02`).
- **Playwright helpers:** axe, HTML_CodeSniffer, reflow, text scale, text spacing, skip link, focus visibility and third-party request recording, failing with `IPB-A11Y-004` (`@IPB-06-AT-01`).

The package stays private until the PL5 gate.
