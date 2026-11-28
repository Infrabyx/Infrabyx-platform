// The sector engines' condition and override paths (R1-D-324). The owner's worked examples of
// APP-M02 to APP-M07 (app.oracle.test.ts) reproduce every output cell from ComplyCl's recorded
// inputs, which set no "Condition met" answer and no override; these cases keep both paths proved
// for every sector pack, against the evaluator's rule as the masters' formulas write it.
import { describe, expect, it } from "vitest";
import {
  APP_M02,
  APP_M03,
  APP_M04,
  APP_M05,
  APP_M06,
  APP_M07,
  applicability,
  type Profile,
  type SectorPack,
} from "../index.js";

const PACKS: SectorPack[] = [APP_M02, APP_M03, APP_M04, APP_M05, APP_M06, APP_M07];

describe.each(PACKS.map((p) => [p.model, p] as const))("%s: condition and override", (_m, P) => {
  // A category and a Conditional line under it (every sector pack has one).
  const pick = P.categories
    .flatMap((c) =>
      P.policies.filter((x) => x.answers[c.code] === "Conditional").map((x) => ({ c, x })),
    )
    .find(Boolean)!;
  const profile = {
    name: "Synthetic entity",
    date: "2026-11-28",
    category: pick.c.label,
  } as Profile;
  const line = (lines: Parameters<typeof applicability>[2]) =>
    applicability(P, profile, lines).policies.find((y) => y.no === pick.x.no)!;
  const met = pick.x.type === "Recommended" ? "good_practice" : "applies";

  it("a Conditional line: Yes applies, No does not, unanswered needs an answer", () => {
    expect(pick).toBeDefined();
    expect(line({ conditionMet: { [pick.x.no]: "Yes" } })).toMatchObject({
      conditionMet: "Yes",
      final: met,
    });
    expect(line({ conditionMet: { [pick.x.no]: "No" } })).toMatchObject({
      conditionMet: "No",
      final: "does_not_apply",
    });
    expect(line({})).toMatchObject({
      conditionMet: "Unanswered",
      final: "needs_answer",
      label: "Confirm the condition",
      status: "AMBER",
    });
  });

  it("an override replaces the result and is marked", () => {
    const y = line({ conditionMet: { [pick.x.no]: "No" }, override: { [pick.x.no]: "Applies" } });
    expect(y).toMatchObject({ result: "does_not_apply", final: "applies", overridden: true });
    expect(
      line({ inPlace: { [pick.x.no]: "No" }, override: { [pick.x.no]: "Applies" } }).status,
    ).toBe("RED");
  });
});
