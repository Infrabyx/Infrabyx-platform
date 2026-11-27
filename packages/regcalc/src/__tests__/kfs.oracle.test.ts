// KFS-M01, the owner's worked example (fictitious NBFC): every output cell of its APR, Schedule,
// Key Facts Statement, Cooling Off, Penal Charges and Checks sheets reproduced from its inputs
// (R1-regcalc plan §2; R1-D-306). The workbook keeps the instalment unrounded, so the schedule is
// run with NO_ROUNDING; the disclosed figure (`kfsApr`) is tested in apr.test.ts.
import { describe, expect, it } from "vitest";
import {
  coolingOffExit,
  kfsChecks,
  kfsFigures,
  penalCharge,
  type Frequency,
  type KfsLoan,
} from "../index.js";
import { ORACLES, openOracle } from "./oracle.js";

const o = openOracle(ORACLES.kfs);
const IN = "Loan Input";
const str = (ref: string) => String(o.value(IN, ref) ?? "");
const num = (sheet: string, ref: string) => o.num(sheet, ref).toString();

const loan: KfsLoan = {
  principal: num(IN, "B6"),
  annualRate: num(IN, "B7"),
  frequency: str("B9").toLowerCase() as Frequency,
  instalments: Number(num(IN, "B10")),
  disbursedOn: str("B11").slice(0, 10),
  oneTimeCharges: [
    { kind: "processing_fee", amount: num(IN, "B16") },
    { kind: "other_own", amount: num(IN, "B17") },
    { kind: "gst", amount: num(IN, "B18") },
    { kind: "insurance", amount: num(IN, "B19") },
    { kind: "legal_valuation", amount: num(IN, "B20") },
    { kind: "other_third_party", amount: num(IN, "B21") },
  ],
  recurringPerInstalment: num(IN, "B23"),
};
const digital = str("B12") === "Yes";
const coolingOffDays = Number(num(IN, "B13"));

describe("@infrabyx/regcalc reproduces KFS-M01 (worked example)", () => {
  const f = kfsFigures(loan);

  it("Loan Input: the total of one-time charges", () => {
    o.money(IN, "B22", f.oneTimeCharges);
  });

  it("APR: instalment, totals, net amount, periodic rate, APR, effective rate", () => {
    o.exact("APR", "B4", f.periodsPerYear);
    o.money("APR", "B5", f.instalment);
    o.money("APR", "B6", f.totalOfInstalments);
    o.money("APR", "B7", f.totalInterest);
    o.money("APR", "B8", f.oneTimeCharges);
    o.money("APR", "B9", f.recurringCharges);
    o.money("APR", "B10", f.netAmount);
    o.money("APR", "B11", f.totalCost);
    o.rate("APR", "B12", f.periodicRate);
    o.rate("APR", "B13", f.apr);
    o.rate("APR", "B14", f.effectiveAnnualRate);
    o.rate("APR", "B15", f.aprOverRate);
    expect(o.uncovered(["APR"])).toEqual([]);
  });

  it("Schedule: every row, the totals, and nothing past the term", () => {
    const S = "Schedule";
    o.money(S, "D4", f.schedule.totals.instalments);
    o.money(S, "E4", f.schedule.totals.interest);
    o.money(S, "F4", f.schedule.totals.principal);
    for (let row = 7; row <= 126; row++) {
      const r = f.schedule.rows[row - 7];
      if (!r) {
        for (const c of "ABCDEFG") o.blank(S, `${c}${row}`);
        continue;
      }
      o.exact(S, `A${row}`, r.no);
      o.exact(S, `B${row}`, r.dueOn!);
      o.money(S, `C${row}`, r.opening);
      o.money(S, `D${row}`, r.instalment);
      o.money(S, `E${row}`, r.interest);
      o.money(S, `F${row}`, r.principal);
      o.money(S, `G${row}`, r.closing);
    }
    expect(f.schedule.rows.at(-1)!.closing.abs().lt("1e-20")).toBe(true);
    expect(o.uncovered([S])).toEqual([]);
  });

  it("Key Facts Statement: every figure laid out for the statement", () => {
    const K = "Key Facts Statement";
    // Echoes of the inputs, laid out as the statement shows them.
    o.exact(K, "C6", str("B5"));
    o.money(K, "C7", num(IN, "B6"));
    o.exact(K, "C9", `${loan.instalments} ${str("B9")} instalments`);
    o.exact(K, "C11", f.schedule.rows[0]!.dueOn!);
    o.exact(K, "C12", `${(Number(num(IN, "B7")) * 100).toFixed(2)}% – ${str("B8")}`);
    o.exact(K, "C33", coolingOffDays);
    // Figures.
    o.money(K, "C10", f.instalment);
    o.money(K, "C14", f.processingFee);
    o.money(K, "C15", f.gst);
    o.money(K, "C16", f.insurance);
    o.money(K, "C17", f.thirdPartyOther);
    o.money(K, "C18", f.recurringCharges.div(loan.instalments));
    o.rate(K, "C19", f.apr);
    o.money(K, "C20", f.totalInterest);
    o.money(K, "C21", f.netAmount);
    o.money(K, "C22", f.totalToBePaid);
    expect(o.uncovered([K])).toEqual([]);
  });

  it("Cooling Off: exit within the period, the proportionate cost and what is payable", () => {
    const C = "Cooling Off";
    const x = coolingOffExit({
      principal: num(IN, "B6"),
      apr: f.apr,
      dayOfExit: Number(num(C, "B4")),
      coolingOffDays,
      digital,
      retainProcessingFee: o.value(C, "B5") === "Yes",
      processingFee: num(IN, "B16"),
      oneTimeCharges: f.oneTimeCharges,
    });
    o.exact(C, "B7", x.withinPeriod === "yes" ? "Yes" : "No – ordinary pre-payment terms apply");
    o.money(C, "B8", x.proportionateCost);
    o.money(C, "B9", x.payable);
    o.money(C, "B10", x.feeRetained);
    o.money(C, "B11", x.otherOneTimeCharges);
    expect(o.uncovered([C])).toEqual([]);
  });

  it("Penal Charges: the charge, its tax and the interest at the contracted rate", () => {
    const P = "Penal Charges";
    const p = penalCharge({
      overdue: num(P, "B4"),
      daysOverdue: Number(num(P, "B5")),
      penalRate: num(P, "B6"),
      gstRate: num(P, "B7"),
      contractRate: num(IN, "B7"),
    });
    o.money(P, "B9", p.charge);
    o.money(P, "B10", p.gst);
    o.money(P, "B11", p.interest);
    o.money(P, "B12", p.total);
    expect(o.uncovered([P])).toEqual([]);
  });

  it("Checks: every integrity check", () => {
    const checks = kfsChecks(loan, digital, coolingOffDays);
    checks.forEach((c, i) => o.exact("Checks", `C${6 + i}`, c.ok ? "OK" : "CHECK"));
    expect(o.uncovered(["Checks"])).toEqual([]);
  });

  it("no output cell of the workbook is left unchecked", () => {
    expect(o.uncovered()).toEqual([]);
  });
});
