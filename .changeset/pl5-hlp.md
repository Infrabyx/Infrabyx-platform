---
"@infrabyx/hlp": minor
---

The help system for PL5 (IPB-07 §07.3.4–§07.3.5):

- **Registry:** the glossary entry schema and registry loader, with popover content resolved per locale (falling back to Hindi, then English).
- **Public glossary:** published public entries only (`@IPB-07-AT-17`).
- **`infrabyx-hlp lint`:** reports `IPB-HLP-001` to `004` (`@IPB-07-AT-02`, `@IPB-07-AT-15`). It collects keys from components, the settings tree, the error catalogue and the notification catalogue.
- **Tours:** at most seven steps, never on a regulated step, resumable where skipped (`IPB-TUT-003`, `@IPB-07-AT-19`).

The package stays private until the PL5 gate.
