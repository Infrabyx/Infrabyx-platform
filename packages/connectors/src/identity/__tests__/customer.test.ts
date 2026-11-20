// Customer sign-in core (R1-D-19) on a fake IdP and a fake clock: the IPB-02 auth.otp schedule
// (10 codes per 10 minutes, back-off after 5 wrong codes, a 15-minute lockout after 10), settings
// bounds, the challenge and device rules, and the Redis replay store's contract.
import { describe, expect, it } from "vitest";
import { IpbError } from "@infrabyx/contracts/errors";
import {
  CUSTOMER_STEP_UP_DEFAULT,
  customerStepUpPolicies,
  type AdapterDescriptor,
  type DpopTarget,
  type PortHealth,
  type VerifiedClaims,
} from "@infrabyx/contracts";
import { MemoryReplayStore } from "@infrabyx/crypto";
import { MemoryRevocationStore, stepUpChallenge, type TokenVerifier } from "../common.js";
import {
  assertCustomerStepUp,
  CUSTOMER_STEP_UP_ACTION,
  customerStepUpChallenge,
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
      const raw = JSON.parse(Buffer.from(jwt, "base64url").toString("utf8")) as Record<
        string,
        unknown
      >;
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
      // A fake token in the token68 alphabet, so a request can carry it (`Authorization: DPoP`).
      accessToken: Buffer.from(
        JSON.stringify({ sub: userId, tid, typ: "user", roles: [], exp: now + 300, iat: now }),
      ).toString("base64url"),
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

describe("PR-UDF-056 the customer step-up on a fake IdP (@IPB-02-01, auth.otp; R1-D-244)", () => {
  const API = "https://api.example.test/v1/documents/doc_1/original";
  const login = "+919800000001";
  const userId = `u-tnt_a-${login}`;
  type Dev = ReturnType<typeof testDevice>;
  const make = (store: CustomerAuthStore = new MemoryCustomerAuthStore()) => {
    const now = { t: Date.parse("2026-11-20T09:00:00Z") };
    const mail = capturingSender();
    const p = new FakeCustomerIdp({
      store,
      replay: new MemoryReplayStore(),
      revocations: new MemoryRevocationStore(),
      sender: mail.sender,
      now: () => now.t,
    });
    const iat = () => Math.floor(now.t / 1000);
    const pf = (dev: Dev) =>
      dev.proof(p.signInProofTarget.htm, p.signInProofTarget.htu, { iat: iat() });
    const signIn = async (dev = testDevice()) => {
      const ch = await p.startChallenge({
        tenantId: "tnt_a",
        channel: "sms",
        login,
        dpopProof: pf(dev),
      });
      const session = await p.verifyChallenge({
        tenantId: "tnt_a",
        challengeId: ch.challengeId,
        code: mail.inbox.get(login)!,
        dpopProof: pf(dev),
      });
      return { dev, session, at: now.t };
    };
    const call = (dev: Dev, token: string, fresh?: boolean) =>
      p.verifyRequest({
        authorization: `DPoP ${token}`,
        dpopProof: dev.proof("GET", API, { accessToken: token, iat: iat() }),
        method: "GET",
        url: API,
        ...(fresh === undefined ? {} : { fresh }),
      });
    const start = (dev: Dev, deviceId: string, o: { login?: string } = {}) =>
      p.startStepUp({
        tenantId: "tnt_a",
        userId,
        deviceId,
        channel: "sms",
        login: o.login ?? login,
        dpopProof: pf(dev),
      });
    const confirm = (dev: Dev, deviceId: string, challengeId: string, code: string) =>
      p.confirmStepUp({
        tenantId: "tnt_a",
        userId,
        deviceId,
        challengeId,
        code,
        dpopProof: pf(dev),
      });
    return { now, mail, p, store, pf, signIn, call, start, confirm };
  };
  const wrongFor = (code: string) => (code === "000000" ? "000001" : "000000");
  const refusal = (fn: () => unknown): IpbError | null => {
    try {
      fn();
    } catch (e) {
      return e as IpbError;
    }
    return null;
  };

  it("the session's acr and auth_time are its sign-in's; a refresh does not move them; a policy finds it stale later", async () => {
    const m = make();
    const a = await m.signIn();
    const c0 = await m.call(a.dev, a.session.accessToken);
    expect(c0).toMatchObject({ acr: "otp", auth_time: Math.floor(a.at / 1000) });
    expect(() => assertCustomerStepUp(c0, CUSTOMER_STEP_UP_DEFAULT, m.now.t)).not.toThrow();
    // A refresh is not an authentication.
    m.now.t += 120_000;
    const r = await m.p.refreshSession({
      tenantId: "tnt_a",
      refreshToken: a.session.refreshToken,
      dpopProof: m.pf(a.dev),
    });
    expect((await m.call(a.dev, r.accessToken)).auth_time).toBe(c0.auth_time);
    // 301 s after the sign-in the default policy asks for a step-up, in the RFC 9470 form.
    const e = refusal(() => assertCustomerStepUp(c0, CUSTOMER_STEP_UP_DEFAULT, a.at + 301_000));
    expect(e).toBeInstanceOf(IpbError);
    expect(e?.code).toBe("IPB-SEC-001");
    // Nothing else: not the session's level, its age, or which test failed.
    expect(e?.meta).toEqual({ step_up: true, customer: true, required_acr: "otp", max_age: 300 });
    expect(e?.detail).toBe("a fresh sign-in code is needed for this action");
    expect(customerStepUpChallenge(e)).toEqual({
      status: 401,
      requiredAcr: "otp",
      maxAge: 300,
      headers: {
        "www-authenticate":
          'DPoP error="insufficient_user_authentication", error_description="A fresh sign-in code is required", acr_values="otp", max_age=300, algs="ES256"',
      },
    });
    // The staff answer never renders a customer refusal (it would be the Bearer scheme).
    expect(stepUpChallenge(e)).toBeNull();
    expect(customerStepUpChallenge(new IpbError("IPB-SEC-001", {}))).toBeNull();
    expect(
      customerStepUpChallenge(
        new IpbError("IPB-SEC-001", {
          meta: { step_up: true, customer: true, required_acr: 'otp" x', max_age: 300 },
        }),
      ),
    ).toBeNull();
    expect(
      customerStepUpChallenge(
        new IpbError("IPB-SEC-001", {
          meta: { step_up: true, customer: true, required_acr: "otp" },
        }),
      ),
    ).toBeNull();
  });

  it("fails closed on a missing or unknown level, a missing or future auth_time, and a bad policy", () => {
    const t = Date.parse("2026-11-20T09:00:00Z");
    const s0 = Math.floor(t / 1000);
    const ok = (c: { acr?: string; auth_time?: number }, now = t) =>
      refusal(() => assertCustomerStepUp(c, { maxAgeSeconds: 60 }, now)) === null;
    expect(ok({ acr: "otp", auth_time: s0 })).toBe(true);
    expect(ok({ acr: "otp", auth_time: s0 - 60 })).toBe(true);
    expect(ok({ acr: "otp", auth_time: s0 - 61 })).toBe(false);
    expect(ok({ acr: "otp", auth_time: s0 + 30 })).toBe(true);
    expect(ok({ acr: "otp", auth_time: s0 + 31 })).toBe(false);
    expect(ok({ acr: "otp" })).toBe(false);
    expect(ok({ auth_time: s0 })).toBe(false);
    expect(ok({ acr: "1", auth_time: s0 })).toBe(false);
    expect(ok({ acr: "otp", auth_time: Number.NaN })).toBe(false);
    expect(() =>
      assertCustomerStepUp({ acr: "otp", auth_time: s0 }, { maxAgeSeconds: 10 }, t),
    ).toThrow(TypeError);
    const policies = customerStepUpPolicies({ "document.original.download": {} });
    expect(
      refusal(() =>
        assertCustomerStepUp(
          { acr: "otp", auth_time: s0 },
          policies["document.original.download"],
          t + 301_000,
        ),
      )?.meta,
    ).toMatchObject({ max_age: 300 });
  });

  it("a fresh code on the same device steps the session up; the age is the step-up's, not the sign-in's", async () => {
    const m = make();
    const a = await m.signIn();
    const dev = a.session.device.id;
    const c0 = await m.call(a.dev, a.session.accessToken);
    m.now.t += 400_000;
    const stepAt = m.now.t;
    const ch = await m.start(a.dev, dev);
    const code = m.mail.inbox.get(login)!;
    expect(code).toMatch(/^[0-9]{6}$/);
    expect(m.mail.sent.at(-1)).toEqual({
      channel: "sms",
      idempotencyKey: `otp:${ch.challengeId}:step_up`,
    });
    // The challenge keeps neither the code nor the login; the answer has no code.
    const saved = JSON.stringify(await m.store.getChallenge("tnt_a", ch.challengeId));
    expect(saved).not.toContain(code);
    // (The fake IdP's user ids embed the login; the challenge itself keeps no login.)
    expect(saved.replaceAll(userId, "")).not.toContain(login);
    expect(JSON.stringify(ch)).not.toContain(code);
    // A wrong code is refused and changes nothing.
    await expect(m.confirm(a.dev, dev, ch.challengeId, wrongFor(code))).rejects.toMatchObject({
      code: "IPB-IDN-001",
      meta: { reason: "code" },
    });
    expect((await m.call(a.dev, a.session.accessToken, true)).auth_time).toBe(c0.auth_time);
    const done = await m.confirm(a.dev, dev, ch.challengeId, code);
    expect(done).toEqual({ deviceId: dev, acr: "otp", authTime: new Date(stepAt).toISOString() });
    const c1 = await m.call(a.dev, a.session.accessToken, true);
    expect(c1).toMatchObject({ acr: "otp", auth_time: Math.floor(stepAt / 1000) });
    // The same instant: stale by the sign-in, fresh by the step-up.
    const at = stepAt + 200_000;
    expect(refusal(() => assertCustomerStepUp(c0, CUSTOMER_STEP_UP_DEFAULT, at))?.code).toBe(
      "IPB-SEC-001",
    );
    expect(refusal(() => assertCustomerStepUp(c1, CUSTOMER_STEP_UP_DEFAULT, at))).toBeNull();
    expect(
      refusal(() => assertCustomerStepUp(c1, CUSTOMER_STEP_UP_DEFAULT, stepAt + 301_000))?.code,
    ).toBe("IPB-SEC-001");
    expect((m.store as MemoryCustomerAuthStore).events.at(-1)).toEqual({
      tenantId: "tnt_a",
      userId,
      action: CUSTOMER_STEP_UP_ACTION,
    });
    // Used once, and never a sign-in code.
    await expect(m.confirm(a.dev, dev, ch.challengeId, code)).rejects.toMatchObject({
      meta: { reason: "challenge" },
    });
    await expect(
      m.p.verifyChallenge({
        tenantId: "tnt_a",
        challengeId: ch.challengeId,
        code,
        dpopProof: m.pf(a.dev),
      }),
    ).rejects.toMatchObject({ meta: { reason: "challenge" } });
  });

  it("is refused across devices and across sessions of one key, and for a login that is not the account's", async () => {
    const m = make();
    const a = await m.signIn();
    m.now.t += 31_000;
    const b = await m.signIn();
    m.now.t += 31_000;
    const sends = m.mail.sent.length;
    // Another device's key, or a key that is no signed-in device, cannot start it for device a.
    for (const dev of [b.dev, testDevice()])
      await expect(m.start(dev, a.session.device.id)).rejects.toMatchObject({
        code: "IPB-IDN-001",
        meta: { reason: "device" },
      });
    await expect(
      m.start(a.dev, a.session.device.id, { login: "+919800000999" }),
    ).rejects.toMatchObject({ meta: { reason: "login" } });
    expect(m.mail.sent).toHaveLength(sends);
    const ch = await m.start(a.dev, a.session.device.id);
    const code = m.mail.inbox.get(login)!;
    // For another device, or by another device's key, the code is refused.
    await expect(m.confirm(b.dev, b.session.device.id, ch.challengeId, code)).rejects.toMatchObject(
      { meta: { reason: "challenge" } },
    );
    await expect(m.confirm(b.dev, a.session.device.id, ch.challengeId, code)).rejects.toMatchObject(
      { meta: { reason: "dpop_jkt" } },
    );
    await m.confirm(a.dev, a.session.device.id, ch.challengeId, code);
    // Device b keeps its own sign-in time.
    expect((await m.call(b.dev, b.session.accessToken, true)).auth_time).toBe(
      Math.floor(b.at / 1000),
    );
    expect((await m.call(a.dev, a.session.accessToken, true)).auth_time).toBe(
      Math.floor(m.now.t / 1000),
    );

    // A step-up started on a session that is then signed out does not carry to the next session
    // of the same key (a new device id), and the old session cannot finish it.
    m.now.t += 31_000;
    const ch2 = await m.start(a.dev, a.session.device.id);
    const code2 = m.mail.inbox.get(login)!;
    await m.p.revokeDevice("tnt_a", userId, a.session.device.id);
    m.now.t += 31_000;
    const a2 = await m.signIn(a.dev);
    expect(a2.session.device.id).not.toBe(a.session.device.id);
    await expect(
      m.confirm(a.dev, a2.session.device.id, ch2.challengeId, code2),
    ).rejects.toMatchObject({ meta: { reason: "challenge" } });
    await expect(
      m.confirm(a.dev, a.session.device.id, ch2.challengeId, code2),
    ).rejects.toMatchObject({ meta: { reason: "device" } });
    expect((await m.call(a.dev, a2.session.accessToken, true)).auth_time).toBe(
      Math.floor(a2.at / 1000),
    );
  });

  it("is guarded like a sign-in code: the resend interval, five tries per code, the account's back-off", async () => {
    const m = make();
    const a = await m.signIn();
    const dev = a.session.device.id;
    // Inside the sign-in code's resend interval: refused before anything is sent.
    const sends = m.mail.sent.length;
    await expect(m.start(a.dev, dev)).rejects.toMatchObject({
      code: "IPB-SEC-019",
      meta: { reason: "resend_interval" },
    });
    expect(m.mail.sent).toHaveLength(sends);
    m.now.t += 31_000;
    const ch = await m.start(a.dev, dev);
    const code = m.mail.inbox.get(login)!;
    for (let i = 0; i < 5; i++)
      await expect(m.confirm(a.dev, dev, ch.challengeId, wrongFor(code))).rejects.toMatchObject({
        meta: { reason: "code" },
      });
    // Out of tries: dead, even with the right code; the account is backing off.
    await expect(m.confirm(a.dev, dev, ch.challengeId, code)).rejects.toMatchObject({
      meta: { reason: "challenge" },
    });
    // The failures are the account's: a sixth wrong code starts a 60 s back-off for every code.
    m.now.t += 31_000;
    const next = await m.start(a.dev, dev);
    const fresh = m.mail.inbox.get(login)!;
    await expect(m.confirm(a.dev, dev, next.challengeId, wrongFor(fresh))).rejects.toMatchObject({
      meta: { reason: "code" },
    });
    await expect(m.confirm(a.dev, dev, next.challengeId, fresh)).rejects.toMatchObject({
      code: "IPB-SEC-019",
      meta: { reason: "backoff" },
    });
    m.now.t += 61_000;
    await expect(m.confirm(a.dev, dev, next.challengeId, fresh)).resolves.toMatchObject({
      acr: "otp",
    });
  });

  it("a store without recordStepUp refuses before anything is sent; the memory store never moves the time back", async () => {
    const old: CustomerAuthStore = new Proxy(new MemoryCustomerAuthStore(), {
      get: (t, k) => (k === "recordStepUp" ? undefined : Reflect.get(t, k)),
    });
    const m = make(old);
    const a = await m.signIn();
    m.now.t += 31_000;
    const sends = m.mail.sent.length;
    await expect(m.start(a.dev, a.session.device.id)).rejects.toMatchObject({
      code: "IPB-PORT-001",
      meta: { reason: "unsupported" },
    });
    expect(m.mail.sent).toHaveLength(sends);
    // Claims still carry the sign-in's assurance.
    expect((await m.call(a.dev, a.session.accessToken)).acr).toBe("otp");

    const st = new MemoryCustomerAuthStore();
    const T = Date.parse("2026-11-20T09:00:00Z");
    await st.createDevice({
      id: "dev_1",
      tenantId: "tnt_a",
      userId,
      jkt: "a".repeat(43),
      idpSession: "s",
      refreshHash: "1".repeat(64),
      createdAt: T,
      lastUsedAt: T,
    });
    expect(await st.recordStepUp("tnt_a", "dev_1", "otp", T + 2000)).toBe(true);
    expect(await st.recordStepUp("tnt_a", "dev_1", "otp", T + 1000)).toBe(true);
    expect((await st.listDevices("tnt_a", userId))[0]).toMatchObject({
      stepUpAt: T + 2000,
      stepUpAcr: "otp",
    });
    expect(await st.recordStepUp("tnt_b", "dev_1", "otp", T + 3000)).toBe(false);
    await st.revokeDevice("tnt_a", "dev_1", "sign_out", T + 4000);
    expect(await st.recordStepUp("tnt_a", "dev_1", "otp", T + 5000)).toBe(false);
  });
});
