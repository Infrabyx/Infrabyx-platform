import { describe, expect, it } from "vitest";
import { IpbError } from "@infrabyx/contracts/errors";
import { CONSOLE_TREE, SETTINGS_TREE } from "./registry.generated.js";
import { SettingsRegistry, defaultRegistry } from "./registry.js";
import { resolve, tierAllowed } from "./resolve.js";
import { SettingsService } from "./service.js";
import { MemorySettingsStore } from "./store.js";
import type { SettingDef } from "./types.js";
import { assertValid, tightenError } from "./validate.js";
import { FakeApprovals, FakeAudit, FakeKernel, FakeOutbox, ctxFor } from "../__tests__/fakes.js";

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as IpbError).code;
  }
  return null;
};
const codeAsync = async (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: IpbError) => e.code,
  );

function setup(defs?: SettingDef[]) {
  const store = new MemorySettingsStore();
  const kernel = new FakeKernel();
  const audit = new FakeAudit();
  const outbox = new FakeOutbox();
  const approvals = new FakeApprovals();
  const registry = defs
    ? new SettingsRegistry([...defaultRegistry.all(), ...defs])
    : defaultRegistry;
  const svc = new SettingsService({
    store,
    kernel,
    audit,
    outbox,
    approvals,
    product: "FBX",
    registry,
  });
  return { store, kernel, audit, outbox, approvals, svc };
}

describe("@IPB-07-AT-04 settings tree order and names (data level)", () => {
  it("lists the 20 binding nodes in order", () => {
    expect(SETTINGS_TREE.map((n) => n.name)).toEqual([
      "Profile",
      "Security",
      "Privacy & consents",
      "Accessibility",
      "Appearance",
      "Notifications",
      "Customisation",
      "Organisation & people",
      "Billing",
      "Invoices",
      "Plans & subscription",
      "Storage & data",
      "Audit trails",
      "Integrations",
      "AI & Vidhi",
      "Feedback",
      "Tutorials & help",
      "Security & trust",
      "What's new",
      "About",
    ]);
    expect(CONSOLE_TREE.length).toBeGreaterThan(0);
  });
});

describe("@IPB-07-AT-05 unregistered setting key", () => {
  it("throws IPB-UX-007 at runtime", async () => {
    const { svc } = setup();
    expect(code(() => defaultRegistry.require("ux.experimental.foo"))).toBe("IPB-UX-007");
    // @ts-expect-error unregistered keys fail typecheck (IPB-01 §01.5)
    expect(await codeAsync(svc.get(ctxFor([]), "ux.experimental.foo"))).toBe("IPB-UX-007");
  });
  it("matches exact keys before templated patterns", () => {
    expect(defaultRegistry.require("int.storage.retention.tenant_override_days").tier).toBe(
      "TENANT",
    );
    expect(defaultRegistry.require("int.storage.retention.audit_days").tier).toBe("PLATFORM");
  });
});

// An ENTITY-tier, tighten-only fixture: the PL1 registry has no ENTITY keys yet (IPB-07 §07.5).
const entityIdle: SettingDef = {
  key: "trust.entity.idle_minutes",
  tier: "ENTITY",
  type: "int",
  default: 30,
  min: 1,
  max: 30,
  tighten: "max",
  locked: false,
  userOverride: false,
  change: ["ORG_ADMIN"],
  mc: false,
  source: "test fixture",
};

describe("scope precedence PLATFORM → PLAN → BRAND → TENANT → ENTITY → USER (IPB-07-38)", () => {
  const def = entityIdle;
  it("lower tiers override and default applies when nothing is stored", () => {
    expect(resolve(def, []).value).toBe(30);
    const r = resolve(def, [
      { key: def.key, tier: "TENANT", scopeId: "tnt_a", value: 20, version: 1 },
      { key: def.key, tier: "ENTITY", scopeId: "ent_1", value: 15, version: 1 },
    ]);
    expect(r).toMatchObject({ value: 15, from: "ENTITY" });
  });
  it("ignores a stored value that would loosen a tighten-only key", () => {
    const r = resolve(def, [
      { key: def.key, tier: "TENANT", scopeId: "tnt_a", value: 10, version: 1 },
      { key: def.key, tier: "ENTITY", scopeId: "ent_1", value: 25, version: 1 },
    ]);
    expect(r.value).toBe(10);
    expect(r.ignored[0]?.tier).toBe("ENTITY");
  });
  it("locked keys always resolve to the default", () => {
    const locked = defaultRegistry.require("eng.env.supabase_allowed");
    expect(
      resolve(locked, [
        { key: locked.key, tier: "PLATFORM", scopeId: null, value: true, version: 1 },
      ]).value,
    ).toBe(false);
  });
});

describe("SettingsService.setIn: a write inside the caller's transaction (PR-LDC-42)", () => {
  const productKey: SettingDef = {
    key: "ldc.matter.review_days",
    tier: "TENANT",
    type: "int",
    default: 30,
    min: 1,
    locked: false,
    userOverride: false,
    change: ["LDC_COMPLIANCE_HEAD"],
    mc: false,
    source: "PR-LDC-42 fixture",
  };
  it("applies with every set check, in the caller's transaction and under its action", async () => {
    const { svc, audit, outbox, kernel, store } = setup([productKey]);
    const head = ctxFor(["LDC_COMPLIANCE_HEAD"]);
    const r = await kernel.mutate(
      head,
      async (tx) => {
        await audit.record(tx, {
          action: "ldc.matter.update",
          resourceType: "matter",
          resourceId: "m1",
        });
        return svc.setIn(tx, productKey.key, { tier: "TENANT", scopeId: "tnt_a" }, 14);
      },
      { action: "ldc.matter.update" },
    );
    expect(r).toEqual({ status: "applied", version: 1 });
    const stored = await store.read(null, productKey.key, [{ tier: "TENANT", scopeId: "tnt_a" }]);
    expect(stored[0]?.value).toBe(14);
    expect(audit.entries.map((e) => e.action)).toEqual([
      "ldc.matter.update",
      "settings.setting.change",
    ]);
    expect(outbox.events[0]?.envelope.type).toBe("in.fbx.settings.SettingChanged.v1");
    expect(kernel.actions).toEqual(["ldc.matter.update"]);
  });
  it("refuses what set refuses: other roles, other tenants, platform keys, other tiers", async () => {
    const { svc, kernel } = setup([productKey]);
    const inTx = (
      ctx: ReturnType<typeof ctxFor>,
      key: string,
      target: { tier: "TENANT" | "PLATFORM" | "USER"; scopeId: string | null },
      v: unknown,
    ) => codeAsync(kernel.mutate(ctx, (tx) => svc.setIn(tx, key, target as never, v)));
    const tenant = { tier: "TENANT" as const, scopeId: "tnt_a" };
    expect(await inTx(ctxFor(["ORG_ADMIN"]), productKey.key, tenant, 14)).toBe("IPB-UX-011");
    expect(
      await inTx(
        ctxFor(["LDC_COMPLIANCE_HEAD"]),
        productKey.key,
        { tier: "TENANT", scopeId: "tnt_other" },
        14,
      ),
    ).toBe("IPB-UX-011");
    expect(
      await inTx(ctxFor(["LDC_COMPLIANCE_HEAD"]), "trust.auth.session_idle_minutes", tenant, 20),
    ).toBe("IPB-UX-011");
    expect(
      await inTx(
        ctxFor(["PLT_SUPER_ADMIN"]),
        "int.av.clamav.enabled",
        { tier: "PLATFORM", scopeId: null },
        true,
      ),
    ).toBe("IPB-UX-008");
    expect(
      await inTx(ctxFor([]), "ux.density", { tier: "USER", scopeId: "usr_maker" }, "compact"),
    ).toBe("IPB-UX-008");
  });
  it("a key under maker-checker still returns pending, its request raised in the caller's transaction", async () => {
    const mc: SettingDef = { ...productKey, key: "ldc.matter.escalation_amount", mc: "R4" };
    const { svc, kernel, store } = setup([mc]);
    const head = ctxFor(["LDC_COMPLIANCE_HEAD"]);
    const target = { tier: "TENANT" as const, scopeId: "tnt_a" };
    const r = await kernel.mutate(head, (tx) => svc.setIn(tx, mc.key, target, 5));
    expect(r).toMatchObject({ status: "pending" });
    expect(await store.read(null, mc.key, [target])).toEqual([]);
  });
});

describe("list bounds on settings (PR-LDC-56, R1-D-145)", () => {
  const approvers: SettingDef = {
    key: "ldc.policy.approver_ids",
    tier: "TENANT",
    type: "string[]",
    default: null,
    minItems: 2,
    maxItems: 5,
    uniqueItems: true,
    locked: false,
    userOverride: false,
    change: ["LDC_COMPLIANCE_HEAD"],
    mc: false,
    source: "PR-LDC-56 fixture",
  };
  const tenant = { tier: "TENANT" as const, scopeId: "tnt_a" };
  it("set and setIn refuse too few, too many or repeated items; two different ones apply", async () => {
    const { svc, kernel } = setup([approvers]);
    const head = ctxFor(["LDC_COMPLIANCE_HEAD"]);
    for (const bad of [["usr_a"], ["usr_a", "usr_a"], ["a", "b", "c", "d", "e", "f"]]) {
      expect(await codeAsync(svc.set(head, approvers.key, tenant, bad))).toBe("IPB-UX-008");
      expect(
        await codeAsync(kernel.mutate(head, (tx) => svc.setIn(tx, approvers.key, tenant, bad))),
      ).toBe("IPB-UX-008");
    }
    expect(await svc.set(head, approvers.key, tenant, ["usr_a", "usr_b"])).toMatchObject({
      status: "applied",
    });
    expect(await svc.get(head, approvers.key as never)).toEqual(["usr_a", "usr_b"]);
  });
  it("the bounds are checked when an approved change is executed, too", async () => {
    const mc: SettingDef = { ...approvers, key: "ldc.policy.approver_ids_mc", mc: "R4" };
    const { svc, approvals, kernel } = setup([mc]);
    const head = ctxFor(["LDC_COMPLIANCE_HEAD"]);
    expect(await codeAsync(svc.set(head, mc.key, tenant, ["usr_a"]))).toBe("IPB-UX-008");
    expect(await svc.set(head, mc.key, tenant, ["usr_a", "usr_b"])).toMatchObject({
      status: "pending",
    });
    // A payload changed after the request was raised is refused at execution.
    const payload = { ...(approvals.requests[0]?.payload as object), value: ["usr_a", "usr_a"] };
    const checker = ctxFor(["ORG_CHECKER"], {
      principal: { id: "usr_checker", type: "user", roles: ["ORG_CHECKER"] },
    });
    expect(
      await codeAsync(
        kernel.mutate(checker, (tx) => svc.applyApproved(tx, payload as never, "apr_1")),
      ),
    ).toBe("IPB-UX-008");
  });
  it("a definition with bounds on a non-list type, inverted bounds or a default outside them fails at registration", () => {
    const reg = (d: Partial<SettingDef>) =>
      code(() => new SettingsRegistry([...defaultRegistry.all(), { ...approvers, ...d }]));
    expect(reg({})).toBeNull();
    expect(reg({ type: "int", default: 1 })).toBe("IPB-UX-008");
    expect(reg({ minItems: 3, maxItems: 2 })).toBe("IPB-UX-008");
    expect(reg({ minItems: -1 })).toBe("IPB-UX-008");
    expect(reg({ default: ["usr_a"] })).toBe("IPB-UX-008");
    expect(reg({ default: ["usr_a", "usr_b"] })).toBeNull();
    expect(
      code(() => assertValid({ ...approvers, type: "enum[]", values: ["A", "B"] }, ["A", "A"])),
    ).toBe("IPB-UX-008");
  });
});

describe("SettingsService writes", () => {
  it("applies a change with ledger entry and SettingChanged in the same mutation (IPB-07-39)", async () => {
    const { svc, audit, outbox, kernel } = setup();
    const ctx = ctxFor(["ORG_ADMIN"]);
    const r = await svc.set(
      ctx,
      "trust.auth.session_idle_minutes",
      { tier: "TENANT", scopeId: "tnt_a" },
      20,
    );
    expect(r).toEqual({ status: "applied", version: 1 });
    expect(await svc.get(ctx, "trust.auth.session_idle_minutes")).toBe(20);
    expect(audit.entries[0]).toMatchObject({
      action: "settings.setting.change",
      before: { value: null },
      after: { value: 20 },
    });
    expect(outbox.events[0]?.envelope.type).toBe("in.fbx.settings.SettingChanged.v1");
    expect(kernel.actions).toEqual(["settings.setting.change"]);
  });
  it("user preferences emit UserPreferenceChanged and only the owner may set them", async () => {
    const { svc, outbox } = setup();
    const me = ctxFor([]);
    await svc.set(me, "ux.density", { tier: "USER", scopeId: "usr_maker" }, "compact");
    expect(outbox.events[0]?.envelope.type).toBe("in.fbx.settings.UserPreferenceChanged.v1");
    expect(await svc.get(me, "ux.density", { userId: "usr_maker" })).toBe("compact");
    expect(
      await codeAsync(svc.set(me, "ux.density", { tier: "USER", scopeId: "usr_other" }, "compact")),
    ).toBe("IPB-UX-011");
  });
  it("refuses locked keys (IPB-SEC-020), wrong tiers and bounds (IPB-UX-008), wrong roles (IPB-UX-011)", async () => {
    const { svc } = setup();
    const admin = ctxFor(["ORG_ADMIN"]);
    expect(
      await codeAsync(
        svc.set(admin, "eng.env.supabase_allowed", { tier: "PLATFORM", scopeId: null }, true),
      ),
    ).toBe("IPB-SEC-020");
    expect(
      await codeAsync(
        svc.set(admin, "trust.auth.session_idle_minutes", { tier: "TENANT", scopeId: "tnt_a" }, 45),
      ),
    ).toBe("IPB-UX-008");
    expect(
      await codeAsync(svc.set(admin, "ux.undo.window_s", { tier: "TENANT", scopeId: "tnt_a" }, 10)),
    ).toBe("IPB-UX-008");
    expect(
      await codeAsync(
        svc.set(
          ctxFor(["ORG_MEMBER"]),
          "trust.auth.session_idle_minutes",
          { tier: "TENANT", scopeId: "tnt_a" },
          20,
        ),
      ),
    ).toBe("IPB-UX-011");
    expect(
      await codeAsync(
        svc.set(
          admin,
          "trust.auth.session_idle_minutes",
          { tier: "TENANT", scopeId: "tnt_other" },
          20,
        ),
      ),
    ).toBe("IPB-UX-011");
  });
  it("a lower tier may only tighten (IPB-UX-008)", async () => {
    const { svc } = setup([entityIdle]);
    const admin = ctxFor(["ORG_ADMIN"], { entityId: "ent_1" });
    const k = entityIdle.key as "trust.auth.session_idle_minutes";
    await svc.set(admin, k, { tier: "TENANT", scopeId: "tnt_a" }, 20);
    expect(await codeAsync(svc.set(admin, k, { tier: "ENTITY", scopeId: "ent_1" }, 25))).toBe(
      "IPB-UX-008",
    );
    await svc.set(admin, k, { tier: "ENTITY", scopeId: "ent_1" }, 15);
    expect(await svc.get(admin, k)).toBe(15);
    expect(
      await codeAsync(
        svc.set(admin, "trust.auth.session_idle_minutes", { tier: "ENTITY", scopeId: "ent_1" }, 15),
      ),
    ).toBe("IPB-UX-008");
  });
  it("superset keys may only add roles", async () => {
    const { svc } = setup();
    const owner = ctxFor(["ORG_OWNER"]);
    const def = defaultRegistry.require("trust.auth.mfa_required_roles");
    const floor = def.default as string[];
    expect(
      await codeAsync(
        svc.set(
          owner,
          "trust.auth.mfa_required_roles",
          { tier: "TENANT", scopeId: "tnt_a" },
          floor.slice(1),
        ),
      ),
    ).toBe("IPB-UX-008");
    expect(
      await svc.set(owner, "trust.auth.mfa_required_roles", { tier: "TENANT", scopeId: "tnt_a" }, [
        ...floor,
        "ORG_MAKER",
      ]),
    ).toMatchObject({ status: "pending" });
  });
});

describe("per-value change history (PR-LDC-17, R1-D-82)", () => {
  const key = "trust.auth.session_idle_minutes";
  const tenant = { tier: "TENANT", scopeId: "tnt_a" } as const;
  it("lists each change at the scope newest first, paged, linked to its ledger entry", async () => {
    const { svc } = setup();
    const admin = ctxFor(["ORG_ADMIN"]);
    for (const v of [20, 15, 10]) await svc.set(admin, key, tenant, v);
    const first = await svc.history(admin, key, tenant, { limit: 2 });
    expect(first.items.map((c) => [c.old, c.new, c.version, c.ledgerId])).toEqual([
      [15, 10, 3, "led_3"],
      [20, 15, 2, "led_2"],
    ]);
    expect(first.items[0]).toMatchObject({ key, tier: "TENANT", scopeId: "tnt_a" });
    expect(first.items[0]).toMatchObject({ actorId: "usr_maker", approvalRequestId: null });
    const rest = await svc.history(admin, key, tenant, { cursor: first.nextCursor! });
    expect(rest).toMatchObject({ items: [{ old: null, new: 20, version: 1 }], nextCursor: null });
  });
  it("is the owner's alone at USER and needs a reader role at TENANT", async () => {
    const { svc } = setup();
    await svc.set(ctxFor([]), "ux.density", { tier: "USER", scopeId: "usr_maker" }, "compact");
    const mine = await svc.history(ctxFor([]), "ux.density", {
      tier: "USER",
      scopeId: "usr_maker",
    });
    expect(mine.items.map((c) => c.new)).toEqual(["compact"]);
    const other = { tier: "USER", scopeId: "usr_maker" } as const;
    const admin = ctxFor(["ORG_ADMIN"], { principal: { id: "usr_adm", type: "user", roles: [] } });
    expect(await codeAsync(svc.history(admin, "ux.density", other))).toBe("IPB-UX-011");
    expect(await codeAsync(svc.history(ctxFor(["ORG_MEMBER"]), key, tenant))).toBe("IPB-UX-011");
    expect(await svc.history(ctxFor(["ORG_AUDITOR_RO"]), key, tenant)).toEqual({
      items: [],
      nextCursor: null,
    });
    const elsewhere = { tier: "TENANT", scopeId: "tnt_other" } as const;
    expect(await codeAsync(svc.history(ctxFor(["ORG_ADMIN"]), key, elsewhere))).toBe("IPB-UX-011");
    const platform = { tier: "PLATFORM", scopeId: null } as const;
    expect(await codeAsync(svc.history(ctxFor(["ORG_ADMIN"]), "ux.undo.window_s", platform))).toBe(
      "IPB-UX-011",
    );
    await expect(svc.history(ctxFor(["ORG_ADMIN"]), key, tenant, { limit: 0 })).rejects.toThrow(
      RangeError,
    );
    await expect(svc.history(ctxFor(["ORG_ADMIN"]), key, tenant, { cursor: "x" })).rejects.toThrow(
      RangeError,
    );
    expect(await codeAsync(svc.history(ctxFor(["ORG_ADMIN"]), "no.such.key", tenant))).toBe(
      "IPB-UX-007",
    );
  });
});

describe("@IPB-07-AT-06 @NN-18 maker-checker on organisation settings", () => {
  const disbursement: SettingDef = {
    key: "mc.thresholds.disbursement",
    tier: "TENANT",
    type: "int",
    default: 500000,
    min: 0,
    locked: false,
    userOverride: false,
    change: ["ORG_ADMIN"],
    mc: "R4",
    source: "IPB-07-AT-06 fixture",
  };
  it("creates a request with the diff and leaves the value unchanged until approval", async () => {
    const { svc, approvals, store } = setup([disbursement]);
    const ctx = ctxFor(["ORG_ADMIN"]);
    const r = await svc.set(ctx, disbursement.key, { tier: "TENANT", scopeId: "tnt_a" }, 1000000);
    expect(r).toEqual({ status: "pending", requestId: "apr_1" });
    expect(approvals.requests[0]).toMatchObject({
      action: "settings.setting.change",
      riskClass: "R4",
      payload: { key: disbursement.key, value: 1000000 },
    });
    expect((await svc.explain(ctx, disbursement.key)).value).toBe(500000);
    // The approvals engine (tenancy) calls applyApproved in the checker's transaction.
    const { FakeKernel: K } = await import("../__tests__/fakes.js");
    await new K().mutate(
      ctxFor(["ORG_CHECKER"], {
        principal: { id: "usr_checker", type: "user", roles: ["ORG_CHECKER"] },
      }),
      (tx) => svc.applyApproved(tx, approvals.requests[0]?.payload as never, "apr_1"),
    );
    expect(
      (await store.read(null, disbursement.key, [{ tier: "TENANT", scopeId: "tnt_a" }]))[0]?.value,
    ).toBe(1000000);
  });
});

describe("PL3 maker-checker tenant keys are tighten-only (PL3-D-08)", () => {
  const def = (key: string) => defaultRegistry.require(key);
  it("registers the mc.* keys at TENANT tier, governed at R4", () => {
    for (const k of [
      "mc.extra_actions",
      "mc.amount_threshold.payments_refund",
      "mc.dual_checker_above.payments_refund",
      "mc.checker_roles.payments_refund",
      "mc.reminder_hours",
      "mc.expiry_hours.payments_refund",
    ]) {
      expect(def(k)).toMatchObject({ tier: "TENANT", mc: "R4" });
    }
  });
  it("mc.expiry_hours is 1 to 168 hours and may only be lowered (#106, R1-D-89)", () => {
    const d = def("mc.expiry_hours.payments_refund");
    expect(d).toMatchObject({ type: "int", min: 1, max: 168, default: null });
    expect(() => assertValid(d, 0)).toThrow();
    expect(() => assertValid(d, 169)).toThrow();
    expect(() => assertValid(d, 12)).not.toThrow();
    expect(tightenError(d, 24, 48)).toMatch(/lowered/);
    expect(tightenError(d, 48, 24)).toBeNull();
  });
  it("only lowers thresholds and the reminder, only adds actions, only narrows checker roles", () => {
    expect(tightenError(def("mc.reminder_hours"), 24, 12)).toBeNull();
    expect(tightenError(def("mc.reminder_hours"), 12, 24)).toMatch(/lowered/);
    expect(tightenError(def("mc.amount_threshold.payments_refund"), 100_000, 200_000)).toMatch(
      /lowered/,
    );
    expect(tightenError(def("mc.extra_actions"), ["a"], ["a", "b"])).toBeNull();
    expect(tightenError(def("mc.extra_actions"), ["a", "b"], ["b"])).toMatch(/add/);
    const roles = def("mc.checker_roles.payments_refund");
    expect(tightenError(roles, ["ORG_CHECKER", "ORG_ADMIN"], ["ORG_CHECKER"])).toBeNull();
    expect(tightenError(roles, ["ORG_CHECKER"], ["ORG_CHECKER", "ORG_ADMIN"])).toMatch(/part/);
    expect(tightenError(roles, ["ORG_CHECKER"], [])).toMatch(/part/);
  });
});

describe("kill switches: activate at once, deactivate through a checker (IPB-03-48, PL4 plan §3.5)", () => {
  it("applies true directly and routes true → false to an R2 request", async () => {
    const { svc, approvals, store } = setup();
    const owner = ctxFor(["ORG_OWNER"]);
    const target = { tier: "TENANT" as const, scopeId: "tnt_a" };
    expect(await svc.set(owner, "ai.kill.tenant", target, true)).toMatchObject({
      status: "applied",
    });
    expect((await store.read(null, "ai.kill.tenant", [target]))[0]?.value).toBe(true);
    expect(await svc.set(owner, "ai.kill.tenant", target, false)).toMatchObject({
      status: "pending",
    });
    expect(approvals.requests.at(-1)).toMatchObject({
      action: "settings.setting.change",
      riskClass: "R2",
      payload: { key: "ai.kill.tenant", value: false },
    });
    expect((await store.read(null, "ai.kill.tenant", [target]))[0]?.value).toBe(true);
  });

  it("marks the kill switches and the PL5 switch-off-needs-a-checker keys with mcDeactivate", () => {
    const keys = defaultRegistry
      .all()
      .filter((d) => d.mcDeactivate)
      .map((d) => d.key)
      .sort();
    expect(keys).toEqual([
      // IPB-06 §06.5 and IPB-08 §08.5: switching these off needs a checker (PL5 plan §8).
      "a11y.live_captions.enabled",
      "ai.kill.adapter.{key}",
      "ai.kill.all",
      "ai.kill.feature.{key}",
      "ai.kill.tenant",
      "trust.trust_centre.enabled",
    ]);
  });
});

describe("Vidhi QA floor keys are tighten-only (OWNER-QUESTIONS #40, PL4-D-13)", () => {
  const def = (key: string) => defaultRegistry.require(key);
  const keys = ["vidhi.qa.min_reviews", "vidhi.qa.precision_floor", "vidhi.qa.recall_floor"];
  it("registers them at TENANT tier, governed, with the platform floor as the minimum", () => {
    for (const k of keys)
      expect(def(k)).toMatchObject({ tier: "TENANT", mc: "R2", tighten: "min" });
    expect(def("vidhi.qa.min_reviews")).toMatchObject({ default: 20, min: 20 });
    expect(def("vidhi.qa.precision_floor")).toMatchObject({ default: 0.8, min: 0.8, max: 1 });
    expect(def("vidhi.qa.recall_floor")).toMatchObject({ default: 0.8, min: 0.8, max: 1 });
  });
  it("a tenant may ask for more evidence or a higher floor, never less", () => {
    expect(tightenError(def("vidhi.qa.min_reviews"), 20, 40)).toBeNull();
    expect(tightenError(def("vidhi.qa.min_reviews"), 40, 20)).toMatch(/raised/);
    expect(tightenError(def("vidhi.qa.precision_floor"), 0.8, 0.9)).toBeNull();
    expect(tightenError(def("vidhi.qa.recall_floor"), 0.9, 0.85)).toMatch(/raised/);
  });
});

describe("PL5 website keys (PL5 plan §8)", () => {
  const def = (key: string) => defaultRegistry.require(key);
  it("registers the owner's launch defaults: no tag manager, no analytics, no stored form payloads", () => {
    expect(def("mkt.tag_manager.adapter").default).toBe("none");
    expect(def("mkt.analytics.adapter").default).toBe("none");
    expect(def("mkt.forms.retain_payload_hours").default).toBe(0);
    expect(def("eco.v12.emit_enabled").default).toBe(false);
    expect(def("web.investors.enabled").default).toBe(false);
  });
  it("locks GPC, self-hosted fonts and the Claims Register on", () => {
    for (const k of [
      "web.consent.honour_gpc",
      "brand.fonts.self_hosted_only",
      "trust.claims.enforce",
    ])
      expect(def(k)).toMatchObject({ locked: true, default: true });
  });
  it("never lets a lower tier loosen contrast, the Lighthouse floor or the consent cookie lifetime", () => {
    expect(tightenError(def("brand.contrast.min_text"), 4.5, 4)).toMatch(/raised/);
    expect(tightenError(def("a11y.ci.lighthouse_min"), 95, 90)).toMatch(/raised/);
    expect(tightenError(def("web.consent.cookie_ttl_days"), 365, 400)).toMatch(/lowered/);
    expect(tightenError(def("mkt.sensitive_routes"), ["/contact"], [])).toMatch(/add/);
  });
});

describe("erasing a person's USER settings (#110, R1-D-95)", () => {
  const me = { tier: "USER", scopeId: "usr_maker" } as const;
  it("deletes their USER values and history only, ledgered with counts and the request", async () => {
    const { svc, store, audit } = setup();
    await svc.set(ctxFor([]), "ux.density", me, "compact");
    await svc.set(ctxFor([]), "ux.density", me, "comfortable");
    await svc.set(
      ctxFor(["ORG_ADMIN"]),
      "trust.auth.session_idle_minutes",
      { tier: "TENANT", scopeId: "tnt_a" },
      20,
    );
    const r = await svc.eraseUser(ctxFor(["ORG_ADMIN"]), "usr_maker", {
      requestRef: "dpr_1",
      reason: "DPDP erasure request from the data principal",
    });
    expect(r).toMatchObject({ values: 1, changes: 2 });
    expect(await store.read(null, "ux.density", [me])).toEqual([]);
    expect((await svc.history(ctxFor([]), "ux.density", me)).items).toEqual([]);
    expect(
      (
        await svc.history(ctxFor(["ORG_ADMIN"]), "trust.auth.session_idle_minutes", {
          tier: "TENANT",
          scopeId: "tnt_a",
        })
      ).items,
    ).toHaveLength(1);
    const led = audit.entries.find((e) => e.action === "settings.user.erase");
    expect(led).toMatchObject({
      resourceId: "usr_maker",
      after: { request_ref: "dpr_1", values: 1, changes: 2 },
    });
    expect(JSON.stringify(led)).not.toContain("compact");
  });
  it("refuses agents, members without a role and platform contexts", async () => {
    const { svc } = setup();
    const req = { requestRef: "dpr_1", reason: "DPDP erasure request from the data principal" };
    const agent = ctxFor([], { principal: { id: "agt_x", type: "agent", roles: [] } });
    expect(await codeAsync(svc.eraseUser(agent, "usr_maker", req))).toBe("IPB-SEC-004");
    expect(await codeAsync(svc.eraseUser(ctxFor(["ORG_MEMBER"]), "usr_maker", req))).toBe(
      "IPB-UX-011",
    );
    expect(
      await codeAsync(
        svc.eraseUser(ctxFor(["ORG_ADMIN"], { scope: "platform" }), "usr_maker", req),
      ),
    ).toBe("IPB-UX-011");
  });
});

describe("UNIT scopes below ENTITY (PR-042, IPB-07-38 as amended; R1-D-95)", () => {
  // A tighten-only TENANT key that units may set, and a plain one that they may not.
  const unitIdle: SettingDef = {
    ...entityIdle,
    key: "trust.unit.idle_minutes",
    tier: "TENANT",
    unitOverride: true,
  };
  const plain: SettingDef = { ...entityIdle, key: "trust.unit.plain", tier: "TENANT" };
  const unitCtx = (units: string[], roles = ["ORG_ADMIN"]) =>
    ctxFor(roles, { entityId: "ent_1", unitIds: units });
  it("resolves ENTITY → outer unit → inner unit → USER, the innermost winning", async () => {
    const { svc } = setup([unitIdle, plain]);
    await svc.set(ctxFor(["ORG_ADMIN"]), unitIdle.key, { tier: "TENANT", scopeId: "tnt_a" }, 25);
    await svc.set(
      unitCtx(["ou_north", "dep_legal"]),
      unitIdle.key,
      { tier: "UNIT", scopeId: "ou_north" },
      20,
    );
    await svc.set(
      unitCtx(["ou_north", "dep_legal"]),
      unitIdle.key,
      { tier: "UNIT", scopeId: "dep_legal" },
      15,
    );
    expect(await svc.explain(unitCtx(["ou_north", "dep_legal"]), unitIdle.key)).toMatchObject({
      value: 15,
      from: "UNIT",
    });
    expect((await svc.explain(unitCtx(["ou_north"]), unitIdle.key)).value).toBe(20);
    expect((await svc.explain(unitCtx(["ou_south"]), unitIdle.key)).value).toBe(25);
    expect((await svc.explain(ctxFor(["ORG_ADMIN"]), unitIdle.key)).value).toBe(25);
  });
  it("stays tighten-only: an inner unit cannot loosen an outer one", async () => {
    const { svc } = setup([unitIdle]);
    const both = unitCtx(["ou_north", "dep_legal"]);
    await svc.set(both, unitIdle.key, { tier: "UNIT", scopeId: "ou_north" }, 20);
    expect(
      await codeAsync(svc.set(both, unitIdle.key, { tier: "UNIT", scopeId: "dep_legal" }, 25)),
    ).toBe("IPB-UX-008");
    // The outer unit itself inherits from the tenant, not from its inner unit.
    await svc.set(both, unitIdle.key, { tier: "UNIT", scopeId: "dep_legal" }, 10);
    expect(
      await svc.set(both, unitIdle.key, { tier: "UNIT", scopeId: "ou_north" }, 18),
    ).toMatchObject({
      status: "applied",
    });
  });
  it("is refused for a key that does not declare it, outside the caller's units, and for bad chains", async () => {
    const { svc } = setup([unitIdle, plain]);
    const ctx = unitCtx(["ou_north"]);
    expect(
      await codeAsync(svc.set(ctx, plain.key, { tier: "UNIT", scopeId: "ou_north" }, 20)),
    ).toBe("IPB-UX-008");
    expect(
      await codeAsync(svc.set(ctx, unitIdle.key, { tier: "UNIT", scopeId: "ou_south" }, 20)),
    ).toBe("IPB-UX-011");
    expect(
      await codeAsync(
        svc.set(
          unitCtx(["ou_north"], ["ORG_MEMBER"]),
          unitIdle.key,
          { tier: "UNIT", scopeId: "ou_north" },
          20,
        ),
      ),
    ).toBe("IPB-UX-011");
    await expect(svc.explain(unitCtx(["ou north"]), unitIdle.key)).rejects.toThrow(/unit id/);
    await expect(svc.explain(unitCtx(["a", "a"]), unitIdle.key)).rejects.toThrow(/twice/);
    await expect(
      svc.explain(unitCtx(["a", "b", "c", "d", "e", "f", "g", "h", "i"]), unitIdle.key),
    ).rejects.toThrow(/at most 8/);
  });
  it("tierAllowed: UNIT only with unit_override and only for TENANT, ENTITY or USER keys", () => {
    expect(tierAllowed(unitIdle, "UNIT")).toBe(true);
    expect(tierAllowed(plain, "UNIT")).toBe(false);
    expect(tierAllowed({ ...unitIdle, tier: "PLAN" }, "UNIT")).toBe(false);
    expect(tierAllowed({ ...unitIdle, tier: "USER" }, "UNIT")).toBe(true);
  });
});
