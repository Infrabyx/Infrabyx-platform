# @infrabyx/a11y

The accessibility gate kit: journey registry and lint, the WCAG 2.2 mapping, the release checklist, the accessibility statement generator, keyboard shortcuts, client hooks, Playwright checks and the overlay scan (IPB-06).

**Specified by:** `docs/ipb/` IPB-06 (§06.3.8 gates, §06.4.1 layout, §06.4.3 registry, §06.4.4 AT scripts, §06.4.9 statement). Its acceptance tests are the `@IPB-06-AT-..` scenarios tagged in `src`.

**Status:** PL5 session 2. The package stays private until the PL5 gate (`docs/phases/PL5-plan.md` §4.3).

## Contents

| Path or import              | Purpose                                                                                                                                                                       |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mapping.json`              | The 55 WCAG 2.2 A and AA criteria mapped to EN 301 549 V3.2.1 clause 9; IS 17802 clauses stay `[VERIFY]` until the standard is bought (OI-06-02)                              |
| `checklist.md`              | The 40 manual checks the Accessibility Lead signs per release (IPB-06-55)                                                                                                     |
| `at-scripts/_template.md`   | The assistive-technology script template (§06.4.4)                                                                                                                            |
| `lintJourneys`              | Registry lint: uncovered routes, voice journeys without a text twin (`IPB-A11Y-009`), regulated steps, missing AT scripts                                                     |
| `generateStatement`         | Computes conformance per journey from the release record; an open P1 or P2 downgrades "Conforms" (`IPB-A11Y-010`)                                                             |
| `ShortcutRegistry`          | Remappable shortcuts; single-character keys are off by default and never fire in text fields (SC 2.1.4)                                                                       |
| `scanText`, `scanPaths`     | Overlay vendor detection (`IPB-A11Y-003`)                                                                                                                                     |
| `evaluateLighthouse`        | Lighthouse result against `a11y.ci.lighthouse_min` (95, never lower) and the IPB-04 budgets                                                                                   |
| `@infrabyx/a11y/playwright` | `axeScan`, `htmlcsScan`, `reflowCheck`, `textScaleCheck`, `textSpacingCheck`, `skipLinkFirst`, `focusVisibleCheck`, `recordThirdPartyRequests`, `assertGate` (`IPB-A11Y-004`) |
| `@infrabyx/a11y/hooks`      | `useReducedMotion`, `useTextScale`, `useAnnounce`, `useShortcut`                                                                                                              |

## CLI

```sh
infrabyx-a11y journeys-lint journeys.yaml --routes routes.txt --at-scripts at-scripts
infrabyx-a11y overlay-scan .next/
infrabyx-a11y statement release-record.json --out accessibility.html
infrabyx-a11y lighthouse lhr-home.json lhr-pricing.json
```

The Playwright helpers inject axe-core and HTML_CodeSniffer through `page.evaluate`, so routes are scanned under the production nonce CSP. `useAnnounce` writes to `LiveRegion` elements with the IDs `ibx-live-polite` and `ibx-live-assertive`.
