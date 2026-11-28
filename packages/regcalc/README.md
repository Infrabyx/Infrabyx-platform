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
`applicability`.

**`applicability`** (APP-M01 to APP-M07): `applicability(pack, profile, lines?)` gives each
policy, committee, role and return of the owner's engines as `applies`, `does_not_apply`,
`good_practice`, `check_condition` or `needs_answer`, with the model's own words (`label`), the
gaps (GREEN, AMBER, RED), the dashboard counts and the checks. The default packs
(`DEFAULT_APPLICABILITY_PACKS`, `APP_M01` …) are generated from the filed models by
`scripts/app-packs.mjs`; a product's own pack is checked by `applicabilityPack`. An unanswered
question gives `needs_answer`, never a guess: the workbooks read a blank answer as "No". Published at 1.0.0 once its exit was met (owner approval, 27 Nov 2026; R1-D-301, R1-D-312).
`@infrabyx/testing` carries the same oracles as contract cases (`regcalcContractCases`) for a
product or a lender's system.
