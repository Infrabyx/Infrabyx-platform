// The APR and the schedule beyond the worked example (R1-regcalc plan §2 contract cases; owner
// answer 2, R1-D-301; R1-D-306): the RBC Annex illustration (RBI/DOR/2025-26/362 para 29(3)(i) and
// (ii), figures only, no Annex text), the disclosed figure on the flows actually paid, and the
// solver's edges.
import { describe, expect, it } from "vitest";
import {
  D,
  NO_ROUNDING,
  aprActualDates,
  aprEqualPeriods,
  equatedInstalment,
  kfsApr,
  periodicIrr,
  reducingSchedule,
  toRupee,
  type KfsLoan,
} from "../index.js";

/** The Annex illustration's figures (para 29(3)), as the owner typed them (R1-D-301 (7)). */
const ANNEX = {
  sanctioned: "20000",
  rate: "0.15",
  instalments: 24,
  instalmentRounded: "970",
  instalmentUnrounded: "969.73",
  totalInterest: "3274",
  fees: "400",
  netDisbursed: "19600",
  totalToBePaid: "23274",
  totalAtRounded: "23280",
  aprPercent: "17.07",
  firstRow: { opening: "20000", principal: "720", interest: "250", instalment: "970" },
  lastRow: { opening: "958", principal: "958", interest: "12", instalment: "970" },
} as const;

const annexLoan: KfsLoan = {
  principal: ANNEX.sanctioned,
  annualRate: ANNEX.rate,
  frequency: "monthly",
  instalments: ANNEX.instalments,
  oneTimeCharges: [
    { kind: "processing_fee", amount: "240" },
    { kind: "other_third_party", amount: "160" },
  ],
};

describe("the RBC Annex illustration (para 29(3)(i) and (ii))", () => {
  it("reproduces RBI's 17.07 per cent on the unrounded ₹969.73 instalment", () => {
    const emi = equatedInstalment(annexLoan);
    expect(emi.toFixed(2)).toBe(ANNEX.instalmentUnrounded);
    expect(toRupee(emi).toString()).toBe(ANNEX.instalmentRounded);
    const r = kfsApr(annexLoan);
    expect(r.unrounded.aprPercent).toBe(ANNEX.aprPercent);
    expect(r.unrounded.periodicRate!.times(100).toFixed(4)).toBe("1.4225");
    expect(r.unrounded.method).toBe("equal_periods");
  });

  it("prints the Annex schedule: the unrounded schedule to the rupee, rows 1 and 24 and the totals", () => {
    const s = reducingSchedule(annexLoan, NO_ROUNDING);
    const shown = (r: (typeof s.rows)[number]) => ({
      opening: toRupee(r.opening).toString(),
      principal: toRupee(r.principal).toString(),
      interest: toRupee(r.interest).toString(),
      instalment: toRupee(r.instalment).toString(),
    });
    expect(shown(s.rows[0]!)).toEqual(ANNEX.firstRow);
    expect(shown(s.rows[23]!)).toEqual(ANNEX.lastRow);
    expect(s.rows.every((r) => toRupee(r.instalment).eq(970))).toBe(true);
    expect(toRupee(s.totals.interest).toString()).toBe(ANNEX.totalInterest);
    expect(toRupee(s.totals.instalments).toString()).toBe(ANNEX.totalToBePaid);
    expect(new D(ANNEX.instalmentRounded).times(24).toString()).toBe(ANNEX.totalAtRounded);
    expect(new D(ANNEX.sanctioned).minus(ANNEX.fees).toString()).toBe(ANNEX.netDisbursed);
  });

  it("on ₹970 × 24 the APR is 17.10 per cent", () => {
    const flows = Array.from({ length: 24 }, (_, i) => ({ period: i + 1, amount: "970" }));
    expect(aprEqualPeriods(ANNEX.netDisbursed, flows, 12).aprPercent).toBe("17.10");
  });

  it("discloses the APR on the flows actually paid, never the lower figure", () => {
    // Half-up to the rupee, the last instalment absorbing the difference (owner answer 3).
    const r = kfsApr(annexLoan);
    expect(r.schedule.rows.slice(0, 23).every((x) => x.instalment.eq(970))).toBe(true);
    expect(r.schedule.rows[23]!.instalment.toString()).toBe("965");
    expect(r.schedule.rows[23]!.closing.isZero()).toBe(true);
    expect(r.schedule.totals.principal.toString()).toBe("20000");
    expect(r.paid.aprPercent).toBe("17.08");
    expect(r.disclosed.aprPercent).toBe("17.08");
    expect(r.disclosed.apr.gte(r.unrounded.apr)).toBe(true);
    // ₹20,010 at 15 per cent: ₹970 a month, the last ₹976; the APR on what is paid is 17.0688 per
    // cent, below 17.0695 on the unrounded instalment, so the unrounded figure is disclosed.
    const down = kfsApr({ ...annexLoan, principal: "20010" });
    expect(down.schedule.rows[23]!.instalment.toString()).toBe("976");
    expect(down.paid.apr.lt(down.unrounded.apr)).toBe(true);
    expect(down.disclosed).toBe(down.unrounded);
  });

  it("the actual-dates (day-count) method is available and named, about 18.5 to 18.75 per cent", () => {
    const emi = equatedInstalment(annexLoan);
    const flows = Array.from({ length: 24 }, (_, i) => {
      const d = new Date(Date.UTC(2026, 0, 1 + 30));
      d.setUTCMonth(d.getUTCMonth() + i);
      return { on: d.toISOString().slice(0, 10), amount: emi };
    });
    const r = aprActualDates(ANNEX.netDisbursed, "2026-01-01", flows);
    expect(r.method).toBe("actual_dates");
    // The model's notes give 18.75 per cent for their dates; these dates give about 18.5.
    expect(Number(r.aprPercent)).toBeGreaterThan(18.4);
    expect(Number(r.aprPercent)).toBeLessThan(18.9);
  });
});

describe("the schedule and the solver at their edges", () => {
  it("a zero-rate loan: instalment = loan ÷ instalments, APR from the charges only", () => {
    const l: KfsLoan = { ...annexLoan, annualRate: "0", oneTimeCharges: [] };
    expect(equatedInstalment(l).toString()).toBe(new D(20000).div(24).toString());
    const s = reducingSchedule(l, NO_ROUNDING);
    expect(s.totals.interest.isZero()).toBe(true);
    expect(kfsApr(l, NO_ROUNDING).paid.apr.abs().lt("1e-30")).toBe(true);
  });

  it("one instalment, a charge after the last instalment, paisa rounding", () => {
    const one = reducingSchedule(
      { ...annexLoan, instalments: 1 },
      { to: "paisa", mode: "half_up" },
    );
    expect(one.rows[0]!.instalment.toString()).toBe("20250");
    expect(one.rows[0]!.closing.isZero()).toBe(true);
    const later = periodicIrr("1000", [
      { period: 1, amount: "600" },
      { period: 2, amount: "500" },
      { period: 3, amount: "10" },
    ]);
    const check = new D(600)
      .div(later.plus(1))
      .plus(new D(500).div(later.plus(1).pow(2)))
      .plus(new D(10).div(later.plus(1).pow(3)));
    expect(check.minus(1000).abs().lt("1e-20")).toBe(true);
    const p = reducingSchedule(annexLoan, { to: "paisa", mode: "half_up" });
    expect(p.instalment.toString()).toBe("969.73");
    expect(p.totals.principal.toString()).toBe("20000");
  });

  it("refuses flows that cannot repay the net amount, and every zero or negative flow", () => {
    expect(() => periodicIrr("1000", [{ period: 1, amount: "900" }])).toThrow(
      expect.objectContaining({ reason: "no_solution" }),
    );
    expect(() => periodicIrr("1000", [{ period: 1, amount: "0" }])).toThrow(
      expect.objectContaining({ reason: "no_solution" }),
    );
    expect(() => periodicIrr("1000", [{ period: 1, amount: "-5" }])).toThrow(
      expect.objectContaining({ reason: "input_out_of_range" }),
    );
    expect(() => periodicIrr("1000", [])).toThrow(
      expect.objectContaining({ reason: "no_solution" }),
    );
    expect(() =>
      kfsApr({ ...annexLoan, oneTimeCharges: [{ kind: "gst", amount: "20000" }] }),
    ).toThrow(expect.objectContaining({ reason: "input_out_of_range", field: "oneTimeCharges" }));
  });

  it("the actual-dates APR equals the equal-periods APR when flows are a 365-day year apart", () => {
    const flows = [
      { on: "2027-01-01", amount: "600" },
      { on: "2028-01-01", amount: "600" },
    ];
    const byDates = aprActualDates("1000", "2026-01-01", flows);
    const byPeriods = aprEqualPeriods(
      "1000",
      [
        { period: 1, amount: "600" },
        { period: 2, amount: "600" },
      ],
      1,
    );
    // 2027-01-01 to 2028-01-01 is 365 days (2027 is not a leap year).
    expect(byDates.apr.minus(byPeriods.apr).abs().lt("1e-20")).toBe(true);
  });

  it("refuses JavaScript numbers anywhere in the terms", () => {
    expect(() => kfsApr({ ...annexLoan, principal: 20000 as unknown as string })).toThrow(
      expect.objectContaining({ reason: "input_invalid", field: "principal" }),
    );
  });
});
