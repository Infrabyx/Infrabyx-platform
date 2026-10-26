import { describe, expect, it } from "vitest";
import { AllowCache, agentGuard, platformPolicyBundle } from "../common.js";
import { contextualTuples } from "../openfga.js";

describe("AUTHZ adapter rules (PL2 plan §6.6)", () => {
  it("agents are denied the forbidden verbs before any PDP call (IPB-02-10)", () => {
    const agent = { id: "agt_1", roles: ["AGT_DRAFTER", "ORG_OWNER"] };
    for (const a of ["approve", "sign", "disburse", "delete", "grant"])
      expect(agentGuard(agent, a)?.allowed).toBe(false);
    expect(agentGuard(agent, "read")).toBeNull();
    expect(agentGuard({ id: "usr_1", roles: ["ORG_OWNER"] }, "approve")).toBeNull();
  });

  it("the allow cache keeps allows ≤ 5 s and never denials", () => {
    let t = 0;
    const c = new AllowCache(5_000, () => t);
    const k = c.key({ id: "u", roles: [] }, { kind: "k", id: "1" }, "read");
    c.put(k, { allowed: false });
    expect(c.hit(k)).toBe(false);
    c.put(k, { allowed: true });
    expect(c.hit(k)).toBe(true);
    t += 5_001;
    expect(c.hit(k)).toBe(false);
    expect(() => new AllowCache(5_001)).toThrow();
  });

  it("OpenFGA contextual tuples come only from roles and attributes, and skip malformed ids", () => {
    const tuples = contextualTuples(
      {
        id: "agt_1",
        roles: ["AGT_DRAFTER", "ORG_MAKER", "OPS_SUPPORT"],
        attr: { tenant_id: "tnt_a", product_scope: ["LD", "bad id"] },
      },
      {
        kind: "ipb_record",
        id: "rec_1",
        attr: { tenant_id: "tnt_a", product: "LD", maker_id: "usr_m" },
      },
    );
    expect(tuples).toEqual([
      { user: "user:agt_1", relation: "maker", object: "tenant:tnt_a" },
      { user: "user:agt_1", relation: "agent", object: "tenant:tnt_a" },
      { user: "user:agt_1", relation: "ops", object: "product:LD" },
      { user: "tenant:tnt_a", relation: "tenant", object: "ipb_record:rec_1" },
      { user: "product:LD", relation: "product", object: "ipb_record:rec_1" },
      { user: "user:usr_m", relation: "maker_of", object: "ipb_record:rec_1" },
      { user: "user:agt_1", relation: "agent_actor", object: "ipb_record:rec_1" },
    ]);
  });

  it("the policy pack ships with the package and is versioned by content", async () => {
    const c = await platformPolicyBundle("cerbos");
    expect(Object.keys(c.files)).toEqual([
      "derived_roles.ipb_platform.yaml",
      "resource.ipb_record.yaml",
    ]);
    expect(c.version).toMatch(/^[0-9a-f]{16}$/);
    expect(Object.keys((await platformPolicyBundle("openfga")).files)).toContain("model.json");
  });
});
