---
"@infrabyx/brand": minor
---

Brand packs for PL5 (IPB-04 §04.3.2):

- **Data:** migration `brand/0001_init.sql` (packs, immutable revisions and the group-wide host map).
- **Brand Studio:** maker-checker publish with legal review for legal-class fields, and rollback through a new revision (`@IPB-04-AT-28`). Publish preconditions cover the email identity (`@IPB-04-AT-26`) and the policy set.
- **Contrast guard:** refuses low-contrast colours with a suggested colour (`@IPB-04-AT-23`, `@IPB-06-AT-11`, `@IPB-07-AT-24`).
- **Media:** the allow-list SVG sanitiser (`@IPB-04-AT-21`) and the favicon set and manifest (`@IPB-04-AT-22` at file level).
- **Hosts and names:** host resolution that ignores `X-Forwarded-Host` (`@IPB-04-AT-27`), and display-name terminology (`@IPB-04-AT-25`).

The package stays private until the PL5 gate.
