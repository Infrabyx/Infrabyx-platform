// IDENTITY hermetic leg: Zitadel v4.19.5 with PostgreSQL on a private network (PL2 plan §6.5).
// The image is published only on GHCR, so this leg runs in CI (port-contract.yml), not in the
// build sandbox. Zitadel starts from init with a generated master key and a bootstrap machine
// user whose PAT is written to a bind mount; `applyInstance` then applies the IPB settings, the
// ES256 web key, the platform project, API app and service principal; `applyCustomerOrg` then
// creates a customer organisation, and the shared customer sign-in cases run there (R1-D-19).
// For a local run against an instance started by hand, set IPB_TEST_ZITADEL_URL and put its
// bootstrap PAT at $TMPDIR/ipb-zitadel/admin.pat (the outage case is then skipped).
import { chmod, mkdtemp, readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PLATFORM_ROLES, TENANT_ROLES } from "@infrabyx/contracts";
import type {
  CustomerIdentityPort,
  IdentityBrokerAdmin,
  IdentityPort,
  IdentitySessionRefresh,
} from "@infrabyx/contracts/ports";
import {
  generateSeedPassword,
  MemoryReplayStore,
  randomBytes,
  sha256,
  toBase64Url,
  toHex,
} from "@infrabyx/crypto";
import {
  defineContractSuite,
  existingServiceUrl,
  identityBrokerContractCases,
  identityRefreshContractCases,
  startNetwork,
  startService,
  type StartedService,
} from "@infrabyx/testing";
import { MemoryRefreshTokenLedger, MemoryRevocationStore } from "../common.js";
import { MemoryCustomerAuthStore } from "../customer.js";
import { scimUserId, ZITADEL_IPB_SETTINGS, ZitadelIdentity } from "../zitadel.js";
import { ZitadelCustomerIdentity } from "../zitadel-customer.js";
import { customerCases } from "./customer.cases.js";
import { capturingSender } from "./dpop-device.js";

let net: { name: string; stop(): Promise<void> };
let db: StartedService;
let z: StartedService;
let base = "";
let pat = "";
let inst: Awaited<ReturnType<typeof ZitadelIdentity.applyInstance>>;
let customer: Awaited<ReturnType<typeof ZitadelCustomerIdentity.applyCustomerOrg>>;
const CUSTOMER_ROLES = ["IPB_CUSTOMER"] as const;
const customerStore = new MemoryCustomerAuthStore();
const customerReplay = new MemoryReplayStore();
const mail = capturingSender();
const revocations = new MemoryRevocationStore();
const refreshLedger = new MemoryRefreshTokenLedger();
/** The broker client secret behind `secret://memory/idp/contract#client_secret` (R1-D-78). */
const BROKER_SECRET = generateSeedPassword();

const freePort = () =>
  new Promise<number>((resolve) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => resolve(p));
    });
  });

/** Local runs only: an instance started by hand (`IPB_TEST_ZITADEL_URL`), its PAT in the temp dir. */
const LOCAL = await existingServiceUrl("zitadel");
async function existingInstance(): Promise<boolean> {
  if (!LOCAL) return false;
  base = LOCAL.replace(/\/$/, "");
  pat = (await readFile(join(tmpdir(), "ipb-zitadel", "admin.pat"), "utf8")).trim();
  return true;
}

beforeAll(async () => {
  if (await existingInstance()) return applyAll();
  const port = await freePort();
  const dbPassword = toHex(randomBytes(16));
  const patDir = await mkdtemp(join(tmpdir(), "ipb-zitadel-"));
  await chmod(patDir, 0o777);
  net = await startNetwork();
  db = await startService("postgres", {
    ports: [5432],
    env: { POSTGRES_PASSWORD: dbPassword },
    configure: (c) => c.withNetworkMode(net.name).withNetworkAliases("zdb"),
  });
  const logs: string[] = [];
  z = await startService("zitadel", {
    ports: [],
    env: {
      ZITADEL_EXTERNALDOMAIN: "localhost",
      ZITADEL_EXTERNALPORT: String(port),
      ZITADEL_EXTERNALSECURE: "false",
      ZITADEL_TLS_ENABLED: "false",
      ZITADEL_DATABASE_POSTGRES_HOST: "zdb",
      ZITADEL_DATABASE_POSTGRES_PORT: "5432",
      ZITADEL_DATABASE_POSTGRES_DATABASE: "zitadel",
      ZITADEL_DATABASE_POSTGRES_USER_USERNAME: "zitadel",
      ZITADEL_DATABASE_POSTGRES_USER_PASSWORD: toHex(randomBytes(16)),
      ZITADEL_DATABASE_POSTGRES_USER_SSL_MODE: "disable",
      ZITADEL_DATABASE_POSTGRES_ADMIN_USERNAME: "postgres",
      ZITADEL_DATABASE_POSTGRES_ADMIN_PASSWORD: dbPassword,
      ZITADEL_DATABASE_POSTGRES_ADMIN_SSL_MODE: "disable",
      ZITADEL_FIRSTINSTANCE_ORG_MACHINE_MACHINE_USERNAME: "ipb-bootstrap",
      ZITADEL_FIRSTINSTANCE_ORG_MACHINE_MACHINE_NAME: "ipb-bootstrap",
      ZITADEL_FIRSTINSTANCE_ORG_MACHINE_PAT_EXPIRATIONDATE: "2099-01-01T00:00:00Z",
      ZITADEL_FIRSTINSTANCE_PATPATH: "/pat/admin.pat",
      ZITADEL_DEFAULTINSTANCE_FEATURES_LOGINV2_REQUIRED: "false",
    },
    command: ["start-from-init", "--masterkey", toHex(randomBytes(16)), "--tlsMode", "disabled"],
    // The image has no shell, so readiness is probed over HTTP from the host.
    readyHttp: { path: "/debug/ready", port: 8080 },
    configure: (c) =>
      c
        .withLogConsumer((s) => s.on("data", (d: Buffer | string) => logs.push(String(d))))
        .withNetworkMode(net.name)
        .withExposedPorts({ container: 8080, host: port })
        .withBindMounts([{ source: patDir, target: "/pat", mode: "rw" }])
        .withStartupTimeout(240_000),
  }).catch((e: unknown) => {
    // Show why Zitadel did not come up (its log carries no secrets: the PAT goes to a file).
    console.error(logs.slice(-40).join(""));
    throw e;
  });
  base = `http://localhost:${port}`;
  for (let i = 0; i < 120; i++) {
    const ready = await fetch(`${base}/debug/ready`).then(
      (r) => r.ok,
      () => false,
    );
    pat = await readFile(join(patDir, "admin.pat"), "utf8").then(
      (s) => s.trim(),
      () => "",
    );
    if (ready && pat) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (!pat) throw new Error("Zitadel did not write the bootstrap PAT");
  await applyAll();
});

async function applyAll(): Promise<void> {
  inst = await ZitadelIdentity.applyInstance({
    baseUrl: base,
    pat,
    profile: "tenant",
    redirectUris: ["http://localhost/callback"],
    roles: [...PLATFORM_ROLES, ...TENANT_ROLES],
    allowLoopbackHttp: true,
  });
  customer = await ZitadelCustomerIdentity.applyCustomerOrg({
    baseUrl: base,
    pat,
    orgName: `ipb-customers-${toHex(randomBytes(4))}`,
    redirectUri: "http://localhost/ipb-customer-callback",
    customerRoles: CUSTOMER_ROLES,
    instanceSettings: true,
    allowLoopbackHttp: true,
  });
}
afterAll(async () => {
  await z?.stop();
  await db?.stop();
  await net?.stop();
});

const adapter = () =>
  new ZitadelIdentity({
    baseUrl: base,
    orgId: inst.orgId,
    projectId: inst.projectId,
    clientId: inst.clientId,
    clientSecret: inst.clientSecret,
    serviceClient: inst.serviceClient,
    admin: { kind: "pat", token: pat },
    revocations,
    refreshLedger,
    resolveSecret: async (ref) => {
      if (ref.adapter !== "memory" || ref.key !== "client_secret") throw new Error("unknown");
      return BROKER_SECRET;
    },
    allowLoopbackHttp: true,
  });
const email = (n: string) => `${n}.${toHex(randomBytes(4))}@example.test`;

/**
 * A workforce login as a login client would make it (PR-LDC-03 cases): a password session, an
 * authorisation request with `offline_access` finalised with that session, and the code exchanged
 * by the adapter. The customer organisation's login client finalises it.
 */
async function signInWorkforce(): Promise<{ refreshToken: string }> {
  const p = adapter();
  const user = email("refresh");
  const password = generateSeedPassword();
  await p.provisionUser({
    email: user,
    displayName: "Refresh User",
    tenantId: "tnt_a",
    roles: ["ORG_MEMBER"],
    password: { value: password, temporary: false },
    mfaRequired: false,
  });
  const asLogin = async (method: string, path: string, body?: unknown, extra: RequestInit = {}) =>
    fetch(`${base}${path}`, {
      method,
      redirect: "manual",
      ...extra,
      headers: {
        authorization: `Bearer ${customer.loginClient.token}`,
        "content-type": "application/json",
        ...(extra.headers as Record<string, string> | undefined),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const s = await asLogin("POST", "/v2/sessions", {
    checks: { user: { loginName: user }, password: { password } },
  });
  if (s.status >= 300) throw new Error(`session: ${s.status} ${await s.text()}`);
  const session = (await s.json()) as { sessionId: string; sessionToken: string };
  const verifier = toBase64Url(randomBytes(32));
  const redirectUri = "http://localhost/callback";
  const q = new URLSearchParams({
    client_id: inst.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: `openid offline_access urn:zitadel:iam:user:metadata urn:zitadel:iam:org:projects:roles urn:zitadel:iam:org:project:id:${inst.projectId}:aud`,
    code_challenge: toBase64Url(sha256(new TextEncoder().encode(verifier))),
    code_challenge_method: "S256",
  });
  const az = await asLogin("GET", `/oauth/v2/authorize?${q}`, undefined, {
    headers: { "x-zitadel-login-client": customer.loginClient.userId },
  });
  const authRequest = new URL(az.headers.get("location") ?? "/", base).searchParams.get(
    "authRequest",
  );
  if (!authRequest) throw new Error(`authorize: ${az.status}`);
  const fin = await asLogin("POST", `/v2/oidc/auth_requests/${authRequest}`, {
    session: { sessionId: session.sessionId, sessionToken: session.sessionToken },
  });
  if (fin.status >= 300) throw new Error(`finalise: ${fin.status} ${await fin.text()}`);
  const code = new URL(
    ((await fin.json()) as { callbackUrl: string }).callbackUrl,
  ).searchParams.get("code");
  const t = await p.authenticate({
    kind: "oidc_code",
    value: code ?? "",
    redirectUri,
    codeVerifier: verifier,
  });
  if (!t.refreshToken) throw new Error("the instance issued no refresh token");
  return { refreshToken: t.refreshToken };
}
const svcToken = (p: IdentityPort) =>
  p.issueToken({ subject: inst.serviceClient.clientId, audience: inst.projectId }, 300);
const tamper = (jwt: string) => {
  const [h, p, s] = jwt.split(".") as [string, string, string];
  const sig = Buffer.from(s, "base64url");
  sig.writeUInt8(sig.readUInt8(0) ^ 0x01, 0);
  return `${h}.${p}.${sig.toString("base64url")}`;
};

describe("@IPB-01-15 IDENTITY hermetic leg: zitadel v4.19.5", () => {
  defineContractSuite<IdentityPort>(
    "IDENTITY",
    adapter,
    [
      {
        name: "instance settings read back equal to the IPB values (IPB-02-03)",
        async run(p) {
          expect(await (p as ZitadelIdentity).readSettings()).toEqual(ZITADEL_IPB_SETTINGS.tenant);
        },
      },
      {
        name: "issueToken: an ES256 token for the platform service principal; verification rules hold (C-11, C-12)",
        method: "issueToken",
        async run(p) {
          const t = await svcToken(p);
          const header = JSON.parse(
            Buffer.from(t.accessToken.split(".")[0]!, "base64url").toString("utf8"),
          ) as { alg: string };
          expect(header.alg).toBe("ES256");
          expect(await p.verifyToken(t.accessToken)).toMatchObject({
            typ: "service",
            tid: "platform",
          });
          await expect(p.verifyToken(tamper(t.accessToken))).rejects.toMatchObject({
            code: "IPB-IDN-001",
          });
          await expect(
            p.issueToken({ subject: inst.serviceClient.clientId, audience: "other" }, 300),
          ).rejects.toMatchObject({ code: "IPB-PORT-003" });
        },
      },
      {
        name: "issueToken with an actor and SAML exchange are declared unsupported (PL2-D-55)",
        async run(p) {
          await expect(
            p.issueToken({ subject: "u", audience: inst.projectId, actor: "ops" }, 300),
          ).rejects.toMatchObject({ code: "IPB-PORT-001", meta: { reason: "unsupported" } });
          await expect(p.authenticate({ kind: "saml", value: "x" })).rejects.toMatchObject({
            meta: { reason: "unsupported" },
          });
        },
      },
      {
        name: "provisionUser, getUser and setPassword keep tenant, roles and state",
        async run(p) {
          const user = email("admin");
          const { id } = await p.provisionUser({
            email: user,
            displayName: "Tenant Admin",
            tenantId: "tnt_a",
            roles: ["ORG_ADMIN"],
            password: { value: generateSeedPassword(), temporary: true },
            mfaRequired: true,
          });
          expect(await p.getUser(id)).toMatchObject({
            email: user,
            displayName: "Tenant Admin",
            enabled: true,
            tenantId: "tnt_a",
            roles: ["ORG_ADMIN"],
            mfaEnrolled: false,
          });
          await p.setPassword(user, generateSeedPassword(), false);
        },
      },
      {
        name: "@IPB-02-05 SCIM create, update and deactivate; the user's tokens are refused",
        async run(p) {
          const ext = `ext-${toHex(randomBytes(4))}`;
          const ok = [{ externalId: ext, ok: true }];
          expect(
            await p.scimSync([
              {
                op: "create",
                user: {
                  externalId: ext,
                  email: email("scim"),
                  displayName: "Scim User",
                  tenantId: "tnt_a",
                  roles: ["ORG_MEMBER"],
                  mfaRequired: false,
                },
              },
            ]),
          ).toEqual(ok);
          expect(
            await p.scimSync([
              {
                op: "update",
                externalId: ext,
                patch: { displayName: "Renamed", roles: ["ORG_MAKER"] },
              },
            ]),
          ).toEqual(ok);
          const id = scimUserId(inst.orgId, ext);
          expect(await p.getUser(id)).toMatchObject({
            displayName: "Renamed",
            roles: ["ORG_MAKER"],
          });
          expect(await p.scimSync([{ op: "deactivate", externalId: ext }])).toEqual(ok);
          expect((await p.getUser(id)).enabled).toBe(false);
          expect(
            await revocations.isRevoked({
              tid: "tnt_a",
              sub: id,
              iat: Math.floor(Date.now() / 1000) - 5,
            }),
          ).toBe(true);
          expect(await p.scimSync([{ op: "deactivate", externalId: "ext-missing" }])).toEqual([
            { externalId: "ext-missing", ok: false, error: "IPB-PORT-001" },
          ]);
        },
      },
      {
        name: "linkFederation records the external identity",
        async run(p) {
          const r = await fetch(`${base}/management/v1/idps/generic_oidc`, {
            method: "POST",
            headers: { authorization: `Bearer ${pat}`, "content-type": "application/json" },
            body: JSON.stringify({
              name: "partner",
              issuer: "https://partner.example.test",
              clientId: "x",
              clientSecret: "x",
              scopes: ["openid"],
              providerOptions: { isLinkingAllowed: true, isCreationAllowed: true },
            }),
          });
          expect(r.status, await r.clone().text()).toBe(200);
          const idp = ((await r.json()) as { id: string }).id;
          const { id } = await p.provisionUser({
            email: email("fed"),
            displayName: "Fed User",
            tenantId: "tnt_a",
            roles: ["ORG_MEMBER"],
            mfaRequired: false,
          });
          await p.linkFederation(id, { alias: idp, subject: "partner-123" });
          // Zitadel's search endpoints read an eventually consistent projection: the link is
          // written at once but may take a moment to appear in `_search`.
          let found = "";
          for (let i = 0; i < 40 && !found.includes("partner-123"); i++) {
            if (i) await new Promise((r) => setTimeout(r, 250));
            const links = await fetch(`${base}/v2/users/${id}/links/_search`, {
              method: "POST",
              headers: { authorization: `Bearer ${pat}`, "content-type": "application/json" },
              body: "{}",
            });
            found = JSON.stringify(await links.json());
          }
          expect(found).toContain("partner-123");
        },
      },
      {
        name: "revokeSessions refuses the user's earlier tokens; a later token works (PR-012)",
        async run(p) {
          const t1 = await svcToken(p);
          await p.verifyToken(t1.accessToken);
          await p.revokeSessions(inst.serviceUserId);
          await expect(p.verifyToken(t1.accessToken)).rejects.toMatchObject({
            code: "IPB-IDN-001",
          });
          await new Promise((r) => setTimeout(r, 1100));
          const t2 = await svcToken(p);
          expect((await p.verifyToken(t2.accessToken)).typ).toBe("service");
        },
      },
    ],
    { leg: "hermetic" },
  );

  // The refresh grant (PR-LDC-03, R1-D-77): Zitadel rotates, the adapter's ledger detects reuse.
  // A pause keeps each token's issue time before the next revocation's, in whole seconds.
  defineContractSuite<IdentitySessionRefresh>(
    "IDENTITY",
    adapter,
    identityRefreshContractCases({ signIn: signInWorkforce }, { pauseMs: 1100 }),
    { leg: "hermetic" },
  );

  // Tenant SSO brokers (PR-LDC-09, R1-D-78). Zitadel reads an OIDC issuer only at login, so the
  // issuer need not resolve here; SAML is left out, as Zitadel reads metadata when the IdP is
  // added and this network serves none (the SAML request shape is unit-tested). A first brokered
  // login is answered from the IdP's provider options and the login policy as Zitadel holds them.
  defineContractSuite<IdentityBrokerAdmin>(
    "IDENTITY",
    adapter,
    identityBrokerContractCases({
      tenants: ["tnt_a", "tnt_b"],
      oidc: {
        discoveryUrl: "https://sso.example.test/.well-known/openid-configuration",
        clientId: "tenant-sso",
        clientSecretRef: "secret://memory/idp/contract#client_secret",
        secretValue: BROKER_SECRET,
      },
      async brokerSignIn(_p, alias, user) {
        const asAdmin = async (method: string, path: string, body?: unknown) => {
          const r = await fetch(`${base}${path}`, {
            method,
            headers: {
              authorization: `Bearer ${pat}`,
              "content-type": "application/json",
              "x-zitadel-orgid": inst.orgId,
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          });
          if (r.status >= 300) throw new Error(`${method} ${path}: ${r.status} ${await r.text()}`);
          return (await r.json()) as Record<string, unknown>;
        };
        const m = (await asAdmin("GET", `/management/v1/metadata/ipb.idp.${alias}`)) as {
          metadata?: { value?: string };
        };
        const { idpId } = JSON.parse(
          Buffer.from(m.metadata?.value ?? "", "base64").toString("utf8"),
        ) as { idpId: string };
        const idp = (await asAdmin("GET", `/management/v1/idps/templates/${idpId}`)) as {
          idp?: { config?: { options?: Record<string, boolean | undefined> } };
        };
        const o = idp.idp?.config?.options ?? {};
        const onPolicy = JSON.stringify(
          await asAdmin("POST", "/management/v1/policies/login/idps/_search", {}),
        ).includes(idpId);
        if (!onPolicy) return "refused";
        if (user.existingIn === undefined)
          return o.isCreationAllowed || o.isAutoCreation ? "linked" : "refused";
        return o.isLinkingAllowed ? "linked" : "refused";
      },
    }),
    { leg: "hermetic" },
  );

  // Customer sign-in on the same instance, in the product's customer organisation (R1-D-19).
  defineContractSuite<CustomerIdentityPort>(
    "IDENTITY",
    () =>
      new ZitadelCustomerIdentity({
        baseUrl: base,
        orgId: customer.orgId,
        projectId: customer.projectId,
        clientId: customer.clientId,
        clientSecret: customer.clientSecret,
        redirectUri: "http://localhost/ipb-customer-callback",
        loginClient: customer.loginClient,
        store: customerStore,
        replay: customerReplay,
        revocations,
        sender: mail.sender,
        customerRoles: CUSTOMER_ROLES,
        allowLoopbackHttp: true,
      }),
    customerCases({ inbox: mail.inbox, nativeBinding: false, roles: CUSTOMER_ROLES, pauseMs: 0 }),
    { leg: "hermetic" },
  );

  it.skipIf(Boolean(LOCAL))(
    "JWKS stays cached across an IdP outage; new logins fail with IPB-IDN-002",
    async () => {
      const p = adapter();
      const t = await svcToken(p);
      await p.verifyToken(t.accessToken);
      await z.stop();
      expect((await p.verifyToken(t.accessToken)).typ).toBe("service");
      expect((await p.health()).status).toBe("down");
      await expect(
        p.authenticate({
          kind: "oidc_code",
          value: "x",
          redirectUri: "http://localhost/callback",
          codeVerifier: "v",
        }),
      ).rejects.toMatchObject({ code: "IPB-IDN-002" });
    },
  );
});
