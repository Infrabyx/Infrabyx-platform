import { describe, expect, it } from "vitest";
import type { IpbError } from "@infrabyx/contracts/errors";
import { FlagAdmin } from "./admin.js";
import {
  ALERT_THROTTLE_MS,
  FlagService,
  SNAPSHOT_MAX_AGE_MS,
  type FlagAlert,
} from "./evaluator.js";
import { MemoryFlagProvider, MemorySnapshotStore } from "./providers.js";
import {
  FUT_REGISTER,
  FlagRegistry,
  defaultFlagRegistry,
  lintFlags,
  type FlagDef,
} from "./registry.js";
import { FakeApprovals, FakeAudit, FakeKernel, FakeOutbox, ctxFor } from "../__tests__/fakes.js";

const codeAsync = async (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: IpbError) => e.code,
  );
const HOUR = 3_600_000;

describe("@IPB-12-AT-01 every watch item has a registered flag with the documented default", () => {
  // IPB-12 §12.5, read as PL1-D-10: ON → true; OFF, "OFF → ON …" → false; product-qualified ON → false at platform.
  const expected: Record<string, boolean> = {
    "passkeys-default": false,
    "webauthn-conditional-ui": true,
    "webauthn-related-origins": false,
    "fapi2-partner-profile": false,
    "pqc-hybrid-sign": false,
    "tls-hybrid-kem": true,
    "cbom-export": false,
    "digilocker-pull": false,
    "digilocker-vc": false,
    "vc-verify": false,
    "eudi-wallet-verify": false,
    "upi-credit-line": false,
    "upi-autopay-collections": false,
    "cbdc-rail": false,
    "aa-fiu": false,
    "uli-gateway": false,
    "ondc-credit-channel": false,
    "dpdp-consent-manager-api": false,
    "dpdp-consent-ledger": true,
    "dpdp-sdf-controls": false,
    "ai-provenance-label": true,
    "dla-multi-lender-view": false,
    "kfs-digital-sign": true,
    "outsourcing-evidence-pack": true,
    "sebi-odr-v2": false,
    "eu-ai-act-annex3": false,
    "ai-inventory": true,
    "sbom-aibom-publish": true,
    "mcp-server": false,
    "a2a-agent-card": false,
    "webmcp-page-tools": false,
    "edge-local-inference": false,
    "sovereign-model-primary": false,
    "confidential-inference": false,
    "otel-genai-stable": false,
    "guardrails-v2": true,
    "node26-runtime": false,
    "nest12-esm": false,
    pg19: false,
  };
  it("contains every fut.* flag with the register default", () => {
    const fut = Object.fromEntries(
      defaultFlagRegistry
        .all()
        .filter((d) => d.kind === "fut")
        .map((d) => [d.key.slice(4), d.default]),
    );
    expect(fut).toEqual(expected);
    expect(FUT_REGISTER).toHaveLength(39);
  });
  it("fut.ai-provenance-label is ON and not switchable", async () => {
    expect(defaultFlagRegistry.require("fut.ai-provenance-label")).toMatchObject({
      default: true,
      locked: true,
    });
    const svc = new FlagService({
      provider: new MemoryFlagProvider({ "fut.ai-provenance-label": false }),
    });
    expect(await svc.evaluate("fut.ai-provenance-label")).toMatchObject({
      value: true,
      source: "locked",
    });
  });
  it("product-qualified defaults apply to their product", async () => {
    const p = new MemoryFlagProvider();
    expect(
      await new FlagService({ provider: p, product: "UDF" }).isOn("fut.dla-multi-lender-view"),
    ).toBe(true);
    expect(
      await new FlagService({ provider: p, product: "LD" }).isOn("fut.dla-multi-lender-view"),
    ).toBe(false);
    expect(await new FlagService({ provider: p, product: "FBX" }).isOn("fut.aa-fiu")).toBe(true);
  });
});

describe("@IPB-09-AT-09 flag registry", () => {
  it("an unregistered flag fails typecheck and throws IPB-ENG-008", async () => {
    const svc = new FlagService({ provider: new MemoryFlagProvider() });
    // @ts-expect-error unregistered flag keys fail typecheck (IPB-ENG-008)
    expect(await codeAsync(svc.isOn("mod.cms.blog_v2"))).toBe("IPB-ENG-008");
  });
  it("lints taxonomy, metadata and expiry (IPB-09-24, IPB-09-25)", () => {
    const base: FlagDef = {
      key: "exp.checkout-copy",
      kind: "exp",
      owner: "PLT_RELEASE_MANAGER",
      created: "2026-10-26",
      expiry: "2027-03-01",
      default: false,
      description: "x",
      state: "active",
      source: "t",
    };
    expect(lintFlags([base])).toEqual(["exp.checkout-copy: exp. flags expire within 60 days"]);
    expect(lintFlags([{ ...base, key: "beta.thing" }]).join()).toMatch(/taxonomy/);
    expect(
      lintFlags([{ ...base, kind: "kill", key: "kill.x", expiry: "2027-01-01" }]).join(),
    ).toMatch(/never expire/);
    expect(lintFlags(defaultFlagRegistry.all())).toEqual([]);
    expect(() => new FlagRegistry([base, base])).toThrow(/registered twice/);
  });
});

describe("@IPB-02-AT-20 @IPB-09-AT-10 kill switch safe state", () => {
  it("evaluates on when the provider is down and the snapshot is older than 24 h", async () => {
    const provider = new MemoryFlagProvider({ "kill.payments": false, "kill.webhooks": false });
    let now = Date.parse("2026-10-26T00:00:00Z");
    const degraded: string[] = [];
    const svc = new FlagService({
      provider,
      snapshots: new MemorySnapshotStore(),
      now: () => now,
      onDegraded: (e) => degraded.push(`${e.key}:${e.source}`),
    });
    const snap = await svc.refreshSnapshot();
    snap.fetchedAt = new Date(now).toISOString();
    provider.down = true;
    expect(await svc.evaluate("kill.payments")).toMatchObject({ value: false, source: "snapshot" });
    now += SNAPSHOT_MAX_AGE_MS + HOUR;
    expect(await svc.evaluate("kill.payments")).toEqual({
      key: "kill.payments",
      value: true,
      source: "safe-state",
    });
    expect(await svc.isOn("kill.webhooks")).toBe(true);
    expect(await svc.isOn("kill.ai.bedrock")).toBe(true);
    expect(degraded).toEqual([
      "kill.payments:snapshot",
      "kill.payments:safe-state",
      "kill.webhooks:safe-state",
      "kill.ai.bedrock:safe-state",
    ]);
  });
  it("non-kill flags fall back to their registered default", async () => {
    const provider = new MemoryFlagProvider();
    provider.down = true;
    expect(await new FlagService({ provider }).evaluate("fut.tls-hybrid-kem")).toMatchObject({
      value: true,
      source: "default",
    });
  });
  it("kill switches ignore per-tenant context (IPB-09-27)", async () => {
    const seen: unknown[] = [];
    const provider = new MemoryFlagProvider({ "kill.signup": true });
    const spy = Object.assign(provider, {
      getBooleanValue: async (k: string, d: boolean, c?: unknown) => (seen.push(c), d),
    });
    await new FlagService({ provider: spy }).isOn("kill.signup", { tenantKey: "h1", env: "prod" });
    expect(seen).toEqual([{ env: "prod" }]);
  });
});

describe("kill switch changes (IPB-09-26, IPB-ENG-016)", () => {
  const platform = (roles: string[]) =>
    ctxFor(roles, {
      tenantId: "tnt_platform",
      scope: "platform",
      principal: { id: "usr_rm", type: "user", roles },
    });
  function setup() {
    const provider = new MemoryFlagProvider();
    const audit = new FakeAudit();
    const outbox = new FakeOutbox();
    const approvals = new FakeApprovals();
    const admin = new FlagAdmin({
      kernel: new FakeKernel(),
      audit,
      outbox,
      approvals,
      writer: provider,
      product: "LD",
    });
    return { provider, audit, outbox, approvals, admin };
  }
  it("PLT_RELEASE_MANAGER flips a kill switch; it is ledgered and announced", async () => {
    const { admin, provider, audit, outbox } = setup();
    expect(await admin.set(platform(["PLT_RELEASE_MANAGER"]), "kill.webhooks", true)).toEqual({
      status: "applied",
    });
    expect(await provider.getBooleanValue("kill.webhooks", false)).toBe(true);
    expect(audit.entries[0]).toMatchObject({
      action: "flags.flag.change",
      resourceId: "kill.webhooks",
      after: { value: true },
    });
    expect(outbox.events[0]?.envelope.type).toBe("in.ld.security.KillSwitchChanged.v1");
  });
  it("other roles, agents and tenant contexts are refused", async () => {
    const { admin } = setup();
    expect(await codeAsync(admin.set(platform(["PLT_SUPER_ADMIN"]), "kill.webhooks", true))).toBe(
      "IPB-ENG-016",
    );
    expect(
      await codeAsync(admin.set(ctxFor(["PLT_SECURITY_OFFICER"]), "kill.webhooks", true)),
    ).toBe("IPB-ENG-016");
    const agent = ctxFor(["AGT_RELEASE"], {
      scope: "platform",
      principal: { id: "agt_1", type: "agent", roles: ["PLT_RELEASE_MANAGER"] },
    });
    expect(await codeAsync(admin.set(agent, "kill.webhooks", true))).toBe("IPB-ENG-016");
  });
  it("fut.* changes need PLT_RELEASE_MANAGER and go to maker-checker; locked flags refuse", async () => {
    const { admin, approvals } = setup();
    expect(await admin.set(platform(["PLT_RELEASE_MANAGER"]), "fut.cbom-export", true)).toEqual({
      status: "pending",
      requestId: "apr_1",
    });
    expect(approvals.requests[0]).toMatchObject({
      riskClass: "R3",
      payload: { key: "fut.cbom-export", value: true },
    });
    expect(
      await codeAsync(admin.set(platform(["PLT_SECURITY_OFFICER"]), "fut.cbom-export", true)),
    ).toBe("IPB-UX-011");
    expect(
      await codeAsync(
        admin.set(platform(["PLT_RELEASE_MANAGER"]), "fut.ai-provenance-label", false),
      ),
    ).toBe("IPB-SEC-020");
  });
});

describe("flags.defaults.json (IPB-12-03)", () => {
  it("matches the registry, so a default change shows as a diff of that file", async () => {
    const { readFile } = await import("node:fs/promises");
    const committed = JSON.parse(
      await readFile(new URL("../../flags.defaults.json", import.meta.url), "utf8"),
    ) as Record<string, boolean>;
    expect(committed).toEqual(defaultFlagRegistry.defaults());
  });
});

describe("persisted snapshot and provider alert (PL3-D-13)", () => {
  it("boot persists a snapshot, and a restart during an outage loads it", async () => {
    const store = new MemorySnapshotStore();
    const provider = new MemoryFlagProvider({ "kill.msg.sms": false });
    const first = new FlagService({ provider, snapshots: store });
    expect(await first.boot()).toBe("provider");
    expect(await store.load()).not.toBeNull();

    provider.down = true;
    const alerts: FlagAlert[] = [];
    const restarted = new FlagService({
      provider,
      snapshots: store,
      onAlert: (a) => alerts.push(a),
    });
    expect(await restarted.boot()).toBe("snapshot");
    expect(await restarted.evaluate("kill.msg.sms")).toMatchObject({
      value: false,
      source: "snapshot",
    });
    expect(alerts.map((a) => `${a.key}:${a.servedFrom}`)).toEqual([
      "*:snapshot",
      "kill.msg.sms:snapshot",
    ]);
    expect(alerts.every((a) => a.alert === "ops.flags.provider_unreachable")).toBe(true);
  });
  it("boot with no provider and no snapshot reports none, and kill switches stay on", async () => {
    const provider = new MemoryFlagProvider();
    provider.down = true;
    const alerts: FlagAlert[] = [];
    const svc = new FlagService({
      provider,
      snapshots: new MemorySnapshotStore(),
      onAlert: (a) => alerts.push(a),
    });
    expect(await svc.boot()).toBe("none");
    expect(await svc.isOn("kill.msg.email")).toBe(true);
    expect(alerts.map((a) => a.servedFrom)).toEqual(["none", "safe-state"]);
  });
  it("throttles the alert to one per key per window", async () => {
    let now = Date.parse("2026-10-27T00:00:00Z");
    const provider = new MemoryFlagProvider();
    provider.down = true;
    const alerts: FlagAlert[] = [];
    const svc = new FlagService({ provider, now: () => now, onAlert: (a) => alerts.push(a) });
    await svc.evaluate("kill.msg.push");
    await svc.evaluate("kill.msg.push");
    await svc.evaluate("kill.msg.inapp");
    expect(alerts).toHaveLength(2);
    now += ALERT_THROTTLE_MS;
    await svc.evaluate("kill.msg.push");
    expect(alerts).toHaveLength(3);
  });
  it("registers the five NOTIFY kill switches as exact keys", () => {
    for (const c of ["email", "sms", "whatsapp", "push", "inapp"])
      expect(defaultFlagRegistry.defaults()).toHaveProperty(`kill.msg.${c}`, false);
  });
});
