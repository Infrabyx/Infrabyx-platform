# @infrabyx/regcalc

Pure decimal calculations for the regulated lending figures, shared by the lending products and
the compliance tool that tests them (LawDocsComply LDC-66, Finbyx PR-FBX-58; ADR-0015; plan
`docs/phases/R1-regcalc-plan.md`). Specified by IPB-14 §14.2 once spec request PR-051 is
approved, under the stack of IPB-01 and the supply-chain rules of IPB-09.

- **Pure:** no I/O, no clock (dates are inputs), no randomness, no settings, no logging.
- **Decimal only:** every amount, rate and ratio is a `Decimal` (decimal.js, 40 digits, half-up).
  Inputs are decimal strings or `Decimal`s; a JavaScript `number` is refused.
- **Coded refusals:** `RegcalcError` with `reason` (`input_invalid`, `input_out_of_range`,
  `no_solution`, `rule_pack_invalid`, `rule_pack_not_in_force`) and `status: 422`; map it to your
  validation problem.
- **Basis on every result:** the provision applied and the owner's model it reproduces.
- **Oracles:** the owner's worked examples in `docs/regulatory-models` (every output cell
  reproduced; each workbook checked against its filed SHA-256 first).

Modules arrive in the plan's order: `schedule` and `apr`, then `dlg` and `ltv`, then `ews` and
`applicability`. The package is private until its exit is met, then published at 1.0.0 (owner,
27 Nov 2026; R1-D-301).
