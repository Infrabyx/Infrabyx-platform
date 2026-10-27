---
"@infrabyx/ui": minor
---

PL5 session 8a: `@infrabyx/ui/studio`, the Studio screens every product mounts (OWNER-QUESTIONS #41): the frame and the Approvals, Brand, Pages and sections, Menus, Footer and contact, Redirects, Media, Claims Register and Preview links screens, with their form handlers and `encodeResult`/`decodeResult` for post-redirect-get. Screens take the package services through structural types and work without JavaScript.

The form primitives gain `SelectField` and `date`/`datetime-local` inputs; optional `error`, `hint` and `defaultValue` accept `undefined`; `DataTable` cells may hold links and buttons.
