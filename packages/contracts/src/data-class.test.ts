import { describe, expect, it } from "vitest";
import {
  atLeast,
  highestClass,
  residencyAllows,
  tierForSpecClass,
  DEFAULT_RESIDENCY_POLICY,
} from "./data-class.js";

describe("data classes (IPB-02 §02.4.3.1)", () => {
  it("orders tiers PUBLIC < INTERNAL < CONFIDENTIAL < REGULATED < SECRET", () => {
    expect(atLeast("SECRET", "REGULATED")).toBe(true);
    expect(atLeast("INTERNAL", "CONFIDENTIAL")).toBe(false);
    expect(highestClass(["INTERNAL", "REGULATED", "PUBLIC"])).toBe("REGULATED");
    expect(highestClass([])).toBe("PUBLIC");
  });

  it("maps every Ecosystem Spec §13.2 field class to exactly one tier", () => {
    expect(tierForSpecClass("PII")).toBe("CONFIDENTIAL");
    expect(tierForSpecClass("PII", { lendingOrKyc: true })).toBe("REGULATED");
    expect(tierForSpecClass("LEGAL")).toBe("CONFIDENTIAL");
    expect(tierForSpecClass("LEGAL", { privileged: true })).toBe("REGULATED");
    for (const c of ["SPI", "FINANCIAL", "HR", "WELLNESS", "CONSUMER_HELP"] as const) {
      expect(tierForSpecClass(c)).toBe("REGULATED");
    }
  });

  it("refuses REGULATED and CONFIDENTIAL payloads on GLOBAL adapters (IPB-01-16)", () => {
    expect(residencyAllows("GLOBAL", "REGULATED")).toBe(false);
    expect(residencyAllows("GLOBAL", "CONFIDENTIAL")).toBe(false);
    expect(residencyAllows("IN-ZR", "REGULATED")).toBe(true);
    expect(residencyAllows("IN-ZR", "SECRET")).toBe(false);
    expect(DEFAULT_RESIDENCY_POLICY.REGULATED[0]).toBe("IN-ZR");
  });
});
