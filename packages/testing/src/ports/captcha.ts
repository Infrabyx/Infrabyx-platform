// CAPTCHA port fake and contract cases (Udofin PR-UDF-029; ADR-0004; R1-D-50). Every adapter passes
// the same cases against something that can mint tokens: the fake mints them itself, the vendor
// adapters run against `startCaptchaStub`. An adapter that cannot check the page's action declares
// `verifyAction: "unsupported"` and refuses a request that asks for it.
// CAPTCHA port fake and contract cases (Udofin PR-UDF-029; ADR-0004; R1-D-50). Every adapter passes
// the same cases against something that can mint tokens: the fake mints them itself, the vendor
// adapters run against `startCaptchaStub`. An adapter that cannot check the page's action declares
// `verifyAction: "unsupported"` and refuses a request that asks for it.
import { expect } from "vitest";
import type { CaptchaPort } from "@infrabyx/contracts/ports";
import type { ContractCase } from "../contract.js";
import { type CaptchaFixtures } from "@infrabyx/fakes";
export { type CaptchaTokenOptions, type CaptchaFixtures, FakeCaptcha } from "@infrabyx/fakes";

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
