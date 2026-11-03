// Turnstile and hCaptcha siteverify stubs (Udofin PR-UDF-029; R1-D-50): one stub answers both
// vendors' paths, mints tokens for the contract cases, and records every request so a test can
// prove only the token and the secret were sent.
import { randomBytes, toHex } from "@infrabyx/crypto";
import { startStub, stubCredential, type VendorStub } from "./http.js";
import type { CaptchaFixtures, CaptchaTokenOptions } from "../ports/captcha.js";

export interface CaptchaStub extends VendorStub, CaptchaFixtures {
  readonly secret: string;
  issue(o?: CaptchaTokenOptions): string;
  expire(token: string): void;
}

export async function startCaptchaStub(): Promise<CaptchaStub> {
  const secret = stubCredential();
  const tokens = new Map<
    string,
    { action?: string; hostname: string; used: boolean; expired: boolean }
  >();
  const stub = await startStub((r) => {
    const turnstile = r.path === "/turnstile/v0/siteverify";
    const hcaptcha = r.path === "/siteverify";
    if (r.method !== "POST" || (!turnstile && !hcaptcha)) return { status: 404, body: {} };
    const f = r.form();
    if (f.get("secret") !== secret)
      return { status: 200, body: { success: false, "error-codes": ["invalid-input-secret"] } };
    const token = f.get("response") ?? "";
    const m = tokens.get(token);
    const fail = (code: string) => ({
      status: 200,
      body: { success: false, "error-codes": [code] },
    });
    if (!token) return fail("missing-input-response");
    if (!m) return fail("invalid-input-response");
    if (m.expired) return fail(turnstile ? "timeout-or-duplicate" : "expired-input-response");
    if (m.used) return fail(turnstile ? "timeout-or-duplicate" : "already-seen-response");
    m.used = true;
    return {
      status: 200,
      body: {
        success: true,
        challenge_ts: new Date().toISOString(),
        hostname: m.hostname,
        ...(turnstile && m.action ? { action: m.action } : {}),
      },
    };
  });
  return Object.assign(stub, {
    secret,
    issue(o: CaptchaTokenOptions = {}) {
      const t = `stub.${toHex(randomBytes(16))}`;
      tokens.set(t, {
        ...(o.action ? { action: o.action } : {}),
        hostname: o.hostname ?? "www.example.test",
        used: false,
        expired: false,
      });
      return t;
    },
    expire(token: string) {
      const m = tokens.get(token);
      if (m) m.expired = true;
    },
  });
}
