// PR-UDF-088 (R1-D-296): an SMS value over 30 characters or more than 10 variables is refused with
// IPB-NTF-008, never cut. The problem names the variable and the lengths, never the value.
import { describe, expect, it } from "vitest";
import { SMS_MAX_VARS, SMS_VAR_MAX_LENGTH, smsVars } from "./service.js";

const officer = "Ms A. Rao, +91 80 1234 5678 ext"; // 31 characters

describe("smsVars (PR-UDF-088)", () => {
  it("exports DLT's limits", () => {
    expect([SMS_VAR_MAX_LENGTH, SMS_MAX_VARS]).toEqual([30, 10]);
  });

  it("passes values up to the limits unchanged, in the template's order", () => {
    const thirty = "x".repeat(30);
    const ten = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`v${i + 1}`, i + 1]));
    expect(smsVars({ b: thirty, a: 5 }, ["a", "b"], "c")).toEqual(["5", thirty]);
    expect(smsVars(ten, undefined, "c")).toEqual([
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
      "9",
      "10",
    ]);
  });

  it("refuses a value over 30 characters, naming the variable but not the value", () => {
    expect(officer).toHaveLength(31);
    let e: unknown;
    try {
      smsVars(
        { reference: "R-1", grievance_officer: officer },
        ["reference", "grievance_officer"],
        "udf.recovery",
      );
    } catch (x) {
      e = x;
    }
    expect(e).toMatchObject({
      code: "IPB-NTF-008",
      meta: {
        reason: "sms_var_too_long",
        class: "udf.recovery",
        variable: "grievance_officer",
        position: 2,
        length: 31,
        max: 30,
        definite: true,
      },
    });
    expect(
      JSON.stringify({ m: (e as Error).message, meta: (e as { meta: unknown }).meta }),
    ).not.toContain("Rao");
  });

  it("refuses more than 10 variables rather than dropping the rest", () => {
    const eleven = Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`v${i + 1}`, "a"]));
    expect(() => smsVars(eleven, undefined, "c")).toThrow(
      expect.objectContaining({
        code: "IPB-NTF-008",
        meta: expect.objectContaining({ reason: "sms_too_many_vars", count: 11, max: 10 }),
      }),
    );
  });

  it("counts characters as the contract does (String#length)", () => {
    expect(smsVars({ a: "क".repeat(30) }, ["a"], "c")).toEqual(["क".repeat(30)]);
    expect(() => smsVars({ a: "क".repeat(31) }, ["a"], "c")).toThrow(
      expect.objectContaining({ code: "IPB-NTF-008" }),
    );
  });
});
