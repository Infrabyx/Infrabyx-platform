// The lending limits beyond the worked example (R1-regcalc plan §2 contract cases; owner answer 5,
// R1-D-301; R1-D-307): the cap at the boundary, slab boundaries, packs looser than the floor.
import { describe, expect, it } from "vitest";
import {
  DEFAULT_LENDING_LIMITS,
  dlgMonitor,
  goldLtv,
  lendingLimits,
  microfinance,
  networkDays,
  shareLtv,
  type GoldLoan,
  type LendingLimitsPack,
} from "../index.js";

const pack = (over: Partial<LendingLimitsPack>): LendingLimitsPack => ({
  ...DEFAULT_LENDING_LIMITS,
  ...over,
});

describe("default loss guarantee (para 24)", () => {
  it("cover exactly at the 5 per cent cap passes; one paisa over fails", () => {
    const at = dlgMonitor({ portfolio: "p", disbursed: "1000000", cashDeposited: "50000" });
    expect(at.capStatus).not.toBe("RED");
    expect(at.excess!.isZero()).toBe(true);
    const over = dlgMonitor({ portfolio: "p", disbursed: "1000000", cashDeposited: "50000.01" });
    expect(over.capStatus).toBe("RED");
    expect(over.excess!.toString()).toBe("0.01");
  });

  it("invocation: green well inside 120 days, amber near it, red past it; due on the day itself", () => {
    const at = (d: number) =>
      dlgMonitor({ portfolio: "p", disbursed: "1", oldestOverdueDays: d }).invocationStatus;
    expect(at(30)).toBe("GREEN");
    expect(at(118)).toBe("AMBER");
    expect(at(120)).toBe("AMBER");
    expect(at(121)).toBe("RED");
  });
});

describe("gold and silver (para 43)", () => {
  const loan = (
    borrowerId: string,
    sanctioned: string,
    over: Partial<GoldLoan> = {},
  ): GoldLoan => ({
    loanId: `${borrowerId}-${sanctioned}`,
    borrowerId,
    purpose: "consumption",
    bullet: false,
    sanctioned,
    outstanding: sanctioned,
    collateralValue: "1000000",
    ...over,
  });

  it("the slab follows the borrower's total, at and across the boundaries", () => {
    const [a] = goldLtv([loan("A", "250000")]);
    expect(a!.maxLtv!.toString()).toBe("0.85");
    const [b] = goldLtv([loan("B", "250000.01")]);
    expect(b!.maxLtv!.toString()).toBe("0.8");
    const [c] = goldLtv([loan("C", "500000")]);
    expect(c!.maxLtv!.toString()).toBe("0.8");
    const [d] = goldLtv([loan("D", "500000.01")]);
    expect(d!.maxLtv!.toString()).toBe("0.75");
    // Two loans of one borrower crossing a slab together: both take the lower limit.
    const both = goldLtv([loan("E", "200000"), loan("E", "100000")]);
    expect(both.map((x) => x.maxLtv!.toString())).toEqual(["0.8", "0.8"]);
  });

  it("silver is priced as its own collateral; a bullet loan uses the larger of repayable and outstanding", () => {
    const [silver] = goldLtv([loan("S", "100000", { collateralValue: "125000" })]);
    expect(silver!.ltv!.toString()).toBe("0.8");
    const [bullet] = goldLtv([
      loan("T", "100000", {
        bullet: true,
        outstanding: "90000",
        repayableAtMaturity: "108000",
        collateralValue: "120000",
      }),
    ]);
    expect(bullet!.amountForRatio.toString()).toBe("108000");
    expect(bullet!.status).toBe("RED");
  });

  it("an income-generating loan takes the Board's limit, or none", () => {
    const ig = loan("I", "100000", { purpose: "income_generating" });
    expect(goldLtv([ig])[0]!.maxLtv!.toString()).toBe("0.75");
    const none = pack({ gold: { ...DEFAULT_LENDING_LIMITS.gold, incomeGeneratingMaxLtv: null } });
    expect(goldLtv([ig], none)[0]!.status).toBe("NO_LIMIT_SET");
  });
});

describe("listed shares (para 106) and microfinance (paras 51, 55)", () => {
  it("counts working days as NETWORKDAYS and cures within 7", () => {
    expect(networkDays("2026-09-24", "2026-09-30")).toBe(5);
    const [x] = shareLtv(
      [{ loanId: "L", outstanding: "60", marketValue: "100", shortfallSince: "2026-09-15" }],
      "2026-09-30",
    );
    expect(x!.workingDaysSinceShortfall).toBe(11);
    expect(x!.status).toBe("RED");
    expect(x!.shortfall!.toString()).toBe("10");
  });

  it("microfinance qualifies up to ₹3 lakh, collateral-free only", () => {
    const r = microfinance([
      { householdId: "a", annualIncome: "300000", collateralFree: true },
      { householdId: "b", annualIncome: "300000.01", collateralFree: true },
      { householdId: "c", annualIncome: "100000", collateralFree: false },
    ]);
    expect(r.map((h) => h.qualifies)).toEqual([true, false, false]);
  });
});

describe("parameter packs (owner answer 5)", () => {
  it("a stricter pack is taken and changes the result without code", () => {
    const strict = pack({ dlg: { cap: "0.04", invokeWithinDays: 90 } });
    expect(
      dlgMonitor({ portfolio: "p", disbursed: "100", cashDeposited: "4.5" }, strict).capStatus,
    ).toBe("RED");
    expect(dlgMonitor({ portfolio: "p", disbursed: "100", cashDeposited: "4.5" }).capStatus).toBe(
      "GREEN",
    );
  });

  it("a pack looser than the regulatory floor is refused rule_pack_invalid", () => {
    const looser = [
      pack({ dlg: { cap: "0.06", invokeWithinDays: 120 } }),
      pack({ dlg: { cap: "0.05", invokeWithinDays: 150 } }),
      pack({ shares: { apply: true, maxLtv: "0.6", cureWorkingDays: 7 } }),
      pack({ shares: { apply: true, maxLtv: "0.5", cureWorkingDays: 10 } }),
      pack({ microfinance: { incomeUpTo: "400000", obligationsMax: "0.5" } }),
      pack({ microfinance: { incomeUpTo: "300000", obligationsMax: "0.6" } }),
      pack({
        gold: {
          slabs: [
            { upTo: "600000", maxLtv: "0.8" },
            { upTo: null, maxLtv: "0.75" },
          ],
          incomeGeneratingMaxLtv: null,
        },
      }),
      pack({ gold: { slabs: [{ upTo: null, maxLtv: "0.85" }], incomeGeneratingMaxLtv: null } }),
    ];
    for (const p of looser)
      expect(() => lendingLimits(p)).toThrow(
        expect.objectContaining({ reason: "rule_pack_invalid" }),
      );
    expect(() => lendingLimits({ ...DEFAULT_LENDING_LIMITS, version: "x" })).toThrow(
      expect.objectContaining({ reason: "rule_pack_invalid" }),
    );
  });
});
