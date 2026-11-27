// The EWS library beyond the worked example (R1-regcalc plan §2 contract cases; R1-D-308).
import { describe, expect, it } from "vitest";
import { ewsPack, ewsScores, type EwsPack } from "../index.js";

const pack: EwsPack = {
  id: "t",
  version: "1.0.0",
  effectiveFrom: "2026-01-01",
  indicators: [
    {
      no: 1,
      name: "a",
      family: "Transactional data",
      type: "Quantitative",
      weight: "10",
      critical: false,
      active: true,
    },
    {
      no: 2,
      name: "b",
      family: "Conduct of the borrower",
      type: "Qualitative",
      weight: "0",
      critical: false,
      active: true,
    },
    {
      no: 3,
      name: "c",
      family: "Market intelligence",
      type: "Qualitative",
      weight: "5",
      critical: true,
      active: true,
    },
  ],
  amberFrom: "10",
  redFrom: "25",
  criticalForcesRed: true,
  examinationDays: 30,
  returnDays: 14,
  captureTarget: "0.8",
};
const acc = (present: number[]) => ({ accountId: "x", exposure: "100", present });

describe("ews", () => {
  it("a weight of 0 adds nothing and is not counted present; a critical makes the account red", () => {
    const [a, b, c] = ewsScores([acc([2]), acc([1]), acc([3])], pack, "2026-09-30");
    expect([a!.score.toString(), a!.indicatorsPresent, a!.alert]).toEqual(["0", 0, "GREEN"]);
    expect(b!.alert).toBe("AMBER");
    expect([c!.score.toString(), c!.alert]).toEqual(["5", "RED"]);
  });

  it("thresholds are data: a new pack changes the result without code", () => {
    const [x] = ewsScores([acc([1])], { ...pack, amberFrom: "11" }, "2026-09-30");
    expect(x!.alert).toBe("GREEN");
  });

  it("refuses an unknown indicator, a duplicate number and a return deadline looser than para 43", () => {
    expect(() => ewsScores([acc([9])], pack, "2026-09-30")).toThrow(
      expect.objectContaining({ reason: "input_out_of_range" }),
    );
    expect(() =>
      ewsPack({ ...pack, indicators: [pack.indicators[0], pack.indicators[0]] }),
    ).toThrow(expect.objectContaining({ reason: "rule_pack_invalid" }));
    expect(() => ewsPack({ ...pack, returnDays: 21 })).toThrow(
      expect.objectContaining({ reason: "rule_pack_invalid" }),
    );
  });

  it("follows up an alert: days open, the examination band and the return due", () => {
    const [x] = ewsScores(
      [
        {
          ...acc([1]),
          alertOn: "2026-08-01",
          status: "Classified as fraud",
          examinationClosedOn: "2026-09-10",
          classifiedAsFraudOn: "2026-09-10",
        },
      ],
      pack,
      "2026-09-30",
    );
    expect(x!.daysOpen).toBe(40);
    expect(x!.examination).toBe("AMBER");
    expect(x!.returnDueOn).toBe("2026-09-24");
    expect(x!.returnStatus).toBe("RED");
    expect(x!.modelAlertOnConfirmed).toBe("Yes");
  });
});
