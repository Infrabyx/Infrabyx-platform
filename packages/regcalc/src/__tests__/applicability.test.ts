// `applicability` beyond the oracles (R1-regcalc plan §2): an unanswered question gives
// `needs_answer`, never a guess; a pack that fails its schema or names an unknown code is refused
// `rule_pack_invalid`; the same profile and pack always give the same answer.
import { describe, expect, it } from "vitest";
import {
  APP_M01,
  APP_M02,
  DEFAULT_APPLICABILITY_PACKS,
  applicability,
  applicabilityPack,
  parseCondition,
  type LayeredPack,
  type Profile,
  type SectorPack,
} from "../index.js";

const yesNo = (v: "Yes" | "No") =>
  Object.fromEntries(APP_M01.questions.filter((q) => q.kind === "yes_no").map((q) => [q.code, v]));
const nbfc = (over: Record<string, string | undefined> = {}): Profile => ({
  name: "Test NBFC (synthetic)",
  date: "2026-03-31",
  layer: "Base Layer",
  cat: "Investment and Credit Company",
  assets: "750",
  ...yesNo("No"),
  ...over,
});
const line = (out: ReturnType<typeof applicability>, no: number) =>
  out.policies.find((x) => x.no === no)!;

describe("the owner's condition grammar", () => {
  it("binds `and` tighter than `or`, and keeps the constants", () => {
    expect(parseCondition("DEP and BR10 or A5000 and CUST")).toEqual({
      any: [
        { all: [{ yes: "DEP" }, { yes: "BR10" }] },
        { all: [{ yes: "A5000" }, { yes: "CUST" }] },
      ],
    });
    expect(parseCondition("A100")).toEqual({ yes: "A100" });
    expect(parseCondition("TRUE")).toEqual({ const: true });
    expect(() => parseCondition("A100 or (DEP)")).toThrow(
      expect.objectContaining({ reason: "rule_pack_invalid" }),
    );
  });
});

describe("layered (APP-M01)", () => {
  it("decides a Conditional line from the derived thresholds", () => {
    // Line 69 is Conditional for the Base Layer on "A500 or HFC".
    const x = APP_M01.policies.find((p) => p.no === 69)!;
    expect(x.condition).toBe("A500 or HFC");
    expect(line(applicability(APP_M01, nbfc({ assets: "750" })), 69).final).toBe("applies");
    expect(line(applicability(APP_M01, nbfc({ assets: "499.99" })), 69).final).toBe(
      "does_not_apply",
    );
  });

  it("an unanswered question gives needs_answer, never a guess (the workbook reads blank as No)", () => {
    const out = applicability(APP_M01, nbfc({ assets: undefined }));
    expect(line(out, 69)).toMatchObject({ conditionMet: "Unanswered", final: "needs_answer" });
    expect(out.derived.A500).toBeNull();
    // A rule decided either way without the answer is still decided: "A100 or DEP" with DEP Yes.
    const dep = applicability(APP_M01, nbfc({ assets: undefined, DEP: "Yes" }));
    expect(line(dep, 42).final).not.toBe("needs_answer");
    // No layer: nothing is decided.
    const none = applicability(APP_M01, nbfc({ layer: undefined }));
    // (A line for one category only is still closed by its gate, as in the workbook.)
    const gated = new Set(APP_M01.policies.filter((p) => p.gate).map((p) => p.no));
    expect(
      none.policies.filter((x) => !gated.has(x.no)).every((x) => x.final === "needs_answer"),
    ).toBe(true);
    expect(
      none.policies.filter((x) => gated.has(x.no)).every((x) => x.final === "does_not_apply"),
    ).toBe(true);
    expect(none.committees.every((x) => x.answer === null)).toBe(true);
  });

  it("a category gate closes a line whatever the layer says, and an override replaces the result", () => {
    // Lines 118 to 120 are for Account Aggregators only (118 is "Yes" for the Base Layer).
    expect(line(applicability(APP_M01, nbfc()), 118).final).toBe("does_not_apply");
    const aa = applicability(APP_M01, nbfc({ cat: "Account Aggregator" }));
    expect(line(aa, 118).final).not.toBe("does_not_apply");
    const o = applicability(APP_M01, nbfc(), { override: { 118: "Applies" } });
    expect(line(o, 118)).toMatchObject({
      result: "does_not_apply",
      final: "applies",
      overridden: true,
    });
  });

  it("refuses a layer that is not one of the pack's and a profile answer that is not a string", () => {
    expect(() => applicability(APP_M01, nbfc({ layer: "Top Layer" }))).toThrow(
      expect.objectContaining({ reason: "input_invalid", field: "layer" }),
    );
    expect(() => applicability(APP_M01, { ...nbfc(), assets: 750 as unknown as string })).toThrow(
      expect.objectContaining({ reason: "input_invalid" }),
    );
    expect(() => applicability(APP_M01, nbfc({ assets: "7,50" }))).toThrow(
      expect.objectContaining({ reason: "input_invalid" }),
    );
  });

  it("gives the same answer for the same profile and pack", () => {
    const a = JSON.stringify(applicability(APP_M01, nbfc(), { inPlace: { 1: "Yes" } }));
    expect(
      JSON.stringify(applicability(structuredClone(APP_M01), nbfc(), { inPlace: { 1: "Yes" } })),
    ).toBe(a);
  });
});

describe("sector (APP-M02)", () => {
  const cat = APP_M02.categories[3]!; // debt-only listed: line 1 is Conditional on BIG
  const x = APP_M02.policies.find((p) => p.no === 1)!;
  it("settles a Conditional line by its question; a line answer takes precedence", () => {
    expect(x.answers[cat.code]).toBe("Conditional");
    expect(x.question).toBe("BIG");
    const at = (BIG: string | undefined, k?: "Yes" | "No") =>
      line(
        applicability(
          APP_M02,
          { name: "Synthetic Co", category: cat.label, BIG },
          k ? { conditionMet: { 1: k } } : {},
        ),
        1,
      );
    expect(at("Yes").final).toBe("applies");
    expect(at("No").final).toBe("does_not_apply");
    expect(at("In part")).toMatchObject({
      final: "check_condition",
      label: "Confirm the condition",
    });
    expect(at(undefined)).toMatchObject({ final: "needs_answer", label: "Confirm the condition" });
    expect(at("No", "Yes").final).toBe("applies");
    expect(at("Yes", "No").final).toBe("does_not_apply");
  });

  it("decides nothing until the category is one of the pack's", () => {
    for (const category of [undefined, "Not a category"]) {
      const out = applicability(APP_M02, { name: "Synthetic Co", category });
      expect(out.policies.every((p) => p.final === "needs_answer" && p.label === "")).toBe(true);
      expect(out.checks.find((c) => c.name.startsWith("The category"))!.ok).toBe(false);
    }
  });
});

describe("packs", () => {
  it("every default pack passes its own checks", () => {
    for (const p of Object.values(DEFAULT_APPLICABILITY_PACKS))
      expect(applicabilityPack(p)).toBeTruthy();
  });

  it("refuses a pack that fails its schema, repeats a line or names an unknown code", () => {
    const bad = (p: unknown) =>
      expect(() => applicabilityPack(p)).toThrow(
        expect.objectContaining({ reason: "rule_pack_invalid" }),
      );
    bad({ ...APP_M01, kind: "other" });
    bad({ ...APP_M01, version: "1" });
    const m01 = structuredClone(APP_M01) as LayeredPack;
    m01.policies[1]!.no = m01.policies[0]!.no;
    bad(m01);
    const cond = structuredClone(APP_M01) as LayeredPack;
    cond.policies.find((p) => p.condition)!.condition = "A100 or NOPE";
    bad(cond);
    const gate = structuredClone(APP_M01) as LayeredPack;
    gate.policies[0]!.gate = "NOPE";
    bad(gate);
    const s = structuredClone(APP_M02) as SectorPack;
    delete (s.policies[0]!.answers as Record<string, string>)[s.categories[0]!.code];
    bad(s);
    const q = structuredClone(APP_M02) as SectorPack;
    q.policies.find((p) => p.question)!.question = "NOPE";
    bad(q);
  });
});
