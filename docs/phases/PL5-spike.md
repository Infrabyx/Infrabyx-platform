# PL5 spike notes

Session 2, 27 Oct 2026. Questions from the PL5 plan (§14, session 1, moved to session 2 by PL5-D-02 item 4): can the accessibility gates run against the pre-installed Chromium under the production CSP, and do React 19 server components render the shared UI without client code? The decisions that follow from these notes are PL5-D-03.

## Environment

| Item    | Version                                                              |
| ------- | -------------------------------------------------------------------- |
| Node.js | 24.22.1                                                              |
| Browser | Chromium 153.0.8010.12 (Playwright build 1243, `/opt/pw-browsers`)   |
| Driver  | `playwright-core` 1.64.1 (Apache-2.0)                                |
| Engines | `axe-core` 4.14.0 (MPL-2.0), `html_codesniffer` 2.5.1 (BSD-3-Clause) |
| React   | `react` and `react-dom` 19.3.1, `react-dom/server`                   |

## Findings

1. **The driver works with the pre-installed browser.** `playwright-core` 1.64.1 launches the Chromium of Playwright build 1243 with `executablePath`. Navigation to a routed test origin takes about 150 ms. The `a11y` CI job can use the same pattern with the runner's Chromium, so no browser download is needed (the `playwright install` step is not used).
2. **Script tags are blocked by our CSP; evaluation is not.** Under `script-src 'self' 'nonce-…'`, Playwright's `page.addScriptTag({ content })` fails ("Executing inline script violates the following Content Security Policy directive"), and `@axe-core/playwright` uses the same mechanism. `page.evaluate(source)` runs in the page without being subject to the CSP. The helpers therefore inject axe-core and HTML_CodeSniffer through `evaluate`, and every route is scanned with its production CSP in place (no test-only relaxation). `@axe-core/playwright` is not needed.
3. **axe tags.** `a11y.ci.axe_tags` defaults to `wcag2a`, `wcag2aa` and `wcag22aa`. axe tags the criteria added in WCAG 2.1 (1.3.4, 1.3.5, 1.4.10 to 1.4.13, 2.5.3) `wcag21a` and `wcag21aa`, so those rules would not run. The helper adds both tags (a superset, which the key's `tighten: superset` allows) plus four rules IPB-06 §06.3.2 names that axe files under best practice or experimental: `region`, `landmark-one-main`, `heading-order` and `label-content-name-mismatch`. That makes 74 rules. On a sample page with an empty button and an unlabelled input, axe reported `button-name`, `label` and `target-size`.
4. **HTML_CodeSniffer agrees.** With the WCAG2AA standard, the same page gave three errors: `H91.Button.Name`, `H91.InputText.Name` and `F68`. Only messages of type 1 (error) count, as Pa11y counts them. Notices and warnings are not gate failures.
5. **Focus checks need a fixed starting point.** After `blur()`, Chromium keeps the sequential-focus starting point at the last focused element, so the next Tab can leave the page. The helpers place a temporary `tabindex="-1"` element at the top of `body`, focus it, and remove it after the first Tab.
6. **Text scale and spacing without inline styles.** The text-scale check sets the root font size through the CSSOM, and the text-spacing check adds a constructed stylesheet (`adoptedStyleSheets`). Neither is blocked by `style-src 'self'`, and both are undone after the check.
7. **Lighthouse is not installable today.** `lighthouse@13.5.0` resolves `puppeteer-core@25.14.0`. That version has no trust evidence, while earlier versions were published with provenance, so pnpm's `trustPolicy: no-downgrade` refused the install. The package ships a pure evaluator for Lighthouse result files (score floor 95 and the IPB-04 budgets). Running Lighthouse waits for a trusted chain (OWNER-QUESTIONS #51).
8. **INP has no lab value.** A Lighthouse navigation run does not measure Interaction to Next Paint. The evaluator uses `interaction-to-next-paint` when present and otherwise total blocking time as the lab stand-in for the 200 ms budget. Field INP comes from the self-hosted RUM later (IPB-04-91).
9. **React 19 server rendering.** Every `@infrabyx/ui` component renders with `renderToString` and needs no client JavaScript. Native `popover` and `popoverTarget` give the help popover without a script, and `<template>` holds click-to-load embeds until the person asks. React writes some attributes in camel case (`popoverTarget`, `autoComplete`); HTML attribute names are case-insensitive, so the tests compare lower-cased output.
10. **Timing.** On a small page, axe and HTML_CodeSniffer each take well under a second. The whole browser suite (5 tests, including a cold browser launch) takes about 4 seconds, so the route-by-theme matrix of §11 is affordable on every PR.

## Not covered here

The Next.js 16 nonce CSP through `proxy.ts`, and serving the group site with JavaScript disabled, are spiked with `apps/public` in session 7, where Next is added.
