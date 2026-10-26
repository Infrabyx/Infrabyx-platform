// Unit tests for the shared IDENTITY layer: claim mapping, the MFA guard, the memory revocation
// store and the verifier (C-11 rules come from @infrabyx/crypto; here: mapping, revocation and the
// back-channel logout token rules).
// The test plays the IdP and signs tokens with its own key; verification runs through
// @infrabyx/crypto as in production.
// eslint-disable-next-line ipb/no-direct-crypto
import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  assertMfaForRoles,
  MemoryRevocationStore,
  PgRevocationStore,
  TokenVerifier,
  toVerifiedClaims,
} from "../common.js";
import { scimUserId, zitadelClaims } from "../zitadel.js";

const ISS = "https://id.example.test/realms/ld";
const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "k1", alg: "ES256", use: "sig" };

function jwt(payload: Record<string, unknown>, key: KeyObject = privateKey, kid = "k1"): string {
  const b = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const input = `${b({ alg: "ES256", kid, typ: "JWT" })}.${b(payload)}`;
  const sig = sign("sha256", Buffer.from(input), { key, dsaEncoding: "ieee-p1363" });
  return `${input}.${sig.toString("base64url")}`;
}

const now = Math.floor(Date.now() / 1000);
const base = {
  iss: ISS,
  aud: ["ipb-api", "account"],
  sub: "u-1",
  tid: "tnt_a",
  roles: ["ORG_ADMIN", "default-roles-ld", "offline_access", "ipb-mfa-required"],
  amr: ["pwd", "otp"],
  sid: "s-1",
  exp: now + 300,
  iat: now,
};

function verifier(revocations = new MemoryRevocationStore()) {
  let fetches = 0;
  const v = new TokenVerifier({
    issuer: ISS,
    audience: "ipb-api",
    jwksUrl: "https://id.example.test/certs",
    egress: (async () => {
      fetches++;
      return { status: 200, json: () => ({ keys: [jwk] }) };
    }) as never,
    revocations,
  });
  return { v, revocations, fetches: () => fetches };
}

describe("toVerifiedClaims", () => {
  it("keeps platform roles only, defaults the type to user, derives mfa from amr", () => {
    expect(toVerifiedClaims(base)).toMatchObject({
      sub: "u-1",
      tid: "tnt_a",
      typ: "user",
      roles: ["ORG_ADMIN"],
      mfa: true,
      sid: "s-1",
    });
    expect(toVerifiedClaims({ ...base, amr: ["pwd"] }).mfa).toBe(false);
    expect(toVerifiedClaims({ ...base, ptyp: "service" }).typ).toBe("service");
  });

  it("refuses a token without a tenant or with an unknown principal type (IPB-IDN-001)", () => {
    const { tid: _t, ...noTenant } = base;
    expect(() => toVerifiedClaims(noTenant)).toThrow(
      expect.objectContaining({ code: "IPB-IDN-001" }),
    );
    expect(() => toVerifiedClaims({ ...base, ptyp: "root" })).toThrow(
      expect.objectContaining({ code: "IPB-IDN-001" }),
    );
  });

  it("maps the RFC 8693 act claim", () => {
    expect(toVerifiedClaims({ ...base, act: { sub: "usr_ops", sid: "s-9" } }).act).toEqual({
      sub: "usr_ops",
      sid: "s-9",
    });
  });
});

describe("assertMfaForRoles (@IPB-02-AT-02, API half)", () => {
  it("refuses privileged roles without MFA with IPB-SEC-001; members pass", () => {
    const c = toVerifiedClaims({ ...base, amr: ["pwd"] });
    expect(() => assertMfaForRoles(c)).toThrow(expect.objectContaining({ code: "IPB-SEC-001" }));
    expect(() =>
      assertMfaForRoles(toVerifiedClaims({ ...c, roles: ["ORG_MEMBER"] })),
    ).not.toThrow();
    expect(() =>
      assertMfaForRoles(toVerifiedClaims({ ...base, roles: ["OPS_SUPPORT"], amr: ["pwd"] })),
    ).toThrow(expect.objectContaining({ code: "IPB-SEC-001" }));
    expect(() => assertMfaForRoles(toVerifiedClaims(base))).not.toThrow();
  });
});

describe("TokenVerifier", () => {
  it("verifies and maps a token; JWKS is fetched once", async () => {
    const { v, fetches } = verifier();
    expect((await v.verify(jwt(base))).roles).toEqual(["ORG_ADMIN"]);
    await v.verify(jwt({ ...base, sub: "u-2" }));
    expect(fetches()).toBe(1);
  });

  it("refuses wrong audience, issuer, expiry and foreign keys", async () => {
    const { v } = verifier();
    const other = generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey;
    for (const t of [
      jwt({ ...base, aud: "other" }),
      jwt({ ...base, iss: "https://evil.test" }),
      jwt({ ...base, exp: now - 3600 }),
      jwt(base, other),
    ])
      await expect(v.verify(t)).rejects.toMatchObject({ code: "IPB-IDN-001" });
  });

  it("refuses revoked sessions and users issued before the revocation", async () => {
    const { v, revocations } = verifier();
    await revocations.revoke("tnt_a", "session", "s-1", new Date(), "logout");
    await expect(v.verify(jwt(base))).rejects.toMatchObject({
      code: "IPB-IDN-001",
      meta: { reason: "revoked" },
    });
    expect((await v.verify(jwt({ ...base, sid: "s-2" }))).sid).toBe("s-2");
    await revocations.revoke(
      "tnt_a",
      "user",
      "u-1",
      new Date((now + 10) * 1000),
      "revoke_sessions",
    );
    await expect(v.verify(jwt({ ...base, sid: "s-2" }))).rejects.toMatchObject({
      code: "IPB-IDN-001",
    });
    // Another tenant's user with the same subject is untouched.
    expect((await v.verify(jwt({ ...base, sid: "s-3", tid: "tnt_b" }))).tid).toBe("tnt_b");
    // A token issued after the revocation is accepted.
    expect((await v.verify(jwt({ ...base, sid: "s-4", iat: now + 11 }))).sid).toBe("s-4");
  });

  it("checks back-channel logout tokens (Back-Channel Logout 1.0 §2.6)", async () => {
    const { v } = verifier();
    const event = { "http://schemas.openid.net/event/backchannel-logout": {} };
    const lt = { iss: ISS, aud: "ipb-api", iat: now, exp: now + 120, jti: "j", events: event };
    expect(await v.verifyLogoutToken(jwt({ ...lt, sid: "s-1", sub: "u-1" }), "ipb-api")).toEqual({
      sid: "s-1",
      sub: "u-1",
    });
    for (const bad of [
      { ...lt, sid: "s-1", events: {} },
      { ...lt, sid: "s-1", nonce: "n" },
      { ...lt },
    ])
      await expect(v.verifyLogoutToken(jwt(bad), "ipb-api")).rejects.toMatchObject({
        code: "IPB-IDN-001",
      });
    await expect(
      v.verifyLogoutToken(jwt({ ...lt, sid: "s-1" }), "another-client"),
    ).rejects.toMatchObject({ code: "IPB-IDN-001" });
  });
});

describe("PgRevocationStore options", () => {
  it("refuses a cache refresh slower than 15 s (60 s bound, IPB-02-05)", () => {
    expect(
      () =>
        new PgRevocationStore({
          kernel: {} as never,
          audit: {} as never,
          context: () => ({}) as never,
          refreshMs: 16_000,
        }),
    ).toThrow(/15 s/);
  });
});

describe("zitadelClaims", () => {
  const b = (v: string) => Buffer.from(v).toString("base64");
  it("maps metadata, project roles and amr to the platform claims", () => {
    const c = toVerifiedClaims(
      zitadelClaims({
        ...base,
        tid: undefined,
        roles: undefined,
        amr: ["pwd", "mfa", "otp"],
        "urn:zitadel:iam:user:metadata": {
          tenant_id: b("tnt_a"),
          principal_type: b("service"),
          product_scope: b("LD,UDF"),
        },
        "urn:zitadel:iam:org:project:roles": { ORG_CHECKER: { "1": "org" }, other_role: {} },
        "urn:zitadel:iam:org:project:123:roles": { ORG_CHECKER: {}, ORG_MAKER: {} },
      }),
    );
    expect(c).toMatchObject({
      tid: "tnt_a",
      typ: "service",
      product_scope: ["LD", "UDF"],
      roles: ["ORG_CHECKER", "ORG_MAKER"],
      mfa: true,
    });
  });

  it("refuses a token without tenant metadata; SMS-only amr is not MFA", () => {
    expect(() => toVerifiedClaims(zitadelClaims({ ...base, tid: undefined }))).toThrow(
      expect.objectContaining({ code: "IPB-IDN-001" }),
    );
    const meta = { "urn:zitadel:iam:user:metadata": { tenant_id: b("tnt_a") } };
    expect(toVerifiedClaims(zitadelClaims({ ...base, ...meta, amr: ["pwd", "sms"] })).mfa).toBe(
      false,
    );
  });

  it("derives a stable SCIM user id per organisation", () => {
    expect(scimUserId("o1", "e1")).toBe(scimUserId("o1", "e1"));
    expect(scimUserId("o1", "e1")).not.toBe(scimUserId("o2", "e1"));
    expect(scimUserId("o1", "e1")).toMatch(/^ext[0-9a-f]{40}$/);
  });
});
