// CAPTCHA port fake and contract cases (Udofin PR-UDF-029; ADR-0004; R1-D-50). Every adapter passes
// the same cases against something that can mint tokens: the fake mints them itself, the vendor
// adapters run against `startCaptchaStub`. An adapter that cannot check the page's action declares
// `verifyAction: "unsupported"` and refuses a request that asks for it.
import { expect } from "vitest";
import { PortError } from "@infrabyx/contracts/errors";
import {
  CaptchaVerifyRequest,
  type AdapterDescriptor,
  type CaptchaPort,
  type CaptchaVerdict,
  type PortHealth,
} from "@infrabyx/contracts/ports";
import { randomBytes, toHex } from "@infrabyx/crypto";
import type { ContractCase } from "../contract.js";

export interface CaptchaTokenOptions {
  action?: string;
  hostname?: string;
}

/** Mints tokens the port under test will accept once, and expires one on demand. */
export interface CaptchaFixtures {
  issue(o?: CaptchaTokenOptions): Promise<string> | string;
  expire(token: string): Promise<void> | void;
}

interface Minted {
  action?: string;
  hostname: string;
  used: boolean;
  expired: boolean;
}

/** In-memory CAPTCHA: tokens are single-use and carry their action and hostname. */
export class FakeCaptcha implements CaptchaPort, CaptchaFixtures {
  readonly descriptor: AdapterDescriptor = {
    port: "CAPTCHA",
    adapter: "fake-captcha",
    residency: "IN",
    maxDataClass: "INTERNAL",
  };
  private readonly tokens = new Map<string, Minted>();
  /** Every token the fake was asked to verify, to prove nothing else is sent. */
  readonly seen: string[] = [];
  down = false;

  issue(o: CaptchaTokenOptions = {}): string {
    const t = `fake.${toHex(randomBytes(16))}`;
    this.tokens.set(t, {
      ...(o.action ? { action: o.action } : {}),
      hostname: o.hostname ?? "www.example.test",
      used: false,
      expired: false,
    });
    return t;
  }
  expire(token: string): void {
    const m = this.tokens.get(token);
    if (m) m.expired = true;
  }
  async health(): Promise<PortHealth> {
    return {
      status: this.down ? "down" : "up",
      latency_ms: 0,
      checked_at: new Date().toISOString(),
    };
  }
  async verify(raw: CaptchaVerifyRequest): Promise<CaptchaVerdict> {
    const r = CaptchaVerifyRequest.parse(raw);
    if (this.down)
      throw new PortError("IPB-PORT-002", "CAPTCHA", { adapter: "fake-captcha", detail: "down" });
    this.seen.push(r.token);
    const m = this.tokens.get(r.token);
    if (!m) return { ok: false, reason: "invalid" };
    if (m.expired) return { ok: false, reason: "expired" };
    if (m.used) return { ok: false, reason: "duplicate" };
    m.used = true;
    if (r.expectedHostname && r.expectedHostname !== m.hostname)
      return { ok: false, reason: "hostname_mismatch" };
    if (r.expectedAction && r.expectedAction !== m.action)
      return { ok: false, reason: "action_mismatch" };
    return { ok: true, hostname: m.hostname, ...(m.action ? { action: m.action } : {}) };
  }
}

export function captchaContractCases(f: CaptchaFixtures): ContractCase<CaptchaPort>[] {
  return [
    {
      name: "a fresh token passes once; the same token again is a duplicate",
      async run(p) {
        const t = await f.issue({ hostname: "www.example.test" });
        const v = await p.verify({ token: t, expectedHostname: "www.example.test" });
        expect(v).toMatchObject({ ok: true, hostname: "www.example.test" });
        expect(await p.verify({ token: t })).toEqual({ ok: false, reason: "duplicate" });
      },
    },
    {
      name: "an unknown or expired token is refused as a verdict, not an error",
      async run(p) {
        expect(await p.verify({ token: "never-issued" })).toEqual({ ok: false, reason: "invalid" });
        const t = await f.issue();
        await f.expire(t);
        // Turnstile reports an expired and a reused token with one code, read as `duplicate`.
        const v = await p.verify({ token: t });
        expect(v.ok).toBe(false);
        expect(["expired", "duplicate"]).toContain(!v.ok && v.reason);
      },
    },
    {
      name: "a token from another hostname is refused",
      async run(p) {
        const t = await f.issue({ hostname: "evil.example.test" });
        expect(await p.verify({ token: t, expectedHostname: "www.example.test" })).toEqual({
          ok: false,
          reason: "hostname_mismatch",
        });
      },
    },
    {
      name: "a token for another action is refused",
      method: "verifyAction",
      async invoke(p) {
        return p.verify({ token: await f.issue({ action: "signup" }), expectedAction: "signup" });
      },
      async run(p) {
        const t = await f.issue({ action: "contact" });
        expect(await p.verify({ token: t, expectedAction: "signup" })).toEqual({
          ok: false,
          reason: "action_mismatch",
        });
        const u = await f.issue({ action: "signup" });
        expect(await p.verify({ token: u, expectedAction: "signup" })).toMatchObject({
          ok: true,
          action: "signup",
        });
      },
    },
    {
      name: "a malformed request is refused before any call",
      async run(p) {
        await expect(p.verify({ token: "" })).rejects.toThrow();
        await expect(p.verify({ token: "x", expectedAction: "Not Valid" })).rejects.toThrow();
      },
    },
  ];
}
