// APP-M01 to APP-M07, the owner's applicability engines (R1-regcalc plan §2; R1-D-311):
//   - APP-M01's worked example (fictitious NBFC): every output cell of the Profile thresholds,
//     Policies, Committees and Roles, Returns, Dashboard and Checks reproduced from its profile;
//   - APP-M02 to M07: the owner's worked examples (28 Nov 2026; R1-D-324), ComplyCl's recorded
//     inputs recalculated in Excel, replace the synthetic LibreOffice oracles: every formula cell
//     asserted. Their inputs set no condition or override, so sector-paths.test.ts keeps those paths
//     proved. A second, synthetic APP-M01 profile is made by scripts/app-fixtures.py;
//   - every pack line checked against the filed workbook's own formula for it, rebuilt from the
//     pack as the owner's builders write it, so a pack that drifts from the model fails.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "@infrabyx/crypto";
import {
  APP_M01,
  APP_M02,
  APP_M03,
  APP_M04,
  APP_M05,
  APP_M06,
  APP_M07,
  applicability,
  parseCondition,
  type ApplicabilityLines,
  type ApplicabilityResult,
  type GroupCount,
  type InPlace,
  type Profile,
  type Rule,
  type SectorPack,
} from "../index.js";
import { MODELS_ROOT, ORACLES, Oracle, filedHash, formulaText, openOracle } from "./oracle.js";

const FIXTURES = fileURLToPath(new URL("./fixtures/", import.meta.url));

/** A synthetic oracle (scripts/app-fixtures.py), after checking it against fixtures/SHA256SUMS. */
function openFixture(name: string): Oracle {
  const bytes = new Uint8Array(readFileSync(`${FIXTURES}${name}`));
  const line = readFileSync(`${FIXTURES}SHA256SUMS`, "utf8")
    .split("\n")
    .find((l) => l.endsWith(`  ${name}`));
  expect(line?.slice(0, 64), name).toBe(sha256Hex(bytes));
  return new Oracle(`fixtures/${name}`, bytes);
}

const str = (o: Oracle, sheet: string, ref: string) => {
  const v = o.value(sheet, ref);
  return v === null ? "" : String(v);
};
/** `x`, or a blank cell for "" and null. */
const cell = (o: Oracle, sheet: string, ref: string, x: string | number | null) =>
  x === null || x === "" ? o.blank(sheet, ref) : o.exact(sheet, ref, x);
type Counts = Omit<GroupCount, "group">;

// ---- APP-M01 (layered) --------------------------------------------------------------------------

const LAYERED_RESULT: Record<ApplicabilityResult, string> = {
  applies: "Applies",
  does_not_apply: "Does not apply",
  good_practice: "Good practice",
  check_condition: "Check the condition",
  needs_answer: "",
};

function layeredOracle(title: string, open: () => Oracle) {
  describe(title, () => {
    const o = open();
    const P = APP_M01;
    const profile: Record<string, string> = {};
    P.questions.forEach((q, i) => {
      const v = o.value("Profile", `B${4 + i}`);
      if (v === null || v === "") return;
      profile[q.code] = q.kind === "date" ? String(v).slice(0, 10) : String(v);
    });
    const override: Record<number, "Applies" | "Does not apply"> = {};
    const inPlace: Record<number, InPlace> = {};
    const committeeInPlace: Record<string, "Yes" | "No"> = {};
    const returnOnTime: Record<string, "Yes" | "No"> = {};
    P.policies.forEach((x, j) => {
      const m = str(o, "Policies", `M${7 + j}`);
      if (m) override[x.no] = m as "Applies" | "Does not apply";
      const ip = str(o, "Policies", `O${7 + j}`);
      if (ip) inPlace[x.no] = ip as InPlace;
    });
    P.committees.forEach((x, j) => {
      const e = str(o, "Committees and Roles", `E${7 + j}`);
      if (e) committeeInPlace[x.no] = e as "Yes" | "No";
    });
    P.returns.forEach((x, j) => {
      const f = str(o, "Returns", `F${7 + j}`);
      if (f) returnOnTime[x.code] = f as "Yes" | "No";
    });
    const lines: ApplicabilityLines = { override, inPlace, committeeInPlace, returnOnTime };
    const out = applicability(P, profile as Profile, lines);

    it("reproduces the derived thresholds", () => {
      P.derived.forEach((d, j) => o.exact("Profile", `B${53 + j}`, out.derived[d.code]!));
    });

    it("reproduces every policy line: the layer answer, the condition, the result, the gap", () => {
      out.policies.forEach((x, j) => {
        const r = 7 + j;
        o.exact("Policies", `J${r}`, x.answer!);
        cell(o, "Policies", `K${r}`, x.answer === "Conditional" ? x.conditionMet : "");
        o.exact("Policies", `L${r}`, LAYERED_RESULT[x.result]);
        o.exact("Policies", `N${r}`, x.label);
        cell(o, "Policies", `P${r}`, x.status);
      });
    });

    it("reproduces the committees and roles, and the returns", () => {
      out.committees.forEach((x, j) => {
        o.exact("Committees and Roles", `D${7 + j}`, x.answer!);
        o.exact("Committees and Roles", `F${7 + j}`, x.status!);
      });
      out.returns.forEach((x, j) => {
        o.exact("Returns", `D${7 + j}`, x.label);
        cell(o, "Returns", `G${7 + j}`, x.status);
      });
    });

    it("reproduces the dashboard and the checks", () => {
      o.exact("Dashboard", "A3", out.heading);
      const row = (r: number, g: Counts) => {
        o.exact("Dashboard", `B${r}`, g.lines);
        o.exact("Dashboard", `C${r}`, g.applies);
        o.exact("Dashboard", `D${r}`, g.goodPractice);
        o.exact("Dashboard", `E${r}`, g.inPlace);
        o.exact("Dashboard", `F${r}`, g.partly);
        o.exact("Dashboard", `G${r}`, g.missing);
        o.exact("Dashboard", `H${r}`, g.notAssessed);
      };
      out.groups.forEach((g, j) => {
        expect(str(o, "Dashboard", `A${6 + j}`)).toBe(g.group);
        row(6 + j, g);
      });
      const t = 6 + out.groups.length;
      row(t, out.totals);
      o.exact("Dashboard", `B${t + 2}`, out.checkTheCondition);
      o.rate("Dashboard", `B${t + 3}`, out.compliance!.ratio);
      cell(o, "Dashboard", `C${t + 3}`, out.compliance!.rag);
      o.exact("Dashboard", `B${t + 4}`, out.committeesRequired);
      o.exact("Dashboard", `B${t + 5}`, out.committeesMissing);
      o.exact("Dashboard", `B${t + 6}`, out.returnsApplying);
      P.derived.forEach((d, j) => o.exact("Dashboard", `B${t + 9 + j}`, out.derived[d.code]!));
      out.checks.forEach((c, j) => {
        expect(str(o, "Checks", `B${6 + j}`)).toBe(c.name);
        o.exact("Checks", `C${6 + j}`, c.ok ? "OK" : "CHECK");
      });
    });

    it("leaves no formula cell unchecked", () => {
      expect(o.uncovered()).toEqual([]);
    });
  });
}

layeredOracle("APP-M01 worked example (fictitious NBFC)", () => openOracle(ORACLES.app01));
layeredOracle("APP-M01 master, synthetic Upper Layer CIC profile (recalculated)", () =>
  openFixture("app-m01-synthetic.xlsx"),
);

const norm = (f: string) => f.replace(/'(Profile|Policies|Returns)'!/g, "$1!");

describe("APP-M01 pack against the master model's formulas (build_applicability.py)", () => {
  const rel = ORACLES.app01Master;
  const bytes = new Uint8Array(readFileSync(`${MODELS_ROOT}${rel}`));
  openOracle(rel, bytes); // the filed hash
  const f = formulaText(bytes);
  const P = APP_M01;
  const row = new Map<string, number>();
  P.questions.forEach((q, i) => row.set(q.code, 4 + i));
  P.derived.forEach((d, j) => row.set(d.code, 4 + P.questions.length + 2 + j));
  const G = (k: string) => `(Profile!$B$${row.get(k)!}="Yes")`;
  const cond = (r: Rule): string => {
    if ("const" in r) return r.const ? "TRUE" : "FALSE";
    if ("yes" in r) return G(r.yes);
    if ("all" in r) return `AND(${r.all.map(cond).join(",")})`;
    if ("any" in r) return `OR(${r.any.map(cond).join(",")})`;
    throw new Error("not in the owner's grammar");
  };
  const LAYN = 'MATCH(Profile!$B$6,{"Base Layer","Middle Layer","Upper Layer"},0)';

  it("every policy's layer answers, condition rule, category gate and results", () => {
    const sheet = f.get("Policies")!;
    P.policies.forEach((x, j) => {
      const r = 7 + j;
      expect(norm(sheet.get(`J${r}`)!), `line ${x.no}`).toBe(
        `CHOOSE(${LAYN},"${x.answers[0]}","${x.answers[1]}","${x.answers[2]}")`,
      );
      expect(norm(sheet.get(`K${r}`)!), `line ${x.no}`).toBe(
        x.condition
          ? `IF(J${r}<>"Conditional","",IF(${cond(parseCondition(x.condition))},"Yes","No"))`
          : `IF(J${r}<>"Conditional","","Check")`,
      );
      const met = x.type.startsWith("Recommended") ? "Good practice" : "Applies";
      const notMet = x.whenNotMet === "good_practice" ? "Good practice" : "Does not apply";
      const base = `IF(J${r}="No","Does not apply",IF(J${r}="Yes","${met}",IF(K${r}="Yes","${met}",IF(K${r}="Check","Check the condition","${notMet}"))))`;
      expect(norm(sheet.get(`L${r}`)!), `line ${x.no}`).toBe(
        x.gate ? `IF(${G(x.gate)},${base},"Does not apply")` : base,
      );
    });
  });

  it("every committee's layer answers, and which returns are left to confirm", () => {
    P.committees.forEach((x, j) =>
      expect(norm(f.get("Committees and Roles")!.get(`D${7 + j}`)!)).toBe(
        `CHOOSE(${LAYN},"${x.answers[0]}","${x.answers[1]}","${x.answers[2]}")`,
      ),
    );
    P.returns.forEach((x, j) => {
      const d = f.get("Returns")!.get(`D${7 + j}`)!;
      expect(d === '"Confirm"', x.code).toBe(x.rule === undefined);
    });
  });
});

// ---- APP-M02 to M07 (sector) --------------------------------------------------------------------

const SECTOR_RESULT: Record<ApplicabilityResult, string> = {
  applies: "Applies",
  does_not_apply: "Does not apply",
  good_practice: "Good practice",
  check_condition: "Confirm the condition",
  needs_answer: "Confirm the condition",
};

const SECTOR: Array<[keyof typeof ORACLES, keyof typeof ORACLES, SectorPack]> = [
  ["app02", "app02we", APP_M02],
  ["app03", "app03we", APP_M03],
  ["app04", "app04we", APP_M04],
  ["app05", "app05we", APP_M05],
  ["app06", "app06we", APP_M06],
  ["app07", "app07we", APP_M07],
];

for (const [key, worked, P] of SECTOR) {
  const q0 = Math.max(10, P.categories.length + 6);

  describe(`${P.model}, the owner's worked example (recalculated in Excel; R1-D-324)`, () => {
    const o = openOracle(ORACLES[worked]);
    const profile: Record<string, string> = {};
    const put = (k: string, ref: string) => {
      const v = str(o, "Profile", ref);
      if (v) profile[k] = v;
    };
    put("name", "B4");
    put("date", "B5");
    put("category", "B6");
    P.questions.forEach((q, i) => put(q.code, `C${q0 + 1 + i}`));
    const conditionMet: Record<number, "Yes" | "No"> = {};
    const override: Record<number, "Applies" | "Does not apply" | "Good practice"> = {};
    const inPlace: Record<number, InPlace> = {};
    const committeeInPlace: Record<string, "Yes" | "No"> = {};
    P.policies.forEach((x, j) => {
      const r = 7 + j;
      const k = str(o, "Policies", `K${r}`);
      if (k) conditionMet[x.no] = k as "Yes" | "No";
      const m = str(o, "Policies", `M${r}`);
      if (m) override[x.no] = m as "Applies";
      const ip = str(o, "Policies", `O${r}`);
      if (ip) inPlace[x.no] = ip as InPlace;
    });
    P.committees.forEach((x, j) => {
      const e = str(o, "Committees and Roles", `E${7 + j}`);
      if (e) committeeInPlace[String(x.no)] = e as "Yes" | "No";
    });
    const lines = { conditionMet, override, inPlace, committeeInPlace };
    const out = applicability(P, profile as Profile, lines);

    it("reproduces every output cell: policies, committees, dashboard and checks", () => {
      o.exact("Profile", "B7", P.categories.findIndex((c) => c.label === profile.category) + 1);
      out.policies.forEach((x, j) => {
        const r = 7 + j;
        o.exact("Policies", `J${r}`, x.answer!);
        o.exact("Policies", `L${r}`, SECTOR_RESULT[x.result]);
        o.exact("Policies", `N${r}`, x.label);
        cell(o, "Policies", `P${r}`, x.status);
      });
      out.committees.forEach((x, j) => {
        o.exact("Committees and Roles", `D${7 + j}`, x.answer!);
        o.exact("Committees and Roles", `F${7 + j}`, x.status!);
      });
      const row = (r: number, g: Counts) =>
        (
          [
            ["B", g.lines],
            ["C", g.applies],
            ["D", g.toConfirm],
            ["E", g.goodPractice],
            ["F", g.inPlace],
            ["G", g.partly],
            ["H", g.missing],
          ] as const
        ).forEach(([c, v]) => o.exact("Dashboard", `${c}${r}`, v));
      out.groups.forEach((g, j) => {
        expect(str(o, "Dashboard", `A${6 + j}`)).toBe(g.group);
        row(6 + j, g);
      });
      const t = 6 + out.groups.length;
      row(t, out.totals);
      o.exact("Dashboard", `B${t + 2}`, out.heading);
      out.checks.forEach((c, j) => {
        expect(str(o, "Checks", `B${6 + j}`)).toBe(c.name);
        o.exact("Checks", `C${6 + j}`, c.ok ? "OK" : "CHECK");
      });
      expect(o.uncovered()).toEqual([]);
    });
  });

  describe(`${P.model} pack against the filed master's formulas (build_sector_engine.py)`, () => {
    const rel = ORACLES[key];
    const bytes = new Uint8Array(readFileSync(`${MODELS_ROOT}${rel}`));
    const o = openOracle(rel, bytes);
    const f = formulaText(bytes);

    it("every pack line matches the workbook's formula for it", () => {
      const idx = `'Profile'!$B$7`;
      const codes = P.categories.map((c) => c.code);
      const choose = (a: Record<string, string>) =>
        `IF(${idx}="","",CHOOSE(${idx},${codes.map((c) => `"${a[c]}"`).join(",")}))`;
      const qrow = new Map(P.questions.map((q, i) => [q.code, q0 + 1 + i]));
      const sheet = f.get("Policies")!;
      P.policies.forEach((x, j) => {
        const r = 7 + j;
        expect(sheet.get(`J${r}`), `line ${x.no}`).toBe(choose(x.answers));
        const kc =
          x.question !== null
            ? `IF(K${r}<>"",K${r},'Profile'!$C$${qrow.get(x.question)!})`
            : `K${r}`;
        const base = x.type === "Recommended" ? '"Good practice"' : '"Applies"';
        expect(sheet.get(`L${r}`), `line ${x.no}`).toBe(
          `IF(J${r}="","",IF(J${r}="No","Does not apply",IF(J${r}="Conditional",IF(${kc}="Yes",${base},IF(${kc}="No","Does not apply","Confirm the condition")),${base})))`,
        );
      });
      P.committees.forEach((x, j) =>
        expect(f.get("Committees and Roles")!.get(`D${7 + j}`)).toBe(choose(x.answers)),
      );
      P.categories.forEach((c, i) => {
        expect(str(o, "Profile", `D${4 + i}`)).toBe(c.code);
        expect(str(o, "Profile", `E${4 + i}`)).toBe(c.label);
      });
      // The questions are the Profile sheet's, in order; the register lines each settles agree.
      P.questions.forEach((q, i) => expect(str(o, "Profile", `A${q0 + 1 + i}`)).toBe(q.code));
      for (const q of P.questions) {
        const settles = str(o, "Profile", `E${qrow.get(q.code)!}`)
          .split(",")
          .map((s) => Number(s.trim()))
          .filter((n) => n > 0);
        expect(
          P.policies.filter((x) => x.question === q.code).map((x) => x.no),
          q.code,
        ).toEqual(settles);
      }
    });
  });
}

it("the oracles are the filed copies", () => {
  for (const k of Object.keys(ORACLES) as Array<keyof typeof ORACLES>)
    expect(filedHash(ORACLES[k])).toMatch(/^[0-9a-f]{64}$/);
});
