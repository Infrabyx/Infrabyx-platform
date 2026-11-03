// CAPTCHA contract legs (Udofin PR-UDF-029; ADR-0004; R1-D-50): Turnstile (reference) and hCaptcha
// (alternative) against the siteverify stub, the fake as the in-memory alternative; then what
// only these adapters promise: only the token and the secret leave, the flags hold them off, a
// misconfigured secret is an error and never a customer's verdict, and the under-attack gate.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  captchaContractCases,
  defineContractSuite,
  FakeCaptcha,
  startCaptchaStub,
  type CaptchaStub,
} from "@infrabyx/testing";
import { CaptchaGate } from "../gate.js";
import { HCaptchaCaptcha, TurnstileCaptcha } from "../siteverify.js";

let stub: CaptchaStub;
let enabled = true;
let secret = "";
beforeAll(async () => {
  stub = await startCaptchaStub();
  secret = stub.secret;
});
afterAll(async () => stub?.close());

const opts = () => ({
  enabled: () => enabled,
  secret: () => secret,
  baseUrl: stub.url,
  allowLoopbackHttp: true,
});
const fixtures = {
  issue: (o?: { action?: string; hostname?: string }) => stub.issue(o),
  expire: (t: string) => stub.expire(t),
};

describe("CAPTCHA hermetic legs", () => {
  defineContractSuite(
    "CAPTCHA",
    () => new TurnstileCaptcha(opts()),
    captchaContractCases(fixtures),
    {
      leg: "hermetic",
    },
  );
  defineContractSuite(
    "CAPTCHA",
    () => new HCaptchaCaptcha(opts()),
    captchaContractCases(fixtures),
    {
      leg: "hermetic",
    },
  );
  const fake = new FakeCaptcha();
  defineContractSuite("CAPTCHA", () => fake, captchaContractCases(fake));
});

describe("R1-D-50 CAPTCHA adapters", () => {
  it("send only the token and the secret", async () => {
    const before = stub.requests.length;
    await new TurnstileCaptcha(opts()).verify({ token: stub.issue() });
    await new HCaptchaCaptcha(opts()).verify({ token: stub.issue() });
    for (const r of stub.requests.slice(before))
      expect([...r.form().keys()].sort()).toEqual(["response", "secret"]);
  });

  it("are off until their flag, with no request sent", async () => {
    enabled = false;
    try {
      const before = stub.requests.length;
      await expect(new TurnstileCaptcha(opts()).verify({ token: "t" })).rejects.toMatchObject({
        code: "IPB-PORT-001",
        meta: { reason: "adapter_disabled" },
      });
      expect(stub.requests.length).toBe(before);
      expect((await new TurnstileCaptcha(opts()).health()).status).toBe("down");
    } finally {
      enabled = true;
    }
  });

  it("treat a wrong secret as an error, never as a customer's verdict", async () => {
    secret = "wrong";
    try {
      await expect(
        new TurnstileCaptcha(opts()).verify({ token: stub.issue() }),
      ).rejects.toMatchObject({ code: "IPB-PORT-002" });
    } finally {
      secret = stub.secret;
    }
  });

  it("refuse a host off the allow-list", async () => {
    await expect(
      new TurnstileCaptcha({ ...opts(), baseUrl: "https://example.test" }).verify({ token: "t" }),
    ).rejects.toMatchObject({ code: "IPB-SEC-018" });
  });
});

describe("R1-D-50 the under-attack gate", () => {
  const fake = new FakeCaptcha();
  let attack = false;
  const gate = new CaptchaGate({ captcha: fake, underAttack: () => attack });

  it("costs nothing while off", async () => {
    expect(await gate.required()).toBe(false);
    expect(await gate.check({})).toEqual({ checked: false });
    expect(fake.seen).toHaveLength(0);
  });

  it("refuses a missing, refused or reused token while on, and fails closed when the vendor is down", async () => {
    attack = true;
    const code = (p: Promise<unknown>) =>
      p.then(
        () => null,
        (e: { code?: string; meta?: { reason?: string } }) => `${e.code}:${e.meta?.reason}`,
      );
    expect(await code(gate.check({}))).toBe("IPB-SEC-019:missing");
    expect(await code(gate.check({ token: "nope" }))).toBe("IPB-SEC-019:invalid");
    const t = fake.issue({ action: "signup" });
    expect(await gate.check({ token: t, expectedAction: "signup" })).toEqual({ checked: true });
    expect(await code(gate.check({ token: t }))).toBe("IPB-SEC-019:duplicate");
    fake.down = true;
    expect(await code(gate.check({ token: fake.issue() }))).toBe("IPB-SEC-019:unavailable");
    fake.down = false;
    attack = false;
  });
});
