// The product MFA floor (LawDocsComply PR-LDC-55, Finbyx PR-FBX-12 item 2; R1-D-127, R1-D-135):
// tighten-only roles, the RFC 9470 step-up answer, SMS excluded for named roles, and the boot
// check that keeps step-up routes reachable (@IPB-02-AT-02, API half).
import { describe, expect, it } from "vitest";
import { IpbError } from "@infrabyx/contracts/errors";
import { MFA_REQUIRED_ROLE_FLOOR, PLATFORM_MFA_FLOOR, mfaFloor } from "@infrabyx/contracts";
import {
  STEP_UP_ROUTE_PATTERNS,
  assertMfaForRoles,
  assertStepUpReachable,
  stepUpChallenge,
  toVerifiedClaims,
} from "../common.js";

const now = Math.floor(Date.now() / 1000);
const claims = (roles: string[], amr: string[] | undefined, extra: Record<string, unknown> = {}) =>
  toVerifiedClaims({
    sub: "usr_1",
    tid: "tnt_a",
    roles,
    ...(amr ? { amr } : {}),
    exp: now + 300,
    iat: now,
    ...extra,
  });
const caught = (f: () => void): IpbError | null => {
  try {
    f();
    return null;
  } catch (e) {
    return e as IpbError;
  }
};

describe("mfaFloor", () => {
  it("adds a product's roles and never removes a platform role", () => {
    const f = mfaFloor({ roles: ["PRD_PARTNER", "FN:COMPLIANCE_OFFICER"] });
    for (const r of MFA_REQUIRED_ROLE_FLOOR) expect(f.roles).toContain(r);
    expect(f.roles).toContain("PRD_PARTNER");
    expect(Object.isFrozen(f) && Object.isFrozen(f.roles)).toBe(true);
    expect(() => mfaFloor({ roles: ["partner"] })).toThrow(TypeError);
    expect(() => mfaFloor({ smsExcludedRoles: ["PRD_PARTNER"] })).toThrow(/not on the floor/);
    expect(
      mfaFloor({ roles: ["PRD_PARTNER"], smsExcludedRoles: ["PRD_PARTNER", "ORG_OWNER"] })
        .smsExcludedRoles,
    ).toEqual(["PRD_PARTNER", "ORG_OWNER"]);
    expect(PLATFORM_MFA_FLOOR.roles).toEqual(MFA_REQUIRED_ROLE_FLOOR);
  });

  it("guards a product role, and the platform floor still applies to a hand-made floor", () => {
    const f = mfaFloor({ roles: ["PRD_PARTNER"] });
    expect(caught(() => assertMfaForRoles(claims(["PRD_PARTNER"], ["pwd"]), f))?.code).toBe(
      "IPB-SEC-001",
    );
    expect(caught(() => assertMfaForRoles(claims(["PRD_PARTNER"], ["pwd"])))).toBeNull();
    expect(caught(() => assertMfaForRoles(claims(["PRD_PARTNER"], ["pwd", "otp"]), f))).toBeNull();
    const empty = { roles: [], smsExcludedRoles: [] };
    expect(caught(() => assertMfaForRoles(claims(["ORG_OWNER"], ["pwd"]), empty))?.code).toBe(
      "IPB-SEC-001",
    );
  });
});

describe("SMS as a second factor", () => {
  const f = mfaFloor({ roles: ["PRD_PARTNER"], smsExcludedRoles: ["PRD_PARTNER"] });
  it("does not count for an excluded role, and counts for the others", () => {
    const sms = claims(["PRD_PARTNER"], ["pwd", "sms", "mfa"]);
    expect(sms.mfa).toBe(true);
    const e = caught(() => assertMfaForRoles(sms, f));
    expect(e?.code).toBe("IPB-SEC-001");
    expect(e?.detail).toMatch(/other than SMS/);
    expect(
      caught(() => assertMfaForRoles(claims(["ORG_ADMIN"], ["pwd", "sms", "mfa"]), f)),
    ).toBeNull();
    for (const factor of ["otp", "totp", "hwk", "swk", "webauthn"])
      expect(
        caught(() => assertMfaForRoles(claims(["PRD_PARTNER"], ["pwd", "sms", factor]), f)),
      ).toBeNull();
  });
  it("fails closed when the token says mfa but not which factor", () => {
    expect(
      caught(() => assertMfaForRoles(claims(["PRD_PARTNER"], undefined, { mfa: true }), f))?.code,
    ).toBe("IPB-SEC-001");
  });
});

describe("step-up answer (RFC 9470)", () => {
  it("is the 403 by default and a 401 challenge with acr_values when asked", () => {
    const c = claims(["ORG_OWNER"], ["pwd"]);
    const plain = caught(() => assertMfaForRoles(c));
    expect(plain?.httpStatus).toBe(403);
    expect(stepUpChallenge(plain)).toBeNull();
    const e = caught(() =>
      assertMfaForRoles(c, PLATFORM_MFA_FLOOR, { stepUp: { acrValues: "mfa" } }),
    );
    expect(e?.meta).toMatchObject({ step_up: true, required_acr: "mfa" });
    expect(stepUpChallenge(e)).toEqual({
      status: 401,
      requiredAcr: "mfa",
      headers: {
        "www-authenticate":
          'Bearer error="insufficient_user_authentication", error_description="Multi-factor authentication is required", acr_values="mfa"',
      },
    });
    expect(stepUpChallenge(new Error("x"))).toBeNull();
    expect(
      stepUpChallenge(
        new IpbError("IPB-SEC-001", { meta: { step_up: true, required_acr: 'x" y' } }),
      ),
    ).toBeNull();
    expect(() =>
      assertMfaForRoles(c, PLATFORM_MFA_FLOOR, { stepUp: { acrValues: 'a"b' } }),
    ).toThrow(TypeError);
  });
  it("names the SMS exclusion in the challenge", () => {
    const f = mfaFloor({ roles: ["PRD_PARTNER"], smsExcludedRoles: ["PRD_PARTNER"] });
    const e = caught(() =>
      assertMfaForRoles(claims(["PRD_PARTNER"], ["pwd", "sms"], { mfa: true }), f, {
        stepUp: { acrValues: "urn:ipb:acr:phr" },
      }),
    );
    expect(stepUpChallenge(e)?.headers["www-authenticate"]).toContain("other than SMS");
  });
  it("carries amr and acr on the verified claims, bounded", () => {
    const c = claims(["ORG_MEMBER"], ["pwd", "otp"], { acr: "2" });
    expect(c).toMatchObject({ amr: ["pwd", "otp"], acr: "2" });
    expect(
      claims(
        ["ORG_MEMBER"],
        Array.from({ length: 40 }, () => "pwd"),
      ).amr,
    ).toHaveLength(16);
  });
});

describe("assertStepUpReachable", () => {
  it("refuses to boot when a step-up route is behind the floor", () => {
    expect(() =>
      assertStepUpReachable([
        { path: "/api/v1/cases/:id", mfaFloor: true },
        { path: "/oauth/callback", mfaFloor: false },
        { path: "/auth/mfa/enrol", mfaFloor: false },
      ]),
    ).not.toThrow();
    for (const path of [
      "/oauth/callback",
      "/auth/oidc/callback",
      "/auth/mfa/enrol",
      "/logout",
      "/session/refresh",
      "/.well-known/openid-configuration",
    ])
      expect(() => assertStepUpReachable([{ path, mfaFloor: true }]), path).toThrow(
        /step-up routes/,
      );
    expect(() =>
      assertStepUpReachable([{ path: "/api/v1/step", mfaFloor: true, stepUp: true }]),
    ).toThrow();
    expect(() =>
      assertStepUpReachable([{ path: "/api/v1/otp-reports", mfaFloor: true }]),
    ).not.toThrow();
    expect(() =>
      assertStepUpReachable([{ path: "/admin/mfa", mfaFloor: true, stepUp: false }]),
    ).not.toThrow();
    expect(STEP_UP_ROUTE_PATTERNS.length).toBeGreaterThan(0);
  });
});
