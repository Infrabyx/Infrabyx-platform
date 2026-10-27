---
"@infrabyx/export": patch
---

`export-map-gate` triggers only on the export package's source, maps, verifier and migrations, not
on tests, the golden fixture, the README, the changelog or `package.json`, so the version PR no
longer needs a map bump (found at the PL3 gate).
