# @infrabyx/regcalc

## 1.0.0

- First release (LawDocsComply LDC-66, Finbyx PR-FBX-58; ADR-0015; plan `docs/phases/R1-regcalc-plan.md`; owner approval R1-D-301; R1-D-305 to R1-D-308, R1-D-311, R1-D-312): pure decimal calculations for the regulated lending figures. `schedule` and `apr` (KFS-M01, the RBC Annex illustration), `kfs`, `dlg`, `ltv` and `microfinance` (LEND-M01), `ews` (EWS-M01) and `applicability` (APP-M01 to APP-M07, with the default packs). Every output cell of the owner's worked examples is reproduced. Runtime dependencies: `decimal.js` 10.6.0 and `zod` only; no `@infrabyx/*` package at runtime.
