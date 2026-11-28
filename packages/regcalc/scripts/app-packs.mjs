// Builds the default applicability packs (src/packs/app-m0*.ts) from the owner's filed models in
// docs/regulatory-models (owner answer 6, R1-D-301: the owner's rule tables are the default pack,
// versioned). Run after `pnpm --filter @infrabyx/export build`:
//   node packages/regcalc/scripts/app-packs.mjs
// Sources, each checked against docs/regulatory-models/SHA256SUMS before it is read:
//   APP-M01: maps/app_rules.json (policies and their condition rules), data/applicability_register.json
//     (committees and roles), maps/app_map.json (the profile questions' labels); the derived
//     thresholds, returns and checks are transcribed from build_applicability.py (DER, RET, chk).
//   APP-M02 to M07: maps/appm0N_rules.json (policies, their answers by category and question),
//     data/sector_engines.json (categories and codes), and the engine workbook (profile questions,
//     committees and roles, whose answers by category are only in its formulas).
// src/__tests__/app.oracle.test.ts checks every pack line against the workbook's own formulas, so a
// pack that drifts from the filed model fails.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sha256Hex } from "@infrabyx/crypto";
import { readXlsx, readZip } from "@infrabyx/export";

const ROOT = fileURLToPath(new URL("../../../docs/regulatory-models/", import.meta.url));
const OUT = fileURLToPath(new URL("../src/packs/", import.meta.url));
const RULES = "05 Rules, Input Maps and Builders/";
const SUMS = readFileSync(`${ROOT}SHA256SUMS`, "utf8");

function filed(rel) {
  const bytes = readFileSync(`${ROOT}${rel}`);
  const got = sha256Hex(new Uint8Array(bytes));
  const line = SUMS.split("\n").find((l) => l.endsWith(`  ./${rel}`));
  if (!line || !line.startsWith(got)) throw new Error(`${rel} is not the filed copy`);
  return bytes;
}
const json = (rel) => JSON.parse(filed(rel).toString("utf8"));

const VERSION = "1.0.0";
// The day the owner filed the models in this repository (R1-D-297).
const EFFECTIVE_FROM = "2026-11-27";

// ---- APP-M01 (layered) --------------------------------------------------------------------------
const CATS = [
  "Investment and Credit Company",
  "Microfinance Institution",
  "Factor",
  "Infrastructure Finance Company",
  "Infrastructure Debt Fund",
  "Housing Finance Company",
  "Core Investment Company",
  "Account Aggregator",
  "Peer to Peer Lending Platform",
  "Mortgage Guarantee Company",
  "Other",
];
const LAYERS = ["Base Layer", "Middle Layer", "Upper Layer"];
// build_applicability.py `Q`: the question keys, in order (rows 4 onward of the Profile sheet).
const Q = [
  ["name", "text"],
  ["date", "date"],
  ["layer", "choice", LAYERS],
  ["cat", "choice", CATS],
  ["assets", "number"],
  ...`DEP PF CUST PUB LEQ LDEBT TOP INDAS SUBS BR10 E20 E300 CSR DIV SECURED DL DLG PROJ LAS GOLD MF CALL NFB PCE CARD FACT COL SECO SECI LT SLT DIST FX2 FCY FEMA NCD IGO OFFSH RELIEF SNFA GREEN API`
    .split(" ")
    .map((k) => [k, "yes_no"]),
];
const yes = (c) => ({ yes: c });
const eq = (c, v) => ({ eq: [c, v] });
// build_applicability.py `DER`.
const DER = [
  ["A100", "Total assets of ₹100 crore or more", { gte: ["assets", "100"] }],
  ["A500", "Total assets of ₹500 crore or more", { gte: ["assets", "500"] }],
  ["A1000", "Total assets of ₹1,000 crore or more", { gte: ["assets", "1000"] }],
  ["A5000", "Total assets of ₹5,000 crore or more", { gte: ["assets", "5000"] }],
  ["LISTED", "Listed (equity or debt)", { any: [yes("LEQ"), yes("LDEBT")] }],
  ["HFC", "Housing Finance Company", eq("cat", CATS[5])],
  ["CIC", "Core Investment Company", eq("cat", CATS[6])],
  ["AA", "Account Aggregator", eq("cat", CATS[7])],
  [
    "MFI",
    "Microfinance Institution or microfinance lender",
    { any: [eq("cat", CATS[1]), yes("MF")] },
  ],
  ["FAC", "Factor or factoring business", { any: [eq("cat", CATS[2]), yes("FACT")] }],
];
// build_applicability.py `RET` (a rule of None is "Confirm").
const RET = [
  [
    "DNBS01",
    "Important Financial Parameters",
    "Quarterly",
    { not: eq("layer", LAYERS[0]) },
    "Middle Layer and Upper Layer NBFCs",
  ],
  [
    "DNBS02",
    "Important Financial Parameters",
    "Quarterly",
    eq("layer", LAYERS[0]),
    "Base Layer NBFCs",
  ],
  [
    "DNBS03",
    "Important Prudential Parameters",
    "Quarterly",
    null,
    "As specified in the Supervisory Returns Directions for the layer and type",
  ],
  [
    "DNBS04A",
    "Short Term Dynamic Liquidity",
    "Quarterly",
    null,
    "NBFCs to which the liquidity risk framework applies",
  ],
  [
    "DNBS04B",
    "Structural Liquidity and Interest Rate Sensitivity",
    "Monthly",
    null,
    "NBFCs to which the liquidity risk framework applies",
  ],
  [
    "DNBS08",
    "CRILC Main Return",
    "Monthly",
    null,
    "NBFCs reporting large exposures to the Central Repository of Information on Large Credits",
  ],
  [
    "DNBS09",
    "CRILC – Return on Defaulted Borrowers",
    "Weekly",
    null,
    "NBFCs reporting to the Central Repository of Information on Large Credits",
  ],
  ["DNBS10", "Statutory Auditor Certificate Return", "Annual", { const: true }, "All NBFCs"],
  [
    "DNBS11",
    "Core Investment Companies – Important Financial Parameters",
    "Quarterly",
    yes("CIC"),
    "Core Investment Companies",
  ],
  [
    "DNBS12",
    "Core Investment Companies – Important Prudential Parameters",
    "Quarterly",
    yes("CIC"),
    "Core Investment Companies",
  ],
  ["DNBS13", "Overseas Investment Details", "Quarterly", null, "NBFCs with overseas investments"],
  [
    "DNBS14",
    "Peer to Peer Lending Platforms – Financial and Prudential Parameters",
    "Quarterly",
    eq("cat", CATS[8]),
    "NBFC-P2P",
  ],
  [
    "FMR",
    "Fraud Monitoring Return and Fraud Update Application",
    "On occurrence",
    { const: true },
    "All NBFCs to which the fraud risk management directions apply",
  ],
  [
    "FMR-4",
    "Return on Robbery, Burglaries and Theft",
    "Quarterly",
    null,
    "As specified in the fraud risk management directions",
  ],
  [
    "Form A",
    "Certificate on appointment of statutory auditor",
    "Annual",
    null,
    "As specified in the statutory auditor appointment directions",
  ],
  [
    "DLA list",
    "Reporting of digital lending apps on the CIMS portal",
    "On deployment or cessation",
    yes("DL"),
    "NBFCs using digital lending apps",
  ],
];
// build_applicability.py `chk`, the first five (the last two count results and are built in).
const CHECKS = [
  [
    "Company name and total assets are entered",
    { all: [{ answered: "name" }, { gt: ["assets", "0"] }] },
  ],
  [
    "A deposit-taking company is not shown in the Base Layer",
    { not: { all: [yes("DEP"), eq("layer", LAYERS[0])] } },
  ],
  [
    "A Housing Finance Company is not shown in the Base Layer",
    { not: { all: [yes("HFC"), eq("layer", LAYERS[0])] } },
  ],
  ["Top 1,000 listed entity is marked as listed", { any: [{ not: yes("TOP") }, yes("LISTED")] }],
  [
    "Default loss guarantee is used only with digital lending or co-lending",
    { any: [{ not: yes("DLG") }, yes("DL"), yes("COL")] },
  ],
];

function appM01() {
  const map = json(`${RULES}maps/app_map.json`);
  const reg = json(`${RULES}data/applicability_register.json`);
  const rules = json(`${RULES}maps/app_rules.json`);
  const questions = Q.map(([code, kind, options], i) => {
    const m = map.find((x) => x.sheet === "Profile" && x.cell === `B${4 + i}`);
    if (!m || m.key !== `profile.${code.toLowerCase()}`) throw new Error(`question ${code}`);
    return { code, label: m.label, kind, ...(options ? { options } : {}) };
  });
  return {
    kind: "layered",
    id: "app-m01-nbfc",
    version: VERSION,
    effectiveFrom: EFFECTIVE_FROM,
    model: "APP-M01",
    title: "Applicability Engine for NBFCs",
    citation: "NBFC Policy Register of the Scope of Work pack (APP-M01)",
    layers: LAYERS,
    layerQuestion: "layer",
    nameQuestion: "name",
    categoryQuestion: "cat",
    assetsQuestion: "assets",
    questions,
    derived: DER.map(([code, label, rule]) => ({ code, label, rule })),
    policies: rules.map((x) => ({
      no: x.no,
      group: x.group,
      policy: x.policy,
      type: x.type,
      answers: [x.base_layer, x.middle_layer, x.upper_layer],
      ...(x.condition_rule ? { condition: x.condition_rule } : {}),
      ...(x.category_gate ? { gate: x.category_gate } : {}),
      // build_applicability.py: line 45's unmet condition gives "Good practice".
      whenNotMet: x.no === 45 ? "good_practice" : "does_not_apply",
      conditionText: x.condition_text ?? "",
      legalBasis: x.legal_basis ?? "",
    })),
    committees: reg.committees.map((r) => ({
      no: String(r[0]),
      name: r[1],
      legalBasis: r[2] ?? "",
      answers: [r[3], r[4], r[5]],
      note: r[6] ?? "",
    })),
    returns: RET.map(([code, name, frequency, rule, who]) => ({
      code,
      name,
      frequency,
      ...(rule ? { rule } : {}),
      who,
    })),
    checks: CHECKS.map(([name, rule]) => ({ name, rule })),
  };
}

// ---- APP-M02 to M07 (sector) --------------------------------------------------------------------
const SECTORS = [
  [
    "sebi listed",
    "APP-M02",
    "app-m02-sebi-listed",
    "02 Sector Applicability Engines/SEBI/APP-M02 Applicability Engine for SEBI Listed Entities.xlsx",
  ],
  [
    "sebi intermediaries",
    "APP-M03",
    "app-m03-sebi-intermediaries",
    "02 Sector Applicability Engines/SEBI/APP-M03 Applicability Engine for SEBI Market Intermediaries.xlsx",
  ],
  [
    "ifsca",
    "APP-M04",
    "app-m04-ifsca",
    "02 Sector Applicability Engines/IFSCA/APP-M04 Applicability Engine for IFSCA Entities.xlsx",
  ],
  [
    "irdai",
    "APP-M05",
    "app-m05-irdai",
    "02 Sector Applicability Engines/IRDAI/APP-M05 Applicability Engine for Insurance Intermediaries.xlsx",
  ],
  [
    "cooperative",
    "APP-M06",
    "app-m06-cooperative",
    "02 Sector Applicability Engines/Co-operative Societies/APP-M06 Applicability Engine for Co-operative Societies.xlsx",
  ],
  [
    "payments",
    "APP-M07",
    "app-m07-payments",
    "02 Sector Applicability Engines/Payments and Fintech/APP-M07 Applicability Engine for Payment System Operators and Fintech Entities.xlsx",
  ],
];

/** Each sheet's formula text by cell (`D7` → `IF(...)`), from the workbook's XML. */
function formulas(bytes) {
  const z = readZip(bytes);
  const t = (p) => z.get(p).toString("utf8");
  const un = (s) =>
    s
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, "&");
  const rels = new Map();
  for (const m of t("xl/_rels/workbook.xml.rels").matchAll(/<Relationship\b[^>]*>/g))
    rels.set(
      /\bId="([^"]+)"/.exec(m[0])[1],
      /\bTarget="([^"]+)"/.exec(m[0])[1].replace(/^\/?(xl\/)?/, "xl/"),
    );
  const out = new Map();
  for (const m of t("xl/workbook.xml").matchAll(/<sheet\b[^>]*>/g)) {
    const name = un(/\bname="([^"]*)"/.exec(m[0])[1]);
    const cells = new Map();
    for (const c of t(rels.get(/\br:id="([^"]+)"/.exec(m[0])[1])).matchAll(
      /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g,
    )) {
      const ref = /\br="([A-Z]+[0-9]+)"/.exec(c[1] ?? "")?.[1];
      const f = c[2] && /<f[^>]*>([^<]*)<\/f>/.exec(c[2]);
      if (ref && f) cells.set(ref, un(f[1]));
    }
    out.set(name, cells);
  }
  return out;
}

/** The literals of `CHOOSE('Profile'!$B$7,"Yes",…)` in `f`. */
export function chooseAnswers(f) {
  const m = /CHOOSE\('Profile'!\$B\$7,((?:"[^"]*",?)+)\)/.exec(f);
  if (!m) throw new Error(`no CHOOSE in ${f}`);
  return [...m[1].matchAll(/"([^"]*)"/g)].map((x) => x[1]);
}

function sector([key, model, id, rel]) {
  const data = json(`${RULES}data/sector_engines.json`)[key];
  const rules = json(`${RULES}maps/${model.toLowerCase().replace("-", "")}_rules.json`);
  const bytes = filed(rel);
  const sheets = new Map(readXlsx(new Uint8Array(bytes)).map((s) => [s.name, s.rows]));
  const f = formulas(new Uint8Array(bytes));
  const profile = sheets.get("Profile");
  const head = profile.findIndex((r) => r?.[0] === "Key");
  const questions = [];
  for (let r = head + 1; r < profile.length && profile[r]?.[0]; r++)
    questions.push({ code: String(profile[r][0]), label: String(profile[r][1]) });
  const cm = sheets.get("Committees and Roles");
  const committees = [];
  for (let r = 6; r < cm.length && cm[r]?.[1]; r++) {
    const ans = chooseAnswers(f.get("Committees and Roles").get(`D${r + 1}`));
    committees.push({
      no: Number(cm[r][0]),
      name: String(cm[r][1]),
      legalBasis: String(cm[r][2] ?? ""),
      answers: Object.fromEntries(data.codes.map((c, i) => [c, ans[i]])),
      note: String(cm[r][6] ?? ""),
    });
  }
  const title = String(sheets.get("ReadMe")?.[0]?.[0] ?? model);
  return {
    kind: "sector",
    id,
    version: VERSION,
    effectiveFrom: EFFECTIVE_FROM,
    model,
    title: title.length > 3 ? title : model,
    citation: `Policy Register of the sector, Scope of Work pack (${model})`,
    categories: data.codes.map((c, i) => ({ code: c, label: data.categories[i] })),
    questions,
    policies: rules.map((x) => ({
      no: Number(x.no),
      group: x.group,
      policy: x.policy,
      type: x.type,
      answers: x.answers,
      question: x.question ?? null,
      condition: x.condition ?? "",
    })),
    committees,
  };
}

const write = (name, typeName, pack) =>
  writeFileSync(
    `${OUT}${name}.ts`,
    `// GENERATED by scripts/app-packs.mjs from docs/regulatory-models (${pack.model}); do not edit.\n` +
      `// src/__tests__/app.oracle.test.ts checks it against the filed workbook's formulas.\n` +
      `import type { ${typeName} } from "../applicability.js";\n\n` +
      `export const ${name.toUpperCase().replace(/-/g, "_")}: ${typeName} = ${JSON.stringify(pack, null, 2)};\n`,
  );

write("app-m01", "LayeredPack", appM01());
for (const s of SECTORS) write(s[1].toLowerCase(), "SectorPack", sector(s));
console.log("applicability packs written:", ["APP-M01", ...SECTORS.map((s) => s[1])].join(", "));
