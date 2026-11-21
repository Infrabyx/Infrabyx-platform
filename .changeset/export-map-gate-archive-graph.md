---
"@infrabyx/export": minor
---

`export-map-gate` (R1-D-263, owner note of 21 Nov 2026): a TypeScript source file of the export package now triggers the gate only when an archive can depend on it, that is, when it is one of `ARCHIVE_ROOTS` (`archive.ts`, `service.ts`, `snapshot.ts`, `maps.ts`, `golden.ts`) or reached from them by relative imports (`archiveModules`). A read-only reader that no archive module imports, such as `pdf-id.ts`, no longer needs the `export:unchanged` label. Maps, the verifier, migrations, a mapped table changed in any migration, and any non-TypeScript file under `src/` trigger as before; a dynamic `import(` in a reached module, or a file that cannot be read, falls back to the old rule (every source file triggers).
