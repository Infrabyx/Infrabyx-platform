---
"@infrabyx/connectors": patch
---

Fix `@infrabyx/connectors/workflow` and `./workflow/worker` failing to load in plain Node ESM
("The requested module '@temporalio/proto' does not provide an export named 'temporal'"). The
CommonJS package is now imported through its default export. No API change.
