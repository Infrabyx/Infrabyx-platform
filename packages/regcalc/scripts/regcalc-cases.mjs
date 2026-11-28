// Builds the data of `regcalcContractCases` (packages/testing/src/regcalc/oracle-data.ts): the
// inputs and the STORED results of the owner's worked examples, read straight from the workbooks
// (never computed by this package), so a product or a lender's system can be tested against the
// models without docs/regulatory-models (R1-regcalc plan §2; R1-D-312). Run after building
// @infrabyx/export, @infrabyx/crypto and @infrabyx/regcalc:
//   node packages/regcalc/scripts/regcalc-cases.mjs
// Each workbook is checked against docs/regulatory-models/SHA256SUMS before it is read.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sha256Hex } from "@infrabyx/crypto";
import { readXlsx } from "@infrabyx/export";
import { APP_M01 } from "../dist/index.js";

const ROOT = fileURLToPath(new URL("../../../docs/regulatory-models/", import.meta.url));
const OUT = fileURLToPath(new URL("../../testing/src/regcalc/oracle-data.ts", import.meta.url));
const SUMS = readFileSync(`${ROOT}SHA256SUMS`, "utf8");
const BOOKS = {
  kfs: "01 NBFC Models/Responsible Business Conduct/Loan Pricing Calculator/KFS-M01 APR Calculator – Worked Example (fictitious NBFC).xlsx",
  lend: "01 NBFC Models/Credit Facilities/Lending Limits Monitor/LEND-M01 Lending Limits Monitor – Worked Example (fictitious NBFC).xlsx",
  ews: "01 NBFC Models/Fraud Risk Management/Early Warning Model/EWS-M01 Fraud Early Warning Model – Worked Example (fictitious NBFC).xlsx",
  app: "01 NBFC Models/Registration, Exemptions and Framework for Scale Based Regulation/Applicability Engine/APP-M01 Applicability Engine – Worked Example (fictitious NBFC).xlsx",
};

function open(rel) {
  const bytes = new Uint8Array(readFileSync(`${ROOT}${rel}`));
  const line = SUMS.split("\n").find((l) => l.endsWith(`  ./${rel}`));
  if (!line || line.slice(0, 64) !== sha256Hex(bytes))
    throw new Error(`${rel} is not the filed copy`);
  const sheets = new Map(readXlsx(bytes).map((s) => [s.name, s.rows]));
  const cell = (sheet, ref) => {
    const m = /^([A-Z]+)([0-9]+)$/.exec(ref);
    const c = [...m[1]].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
    return sheets.get(sheet)?.[Number(m[2]) - 1]?.[c] ?? null;
  };
  return {
    sha256: line.slice(0, 64),
    s: (sheet, ref) => {
      const v = cell(sheet, ref);
      return v === null ? "" : String(v);
    },
    n: (sheet, ref) => {
      const v = cell(sheet, ref);
      return v === null || v === "" ? "0" : typeof v === "number" ? v.toString() : String(v).trim();
    },
    blank: (sheet, ref) => cell(sheet, ref) === null || cell(sheet, ref) === "",
  };
}
const date = (o, sheet, ref) => o.s(sheet, ref).slice(0, 10);
const colOf = (i) => {
  let x = i + 1;
  let out = "";
  while (x > 0) {
    out = String.fromCharCode(65 + ((x - 1) % 26)) + out;
    x = Math.floor((x - 1) / 26);
  }
  return out;
};

// ---- KFS-M01: the APR sheet on the worked example's loan (unrounded instalment) ------------------
const k = open(BOOKS.kfs);
const IN = "Loan Input";
const kfs = {
  model: "KFS-M01",
  sha256: k.sha256,
  loan: {
    principal: k.n(IN, "B6"),
    annualRate: k.n(IN, "B7"),
    frequency: k.s(IN, "B9").toLowerCase(),
    instalments: Number(k.n(IN, "B10")),
    disbursedOn: date(k, IN, "B11"),
    oneTimeCharges: [
      ["processing_fee", "B16"],
      ["other_own", "B17"],
      ["gst", "B18"],
      ["insurance", "B19"],
      ["legal_valuation", "B20"],
      ["other_third_party", "B21"],
    ].map(([kind, ref]) => ({ kind, amount: k.n(IN, ref) })),
    recurringPerInstalment: k.n(IN, "B23"),
  },
  expected: {
    instalment: k.n("APR", "B5"),
    totalInterest: k.n("APR", "B7"),
    netAmount: k.n("APR", "B10"),
    periodicRate: k.n("APR", "B12"),
    apr: k.n("APR", "B13"),
    effectiveAnnualRate: k.n("APR", "B14"),
  },
};

// ---- LEND-M01: the default loss guarantee monitor ----------------------------------------------
const l = open(BOOKS.lend);
const GI = "Guarantee Input";
const GM = "Guarantee Monitor";
const guarantees = [];
for (let r = 7; r <= 56 && l.s(GI, `A${r}`) !== ""; r++)
  guarantees.push({
    portfolio: {
      portfolio: l.s(GI, `A${r}`),
      disbursed: l.n(GI, `D${r}`),
      cashDeposited: l.n(GI, `E${r}`),
      fixedDepositWithLien: l.n(GI, `F${r}`),
      bankGuarantee: l.n(GI, `G${r}`),
      oldestOverdueDays: Number(l.n(GI, `I${r}`)),
    },
    expected: {
      totalCover: l.n(GM, `B${r}`),
      coverShare: l.blank(GM, `D${r}`) ? null : l.n(GM, `D${r}`),
      maxCover: l.n(GM, `E${r}`),
      capStatus: l.blank(GM, `F${r}`) ? null : l.s(GM, `F${r}`),
      excess: l.blank(GM, `G${r}`) ? null : l.n(GM, `G${r}`),
      invocationStatus: l.s(GM, `H${r}`),
    },
  });
const dlg = {
  model: "LEND-M01",
  sha256: l.sha256,
  limits: {
    internalTrigger: l.n("Setup", "B6"),
    cap: l.n("Setup", "B8"),
    invokeWithinDays: Number(l.n("Setup", "B9")),
  },
  guarantees,
};

// ---- EWS-M01: score and alert of every account ------------------------------------------------
const e = open(BOOKS.ews);
const II = "Indicators Input";
const AI = "Accounts Input";
const indicators = [];
for (let r = 7; r <= 36 && e.s(II, `A${r}`) !== ""; r++)
  indicators.push({
    no: Number(e.n(II, `A${r}`)),
    name: e.s(II, `B${r}`),
    family: e.s(II, `C${r}`),
    type: e.s(II, `D${r}`),
    weight: e.n(II, `E${r}`),
    critical: e.s(II, `F${r}`) === "Yes",
    active: e.s(II, `G${r}`) === "Yes",
  });
const FIRST = 4; // indicator 1 is column E of Accounts Input
const accounts = [];
for (let r = 8; r <= 307 && e.s(AI, `A${r}`) !== ""; r++) {
  const opt = (ref, key) => (e.s(AI, ref) ? { [key]: date(e, AI, ref) } : {});
  accounts.push({
    accountId: e.s(AI, `A${r}`),
    borrower: e.s(AI, `B${r}`),
    exposure: e.n(AI, `D${r}`),
    present: indicators
      .map((ind, i) => (e.s(AI, `${colOf(FIRST + i)}${r}`) === "Yes" ? ind.no : 0))
      .filter((x) => x > 0),
    ...opt(`AI${r}`, "alertOn"),
    ...(e.s(AI, `AJ${r}`) ? { status: e.s(AI, `AJ${r}`) } : {}),
    ...opt(`AK${r}`, "examinationClosedOn"),
    ...opt(`AL${r}`, "classifiedAsFraudOn"),
    ...opt(`AM${r}`, "returnFurnishedOn"),
  });
}
const ews = {
  model: "EWS-M01",
  sha256: e.sha256,
  reportingOn: date(e, "Setup", "B5"),
  pack: {
    id: "ews-m01-worked-example",
    version: "1.0.0",
    effectiveFrom: "2026-01-01",
    indicators,
    amberFrom: e.n("Setup", "B6"),
    redFrom: e.n("Setup", "B7"),
    criticalForcesRed: e.s("Setup", "B8") === "Yes",
    examinationDays: Number(e.n("Setup", "B9")),
    returnDays: Number(e.n("Setup", "B10")),
    captureTarget: e.n("Setup", "B11"),
  },
  accounts,
  expected: accounts.map((a, i) => ({
    accountId: e.s("Scoring", `A${7 + i}`),
    score: e.n("Scoring", `G${7 + i}`),
    alert: e.s("Scoring", `H${7 + i}`),
  })),
};
ews.expected.forEach((x, i) => {
  if (x.accountId !== accounts[i].accountId)
    throw new Error("EWS-M01 Scoring rows are not in input order");
});

// ---- APP-M01: what applies to the worked example's NBFC -----------------------------------------
const a = open(BOOKS.app);
const profile = {};
APP_M01.questions.forEach((q, i) => {
  const v = a.s("Profile", `B${4 + i}`);
  if (v !== "")
    profile[q.code] =
      q.kind === "date" ? v.slice(0, 10) : q.kind === "number" ? a.n("Profile", `B${4 + i}`) : v;
});
const inPlace = {};
APP_M01.policies.forEach((x, j) => {
  const v = a.s("Policies", `O${7 + j}`);
  if (v) inPlace[x.no] = v;
});
const app = {
  model: "APP-M01",
  sha256: a.sha256,
  profile,
  lines: { inPlace },
  expected: {
    policies: APP_M01.policies.map((x, j) => ({
      no: Number(a.n("Policies", `A${7 + j}`)),
      label: a.s("Policies", `N${7 + j}`),
      status: a.s("Policies", `P${7 + j}`) || null,
    })),
    committees: APP_M01.committees.map((x, j) => ({
      no: a.s("Committees and Roles", `A${7 + j}`),
      answer: a.s("Committees and Roles", `D${7 + j}`),
    })),
    returns: APP_M01.returns.map((x, j) => ({
      code: a.s("Returns", `A${7 + j}`),
      label: a.s("Returns", `D${7 + j}`),
    })),
  },
};

writeFileSync(
  OUT,
  "// GENERATED by packages/regcalc/scripts/regcalc-cases.mjs from the owner's worked examples in\n" +
    "// docs/regulatory-models (inputs and stored results, each workbook at its filed SHA-256); do not\n" +
    "// edit. Fictitious entities only.\n" +
    `export const REGCALC_ORACLES = ${JSON.stringify({ kfs, dlg, ews, app }, null, 2)} as const;\n`,
);
console.log(
  "regcalc oracle data written:",
  `KFS-M01, LEND-M01 (${guarantees.length} portfolios), EWS-M01 (${accounts.length} accounts), APP-M01 (${APP_M01.policies.length} policies)`,
);
