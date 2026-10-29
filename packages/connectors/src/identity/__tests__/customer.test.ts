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
  MemoryCustomerAuthStore,
  readCustomerIdentitySettings,
  RedisReplayStore,
  type ChallengeRecord,
  type IdpTokens,
} from "../customer.js";
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
