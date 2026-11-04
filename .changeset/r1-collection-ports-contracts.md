---
"@infrabyx/contracts": minor
---

The DISBURSEMENT_RAIL product port (IPB-01 §01.4.4.3, ADR-0006), collection half: `DisbursementRailPort` with `presentDebitBatch` (NACH and UPI AutoPay debits against registered mandates; each item a money call checked by `assertDebitBatch`: `assertMoneyCall` per item, integer paise, one key per item, the whole batch refused on any failure; a key presented at most once), `readPresentationResponse` (per-item results with NPCI return codes classed by `NPCI_RETURN_CODES` and `classifyReturnCode`: re-presentable or final, unknown codes final) and `statementLines(range)`; catalogued at tier 1 and listed in `R1_PORTS`. PAYMENTS: optional typed `ReconcileReport.settlementLines` (`SettlementLine`: gross, fees, tax, adjustments and net in integer paise, UTR, date), backwards compatible. No adapter (PR-FBX-34 (1), (2); R1-D-80).
