// IDENTITY alternative `zitadel` (PL2 plan §6.5): self-hosted Zitadel v4 on PostgreSQL, over its
// OIDC endpoints and v1/v2 APIs through the egress client. One organisation per product; a
// user's tenant, principal type, product scope and SCIM external id live in admin-set user
// metadata and reach the token through the `urn:zitadel:iam:user:metadata` scope; roles are
// project roles (`urn:zitadel:iam:org:project:roles`). Signing uses an ES256 web key (C-12).
// Zitadel cannot require MFA per role, so every organisation forces MFA at login (stricter than
// IPB-02-02, PL2-D-56) and the API guard still refuses privileged roles without it (IPB-SEC-001). RFC 8693 tokens with `act`
// are unsupported here as on Keycloak (PL2-D-55).
import { PortError } from "@infrabyx/contracts/errors";
import {
  RoleSchema,
  PLATFORM_KMS_TENANT,
  type AdapterDescriptor,
  type IdentityPort,
  type IdentityUser,
  type PortHealth,
  type ProvisionUserSpec,
  type ScimOp,
  type VerifiedClaims,
} from "@infrabyx/contracts";
import { sha256Hex } from "@infrabyx/crypto";
import { createEgress, type EgressResponse } from "../core/http.js";
import { TokenVerifier, type RevocationStore } from "./common.js";

type Egress = ReturnType<typeof createEgress>;

/** Settings the adapter applies and reads back (contract test: equal to the IPB values). */
export const ZITADEL_IPB_SETTINGS = {
  tenant: {
    accessTokenLifetime: "300s",
    idTokenLifetime: "300s",
    refreshTokenIdleExpiration: "1800s",
    refreshTokenExpiration: "43200s",
    maxPasswordAttempts: "5",
    passwordMinLength: "12",
    allowRegister: false,
    forceMfa: true,
    passwordlessType: "PASSWORDLESS_TYPE_ALLOWED",
  },
  staff: {
    accessTokenLifetime: "300s",
    idTokenLifetime: "300s",
    refreshTokenIdleExpiration: "900s",
    refreshTokenExpiration: "28800s",
    maxPasswordAttempts: "5",
    passwordMinLength: "12",
    allowRegister: false,
    forceMfa: true,
    passwordlessType: "PASSWORDLESS_TYPE_ALLOWED",
  },
} as const;

const META = "urn:zitadel:iam:user:metadata";
const ROLES = "urn:zitadel:iam:org:project:roles";
/** Methods Zitadel reports in `amr` that count as MFA (RFC 8176 and Zitadel's own). */
const MFA_METHODS = ["mfa", "otp", "hwk", "swk", "user", "u2f", "passkey"];

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");
const unb64 = (s: unknown) =>
  typeof s === "string" ? Buffer.from(s, "base64").toString("utf8") : undefined;

/** Zitadel URN claims → the claim names `toVerifiedClaims` reads. */
export function zitadelClaims(raw: Record<string, unknown>): Record<string, unknown> {
  const meta = (raw[META] ?? {}) as Record<string, unknown>;
  const roleClaims = Object.entries(raw)
    .filter(([k]) => k === ROLES || /^urn:zitadel:iam:org:project:[^:]+:roles$/.test(k))
    .flatMap(([, v]) => (v && typeof v === "object" ? Object.keys(v) : []));
  const scope = unb64(meta.product_scope);
  const amr = Array.isArray(raw.amr) ? (raw.amr as unknown[]) : [];
  return {
    ...raw,
    tid: unb64(meta.tenant_id),
    ptyp: unb64(meta.principal_type) ?? "user",
    ...(scope ? { product_scope: scope.split(",").filter(Boolean) } : {}),
    roles: [...new Set(roleClaims)],
    amr: amr.map((a) => (typeof a === "string" && MFA_METHODS.includes(a) ? "mfa" : a)),
  };
}

/** Deterministic user id for a SCIM external id, so updates need no search (PL2-D-56). */
export const scimUserId = (orgId: string, externalId: string): string =>
  `ext${sha256Hex(`${orgId}:${externalId}`).slice(0, 40)}`;

export interface ZitadelIdentityOptions {
  /** Issuer and API base, e.g. https://id.example.in (AUTH_ISSUER_URL). */
  baseUrl: string;
  /** Organisation of this product's users; project holding the platform roles. */
  orgId: string;
  projectId: string;
  /** API web application (AUTH_CLIENT_ID / AUTH_CLIENT_SECRET). */
  clientId: string;
  clientSecret: string;
  /** Platform service principal (machine user) for issueToken. */
  serviceClient: { clientId: string; clientSecret: string };
  /** Admin API credentials: a machine user's client credentials, or a PAT (dev and CI only). */
  admin:
    | { kind: "client_credentials"; clientId: string; clientSecret: string }
    | { kind: "pat"; token: string };
  revocations: RevocationStore;
  jwksCacheSeconds?: number;
  allowLoopbackHttp?: boolean;
  now?: () => number;
}

interface ZUser {
  userId: string;
  state?: string;
  username?: string;
  human?: { profile?: { displayName?: string }; email?: { email?: string } };
  machine?: unknown;
}

export class ZitadelIdentity implements IdentityPort {
  readonly descriptor: AdapterDescriptor = {
    port: "IDENTITY",
    adapter: "zitadel",
    residency: "IN",
    maxDataClass: "CONFIDENTIAL",
    capabilities: {
      "authenticate.saml": "unsupported",
      "issueToken.actor": "unsupported",
      "provisionUser.mfaRequired": "emulated",
    },
  };
  readonly issuer: string;
  private readonly egress: Egress;
  private readonly verifier: TokenVerifier;
  private adminToken: { value: string; until: number } | null = null;

  constructor(private readonly o: ZitadelIdentityOptions) {
    this.issuer = o.baseUrl.replace(/\/$/, "");
    this.egress = zitadelEgress(this.issuer, o.allowLoopbackHttp);
    this.verifier = new TokenVerifier({
      issuer: this.issuer,
      audience: o.projectId,
      jwksUrl: `${this.issuer}/oauth/v2/keys`,
      egress: this.egress,
      algorithms: ["ES256"],
      mapClaims: zitadelClaims,
      ...(o.jwksCacheSeconds !== undefined ? { jwksCacheSeconds: o.jwksCacheSeconds } : {}),
      revocations: o.revocations,
      ...(o.now ? { now: o.now } : {}),
    });
  }

  private get now(): number {
    return this.o.now?.() ?? Date.now();
  }

  private fail(status: number, what: string, definite = false): never {
    if (status === 404)
      throw new PortError("IPB-PORT-001", "IDENTITY", {
        adapter: "zitadel",
        detail: `not found: ${what}`,
        meta: { status, reason: "not_found", definite: true },
      });
    if (status === 409)
      throw new PortError("IPB-PORT-004", "IDENTITY", {
        adapter: "zitadel",
        detail: "the user or link already exists",
        meta: { status, definite: true },
      });
    throw new PortError(
      status === 401 || status === 403 ? "IPB-PORT-001" : "IPB-PORT-002",
      "IDENTITY",
      { adapter: "zitadel", detail: `${what} answered ${status}`, meta: { status, definite } },
    );
  }

  private token(form: Record<string, string>, basic?: { id: string; secret: string }) {
    return this.egress(`${this.issuer}/oauth/v2/token`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        ...(basic ? { authorization: basicAuth(basic.id, basic.secret) } : {}),
      },
      body: new URLSearchParams(form).toString(),
    });
  }

  private async admin(): Promise<string> {
    const a = this.o.admin;
    if (a.kind === "pat") return a.token;
    if (this.adminToken && this.now < this.adminToken.until) return this.adminToken.value;
    const r = await this.token(
      {
        grant_type: "client_credentials",
        scope: "openid urn:zitadel:iam:org:project:id:zitadel:aud",
      },
      { id: a.clientId, secret: a.clientSecret },
    );
    if (r.status !== 200) this.fail(r.status, "admin token");
    const t = r.json<{ access_token: string; expires_in: number }>();
    this.adminToken = {
      value: t.access_token,
      until: this.now + Math.max(0, t.expires_in - 30) * 1000,
    };
    return t.access_token;
  }

  private async api<T>(method: string, path: string, body?: unknown): Promise<T> {
    const r = await this.egress(`${this.issuer}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${await this.admin()}`,
        "content-type": "application/json",
        "x-zitadel-orgid": this.o.orgId,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (r.status >= 300) this.fail(r.status, `${method} ${path.split("/").slice(0, 4).join("/")}`);
    return (r.body.byteLength ? r.json<T>() : {}) as T;
  }

  // ---- users -------------------------------------------------------------------------------------

  private async setMetadata(userId: string, values: Record<string, string>): Promise<void> {
    await this.api("POST", `/management/v1/users/${userId}/metadata/_bulk`, {
      metadata: Object.entries(values).map(([key, value]) => ({ key, value: b64(value) })),
    });
  }

  private async metadata(userId: string, key: string): Promise<string | undefined> {
    try {
      const r = await this.api<{ metadata?: { value?: string } }>(
        "GET",
        `/management/v1/users/${userId}/metadata/${key}`,
      );
      return r.metadata?.value
        ? Buffer.from(r.metadata.value, "base64").toString("utf8")
        : undefined;
    } catch (e) {
      if ((e as PortError).meta?.status === 404) return undefined;
      throw e;
    }
  }

  private async grants(userId: string): Promise<Array<{ id: string; roleKeys?: string[] }>> {
    const r = await this.api<{
      result?: Array<{ id: string; projectId: string; roleKeys?: string[] }>;
    }>("POST", "/management/v1/users/grants/_search", { queries: [{ userIdQuery: { userId } }] });
    return (r.result ?? []).filter((g) => g.projectId === this.o.projectId);
  }

  private async setRoles(userId: string, roles: readonly string[]): Promise<void> {
    const [g] = await this.grants(userId);
    if (g)
      await this.api("PUT", `/management/v1/users/${userId}/grants/${g.id}`, {
        roleKeys: [...roles],
      });
    else if (roles.length)
      await this.api("POST", `/management/v1/users/${userId}/grants`, {
        projectId: this.o.projectId,
        roleKeys: [...roles],
      });
  }

  async provisionUser(spec: ProvisionUserSpec & { externalId?: string }): Promise<{ id: string }> {
    const r = await this.api<{ userId: string }>("POST", "/v2/users/human", {
      ...(spec.externalId ? { userId: scimUserId(this.o.orgId, spec.externalId) } : {}),
      organization: { orgId: this.o.orgId },
      username: spec.email,
      profile: { givenName: spec.displayName, familyName: "-", displayName: spec.displayName },
      email: { email: spec.email, isVerified: false },
      ...(spec.password
        ? { password: { password: spec.password.value, changeRequired: spec.password.temporary } }
        : {}),
    });
    await this.setMetadata(r.userId, {
      tenant_id: spec.tenantId,
      principal_type: "user",
      ...(spec.externalId ? { external_id: spec.externalId } : {}),
    });
    await this.setRoles(r.userId, spec.roles);
    return { id: r.userId };
  }

  private async userIdByEmail(email: string): Promise<string> {
    const r = await this.api<{ result?: ZUser[] }>("POST", "/v2/users", {
      queries: [{ emailQuery: { emailAddress: email, method: "TEXT_QUERY_METHOD_EQUALS" } }],
    });
    if (r.result?.length !== 1) this.fail(404, "/v2/users");
    return r.result[0]!.userId;
  }

  async setPassword(email: string, password: string, temporary: boolean): Promise<void> {
    const id = await this.userIdByEmail(email);
    await this.api("POST", `/v2/users/${id}/password`, {
      newPassword: { password, changeRequired: temporary },
    });
  }

  async getUser(id: string): Promise<IdentityUser> {
    const { user } = await this.api<{ user: ZUser }>("GET", `/v2/users/${encodeURIComponent(id)}`);
    const [tenant, grants, methods] = await Promise.all([
      this.metadata(user.userId, "tenant_id"),
      this.grants(user.userId),
      this.api<{ authMethodTypes?: string[] }>(
        "GET",
        `/v2/users/${user.userId}/authentication_methods`,
      ),
    ]);
    return {
      id: user.userId,
      email: user.human?.email?.email ?? user.username ?? "",
      displayName: user.human?.profile?.displayName ?? "",
      enabled: user.state !== "USER_STATE_INACTIVE",
      tenantId: tenant ?? "",
      roles: grants.flatMap((g) => g.roleKeys ?? []).filter((r) => RoleSchema.safeParse(r).success),
      // SMS and email OTP are not MFA factors (IPB-02-02).
      mfaEnrolled: (methods.authMethodTypes ?? []).some((m) => /TOTP|U2F|PASSKEY/.test(m)),
    };
  }

  async linkFederation(userId: string, idp: { alias: string; subject: string }): Promise<void> {
    await this.api("POST", `/v2/users/${encodeURIComponent(userId)}/links`, {
      idpLink: { idpId: idp.alias, userId: idp.subject, userName: idp.subject },
    });
  }

  // ---- tokens ------------------------------------------------------------------------------------

  async authenticate(assertion: {
    kind: "oidc_code" | "saml";
    value: string;
    redirectUri?: string;
    codeVerifier?: string;
  }): Promise<{ accessToken: string; idToken?: string; refreshToken?: string; expiresIn: number }> {
    if (assertion.kind !== "oidc_code")
      throw new PortError("IPB-PORT-001", "IDENTITY", {
        adapter: "zitadel",
        detail: "SAML responses are brokered by Zitadel, not exchanged by the API",
        meta: { reason: "unsupported" },
      });
    if (!assertion.redirectUri || !assertion.codeVerifier)
      throw new PortError("IPB-IDN-001", "IDENTITY", {
        adapter: "zitadel",
        detail: "an authorisation code needs its redirect URI and PKCE verifier",
      });
    const r = await this.token(
      {
        grant_type: "authorization_code",
        code: assertion.value,
        redirect_uri: assertion.redirectUri,
        code_verifier: assertion.codeVerifier,
      },
      { id: this.o.clientId, secret: this.o.clientSecret },
    ).catch((e: unknown) => {
      throw new PortError("IPB-IDN-002", "IDENTITY", {
        adapter: "zitadel",
        detail: "identity provider unavailable for new sessions",
        cause: e,
      });
    });
    if (r.status >= 500) throw new PortError("IPB-IDN-002", "IDENTITY", { adapter: "zitadel" });
    if (r.status !== 200)
      throw new PortError("IPB-IDN-001", "IDENTITY", {
        adapter: "zitadel",
        detail: "the authorisation code was refused",
        meta: { status: r.status },
      });
    const t = r.json<{
      access_token: string;
      id_token?: string;
      refresh_token?: string;
      expires_in: number;
    }>();
    await this.verifier.verify(t.access_token);
    return {
      accessToken: t.access_token,
      ...(t.id_token ? { idToken: t.id_token } : {}),
      ...(t.refresh_token ? { refreshToken: t.refresh_token } : {}),
      expiresIn: t.expires_in,
    };
  }

  /** Client credentials for the platform service principal. `actor` (RFC 8693 `act`) is unsupported. */
  async issueToken(
    claims: { subject: string; audience: string; actor?: string },
    ttlSeconds: number,
  ): Promise<{ accessToken: string; expiresIn: number }> {
    if (claims.actor !== undefined)
      throw new PortError("IPB-PORT-001", "IDENTITY", {
        adapter: "zitadel",
        detail: "impersonation tokens are off on this adapter (PL2-D-55)",
        meta: { reason: "unsupported" },
      });
    if (claims.subject !== this.o.serviceClient.clientId || claims.audience !== this.o.projectId)
      throw new PortError("IPB-PORT-003", "IDENTITY", {
        adapter: "zitadel",
        detail:
          "client credentials are issued only for the configured service principal and audience",
      });
    const r = await this.token(
      {
        grant_type: "client_credentials",
        scope: `openid ${META} urn:zitadel:iam:org:projects:roles urn:zitadel:iam:org:project:id:${this.o.projectId}:aud`,
      },
      { id: this.o.serviceClient.clientId, secret: this.o.serviceClient.clientSecret },
    );
    if (r.status !== 200) this.fail(r.status, "client credentials");
    const t = r.json<{ access_token: string; expires_in: number }>();
    if (t.expires_in > ttlSeconds)
      throw new PortError("IPB-PORT-003", "IDENTITY", {
        adapter: "zitadel",
        detail: "the instance issues tokens with a longer lifetime than requested",
      });
    await this.verifier.verify(t.access_token);
    return { accessToken: t.access_token, expiresIn: t.expires_in };
  }

  async verifyToken(jwt: string): Promise<VerifiedClaims> {
    return this.verifier.verify(jwt);
  }

  // ---- SCIM and revocation -----------------------------------------------------------------------

  async scimSync(
    ops: readonly ScimOp[],
  ): Promise<Array<{ externalId: string; ok: boolean; error?: string }>> {
    const out: Array<{ externalId: string; ok: boolean; error?: string }> = [];
    for (const op of ops) {
      const externalId = op.op === "create" ? op.user.externalId : op.externalId;
      try {
        if (op.op === "create") await this.provisionUser(op.user);
        else {
          const id = scimUserId(this.o.orgId, op.externalId);
          await this.api("GET", `/v2/users/${id}`);
          if (op.op === "update") {
            if (op.patch.displayName !== undefined)
              await this.api("PUT", `/v2/users/human/${id}`, {
                profile: {
                  givenName: op.patch.displayName,
                  familyName: "-",
                  displayName: op.patch.displayName,
                },
              });
            if (op.patch.roles) {
              await this.setRoles(id, op.patch.roles);
              await this.revoke(id, "revoke_sessions");
            }
            if (op.patch.enabled === false) await this.deactivate(id);
            if (op.patch.enabled === true) await this.api("POST", `/v2/users/${id}/reactivate`, {});
          } else await this.deactivate(id);
        }
        out.push({ externalId, ok: true });
      } catch (e) {
        out.push({ externalId, ok: false, error: (e as { code?: string }).code ?? "error" });
      }
    }
    return out;
  }

  private async deactivate(id: string): Promise<void> {
    await this.revoke(id, "scim_deactivate");
    await this.api("POST", `/v2/users/${id}/deactivate`, {});
  }

  /** Record the revocation first, then end the user's Zitadel sessions. */
  private async revoke(
    userId: string,
    reason: "scim_deactivate" | "revoke_sessions" | "logout",
  ): Promise<number> {
    const tenant = await this.metadata(userId, "tenant_id");
    if (!tenant) this.fail(422, "user without tenant_id");
    await this.o.revocations.revoke(tenant!, "user", userId, new Date(this.now), reason);
    const r = await this.api<{ sessions?: Array<{ id: string }> }>("POST", "/v2/sessions/search", {
      queries: [{ userIdQuery: { id: userId } }],
    });
    for (const s of r.sessions ?? []) await this.api("DELETE", `/v2/sessions/${s.id}`, {});
    return r.sessions?.length ?? 0;
  }

  async revokeSessions(userId: string): Promise<{ revoked: number }> {
    return { revoked: await this.revoke(userId, "revoke_sessions") };
  }

  async handleLogoutToken(jwt: string): Promise<{ sid?: string; sub?: string }> {
    const r = await this.verifier.verifyLogoutToken(jwt, this.o.clientId);
    if (!r.sub) this.fail(422, "logout token without sub");
    const tenant = await this.metadata(r.sub!, "tenant_id");
    if (!tenant) this.fail(422, "user without tenant_id");
    if (r.sid)
      await this.o.revocations.revoke(tenant!, "session", r.sid, new Date(this.now), "logout");
    else await this.o.revocations.revoke(tenant!, "user", r.sub!, new Date(this.now), "logout");
    return r;
  }

  async health(): Promise<PortHealth> {
    const t0 = Date.now();
    let status: PortHealth["status"];
    try {
      const r = await this.egress(`${this.issuer}/.well-known/openid-configuration`);
      status = r.status === 200 ? "up" : "down";
    } catch {
      status = "down";
    }
    return { status, latency_ms: Date.now() - t0, checked_at: new Date().toISOString() };
  }

  /** The settings the IPB fixes, as Zitadel reports them (contract test: read-back). */
  async readSettings(): Promise<Record<string, unknown>> {
    const [oidc, lockout, complexity, login] = await Promise.all([
      this.api<{ settings: Record<string, unknown> }>("GET", "/admin/v1/settings/oidc"),
      this.api<{ policy: Record<string, unknown> }>("GET", "/admin/v1/policies/lockout"),
      this.api<{ policy: Record<string, unknown> }>(
        "GET",
        "/admin/v1/policies/password/complexity",
      ),
      this.api<{ policy: Record<string, unknown> }>("GET", "/management/v1/policies/login"),
    ]);
    return {
      accessTokenLifetime: oidc.settings.accessTokenLifetime,
      idTokenLifetime: oidc.settings.idTokenLifetime,
      refreshTokenIdleExpiration: oidc.settings.refreshTokenIdleExpiration,
      refreshTokenExpiration: oidc.settings.refreshTokenExpiration,
      maxPasswordAttempts: String(lockout.policy.maxPasswordAttempts),
      passwordMinLength: String(complexity.policy.minLength),
      allowRegister: login.policy.allowRegister ?? false,
      forceMfa: login.policy.forceMfa ?? false,
      passwordlessType: login.policy.passwordlessType,
    };
  }

  // ---- instance as code --------------------------------------------------------------------------

  /**
   * Apply the IPB settings and create the platform project, roles, API app and service principal
   * with an admin PAT (deploy jobs and tests only). Returns ids and generated secrets for the
   * SECRETS port; secrets are returned, never logged.
   */
  static async applyInstance(o: {
    baseUrl: string;
    pat: string;
    profile: "tenant" | "staff";
    redirectUris: readonly string[];
    backchannelLogoutUri?: string;
    roles: readonly string[];
    allowLoopbackHttp?: boolean;
  }): Promise<{
    orgId: string;
    projectId: string;
    clientId: string;
    clientSecret: string;
    serviceClient: { clientId: string; clientSecret: string };
    serviceUserId: string;
  }> {
    const base = o.baseUrl.replace(/\/$/, "");
    const egress = zitadelEgress(base, o.allowLoopbackHttp);
    const call = async <T>(
      method: string,
      path: string,
      body?: unknown,
      ok404 = false,
    ): Promise<T | null> => {
      const r: EgressResponse = await egress(`${base}${path}`, {
        method,
        headers: { authorization: `Bearer ${o.pat}`, "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (ok404 && (r.status === 404 || r.status === 501)) return null;
      if (r.status >= 300)
        throw new PortError("IPB-PORT-002", "IDENTITY", {
          adapter: "zitadel",
          detail: `${method} ${path} answered ${r.status}: ${r.text().slice(0, 300)}`,
        });
      return (r.body.byteLength ? r.json<T>() : {}) as T;
    };
    const s = ZITADEL_IPB_SETTINGS[o.profile];

    // ES256 signing (C-12): create and activate a P-256 web key.
    let key = await call<{ id: string }>(
      "POST",
      "/v2/web_keys",
      { ecdsa: { curve: "ECDSA_CURVE_P256" } },
      true,
    );
    if (key) await call("POST", `/v2/web_keys/${key.id}/activate`, {});
    else {
      key = await call<{ id: string }>("POST", "/v2beta/web_keys", {
        ecdsa: { curve: "ECDSA_CURVE_P256" },
      });
      await call("POST", `/v2beta/web_keys/${key!.id}/_activate`, {});
    }

    await call("PUT", "/admin/v1/settings/oidc", {
      accessTokenLifetime: s.accessTokenLifetime,
      idTokenLifetime: s.idTokenLifetime,
      refreshTokenIdleExpiration: s.refreshTokenIdleExpiration,
      refreshTokenExpiration: s.refreshTokenExpiration,
    });
    await call("PUT", "/admin/v1/policies/lockout", {
      maxPasswordAttempts: Number(s.maxPasswordAttempts),
    });
    await call("PUT", "/admin/v1/policies/password/complexity", {
      minLength: Number(s.passwordMinLength),
      hasUppercase: false,
      hasLowercase: false,
      hasNumber: false,
      hasSymbol: false,
    });
    const org = (await call<{ org: { id: string } }>("GET", "/management/v1/orgs/me"))!.org.id;
    const loginPolicy = {
      allowUsernamePassword: true,
      allowRegister: s.allowRegister,
      allowExternalIdp: true,
      forceMfa: s.forceMfa,
      forceMfaLocalOnly: false,
      passwordlessType: s.passwordlessType,
      hidePasswordReset: false,
      ignoreUnknownUsernames: true,
      allowDomainDiscovery: false,
      disableLoginWithEmail: false,
      disableLoginWithPhone: true,
      passwordCheckLifetime: "864000s",
      externalLoginCheckLifetime: "864000s",
      mfaInitSkipLifetime: "0s",
      secondFactorCheckLifetime: "64800s",
      multiFactorCheckLifetime: "43200s",
      secondFactors: ["SECOND_FACTOR_TYPE_OTP", "SECOND_FACTOR_TYPE_U2F"],
      multiFactors: ["MULTI_FACTOR_TYPE_U2F_WITH_VERIFICATION"],
    };
    // An organisation policy of its own (create, or update when one exists).
    const created = await egress(`${base}/management/v1/policies/login`, {
      method: "POST",
      headers: { authorization: `Bearer ${o.pat}`, "content-type": "application/json" },
      body: JSON.stringify(loginPolicy),
    });
    if (created.status >= 300) await call("PUT", "/management/v1/policies/login", loginPolicy);

    const project = (await call<{ id: string }>("POST", "/management/v1/projects", {
      name: "ipb-platform",
      projectRoleAssertion: true,
      projectRoleCheck: false,
    }))!.id;
    await call("POST", `/management/v1/projects/${project}/roles/_bulk`, {
      roles: o.roles.map((key) => ({ key, displayName: key })),
    });
    const app = (await call<{ clientId: string; clientSecret: string }>(
      "POST",
      `/management/v1/projects/${project}/apps/oidc`,
      {
        name: "ipb-api",
        redirectUris: [...o.redirectUris],
        responseTypes: ["OIDC_RESPONSE_TYPE_CODE"],
        grantTypes: ["OIDC_GRANT_TYPE_AUTHORIZATION_CODE", "OIDC_GRANT_TYPE_REFRESH_TOKEN"],
        appType: "OIDC_APP_TYPE_WEB",
        authMethodType: "OIDC_AUTH_METHOD_TYPE_BASIC",
        accessTokenType: "OIDC_TOKEN_TYPE_JWT",
        accessTokenRoleAssertion: true,
        idTokenRoleAssertion: true,
        idTokenUserinfoAssertion: true,
        devMode: o.allowLoopbackHttp === true,
        ...(o.backchannelLogoutUri ? { backChannelLogoutUri: o.backchannelLogoutUri } : {}),
      },
    ))!;

    const svc = (await call<{ userId: string }>("POST", "/management/v1/users/machine", {
      userName: "ipb-service",
      name: "IPB platform service",
      description: "Platform service principal (IDENTITY issueToken)",
      accessTokenType: "ACCESS_TOKEN_TYPE_JWT",
    }))!.userId;
    const svcSecret = (await call<{ clientId: string; clientSecret: string }>(
      "PUT",
      `/management/v1/users/${svc}/secret`,
      {},
    ))!;
    await call("POST", `/management/v1/users/${svc}/metadata/_bulk`, {
      metadata: [
        { key: "tenant_id", value: b64(PLATFORM_KMS_TENANT) },
        { key: "principal_type", value: b64("service") },
      ],
    });
    return {
      orgId: org,
      projectId: project,
      clientId: app.clientId,
      clientSecret: app.clientSecret,
      serviceClient: { clientId: svcSecret.clientId, clientSecret: svcSecret.clientSecret },
      serviceUserId: svc,
    };
  }
}

function zitadelEgress(base: string, allowLoopbackHttp?: boolean): Egress {
  return createEgress({
    port: "IDENTITY",
    adapter: "zitadel",
    allow: [new URL(base).hostname],
    ...(allowLoopbackHttp ? { allowLoopbackHttp: true } : {}),
  });
}

/** RFC 6749 §2.3.1 client_secret_basic. */
function basicAuth(id: string, secret: string): string {
  const enc = (s: string) => encodeURIComponent(s).replace(/%20/g, "+");
  return `Basic ${Buffer.from(`${enc(id)}:${enc(secret)}`).toString("base64")}`;
}
