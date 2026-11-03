// PR-UDF-025: DLT and WhatsApp values go in the template's order, not jsonb's (R1-D-54).
import { describe, expect, it } from "vitest";
import { positional } from "./service.js";

describe("positional template values (PR-UDF-025)", () => {
  // jsonb returned Udofin's `{reference, re_name, help_link}` in this order.
  const fromJsonb = { re_name: "Acme", help_link: "https://h", reference: "R-1" };

  it("follows the template's vars list, whatever order the row came back in", () => {
    expect(positional(fromJsonb, ["reference", "re_name", "help_link"], "c")).toEqual([
      "R-1",
      "Acme",
      "https://h",
    ]);
  });

  it("refuses to send when a named variable is missing", () => {
    expect(() => positional({ reference: "R-1" }, ["reference", "re_name"], "udf.x")).toThrow(
      expect.objectContaining({
        code: "IPB-PORT-001",
        meta: expect.objectContaining({ reason: "template_variable_missing" }),
      }),
    );
  });

  it("without a list, sorts names naturally so positional keys keep their order", () => {
    expect(positional({ v10: "j", v2: "b", v1: "a" }, undefined, "c")).toEqual(["a", "b", "j"]);
  });
});
