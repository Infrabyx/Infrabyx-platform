---
"@infrabyx/connectors": minor
"@infrabyx/testing": minor
---

DOCGEN `DocxtemplaterDocgen` (adapter `docxtemplater`, regulatory templates item (c), R1-D-314). It fills a product's tagged `.docx` templates in-process from the product's template store, and its `pdf` and `pdfa` go through Gotenberg's LibreOffice route (new `GotenbergDocgen.convertDocx`).

- **Templates:** `{field}` and loops only. Raw-XML tags, inverted sections, dotted names and other syntax are refused.
- **Data:** every field must be bound, else `binding_missing` naming the fields. A loop takes an array of objects and a field takes text, a number or a boolean, else `data_invalid`. Values are escaped, and lookups read own properties only.
- **Template safety:** macros, ActiveX, OLE embeddings, altChunk, external relationships other than https hyperlinks, and INCLUDETEXT, INCLUDEPICTURE, DDE, LINK, IMPORT and DATABASE fields are refused `template_unsafe` by `validateTemplate` and before every render. A template whose bytes are not its referenced SHA-256 is refused `template_changed`.
- **New dependencies:** `docxtemplater` 3.71.1 (MIT) and `pizzip` 3.3.0 (MIT).
- **`testing`:** `docgenTemplateContractCases` and `DOCGEN_HOSTILE_TEMPLATES`.
