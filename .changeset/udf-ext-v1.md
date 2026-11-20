---
"@infrabyx/contracts": minor
"@infrabyx/fakes": minor
"@infrabyx/testing": minor
---

Udofin's `udf_ext` v1 list (PR-UDF-061; R1-D-232), all optional and additive. Products can drop each extension field as they adopt this release (guide §7dn).

`contracts/events`:

- **Offers:** `monthly_instalment_paise` (agrees with a `MONTHLY` `monthly_instalment`), `penal_charges_text` and `kfs_url` (`https`).
- **Product codes:** `PRODUCT_CODE_PATTERN` (`^[A-Z][A-Z0-9_]{1,15}$`, two characters allowed) on `EligibilityCheckRequest` and `ApplicationSubmitted`, beside every code taken before.
- **`ApplicationSubmitted`:** `offer_ref`, `product_code`, `request`, `economic_profile`, `household.monthly_household_income_paise` and `is_microfinance`, `kyc`, `credit_data_modes` and `consent_purposes` (each naming one of `consents`).
- **`BorrowerAccepted`:** `lsp_application_ref`, `kfs_version`, `kfs_sha256`, `acknowledged_at` and `device_ref`.
- **`CoolingOffExitRequested`:** `lsp_application_ref`.
- **New event `CoolingOffExitAnswered`** (`in.infrabyx.servicing.CoolingOffExitAnswered.v1`, FX → UD, key `(loan_id, exit_ref)`): the exit amount, a payment instruction in words with no link, the lender's reference and the time. It is not signed until the Specification lists it; signing is proposed in PR-047 §5.
- **`ApplicationStatusChanged`:** `status_text`.
- **`DecisionMade`:** `reason_texts`.
- **`KFSIssued`:** `issued_at`, `language`, `document_ref`, `tenor_days`, `cash_flows` (`KfsInstalment`), `charges` (`KfsCharge`, `KFS_CHARGE_PAYEES`, `KFS_CHARGE_RECURRENCES`), `cooling_off_days`, `exit_terms`, `nodal_gro`, `co_lending` and `lsp_recovery_agent` (`KFS_AGENT_ROLES`); the Annex shapes are [VERIFY] against the RBI KFS format.
- **`SanctionLetterIssued`:** `document_ref`.
- **`LoanDisbursed`:** `application_id` and `disbursed_at`.

`fakes`: `FakeLender` sends every field. It refuses an `offer_ref` it never made (`offer_unknown`) and an acceptance of another KFS version, hash or application (`kfs_mismatch`, `application_mismatch`), and answers the first exit request once with `CoolingOffExitAnswered`.

`testing`: seven lender contract cases.

No setting, no migration.
