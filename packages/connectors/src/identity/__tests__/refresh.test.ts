// The refresh-token grant on the workforce adapters (LawDocsComply PR-LDC-03, R1-D-77), against
// recorded Keycloak 26 and Zitadel v4 answers: the request each adapter sends, rotation, reuse
// mapped to IPB-IDN-001 `refresh_reused` with the session revoked, other refusals as
// `refresh_invalid`, and no refresh token in any error. The same cases run against the real IdPs
// in the hermetic legs (CI).
import { describe, expect, it } from "vitest";
import { MemoryRefreshTokenLedger, MemoryRevocationStore } from "../common.js";
import { KEYCLOAK_REFRESH_REUSED, KeycloakIdentity } from "../keycloak.js";
import { ZitadelIdentity } from "../zitadel.js";
import {
  keycloakRefreshToken,
  recordedFetch,
  signedAccessToken,
  TEST_JWK,
  type Route,
} from "./recorded-idp.js";

const KC = "https://id.example.test";
const ISS = `${KC}/realms/ld`;
const now = () => Math.floor(Date.now() / 1000);
const access = (sid: string | undefined, extra: Record<string, unknown> = {}) =>
  signedAccessToken({
    iss: ISS,
    aud: ["ipb-api"],
    sub: "u-1",
    tid: "tnt_a",
    roles: ["ORG_MEMBER"],
    ...(sid ? { sid } : {}),
    iat: now(),
    exp: now() + 300,
    ...extra,
  });

/** Refusal of a refresh, with every text the error carries. */
async function refusal(
  p: { refreshSession(r: { refreshToken: string }): Promise<unknown> },
  t: string,
) {
  try {
    await p.refreshSession({ refreshToken: t });
  } catch (e) {
    const x = e as { code?: string; message?: string; detail?: string; meta?: unknown };
    return { code: x.code, meta: x.meta, text: JSON.stringify([x.message, x.detail, x.meta]) };
  }
  throw new Error("accepted");
}

describe("KeycloakIdentity.refreshSession (recorded Keycloak 26)", () => {
  const user = {
    id: "u-1",
    username: "a@example.test",
    enabled: true,
    attributes: { tenant_id: ["tnt_a"] },
  };
  const base: Route[] = [
    [
      "GET",
      "/realms/ld/protocol/openid-connect/certs",
      { status: 200, body: { keys: [TEST_JWK] } },
    ],
    ["GET", "/admin/realms/ld/users/u-1", { status: 200, body: user }],
    ["GET", "/admin/realms/ld/users/u-1/sessions", { status: 200, body: [{ id: "s-1" }] }],
    ["POST", "/admin/realms/ld/users/u-1/logout", { status: 204 }],
    ["DELETE", /^\/admin\/realms\/ld\/sessions\/[^/]+$/, { status: 204 }],
  ];
  const tokenRoute = (reply: Route[2]): Route => [
    "POST",
    "/realms/ld/protocol/openid-connect/token",
    (req) => {
      if (req.form?.grant_type === "client_credentials")
        return { status: 200, body: { access_token: "admin-token", expires_in: 300 } };
      return typeof reply === "function" ? reply(req) : reply;
    },
  ];
  const adapter = (routes: Route[]) => {
    const rec = recordedFetch([...routes, ...base]);
    const revocations = new MemoryRevocationStore();
    const p = new KeycloakIdentity({
      baseUrl: KC,
      realm: "ld",
      clientId: "ipb-api",
      clientSecret: "client-secret",
      adminClientId: "ipb-admin",
      adminClientSecret: "admin-secret",
      audience: "ipb-api",
      revocations,
      fetchImpl: rec.fetch,
    });
    return { p, calls: rec.calls, revocations };
  };

  it("sends the refresh grant with the client's credentials and returns the rotated tokens", async () => {
    const old = keycloakRefreshToken({ sub: "u-1", sid: "s-1" });
    const next = keycloakRefreshToken({ sub: "u-1", sid: "s-1", jti: "2" });
    const at = access("s-1");
    const { p, calls } = adapter([
      tokenRoute({
        status: 200,
        body: {
          access_token: at,
          expires_in: 300,
          refresh_expires_in: 1800,
          refresh_token: next,
          token_type: "Bearer",
          id_token: "id-token",
          "not-before-policy": 0,
          session_state: "s-1",
          scope: "openid email profile",
        },
      }),
    ]);
    expect(await p.refreshSession({ refreshToken: old })).toEqual({
      accessToken: at,
      idToken: "id-token",
      refreshToken: next,
      expiresIn: 300,
    });
    const sent = calls.find((c) => c.form?.grant_type === "refresh_token")!;
    expect(sent.form).toEqual({
      grant_type: "refresh_token",
      refresh_token: old,
      client_id: "ipb-api",
      client_secret: "client-secret",
    });
  });

  it.each(["Stale token", "Maximum allowed refresh token reuse exceeded"])(
    "a reuse Keycloak reports as %j revokes the session first, then ends it at Keycloak",
    async (description) => {
      const old = keycloakRefreshToken({ sub: "u-1", sid: "s-7" });
      const { p, calls, revocations } = adapter([
        tokenRoute({
          status: 400,
          body: { error: "invalid_grant", error_description: description },
        }),
      ]);
      const r = await refusal(p, old);
      expect(r).toMatchObject({ code: "IPB-IDN-001", meta: { reason: "refresh_reused" } });
      expect(r.text).not.toContain(old);
      expect(
        await revocations.isRevoked({ tid: "tnt_a", sub: "u-1", sid: "s-7", iat: now() }),
      ).toBe(true);
      expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(
        expect.arrayContaining([
          "GET /admin/realms/ld/users/u-1",
          "DELETE /admin/realms/ld/sessions/s-7",
        ]),
      );
      // The other sessions of the user stay.
      expect(
        await revocations.isRevoked({ tid: "tnt_a", sub: "u-1", sid: "s-8", iat: now() }),
      ).toBe(false);
    },
  );

  it("a reused token without a session id revokes every session of its user", async () => {
    const old = keycloakRefreshToken({ sub: "u-1" });
    const { p, calls, revocations } = adapter([
      tokenRoute({
        status: 400,
        body: { error: "invalid_grant", error_description: "Stale token" },
      }),
    ]);
    expect(await refusal(p, old)).toMatchObject({ meta: { reason: "refresh_reused" } });
    expect(await revocations.isRevoked({ tid: "tnt_a", sub: "u-1", iat: now() - 1 })).toBe(true);
    expect(calls.map((c) => `${c.method} ${c.path}`)).toContain(
      "POST /admin/realms/ld/users/u-1/logout",
    );
  });

  it.each(["Session not active", "Invalid refresh token", "Token is not active"])(
    "any other invalid_grant (%j) is refresh_invalid and revokes nothing",
    async (description) => {
      const { p, calls } = adapter([
        tokenRoute({
          status: 400,
          body: { error: "invalid_grant", error_description: description },
        }),
      ]);
      expect(await refusal(p, keycloakRefreshToken({ sub: "u-1", sid: "s-1" }))).toMatchObject({
        code: "IPB-IDN-001",
        meta: { reason: "refresh_invalid" },
      });
      expect(calls.some((c) => c.path.startsWith("/admin/"))).toBe(false);
    },
  );

  it("refuses an empty token before any call; a client failure is IPB-PORT-001, an outage IPB-IDN-002", async () => {
    const { p, calls } = adapter([tokenRoute({ status: 200, body: {} })]);
    expect(await refusal(p, "")).toMatchObject({ meta: { reason: "refresh_invalid" } });
    expect(calls).toHaveLength(0);
    const bad = adapter([
      tokenRoute({ status: 401, body: { error: "unauthorized_client", error_description: "x" } }),
    ]);
    expect(await refusal(bad.p, "t")).toMatchObject({ code: "IPB-PORT-001" });
    const down = adapter([tokenRoute({ status: 503 })]);
    expect(await refusal(down.p, "t")).toMatchObject({ code: "IPB-IDN-002" });
  });

  it("refuses an answer that did not rotate the refresh token (IPB-PORT-002)", async () => {
    const old = keycloakRefreshToken({ sub: "u-1", sid: "s-1" });
    const { p } = adapter([
      tokenRoute({
        status: 200,
        body: { access_token: access("s-1"), expires_in: 300, refresh_token: old },
      }),
    ]);
    expect(await refusal(p, old)).toMatchObject({ code: "IPB-PORT-002" });
  });

  it("KEYCLOAK_REFRESH_REUSED matches the reuse descriptions only", () => {
    expect(KEYCLOAK_REFRESH_REUSED.test("Stale token")).toBe(true);
    expect(KEYCLOAK_REFRESH_REUSED.test("Maximum allowed refresh token reuse exceeded")).toBe(true);
    expect(KEYCLOAK_REFRESH_REUSED.test("Session not active")).toBe(false);
  });
});

describe("ZitadelIdentity.refreshSession (recorded Zitadel v4)", () => {
  const Z = "https://zitadel.example.test";
  const zAccess = (sid?: string) =>
    signedAccessToken({
      iss: Z,
      aud: ["project-1"],
      sub: "zu-1",
      ...(sid ? { sid } : {}),
      "urn:zitadel:iam:user:metadata": { tenant_id: Buffer.from("tnt_z").toString("base64") },
      iat: now(),
      exp: now() + 300,
    });
  const adapter = (tokens: Array<{ status: number; body: unknown }>) => {
    let n = 0;
    const rec = recordedFetch([
      ["GET", "/oauth/v2/keys", { status: 200, body: { keys: [TEST_JWK] } }],
      ["POST", "/oauth/v2/token", () => tokens[n++] ?? { status: 599 }],
      ["POST", "/oauth/v2/revoke", { status: 200 }],
      // No tenant SSO brokers in this organisation (the R1-D-78 guard reads them).
      ["POST", "/management/v1/metadata/_search", { status: 200, body: {} }],
      ["DELETE", /^\/v2\/sessions\/[^/]+$/, { status: 200, body: {} }],
    ]);
    const revocations = new MemoryRevocationStore();
    const ledger = new MemoryRefreshTokenLedger();
    const p = new ZitadelIdentity({
      baseUrl: Z,
      orgId: "org-1",
      projectId: "project-1",
      clientId: "api-client",
      clientSecret: "api-secret",
      serviceClient: { clientId: "svc", clientSecret: "svc-secret" },
      admin: { kind: "pat", token: "admin-pat" },
      revocations,
      refreshLedger: ledger,
      fetchImpl: rec.fetch,
    });
    return { p, calls: rec.calls, revocations, ledger };
  };
  const ok = (at: string, rt: string) => ({
    status: 200,
    body: { access_token: at, token_type: "Bearer", expires_in: 300, refresh_token: rt },
  });

  it("rotates with client_secret_basic; a spent token again is refresh_reused without asking Zitadel", async () => {
    const at = zAccess("zs-1");
    const { p, calls, revocations, ledger } = adapter([ok(at, "rt-2")]);
    const r1 = await p.refreshSession({ refreshToken: "rt-1" });
    expect(r1).toEqual({ accessToken: at, refreshToken: "rt-2", expiresIn: 300 });
    const sent = calls.find((c) => c.path === "/oauth/v2/token")!;
    expect(sent.form).toEqual({ grant_type: "refresh_token", refresh_token: "rt-1" });
    expect(sent.headers.authorization).toMatch(/^Basic /);
    // The ledger keeps hashes only.
    expect(
      JSON.stringify([...(ledger as unknown as { hashes: Map<string, unknown> }).hashes.keys()]),
    ).not.toMatch(/rt-/);

    const reused = await refusal(p, "rt-1");
    expect(reused).toMatchObject({ code: "IPB-IDN-001", meta: { reason: "refresh_reused" } });
    expect(reused.text).not.toContain("rt-1");
    expect(calls.filter((c) => c.path === "/oauth/v2/token")).toHaveLength(1);
    expect(
      await revocations.isRevoked({ tid: "tnt_z", sub: "zu-1", sid: "zs-1", iat: now() }),
    ).toBe(true);
    expect(calls.map((c) => `${c.method} ${c.path}`)).toContain("DELETE /v2/sessions/zs-1");

    // The successor is refused and revoked at Zitadel now that it is in hand.
    expect(await refusal(p, "rt-2")).toMatchObject({ meta: { reason: "refresh_invalid" } });
    const revoke = calls.find((c) => c.path === "/oauth/v2/revoke")!;
    expect(revoke.form).toEqual({ token: "rt-2", token_type_hint: "refresh_token" });
    expect(calls.filter((c) => c.path === "/oauth/v2/token")).toHaveLength(1);
  });

  it("without a session id in the tokens, a reuse revokes the user", async () => {
    const { p, revocations } = adapter([ok(zAccess(), "rt-b")]);
    await p.refreshSession({ refreshToken: "rt-a" });
    await new Promise((r) => setTimeout(r, 5));
    expect(await refusal(p, "rt-a")).toMatchObject({ meta: { reason: "refresh_reused" } });
    expect(await revocations.isRevoked({ tid: "tnt_z", sub: "zu-1", iat: now() - 1 })).toBe(true);
  });

  it("Zitadel's own refusal is refresh_invalid; an outage is IPB-IDN-002", async () => {
    const { p } = adapter([
      {
        status: 400,
        body: {
          error: "invalid_grant",
          error_description: "Errors.OIDCSession.RefreshTokenInvalid",
        },
      },
      { status: 503, body: {} },
    ]);
    expect(await refusal(p, "unknown")).toMatchObject({ meta: { reason: "refresh_invalid" } });
    expect(await refusal(p, "unknown-2")).toMatchObject({ code: "IPB-IDN-002" });
  });

  it("the ledger forgets hashes after the refresh lifetime", async () => {
    let t = 1_000_000;
    const l = new MemoryRefreshTokenLedger(() => t);
    await l.rotated("a", "b", { tenantId: "t", userId: "u" }, new Date(t + 1000));
    expect(await l.lookup("a")).toMatchObject({ spent: true, revoked: false });
    expect(await l.lookup("b")).toMatchObject({ spent: false });
    await l.rotated("b", "c", { tenantId: "t", userId: "u" }, new Date(t + 2000));
    await l.revokeFamily("c");
    expect(await l.lookup("a")).toMatchObject({ revoked: true });
    t += 5000;
    expect(await l.lookup("a")).toBeUndefined();
  });
});
