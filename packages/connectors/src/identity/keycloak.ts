// IDENTITY reference `keycloak` (PL2 plan §6.5): Keycloak 26.x over its OIDC endpoints and Admin
// REST API through the egress client. The realm is configuration as code (`ipbRealm`, applied by
// `KeycloakIdentity.applyRealm`): ES256 signing (C-12), IPB-02-03 session lifetimes, refresh-token
// rotation, brute-force protection, back-channel logout to the API, platform roles, and admin-only
// user attributes (tenant_id, principal_type, product_scope, external_id) mapped into the token.
// SCIM 2.0 operations go to the Admin API (PL2 plan A-08). RFC 8693 tokens with an `act` claim are
// unsupported on Keycloak (PL2-D-55): impersonation stays off on this adapter. `refreshSession` is the
// refresh grant under the realm's rotation (`revokeRefreshToken`, `refreshTokenMaxReuse` 0): a
// spent token is refused by Keycloak as reused, and the adapter then revokes its session (R1-D-77).
// Tenant SSO brokers (OIDC, SAML; linking only) and domain discovery go to the Admin API when the
// realm grants the admin account `manage-identity-providers` (`identityBrokers`, R1-D-78).
import { PortError } from "@infrabyx/contracts/errors";
import {
  IdpAlias,
  mfaRequired,
  PLATFORM_ROLES,
  RoleSchema,
  TENANT_ROLES,
  VerifiedDomain,
  type AdapterDescriptor,
  type IdentityPort,
  type IdentityProviderInfo,
  type IdentityProviderSpec,
  type IdentityUser,
  type PortHealth,
  type ProvisionUserSpec,
  type RefreshedTokens,
  type ScimOp,
  type VerifiedClaims,
  PLATFORM_KMS_TENANT,
} from "@infrabyx/contracts";
import { createEgress, type EgressResponse } from "../core/http.js";
import {
  brokerInfo,
  claimBroker,
  discoverBroker,
  oauthError,
  parseBrokerSpec,
  refreshRefused,
  resolveBrokerSecret,
  TokenVerifier,
  unverifiedJwtPayload,
  type BrokerRecord,
  type BrokerSecretResolver,
  type RevocationStore,
} from "./common.js";

type Egress = ReturnType<typeof createEgress>;

/** IPB-02-03 lifetimes in seconds: tenant users, and staff/admin realms. */
export const KEYCLOAK_SESSION_PROFILES = {
  tenant: { ssoSessionIdleTimeout: 1800, ssoSessionMaxLifespan: 43_200 },
  staff: { ssoSessionIdleTimeout: 900, ssoSessionMaxLifespan: 28_800 },
} as const;

/** Realm settings the adapter applies and reads back (contract test: equal to the IPB values). */
export const KEYCLOAK_IPB_SETTINGS = {
  defaultSignatureAlgorithm: "ES256",
  accessTokenLifespan: 300,
  revokeRefreshToken: true,
  refreshTokenMaxReuse: 0,
  bruteForceProtected: true,
  failureFactor: 5,
  registrationAllowed: false,
  duplicateEmailsAllowed: false,
  loginWithEmailAllowed: true,
  sslRequired: "external",
  passwordPolicy: "length(12) and notUsername and notEmail and passwordHistory(5)",
} as const;

/**
 * The bundled breached-password list (PR-LDC-04, R1-D-83): the 10,000 most common passwords of 12
 * characters or more, lower-cased, from SecLists (MIT). The Keycloak customer image carries it at
 * `/opt/keycloak/data/password-blacklists/` (`infra/keycloak/customer-otp/password-blacklists/`),
 * where Keycloak's `passwordBlacklist` policy looks it up; nothing is fetched at runtime.
 */
export const KEYCLOAK_PASSWORD_BLACKLIST = "ipb-common-passwords.txt";
const BLACKLIST_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

/**
 * The realm's password policy: the IPB floor, plus `passwordBlacklist(<file>)` when the realm names
 * a list the Keycloak server holds (IPB-02; PR-LDC-04, R1-D-83).
 */
export function keycloakPasswordPolicy(passwordBlacklist?: string): string {
  if (passwordBlacklist === undefined) return KEYCLOAK_IPB_SETTINGS.passwordPolicy;
  if (!BLACKLIST_FILE.test(passwordBlacklist) || passwordBlacklist.includes(".."))
    throw new RangeError("passwordBlacklist is a file name of A-Z a-z 0-9 . _ -");
  return `${KEYCLOAK_IPB_SETTINGS.passwordPolicy} and passwordBlacklist(${passwordBlacklist})`;
}

/** Realm role every MFA-required role carries as a composite (filtered out of `roles` by RoleSchema). */
const MFA_MARKER_ROLE = "ipb-mfa-required";
/** RFC 8176 `amr` values set on the flow executions the platform uses. */
const AMR_REFERENCES: Readonly<Record<string, string>> = {
  "auth-username-password-form": "pwd",
  "direct-grant-validate-password": "pwd",
  "auth-otp-form": "otp",
  "direct-grant-validate-otp": "otp",
  "webauthn-authenticator": "hwk",
  "webauthn-authenticator-passwordless": "hwk",
};

export interface KeycloakRealmSpec {
  realm: string;
  /** IPB-02-03 profile: `staff` for realms of PLT_ and OPS_ staff (15 min idle, 8 h absolute). */
  profile: "tenant" | "staff";
  /** The API client: authorisation code + PKCE, client credentials, back-channel logout. */
  apiClient: { clientId: string; redirectUris: readonly string[]; backchannelLogoutUrl?: string };
  /** Service account the adapter uses for the Admin API. */
  adminClientId: string;
  /** Audience the API accepts (`aud`). */
  audience: string;
  /** Passkeys first (IPB-02-01, `int.identity.passkeys.enabled`). */
  passkeys: boolean;
  /** WebAuthn relying party id (AUTH_PASSKEYS_RP_ID). */
  rpId?: string;
  /** Product roles to create beside the platform floor (e.g. FBX_CREDIT_HEAD). */
  productRoles?: readonly string[];
  /**
   * Refuse passwords on a list the Keycloak server holds in `data/password-blacklists/`, usually
   * `KEYCLOAK_PASSWORD_BLACKLIST` on the Keycloak customer image (PR-LDC-04, R1-D-83). Omitted, the
   * policy stays length, username, email and history only. Keycloak refuses the realm when the file
   * is missing, so set it only where the server carries the list.
   */
  passwordBlacklist?: string;
  /**
   * Let the admin service account manage identity-provider brokers (`manage-identity-providers`,
   * `view-identity-providers`; PR-LDC-09, R1-D-78). Off by default: only a product that offers
   * tenant SSO turns it on.
   */
  identityBrokers?: boolean;
}

/** Keycloak broker config keys the adapter owns (R1-D-78): owner tenant, domains, source URL. */
export const KEYCLOAK_BROKER_KEYS = {
  tenant: "ipb.tenant_id",
  domains: "ipb.domains",
  source: "ipb.source_url",
} as const;

/**
 * The first-broker-login flow of every managed broker (R1-D-78): linking only. It finds the
 * existing account of the brokered identity (refused when there is none) and links it after its
 * user signs in to it again. No `idp-create-user-if-unique`, no `idp-review-profile`, no
 * automatic linking. `applyRealm` creates it with `identityBrokers` and removes anything else.
 */
export const KEYCLOAK_BROKER_LINK_FLOW = "ipb-broker-link-only";
export const KEYCLOAK_BROKER_LINK_EXECUTIONS = [
  "idp-detect-existing-broker-user",
  "idp-username-password-form",
] as const;

/** The access-token claim naming the broker a session signed in with (session note mapper). */
export const KEYCLOAK_BROKER_CLAIM_MAPPER = {
  name: "idp",
  protocol: "openid-connect",
  protocolMapper: "oidc-usersessionmodel-note-mapper",
  config: {
    "user.session.note": "identity_provider",
    "claim.name": "idp",
    "jsonType.label": "String",
    "access.token.claim": "true",
    "id.token.claim": "false",
    "userinfo.token.claim": "false",
  },
} as const;

/** The realm as configuration as code (PL2 plan §6.5). Secrets are generated by Keycloak, never here. */
export function ipbRealm(spec: KeycloakRealmSpec): Record<string, unknown> {
  const roles = [...new Set([...PLATFORM_ROLES, ...TENANT_ROLES, ...(spec.productRoles ?? [])])];
  const mapper = (name: string, protocolMapper: string, config: Record<string, string>) => ({
    name,
    protocol: "openid-connect",
    protocolMapper,
    config: { "access.token.claim": "true", "id.token.claim": "true", ...config },
  });
  const attr = (claim: string, attribute: string, multivalued = false) =>
    mapper(claim, "oidc-usermodel-attribute-mapper", {
      "user.attribute": attribute,
      "claim.name": claim,
      "jsonType.label": "String",
      multivalued: String(multivalued),
      "userinfo.token.claim": "false",
    });
  return {
    realm: spec.realm,
    enabled: true,
    ...KEYCLOAK_IPB_SETTINGS,
    passwordPolicy: keycloakPasswordPolicy(spec.passwordBlacklist),
    ...KEYCLOAK_SESSION_PROFILES[spec.profile],
    permanentLockout: false,
    waitIncrementSeconds: 60,
    maxFailureWaitSeconds: 900,
    verifyEmail: false,
    resetPasswordAllowed: true,
    editUsernameAllowed: false,
    rememberMe: false,
    otpPolicyType: "totp",
    otpPolicyAlgorithm: "HmacSHA1",
    otpPolicyDigits: 6,
    otpPolicyPeriod: 30,
    webAuthnPolicyPasswordlessRpId: spec.rpId ?? "",
    webAuthnPolicyPasswordlessUserVerificationRequirement: "required",
    webAuthnPolicyPasswordlessResidentKey: "Yes",
    webAuthnPolicyPasswordlessPasskeysEnabled: spec.passkeys,
    webAuthnPolicyRpId: spec.rpId ?? "",
    webAuthnPolicySignatureAlgorithms: ["ES256"],
    roles: {
      realm: [
        { name: MFA_MARKER_ROLE, description: "IPB-02-02 marker; not a platform role" },
        ...roles.map((name) =>
          mfaRequired([name])
            ? { name, composite: true, composites: { realm: [MFA_MARKER_ROLE] } }
            : { name },
        ),
      ],
    },
    components: {
      "org.keycloak.keys.KeyProvider": [
        {
          name: "ipb-es256",
          providerId: "ecdsa-generated",
          subComponents: {},
          config: {
            priority: ["200"],
            enabled: ["true"],
            active: ["true"],
            ecdsaEllipticCurveKey: ["P-256"],
          },
        },
      ],
    },
    clients: [
      {
        clientId: spec.apiClient.clientId,
        protocol: "openid-connect",
        publicClient: false,
        standardFlowEnabled: true,
        implicitFlowEnabled: false,
        directAccessGrantsEnabled: false,
        serviceAccountsEnabled: true,
        frontchannelLogout: false,
        redirectUris: [...spec.apiClient.redirectUris],
        webOrigins: ["+"],
        attributes: {
          "pkce.code.challenge.method": "S256",
          "access.token.signed.response.alg": "ES256",
          "id.token.signed.response.alg": "ES256",
          "use.refresh.tokens": "true",
          "client_credentials.use_refresh_token": "false",
          "backchannel.logout.session.required": "true",
          "backchannel.logout.revoke.offline.tokens": "true",
          ...(spec.apiClient.backchannelLogoutUrl
            ? { "backchannel.logout.url": spec.apiClient.backchannelLogoutUrl }
            : {}),
        },
        protocolMappers: [
          attr("tid", "tenant_id"),
          attr("ptyp", "principal_type"),
          attr("product_scope", "product_scope", true),
          mapper("roles", "oidc-usermodel-realm-role-mapper", {
            "claim.name": "roles",
            "jsonType.label": "String",
            multivalued: "true",
            "userinfo.token.claim": "false",
          }),
          mapper("amr", "oidc-amr-mapper", {}),
          mapper("audience", "oidc-audience-mapper", {
            "included.custom.audience": spec.audience,
            "id.token.claim": "false",
          }),
        ],
      },
      {
        clientId: spec.adminClientId,
        protocol: "openid-connect",
        publicClient: false,
        standardFlowEnabled: false,
        directAccessGrantsEnabled: false,
        serviceAccountsEnabled: true,
        attributes: { "access.token.signed.response.alg": "ES256" },
      },
    ],
  };
}

export interface KeycloakIdentityOptions {
  /** Base URL, e.g. https://id.example.in (AUTH_ISSUER_URL without `/realms/<realm>`). */
  baseUrl: string;
  realm: string;
  /** API client (AUTH_CLIENT_ID; secret from AUTH_CLIENT_SECRET). */
  clientId: string;
  clientSecret: string;
  /** Admin service account (AUTH_ADMIN_CLIENT_ID; secret from AUTH_ADMIN_CLIENT_SECRET). */
  adminClientId: string;
  adminClientSecret: string;
  audience: string;
  revocations: RevocationStore;
  jwksCacheSeconds?: number;
  /** Required action that enrols MFA (default CONFIGURE_TOTP; passkey realms may use webauthn-register-passwordless). */
  mfaEnrolmentAction?: string;
  /**
   * Resolves identity-provider client secrets by SECRETS reference (R1-D-78); without it, OIDC
   * brokers are refused with IPB-PORT-001.
   */
  resolveSecret?: BrokerSecretResolver;
  allowLoopbackHttp?: boolean;
  /** Tests only: recorded HTTP fixtures. */
  fetchImpl?: typeof fetch;
  now?: () => number;
}

/** How long `discoverIdentityProvider` reuses the broker list read from the Admin API. */
const BROKER_CACHE_MS = 30_000;

interface KcIdp {
  alias: string;
  internalId?: string;
  displayName?: string;
  providerId: string;
  enabled?: boolean;
  config?: Record<string, string>;
  [k: string]: unknown;
}

/** A Keycloak broker as the port sees it; one without the platform's tenant key is unmanaged. */
function kcBroker(i: KcIdp): BrokerRecord {
  const c = i.config ?? {};
  const tenantId = c[KEYCLOAK_BROKER_KEYS.tenant] ?? "";
  let domains: VerifiedDomain[] = [];
  try {
    const d = VerifiedDomain.array().safeParse(JSON.parse(c[KEYCLOAK_BROKER_KEYS.domains] ?? "[]"));
    if (d.success) domains = d.data;
  } catch {
    domains = [];
  }
  const protocol = i.providerId === "saml" ? "saml" : "oidc";
  const source = c[KEYCLOAK_BROKER_KEYS.source];
  return {
    managed: tenantId !== "",
    tenantId,
    alias: i.alias,
    protocol,
    displayName: i.displayName ?? i.alias,
    enabled: i.enabled !== false,
    domains,
    ...(protocol === "oidc"
      ? {
          ...(source ? { discoveryUrl: source } : {}),
          ...(c.clientId ? { clientId: c.clientId } : {}),
        }
      : source
        ? { metadataUrl: source }
        : {}),
  };
}

/**
 * Keycloak's descriptions of a refresh token refused under `revokeRefreshToken`: a token older
 * than the session's last refresh (`Stale token`) or one used past `refreshTokenMaxReuse`.
 */
export const KEYCLOAK_REFRESH_REUSED =
  /^(stale token|maximum allowed refresh token reuse exceeded)/i;

interface KcUser {
  id: string;
  username: string;
  email?: string;
  firstName?: string;
  enabled: boolean;
  attributes?: Record<string, string[]>;
  requiredActions?: string[];
}

/** Characters Keycloak's person-name validator rejects (`error-person-name-invalid-character`). */
const PERSON_NAME_PROHIBITED = /[<>&"$%!#?§;*~/\\|^=[\]{}()\p{Cc}]/gu;

/**
 * The first name Keycloak accepts for a display name: the prohibited characters removed and the
 * whitespace collapsed (`Platform auditor (RO)` → `Platform auditor RO`). The display name itself
 * is kept whole in the `display_name` attribute, which `getUser` prefers.
 */
export function keycloakPersonName(displayName: string): string {
  return displayName.replace(PERSON_NAME_PROHIBITED, " ").replace(/\s+/g, " ").trim();
}

/**
 * The admin API's validation hint on a 4xx: its `field` and `errorMessage` (user profile), or its
 * `error_description` (password policy); never the body itself.
 */
function validation(r: EgressResponse): string {
  if (r.status < 400 || r.status >= 500 || !r.body.byteLength) return "";
  try {
    const b = r.json<{ field?: unknown; errorMessage?: unknown; error_description?: unknown }>();
    const msg =
      typeof b.errorMessage === "string"
        ? b.errorMessage
        : typeof b.error_description === "string"
          ? b.error_description
          : "";
    if (!msg) return "";
    return typeof b.field === "string" ? ` (${b.field}: ${msg})` : ` (${msg})`;
  } catch {
    return "";
  }
}

export class KeycloakIdentity implements IdentityPort {
  readonly descriptor: AdapterDescriptor = {
    port: "IDENTITY",
    adapter: "keycloak",
    residency: "IN",
    maxDataClass: "CONFIDENTIAL",
    capabilities: {
      "authenticate.saml": "unsupported",
      "issueToken.actor": "unsupported",
      discoverIdentityProvider: "emulated",
    },
  };
  readonly issuer: string;
  private readonly egress: Egress;
  private readonly verifier: TokenVerifier;
  private adminToken: { value: string; until: number } | null = null;
  private brokerCache: { at: number; list: BrokerRecord[] } | null = null;

  constructor(private readonly o: KeycloakIdentityOptions) {
    const base = o.baseUrl.replace(/\/$/, "");
    this.issuer = `${base}/realms/${o.realm}`;
    this.egress = keycloakEgress(base, o.allowLoopbackHttp, o.fetchImpl);
    this.verifier = new TokenVerifier({
      issuer: this.issuer,
      audience: o.audience,
      jwksUrl: `${this.issuer}/protocol/openid-connect/certs`,
      egress: this.egress,
      algorithms: ["ES256"],
      ...(o.jwksCacheSeconds !== undefined ? { jwksCacheSeconds: o.jwksCacheSeconds } : {}),
      revocations: o.revocations,
      ...(o.now ? { now: o.now } : {}),
    });
  }

  private get now(): number {
    return this.o.now?.() ?? Date.now();
  }

  // ---- transport ---------------------------------------------------------------------------------

  private fail(status: number, what: string, hint = ""): never {
    throw new PortError(
      status === 401 || status === 403 ? "IPB-PORT-001" : "IPB-PORT-002",
      "IDENTITY",
      { adapter: "keycloak", detail: `${what} answered ${status}${hint}`, meta: { status } },
    );
  }

  private async tokenRequest(form: Record<string, string>): Promise<EgressResponse> {
    return this.egress(`${this.issuer}/protocol/openid-connect/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(form).toString(),
    });
  }

  private async admin(): Promise<string> {
    if (this.adminToken && this.now < this.adminToken.until) return this.adminToken.value;
    const r = await this.tokenRequest({
      grant_type: "client_credentials",
      client_id: this.o.adminClientId,
      client_secret: this.o.adminClientSecret,
    });
    if (r.status !== 200) this.fail(r.status, "admin token");
    const t = r.json<{ access_token: string; expires_in: number }>();
    this.adminToken = {
      value: t.access_token,
      until: this.now + Math.max(0, t.expires_in - 30) * 1000,
    };
    return t.access_token;
  }

  private async api<T>(
    method: string,
    path: string,
    body?: unknown,
    ok: readonly number[] = [200, 201, 204],
  ): Promise<{ status: number; data: T; headers: Headers }> {
    const r = await this.egress(
      `${this.o.baseUrl.replace(/\/$/, "")}/admin/realms/${this.o.realm}${path}`,
      {
        method,
        headers: {
          authorization: `Bearer ${await this.admin()}`,
          "content-type": "application/json",
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
    );
    if (!ok.includes(r.status)) {
      if (r.status === 404) this.notFound(path);
      if (r.status === 409)
        throw new PortError("IPB-PORT-004", "IDENTITY", {
          adapter: "keycloak",
          detail: "the user or link already exists",
          meta: { status: 409, definite: true },
        });
      this.fail(r.status, `${method} ${path.split("/").slice(0, 2).join("/")}`, validation(r));
    }
    return {
      status: r.status,
      data: (r.body.byteLength ? r.json<T>() : undefined) as T,
      headers: r.headers,
    };
  }

  private notFound(path: string): never {
    throw new PortError("IPB-PORT-001", "IDENTITY", {
      adapter: "keycloak",
      detail: `not found: ${path.split("/").slice(0, 2).join("/")}`,
      meta: { status: 404, reason: "not_found", definite: true },
    });
  }

  // ---- users -------------------------------------------------------------------------------------

  private async userByEmail(email: string): Promise<KcUser> {
    const { data } = await this.api<KcUser[]>(
      "GET",
      `/users?exact=true&email=${encodeURIComponent(email)}`,
    );
    if (data.length !== 1) this.notFound("/users");
    return data[0]!;
  }

  private async userByExternalId(externalId: string): Promise<KcUser> {
    const { data } = await this.api<KcUser[]>(
      "GET",
      `/users?exact=true&q=${encodeURIComponent(`external_id:${externalId}`)}`,
    );
    const hit = data.filter((u) => u.attributes?.external_id?.[0] === externalId);
    if (hit.length !== 1) this.notFound("/users");
    return hit[0]!;
  }

  private async setRoles(userId: string, roles: readonly string[]): Promise<void> {
    const want = new Set(roles);
    const { data: current } = await this.api<Array<{ id: string; name: string }>>(
      "GET",
      `/users/${userId}/role-mappings/realm`,
    );
    const managed = new Set<string>([...PLATFORM_ROLES, ...TENANT_ROLES]);
    const remove = current.filter(
      (r) => !want.has(r.name) && (managed.has(r.name) || /^[A-Z]{2,4}_[A-Z]/.test(r.name)),
    );
    const have = new Set(current.map((r) => r.name));
    const add: Array<{ id: string; name: string }> = [];
    for (const name of want) {
      if (have.has(name)) continue;
      const { data } = await this.api<{ id: string; name: string }>(
        "GET",
        `/roles/${encodeURIComponent(name)}`,
      );
      add.push({ id: data.id, name: data.name });
    }
    if (remove.length) await this.api("DELETE", `/users/${userId}/role-mappings/realm`, remove);
    if (add.length) await this.api("POST", `/users/${userId}/role-mappings/realm`, add);
  }

  private mfaAction(): string {
    return this.o.mfaEnrolmentAction ?? "CONFIGURE_TOTP";
  }

  async provisionUser(spec: ProvisionUserSpec & { externalId?: string }): Promise<{ id: string }> {
    const required = [
      ...(spec.password?.temporary ? ["UPDATE_PASSWORD"] : []),
      ...(spec.mfaRequired || mfaRequired(spec.roles) ? [this.mfaAction()] : []),
    ];
    const { headers } = await this.api("POST", "/users", {
      username: spec.email,
      email: spec.email,
      ...(keycloakPersonName(spec.displayName)
        ? { firstName: keycloakPersonName(spec.displayName) }
        : {}),
      enabled: true,
      emailVerified: false,
      attributes: {
        tenant_id: [spec.tenantId],
        principal_type: ["user"],
        display_name: [spec.displayName],
        ...(spec.externalId ? { external_id: [spec.externalId] } : {}),
      },
      requiredActions: required,
      ...(spec.password
        ? {
            credentials: [
              { type: "password", value: spec.password.value, temporary: spec.password.temporary },
            ],
          }
        : {}),
    });
    const id = headers.get("location")?.split("/").pop();
    if (!id) this.fail(201, "create user without a location");
    await this.setRoles(id!, spec.roles);
    return { id: id! };
  }

  async setPassword(email: string, password: string, temporary: boolean): Promise<void> {
    const u = await this.userByEmail(email);
    await this.api("PUT", `/users/${u.id}/reset-password`, {
      type: "password",
      value: password,
      temporary,
    });
  }

  async getUser(id: string): Promise<IdentityUser> {
    const { data: u } = await this.api<KcUser>("GET", `/users/${encodeURIComponent(id)}`);
    const [{ data: roles }, { data: creds }] = await Promise.all([
      this.api<Array<{ name: string }>>("GET", `/users/${u.id}/role-mappings/realm`),
      this.api<Array<{ type: string }>>("GET", `/users/${u.id}/credentials`),
    ]);
    return {
      id: u.id,
      email: u.email ?? u.username,
      displayName: u.attributes?.display_name?.[0] ?? u.firstName ?? "",
      enabled: u.enabled,
      tenantId: u.attributes?.tenant_id?.[0] ?? "",
      roles: roles.map((r) => r.name).filter((n) => RoleSchema.safeParse(n).success),
      mfaEnrolled: creds.some((c) => c.type === "otp" || c.type.startsWith("webauthn")),
    };
  }

  async linkFederation(userId: string, idp: { alias: string; subject: string }): Promise<void> {
    await this.api(
      "POST",
      `/users/${encodeURIComponent(userId)}/federated-identity/${encodeURIComponent(idp.alias)}`,
      { identityProvider: idp.alias, userId: idp.subject, userName: idp.subject },
    );
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
        adapter: "keycloak",
        detail: "SAML responses are brokered by the realm, not exchanged by the API",
        meta: { reason: "unsupported" },
      });
    if (!assertion.redirectUri || !assertion.codeVerifier)
      throw new PortError("IPB-IDN-001", "IDENTITY", {
        adapter: "keycloak",
        detail: "an authorisation code needs its redirect URI and PKCE verifier",
      });
    const r = await this.tokenRequest({
      grant_type: "authorization_code",
      code: assertion.value,
      redirect_uri: assertion.redirectUri,
      code_verifier: assertion.codeVerifier,
      client_id: this.o.clientId,
      client_secret: this.o.clientSecret,
    }).catch((e: unknown) => {
      throw new PortError("IPB-IDN-002", "IDENTITY", {
        adapter: "keycloak",
        detail: "identity provider unavailable for new sessions",
        cause: e,
      });
    });
    if (r.status >= 500) throw new PortError("IPB-IDN-002", "IDENTITY", { adapter: "keycloak" });
    if (r.status !== 200)
      throw new PortError("IPB-IDN-001", "IDENTITY", {
        adapter: "keycloak",
        detail: "the authorisation code was refused",
        meta: { status: r.status },
      });
    const t = r.json<{
      access_token: string;
      id_token?: string;
      refresh_token?: string;
      expires_in: number;
    }>();
    // A token the platform cannot verify is never handed out.
    await this.verifyAccess(t.access_token);
    return {
      accessToken: t.access_token,
      ...(t.id_token ? { idToken: t.id_token } : {}),
      ...(t.refresh_token ? { refreshToken: t.refresh_token } : {}),
      expiresIn: t.expires_in,
    };
  }

  /**
   * The refresh grant (RFC 6749 §6) under the realm's rotation (PR-LDC-03, R1-D-77). A token
   * Keycloak reports as reused revokes its session: recorded first, so the API refuses the
   * session's access tokens even if the IdP call fails, then ended at Keycloak, which kills the
   * session's current refresh token.
   */
  async refreshSession(req: { refreshToken: string }): Promise<RefreshedTokens> {
    if (!req.refreshToken)
      throw refreshRefused("refresh_invalid", "a refresh needs a refresh token");
    const r = await this.tokenRequest({
      grant_type: "refresh_token",
      refresh_token: req.refreshToken,
      client_id: this.o.clientId,
      client_secret: this.o.clientSecret,
    }).catch((e: unknown) => {
      throw new PortError("IPB-IDN-002", "IDENTITY", {
        adapter: "keycloak",
        detail: "identity provider unavailable for refresh",
        cause: e,
      });
    });
    if (r.status !== 200) {
      const e = oauthError(r);
      if ((r.status === 400 || r.status === 401) && e.error === "invalid_grant") {
        if (KEYCLOAK_REFRESH_REUSED.test(e.description)) {
          await this.revokeReused(req.refreshToken);
          throw refreshRefused(
            "refresh_reused",
            "a spent refresh token was presented again; the session is revoked",
          );
        }
        throw refreshRefused("refresh_invalid", "the refresh token was refused");
      }
      this.fail(r.status, "refresh", e.error ? ` (${e.error})` : "");
    }
    const t = r.json<{
      access_token: string;
      id_token?: string;
      refresh_token?: string;
      expires_in: number;
    }>();
    if (!t.refresh_token || t.refresh_token === req.refreshToken)
      throw new PortError("IPB-PORT-002", "IDENTITY", {
        adapter: "keycloak",
        detail: "the realm did not rotate the refresh token (revokeRefreshToken is off)",
      });
    await this.verifyAccess(t.access_token);
    return {
      accessToken: t.access_token,
      ...(t.id_token ? { idToken: t.id_token } : {}),
      refreshToken: t.refresh_token,
      expiresIn: t.expires_in,
    };
  }

  /**
   * Revoke the session of a refresh token Keycloak has verified and reported as reused. Its `sid`
   * names the session; without one, every session of its user is revoked.
   */
  private async revokeReused(refreshToken: string): Promise<void> {
    const p = unverifiedJwtPayload(refreshToken);
    const sub = typeof p.sub === "string" ? p.sub : undefined;
    const sid =
      typeof p.sid === "string"
        ? p.sid
        : typeof p.session_state === "string"
          ? p.session_state
          : undefined;
    if (!sub) this.fail(422, "a reused refresh token without a subject");
    const { data: u } = await this.api<KcUser>("GET", `/users/${encodeURIComponent(sub!)}`);
    if (!sid) {
      await this.revokeUser(u, "security");
      return;
    }
    const tenant = u.attributes?.tenant_id?.[0];
    if (!tenant) this.fail(422, "user without tenant_id");
    await this.o.revocations.revoke(tenant!, "session", sid, new Date(this.now), "security");
    await this.api("DELETE", `/sessions/${encodeURIComponent(sid)}`, undefined, [200, 204, 404]);
  }

  /** Client credentials for the API client's service account. `actor` (RFC 8693 `act`) is unsupported. */
  async issueToken(
    claims: { subject: string; audience: string; actor?: string },
    ttlSeconds: number,
  ): Promise<{ accessToken: string; expiresIn: number }> {
    if (claims.actor !== undefined)
      throw new PortError("IPB-PORT-001", "IDENTITY", {
        adapter: "keycloak",
        detail: "Keycloak does not issue RFC 8693 tokens with an act claim (PL2-D-55)",
        meta: { reason: "unsupported" },
      });
    if (claims.subject !== this.o.clientId)
      throw new PortError("IPB-PORT-003", "IDENTITY", {
        adapter: "keycloak",
        detail: "client credentials are issued only for the configured API client",
      });
    const r = await this.tokenRequest({
      grant_type: "client_credentials",
      client_id: this.o.clientId,
      client_secret: this.o.clientSecret,
    });
    if (r.status !== 200) this.fail(r.status, "client credentials");
    const t = r.json<{ access_token: string; expires_in: number }>();
    if (claims.audience !== this.o.audience || t.expires_in > ttlSeconds)
      throw new PortError("IPB-PORT-003", "IDENTITY", {
        adapter: "keycloak",
        detail: "the realm issues this client's tokens for another audience or a longer lifetime",
      });
    await this.verifyAccess(t.access_token);
    return { accessToken: t.access_token, expiresIn: t.expires_in };
  }

  async verifyToken(jwt: string): Promise<VerifiedClaims> {
    return this.verifyAccess(jwt);
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
          const u = await this.userByExternalId(op.externalId);
          if (op.op === "update") {
            const { displayName, enabled, roles } = op.patch;
            if (displayName !== undefined || enabled !== undefined)
              await this.api("PUT", `/users/${u.id}`, {
                ...u,
                ...(displayName !== undefined
                  ? {
                      firstName: keycloakPersonName(displayName),
                      attributes: { ...u.attributes, display_name: [displayName] },
                    }
                  : {}),
                ...(enabled !== undefined ? { enabled } : {}),
              });
            if (roles) {
              await this.setRoles(u.id, roles);
              const fresh = await this.getUser(u.id);
              if (mfaRequired(roles) && !fresh.mfaEnrolled) {
                const actions = new Set([...(u.requiredActions ?? []), this.mfaAction()]);
                await this.api("PUT", `/users/${u.id}`, { ...u, requiredActions: [...actions] });
              }
              // IPB-02-03: a privilege change rotates the session.
              await this.revokeUser(u, "revoke_sessions");
            }
            if (enabled === false) await this.revokeUser(u, "scim_deactivate");
          } else {
            await this.api("PUT", `/users/${u.id}`, { ...u, enabled: false });
            await this.revokeUser(u, "scim_deactivate");
          }
        }
        out.push({ externalId, ok: true });
      } catch (e) {
        out.push({ externalId, ok: false, error: (e as { code?: string }).code ?? "error" });
      }
    }
    return out;
  }

  private async revokeUser(
    u: KcUser,
    reason: "scim_deactivate" | "revoke_sessions" | "security",
  ): Promise<number> {
    const tenant = u.attributes?.tenant_id?.[0];
    if (!tenant) this.fail(422, "user without tenant_id");
    // The revocation is recorded first, so the API refuses old tokens even if the IdP call fails.
    await this.o.revocations.revoke(tenant!, "user", u.id, new Date(this.now), reason);
    const { data: sessions } = await this.api<unknown[]>("GET", `/users/${u.id}/sessions`);
    await this.api("POST", `/users/${u.id}/logout`);
    return sessions.length;
  }

  async revokeSessions(userId: string): Promise<{ revoked: number }> {
    const { data: u } = await this.api<KcUser>("GET", `/users/${encodeURIComponent(userId)}`);
    return { revoked: await this.revokeUser(u, "revoke_sessions") };
  }

  async handleLogoutToken(jwt: string): Promise<{ sid?: string; sub?: string }> {
    const r = await this.verifier.verifyLogoutToken(jwt, this.o.clientId);
    if (!r.sub) this.fail(422, "logout token without sub");
    const { data: u } = await this.api<KcUser>("GET", `/users/${encodeURIComponent(r.sub!)}`);
    const tenant = u.attributes?.tenant_id?.[0];
    if (!tenant) this.fail(422, "user without tenant_id");
    if (r.sid)
      await this.o.revocations.revoke(tenant!, "session", r.sid, new Date(this.now), "logout");
    else await this.o.revocations.revoke(tenant!, "user", r.sub!, new Date(this.now), "logout");
    return r;
  }

  // ---- identity-provider brokers (PR-LDC-09, R1-D-78) --------------------------------------------
  // Each broker carries its owner tenant, verified domains and source URL in its config
  // (`KEYCLOAK_BROKER_KEYS`). Brokers are linking only (`KEYCLOAK_BROKER_LINK_FLOW`): a brokered
  // login reaches only an account the product provisioned, never creates one, and a session
  // whose broker belongs to another tenant than its account is refused (`verifyAccess`).
  // Keycloak reads the discovery or metadata document itself (`import-config`). Every change is
  // a maker-checker action in the product.

  private async brokers(fresh: boolean): Promise<BrokerRecord[]> {
    if (!fresh && this.brokerCache && this.now - this.brokerCache.at < BROKER_CACHE_MS)
      return this.brokerCache.list;
    const { data } = await this.api<KcIdp[]>(
      "GET",
      "/identity-provider/instances?briefRepresentation=false&first=0&max=1000",
    );
    const list = (data ?? []).map(kcBroker);
    this.brokerCache = { at: this.now, list };
    return list;
  }

  async upsertIdentityProvider(
    raw: IdentityProviderSpec,
  ): Promise<{ alias: string; created: boolean }> {
    const spec = parseBrokerSpec(raw, "keycloak", this.o.allowLoopbackHttp);
    const same = claimBroker(spec, await this.brokers(true), "keycloak");
    const secret =
      spec.protocol === "oidc"
        ? await resolveBrokerSecret(spec, this.o.resolveSecret, "keycloak")
        : undefined;
    const source = spec.protocol === "oidc" ? spec.discoveryUrl : spec.metadataUrl;
    const { data: imported } = await this.api<Record<string, string>>(
      "POST",
      "/identity-provider/import-config",
      { providerId: spec.protocol, fromUrl: source },
    );
    const config: Record<string, string> = {
      ...imported,
      syncMode: "IMPORT",
      [KEYCLOAK_BROKER_KEYS.tenant]: spec.tenantId,
      [KEYCLOAK_BROKER_KEYS.domains]: JSON.stringify(spec.domains),
      [KEYCLOAK_BROKER_KEYS.source]: source,
      ...(spec.protocol === "oidc"
        ? {
            clientId: spec.clientId,
            clientSecret: secret!,
            clientAuthMethod: "client_secret_post",
            defaultScope: spec.scopes.join(" "),
            validateSignature: "true",
            useJwksUrl: "true",
            pkceEnabled: "true",
            pkceMethod: "S256",
          }
        : { validateSignature: "true", wantAssertionsSigned: "true" }),
    };
    const rep = {
      alias: spec.alias,
      displayName: spec.displayName,
      providerId: spec.protocol,
      enabled: spec.enabled,
      // Linking only (R1-D-78): the first brokered login finds the existing account and links it
      // once its user has signed in to it; no account is ever created and no profile reviewed.
      // An email from a tenant's IdP never proves an account by itself.
      trustEmail: false,
      storeToken: false,
      addReadTokenRoleOnCreate: false,
      linkOnly: false,
      firstBrokerLoginFlowAlias: KEYCLOAK_BROKER_LINK_FLOW,
      config,
    };
    const path = `/identity-provider/instances/${encodeURIComponent(spec.alias)}`;
    if (same && same.protocol === spec.protocol) {
      const { data: cur } = await this.api<KcIdp>("GET", path);
      await this.api("PUT", path, { ...cur, ...rep, internalId: cur.internalId });
    } else {
      // Another protocol under the same alias is a new broker in Keycloak.
      if (same) await this.api("DELETE", path, undefined, [200, 204, 404]);
      await this.api("POST", "/identity-provider/instances", rep);
    }
    this.brokerCache = null;
    return { alias: spec.alias, created: !same };
  }

  /**
   * The tenant guard on brokered sessions (R1-D-78). Keycloak links a brokered login to whichever
   * existing account its user signs in to, so a token whose `idp` claim names a managed broker
   * is refused unless the account belongs to that broker's tenant: a tenant's IdP never signs in
   * to another tenant's account. Tokens without `idp` (no broker) are not affected.
   */
  private async verifyAccess(jwt: string): Promise<VerifiedClaims> {
    const { claims, raw } = await this.verifier.verifyWithRaw(jwt);
    const idp = typeof raw.idp === "string" ? raw.idp : "";
    if (!idp) return claims;
    const broker = (await this.brokers(false)).find((b) => b.alias === idp);
    if (broker?.managed && broker.tenantId !== claims.tid)
      throw new PortError("IPB-IDN-001", "IDENTITY", {
        adapter: "keycloak",
        detail:
          "the account belongs to another tenant than the identity provider it signed in with",
        meta: { reason: "idp_tenant" },
      });
    return claims;
  }

  async removeIdentityProvider(tenantId: string, alias: string): Promise<{ removed: boolean }> {
    if (!IdpAlias.safeParse(alias).success) return { removed: false };
    const b = (await this.brokers(true)).find((x) => x.alias === alias);
    if (!b?.managed || b.tenantId !== tenantId) return { removed: false };
    await this.api(
      "DELETE",
      `/identity-provider/instances/${encodeURIComponent(alias)}`,
      undefined,
      [200, 204, 404],
    );
    this.brokerCache = null;
    return { removed: true };
  }

  async listIdentityProviders(tenantId: string): Promise<IdentityProviderInfo[]> {
    return (await this.brokers(true))
      .filter((b) => b.managed && b.tenantId === tenantId)
      .map(brokerInfo);
  }

  async discoverIdentityProvider(
    email: string,
  ): Promise<{ tenantId: string; alias: string } | null> {
    return discoverBroker(await this.brokers(false), email);
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

  /** The realm settings the IPB fixes, as Keycloak reports them (contract test: read-back). */
  async readRealmSettings(): Promise<Record<string, unknown>> {
    const r = await this.egress(
      `${this.o.baseUrl.replace(/\/$/, "")}/admin/realms/${this.o.realm}`,
      { headers: { authorization: `Bearer ${await this.admin()}` } },
    );
    if (r.status !== 200) this.fail(r.status, "GET realm");
    const realm = r.json<Record<string, unknown>>();
    const keys = [
      ...Object.keys(KEYCLOAK_IPB_SETTINGS),
      "ssoSessionIdleTimeout",
      "ssoSessionMaxLifespan",
    ];
    return Object.fromEntries(keys.map((k) => [k, realm[k]]));
  }

  // ---- realm as code -----------------------------------------------------------------------------

  /**
   * Create or update the realm from `ipbRealm(spec)` with a master-realm admin token (deploy jobs
   * and tests only; never the API at runtime). Returns the generated client secrets for the
   * SECRETS port. Secrets are returned, never logged.
   */
  static async applyRealm(o: {
    baseUrl: string;
    masterAdmin: { username: string; password: string };
    spec: KeycloakRealmSpec;
    allowLoopbackHttp?: boolean;
    /** Tests only: recorded HTTP fixtures. */
    fetchImpl?: typeof fetch;
  }): Promise<{ clientSecret: string; adminClientSecret: string }> {
    const base = o.baseUrl.replace(/\/$/, "");
    const egress = keycloakEgress(base, o.allowLoopbackHttp, o.fetchImpl);
    const tr = await egress(`${base}/realms/master/protocol/openid-connect/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "password",
        client_id: "admin-cli",
        username: o.masterAdmin.username,
        password: o.masterAdmin.password,
      }).toString(),
    });
    const fail = (status: number, what: string): never => {
      throw new PortError("IPB-PORT-002", "IDENTITY", {
        adapter: "keycloak",
        detail: `${what} answered ${status}`,
      });
    };
    if (tr.status !== 200) fail(tr.status, "master admin token");
    const token = tr.json<{ access_token: string }>().access_token;
    const call = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
      const r = await egress(`${base}/admin/realms${path}`, {
        method,
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (r.status >= 300)
        fail(r.status, `${method} /admin/realms${path.split("/").slice(0, 3).join("/")}`);
      return (r.body.byteLength ? r.json<T>() : undefined) as T;
    };
    const realm = o.spec.realm;
    const rep = ipbRealm(o.spec);
    const exists = await egress(`${base}/admin/realms/${realm}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (exists.status === 404) await call("POST", "", rep);
    else {
      const { roles: _r, clients: _c, components: _k, ...settings } = rep;
      await call("PUT", `/${realm}`, settings);
    }

    // Admin-only attributes (IPB-02-13: users cannot set their own tenant or type).
    const profile = await call<{
      attributes: Array<Record<string, unknown> & { name: string }>;
      unmanagedAttributePolicy?: string;
    }>("GET", `/${realm}/users/profile`);
    profile.unmanagedAttributePolicy = "ADMIN_EDIT";
    for (const a of profile.attributes)
      if (a.name === "firstName" || a.name === "lastName") delete a.required;
    await call("PUT", `/${realm}/users/profile`, profile);

    // `amr` references on the built-in browser and direct-grant flows. Keycloak keeps a reference
    // while `authTime + maxAge >= now` (whole seconds), so the maximum age is the session's
    // lifetime: a factor proved in a session is reported for that session, and no longer. With 0
    // the reference survived only a code exchange in the same second as the step, and no refresh.
    const maxAge = String(KEYCLOAK_SESSION_PROFILES[o.spec.profile].ssoSessionMaxLifespan);
    for (const flow of ["browser", "direct grant"]) {
      const execs = await call<
        Array<{ id: string; providerId?: string; authenticationConfig?: string }>
      >("GET", `/${realm}/authentication/flows/${encodeURIComponent(flow)}/executions`);
      for (const e of execs) {
        const amr = e.providerId ? AMR_REFERENCES[e.providerId] : undefined;
        if (!amr) continue;
        const config = { "default.reference.value": amr, "default.reference.maxAge": maxAge };
        if (!e.authenticationConfig) {
          await call("POST", `/${realm}/authentication/executions/${e.id}/config`, {
            alias: `ipb-amr-${e.id.slice(0, 8)}`,
            config,
          });
          continue;
        }
        // A realm applied before: update the platform's own reference, leave any other config.
        const cur = await call<{ id: string; alias?: string; config?: Record<string, string> }>(
          "GET",
          `/${realm}/authentication/config/${e.authenticationConfig}`,
        );
        if (cur.alias?.startsWith("ipb-amr-"))
          await call("PUT", `/${realm}/authentication/config/${cur.id}`, { ...cur, config });
      }
    }

    // The admin service account gets user management only (and brokers, when turned on).
    const clients = await call<Array<{ id: string; clientId: string }>>("GET", `/${realm}/clients`);
    const id = (cid: string) => clients.find((c) => c.clientId === cid)!.id;
    const adminCid = id(o.spec.adminClientId);
    const rm = id("realm-management");
    const sa = await call<{ id: string }>(
      "GET",
      `/${realm}/clients/${adminCid}/service-account-user`,
    );
    const available = await call<Array<{ id: string; name: string }>>(
      "GET",
      `/${realm}/clients/${rm}/roles`,
    );
    const grant = available.filter((r) =>
      [
        "manage-users",
        "view-users",
        "query-users",
        "view-realm",
        // Tenant SSO only where the product turns it on (R1-D-78).
        ...(o.spec.identityBrokers ? ["manage-identity-providers", "view-identity-providers"] : []),
      ].includes(r.name),
    );
    await call("POST", `/${realm}/users/${sa.id}/role-mappings/clients/${rm}`, grant);
    // The API client's own service account: a platform service principal (issueToken).
    const apiSa = await call<Record<string, unknown> & { id: string }>(
      "GET",
      `/${realm}/clients/${id(o.spec.apiClient.clientId)}/service-account-user`,
    );
    await call("PUT", `/${realm}/users/${apiSa.id}`, {
      ...apiSa,
      attributes: { tenant_id: [PLATFORM_KMS_TENANT], principal_type: ["service"] },
    });

    // Tenant SSO (R1-D-78): the linking-only first-broker-login flow every managed broker uses,
    // exactly as `KEYCLOAK_BROKER_LINK_EXECUTIONS` (anything else is removed), and the `idp`
    // claim that names a session's broker for the adapter's tenant guard.
    if (o.spec.identityBrokers) {
      const flows = await call<Array<{ alias: string }>>("GET", `/${realm}/authentication/flows`);
      if (!flows.some((f) => f.alias === KEYCLOAK_BROKER_LINK_FLOW))
        await call("POST", `/${realm}/authentication/flows`, {
          alias: KEYCLOAK_BROKER_LINK_FLOW,
          description: "IPB tenant SSO: link a brokered login to an existing account only",
          providerId: "basic-flow",
          topLevel: true,
          builtIn: false,
        });
      type Exec = { id: string; providerId?: string; requirement?: string; level?: number };
      const flowPath = `/${realm}/authentication/flows/${encodeURIComponent(KEYCLOAK_BROKER_LINK_FLOW)}`;
      const top = (await call<Exec[]>("GET", `${flowPath}/executions`)).filter(
        (e) => (e.level ?? 0) === 0,
      );
      const wanted: readonly string[] = KEYCLOAK_BROKER_LINK_EXECUTIONS;
      if (top.map((e) => e.providerId).join() !== wanted.join()) {
        for (const e of top) await call("DELETE", `/${realm}/authentication/executions/${e.id}`);
        for (const provider of wanted)
          await call("POST", `${flowPath}/executions/execution`, { provider });
      }
      for (const e of await call<Exec[]>("GET", `${flowPath}/executions`))
        if (e.requirement !== "REQUIRED")
          await call("PUT", `${flowPath}/executions`, { ...e, requirement: "REQUIRED" });
      const models = `/${realm}/clients/${id(o.spec.apiClient.clientId)}/protocol-mappers/models`;
      const mappers = await call<Array<{ name: string }>>("GET", models);
      if (!mappers.some((m) => m.name === KEYCLOAK_BROKER_CLAIM_MAPPER.name))
        await call("POST", models, KEYCLOAK_BROKER_CLAIM_MAPPER);
    }

    const secret = async (cid: string) =>
      (await call<{ value: string }>("GET", `/${realm}/clients/${id(cid)}/client-secret`)).value;
    return {
      clientSecret: await secret(o.spec.apiClient.clientId),
      adminClientSecret: await secret(o.spec.adminClientId),
    };
  }
}

export function keycloakEgress(
  base: string,
  allowLoopbackHttp?: boolean,
  fetchImpl?: typeof fetch,
): Egress {
  return createEgress({
    port: "IDENTITY",
    adapter: "keycloak",
    allow: [new URL(base).hostname],
    ...(allowLoopbackHttp ? { allowLoopbackHttp: true } : {}),
    ...(fetchImpl ? { fetchImpl } : {}),
  });
}
