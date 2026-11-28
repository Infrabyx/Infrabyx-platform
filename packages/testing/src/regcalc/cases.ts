// Contract cases for the regulated calculations (R1-regcalc plan §2; LDC-66, PR-FBX-58;
// R1-D-312): each of the owner's worked examples as a named case, with its inputs and its STORED
// results, so that a lender's own system, a product, or `@infrabyx/regcalc` itself can be tested
// against the same models without docs/regulatory-models. LawDocsComply runs them against the
// figures a lender's system produces; Finbyx and Udofin against the package they compute with.
//
// A calculator supplies any of the methods below; the cases cover the methods it has. Numbers
// cross as decimal strings (never JavaScript numbers in a regulated figure); money is compared to
// the paisa and rates to 1e-10, as the package's own oracles are.
import { describe, expect, it } from "vitest";
import type { ContractCase } from "../contract.js";
import { REGCALC_ORACLES } from "./oracle-data.js";

type Awaitable<T> = T | Promise<T>;

export interface RegcalcOneTimeCharge {
  kind:
    "processing_fee" | "other_own" | "gst" | "insurance" | "legal_valuation" | "other_third_party";
  amount: string;
}

export interface RegcalcLoan {
  principal: string;
  /** The rate per annum as a fraction (`"0.15"`), reducing balance. */
  annualRate: string;
  frequency: string;
  instalments: number;
  disbursedOn?: string;
  oneTimeCharges: readonly RegcalcOneTimeCharge[];
  recurringPerInstalment?: string;
}

export interface RegcalcCalculator {
  /** KFS-M01's APR sheet on the unrounded instalment (fractions for the rates). */
  kfsFigures?(loan: RegcalcLoan): Awaitable<{
    instalment: string;
    totalInterest: string;
    netAmount: string;
    periodicRate: string;
    apr: string;
    effectiveAnnualRate: string;
  }>;
  /**
   * The APR the KFS discloses (owner answer 2, R1-D-306): on the flows actually paid (half-up to
   * the rupee, the last instalment absorbing the difference), on the unrounded instalment, and the
   * higher of the two; percent to two places. `instalments` are the amounts charged.
   */
  kfsDisclosed?(loan: RegcalcLoan): Awaitable<{
    aprPaidPercent: string;
    aprUnroundedPercent: string;
    aprDisclosedPercent: string;
    instalments: readonly string[];
  }>;
  /** LEND-M01's guarantee monitor for one portfolio (statuses GREEN, AMBER or RED; null for none). */
  dlgMonitor?(
    portfolio: (typeof REGCALC_ORACLES.dlg.guarantees)[number]["portfolio"],
    limits: typeof REGCALC_ORACLES.dlg.limits,
  ): Awaitable<{
    totalCover: string;
    coverShare: string | null;
    maxCover: string;
    capStatus: string | null;
    excess: string | null;
    invocationStatus: string;
  }>;
  /** EWS-M01's score and alert (GREEN, AMBER or RED) of each account, in input order. */
  ewsScores?(
    accounts: typeof REGCALC_ORACLES.ews.accounts,
    pack: typeof REGCALC_ORACLES.ews.pack,
    reportingOn: string,
  ): Awaitable<ReadonlyArray<{ accountId: string; score: string; alert: string }>>;
  /**
   * APP-M01: each policy's final result in the model's words (`Applies`, `Does not apply`,
   * `Good practice`, `Check the condition`) and its gap (GREEN, AMBER, RED, `Not assessed`, or
   * null), each committee's answer for the layer, each return's result (`Applies`,
   * `Does not apply`, `Confirm`).
   */
  applicability?(
    profile: Readonly<Record<string, string>>,
    lines: { inPlace: Readonly<Record<string, string>> },
  ): Awaitable<{
    policies: ReadonlyArray<{ no: number; label: string; status: string | null }>;
    committees: ReadonlyArray<{ no: string; answer: string | null }>;
    returns: ReadonlyArray<{ code: string; label: string }>;
  }>;
}

const MONEY = 0.005;
const RATE = 1e-10;
function near(got: string | null, want: string | null, tol: number, what: string) {
  if (want === null) return expect(got, what).toBeNull();
  expect(typeof got, `${what} is a decimal string`).toBe("string");
  expect(got, `${what} is a decimal string`).toMatch(/^-?[0-9]+(\.[0-9]+)?$/);
  expect(
    Math.abs(Number(got) - Number(want)),
    `${what}: got ${got}, the model has ${want}`,
  ).toBeLessThanOrEqual(tol);
}

/** The RBC Annex illustration (RBI/DOR/2025-26/362 para 29(3)(i), (ii); figures only; R1-D-301 (7)). */
export const RBC_ANNEX_LOAN: RegcalcLoan = Object.freeze({
  principal: "20000",
  annualRate: "0.15",
  frequency: "monthly",
  instalments: 24,
  oneTimeCharges: Object.freeze([
    { kind: "processing_fee", amount: "240" },
    { kind: "other_third_party", amount: "160" },
  ]) as readonly RegcalcOneTimeCharge[],
});

/** The cases for the methods `calc` has (all five oracles for a full calculator). */
export function regcalcContractCases(
  calc: RegcalcCalculator,
): Array<ContractCase<RegcalcCalculator>> {
  const O = REGCALC_ORACLES;
  const cases: Array<ContractCase<RegcalcCalculator>> = [];
  if (calc.kfsFigures)
    cases.push({
      name: "KFS-M01: the instalment, interest, net amount, periodic rate, APR and effective rate of the worked example",
      async run(c) {
        const f = await c.kfsFigures!(O.kfs.loan);
        const w = O.kfs.expected;
        near(f.instalment, w.instalment, MONEY, "instalment (APR!B5)");
        near(f.totalInterest, w.totalInterest, MONEY, "total interest (APR!B7)");
        near(f.netAmount, w.netAmount, MONEY, "net amount (APR!B10)");
        near(f.periodicRate, w.periodicRate, RATE, "periodic rate (APR!B12)");
        near(f.apr, w.apr, RATE, "APR (APR!B13)");
        near(f.effectiveAnnualRate, w.effectiveAnnualRate, RATE, "effective rate (APR!B14)");
      },
    });
  if (calc.kfsDisclosed)
    cases.push({
      name: "RBC Annex (para 29(3)): 17.07 per cent on the unrounded instalment, 17.08 on what is paid (₹970 × 23, ₹965), the higher disclosed",
      async run(c) {
        const r = await c.kfsDisclosed!(RBC_ANNEX_LOAN);
        expect(r.aprUnroundedPercent).toBe("17.07");
        expect(r.aprPaidPercent).toBe("17.08");
        expect(r.aprDisclosedPercent).toBe("17.08");
        expect(r.instalments.map(String)).toEqual([...Array<string>(23).fill("970"), "965"]);
      },
    });
  if (calc.dlgMonitor)
    cases.push({
      name: `LEND-M01: cover, cap and invocation of each of the ${O.dlg.guarantees.length} guaranteed portfolios`,
      async run(c) {
        for (const g of O.dlg.guarantees) {
          const r = await c.dlgMonitor!(g.portfolio, O.dlg.limits);
          const w = g.expected;
          const p = g.portfolio.portfolio;
          near(r.totalCover, w.totalCover, MONEY, `${p} total cover`);
          near(r.coverShare, w.coverShare, RATE, `${p} cover share`);
          near(r.maxCover, w.maxCover, MONEY, `${p} maximum cover`);
          expect(r.capStatus, `${p} cap status`).toBe(w.capStatus);
          near(r.excess, w.excess, MONEY, `${p} excess`);
          expect(r.invocationStatus, `${p} invocation`).toBe(w.invocationStatus);
        }
      },
    });
  if (calc.ewsScores)
    cases.push({
      name: `EWS-M01: the score and alert of each of the ${O.ews.accounts.length} accounts`,
      async run(c) {
        const r = await c.ewsScores!(O.ews.accounts, O.ews.pack, O.ews.reportingOn);
        expect(r.map((x) => x.accountId)).toEqual(O.ews.expected.map((x) => x.accountId));
        r.forEach((x, i) => {
          const w = O.ews.expected[i]!;
          near(x.score, w.score, RATE, `${w.accountId} score`);
          expect(x.alert, `${w.accountId} alert`).toBe(w.alert);
        });
      },
    });
  if (calc.applicability)
    cases.push({
      name: `APP-M01: what applies to the worked example's NBFC, each of ${O.app.expected.policies.length} policies, committees and returns`,
      async run(c) {
        const r = await c.applicability!(O.app.profile, O.app.lines);
        expect(r.policies).toEqual(O.app.expected.policies);
        expect(r.committees).toEqual(O.app.expected.committees);
        expect(r.returns).toEqual(O.app.expected.returns);
      },
    });
  return cases;
}

/** Registers each case as a vitest test under one suite (for a calculator, not a port). */
export function defineRegcalcSuite(
  name: string,
  factory: () => Awaitable<RegcalcCalculator>,
  cases: ReadonlyArray<ContractCase<RegcalcCalculator>>,
): void {
  describe(`regcalc contract: ${name}`, () => {
    it("covers at least one oracle", () => expect(cases.length).toBeGreaterThan(0));
    for (const c of cases) it(c.name, async () => c.run(await factory()));
  });
}

export { REGCALC_ORACLES };
