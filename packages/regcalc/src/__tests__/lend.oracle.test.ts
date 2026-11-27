// LEND-M01, the owner's worked example (fictitious NBFC): every output cell of the Guarantee, Gold,
// Share and Microfinance monitors, the Dashboard and the Checks reproduced (R1-regcalc plan §2;
// R1-D-307). The limits pack is built from the workbook's Setup sheet and must pass the floor check.
import { describe, expect, it } from "vitest";
import {
  D,
  DEFAULT_LENDING_LIMITS,
  dlgMonitor,
  goldLtv,
  lendingLimits,
  microfinance,
  shareLtv,
  summarise,
  type Dec,
  type LendingLimitsPack,
} from "../index.js";
import { ORACLES, openOracle } from "./oracle.js";

const o = openOracle(ORACLES.lend);
const s = (sheet: string, ref: string) => {
  const v = o.value(sheet, ref);
  return v === null ? "" : String(v);
};
const n = (sheet: string, ref: string) => o.num(sheet, ref).toString();
const date = (sheet: string, ref: string) => s(sheet, ref).slice(0, 10);

const pack: LendingLimitsPack = {
  ...DEFAULT_LENDING_LIMITS,
  internalTrigger: n("Setup", "B6"),
  dlg: { cap: n("Setup", "B8"), invokeWithinDays: Number(n("Setup", "B9")) },
  gold: {
    slabs: [
      { upTo: n("Setup", "B11"), maxLtv: n("Setup", "B12") },
      { upTo: n("Setup", "B13"), maxLtv: n("Setup", "B14") },
      { upTo: null, maxLtv: n("Setup", "B15") },
    ],
    incomeGeneratingMaxLtv: s("Setup", "B16") === "" ? null : n("Setup", "B16"),
  },
  shares: {
    apply: s("Setup", "B18") === "Yes",
    maxLtv: n("Setup", "B19"),
    cureWorkingDays: Number(n("Setup", "B20")),
  },
  microfinance: { incomeUpTo: n("Setup", "B22"), obligationsMax: n("Setup", "B23") },
};
const position = date("Setup", "B5");

/** The input rows of `sheet` from row 7 while column A is filled. */
const rows = (sheet: string, last: number) => {
  const out: number[] = [];
  for (let r = 7; r <= last && s(sheet, `A${r}`) !== ""; r++) out.push(r);
  return out;
};
const cellOr = (
  sheet: string,
  ref: string,
  v: Dec | string | number | null,
  kind: "money" | "rate" | "exact",
) => {
  if (v === null) return o.blank(sheet, ref);
  if (kind === "exact") return o.exact(sheet, ref, v as string | number);
  return kind === "money" ? o.money(sheet, ref, v as Dec) : o.rate(sheet, ref, v as Dec);
};
const blankRows = (sheet: string, from: number, to: number, cols: string) => {
  for (let r = from; r <= to; r++) for (const c of cols) o.blank(sheet, `${c}${r}`);
};

describe("@infrabyx/regcalc reproduces LEND-M01 (worked example)", () => {
  it("the Setup pack is not looser than the regulatory floor", () => {
    expect(() => lendingLimits(pack)).not.toThrow();
  });

  const gRows = rows("Guarantee Input", 56);
  const guarantees = gRows.map((r) =>
    dlgMonitor(
      {
        portfolio: s("Guarantee Input", `A${r}`),
        disbursed: n("Guarantee Input", `D${r}`),
        cashDeposited: n("Guarantee Input", `E${r}`),
        fixedDepositWithLien: n("Guarantee Input", `F${r}`),
        bankGuarantee: n("Guarantee Input", `G${r}`),
        oldestOverdueDays: Number(n("Guarantee Input", `I${r}`)),
      },
      pack,
    ),
  );
  it("Guarantee Monitor: cover, cap, excess and invocation", () => {
    const G = "Guarantee Monitor";
    gRows.forEach((r, i) => {
      const g = guarantees[i]!;
      o.exact(G, `A${r}`, g.portfolio);
      o.money(G, `B${r}`, g.totalCover);
      o.money(G, `C${r}`, g.disbursed);
      cellOr(G, `D${r}`, g.coverShare, "rate");
      o.money(G, `E${r}`, g.maxCover);
      cellOr(G, `F${r}`, g.capStatus, "exact");
      cellOr(G, `G${r}`, g.excess, "money");
      o.exact(G, `H${r}`, g.invocationStatus);
    });
    blankRows(G, 7 + gRows.length, 56, "ABCDEFGH");
    expect(o.uncovered([G])).toEqual([]);
  });

  const goldRowsIdx = rows("Gold Input", 506);
  const gold = goldLtv(
    goldRowsIdx.map((r) => ({
      loanId: s("Gold Input", `A${r}`),
      borrowerId: s("Gold Input", `B${r}`),
      purpose: s("Gold Input", `C${r}`) === "Consumption" ? "consumption" : "income_generating",
      bullet: s("Gold Input", `D${r}`) === "Yes",
      sanctioned: n("Gold Input", `E${r}`),
      outstanding: n("Gold Input", `F${r}`),
      repayableAtMaturity: n("Gold Input", `G${r}`),
      collateralValue: n("Gold Input", `H${r}`),
    })),
    pack,
  );
  it("Gold Monitor: the slab by the borrower's consumption total, the LTV and the amount above it", () => {
    const M = "Gold Monitor";
    goldRowsIdx.forEach((r, i) => {
      const g = gold[i]!;
      o.exact(M, `A${r}`, g.loanId);
      o.exact(M, `B${r}`, g.borrowerId);
      cellOr(M, `C${r}`, g.consumptionTotal, "money");
      cellOr(M, `D${r}`, g.maxLtv, "rate");
      o.money(M, `E${r}`, g.amountForRatio);
      cellOr(M, `F${r}`, g.ltv, "rate");
      cellOr(M, `G${r}`, g.status === "NO_LIMIT_SET" ? "No limit set" : g.status, "exact");
      cellOr(M, `H${r}`, g.aboveLimit, "money");
    });
    blankRows(M, 7 + goldRowsIdx.length, 506, "ABCDEFGH");
    expect(o.uncovered([M])).toEqual([]);
  });

  const shareRowsIdx = rows("Share Input", 206);
  const shares = shareLtv(
    shareRowsIdx.map((r) => ({
      loanId: s("Share Input", `A${r}`),
      borrower: s("Share Input", `B${r}`),
      outstanding: n("Share Input", `C${r}`),
      marketValue: n("Share Input", `D${r}`),
      ...(s("Share Input", `E${r}`) ? { shortfallSince: date("Share Input", `E${r}`) } : {}),
    })),
    position,
    pack,
  );
  it("Share Monitor: LTV, shortfall, working days of cure and status", () => {
    const M = "Share Monitor";
    shareRowsIdx.forEach((r, i) => {
      const x = shares[i]!;
      o.exact(M, `A${r}`, x.loanId);
      o.exact(M, `B${r}`, x.borrower);
      cellOr(M, `C${r}`, x.ltv, "rate");
      cellOr(M, `D${r}`, x.shortfall, "money");
      cellOr(M, `E${r}`, x.workingDaysSinceShortfall, "exact");
      cellOr(M, `F${r}`, x.status === "NOT_APPLICABLE" ? "Not applicable" : x.status, "exact");
    });
    blankRows(M, 7 + shareRowsIdx.length, 206, "ABCDEF");
    expect(o.uncovered([M])).toEqual([]);
  });

  const mfRowsIdx = rows("Microfinance Input", 506);
  const mf = microfinance(
    mfRowsIdx.map((r) => ({
      householdId: s("Microfinance Input", `A${r}`),
      annualIncome: n("Microfinance Input", `C${r}`),
      existingMonthlyObligations: n("Microfinance Input", `D${r}`),
      monthlyInstalment: n("Microfinance Input", `E${r}`),
      collateralFree: s("Microfinance Input", `F${r}`) !== "No",
    })),
    pack,
  );
  it("Microfinance Monitor: qualification, obligations against income, the highest instalment", () => {
    const M = "Microfinance Monitor";
    mfRowsIdx.forEach((r, i) => {
      const h = mf[i]!;
      o.exact(M, `A${r}`, h.householdId);
      o.exact(M, `B${r}`, h.qualifies ? "Yes" : "No");
      o.money(M, `C${r}`, h.monthlyIncome);
      o.money(M, `D${r}`, h.monthlyObligations);
      cellOr(M, `E${r}`, h.obligationsShare, "rate");
      cellOr(M, `F${r}`, h.status === "NOT_MICROFINANCE" ? "Not microfinance" : h.status, "exact");
      cellOr(M, `G${r}`, h.maxInstalment, "money");
    });
    blankRows(M, 7 + mfRowsIdx.length, 506, "ABCDEFG");
    expect(o.uncovered([M])).toEqual([]);
  });

  it("Dashboard: counts, the worst status and the totals", () => {
    const B = "Dashboard";
    const lines = [
      summarise(guarantees.map((g) => g.capStatus)),
      summarise(guarantees.map((g) => g.invocationStatus)),
      summarise(gold.map((g) => g.status)),
      summarise(shares.map((x) => x.status)),
      summarise(mf.map((h) => h.status)),
    ];
    lines.forEach((l, i) => {
      const r = 6 + i;
      o.exact(B, `B${r}`, l.items);
      o.exact(B, `C${r}`, l.red);
      o.exact(B, `D${r}`, l.amber);
      o.exact(B, `E${r}`, l.green);
      cellOr(B, `F${r}`, l.overall, "exact");
    });
    const total = (xs: (Dec | null)[]) => xs.reduce<Dec>((a, b) => a.plus(b ?? 0), new D(0));
    o.money(B, "B12", total(guarantees.map((g) => g.excess)));
    o.money(B, "B13", total(gold.map((g) => g.aboveLimit)));
    o.money(B, "B14", total(shares.map((x) => x.shortfall)));
    o.exact(B, "B15", mf.filter((h) => !h.qualifies).length);
    expect(o.uncovered([B])).toEqual([]);
  });

  it("Checks: every input check", () => {
    const C = "Checks";
    const filled = (sheet: string, rs: number[], col: string) =>
      rs.every((r) => s(sheet, `${col}${r}`) !== "");
    const checks = [
      position !== "",
      filled("Guarantee Input", gRows, "D"),
      ["C", "E", "H"].every((c) => filled("Gold Input", goldRowsIdx, c)),
      goldRowsIdx.every(
        (r) => s("Gold Input", `D${r}`) !== "Yes" || s("Gold Input", `G${r}`) !== "",
      ),
      filled("Share Input", shareRowsIdx, "D"),
      filled("Microfinance Input", mfRowsIdx, "C"),
      new D(pack.microfinance.obligationsMax).lte("0.5"),
    ];
    checks.forEach((ok, i) => o.exact(C, `C${6 + i}`, ok ? "OK" : "CHECK"));
    expect(o.uncovered([C])).toEqual([]);
  });

  it("no output cell of the workbook is left unchecked", () => {
    expect(o.uncovered()).toEqual([]);
  });
});
