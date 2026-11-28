---
"@infrabyx/testing": minor
---

`regcalcContractCases(calculator)` and `defineRegcalcSuite` (R1-D-312): the owner's worked examples as named contract cases, with their inputs and stored results (KFS-M01, the RBC Annex illustration, LEND-M01's guarantees, EWS-M01's scores, APP-M01's decisions), for a product or a lender's system to be tested against the same models. A calculator supplies any of `kfsFigures`, `kfsDisclosed`, `dlgMonitor`, `ewsScores` and `applicability`; numbers cross as decimal strings. `REGCALC_ORACLES` and `RBC_ANNEX_LOAN` are exported. No runtime dependency added.
