// Identity-provider brokers on the workforce adapters (LawDocsComply PR-LDC-09, R1-D-78), against
// recorded Keycloak 26 Admin API and Zitadel v4 management API answers kept in memory: the shared
// contract cases from @infrabyx/testing (unit leg), then the requests each adapter builds. The
// same cases run against the real IdPs in the hermetic legs (CI).
import { describe, expect, it } from "vitest";
import type { SecretRef } from "@infrabyx/contracts";
import { defineContractSuite, identityBrokerContractCases } from "@infrabyx/testing";
import { MemoryRevocationStore } from "../common.js";
import {
  KEYCLOAK_BROKER_CLAIM_MAPPER,
  KEYCLOAK_BROKER_KEYS,
  KEYCLOAK_BROKER_LINK_EXECUTIONS,
  KEYCLOAK_BROKER_LINK_FLOW,
  KeycloakIdentity,
} from "../keycloak.js";
import { oidcIssuerOf, ZITADEL_BROKER_PREFIX, ZitadelIdentity } from "../zitadel.js";
import {
  recordedFetch,
  signedAccessToken,
  TEST_JWK,
  type RecordedReply,
  type RecordedRequest,
} from "./recorded-idp.js";

const SECRET = "idp-client-secret-value";
const REF = "secret://memory/idp/tenant-a#client_secret";
const resolveSecret = async (ref: SecretRef, name: string) => {
  if (ref.adapter !== "memory" || ref.key !== "client_secret" || !name.startsWith("idp:"))
    throw new Error("unknown secret");
  return SECRET;
};
const DISCOVERY = "https://sso.example.test/.well-known/openid-configuration";
const METADATA = "https://sso.example.test/saml/metadata";
const fixtures = {
  tenants: ["tnt_a", "tnt_b"] as const,
  oidc: {
    discoveryUrl: DISCOVERY,
    clientId: "tenant-a-client",
    clientSecretRef: REF,
    secretValue: SECRET,
  },
  saml: { metadataUrl: METADATA },
};

// ---- Keycloak 26 Admin API, in memory ----------------------------------------------------------

type KcRep = Record<string, unknown> & { alias: string; config: Record<string, string> };

function keycloakAdmin() {
  const idps = new Map<string, KcRep>();
  let n = 0;
  const alias = (r: RecordedRequest) =>
    decodeURIComponent(/\/identity-provider\/instances\/([^/?]+)/.exec(r.path)![1]!);
  const rec = recordedFetch([
    ["GET", "/realms/ld/.well-known/openid-configuration", { status: 200, body: { issuer: "k" } }],
    [
      "GET",
      "/realms/ld/protocol/openid-connect/certs",
      { status: 200, body: { keys: [TEST_JWK] } },
    ],
    [
      "POST",
      "/realms/ld/protocol/openid-connect/token",
      { status: 200, body: { access_token: "admin-token", expires_in: 300 } },
    ],
    [
      "POST",
      "/admin/realms/ld/identity-provider/import-config",
      (r): RecordedReply => {
        const b = r.json as { providerId: string; fromUrl: string };
        return b.providerId === "oidc"
          ? {
              status: 200,
              body: {
                issuer: "https://sso.example.test",
                authorizationUrl: "https://sso.example.test/authorize",
                tokenUrl: "https://sso.example.test/token",
                jwksUrl: "https://sso.example.test/jwks",
                userInfoUrl: "https://sso.example.test/userinfo",
                validateSignature: "true",
                useJwksUrl: "true",
              },
            }
          : {
              status: 200,
              body: {
                singleSignOnServiceUrl: "https://sso.example.test/saml/sso",
                signingCertificate: "MIIB",
                postBindingResponse: "true",
                validateSignature: "true",
              },
            };
      },
    ],
    [
      "GET",
      "/admin/realms/ld/identity-provider/instances",
      () => ({ status: 200, body: [...idps.values()] }),
    ],
    [
      "POST",
      "/admin/realms/ld/identity-provider/instances",
      (r) => {
        const rep = r.json as KcRep;
        if (idps.has(rep.alias)) return { status: 409, body: { errorMessage: "exists" } };
        idps.set(rep.alias, { ...rep, internalId: `int-${++n}` });
        return { status: 201 };
      },
    ],
    [
      "GET",
      /^\/admin\/realms\/ld\/identity-provider\/instances\/[^/]+$/,
      (r) => {
        const i = idps.get(alias(r));
        return i ? { status: 200, body: i } : { status: 404 };
      },
    ],
    [
      "PUT",
      /^\/admin\/realms\/ld\/identity-provider\/instances\/[^/]+$/,
      (r) => {
        const cur = idps.get(alias(r));
        if (!cur) return { status: 404 };
        idps.set(alias(r), r.json as KcRep);
        return { status: 204 };
      },
    ],
    [
      "DELETE",
      /^\/admin\/realms\/ld\/identity-provider\/instances\/[^/]+$/,
      (r) => {
        if (!idps.delete(alias(r))) return { status: 404 };
        return { status: 204 };
      },
    ],
  ]);
  // The realm's flows as `applyRealm` leaves them with `identityBrokers` (first-login providers).
  const flows = new Map<string, readonly string[]>([
    [KEYCLOAK_BROKER_LINK_FLOW, KEYCLOAK_BROKER_LINK_EXECUTIONS],
    ["first broker login", ["idp-review-profile", "idp-create-user-if-unique", "idp-auto-link"]],
  ]);
  return { idps, flows, calls: rec.calls, fetch: rec.fetch };
}

/**
 * What Keycloak does with a first brokered login, from the broker's configuration: its
 * first-login flow creates an account or not, and links an existing one or not.
 */
function keycloakSignIn(kc: ReturnType<typeof keycloakAdmin>) {
  return {
    brokerSignIn: async (
      _p: unknown,
      alias: string,
      user: { email: string; existingIn?: string },
    ): Promise<"linked" | "refused"> => {
      const rep = kc.idps.get(alias);
      const flow = rep && kc.flows.get(String(rep.firstBrokerLoginFlowAlias));
      if (!rep || rep.enabled === false || !flow) return "refused";
      if (user.existingIn === undefined)
        return flow.includes("idp-create-user-if-unique") ? "linked" : "refused";
      return flow.includes("idp-detect-existing-broker-user") || flow.includes("idp-auto-link")
        ? "linked"
        : "refused";
    },
    // A session Keycloak would issue after that login: the API client's `idp` claim names the
    // broker; the adapter's verification decides.
    brokeredSession: async (
      p: unknown,
      alias: string,
      accountTenant: string,
    ): Promise<"accepted" | "refused"> => {
      const t = signedAccessToken({
        iss: "https://id.example.test/realms/ld",
        aud: ["ipb-api"],
        sub: `u-${accountTenant}`,
        tid: accountTenant,
        roles: ["ORG_MEMBER"],
        sid: `s-${alias}`,
        idp: alias,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 300,
      });
      return (p as KeycloakIdentity).verifyToken(t).then(
        () => "accepted" as const,
        (e: { code?: string; meta?: { reason?: string } }) => {
          if (e.code === "IPB-IDN-001" && e.meta?.reason === "idp_tenant")
            return "refused" as const;
          throw e;
        },
      );
    },
  };
}

const keycloak = (kc: ReturnType<typeof keycloakAdmin>, withResolver = true) =>
  new KeycloakIdentity({
    baseUrl: "https://id.example.test",
    realm: "ld",
    clientId: "ipb-api",
    clientSecret: "client-secret",
    adminClientId: "ipb-admin",
    adminClientSecret: "admin-secret",
    audience: "ipb-api",
    revocations: new MemoryRevocationStore(),
    ...(withResolver ? { resolveSecret } : {}),
    fetchImpl: kc.fetch,
  });

describe("KeycloakIdentity brokers (recorded Keycloak 26 Admin API)", () => {
  const kc = keycloakAdmin();
  defineContractSuite(
    "IDENTITY",
    () => keycloak(kc),
    identityBrokerContractCases({ ...fixtures, ...keycloakSignIn(kc) }),
  );

  it("the shared cases would catch Keycloak's default first-login flow, which creates accounts", async () => {
    const k = keycloakAdmin();
    const p = keycloak(k);
    await p.upsertIdentityProvider({
      tenantId: "tnt_a",
      alias: "acme-sso",
      protocol: "saml",
      displayName: "Acme",
      metadataUrl: METADATA,
    });
    const s = keycloakSignIn(k);
    expect(await s.brokerSignIn(p, "acme-sso", { email: "new@acme.example.test" })).toBe("refused");
    k.idps.get("acme-sso")!.firstBrokerLoginFlowAlias = "first broker login";
    expect(await s.brokerSignIn(p, "acme-sso", { email: "new@acme.example.test" })).toBe("linked");
  });

  it("builds the broker: imported endpoints, the resolved secret, PKCE, no trusted email, linking only", async () => {
    const k = keycloakAdmin();
    await keycloak(k).upsertIdentityProvider({
      tenantId: "tnt_a",
      alias: "acme-sso",
      protocol: "oidc",
      displayName: "Acme SSO",
      discoveryUrl: DISCOVERY,
      clientId: "acme",
      clientSecretRef: REF,
      domains: [{ domain: "Acme.Example.Test", verifiedAt: "2026-11-01T00:00:00Z" }],
    });
    expect(k.calls.find((c) => c.path.endsWith("/import-config"))?.json).toEqual({
      providerId: "oidc",
      fromUrl: DISCOVERY,
    });
    const rep = k.idps.get("acme-sso")!;
    expect(rep).toMatchObject({
      alias: "acme-sso",
      displayName: "Acme SSO",
      providerId: "oidc",
      enabled: true,
      trustEmail: false,
      storeToken: false,
      linkOnly: false,
      firstBrokerLoginFlowAlias: KEYCLOAK_BROKER_LINK_FLOW,
    });
    expect(rep.config).toMatchObject({
      tokenUrl: "https://sso.example.test/token",
      clientId: "acme",
      clientSecret: SECRET,
      clientAuthMethod: "client_secret_post",
      defaultScope: "openid email profile",
      pkceEnabled: "true",
      pkceMethod: "S256",
      validateSignature: "true",
      syncMode: "IMPORT",
      [KEYCLOAK_BROKER_KEYS.tenant]: "tnt_a",
      [KEYCLOAK_BROKER_KEYS.source]: DISCOVERY,
    });
    expect(JSON.parse(rep.config[KEYCLOAK_BROKER_KEYS.domains]!)).toEqual([
      { domain: "acme.example.test", verifiedAt: "2026-11-01T00:00:00Z" },
    ]);
    // No mapper creates or shapes accounts: the broker only links.
    expect(k.calls.some((c) => c.path.includes("/mappers"))).toBe(false);
    // The secret travels to Keycloak only; the request log of everything else never holds it.
    const elsewhere = k.calls.filter((c) => !/\/identity-provider\/instances$/.test(c.path));
    expect(JSON.stringify(elsewhere)).not.toContain(SECRET);
  });

  it("an update keeps Keycloak's internal id; SAML forces signed assertions", async () => {
    const k = keycloakAdmin();
    const p = keycloak(k);
    const saml = {
      tenantId: "tnt_a",
      alias: "acme-saml",
      protocol: "saml" as const,
      displayName: "Acme SAML",
      metadataUrl: METADATA,
    };
    await p.upsertIdentityProvider(saml);
    const id = k.idps.get("acme-saml")!.internalId;
    await p.upsertIdentityProvider({ ...saml, displayName: "Acme SAML 2" });
    expect(k.idps.get("acme-saml")).toMatchObject({
      internalId: id,
      providerId: "saml",
      displayName: "Acme SAML 2",
      firstBrokerLoginFlowAlias: KEYCLOAK_BROKER_LINK_FLOW,
      config: { validateSignature: "true", wantAssertionsSigned: "true", syncMode: "IMPORT" },
    });
  });

  it("a token without the idp claim skips the broker read; an unmanaged broker is not guarded", async () => {
    const k = keycloakAdmin();
    k.idps.set("partner", { alias: "partner", providerId: "oidc", config: { clientId: "x" } });
    const p = keycloak(k);
    const now = Math.floor(Date.now() / 1000);
    const claims = {
      iss: "https://id.example.test/realms/ld",
      aud: ["ipb-api"],
      sub: "u-1",
      tid: "tnt_b",
      iat: now,
      exp: now + 300,
    };
    await p.verifyToken(signedAccessToken(claims));
    expect(k.calls.some((c) => c.path.includes("/identity-provider/"))).toBe(false);
    expect((await p.verifyToken(signedAccessToken({ ...claims, idp: "partner" }))).tid).toBe(
      "tnt_b",
    );
  });

  it("a hand-configured broker's alias is not taken over; without a resolver an OIDC broker is refused", async () => {
    const k = keycloakAdmin();
    k.idps.set("partner", { alias: "partner", providerId: "oidc", config: { clientId: "x" } });
    const p = keycloak(k);
    await expect(
      p.upsertIdentityProvider({
        tenantId: "tnt_a",
        alias: "partner",
        protocol: "saml",
        displayName: "x",
        metadataUrl: METADATA,
      }),
    ).rejects.toMatchObject({ code: "IPB-PORT-004", meta: { reason: "alias_taken" } });
    expect(await p.removeIdentityProvider("tnt_a", "partner")).toEqual({ removed: false });
    expect(await p.listIdentityProviders("tnt_a")).toEqual([]);
    await expect(
      keycloak(k, false).upsertIdentityProvider({
        tenantId: "tnt_a",
        alias: "acme-sso",
        protocol: "oidc",
        displayName: "Acme",
        discoveryUrl: DISCOVERY,
        clientId: "acme",
        clientSecretRef: REF,
      }),
    ).rejects.toMatchObject({ code: "IPB-PORT-001" });
    expect(k.idps.has("acme-sso")).toBe(false);
  });

  it("refuses an http discovery URL (IPB-SEC-018) unless loopback in tests", async () => {
    const k = keycloakAdmin();
    const spec = {
      tenantId: "tnt_a",
      alias: "loop-sso",
      protocol: "saml" as const,
      displayName: "Loop",
      metadataUrl: "http://localhost:8080/realms/master/protocol/saml/descriptor",
    };
    await expect(keycloak(k).upsertIdentityProvider(spec)).rejects.toMatchObject({
      code: "IPB-SEC-018",
    });
    expect(k.calls).toHaveLength(0);
  });
});

// ---- applyRealm with identityBrokers (recorded Keycloak 26 Admin API) -------------------------

function realmAdmin(initialFlow?: string[], adminApiScope = true) {
  type Exec = { id: string; providerId: string; requirement: string; level: number };
  let flowExists = initialFlow !== undefined;
  let execs: Exec[] = (initialFlow ?? []).map((p, i) => ({
    id: `e-${i}`,
    providerId: p,
    requirement: "DISABLED",
    level: 0,
  }));
  let n = 100;
  const granted: string[] = [];
  const defaultScopes: string[] = [];
  const mappers: Array<{ name: string }> = [];
  const R = "/admin/realms/ld";
  const FLOW = `${R}/authentication/flows/${KEYCLOAK_BROKER_LINK_FLOW}/executions`;
  const rec = recordedFetch([
    [
      "POST",
      "/realms/master/protocol/openid-connect/token",
      { status: 200, body: { access_token: "m" } },
    ],
    ["GET", R, { status: 200, body: { realm: "ld" } }],
    ["PUT", R, { status: 204 }],
    ["GET", `${R}/users/profile`, { status: 200, body: { attributes: [] } }],
    ["PUT", `${R}/users/profile`, { status: 204 }],
    [
      "GET",
      /\/authentication\/flows\/(browser|direct%20grant)\/executions$/,
      { status: 200, body: [] },
    ],
    [
      "GET",
      `${R}/clients`,
      {
        status: 200,
        body: [
          { id: "c-api", clientId: "ipb-api" },
          { id: "c-adm", clientId: "ipb-admin" },
          { id: "c-rm", clientId: "realm-management" },
        ],
      },
    ],
    ["GET", `${R}/clients/c-adm/service-account-user`, { status: 200, body: { id: "sa" } }],
    [
      "GET",
      `${R}/client-scopes`,
      {
        status: 200,
        body: [
          { id: "cs-roles", name: "roles" },
          ...(adminApiScope ? [{ id: "cs-admin", name: "kc-admin-api" }] : []),
        ],
      },
    ],
    [
      "PUT",
      /\/clients\/[^/]+\/default-client-scopes\/[^/]+$/,
      (r) => {
        defaultScopes.push(r.path.split("/").slice(-3).join("/"));
        return { status: 204 };
      },
    ],
    ["GET", `${R}/clients/c-api/service-account-user`, { status: 200, body: { id: "api-sa" } }],
    ["PUT", `${R}/users/api-sa`, { status: 204 }],
    [
      "GET",
      `${R}/clients/c-rm/roles`,
      {
        status: 200,
        body: [
          "manage-users",
          "view-users",
          "query-users",
          "view-realm",
          "manage-realm",
          "manage-identity-providers",
          "view-identity-providers",
        ].map((name) => ({ id: name, name })),
      },
    ],
    [
      "POST",
      `${R}/users/sa/role-mappings/clients/c-rm`,
      (r) => {
        granted.push(...(r.json as Array<{ name: string }>).map((x) => x.name));
        return { status: 204 };
      },
    ],
    [
      "GET",
      `${R}/authentication/flows`,
      () => ({ status: 200, body: flowExists ? [{ alias: KEYCLOAK_BROKER_LINK_FLOW }] : [] }),
    ],
    [
      "POST",
      `${R}/authentication/flows`,
      () => {
        flowExists = true;
        return { status: 201 };
      },
    ],
    ["GET", FLOW, () => ({ status: 200, body: execs })],
    [
      "POST",
      `${FLOW}/execution`,
      (r) => {
        const provider = (r.json as { provider: string }).provider;
        execs.push({ id: `e-${++n}`, providerId: provider, requirement: "DISABLED", level: 0 });
        return { status: 201 };
      },
    ],
    [
      "PUT",
      FLOW,
      (r) => {
        const e = r.json as Exec;
        execs = execs.map((x) => (x.id === e.id ? { ...x, requirement: e.requirement } : x));
        return { status: 202 };
      },
    ],
    [
      "DELETE",
      /\/authentication\/executions\/[^/]+$/,
      (r) => {
        const id = r.path.split("/").pop()!;
        execs = execs.filter((x) => x.id !== id);
        return { status: 204 };
      },
    ],
    ["GET", `${R}/clients/c-api/protocol-mappers/models`, () => ({ status: 200, body: mappers })],
    [
      "POST",
      `${R}/clients/c-api/protocol-mappers/models`,
      (r) => {
        mappers.push(r.json as { name: string });
        return { status: 201 };
      },
    ],
    ["GET", /\/clients\/[^/]+\/client-secret$/, { status: 200, body: { value: "generated" } }],
  ]);
  return { rec, granted, mappers, defaultScopes, execs: () => execs };
}

describe("KeycloakIdentity.applyRealm with identityBrokers (recorded Keycloak 26 Admin API)", () => {
  const spec = (identityBrokers: boolean) => ({
    realm: "ld",
    profile: "tenant" as const,
    apiClient: { clientId: "ipb-api", redirectUris: [] },
    adminClientId: "ipb-admin",
    audience: "ipb-api",
    passkeys: false,
    identityBrokers,
  });
  const apply = (a: ReturnType<typeof realmAdmin>, on: boolean) =>
    KeycloakIdentity.applyRealm({
      baseUrl: "https://id.example.test",
      masterAdmin: { username: "u", password: "p" },
      spec: spec(on),
      fetchImpl: a.rec.fetch,
    });

  it("Keycloak 26.8.2: the admin service account gets the kc-admin-api scope (R1-D-152)", async () => {
    const a = realmAdmin();
    await apply(a, true);
    expect(a.defaultScopes).toEqual(["c-adm/default-client-scopes/cs-admin"]);
    // A realm on an earlier version has no such scope: nothing is changed.
    const old = realmAdmin(undefined, false);
    await apply(old, true);
    expect(old.defaultScopes).toEqual([]);
  });

  it("creates the linking-only first-login flow, the idp claim and the broker grant", async () => {
    const a = realmAdmin();
    await apply(a, true);
    expect(a.execs().map((e) => [e.providerId, e.requirement])).toEqual(
      KEYCLOAK_BROKER_LINK_EXECUTIONS.map((p) => [p, "REQUIRED"]),
    );
    expect(a.mappers).toEqual([KEYCLOAK_BROKER_CLAIM_MAPPER]);
    expect(a.granted).toEqual(
      expect.arrayContaining(["manage-identity-providers", "view-identity-providers"]),
    );
    expect(a.granted).not.toContain("manage-realm");
  });

  it("an edited flow is put back: account creation and profile review are removed", async () => {
    const a = realmAdmin(["idp-review-profile", "idp-create-user-if-unique", "idp-auto-link"]);
    await apply(a, true);
    expect(a.execs().map((e) => e.providerId)).toEqual([...KEYCLOAK_BROKER_LINK_EXECUTIONS]);
    // Applying again changes nothing.
    const before = a.rec.calls.length;
    await apply(a, true);
    expect(
      a.rec.calls
        .slice(before)
        .filter((c) => c.method !== "GET" && c.path.includes("/authentication/")),
    ).toEqual([]);
  });

  it("without identityBrokers: no flow, no claim, no broker grant", async () => {
    const a = realmAdmin();
    await apply(a, false);
    expect(a.rec.calls.some((c) => c.path.includes(KEYCLOAK_BROKER_LINK_FLOW))).toBe(false);
    expect(a.mappers).toEqual([]);
    expect(a.granted).not.toContain("manage-identity-providers");
  });
});

// ---- Zitadel v4 management API, in memory -------------------------------------------------------

function zitadelAdmin() {
  const meta = new Map<string, string>();
  const idps = new Map<string, Record<string, unknown> & { type: string }>();
  const policy = new Set<string>();
  /** User id → linked IdP ids. */
  const links = new Map<string, string[]>();
  let n = 0;
  const tail = (r: RecordedRequest) => decodeURIComponent(r.path.split("?")[0]!.split("/").pop()!);
  const rec = recordedFetch([
    ["GET", "/.well-known/openid-configuration", { status: 200, body: { issuer: "z" } }],
    ["GET", "/oauth/v2/keys", { status: 200, body: { keys: [TEST_JWK] } }],
    [
      "POST",
      /^\/v2\/users\/[^/]+\/links\/_search$/,
      (r) => ({
        status: 200,
        body: {
          result: (links.get(decodeURIComponent(r.path.split("/")[3]!)) ?? []).map((idpId) => ({
            idpId,
          })),
        },
      }),
    ],
    [
      "POST",
      "/management/v1/metadata/_search",
      (r) => {
        const prefix = (r.json as { queries: Array<{ keyQuery: { key: string } }> }).queries[0]!
          .keyQuery.key;
        return {
          status: 200,
          body: {
            result: [...meta]
              .filter(([k]) => k.startsWith(prefix))
              .map(([key, value]) => ({ key, value })),
          },
        };
      },
    ],
    [
      "POST",
      /^\/management\/v1\/metadata\/[^/]+$/,
      (r) => {
        meta.set(tail(r), (r.json as { value: string }).value);
        return { status: 200, body: {} };
      },
    ],
    [
      "DELETE",
      /^\/management\/v1\/metadata\/[^/]+$/,
      (r) => (meta.delete(tail(r)) ? { status: 200, body: {} } : { status: 404, body: {} }),
    ],
    [
      "POST",
      /^\/management\/v1\/idps\/(generic_oidc|saml)$/,
      (r) => {
        const id = `idp-${++n}`;
        idps.set(id, { ...(r.json as Record<string, unknown>), type: tail(r) });
        return { status: 200, body: { id } };
      },
    ],
    [
      "PUT",
      /^\/management\/v1\/idps\/(generic_oidc|saml)\/[^/]+$/,
      (r) => {
        const id = tail(r);
        const type = r.path.split("/")[4]!;
        if (idps.get(id)?.type !== type) return { status: 404, body: {} };
        idps.set(id, { ...(r.json as Record<string, unknown>), type });
        return { status: 200, body: {} };
      },
    ],
    [
      "DELETE",
      /^\/management\/v1\/idps\/[^/]+$/,
      (r) => (idps.delete(tail(r)) ? { status: 200, body: {} } : { status: 404, body: {} }),
    ],
    [
      "POST",
      "/management/v1/policies/login/idps",
      (r) => {
        const id = (r.json as { idpId: string }).idpId;
        if (policy.has(id)) return { status: 409, body: {} };
        policy.add(id);
        return { status: 200, body: {} };
      },
    ],
    [
      "DELETE",
      /^\/management\/v1\/policies\/login\/idps\/[^/]+$/,
      (r) => (policy.delete(tail(r)) ? { status: 200, body: {} } : { status: 404, body: {} }),
    ],
  ]);
  return { meta, idps, policy, links, calls: rec.calls, fetch: rec.fetch };
}

/** What Zitadel does with a first brokered login, from the IdP's provider options. */
function zitadelSignIn(z: ReturnType<typeof zitadelAdmin>) {
  const idpOf = (alias: string) => {
    const v = z.meta.get(`${ZITADEL_BROKER_PREFIX}${alias}`);
    return v ? (JSON.parse(Buffer.from(v, "base64").toString()) as { idpId: string }).idpId : "";
  };
  return {
    brokerSignIn: async (
      _p: unknown,
      alias: string,
      user: { email: string; existingIn?: string },
    ): Promise<"linked" | "refused"> => {
      const id = idpOf(alias);
      const o = z.idps.get(id)?.providerOptions as Record<string, boolean> | undefined;
      if (!o || !z.policy.has(id)) return "refused";
      if (user.existingIn === undefined)
        return o.isCreationAllowed || o.isAutoCreation ? "linked" : "refused";
      return o.isLinkingAllowed ? "linked" : "refused";
    },
    // An account of `accountTenant` linked to the broker, then one of its tokens verified.
    brokeredSession: async (
      p: unknown,
      alias: string,
      accountTenant: string,
    ): Promise<"accepted" | "refused"> => {
      const sub = `zu-${accountTenant}-${alias}`;
      z.links.set(sub, [idpOf(alias)]);
      const now = Math.floor(Date.now() / 1000);
      const t = signedAccessToken({
        iss: "https://zitadel.example.test",
        aud: ["project-1"],
        sub,
        "urn:zitadel:iam:user:metadata": {
          tenant_id: Buffer.from(accountTenant).toString("base64"),
        },
        iat: now,
        exp: now + 300,
      });
      return (p as ZitadelIdentity).verifyToken(t).then(
        () => "accepted" as const,
        (e: { code?: string; meta?: { reason?: string } }) => {
          if (e.code === "IPB-IDN-001" && e.meta?.reason === "idp_tenant")
            return "refused" as const;
          throw e;
        },
      );
    },
  };
}

const zitadel = (z: ReturnType<typeof zitadelAdmin>) =>
  new ZitadelIdentity({
    baseUrl: "https://zitadel.example.test",
    orgId: "org-1",
    projectId: "project-1",
    clientId: "api-client",
    clientSecret: "api-secret",
    serviceClient: { clientId: "svc", clientSecret: "svc-secret" },
    admin: { kind: "pat", token: "admin-pat" },
    revocations: new MemoryRevocationStore(),
    resolveSecret,
    fetchImpl: z.fetch,
  });

describe("ZitadelIdentity brokers (recorded Zitadel v4 management API)", () => {
  const z = zitadelAdmin();
  defineContractSuite(
    "IDENTITY",
    () => zitadel(z),
    identityBrokerContractCases({ ...fixtures, ...zitadelSignIn(z) }),
  );

  it("a user token with no foreign broker reads no links; a foreign link is refused (idp_tenant)", async () => {
    const zz = zitadelAdmin();
    const p = zitadel(zz);
    const now = Math.floor(Date.now() / 1000);
    const token = (tid: string) =>
      signedAccessToken({
        iss: "https://zitadel.example.test",
        aud: ["project-1"],
        sub: "zu-9",
        "urn:zitadel:iam:user:metadata": { tenant_id: Buffer.from(tid).toString("base64") },
        iat: now,
        exp: now + 300,
      });
    await p.verifyToken(token("tnt_a"));
    expect(zz.calls.some((c) => c.path.includes("/links/"))).toBe(false);
    await p.upsertIdentityProvider({
      tenantId: "tnt_b",
      alias: "beta-saml",
      protocol: "saml",
      displayName: "Beta",
      metadataUrl: METADATA,
    });
    zz.links.set("zu-9", [[...zz.idps.keys()][0]!]);
    await expect(p.verifyToken(token("tnt_a"))).rejects.toMatchObject({
      code: "IPB-IDN-001",
      meta: { reason: "idp_tenant" },
    });
  });

  it("creates a linking-only generic OIDC IdP on the login policy, routed by organisation metadata", async () => {
    const zz = zitadelAdmin();
    const p = zitadel(zz);
    await p.upsertIdentityProvider({
      tenantId: "tnt_a",
      alias: "acme-sso",
      protocol: "oidc",
      displayName: "Acme SSO",
      discoveryUrl: DISCOVERY,
      clientId: "acme",
      clientSecretRef: REF,
      domains: [{ domain: "acme.example.test", verifiedAt: "2026-11-01T00:00:00+05:30" }],
    });
    expect(zz.idps.size).toBe(1);
    const [id, idp] = [...zz.idps][0]!;
    expect(idp).toMatchObject({
      type: "generic_oidc",
      name: "Acme SSO",
      issuer: "https://sso.example.test",
      clientId: "acme",
      clientSecret: SECRET,
      scopes: ["openid", "email", "profile"],
      providerOptions: { isLinkingAllowed: true, isCreationAllowed: false, isAutoCreation: false },
    });
    expect(zz.policy.has(id!)).toBe(true);
    const stored = Buffer.from(
      zz.meta.get(`${ZITADEL_BROKER_PREFIX}acme-sso`)!,
      "base64",
    ).toString();
    expect(JSON.parse(stored)).toMatchObject({ tenantId: "tnt_a", idpId: id, enabled: true });
    expect(stored).not.toContain(SECRET);
    // Every header carries the organisation.
    expect(zz.calls.every((c) => c.headers["x-zitadel-orgid"] === "org-1")).toBe(true);

    // Disabled: off the login policy, same IdP; another protocol: a new IdP replaces it.
    await p.upsertIdentityProvider({
      tenantId: "tnt_a",
      alias: "acme-sso",
      protocol: "oidc",
      displayName: "Acme SSO",
      discoveryUrl: DISCOVERY,
      clientId: "acme",
      clientSecretRef: REF,
      enabled: false,
    });
    expect(zz.policy.has(id!)).toBe(false);
    expect(zz.idps.has(id!)).toBe(true);
    await p.upsertIdentityProvider({
      tenantId: "tnt_a",
      alias: "acme-sso",
      protocol: "saml",
      displayName: "Acme SAML",
      metadataUrl: METADATA,
    });
    expect(zz.idps.has(id!)).toBe(false);
    expect([...zz.idps.values()]).toEqual([
      expect.objectContaining({
        type: "saml",
        metadataUrl: METADATA,
        binding: "SAML_BINDING_POST",
        withSignedRequest: true,
      }),
    ]);
    expect(await p.removeIdentityProvider("tnt_a", "acme-sso")).toEqual({ removed: true });
    expect(zz.idps.size + zz.meta.size + zz.policy.size).toBe(0);
  });

  it("derives the issuer from the discovery URL", () => {
    expect(oidcIssuerOf("https://login.example.test/tenant/.well-known/openid-configuration")).toBe(
      "https://login.example.test/tenant",
    );
  });
});
