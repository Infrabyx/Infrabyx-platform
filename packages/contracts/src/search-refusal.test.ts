import { describe, expect, it } from "vitest";
import { luhnValid, searchRefusal, verhoeffValid } from "./search-refusal.js";

// A Verhoeff-valid twelve-digit number and a Verhoeff-valid sixteen-digit VID (synthetic).
const AADHAAR = "234567890124";
const VID = "9134567890123450";

describe("@IPB-07-AT-03 protected identifier patterns (IPB-07-17, IPB-UX-003)", () => {
  it("checks the Verhoeff and Luhn digits", () => {
    expect(verhoeffValid(AADHAAR)).toBe(true);
    expect(verhoeffValid("234567890123")).toBe(false);
    expect(verhoeffValid(VID)).toBe(true);
    expect(luhnValid("4111111111111111")).toBe(true);
    expect(luhnValid("4111111111111112")).toBe(false);
    expect(verhoeffValid("12a")).toBe(false);
  });

  it.each([
    ["2345 6789 0123", "aadhaar_pattern"],
    ["234567890123", "aadhaar_pattern"],
    ["2345-6789-0123", "aadhaar_pattern"],
    ["loan for 2345 6789 0124", "aadhaar_pattern"],
    [VID, "aadhaar_pattern"],
    ["ABCDE1234F", "pan_pattern"],
    ["pan abcde1234f please", "pan_pattern"],
    ["4111 1111 1111 1111", "card_pattern"],
    ["4111-1111-1111-1111", "card_pattern"],
    ["378282246310005", "card_pattern"],
  ])("refuses %s as %s and never echoes the text", (query, cls) => {
    const r = searchRefusal(query);
    expect(r).toEqual({ code: "IPB-UX-003", patternClass: cls, messageKey: "ui.search.refused" });
    expect(JSON.stringify(r)).not.toContain(query.replace(/\D/g, "").slice(0, 6) || query);
  });

  it("refuses full-width digits after normalisation", () => {
    expect(searchRefusal("２３４５６７８９０１２３")?.patternClass).toBe("aadhaar_pattern");
  });

  it.each([
    "Ratnaa Finance",
    "LN-2026-000123",
    "4111111111111112",
    "ABCDE12345",
    "XABCDE1234FY",
    "98765 43210",
    "",
  ])("lets %s through", (query) => {
    expect(searchRefusal(query)).toBeNull();
  });
});
