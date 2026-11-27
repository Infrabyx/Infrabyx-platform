# ADR-0015 — A `regcalc` package for the regulated lending calculations

- **Status:** Accepted — LawDocsComply LDC-66 and Finbyx PR-FBX-58, one request (owner, 27 Nov 2026 15:45 IST; #211, R1-D-301); spec request PR-051
- **Date:** 2026-11-27
- **Deciders:** owner (`@infrabyx/platform-owners`)
- **IPB sections:** IPB-14 §14.2 (repository layout), IPB-01 (stack: TypeScript, ESM, Node.js 24.22.1), IPB-09 (supply chain, licences, the 7-day rule PL2-D-32)

## Context

Finbyx (the loan management system) and Udofin (digital lending) compute the regulated figures a borrower sees: the APR of the Key Facts Statement (RBI/DOR/2025-26/362, NBFC Responsible Business Conduct Directions, para 29(3)), the equated instalment and its schedule, the default loss guarantee cap, the loan-to-value limits, early-warning scores and which provisions apply to an entity. LawDocsComply tests those same figures for a lender. Three implementations would disagree at the paisa. IPB-14 §14.2 lists no package for calculations, and none of the existing ones fits: `rules` runs product rule sets behind RULES_PORT, `export` writes files, and both carry I/O. The figures must be exact decimals, which no package here provides.

## Decision

Add `packages/regcalc`, published as `@infrabyx/regcalc` at **1.0.0** once the plan's exit is met (every output cell of the owner's five oracle workbooks reproduced; owner's approval, R1-D-301). Until then it is `"private": true` at 0.0.0, so no release run publishes it early. It holds pure functions only: no I/O, no clock (dates are inputs), no randomness, no settings read, no logging. Its runtime dependencies are `decimal.js` **10.6.0** (MIT, published 6 Jul 2025) and `zod` **4.6.7**, and no `@infrabyx/*` package. Every amount, rate and ratio is a `Decimal` from a private clone (40 significant digits, half-up); a JavaScript `number` is refused at every input. Refusals are `RegcalcError` with a `reason` label and `status: 422`, which a product maps to its existing validation problem: no new error area (owner answer 4). Every result carries its `basis`: the provision and the owner's model it reproduces. Limits and thresholds are data with effective dates (parameter packs), shipped in the package with citations. A product may pass a stricter pack, never a looser one (refused). The oracle harness (tests only) opens each workbook in `docs/regulatory-models` only at its filed SHA-256 (R1-D-297) and fails on any formula cell no assertion reached.

## Verification

- The skeleton's tests: floats refused, coded refusals, rounding, and no `node:` import, clock, randomness, `process` or `console` in the source.
- The harness opens each oracle workbook at its filed hash and refuses one changed byte.
- `pnpm licence:check` passes with `decimal.js` (MIT); `ipb-check`, lint, typecheck and unit pass.

## Consequences

The platform gains a 24th package when 1.0.0 is published. Each module lands in its own PR (`schedule` and `apr`; `dlg` and `ltv`; `ews` and `applicability`), each with its oracle. A rule change is a new pack version and a package release, not a code change in a product. `testing` gains `regcalcContractCases` so LawDocsComply can run the same oracles against a lender's figures. IPB-14 §14.2 needs one line for `regcalc/` (PR-051).
