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
  CUSTOMER_EMAIL_CAPTURE_SETTING,
  CUSTOMER_IDENTITY_SETTINGS,
  CustomerIdentityBase,
  customerIdentitySettings,
  readCustomerEmailCapture,
  type CustomerAuthStore,
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
  private readonly owners = new Map<string, string>();
  private readonly taken = new Set<string>();
  private moved = 0;
  protected async resolveUser(tenantId: string, _c: string, login: string) {
    const k = `${tenantId}|${login}`;
    let id = this.owners.get(k);
    if (!id) {
      id = `u-${tenantId}-${login}`;
      if (this.taken.has(id)) id = `${id}-${++this.moved}`;
      this.owners.set(k, id);
      this.taken.add(id);
    }
    return id;
  }
  protected async idpFindUser(tenantId: string, _c: string, login: string) {
    return this.owners.get(`${tenantId}|${login}`);
  }
  protected async idpChangeLogin(a: {
    tenantId: string;
    userId: string;
    from: string;
    to: string;
  }) {
    this.owners.delete(`${a.tenantId}|${a.from}`);
    this.owners.set(`${a.tenantId}|${a.to}`, a.userId);
  }
  protected async idpRetireLogin(a: { tenantId: string; login: string }) {
    this.owners.delete(`${a.tenantId}|${a.login}`);
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

describe("PR-UDF-034 changing and retiring a customer login on a fake IdP", () => {
  const now = { t: Date.now() };
  const mail = capturingSender();
  const store = new MemoryCustomerAuthStore();
  const p = new FakeCustomerIdp({
    store,
    replay: new MemoryReplayStore(),
    revocations: new MemoryRevocationStore(),
    sender: mail.sender,
    now: () => now.t,
  });
  const t = p.signInProofTarget;
  const d = testDevice();
  const pf = (dev = d) => dev.proof(t.htm, t.htu, { iat: Math.floor(now.t / 1000) });
  const from = "+919800000101";
  const to = "+919800000102";
  const ids = [
    `u-tnt_a-${"+919800000101"}`,
    `u-tnt_a-${"+919800000101"}-1`,
    `u-tnt_a-${"+919800000101"}-2`,
  ];
  /** The account a session's device belongs to. */
  const sub = async (s: { device: { id: string } }, _dev?: unknown) => {
    for (const id of ids)
      if ((await p.listDevices("tnt_a", id)).some((x) => x.id === s.device.id)) return id;
    return undefined;
  };
  const signIn = async (login: string, dev = d) => {
    now.t += 31_000;
    const ch = await p.startChallenge({
      tenantId: "tnt_a",
      channel: "sms",
      login,
      dpopProof: pf(dev),
    });
    return p.verifyChallenge({
      tenantId: "tnt_a",
      challengeId: ch.challengeId,
      code: mail.inbox.get(login)!,
      dpopProof: pf(dev),
    });
  };

  it("needs both codes from the same key, keeps the account and frees the old login", async () => {
    const s = await signIn(from);
    const userId = (await sub(s))!;
    expect(userId).toBe(`u-tnt_a-${from}`);
    now.t += 31_000;
    const req = {
      tenantId: "tnt_a",
      userId,
      channel: "sms" as const,
      currentLogin: from,
      newLogin: to,
    };
    await expect(
      p.startLoginChange({ ...req, currentLogin: "+919800000199", dpopProof: pf() }),
    ).rejects.toMatchObject({ meta: { reason: "login" } });
    await expect(
      p.startLoginChange({ ...req, newLogin: from, dpopProof: pf() }),
    ).rejects.toMatchObject({ meta: { reason: "login" } });
    const ch = await p.startLoginChange({ ...req, dpopProof: pf() });
    const oldCode = mail.inbox.get(from)!;
    const newCode = mail.inbox.get(to)!;
    expect(JSON.stringify(ch)).not.toContain(newCode);
    expect(JSON.stringify(await store.getChallenge("tnt_a", ch.challengeId))).not.toContain(to);
    const confirm = (o: { oldCode: string; newCode: string; newLogin?: string }, dev = d) =>
      p.confirmLoginChange({ ...req, ...o, challengeId: ch.challengeId, dpopProof: pf(dev) });
    await expect(confirm({ oldCode, newCode }, testDevice())).rejects.toMatchObject({
      code: "IPB-IDN-001",
    });
    await expect(confirm({ oldCode: newCode, newCode: oldCode })).rejects.toMatchObject({
      meta: { reason: "code" },
    });
    await expect(confirm({ oldCode, newCode, newLogin: "+919800000103" })).rejects.toMatchObject({
      meta: { reason: "code" },
    });
    await confirm({ oldCode, newCode });
    await expect(confirm({ oldCode, newCode })).rejects.toMatchObject({
      meta: { reason: "challenge" },
    });
    expect(store.events).toEqual([
      { tenantId: "tnt_a", userId, action: "identity.customer.login.change" },
    ]);
    // The new login signs in to the same account; the old one opens a new account.
    expect(await sub(s)).toBe(userId);
    const fresh = testDevice();
    expect(await sub(await signIn(from, fresh), fresh)).toBe(`u-tnt_a-${from}-1`);
  });

  it("retires a login: devices forgotten, the login free for a new account", async () => {
    const other = (await p.listDevices("tnt_a", `u-tnt_a-${from}-1`)).length;
    expect(other).toBeGreaterThan(0);
    await expect(
      p.retireLogin({ tenantId: "tnt_a", userId: `u-tnt_a-${to}`, channel: "sms", login: from }),
    ).rejects.toMatchObject({ meta: { reason: "login" } });
    await p.retireLogin({
      tenantId: "tnt_a",
      userId: `u-tnt_a-${from}-1`,
      channel: "sms",
      login: from,
    });
    expect(await p.listDevices("tnt_a", `u-tnt_a-${from}-1`)).toHaveLength(0);
    expect(store.events.at(-1)?.action).toBe("identity.customer.login.retire");
    const dev = testDevice();
    expect(await sub(await signIn(from, dev), dev)).toBe(`u-tnt_a-${from}-2`);
  });
});

describe("PR-UDF-055 the verified email of a customer on a fake IdP (@IPB-02-01, auth.otp)", () => {
  const now = { t: Date.now() };
  const make = (emailCapture: boolean | undefined, store = new MemoryCustomerAuthStore()) => {
    const mail = capturingSender();
    const p = new FakeCustomerIdp({
      store,
      replay: new MemoryReplayStore(),
      revocations: new MemoryRevocationStore(),
      sender: mail.sender,
      ...(emailCapture === undefined ? {} : { emailCapture }),
      now: () => now.t,
    });
    return { p, mail, store };
  };
  const d = testDevice();
  const pf = (p: FakeCustomerIdp, dev = d) =>
    dev.proof(p.signInProofTarget.htm, p.signInProofTarget.htu, {
      iat: Math.floor(now.t / 1000),
    });
  const userId = "u-tnt_a-+919800000201";
  const start = (p: FakeCustomerIdp, email: string, dev = d) =>
    p.startEmailVerification({ tenantId: "tnt_a", userId, email, dpopProof: pf(p, dev) });
  /** Sign the account in on device `d` (only a signed-in device may start the capture). */
  const signIn = async (p: FakeCustomerIdp, mail: ReturnType<typeof capturingSender>) => {
    const login = "+919800000201";
    const ch = await p.startChallenge({
      tenantId: "tnt_a",
      channel: "sms",
      login,
      dpopProof: pf(p),
    });
    await p.verifyChallenge({
      tenantId: "tnt_a",
      challengeId: ch.challengeId,
      code: mail.inbox.get(login)!,
      dpopProof: pf(p),
    });
    now.t += 31_000; // past the resend interval of the sign-in code
  };
  const signedIn = async (store?: MemoryCustomerAuthStore) => {
    const m = make(true, store);
    await signIn(m.p, m.mail);
    return m;
  };

  it("is off by default, and the setting is registered off", async () => {
    const { p, mail } = make(undefined);
    await expect(start(p, "a@b.example")).rejects.toMatchObject({
      code: "IPB-PORT-001",
      meta: { reason: "disabled" },
    });
    expect(mail.sent).toHaveLength(0);
    expect(await readCustomerEmailCapture(async () => undefined)).toBe(false);
    expect(await readCustomerEmailCapture(async () => true)).toBe(true);
    const { SETTING_DEFS } = await import("@infrabyx/config/settings");
    expect(
      (SETTING_DEFS as ReadonlyArray<{ key: string; default: unknown }>).find(
        (x) => x.key === CUSTOMER_EMAIL_CAPTURE_SETTING,
      ),
    ).toMatchObject({ default: false });
  });

  it("sends a code to the address and records it with verified_at; the challenge keeps neither", async () => {
    const { p, mail, store } = await signedIn();
    now.t += 60_000;
    // A key that is no signed-in device of this account cannot start it; nothing is sent.
    const sends = mail.sent.length;
    await expect(start(p, "asha.rao@mail.example", testDevice())).rejects.toMatchObject({
      code: "IPB-IDN-001",
      meta: { reason: "device" },
    });
    expect(mail.sent).toHaveLength(sends);
    const ch = await start(p, "  Asha.Rao@Mail.Example ");
    const code = mail.inbox.get("asha.rao@mail.example")!;
    expect(code).toMatch(/^[0-9]{6}$/);
    expect(mail.sent.at(-1)).toEqual({
      channel: "email",
      idempotencyKey: `otp:${ch.challengeId}:email`,
    });
    const saved = JSON.stringify(await store.getChallenge("tnt_a", ch.challengeId));
    expect(saved).not.toContain(code);
    expect(saved).not.toContain("asha.rao");
    expect(JSON.stringify(ch)).not.toContain(code);
    // A sign-in refuses the challenge: it is not a sign-in code.
    await expect(
      p.verifyChallenge({ tenantId: "tnt_a", challengeId: ch.challengeId, code, dpopProof: pf(p) }),
    ).rejects.toMatchObject({ meta: { reason: "challenge" } });
    const confirm = (o: { code?: string; email?: string; userId?: string }, dev = d) =>
      p.confirmEmailVerification({
        tenantId: "tnt_a",
        userId: o.userId ?? userId,
        challengeId: ch.challengeId,
        email: o.email ?? "asha.rao@mail.example",
        code: o.code ?? code,
        dpopProof: pf(p, dev),
      });
    // Another device key, another account, another address or a wrong code are refused.
    await expect(confirm({}, testDevice())).rejects.toMatchObject({ code: "IPB-IDN-001" });
    await expect(confirm({ userId: "u-other" })).rejects.toMatchObject({
      meta: { reason: "challenge" },
    });
    await expect(confirm({ email: "other@mail.example" })).rejects.toMatchObject({
      meta: { reason: "code" },
    });
    await expect(confirm({ code: code === "000000" ? "000001" : "000000" })).rejects.toMatchObject({
      meta: { reason: "code" },
    });
    expect(await p.verifiedEmail("tnt_a", userId)).toBeNull();
    const v = await confirm({});
    expect(v).toEqual({
      email: "asha.rao@mail.example",
      verifiedAt: new Date(now.t).toISOString(),
    });
    expect(await p.verifiedEmail("tnt_a", userId)).toEqual(v);
    expect(store.events.at(-1)).toEqual({
      tenantId: "tnt_a",
      userId,
      action: "identity.customer.email.verify",
    });
    // Used once; another tenant has nothing.
    await expect(confirm({})).rejects.toMatchObject({ meta: { reason: "challenge" } });
    expect(await p.verifiedEmail("tnt_b", userId)).toBeNull();
  });

  it("five tries per code, and the resend interval, as for a sign-in code (auth.otp settings)", async () => {
    const { p, mail } = await signedIn();
    now.t += 3_600_000;
    const ch = await start(p, "b@mail.example");
    const code = mail.inbox.get("b@mail.example")!;
    const wrong = code === "000000" ? "000001" : "000000";
    const confirm = (c: string) =>
      p.confirmEmailVerification({
        tenantId: "tnt_a",
        userId,
        challengeId: ch.challengeId,
        email: "b@mail.example",
        code: c,
        dpopProof: pf(p),
      });
    for (let i = 0; i < 5; i++)
      await expect(confirm(wrong)).rejects.toMatchObject({ meta: { reason: "code" } });
    // Out of tries: the code is dead, even the right one.
    await expect(confirm(code)).rejects.toMatchObject({ meta: { reason: "challenge" } });
    expect(await p.verifiedEmail("tnt_a", userId)).toBeNull();
    // A second code inside the resend interval is refused before anything is sent (the guard is
    // the account's, shared with sign-in codes).
    const sends = mail.sent.length;
    await expect(start(p, "b@mail.example")).rejects.toMatchObject({
      code: "IPB-SEC-019",
      meta: { reason: "resend_interval" },
    });
    expect(mail.sent.length).toBe(sends);
  });

  it("ten wrong codes lock the account for the lockout, then a new code works", async () => {
    const { p, mail } = await signedIn();
    now.t += 3_600_000;
    // Wrong codes until the tenth failure, waiting out each back-off and asking for a new code
    // when one is dead (expired or out of tries).
    let ch = await start(p, "c@mail.example");
    let failures = 0;
    while (failures < 10) {
      const code = mail.inbox.get("c@mail.example")!;
      const e = (await p
        .confirmEmailVerification({
          tenantId: "tnt_a",
          userId,
          challengeId: ch.challengeId,
          email: "c@mail.example",
          code: code === "000000" ? "000001" : "000000",
          dpopProof: pf(p),
        })
        .then(
          () => ({}),
          (x: unknown) => x,
        )) as { meta?: { reason?: string; retryAfterSeconds?: number } };
      const reason = e.meta?.reason;
      if (reason === "code") failures++;
      else if (reason === "backoff") now.t += (e.meta!.retryAfterSeconds ?? 0) * 1000;
      else if (reason === "challenge") {
        now.t += 31_000;
        ch = await start(p, "c@mail.example");
      } else throw new Error(`unexpected ${JSON.stringify(e)}`);
    }
    await expect(start(p, "c@mail.example")).rejects.toMatchObject({
      code: "IPB-SEC-019",
      meta: { reason: "locked" },
    });
    now.t += 900_000;
    const fresh = await start(p, "c@mail.example");
    await expect(
      p.confirmEmailVerification({
        tenantId: "tnt_a",
        userId,
        challengeId: fresh.challengeId,
        email: "c@mail.example",
        code: mail.inbox.get("c@mail.example")!,
        dpopProof: pf(p),
      }),
    ).resolves.toMatchObject({ email: "c@mail.example" });
  });

  it("refuses a malformed address before sending; a store without the methods is unsupported", async () => {
    const { p, mail } = await signedIn();
    await expect(start(p, "not-an-address")).rejects.toMatchObject({
      meta: { reason: "email" },
    });
    // Only the sign-in code went out.
    expect(mail.sent.map((m) => m.channel)).toEqual(["sms"]);
    // A store written before the email methods existed.
    const old: CustomerAuthStore = new Proxy(new MemoryCustomerAuthStore(), {
      get: (t, k) =>
        k === "saveVerifiedEmail" || k === "verifiedEmail" ? undefined : Reflect.get(t, k),
    });
    const { p: q } = make(true, old as MemoryCustomerAuthStore);
    await expect(q.verifiedEmail("tnt_a", userId)).rejects.toMatchObject({
      code: "IPB-PORT-001",
      meta: { reason: "unsupported" },
    });
  });

  /** Record an address on the signed-in account through the port. */
  const verify = async (
    p: FakeCustomerIdp,
    mail: ReturnType<typeof capturingSender>,
    e: string,
  ) => {
    now.t += 60_000;
    const ch = await start(p, e);
    return p.confirmEmailVerification({
      tenantId: "tnt_a",
      userId,
      challengeId: ch.challengeId,
      email: e,
      code: mail.inbox.get(e)!,
      dpopProof: pf(p),
    });
  };

  it("R1-D-235: erasure deletes the address, ledgered; a second erasure deletes nothing; a new proof works", async () => {
    const { p, mail, store } = await signedIn();
    await verify(p, mail, "erase@mail.example");
    await expect(
      p.eraseVerifiedEmail({ tenantId: "tnt_a", userId, requestRef: "bad ref" }),
    ).rejects.toThrow(RangeError);
    expect(await p.eraseVerifiedEmail({ tenantId: "tnt_a", userId, requestRef: "er-1" })).toEqual({
      erased: true,
    });
    expect(await p.verifiedEmail("tnt_a", userId)).toBeNull();
    expect(store.events.at(-1)).toEqual({
      tenantId: "tnt_a",
      userId,
      action: "identity.customer.verified_email.delete",
    });
    expect(await p.eraseVerifiedEmail({ tenantId: "tnt_a", userId, requestRef: "er-1" })).toEqual({
      erased: false,
    });
    await expect(verify(p, mail, "again@mail.example")).resolves.toMatchObject({
      email: "again@mail.example",
    });
    // Erasure works with the capture off as well.
    const off = make(false, store);
    expect(
      await off.p.eraseVerifiedEmail({ tenantId: "tnt_a", userId, requestRef: "er-2" }),
    ).toEqual({ erased: true });
  });

  it("R1-D-235: retireLogin deletes the address with the account; a store that cannot delete refuses first", async () => {
    // A store that saves an address but cannot delete it: retireLogin and erasure refuse before
    // any change (no device forgotten, the login still the account's).
    const half: CustomerAuthStore = new Proxy(new MemoryCustomerAuthStore(), {
      get: (t, k) => (k === "deleteVerifiedEmail" ? undefined : Reflect.get(t, k)),
    });
    const h = await signedIn(half as MemoryCustomerAuthStore);
    const retire = (q: FakeCustomerIdp) =>
      q.retireLogin({ tenantId: "tnt_a", userId, channel: "sms", login: "+919800000201" });
    await expect(retire(h.p)).rejects.toMatchObject({
      code: "IPB-PORT-001",
      meta: { reason: "unsupported" },
    });
    await expect(
      h.p.eraseVerifiedEmail({ tenantId: "tnt_a", userId, requestRef: "er-3" }),
    ).rejects.toMatchObject({ code: "IPB-PORT-001", meta: { reason: "unsupported" } });
    expect(await h.p.listDevices("tnt_a", userId)).toHaveLength(1);
    // A store that keeps no address at all retires as before.
    const none: CustomerAuthStore = new Proxy(new MemoryCustomerAuthStore(), {
      get: (t, k) =>
        k === "saveVerifiedEmail" || k === "verifiedEmail" || k === "deleteVerifiedEmail"
          ? undefined
          : Reflect.get(t, k),
    });
    const n = await signedIn(none as MemoryCustomerAuthStore);
    await retire(n.p);
    await expect(
      n.p.eraseVerifiedEmail({ tenantId: "tnt_a", userId, requestRef: "er-4" }),
    ).rejects.toMatchObject({ code: "IPB-PORT-001", meta: { reason: "unsupported" } });

    const { p, mail, store } = await signedIn();
    await verify(p, mail, "close@mail.example");
    await retire(p);
    expect(await p.verifiedEmail("tnt_a", userId)).toBeNull();
    expect(await p.listDevices("tnt_a", userId)).toHaveLength(0);
    expect(store.events.slice(-2).map((e) => e.action)).toEqual([
      "identity.customer.verified_email.delete",
      "identity.customer.login.retire",
    ]);
  });
});
