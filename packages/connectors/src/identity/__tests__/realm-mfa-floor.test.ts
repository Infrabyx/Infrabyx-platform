// The realm half of the product MFA floor (Finbyx PR-FBX-49; R1-D-182): the Keycloak realm marks
// every floor role for MFA, provisioning and sync enrol a second factor for it (never SMS for an
// SMS-excluded role), `requireMfaEnrolment` catches users who hold a floor role without a factor,
// and Zitadel's `amr` keeps the RFC 8176 values the API guard needs (@IPB-02-AT-02, realm half).
import { describe, expect, it } from "vitest";
import { mfaFloor, PLATFORM_ROLES } from "@infrabyx/contracts";
import { assertMfaForRoles, MemoryRevocationStore, toVerifiedClaims } from "../common.js";
import {
  ipbRealm,
  KEYCLOAK_MFA_MARKER_ROLE,
  KeycloakIdentity,
  type KeycloakRealmSpec,
} from "../keycloak.js";
import { ZITADEL_IPB_SETTINGS, zitadelClaims } from "../zitadel.js";
import { recordedFetch, type RecordedReply, type RecordedRequest } from "./recorded-idp.js";

const FLOOR = mfaFloor({
  roles: ["PRD_MAKER", "PRD_AUDITOR"],
  smsExcludedRoles: ["ORG_CHECKER", "PRD_MAKER"],
});
const spec = (over: Partial<KeycloakRealmSpec> = {}): KeycloakRealmSpec => ({
  realm: "prd",
  profile: "tenant",
  apiClient: { clientId: "ipb-api", redirectUris: ["https://app.example.test/cb"] },
  adminClientId: "ipb-admin",
  audience: "ipb-api",
  passkeys: false,
  productRoles: ["PRD_MAKER", "PRD_AUDITOR", "PRD_VIEWER"],
  ...over,
});
type RoleRep = { name: string; composite?: boolean; composites?: { realm: string[] } };
const realmRoles = (rep: Record<string, unknown>) => (rep.roles as { realm: RoleRep[] }).realm;
const marked = (rep: Record<string, unknown>, name: string) =>
  realmRoles(rep)
    .find((r) => r.name === name)
    ?.composites?.realm.includes(KEYCLOAK_MFA_MARKER_ROLE) === true;

describe("ipbRealm with a product MFA floor (PR-FBX-49)", () => {
  it("marks the floor's product roles and the platform floor, and nothing else", () => {
    const rep = ipbRealm(spec({ mfaFloor: FLOOR }));
    expect(marked(rep, "PRD_MAKER")).toBe(true);
    expect(marked(rep, "PRD_AUDITOR")).toBe(true);
    expect(marked(rep, "PRD_VIEWER")).toBe(false);
    expect(marked(rep, "ORG_ADMIN")).toBe(true);
    expect(marked(rep, "ORG_MEMBER")).toBe(false);
    for (const r of PLATFORM_ROLES) expect(marked(rep, r)).toBe(true);
  });

  it("without a floor, only the platform floor is marked (as before)", () => {
    const rep = ipbRealm(spec());
    expect(marked(rep, "PRD_MAKER")).toBe(false);
    expect(marked(rep, "ORG_CHECKER")).toBe(true);
  });

  it("refuses a floor role the realm does not have, so a typo fails the deployment", () => {
    expect(() =>
      ipbRealm(spec({ productRoles: ["PRD_VIEWER"], mfaFloor: mfaFloor({ roles: ["PRD_MAKR"] }) })),
    ).toThrow(/PRD_MAKR is not a role of realm prd/);
  });
});

/** A recorded Keycloak Admin API with users, role mappings and credentials in memory. */
function keycloak(
  users: Array<{ id: string; roles: string[]; creds?: string[]; actions?: string[] }>,
) {
  const state = new Map(
    users.map((u) => [
      u.id,
      {
        rep: {
          id: u.id,
          username: `${u.id}@example.test`,
          enabled: true,
          attributes: { tenant_id: ["tnt_a"] } as Record<string, string[]>,
          requiredActions: u.actions ?? [],
        } as Record<string, unknown> & {
          attributes: Record<string, string[]>;
          requiredActions: string[];
        },
        roles: u.roles,
        creds: u.creds ?? [],
      },
    ]),
  );
  const created: Array<Record<string, unknown>> = [];
  const allRoles = [
    "ORG_ADMIN",
    "ORG_CHECKER",
    "ORG_MEMBER",
    "PRD_MAKER",
    "PRD_AUDITOR",
    "PRD_VIEWER",
    KEYCLOAK_MFA_MARKER_ROLE,
  ];
  const id = (r: RecordedRequest, re: RegExp) => decodeURIComponent(re.exec(r.path)![1]!);
  const rec = recordedFetch([
    [
      "POST",
      "/realms/prd/protocol/openid-connect/token",
      { status: 200, body: { access_token: "admin-token", expires_in: 300 } },
    ],
    [
      "POST",
      "/admin/realms/prd/users",
      (r): RecordedReply => {
        const body = r.json as Record<string, unknown>;
        created.push(body);
        const uid = `u${created.length}`;
        state.set(uid, { rep: { ...body, id: uid } as never, roles: [], creds: [] });
        return { status: 201, headers: { location: `https://id/admin/realms/prd/users/${uid}` } };
      },
    ],
    ["GET", "/admin/realms/prd/roles", { status: 200, body: allRoles.map((name) => ({ name })) }],
    [
      "GET",
      /^\/admin\/realms\/prd\/roles\/[^/]+$/,
      (r) => {
        const name = id(r, /\/roles\/([^/?]+)$/);
        return { status: 200, body: { id: `role-${name}`, name } };
      },
    ],
    [
      "GET",
      /^\/admin\/realms\/prd\/roles\/[^/]+\/users$/,
      (r) => {
        const name = id(r, /\/roles\/([^/]+)\/users/);
        const first = Number(new URL(`https://x${r.path}`).searchParams.get("first"));
        const all = [...state.values()].filter((u) => u.roles.includes(name)).map((u) => u.rep);
        return { status: 200, body: all.slice(first, first + 100) };
      },
    ],
    [
      "GET",
      /^\/admin\/realms\/prd\/users\/[^/]+\/role-mappings\/realm$/,
      (r) => {
        const u = state.get(id(r, /\/users\/([^/]+)\//))!;
        return { status: 200, body: u.roles.map((name) => ({ id: `role-${name}`, name })) };
      },
    ],
    [
      "POST",
      /^\/admin\/realms\/prd\/users\/[^/]+\/role-mappings\/realm$/,
      (r) => {
        const u = state.get(id(r, /\/users\/([^/]+)\//))!;
        u.roles.push(...(r.json as Array<{ name: string }>).map((x) => x.name));
        return { status: 204 };
      },
    ],
    [
      "GET",
      /^\/admin\/realms\/prd\/users\/[^/]+\/credentials$/,
      (r) => ({
        status: 200,
        body: state.get(id(r, /\/users\/([^/]+)\//))!.creds.map((type) => ({ type })),
      }),
    ],
    [
      "GET",
      /^\/admin\/realms\/prd\/users\/[^/]+$/,
      (r) => ({ status: 200, body: state.get(id(r, /\/users\/([^/]+)$/))!.rep }),
    ],
    [
      "GET",
      "/admin/realms/prd/users",
      (r) => {
        const ext = /external_id%3A([^&]+)/.exec(r.path)?.[1];
        const hit = [...state.values()]
          .map((u) => u.rep)
          .filter((u) => (u.attributes as Record<string, string[]>).external_id?.[0] === ext);
        return { status: 200, body: hit };
      },
    ],
    [
      "DELETE",
      /^\/admin\/realms\/prd\/users\/[^/]+\/role-mappings\/realm$/,
      (r) => {
        const u = state.get(id(r, /\/users\/([^/]+)\//))!;
        const gone = (r.json as Array<{ name: string }>).map((x) => x.name);
        u.roles = u.roles.filter((x) => !gone.includes(x));
        return { status: 204 };
      },
    ],
    ["GET", /^\/admin\/realms\/prd\/users\/[^/]+\/sessions$/, { status: 200, body: [] }],
    ["POST", /^\/admin\/realms\/prd\/users\/[^/]+\/logout$/, { status: 204 }],
    [
      "PUT",
      /^\/admin\/realms\/prd\/users\/[^/]+$/,
      (r) => {
        state.get(id(r, /\/users\/([^/]+)$/))!.rep = r.json as never;
        return { status: 204 };
      },
    ],
  ]);
  return { rec, state, created };
}
const adapter = (fetchImpl: typeof fetch, o: { floor?: boolean; action?: string } = {}) =>
  new KeycloakIdentity({
    baseUrl: "https://id.example.test",
    realm: "prd",
    clientId: "ipb-api",
    clientSecret: "client-secret",
    adminClientId: "ipb-admin",
    adminClientSecret: "admin-secret",
    audience: "ipb-api",
    revocations: new MemoryRevocationStore(),
    ...(o.floor === false ? {} : { mfaFloor: FLOOR }),
    ...(o.action ? { mfaEnrolmentAction: o.action } : {}),
    fetchImpl,
  });
const provision = (k: KeycloakIdentity, roles: string[]) =>
  k.provisionUser({
    email: "a@example.test",
    displayName: "A",
    tenantId: "tnt_a",
    roles,
    mfaRequired: false,
  });

describe("KeycloakIdentity provisioning under a product floor (PR-FBX-49)", () => {
  it("a product role on the floor gets the enrolment action; one off it does not", async () => {
    const kc = keycloak([]);
    await provision(adapter(kc.rec.fetch), ["PRD_MAKER"]);
    await provision(adapter(kc.rec.fetch), ["PRD_VIEWER"]);
    expect(kc.created[0]!.requiredActions).toEqual(["CONFIGURE_TOTP"]);
    expect(kc.created[1]!.requiredActions).toEqual([]);
  });

  it("without the floor the product role was never challenged (the bug PR-FBX-49 reports)", async () => {
    const kc = keycloak([]);
    await provision(adapter(kc.rec.fetch, { floor: false }), ["PRD_MAKER"]);
    expect(kc.created[0]!.requiredActions).toEqual([]);
  });

  it("an SMS-excluded role never enrols through a non-TOTP, non-WebAuthn action", async () => {
    const kc = keycloak([]);
    await provision(adapter(kc.rec.fetch, { action: "sms-otp-register" }), ["PRD_MAKER"]);
    await provision(adapter(kc.rec.fetch, { action: "sms-otp-register" }), ["PRD_AUDITOR"]);
    await provision(adapter(kc.rec.fetch, { action: "webauthn-register" }), ["ORG_CHECKER"]);
    expect(kc.created.map((c) => c.requiredActions)).toEqual([
      ["CONFIGURE_TOTP"],
      ["sms-otp-register"],
      ["webauthn-register"],
    ]);
  });

  it("a SCIM update that gives a floor role adds the enrolment action", async () => {
    const kc = keycloak([{ id: "u-ext", roles: ["PRD_VIEWER"] }]);
    kc.state.get("u-ext")!.rep.attributes = { tenant_id: ["tnt_a"], external_id: ["e1"] };
    const out = await adapter(kc.rec.fetch).scimSync([
      { op: "update", externalId: "e1", patch: { roles: ["PRD_VIEWER", "PRD_MAKER"] } },
    ]);
    expect(out).toEqual([{ externalId: "e1", ok: true }]);
    expect(kc.state.get("u-ext")!.rep.requiredActions).toContain("CONFIGURE_TOTP");
  });
});

describe("KeycloakIdentity.requireMfaEnrolment (PR-FBX-49)", () => {
  it("flags holders of a floor role without a factor, once, and leaves enrolled users alone", async () => {
    const kc = keycloak([
      { id: "maker", roles: ["PRD_MAKER"] },
      { id: "maker-enrolled", roles: ["PRD_MAKER"], creds: ["password", "otp"] },
      { id: "auditor-pending", roles: ["PRD_AUDITOR"], actions: ["CONFIGURE_TOTP"] },
      { id: "viewer", roles: ["PRD_VIEWER"] },
      { id: "admin", roles: ["ORG_ADMIN", "PRD_MAKER"], creds: ["webauthn-passwordless"] },
    ]);
    const k = adapter(kc.rec.fetch);
    expect(await k.requireMfaEnrolment()).toEqual({ checked: 4, flagged: 1 });
    expect(kc.state.get("maker")!.rep.requiredActions).toEqual(["CONFIGURE_TOTP"]);
    expect(kc.state.get("viewer")!.rep.requiredActions).toEqual([]);
    expect(kc.state.get("maker-enrolled")!.rep.requiredActions).toEqual([]);
    expect(await k.requireMfaEnrolment()).toEqual({ checked: 4, flagged: 0 });
  });

  it("keeps the user's other attributes and actions when it adds one", async () => {
    const kc = keycloak([{ id: "m", roles: ["PRD_MAKER"], actions: ["UPDATE_PASSWORD"] }]);
    await adapter(kc.rec.fetch).requireMfaEnrolment();
    expect(kc.state.get("m")!.rep).toMatchObject({
      attributes: { tenant_id: ["tnt_a"] },
      requiredActions: ["UPDATE_PASSWORD", "CONFIGURE_TOTP"],
    });
  });
});

describe("Zitadel and the floor (PR-FBX-49)", () => {
  const b = (v: string) => Buffer.from(v).toString("base64");
  const now = Math.floor(Date.now() / 1000);
  const token = (roles: string[], amr: string[]) =>
    toVerifiedClaims(
      zitadelClaims({
        sub: "u1",
        aud: "ipb-api",
        iss: "https://z.example.test",
        exp: now + 300,
        iat: now,
        amr,
        "urn:zitadel:iam:user:metadata": { tenant_id: b("tnt_a") },
        "urn:zitadel:iam:org:project:roles": Object.fromEntries(roles.map((r) => [r, {}])),
      }),
    );

  it("keeps Zitadel's RFC 8176 values, so an SMS-excluded role passes with TOTP or WebAuthn", () => {
    const totp = token(["PRD_MAKER"], ["pwd", "otp", "mfa"]);
    expect(totp.amr).toEqual(["pwd", "otp", "mfa"]);
    expect(() => assertMfaForRoles(totp, FLOOR)).not.toThrow();
    const key = token(["ORG_CHECKER"], ["pwd", "user", "mfa"]);
    expect(key.amr).toEqual(["pwd", "user", "mfa", "webauthn"]);
    expect(() => assertMfaForRoles(key, FLOOR)).not.toThrow();
  });

  it("a session with no second factor is still refused for a floor role", () => {
    const pwd = token(["PRD_MAKER"], ["pwd"]);
    expect(pwd.mfa).toBe(false);
    expect(() => assertMfaForRoles(pwd, FLOOR)).toThrow(
      expect.objectContaining({ code: "IPB-SEC-001" }),
    );
  });

  it("forces MFA for every user and allows only TOTP and U2F as second factors", () => {
    for (const p of [ZITADEL_IPB_SETTINGS.tenant, ZITADEL_IPB_SETTINGS.staff]) {
      expect(p.forceMfa).toBe(true);
      expect([...p.secondFactors].sort()).toEqual([
        "SECOND_FACTOR_TYPE_OTP",
        "SECOND_FACTOR_TYPE_U2F",
      ]);
    }
  });
});
