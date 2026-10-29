// Customer sign-in core (R1-D-19) on a fake IdP and a fake clock: the IPB-02 auth.otp schedule
// (10 codes per 10 minutes, back-off after 5 wrong codes, a 15-minute lockout after 10), settings
// bounds, the challenge and device rules, and the Redis replay store's contract.
import { describe, expect, it } from "vitest";
import type {
  AdapterDescriptor,
  DpopTarget,
  PortHealth,
  VerifiedClaims,
} from "@infrabyx/contracts";
import { MemoryReplayStore } from "@infrabyx/crypto";
import { MemoryRevocationStore, type TokenVerifier } from "../common.js";
import {
  admitAttempt,
  admitSend,
  afterFailure,
  afterSuccess,
  CUSTOMER_IDENTITY_DEFAULTS,
  CUSTOMER_IDENTITY_SETTINGS,
  CustomerIdentityBase,
  customerIdentitySettings,
  freshGuard,
  guardEnded,
  MemoryCustomerAuthStore,
  readCustomerIdentitySettings,
  RedisReplayStore,
  type ChallengeRecord,
  type IdpTokens,
} from "../customer.js";
import {
  CUSTOMER_RETENTION_SETTINGS,
  customerRetentionSettings,
  CustomerSignInRetention,
} from "../customer-retention.js";
import { capturingSender, testDevice } from "./dpop-device.js";

const s = customerIdentitySettings();
const T0 = Date.parse("2026-10-29T06:00:00Z");

describe("the auth.otp guard (IPB-02 §02.4.6.2)", () => {
  it("defaults are the IPB values and the registry's", async () => {
    expect(CUSTOMER_IDENTITY_DEFAULTS).toMatchObject({
      maxSends: 10,
      sendWindowSeconds: 600,
      backoffAfterFailures: 5,
      lockoutAfterFailures: 10,
      lockoutSeconds: 900,
      sessionIdleSeconds: 1800,
      sessionMaxSeconds: 43_200,
      dpopMaxAgeSeconds: 60,
    });
    const { SETTING_DEFS } = await import("@infrabyx/config/settings");
    for (const b of Object.values(CUSTOMER_IDENTITY_SETTINGS)) {
      const def = (
        SETTING_DEFS as ReadonlyArray<{ key: string; default: unknown; min?: number; max?: number }>
      ).find((d) => d.key === b.key);
      expect(def, b.key).toMatchObject({ default: b.default, min: b.min, max: b.max });
    }
  });

  it("settings outside their bounds are refused, never clamped", async () => {
    expect(() => customerIdentitySettings({ maxSends: 11 })).toThrow(RangeError);
    expect(() => customerIdentitySettings({ lockoutSeconds: 60 })).toThrow(RangeError);
    expect(() => customerIdentitySettings({ dpopMaxAgeSeconds: 301 })).toThrow(RangeError);
    expect(() =>
      customerIdentitySettings({ backoffAfterFailures: 5, lockoutAfterFailures: 5 }),
    ).toThrow(RangeError);
    const read = await readCustomerIdentitySettings(async (k) =>
      k === "int.identity.customer.otp.max_sends" ? 3 : undefined,
    );
    expect(read.maxSends).toBe(3);
  });

  it("ten codes per ten minutes, thirty seconds apart", () => {
    let g = freshGuard(T0);
    let t = T0;
    for (let i = 0; i < 10; i++) {
      const r = admitSend(g, s, t);
      expect(r.ok).toBe(true);
      if (r.ok) g = r.next;
      const again = admitSend(g, s, t + 1000);
      expect(again).toMatchObject({ ok: false, reason: "resend_interval" });
      t += 31_000;
    }
    expect(admitSend(g, s, t)).toMatchObject({ ok: false, reason: "max_sends" });
    const r = admitSend(g, s, T0 + 600_000);
    expect(r.ok).toBe(true);
  });

  it("back-off doubles after five wrong codes; ten lock the account for fifteen minutes", () => {
    let g = freshGuard(T0);
    let t = T0;
    for (let i = 0; i < 5; i++) {
      expect(admitAttempt(g, s, t).ok).toBe(true);
      g = afterFailure(g, s, t);
    }
    expect(admitAttempt(g, s, t + 29_000)).toMatchObject({ ok: false, reason: "backoff" });
    t += 30_000;
    expect(admitAttempt(g, s, t).ok).toBe(true);
    g = afterFailure(g, s, t);
    expect(admitAttempt(g, s, t + 59_000)).toMatchObject({ ok: false, reason: "backoff" });
    for (let i = 6; i < 10; i++) {
      t += 30_000 * 2 ** (i - 5);
      expect(admitAttempt(g, s, t).ok).toBe(true);
      g = afterFailure(g, s, t);
    }
    expect(g.lockedUntil).toBe(t + 900_000);
    expect(admitAttempt(g, s, t + 899_000)).toMatchObject({ ok: false, reason: "locked" });
    expect(admitSend(g, s, t + 899_000)).toMatchObject({ ok: false, reason: "locked" });
    expect(admitAttempt(g, s, t + 900_000).ok).toBe(true);
    expect(afterSuccess(afterFailure(g, s, t)).failures).toBe(0);
  });
});

/** A fake IdP: codes are "1234" + two digits; tokens are fake JWTs the fake verifier accepts. */
class FakeCustomerIdp extends CustomerIdentityBase {
  readonly descriptor: AdapterDescriptor = {
    port: "IDENTITY",
    adapter: "fake-customer",
    residency: "IN",
    maxDataClass: "CONFIDENTIAL",
  };
  readonly signInProofTarget: DpopTarget = { htm: "POST", htu: "https://id.example.test/token" };
  protected readonly nativeBinding = false;
  calls = { send: 0, verify: 0 };
  private n = 0;
  protected readonly verifier = {
    verifyWithRaw: async (jwt: string) => {
      const raw = JSON.parse(jwt) as Record<string, unknown>;
      return { claims: raw as unknown as VerifiedClaims, raw };
    },
  } as unknown as TokenVerifier;
  async health(): Promise<PortHealth> {
    return { status: "up", latency_ms: 0, checked_at: new Date().toISOString() };
  }
  protected async resolveUser(tenantId: string, _c: string, login: string) {
    return `u-${tenantId}-${login}`;
  }
  protected async idpSend() {
    this.calls.send++;
    return { ref: { k: String(++this.n) }, code: `1234${String(this.n % 100).padStart(2, "0")}` };
  }
  private tokens(userId: string, tid: string): IdpTokens {
    const now = Math.floor(Date.now() / 1000);
    return {
      accessToken: JSON.stringify({
        sub: userId,
        tid,
        typ: "user",
        roles: [],
        exp: now + 300,
        iat: now,
      }),
      refreshToken: `rt-${++this.n}`,
      expiresIn: 300,
      session: `sess-${this.n}`,
    };
  }
  protected async idpVerify(c: ChallengeRecord, code: string) {
    this.calls.verify++;
    return code === `1234${c.idpRef.k!.padStart(2, "0")}`
      ? this.tokens(c.userId, c.tenantId)
      : null;
  }
  protected async idpRefresh(rt: string) {
    return rt.startsWith("rt-") ? this.tokens("u-tnt_a-+919800000001", "tnt_a") : null;
  }
  protected async idpEndSession() {}
}

describe("the customer flow on a fake IdP", () => {
  const make = (now: { t: number }) => {
    const mail = capturingSender();
    const p = new FakeCustomerIdp({
      store: new MemoryCustomerAuthStore(),
      replay: new MemoryReplayStore(),
      revocations: new MemoryRevocationStore(),
      sender: mail.sender,
      now: () => now.t,
    });
    return { p, mail };
  };
  const login = "+919800000001";

  it("a locked account is refused before the IdP is asked, and the code is never in the result", async () => {
    const now = { t: Date.now() };
    const { p, mail } = make(now);
    const d = testDevice();
    const t = p.signInProofTarget;
    const pf = () => d.proof(t.htm, t.htu, { iat: Math.floor(now.t / 1000) });
    for (let f = 1; f <= 10; f++) {
      const ch = await p.startChallenge({
        tenantId: "tnt_a",
        channel: "sms",
        login,
        dpopProof: pf(),
      });
      expect(JSON.stringify(ch)).not.toContain(mail.inbox.get(login));
      await expect(
        p.verifyChallenge({
          tenantId: "tnt_a",
          challengeId: ch.challengeId,
          code: "000000",
          dpopProof: pf(),
        }),
      ).rejects.toMatchObject({ meta: { reason: "code" } });
      // The next try waits out the resend interval and, from the fifth failure, the back-off.
      if (f < 10) now.t += Math.max(31_000, f >= 5 ? 30_000 * 2 ** (f - 5) + 1000 : 0);
      else now.t += 31_000;
    }
    const verifies = p.calls.verify;
    const ch = await p
      .startChallenge({ tenantId: "tnt_a", channel: "sms", login, dpopProof: pf() })
      .catch((e: unknown) => e);
    expect(ch).toMatchObject({ code: "IPB-SEC-019", meta: { reason: "locked" } });
    expect(p.calls.verify).toBe(verifies);
  });

  it("a code has five tries; a sixth is refused without asking the IdP", async () => {
    const now = { t: Date.now() };
    const { p } = make(now);
    const d = testDevice();
    const t = p.signInProofTarget;
    const pf = () => d.proof(t.htm, t.htu, { iat: Math.floor(now.t / 1000) });
    const ch = await p.startChallenge({
      tenantId: "tnt_a",
      channel: "sms",
      login,
      dpopProof: pf(),
    });
    for (let i = 0; i < 5; i++)
      await expect(
        p.verifyChallenge({
          tenantId: "tnt_a",
          challengeId: ch.challengeId,
          code: "00000" + i,
          dpopProof: pf(),
        }),
      ).rejects.toMatchObject({ meta: { reason: "code" } });
    now.t += 120_000;
    const before = p.calls.verify;
    await expect(
      p.verifyChallenge({
        tenantId: "tnt_a",
        challengeId: ch.challengeId,
        code: "123401",
        dpopProof: pf(),
      }),
    ).rejects.toMatchObject({ code: "IPB-IDN-001", meta: { reason: "challenge" } });
    expect(p.calls.verify).toBe(before);
  });

  it("an expired code is refused; staff roles in a customer token are refused", async () => {
    const now = { t: Date.now() };
    const { p, mail } = make(now);
    const d = testDevice();
    const t = p.signInProofTarget;
    const pf = () => d.proof(t.htm, t.htu, { iat: Math.floor(now.t / 1000) });
    const ch = await p.startChallenge({
      tenantId: "tnt_a",
      channel: "sms",
      login,
      dpopProof: pf(),
    });
    now.t += 301_000;
    await expect(
      p.verifyChallenge({
        tenantId: "tnt_a",
        challengeId: ch.challengeId,
        code: mail.inbox.get(login)!,
        dpopProof: pf(),
      }),
    ).rejects.toMatchObject({ meta: { reason: "challenge" } });
    expect(
      () =>
        new FakeCustomerIdp({
          ...{
            store: new MemoryCustomerAuthStore(),
            replay: new MemoryReplayStore(),
            revocations: new MemoryRevocationStore(),
            sender: mail.sender,
          },
          customerRoles: ["ORG_ADMIN"],
        }),
    ).toThrow(RangeError);
  });

  it("the Redis replay store claims a jti once, with a TTL", async () => {
    const kv = new Map<string, number>();
    const redis = {
      async set(k: string, _v: string, _px: "PX", ttl: number, _nx: "NX") {
        if (kv.has(k)) return null;
        kv.set(k, ttl);
        return "OK" as const;
      },
    };
    const r = new RedisReplayStore(redis, "ipb:dpop:", () => T0);
    expect(await r.claim("jti-1", new Date(T0 + 90_000))).toBe(true);
    expect(await r.claim("jti-1", new Date(T0 + 90_000))).toBe(false);
    expect([...kv.values()]).toEqual([90_000]);
    expect([...kv.keys()][0]).toMatch(/^ipb:dpop:[0-9a-f]{64}$/);
  });
});

describe("retention of customer sign-in state (owner answer #86, R1-D-23)", () => {
  const H = 3_600_000;
  it("the defaults are the owner's and the registry's; values outside the bounds are refused", async () => {
    expect(customerRetentionSettings()).toEqual({
      challengeHours: 24,
      guardGraceSeconds: 0,
      deviceUnusedDays: 365,
    });
    const { SETTING_DEFS } = await import("@infrabyx/config/settings");
    for (const b of Object.values(CUSTOMER_RETENTION_SETTINGS)) {
      const def = (
        SETTING_DEFS as ReadonlyArray<{ key: string; default: unknown; min?: number; max?: number }>
      ).find((d) => d.key === b.key);
      expect(def, b.key).toMatchObject({ default: b.default, min: b.min, max: b.max });
    }
    expect(() => customerRetentionSettings({ deviceUnusedDays: 29 })).toThrow(RangeError);
    expect(() => customerRetentionSettings({ challengeHours: 0 })).toThrow(RangeError);
  });

  it("a guard row ends after its lock, its send window and a lockout after its last failure", () => {
    const c = {
      challengesExpiredBefore: 0,
      devicesUnusedSince: 0,
      guardsEndedBefore: T0,
      sendWindowMs: 600_000,
      lockoutMs: 900_000,
    };
    const g = { ...freshGuard(T0 - 700_000) };
    expect(guardEnded(g, c)).toBe(true);
    expect(guardEnded({ ...g, lockedUntil: T0 + 1 }, c)).toBe(false);
    expect(guardEnded({ ...freshGuard(T0 - 500_000) }, c)).toBe(false);
    expect(guardEnded({ ...g, failures: 3, lastFailureAt: T0 - 800_000 }, c)).toBe(false);
    expect(guardEnded({ ...g, failures: 3, lastFailureAt: T0 - 901_000 }, c)).toBe(true);
  });

  it("the job purges each tenant through the sweep with the settings it reads", async () => {
    const store = new MemoryCustomerAuthStore();
    const now = T0;
    const ch = (id: string, tenantId: string, expiresAt: number): ChallengeRecord => ({
      id,
      tenantId,
      userId: "u-1",
      channel: "sms",
      jkt: "a".repeat(43),
      idpRef: {},
      attempts: 0,
      expiresAt,
    });
    await store.saveChallenge(ch("c-old", "tnt_a", now - 25 * H));
    await store.saveChallenge(ch("c-new", "tnt_a", now - 23 * H));
    await store.saveChallenge(ch("c-b", "tnt_b", now - 47 * H));
    const settings = async (k: string) =>
      k === "int.identity.customer.retention.challenge_hours" ? 48 : undefined;
    const job = new CustomerSignInRetention({ store, settings, now: () => now, batch: 1 });
    const runs = await job.sweep({
      run: async (fn) =>
        Promise.all(
          ["tnt_a", "tnt_b"].map(async (tenantId) => ({
            tenantId,
            ok: true,
            value: await fn({ tenantId, principal: { id: "svc", type: "service", roles: [] } }),
          })),
        ),
    });
    // With 48 h, only tnt_a's 25 h challenge is too young as well; nothing in tnt_b is due.
    expect(runs.map((r) => r.value)).toEqual([
      { challenges: 0, guards: 0, devices: 0 },
      { challenges: 0, guards: 0, devices: 0 },
    ]);
    const job24 = new CustomerSignInRetention({ store, now: () => now, batch: 1 });
    expect(await job24.purgeTenant("tnt_a")).toEqual({ challenges: 1, guards: 0, devices: 0 });
    expect(await store.getChallenge("tnt_a", "c-old")).toBeUndefined();
    expect(await store.getChallenge("tnt_a", "c-new")).toBeDefined();
    expect(await job24.purgeTenant("tnt_b")).toEqual({ challenges: 1, guards: 0, devices: 0 });
  });

  it("unbinding a device deletes it at once; closing the account deletes every device", async () => {
    const now = { t: Date.now() };
    const store = new MemoryCustomerAuthStore();
    const mail = capturingSender();
    const p = new FakeCustomerIdp({
      store,
      replay: new MemoryReplayStore(),
      revocations: new MemoryRevocationStore(),
      sender: mail.sender,
      now: () => now.t,
    });
    const login = "+919800000002";
    const signIn = async () => {
      const d = testDevice();
      const t = p.signInProofTarget;
      const pf = () => d.proof(t.htm, t.htu, { iat: Math.floor(now.t / 1000) });
      const ch = await p.startChallenge({
        tenantId: "tnt_a",
        channel: "sms",
        login,
        dpopProof: pf(),
      });
      await p.verifyChallenge({
        tenantId: "tnt_a",
        challengeId: ch.challengeId,
        code: mail.inbox.get(login)!,
        dpopProof: pf(),
      });
      now.t += 31_000;
    };
    await signIn();
    await signIn();
    await signIn();
    const userId = `u-tnt_a-${login}`;
    const [first, ...rest] = await p.listDevices("tnt_a", userId);
    expect(rest).toHaveLength(2);
    await p.revokeDevice("tnt_a", userId, first!.id);
    expect((await p.listDevices("tnt_a", userId)).map((d) => d.id)).toEqual(rest.map((d) => d.id));
    await p.forgetDevices("tnt_a", userId);
    expect(await p.listDevices("tnt_a", userId)).toEqual([]);
  });
});
