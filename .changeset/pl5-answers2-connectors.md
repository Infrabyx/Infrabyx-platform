---
"@infrabyx/connectors": minor
---

Owner answer #53 (PL5-D-11): `@infrabyx/connectors/media` with the MEDIA reference adapter `SharpMedia` (libvips through `sharp`, under the owner's licence exception for the unmodified `@img/sharp-libvips-*` binaries) and the alternative `PassthroughMedia` (uploads served as uploaded). `sharp` 0.35.5 is an optional peer dependency: install it in the product to re-encode; without it the adapter reports `IPB-PORT-001` (`not_installed`). The package now ships a `NOTICE` naming libvips and its licence.
