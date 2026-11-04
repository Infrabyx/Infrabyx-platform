// The sandbox refusal at the AI gateways (PR-LDC-29; R1-D-87): above INTERNAL is refused in a
// sandbox tenant (or one whose flag is unknown), with IPB-PORT-003 and the run's flag.
import { describe, expect, it } from "vitest";
import { isSandboxed } from "@infrabyx/contracts/kernel";
import { assertSandboxAllows, SANDBOX_REFUSED_FLAG } from "./sandbox.js";

describe("assertSandboxAllows (R1-D-87)", () => {
  it("refuses CONFIDENTIAL, REGULATED and SECRET in a sandbox and allows PUBLIC and INTERNAL", () => {
    for (const c of ["PUBLIC", "INTERNAL"] as const) {
      const flags: string[] = [];
      expect(() => assertSandboxAllows(true, c, flags)).not.toThrow();
      expect(flags).toEqual([]);
    }
    for (const c of ["CONFIDENTIAL", "REGULATED", "SECRET"] as const) {
      const flags: string[] = [];
      expect(() => assertSandboxAllows(true, c, flags)).toThrow(
        expect.objectContaining({ code: "IPB-PORT-003" }),
      );
      expect(flags).toEqual([SANDBOX_REFUSED_FLAG]);
      expect(() => assertSandboxAllows(false, c, [])).not.toThrow();
    }
  });

  it("an unknown flag counts as a sandbox (fail closed)", () => {
    expect(isSandboxed({})).toBe(true);
    expect(isSandboxed({ sandbox: true })).toBe(true);
    expect(isSandboxed({ sandbox: false })).toBe(false);
    expect(() => assertSandboxAllows(isSandboxed({}), "CONFIDENTIAL", [])).toThrow();
  });
});
