---
"@infrabyx/ui": minor
---

Design tokens, i18n and server-rendered components for PL5 (IPB-06, IPB-07 §07.4.1). Tokens cover seven product identities in four themes (light, dark and high contrast in light and dark), and every declared pair is checked against its WCAG floor (`@IPB-06-AT-10`). Contrast helpers (`contrastRatio`, `nearestCompliant`) back the brand guard, and stylesheets are built to `dist/tokens/<product>.css` and `dist/styles.css` with no inline styles. `ui/i18n` provides en-IN and hi-IN catalogues, Indian amount grouping from integer paise, `DD MMM YYYY` dates in Asia/Kolkata, and amounts in words. The components are the shell (skip links, header capped at seven items, breadcrumb), the footer, form fields with error summary, a help popover, a live region and notices, the AI label, a data table and chart, and click-to-load media. The package stays private until the PL5 gate.
