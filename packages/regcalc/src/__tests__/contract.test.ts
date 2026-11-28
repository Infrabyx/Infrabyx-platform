// `@infrabyx/regcalc` passes its own contract cases (R1-D-312): the reference calculator below is
// the adapter a product writes over the package; a lender's system gets one of the same shape. A
// calculator that is one paisa out, or names another result, fails the case.
import { describe, expect, it } from "vitest";
import {
  APP_M01,
  DEFAULT_LENDING_LIMITS,
  applicability,
  dlgMonitor,
  ewsScores,
  kfsApr,
  kfsFigures,
  type EwsAccount,
  type Frequency,
  type KfsLoan,
} from "../index.js";
import {
  REGCALC_ORACLES,
  defineRegcalcSuite,
  regcalcContractCases,
  type RegcalcCalculator,
  type RegcalcLoan,
} from "@infrabyx/testing";

const asLoan = (l: RegcalcLoan): KfsLoan => ({
  ...l,
  frequency: l.frequency as Frequency,
  oneTimeCharges: [...l.oneTimeCharges],
});

const reference: RegcalcCalculator = {
  kfsFigures(l) {
    const f = kfsFigures(asLoan(l));
    return {
      instalment: f.instalment.toString(),
      totalInterest: f.totalInterest.toString(),
      netAmount: f.netAmount.toString(),
      periodicRate: f.periodicRate.toString(),
      apr: f.apr.toString(),
      effectiveAnnualRate: f.effectiveAnnualRate.toString(),
    };
  },
  kfsDisclosed(l) {
    const r = kfsApr(asLoan(l));
    return {
      aprPaidPercent: r.paid.aprPercent,
      aprUnroundedPercent: r.unrounded.aprPercent,
      aprDisclosedPercent: r.disclosed.aprPercent,
      instalments: r.schedule.rows.map((x) => x.instalment.toString()),
    };
  },
  dlgMonitor(p, limits) {
    const r = dlgMonitor(p, {
      ...DEFAULT_LENDING_LIMITS,
      internalTrigger: limits.internalTrigger,
      dlg: { cap: limits.cap, invokeWithinDays: limits.invokeWithinDays },
    });
    return {
      totalCover: r.totalCover.toString(),
      coverShare: r.coverShare?.toString() ?? null,
      maxCover: r.maxCover.toString(),
      capStatus: r.capStatus,
      excess: r.excess?.toString() ?? null,
      invocationStatus: r.invocationStatus,
    };
  },
  ewsScores(accounts, pack, reportingOn) {
    return ewsScores(accounts as unknown as EwsAccount[], pack, reportingOn).map((x) => ({
      accountId: x.accountId,
      score: x.score.toString(),
      alert: x.alert,
    }));
  },
  applicability(profile, lines) {
    const out = applicability(APP_M01, profile, {
      inPlace: Object.fromEntries(
        Object.entries(lines.inPlace).map(([k, v]) => [Number(k), v]),
      ) as Record<number, "Yes" | "Partly" | "No">,
    });
    return {
      policies: out.policies.map((x) => ({ no: x.no, label: x.label, status: x.status })),
      committees: out.committees.map((x) => ({ no: x.no, answer: x.answer })),
      returns: out.returns.map((x) => ({ code: x.code, label: x.label })),
    };
  },
};

defineRegcalcSuite("@infrabyx/regcalc", () => reference, regcalcContractCases(reference));

describe("the cases catch a wrong calculator", () => {
  const run = async (calc: RegcalcCalculator) => {
    for (const c of regcalcContractCases(calc)) await c.run(calc);
  };
  it("one paisa out on the instalment fails KFS-M01", async () => {
    await expect(
      run({
        kfsFigures: async (l) => {
          const f = await reference.kfsFigures!(l);
          return { ...f, instalment: (Number(f.instalment) + 0.01).toFixed(6) };
        },
      }),
    ).rejects.toThrow(/instalment/);
  });
  it("the lower APR disclosed fails the Annex case", async () => {
    await expect(
      run({
        kfsDisclosed: async (l) => ({
          ...(await reference.kfsDisclosed!(l)),
          aprDisclosedPercent: "17.07",
        }),
      }),
    ).rejects.toThrow();
  });
  it("a JavaScript number where a decimal string belongs fails", async () => {
    await expect(
      run({
        dlgMonitor: async (p, l) => ({
          ...(await reference.dlgMonitor!(p, l)),
          totalCover: 1 as unknown as string,
        }),
      }),
    ).rejects.toThrow(/decimal string/);
  });
  it("one policy decided the other way fails APP-M01", async () => {
    await expect(
      run({
        applicability: async (p, l) => {
          const r = await reference.applicability!(p, l);
          const policies = r.policies.map((x, i) =>
            i === 0 ? { ...x, label: x.label === "Applies" ? "Does not apply" : "Applies" } : x,
          );
          return { ...r, policies };
        },
      }),
    ).rejects.toThrow();
  });
  it("a calculator with no methods gets no case", () => {
    expect(regcalcContractCases({})).toEqual([]);
    expect(REGCALC_ORACLES.ews.accounts.length).toBeGreaterThan(0);
  });
});
