// Attachable modules (Spec §11.1; Finbyx PR-FBX-43; R1-D-107): the lifecycle edges, the status of a
// licence on a day, and the module and legal-hold event schemas (§6.14, §6.16).
import { describe, expect, it } from "vitest";
import {
  AttachableModule,
  EntitlementChangeInput,
  MODULE_STATES,
  canMoveModule,
  entitlementStatusOn,
} from "./module-lifecycle.js";
import {
  LEGAL_HOLD_CHANGED_TYPE,
  LegalHoldChangedData,
  MODULE_ATTACHED_TYPE,
  MODULE_DETACHED_TYPE,
  ModuleAttachedData,
  ModuleDetachedData,
} from "./events/module-events.js";
import { ECOSYSTEM_TYPE_REGEX } from "./events/envelope.js";

describe("module lifecycle (Spec §11.1)", () => {
  it("has the Specification's states and moves only along its edges", () => {
    expect(MODULE_STATES).toEqual([
      "AVAILABLE",
      "LICENSED",
      "INSTALLED",
      "CONFIGURED",
      "CERTIFIED",
      "ENABLED",
      "READ_ONLY",
      "DETACHED",
    ]);
    expect(canMoveModule("CERTIFIED", "ENABLED")).toBe(true);
    expect(canMoveModule("ENABLED", "READ_ONLY")).toBe(true);
    expect(canMoveModule("READ_ONLY", "DETACHED")).toBe(true);
    expect(canMoveModule("INSTALLED", "ENABLED")).toBe(false);
    expect(canMoveModule("ENABLED", "DETACHED")).toBe(false);
    expect(canMoveModule("DETACHED", "ENABLED")).toBe(false);
  });

  it("reads a licence's status on a day from its latest version", () => {
    const g = { kind: "GRANT" as const, validFrom: "2026-11-01", validUntil: "2026-11-30" };
    expect(entitlementStatusOn(null, "2026-11-05")).toBe("NONE");
    expect(entitlementStatusOn(g, "2026-10-31")).toBe("NOT_YET");
    expect(entitlementStatusOn(g, "2026-11-01")).toBe("ACTIVE");
    expect(entitlementStatusOn(g, "2026-11-30")).toBe("ACTIVE");
    expect(entitlementStatusOn(g, "2026-12-01")).toBe("LAPSED");
    expect(entitlementStatusOn({ ...g, validUntil: null }, "2030-01-01")).toBe("ACTIVE");
    expect(
      entitlementStatusOn(
        { kind: "REVOKE", validFrom: "2026-11-02", validUntil: null },
        "2026-11-05",
      ),
    ).toBe("REVOKED");
  });

  it("validates a change and a registry entry", () => {
    const ok = {
      sku: "RECOVERY_CORE",
      kind: "GRANT",
      validFrom: "2026-11-01",
      reason: "signed order form",
    };
    expect(EntitlementChangeInput.safeParse(ok).success).toBe(true);
    expect(EntitlementChangeInput.safeParse({ ...ok, sku: "recovery" }).success).toBe(false);
    expect(EntitlementChangeInput.safeParse({ ...ok, validUntil: "2026-10-01" }).success).toBe(
      false,
    );
    expect(
      EntitlementChangeInput.safeParse({ ...ok, kind: "REVOKE", validUntil: "2026-12-01" }).success,
    ).toBe(false);
    const m = {
      id: "recovery.r1",
      version: "1.0.0",
      product: "FINBYX",
      requires: { modules: [], core: ["col", "lms"] },
      capabilities: ["mod.recovery.r1.cases"],
      eventsProduced: ["RecoveryCaseOpened", "LegalHoldChanged"],
      eventsConsumed: [],
      apis: ["/recovery-cases"],
      permissions: ["rec.case.open"],
      dataCategories: ["CONFIDENTIAL"],
      regulatoryRefs: ["RBI recovery directions"],
      retentionClass: "RECOVERY_CASE_FILE",
      licenceSku: "RECOVERY_CORE",
      uiSlots: ["recovery.cases"],
    };
    expect(AttachableModule.parse(m).migrations).toEqual([]);
    expect(AttachableModule.safeParse({ ...m, id: "R1" }).success).toBe(false);
  });
});

describe("module and legal-hold events (Spec §6.14, §6.16)", () => {
  it("are ecosystem types with the Specification's fields", () => {
    for (const t of [MODULE_ATTACHED_TYPE, MODULE_DETACHED_TYPE, LEGAL_HOLD_CHANGED_TYPE])
      expect(ECOSYSTEM_TYPE_REGEX.test(t), t).toBe(true);
    const ent = { entitlement_id: "lic_01J9ZC9Q2K7M8N3P4R5S6T7V8W", entitlement_version: 1 };
    expect(
      ModuleAttachedData.safeParse({
        module_id: "recovery.r1",
        version: "1.0.0",
        capabilities: ["mod.recovery.r1.cases"],
        sku: "RECOVERY_CORE",
        ...ent,
        approvers: ["usr_sec"],
      }).success,
    ).toBe(true);
    expect(
      ModuleDetachedData.safeParse({
        module_id: "recovery.r1",
        mode: "READ_ONLY",
        detached_at: "2026-11-05T10:00:00Z",
        export_pack_sha256: null,
        records_on_hold: 12,
        ...ent,
      }).success,
    ).toBe(true);
    expect(
      ModuleDetachedData.safeParse({ module_id: "recovery.r1", mode: "DELETED" }).success,
    ).toBe(false);
    expect(
      LegalHoldChangedData.safeParse({
        hold_id: "hld_1",
        version: 1,
        state: "APPLIED",
        scope: { kind: "LOAN", ref: "loan_1" },
        reason: "suit filed",
        start: "2026-11-05",
        end: null,
      }).success,
    ).toBe(true);
    expect(
      LegalHoldChangedData.safeParse({
        hold_id: "hld_1",
        version: 1,
        state: "APPLIED",
        scope: { kind: "ACCOUNT", ref: "x" },
        reason: "suit filed",
        start: "2026-11-05",
        end: null,
      }).success,
    ).toBe(false);
  });
});
