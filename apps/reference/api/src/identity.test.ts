import { describe, expect, it } from "vitest";
import { cookie, cookieMap, newPkce, tokenFrom, KeycloakFlow, SESSION_COOKIE } from "./identity.js";
import { FixtureIdentity, FIXTURE_PERSONAS } from "./fixtures.js";

describe("PKCE and cookies (IPB-02-01, RFC 7636)", () => {
  it("makes a 43-character verifier with an S256 challenge", () => {
    const p = newPkce();
    expect(p.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(p.challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(p.state).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });
  it("builds Keycloak's authorisation URL with the challenge", () => {
    const u = new URL(
      new KeycloakFlow({
        baseUrl: "https://id.example.test/",
        realm: "r",
        clientId: "c",
      }).authorizeUrl({
        state: "s",
        codeChallenge: "ch",
        redirectUri: "https://api.example.test/auth/callback",
      }),
    );
    expect(u.pathname).toBe("/realms/r/protocol/openid-connect/auth");
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("client_id")).toBe("c");
  });
  it("sets HttpOnly cookies, Secure on https, and clears with Max-Age=0", () => {
    expect(cookie("a", "v", { secure: true, maxAgeSeconds: 60 })).toBe(
      "a=v; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=60",
    );
    expect(cookie("a", null, { secure: false })).toBe(
      "a=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0",
    );
    expect(cookieMap("a=1; b=%20x")).toEqual({ a: "1", b: " x" });
    expect(tokenFrom({ authorization: "Bearer t1", cookie: `${SESSION_COOKIE}=t2` })).toBe("t1");
    expect(tokenFrom({ cookie: `${SESSION_COOKIE}=t2` })).toBe("t2");
    expect(tokenFrom({})).toBeUndefined();
  });
});

describe("fixture IDENTITY", () => {
  it("signs in a persona and verifies its own tokens only", async () => {
    const id = new FixtureIdentity({ callbackUrl: "http://localhost/auth/callback" });
    const t = await id.authenticate({ kind: "oidc_code", value: "fixture:checker" });
    const c = await id.verifyToken(t.accessToken);
    expect(c.tid).toBe(FIXTURE_PERSONAS.checker.tenantId);
    expect(c.roles).toEqual(["ORG_CHECKER"]);
    await expect(id.verifyToken(`${t.accessToken}x`)).rejects.toMatchObject({
      code: "IPB-IDN-001",
    });
    await expect(
      id.authenticate({ kind: "oidc_code", value: "fixture:nobody" }),
    ).rejects.toMatchObject({
      code: "IPB-IDN-001",
    });
  });
});
