// EWS-M01, the owner's worked example (fictitious NBFC): every output cell of the Accounts Input
// header rows, Scoring, Indicator Review, Dashboard and Checks reproduced (R1-regcalc plan §2;
// R1-D-308). The pack is built from the workbook's Setup and Indicators Input sheets.
import { describe, expect, it } from "vitest";
import {
  D,
  EXAMINATION_STATUSES,
  ewsDashboard,
  ewsPack,
  ewsScores,
  indicatorReview,
  type Dec,
  type EwsAccount,
  type EwsPack,
  type ExaminationStatus,
} from "../index.js";
import { ORACLES, a1, openOracle } from "./oracle.js";

const o = openOracle(ORACLES.ews);
const s = (sheet: string, ref: string) => {
  const v = o.value(sheet, ref);
  return v === null ? "" : String(v);
};
const n = (sheet: string, ref: string) => o.num(sheet, ref).toString();
const date = (sheet: string, ref: string) => s(sheet, ref).slice(0, 10);
const col = (i: number) => {
  let x = i + 1;
  let out = "";
  while (x > 0) {
    const m = (x - 1) % 26;
    out = String.fromCharCode(65 + m) + out;
    x = Math.floor((x - 1) / 26);
  }
  return out;
};
const FIRST = a1("E1")[1]; // indicator 1 is column E of Accounts Input

const II = "Indicators Input";
const indRows: number[] = [];
for (let r = 7; r <= 36 && s(II, `A${r}`) !== ""; r++) indRows.push(r);
const pack: EwsPack = {
  id: "ews-m01-worked-example",
  version: "1.0.0",
  effectiveFrom: "2026-01-01",
  indicators: indRows.map((r) => ({
    no: Number(n(II, `A${r}`)),
    name: s(II, `B${r}`),
    family: s(II, `C${r}`) as EwsPack["indicators"][number]["family"],
    type: s(II, `D${r}`) as "Quantitative" | "Qualitative",
    weight: n(II, `E${r}`),
    critical: s(II, `F${r}`) === "Yes",
    active: s(II, `G${r}`) === "Yes",
  })),
  amberFrom: n("Setup", "B6"),
  redFrom: n("Setup", "B7"),
  criticalForcesRed: s("Setup", "B8") === "Yes",
  examinationDays: Number(n("Setup", "B9")),
  returnDays: Number(n("Setup", "B10")),
  captureTarget: n("Setup", "B11"),
};
const reporting = date("Setup", "B5");

const AI = "Accounts Input";
const accRows: number[] = [];
for (let r = 8; r <= 307 && s(AI, `A${r}`) !== ""; r++) accRows.push(r);
const opt = (ref: string, key: string) => (s(AI, ref) ? { [key]: date(AI, ref) } : {});
const accounts: EwsAccount[] = accRows.map((r) => ({
  accountId: s(AI, `A${r}`),
  borrower: s(AI, `B${r}`),
  exposure: n(AI, `D${r}`),
  present: pack.indicators
    .map((ind, i) => (s(AI, `${col(FIRST + i)}${r}`) === "Yes" ? ind.no : 0))
    .filter((x) => x > 0),
  ...opt(`AI${r}`, "alertOn"),
  ...(s(AI, `AJ${r}`) ? { status: s(AI, `AJ${r}`) as ExaminationStatus } : {}),
  ...opt(`AK${r}`, "examinationClosedOn"),
  ...opt(`AL${r}`, "classifiedAsFraudOn"),
  ...opt(`AM${r}`, "returnFurnishedOn"),
}));

const cell = (sheet: string, ref: string, v: unknown, kind: "money" | "rate" | "exact") => {
  if (v === null || v === undefined || v === "") return o.blank(sheet, ref);
  if (kind === "exact") return o.exact(sheet, ref, v as string | number);
  return kind === "money" ? o.money(sheet, ref, v as Dec) : o.rate(sheet, ref, v as Dec);
};

describe("@infrabyx/regcalc reproduces EWS-M01 (worked example)", () => {
  const scores = ewsScores(accounts, pack, reporting);
  const review = indicatorReview(accounts, pack);
  const dash = ewsDashboard(scores, review, pack);

  it("the pack from Setup and the library passes its checks", () => {
    expect(() => ewsPack(pack)).not.toThrow();
  });

  it("Accounts Input: the critical flags, weights in use and families heading each column", () => {
    pack.indicators.forEach((ind, i) => {
      const c = col(FIRST + i);
      o.exact(AI, `${c}4`, ind.critical && ind.active ? 1 : 0);
      o.exact(AI, `${c}5`, ind.active ? Number(ind.weight) : 0);
      o.exact(AI, `${c}6`, ind.family);
    });
    expect(o.uncovered([AI])).toEqual([]);
  });

  it("Scoring: score, alert, examination, the return and the ranking key of every account", () => {
    const S = "Scoring";
    for (let r = 7; r <= 306; r++) {
      const x = scores[r - 7];
      if (!x) {
        for (const c of "ABCDEFGHIJKLMNO") o.blank(S, `${c}${r}`);
        continue;
      }
      o.exact(S, `A${r}`, x.accountId);
      o.exact(S, `B${r}`, x.borrower);
      o.money(S, `C${r}`, x.exposure);
      o.exact(S, `D${r}`, x.indicatorsPresent);
      o.exact(S, `E${r}`, x.criticalPresent);
      o.exact(S, `F${r}`, x.families);
      o.rate(S, `G${r}`, x.score);
      o.exact(S, `H${r}`, x.alert);
      cell(S, `I${r}`, x.status, "exact");
      cell(S, `J${r}`, x.daysOpen, "exact");
      cell(S, `K${r}`, x.examination, "exact");
      cell(S, `L${r}`, x.returnDueOn, "exact");
      cell(S, `M${r}`, x.returnStatus, "exact");
      cell(S, `N${r}`, x.modelAlertOnConfirmed, "exact");
      // The model's sort key: score + criticals × 1000, ties broken by sheet row.
      o.rate(S, `O${r}`, x.score.plus(x.criticalPresent * 1000).plus(new D(1000 - r).div(100000)));
    }
    expect(o.uncovered([S])).toEqual([]);
  });

  it("Indicator Review: flagged, examined, confirmed, share and remark of every indicator", () => {
    const R = "Indicator Review";
    review.forEach((l, i) => {
      const r = 7 + i;
      o.exact(R, `A${r}`, l.no);
      o.exact(R, `B${r}`, l.name);
      o.exact(R, `C${r}`, l.family);
      o.exact(R, `D${r}`, Number(l.weightInUse.toString()));
      o.exact(R, `E${r}`, l.flagged);
      o.exact(R, `F${r}`, l.examinedAndClosed);
      o.exact(R, `G${r}`, l.confirmed);
      o.rate(R, `H${r}`, l.confirmedShare);
      cell(R, `I${r}`, l.remark, "exact");
    });
    o.exact(
      R,
      "E37",
      review.reduce((a, l) => a + l.flagged, 0),
    );
    o.exact(
      R,
      "F37",
      review.reduce((a, l) => a + l.examinedAndClosed, 0),
    );
    o.exact(
      R,
      "G37",
      review.reduce((a, l) => a + l.confirmed, 0),
    );
    expect(o.uncovered([R])).toEqual([]);
  });

  it("Dashboard: alerts, examinations, key measures and the ten highest scores", () => {
    const B = "Dashboard";
    (["RED", "AMBER", "GREEN"] as const).forEach((b, i) => {
      o.exact(B, `B${6 + i}`, dash.byAlert[b].accounts);
      o.money(B, `C${6 + i}`, dash.byAlert[b].exposure);
      o.rate(B, `D${6 + i}`, dash.byAlert[b].share);
    });
    o.exact(B, "B9", dash.totals.accounts);
    o.money(B, "C9", dash.totals.exposure);
    EXAMINATION_STATUSES.forEach((st, i) => {
      o.exact(B, `B${13 + i}`, dash.byStatus[st].accounts);
      o.money(B, `C${13 + i}`, dash.byStatus[st].exposure);
      o.exact(B, `D${13 + i}`, dash.byStatus[st].beyond);
    });
    o.exact(B, "B18", dash.examinationTotals.accounts);
    o.money(B, "C18", dash.examinationTotals.exposure);
    o.exact(B, "D18", dash.examinationTotals.beyond);
    const flag = (x: number, bad: string) =>
      dash.totals.accounts === 0 ? "" : x > 0 ? bad : "GREEN";
    o.exact(B, "B22", dash.openBeyond);
    o.exact(B, "C22", flag(dash.openBeyond, "RED"));
    o.exact(B, "B23", dash.alertsWithoutDate);
    o.exact(B, "C23", flag(dash.alertsWithoutDate, "AMBER"));
    o.exact(B, "B24", dash.returnsLate);
    o.exact(B, "C24", flag(dash.returnsLate, "RED"));
    o.exact(B, "B25", dash.returnsPending);
    o.exact(B, "B26", dash.confirmed);
    o.rate(B, "B27", dash.captureRate);
    cell(B, "C27", dash.captureStatus, "exact");
    o.rate(B, "B28", dash.falseAlertRate);
    o.exact(B, "B29", dash.indicatorsInUse);
    o.exact(B, "B30", dash.indicatorsNeverPresent);
    for (let k = 0; k < 10; k++) {
      const r = 34 + k;
      const i = dash.topTen[k];
      if (i === undefined) {
        for (const c of "ABCDEFH") o.blank(B, `${c}${r}`);
        continue;
      }
      const x = scores[i]!;
      o.exact(B, `H${r}`, i + 1);
      o.exact(B, `A${r}`, x.accountId);
      o.exact(B, `B${r}`, x.borrower);
      o.money(B, `C${r}`, x.exposure);
      o.rate(B, `D${r}`, x.score);
      o.exact(B, `E${r}`, x.alert);
      cell(B, `F${r}`, x.status, "exact");
    }
    expect(o.uncovered([B])).toEqual([]);
  });

  it("Checks: every integrity check", () => {
    const C = "Checks";
    const ids = accounts.map((a) => a.accountId);
    const after = (d?: string) => d !== undefined && d > reporting;
    const checks = [
      reporting !== "",
      new D(pack.redFrom).gt(pack.amberFrom),
      pack.indicators.every((i) => !i.active || (i.name !== "" && new D(i.weight).gt(0))),
      new Set(ids).size === ids.length,
      accRows.every((r) => s(AI, `D${r}`) !== ""),
      scores.every((x) => x.examination !== "CHECK"),
      accounts.every(
        (a) =>
          ![
            "Closed – no fraud angle",
            "Referred for investigation",
            "Classified as fraud",
          ].includes(a.status ?? "") || a.examinationClosedOn !== undefined,
      ),
      accounts.every(
        (a) => a.status !== "Classified as fraud" || a.classifiedAsFraudOn !== undefined,
      ),
      accounts.every(
        (a) => !after(a.alertOn) && !after(a.examinationClosedOn) && !after(a.classifiedAsFraudOn),
      ),
      scores.every((x) => x.daysOpen === null || x.daysOpen >= 0),
    ];
    checks.forEach((ok, i) => o.exact(C, `C${6 + i}`, ok ? "OK" : "CHECK"));
    expect(o.uncovered([C])).toEqual([]);
  });

  it("no output cell of the workbook is left unchecked", () => {
    expect(o.uncovered()).toEqual([]);
  });
});
