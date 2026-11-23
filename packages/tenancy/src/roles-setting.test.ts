// `app.roles` (PR-UDF-084; R1-D-280): what the kernel sets from the verified context's roles.
import { describe, expect, it } from "vitest";
import { RoleSchema } from "@infrabyx/contracts/roles";
import type { KernelContext } from "@infrabyx/contracts/kernel";
import { MAX_DB_ROLE_LENGTH, rolesSetting } from "./kernel.js";

const ctx = (roles: string[]): KernelContext => ({
  tenantId: "tnt_a",
  principal: { id: "usr_a", type: "user", roles },
});

describe("R1-D-280 rolesSetting", () => {
  it("keeps every well-formed role, in order, once", () => {
    const roles = [
      "ORG_MEMBER",
      "PLT_AUDITOR_RO",
      "SVC_ECO_CONSUMER",
      "UDF_LENDER_CONTROLLER",
      "FN:CRO",
      "ORG_MEMBER",
    ];
    expect(rolesSetting(ctx(roles))).toBe(
      "ORG_MEMBER,PLT_AUDITOR_RO,SVC_ECO_CONSUMER,UDF_LENDER_CONTROLLER,FN:CRO",
    );
    for (const r of roles) expect(RoleSchema.safeParse(r).success, r).toBe(true);
  });

  it("leaves out anything else, so no comma or other character reaches the setting", () => {
    const bad = [
      "",
      "org_member",
      "UDF_A,UDF_SECURITY",
      "UDF_SECURITY ",
      "UDF_SECURITY'",
      "FN:cro",
      `UDF_${"X".repeat(MAX_DB_ROLE_LENGTH)}`,
    ];
    expect(rolesSetting(ctx(bad))).toBe("");
    expect(rolesSetting(ctx([...bad, "UDF_SECURITY"]))).toBe("UDF_SECURITY");
    expect(rolesSetting(ctx([`UDF_${"X".repeat(MAX_DB_ROLE_LENGTH - 4)}`]))).toHaveLength(128);
  });
});
