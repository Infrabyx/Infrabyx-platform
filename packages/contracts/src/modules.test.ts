import { describe, expect, it } from "vitest";
import { defineModule, ModuleManifest, type ModuleManifestInput } from "./modules.js";

const example: ModuleManifestInput = {
  name: "cases",
  schema: "cases",
  boundedContext: "Dispute case lifecycle",
  owner: "EQ-core",
  publishes: ["in.eq.cases.CaseFiled.v1", "in.eq.cases.CaseClosed.v1"],
  consumes: ["in.eq.billing.InvoicePaid.v1", "in.infrabyx.identity.UserDeactivated.v1"],
  ports: ["STORAGE", "DOCGEN", "WORKFLOW", "ESIGN", "VIDEO_MEET"],
  settingsPrefix: "cases.",
  settings: ["cases.filing.fee_rule_id", "cases.timers.response_days"],
  helpKeys: ["hlp.cases.filing", "hlp.cases.timers"],
  dataClasses: ["CONFIDENTIAL", "REGULATED"],
  extractionReadiness: 2,
  rlsTables: ["cases.case", "cases.party", "cases.filing"],
};

describe("@IPB-01-AT-16 module manifest schema (IPB-01-10, §01.4.3.2)", () => {
  it("accepts the IPB-01 example manifest", () => {
    expect(defineModule(example).name).toBe("cases");
  });
  it("rejects RLS tables outside the module schema (IPB-01-09)", () => {
    const r = ModuleManifest.safeParse({ ...example, rlsTables: ["loans.loan"] });
    expect(r.success).toBe(false);
  });
  it("rejects settings outside the prefix, unknown ports and bad readiness", () => {
    expect(ModuleManifest.safeParse({ ...example, settings: ["other.x"] }).success).toBe(false);
    expect(ModuleManifest.safeParse({ ...example, ports: ["FAX"] }).success).toBe(false);
    expect(ModuleManifest.safeParse({ ...example, extractionReadiness: 4 }).success).toBe(false);
    expect(ModuleManifest.safeParse({ ...example, extra: true }).success).toBe(false);
  });
});
