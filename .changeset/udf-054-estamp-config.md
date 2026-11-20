---
"@infrabyx/config": minor
---

PR-UDF-054 (E8; R1-D-245): four new platform settings, all `bool`, default `false`, changed by `PLT_SUPER_ADMIN` under R4. `int.esign.nsdl.enabled` (the NSDL eSign shell, whose request signing is refused until the owner approves it), `int.estamp.shcil.enabled` (SHCIL e-stamp read-back), `int.estamp.digio.enabled` (Digio e-stamp read-back) and `int.estamp.manual_paper.enabled` (physical stamp paper and franking records). No existing key changes; nothing to set for a product that does not use them.
