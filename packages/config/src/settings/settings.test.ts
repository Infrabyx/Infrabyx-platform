import { describe, expect, it } from "vitest";
import { IpbError } from "@infrabyx/contracts/errors";
import { CONSOLE_TREE, SETTINGS_TREE } from "./registry.generated.js";
import { SettingsRegistry, defaultRegistry } from "./registry.js";
import { resolve } from "./resolve.js";
import { SettingsService } from "./service.js";
import { MemorySettingsStore } from "./store.js";
import type { SettingDef } from "./types.js";
import { tightenError } from "./validate.js";
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
    ]) {
      expect(def(k)).toMatchObject({ tier: "TENANT", mc: "R4" });
    }
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

  it("marks only the kill-switch keys with mcDeactivate", () => {
    const keys = defaultRegistry
      .all()
      .filter((d) => d.mcDeactivate)
      .map((d) => d.key)
      .sort();
    expect(keys).toEqual([
      "ai.kill.adapter.{key}",
      "ai.kill.all",
      "ai.kill.feature.{key}",
      "ai.kill.tenant",
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
