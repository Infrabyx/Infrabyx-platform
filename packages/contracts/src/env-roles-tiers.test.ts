import { describe, expect, it } from "vitest";
import { AppEnv, isProdGuarded, isSeedRefused, isStagingGuarded, NO_SUPABASE_ENVS } from "./env.js";
import { RoleSchema, isAgentRole, mfaRequired, PLATFORM_ROLES, TENANT_ROLES } from "./roles.js";
import { RISK_POLICY, TENANT_DELETE_POLICY, displayTier, SETTING_TIERS } from "./tiers.js";

describe("environment catalogue (IPB-09-15) and guard groups (IPB-11 §11.2)", () => {
  it("has exactly the nine binding environments", () => {
    expect(AppEnv.options).toEqual([
      "local",
      "dev",
      "test",
      "preview",
      "staging",
      "pre-prod",
      "demo",
      "prod",
      "dr",
    ]);
  });
  it("applies prod rules to pre-prod and staging rules to demo and pre-prod", () => {
    expect(isProdGuarded("pre-prod")).toBe(true);
    expect(isProdGuarded("staging")).toBe(false);
    expect(isStagingGuarded("demo")).toBe(true);
    expect(isStagingGuarded("preview")).toBe(false);
  });
  it("refuses seeds in prod, dr and pre-prod (PL1-D-06)", () => {
    expect(["prod", "dr", "pre-prod"].every((e) => isSeedRefused(e as never))).toBe(true);
    expect(isSeedRefused("staging")).toBe(false);
    expect(NO_SUPABASE_ENVS).not.toContain("dev");
  });
});

describe("roles (PL1-D-05)", () => {
  it("contains the owner-approved platform and tenant floor", () => {
    expect(PLATFORM_ROLES).toContain("PLT_ACCESSIBILITY_LEAD");
    expect(PLATFORM_ROLES).toHaveLength(9);
    expect(TENANT_ROLES).toEqual([
      "ORG_OWNER",
      "ORG_ADMIN",
      "ORG_MAKER",
      "ORG_CHECKER",
      "ORG_MEMBER",
      "ORG_AUDITOR_RO",
    ]);
  });
  it("accepts prefixed OPS_, AGT_, SVC_ and product roles and rejects junk", () => {
    for (const r of ["OPS_SUPPORT", "AGT_VIDHI", "SVC_BILLING", "FBX_CREDIT_HEAD"])
      expect(RoleSchema.safeParse(r).success).toBe(true);
    for (const r of ["admin", "AGT_", "plt_super_admin"])
      expect(RoleSchema.safeParse(r).success).toBe(false);
    expect(isAgentRole("AGT_VIDHI")).toBe(true);
  });
  it("requires MFA for platform, OPS_ and admin roles (IPB-02-02)", () => {
    expect(mfaRequired(["ORG_MEMBER"])).toBe(false);
    expect(mfaRequired(["ORG_CHECKER"])).toBe(true);
    expect(mfaRequired(["OPS_FINANCE"])).toBe(true);
  });
});

describe("tiers and risk classes (IPB-07-38, IPB-02 §02.4.6.1)", () => {
  it("orders tiers PLATFORM → USER", () => {
    expect(SETTING_TIERS).toEqual(["PLATFORM", "PLAN", "BRAND", "TENANT", "ENTITY", "USER"]);
    expect(displayTier("ENTITY")).toBe("ORG");
    expect(displayTier("PLAN")).toBe("PLATFORM");
  });
  it("encodes delays and agent rules", () => {
    expect(RISK_POLICY.R4.minDelayMinutes).toBe(60);
    expect(RISK_POLICY.R5.minDelayMinutes).toBe(72 * 60);
    expect(RISK_POLICY.R4.agentMayMake).toBe(false);
    expect(RISK_POLICY.R3.makerChecker).toBe("locked");
    expect(TENANT_DELETE_POLICY.checkers).toBe(2);
    expect(TENANT_DELETE_POLICY.minDelayMinutes).toBe(7 * 24 * 60);
  });
});
