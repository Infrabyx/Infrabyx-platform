// IDENTITY hermetic leg: Keycloak 26.8.1 in dev mode (PL2 plan §6.5). The realm is applied from
// `ipbRealm` with a generated bootstrap admin, then the adapter runs with its own service accounts.
// A test-only login driver walks the real login pages: provision → password → forced password
// change → TOTP enrolment (@IPB-02-31 first-login), an MFA login, the API MFA guard
// (@IPB-02-AT-02, API half), SCIM de-provisioning with old tokens refused (@IPB-02-05), revocation,
// back-channel logout, token verification rules (C-11) and the JWKS cache across an IdP outage.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { IdentityPort } from "@infrabyx/contracts/ports";
import { generateSeedPassword, randomBytes, toHex } from "@infrabyx/crypto";
import { defineContractSuite, startService, type StartedService } from "@infrabyx/testing";
import { assertMfaForRoles, MemoryRevocationStore } from "../common.js";
import { KEYCLOAK_IPB_SETTINGS, KEYCLOAK_SESSION_PROFILES, KeycloakIdentity } from "../keycloak.js";
import { LoginDriver, totp, totpSecretOf } from "./login-driver.js";

const REALM = "ipb-contract";
const API = "ipb-api";
const AUDIENCE = "ipb-api";
const pw = () => generateSeedPassword();
const admin = { username: "ipb-bootstrap", password: pw() };

let kc: StartedService;
let base = "";
let secrets = { clientSecret: "", adminClientSecret: "" };
let logoutServer: Server;
const logoutTokens: string[] = [];
const revocations = new MemoryRevocationStore();

beforeAll(async () => {
  logoutServer = createServer((req, res) => {
    let body = "";
    req.on("data", (c: Buffer) => (body += c.toString()));
    req.on("end", () => {
      const t = new URLSearchParams(body).get("logout_token");
      if (t) logoutTokens.push(t);
      res.writeHead(200).end();
    });
  });
  await new Promise<void>((r) => logoutServer.listen(0, "0.0.0.0", r));
  const hookPort = (logoutServer.address() as AddressInfo).port;

  kc = await startService("keycloak", {
    ports: [8080],
    env: {
      KC_BOOTSTRAP_ADMIN_USERNAME: admin.username,
      KC_BOOTSTRAP_ADMIN_PASSWORD: admin.password,
    },
    command: ["start-dev"],
    readyLog: /Listening on/,
    configure: (c) =>
      c.withExtraHosts([{ host: "host.docker.internal", ipAddress: "host-gateway" }]),
  });
  base = `http://${kc.host}:${kc.ports[8080]}`;
  secrets = await KeycloakIdentity.applyRealm({
    baseUrl: base,
    masterAdmin: admin,
    allowLoopbackHttp: true,
    spec: {
      realm: REALM,
      profile: "tenant",
      apiClient: {
        clientId: API,
        redirectUris: ["http://127.0.0.1/callback"],
        backchannelLogoutUrl: `http://host.docker.internal:${hookPort}/logout`,
      },
      adminClientId: "ipb-admin",
      audience: AUDIENCE,
      passkeys: true,
    },
  });
});
afterAll(async () => {
  await kc?.stop();
  await new Promise((r) => logoutServer?.close(r));
});

const adapter = () =>
  new KeycloakIdentity({
    baseUrl: base,
    realm: REALM,
    clientId: API,
    clientSecret: secrets.clientSecret,
    adminClientId: "ipb-admin",
    adminClientSecret: secrets.adminClientSecret,
    audience: AUDIENCE,
    revocations,
    allowLoopbackHttp: true,
  });
const issuer = () => `${base}/realms/${REALM}`;
const email = (n: string) => `${n}.${toHex(randomBytes(4))}@example.test`;

/** Log in with a password (and TOTP when asked); returns the access token. */
async function loginWith(
  p: KeycloakIdentity,
  username: string,
  password: string,
  otpSecret?: Uint8Array,
): Promise<string> {
  const r = await new LoginDriver(issuer(), API).login((page) => {
    if (page === "login") return { username, password, credentialId: "" };
    if (page === "otp" && otpSecret) return { otp: totp(otpSecret) };
    throw new Error(`unexpected page ${page}`);
  });
  return (
    await p.authenticate({
      kind: "oidc_code",
      value: r.code,
      redirectUri: r.redirectUri,
      codeVerifier: r.codeVerifier,
    })
  ).accessToken;
}

const tamper = (jwt: string) => {
  const [h, p, s] = jwt.split(".") as [string, string, string];
  const sig = Buffer.from(s, "base64url");
  sig.writeUInt8(sig.readUInt8(0) ^ 0x01, 0);
  return `${h}.${p}.${sig.toString("base64url")}`;
};

describe("IDENTITY hermetic leg: keycloak 26.8.1", () => {
  defineContractSuite<IdentityPort>(
    "IDENTITY",
    adapter,
    [
      {
        name: "realm settings read back equal to the IPB values (IPB-02-03, C-12)",
        async run(p) {
          expect(await (p as KeycloakIdentity).readRealmSettings()).toEqual({
            ...KEYCLOAK_IPB_SETTINGS,
            ...KEYCLOAK_SESSION_PROFILES.tenant,
          });
        },
      },
      {
        name: "@IPB-02-31 first login forces a password change and MFA enrolment; @IPB-02-AT-02 the API refuses a privileged token without MFA",
        async run(p) {
          const kp = p as KeycloakIdentity;
          const user = email("admin");
          const first = pw();
          const second = pw();
          await kp.provisionUser({
            email: user,
            displayName: "Tenant Admin",
            tenantId: "tnt_a",
            roles: ["ORG_ADMIN"],
            password: { value: first, temporary: true },
            mfaRequired: true,
          });
          let secret: Uint8Array = new Uint8Array();
          const r = await new LoginDriver(issuer(), API).login((page, html) => {
            if (page === "login") return { username: user, password: first, credentialId: "" };
            if (page === "update_password")
              return { "password-new": second, "password-confirm": second };
            if (page === "configure_totp") {
              secret = totpSecretOf(html);
              return {
                totp: totp(secret),
                totpSecret: new TextDecoder().decode(secret),
                userLabel: "contract",
              };
            }
            throw new Error(`unexpected page ${page}`);
          });
          // Keycloak orders required actions by priority: TOTP enrolment, then the password change.
          expect(r.pages).toEqual(["login", "configure_totp", "update_password"]);
          const firstToken = (
            await kp.authenticate({
              kind: "oidc_code",
              value: r.code,
              redirectUri: r.redirectUri,
              codeVerifier: r.codeVerifier,
            })
          ).accessToken;
          const claims = await kp.verifyToken(firstToken);
          expect(claims).toMatchObject({ tid: "tnt_a", typ: "user", roles: ["ORG_ADMIN"] });
          // Enrolment is not an MFA login: the API guard refuses the privileged role.
          expect(claims.mfa).toBe(false);
          expect(() => assertMfaForRoles(claims)).toThrow(
            expect.objectContaining({ code: "IPB-SEC-001" }),
          );
          // The next login asks for the TOTP and the token carries amr otp. A code is accepted
          // once, so wait for the next 30 s window after the enrolment code.
          await new Promise((res) => setTimeout(res, 30_500 - (Date.now() % 30_000)));
          const mfaToken = await loginWith(kp, user, second, secret);
          const mfa = await kp.verifyToken(mfaToken);
          expect(mfa.mfa).toBe(true);
          expect(() => assertMfaForRoles(mfa)).not.toThrow();
          const u = await kp.getUser(claims.sub);
          expect(u).toMatchObject({
            email: user,
            tenantId: "tnt_a",
            roles: ["ORG_ADMIN"],
            mfaEnrolled: true,
          });
        },
      },
      {
        name: "@IPB-02-05 SCIM create, update and deactivate; the old token is refused at once",
        async run(p) {
          const kp = p as KeycloakIdentity;
          const user = email("scim");
          const password = pw();
          const ext = `ext-${toHex(randomBytes(4))}`;
          expect(
            await kp.scimSync([
              {
                op: "create",
                user: {
                  externalId: ext,
                  email: user,
                  displayName: "Scim User",
                  tenantId: "tnt_a",
                  roles: ["ORG_MEMBER"],
                  password: { value: password, temporary: false },
                  mfaRequired: false,
                },
              },
            ]),
          ).toEqual([{ externalId: ext, ok: true }]);
          const token = await loginWith(kp, user, password);
          const c = await kp.verifyToken(token);
          expect(c.roles).toEqual(["ORG_MEMBER"]);
          expect(
            await kp.scimSync([
              { op: "update", externalId: ext, patch: { displayName: "Renamed" } },
            ]),
          ).toEqual([{ externalId: ext, ok: true }]);
          expect((await kp.getUser(c.sub)).displayName).toBe("Renamed");
          expect(await kp.scimSync([{ op: "deactivate", externalId: ext }])).toEqual([
            { externalId: ext, ok: true },
          ]);
          await expect(kp.verifyToken(token)).rejects.toMatchObject({ code: "IPB-IDN-001" });
          expect((await kp.getUser(c.sub)).enabled).toBe(false);
          expect(await kp.scimSync([{ op: "deactivate", externalId: "ext-missing" }])).toEqual([
            { externalId: "ext-missing", ok: false, error: "IPB-PORT-001" },
          ]);
        },
      },
      {
        name: "revokeSessions and back-channel logout refuse the old tokens (PR-012)",
        async run(p) {
          const kp = p as KeycloakIdentity;
          const user = email("revoke");
          const password = pw();
          const { id } = await kp.provisionUser({
            email: user,
            displayName: "Revoke Me",
            tenantId: "tnt_b",
            roles: ["ORG_MAKER"],
            password: { value: password, temporary: false },
            mfaRequired: false,
          });
          const t1 = await loginWith(kp, user, password);
          await kp.verifyToken(t1);
          expect((await kp.revokeSessions(id)).revoked).toBeGreaterThanOrEqual(1);
          await expect(kp.verifyToken(t1)).rejects.toMatchObject({ code: "IPB-IDN-001" });
          // A new login after the revocation works; a back-channel logout then revokes its session.
          await new Promise((r) => setTimeout(r, 1100));
          const t2 = await loginWith(kp, user, password);
          const c2 = await kp.verifyToken(t2);
          const before = logoutTokens.length;
          await adminCall("DELETE", `/sessions/${c2.sid}`);
          for (let i = 0; i < 50 && logoutTokens.length === before; i++)
            await new Promise((r) => setTimeout(r, 100));
          expect(logoutTokens.length).toBeGreaterThan(before);
          expect(await kp.handleLogoutToken(logoutTokens.at(-1)!)).toMatchObject({
            sid: c2.sid,
            sub: id,
          });
          await expect(kp.verifyToken(t2)).rejects.toMatchObject({ code: "IPB-IDN-001" });
          await expect(kp.handleLogoutToken(t2)).rejects.toMatchObject({ code: "IPB-IDN-001" });
        },
      },
      {
        name: "verifyToken refuses tampered tokens, other issuers and algorithms (C-11, IPB-IDN-001)",
        async run(p) {
          const { access_token } = await masterToken();
          await expect(p.verifyToken(access_token)).rejects.toMatchObject({ code: "IPB-IDN-001" });
          const svc = await p.issueToken({ subject: API, audience: AUDIENCE }, 300);
          await expect(p.verifyToken(tamper(svc.accessToken))).rejects.toMatchObject({
            code: "IPB-IDN-001",
          });
          await expect(p.verifyToken("a.b")).rejects.toMatchObject({ code: "IPB-IDN-001" });
        },
      },
      {
        name: "issueToken: client credentials give a platform service principal",
        method: "issueToken",
        async run(p) {
          const t = await p.issueToken({ subject: API, audience: AUDIENCE }, 300);
          expect(await p.verifyToken(t.accessToken)).toMatchObject({
            typ: "service",
            tid: "platform",
          });
          await expect(
            p.issueToken({ subject: API, audience: "someone-else" }, 300),
          ).rejects.toMatchObject({ code: "IPB-PORT-003" });
        },
      },
      {
        name: "issueToken with an actor (RFC 8693 act) is declared unsupported (PL2-D-55)",
        async run(p) {
          await expect(
            p.issueToken({ subject: "usr_x", audience: AUDIENCE, actor: "usr_ops" }, 300),
          ).rejects.toMatchObject({ code: "IPB-PORT-001", meta: { reason: "unsupported" } });
          await expect(p.authenticate({ kind: "saml", value: "x" })).rejects.toMatchObject({
            meta: { reason: "unsupported" },
          });
        },
      },
      {
        name: "linkFederation records the external identity",
        async run(p) {
          await adminCall("POST", "/identity-provider/instances", {
            alias: "partner",
            providerId: "oidc",
            enabled: true,
            config: {
              clientId: "x",
              clientSecret: "x",
              authorizationUrl: "https://partner.example.test/auth",
              tokenUrl: "https://partner.example.test/token",
            },
          });
          const { id } = await p.provisionUser({
            email: email("fed"),
            displayName: "Fed User",
            tenantId: "tnt_a",
            roles: ["ORG_MEMBER"],
            mfaRequired: false,
          });
          await p.linkFederation(id, { alias: "partner", subject: "partner-123" });
          const links = (await adminCall("GET", `/users/${id}/federated-identity`)) as Array<{
            identityProvider: string;
            userId: string;
          }>;
          expect(links).toEqual([
            expect.objectContaining({ identityProvider: "partner", userId: "partner-123" }),
          ]);
        },
      },
    ],
    { leg: "hermetic" },
  );

  it("JWKS stays cached across an IdP outage; new logins fail with IPB-IDN-002", async () => {
    const p = adapter();
    const t = await p.issueToken({ subject: API, audience: AUDIENCE }, 300);
    await p.verifyToken(t.accessToken);
    await kc.stop();
    expect((await p.verifyToken(t.accessToken)).typ).toBe("service");
    expect((await p.health()).status).toBe("down");
    await expect(
      p.authenticate({
        kind: "oidc_code",
        value: "x",
        redirectUri: "http://127.0.0.1/callback",
        codeVerifier: "v",
      }),
    ).rejects.toMatchObject({ code: "IPB-IDN-002" });
  });
});

async function masterToken(): Promise<{ access_token: string }> {
  const r = await fetch(`${base}/realms/master/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "password",
      client_id: "admin-cli",
      ...admin,
    }).toString(),
  });
  return (await r.json()) as { access_token: string };
}

async function adminCall(method: string, path: string, body?: unknown): Promise<unknown> {
  const { access_token } = await masterToken();
  const r = await fetch(`${base}/admin/realms/${REALM}${path}`, {
    method,
    headers: { authorization: `Bearer ${access_token}`, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (r.status >= 300) throw new Error(`${method} ${path}: ${r.status} ${await r.text()}`);
  const text = await r.text();
  return text ? JSON.parse(text) : undefined;
}
