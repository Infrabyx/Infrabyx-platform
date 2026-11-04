// The tenant's mc.* keys read for the approvals engine (PL3-D-08; #106, R1-D-89).
import { describe, expect, it } from "vitest";
import type { KernelContext } from "@infrabyx/contracts/kernel";
import { settingsApprovalPolicy } from "./policy.js";

const ctx = {
  tenantId: "tnt_a",
  principal: { id: "usr_a", type: "user", roles: [] },
} as KernelContext;

describe("settingsApprovalPolicy", () => {
  it("reads mc.expiry_hours.<action> beside the checker roles and the dual threshold", async () => {
    const values: Record<string, unknown> = {
      "mc.expiry_hours.payments_refund": 12,
      "mc.dual_checker_above.payments_refund": 500,
    };
    const p = settingsApprovalPolicy({
      async get(_c, key) {
        if (!(key in values)) throw new Error("unset");
        return values[key];
      },
    });
    expect(await p.tenantPolicy(ctx, "payments.refund")).toEqual({
      checkerRoles: null,
      dualCheckerAbove: 500,
      expiryHours: 12,
    });
    expect(await p.tenantPolicy(ctx, "org.setting.change")).toEqual({
      checkerRoles: null,
      dualCheckerAbove: null,
      expiryHours: null,
    });
  });
});
