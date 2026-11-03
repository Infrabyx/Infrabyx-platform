---
"@infrabyx/connectors": minor
---

The Digio mandate adapter and NeSL DDE, against stubs and off (owner answer #100; R1-D-62):

- **`digio-mandate`** (`@infrabyx/connectors/payments`: `DigioMandates`, `MemoryMandateKeyStore`): PAYMENTS' `MandateLifecycle` for eNACH and UPI AutoPay. Every registration and cancellation runs `assertMoneyCall`; amounts are integer paise checked back exactly; each idempotency key is claimed before Digio is called; callbacks are read back. Off behind `int.payments.digio_mandate.enabled`.
- **`nesl-dde`** (`@infrabyx/connectors/estamp`: `NeslDde`, `MemoryDdeRecordStore`): ESTAMP's Digital Document Execution methods only; stamp duty is not bought here. Off behind `int.estamp.nesl_dde.enabled`.
