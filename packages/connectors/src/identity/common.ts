// Shared IDENTITY behaviour (PL2 plan §6.5). Tokens are verified with the C-11 verifier from
// @infrabyx/crypto under the issuer's own allow-list (ES256 for both IdPs, C-12); claims are mapped
// to the PL1 VerifiedClaims schema; revoked sessions and users are refused on every replica within
// 60 s (IPB-02-05, PL2-D-53); privileged roles without MFA are refused at the API (IPB-02-02).
import { IpbError, PortError } from "@infrabyx/contracts/errors";
import type { AuditSink, KernelContext, MutationKernel } from "@infrabyx/contracts/kernel";
import {
  VerifiedClaims,
  emailDomainOf,
  IdentityProviderSpec,
  idpUrlAllowed,
  mfaRequiredBy,
  parseSecretRef,
  PLATFORM_MFA_FLOOR,
  type MfaFloor,
  RoleSchema,
  type IdentityProviderConfig,
  type IdentityProviderInfo,
  type RefreshRefusalReason,
  type SecretRef,
} from "@infrabyx/contracts";
import { JwksCache, newId, sha256Hex, verifyJwt, type JwsAlgorithm } from "@infrabyx/crypto";
import type { createEgress } from "../core/http.js";

type Egress = ReturnType<typeof createEgress>;

const refused = (reason: string, detail: string): never => {
  throw new IpbError("IPB-IDN-001", { detail, meta: { reason } });
};

/** MFA methods in `amr` (RFC 8176 values and the IdPs' own). */
const MFA_AMR = new Set(["otp", "mfa", "hwk", "swk", "sc", "user", "webauthn", "passkey", "totp"]);

/** Map a verified token payload to VerifiedClaims. Principal type travels as `ptyp`. */
export function toVerifiedClaims(raw: Record<string, unknown>): VerifiedClaims {
  const roles = (Array.isArray(raw.roles) ? raw.roles : []).filter(
    (r): r is string => typeof r === "string" && RoleSchema.safeParse(r).success,
  );
  const amr = Array.isArray(raw.amr)
    ? raw.amr.filter((a): a is string => typeof a === "string")
    : [];
  const scope = Array.isArray(raw.product_scope) ? raw.product_scope : undefined;
  const act = raw.act as { sub?: unknown; sid?: unknown } | undefined;
  const candidate = {
    sub: raw.sub,
    tid: raw.tid,
    ...(typeof raw.ent === "string" ? { ent: raw.ent } : {}),
    typ: typeof raw.ptyp === "string" ? raw.ptyp : "user",
    roles,
    ...(scope ? { product_scope: scope } : {}),
    ...(act && typeof act.sub === "string"
      ? { act: { sub: act.sub, sid: typeof act.sid === "string" ? act.sid : "" } }
      : {}),
    ...(typeof raw.bg === "string" ? { bg: raw.bg } : {}),
    mfa: raw.mfa === true || amr.some((a) => MFA_AMR.has(a.toLowerCase())),
    ...(amr.length ? { amr: amr.slice(0, 16).filter((a) => a.length <= 32) } : {}),
    ...(typeof raw.acr === "string" && raw.acr.length <= 255 ? { acr: raw.acr } : {}),
    ...(typeof raw.sid === "string" ? { sid: raw.sid } : {}),
    exp: raw.exp,
    iat: raw.iat,
  };
  const r = VerifiedClaims.safeParse(candidate);
  if (!r.success)
    refused(
      "claims",
      `token claims do not match the platform schema: ${r.error.issues[0]?.path.join(".")}`,
    );
  return r.data!;
}

/**
 * Second factors that count for a role whose floor excludes SMS (RFC 8176 and the IdPs' values):
 * not `sms`, and not the bare `mfa` or `user` markers, which do not say which factor was used.
 */
const NON_SMS_FACTORS = new Set([
  "otp",
  "totp",
  "hwk",
  "swk",
  "sc",
  "pop",
  "fpt",
  "face",
  "webauthn",
  "passkey",
]);

export interface MfaCheckOptions {
  /**
   * Answer in step-up form (RFC 9470): the error carries `meta.step_up` and `meta.required_acr`,
   * and `stepUpChallenge` turns it into a 401 with `WWW-Authenticate`, so a BFF can re-run sign-in
   * with `acr_values`. Without it the answer is the 403 `IPB-SEC-001`.
   */
  stepUp?: { acrValues: string };
}

const ACR_VALUES = /^[\x21\x23-\x5b\x5d-\x7e]{1,255}( [\x21\x23-\x5b\x5d-\x7e]{1,255}){0,7}$/;

/**
 * IPB-02-02 at the API guard: a role on the floor without MFA in this session is `IPB-SEC-001`.
 * `floor` (from `mfaFloor`) adds a product's roles and its SMS exclusions; the platform floor always
 * applies. For an SMS-excluded role the session must name a non-SMS second factor in `amr`, so a
 * token that only says `mfa: true` is refused for it (fail closed).
 */
export function assertMfaForRoles(
  claims: VerifiedClaims,
  floor: MfaFloor = PLATFORM_MFA_FLOOR,
  o: MfaCheckOptions = {},
): void {
  if (o.stepUp !== undefined && !ACR_VALUES.test(o.stepUp.acrValues))
    throw new TypeError("assertMfaForRoles: stepUp.acrValues must be one to eight acr values");
  if (!mfaRequiredBy(floor, claims.roles)) return;
  const smsExcluded = floor.smsExcludedRoles.some((r) => claims.roles.includes(r));
  const strong = (claims.amr ?? []).some((a) => NON_SMS_FACTORS.has(a.toLowerCase()));
  if (claims.mfa === true && (!smsExcluded || strong)) return;
  const detail =
    claims.mfa === true
      ? "this role requires a second factor other than SMS"
      : "this role requires multi-factor authentication";
  throw new IpbError("IPB-SEC-001", {
    detail,
    ...(o.stepUp
      ? {
          meta: {
            step_up: true,
            required_acr: o.stepUp.acrValues,
            ...(smsExcluded ? { sms_excluded: true } : {}),
          },
        }
      : {}),
  });
}

/**
 * The RFC 9470 answer for a step-up `IPB-SEC-001` from `assertMfaForRoles`: status 401 and
 * `WWW-Authenticate: Bearer error="insufficient_user_authentication", ..., acr_values="..."`.
 * Returns null for any other error, which keeps its own status.
 */
export function stepUpChallenge(
  e: unknown,
): { status: 401; headers: { "www-authenticate": string }; requiredAcr: string } | null {
  if (!(e instanceof IpbError) || e.code !== "IPB-SEC-001" || e.meta?.step_up !== true) return null;
  const acr = e.meta.required_acr;
  if (typeof acr !== "string" || !ACR_VALUES.test(acr)) return null;
  const description =
    e.meta.sms_excluded === true
      ? "A second factor other than SMS is required"
      : "Multi-factor authentication is required";
  return {
    status: 401,
    requiredAcr: acr,
    headers: {
      "www-authenticate": `Bearer error="insufficient_user_authentication", error_description="${description}", acr_values="${acr}"`,
    },
  };
}

/** A route a product serves, as its boot check sees it. */
export interface RouteGuardEntry {
  /** The route pattern, e.g. `/oauth/callback` or `/api/v1/cases/:id`. */
  path: string;
  /** True when the route is behind `assertMfaForRoles` (the MFA floor). */
  mfaFloor: boolean;
  /**
   * True for a route a session needs in order to step up (sign-in callback, MFA enrolment,
   * session refresh, sign-out). Unset: decided by `STEP_UP_ROUTE_PATTERNS`. `false` only when a
   * route matching a pattern really is not one (say so in a review).
   */
  stepUp?: boolean;
}

/** Routes treated as step-up routes unless marked `stepUp: false`. */
export const STEP_UP_ROUTE_PATTERNS: readonly RegExp[] = [
  /(^|\/)(oauth|oidc|auth|sso)(\/[^/]+)*\/callback\/?$/i,
  /(^|\/)(login|signin|sign-in|logout|signout|sign-out)(\/|$)/i,
  /(^|\/)(mfa|2fa|otp|webauthn|passkeys?)(\/|$)/i,
  /(^|\/)(session|token)\/(refresh|renew)\/?$/i,
  /^\/\.well-known\//,
];

/**
 * Boot check (PR-LDC-55 item 3): refuses (`TypeError`) when a route a session needs to step up is
 * guarded by the MFA floor, which would leave a user unable to reach the step that satisfies it.
 */
export function assertStepUpReachable(routes: readonly RouteGuardEntry[]): void {
  const bad = routes.filter(
    (r) =>
      r.mfaFloor &&
      (r.stepUp === true ||
        (r.stepUp === undefined && STEP_UP_ROUTE_PATTERNS.some((p) => p.test(r.path)))),
  );
  if (bad.length)
    throw new TypeError(
      `step-up routes are behind the MFA floor: ${bad.map((r) => r.path).join(", ")}`,
    );
}

// ---- revocation (IPB-02-05) ---------------------------------------------------------------------

export type RevocationKind = "session" | "user";
export type RevocationReason = "logout" | "scim_deactivate" | "revoke_sessions" | "security";

export interface RevocationStore {
  /** Refuse a session (`subject` = sid) or every token a user (`subject` = sub) received before `notBefore`. */
  revoke(
    tenantId: string,
    kind: RevocationKind,
    subject: string,
    notBefore: Date,
    reason: RevocationReason,
  ): Promise<void>;
  isRevoked(claims: Pick<VerifiedClaims, "tid" | "sub" | "sid" | "iat">): Promise<boolean>;
}

const subjectHash = (kind: RevocationKind, subject: string) => sha256Hex(`${kind}:${subject}`);

/** Single-replica store for tests and local development. */
export class MemoryRevocationStore implements RevocationStore {
  private readonly m = new Map<string, number>();
  async revoke(
    tenantId: string,
    kind: RevocationKind,
    subject: string,
    notBefore: Date,
    _reason?: RevocationReason,
  ): Promise<void> {
    const k = `${tenantId}|${subjectHash(kind, subject)}`;
    this.m.set(k, Math.max(this.m.get(k) ?? 0, notBefore.getTime()));
  }
  async isRevoked(c: Pick<VerifiedClaims, "tid" | "sub" | "sid" | "iat">): Promise<boolean> {
    const user = this.m.get(`${c.tid}|${subjectHash("user", c.sub)}`);
    if (user !== undefined && c.iat * 1000 < user) return true;
    return c.sid !== undefined && this.m.has(`${c.tid}|${subjectHash("session", c.sid)}`);
  }
}

export interface PgRevocationStoreOptions {
  kernel: MutationKernel;
  audit: AuditSink;
  /** Service context for a tenant (writes and reads run under that tenant's RLS). */
  context(tenantId: string): KernelContext;
  /** Cache refresh interval; at most 15 s so revocations apply within 60 s (default 15 s). */
  refreshMs?: number;
  /** How long a revocation row is kept (default 24 h, longer than any token or refresh lifetime). */
  ttlSeconds?: number;
  now?: () => number;
}

/** PostgreSQL store on `connectors.session_revocation` (migration 0002), cached per tenant ≤ 15 s. */
export class PgRevocationStore implements RevocationStore {
  private readonly cache = new Map<
    string,
    { at: number; sessions: Set<string>; users: Map<string, number> }
  >();
  private readonly now: () => number;

  constructor(private readonly o: PgRevocationStoreOptions) {
    if ((o.refreshMs ?? 15_000) > 15_000)
      throw new RangeError("revocations must refresh at least every 15 s");
    this.now = o.now ?? Date.now;
  }

  async revoke(
    tenantId: string,
    kind: RevocationKind,
    subject: string,
    notBefore: Date,
    reason: RevocationReason,
  ): Promise<void> {
    const ttl = this.o.ttlSeconds ?? 86_400;
    const hash = subjectHash(kind, subject);
    const id = newId("rvk");
    await this.o.kernel.mutate(this.o.context(tenantId), async (tx) => {
      await tx.query(
        `insert into connectors.session_revocation (id, tenant_id, kind, subject_hash, not_before, reason, expires_at)
         values ($1, $2, $3, $4, $5, $6, now() + make_interval(secs => $7))
         on conflict (tenant_id, kind, subject_hash) do update
           set not_before = greatest(connectors.session_revocation.not_before, excluded.not_before),
               reason = excluded.reason, expires_at = excluded.expires_at`,
        [id, tenantId, kind, hash, notBefore.toISOString(), reason, ttl],
      );
      await this.o.audit.record(tx, {
        action: `identity.${kind}.revoke`,
        resourceType: "identity.revocation",
        resourceId: hash,
        after: { kind, reason },
      });
    });
    this.cache.delete(tenantId);
  }

  private async load(tenantId: string) {
    const c = this.cache.get(tenantId);
    if (c && this.now() - c.at < (this.o.refreshMs ?? 15_000)) return c;
    const rows = await this.o.kernel.read(this.o.context(tenantId), (tx) =>
      tx.query<{ kind: RevocationKind; subject_hash: string; not_before: Date }>(
        "select kind, subject_hash, not_before from connectors.session_revocation where expires_at > now()",
      ),
    );
    const fresh = { at: this.now(), sessions: new Set<string>(), users: new Map<string, number>() };
    for (const r of rows.rows)
      if (r.kind === "session") fresh.sessions.add(r.subject_hash);
      else fresh.users.set(r.subject_hash, new Date(r.not_before).getTime());
    this.cache.set(tenantId, fresh);
    return fresh;
  }

  async isRevoked(c: Pick<VerifiedClaims, "tid" | "sub" | "sid" | "iat">): Promise<boolean> {
    const s = await this.load(c.tid);
    const user = s.users.get(subjectHash("user", c.sub));
    if (user !== undefined && c.iat * 1000 < user) return true;
    return c.sid !== undefined && s.sessions.has(subjectHash("session", c.sid));
  }
}

// ---- refresh-token grant (PR-LDC-03, R1-D-77) ----------------------------------------------------

/** IPB-IDN-001 from `refreshSession`; the detail never carries the token. */
export const refreshRefused = (reason: RefreshRefusalReason, detail: string): IpbError =>
  new IpbError("IPB-IDN-001", { detail, meta: { reason } });

/** The RFC 6749 §5.2 error of a refused token request: its `error` and `error_description` only. */
export function oauthError(r: { body: Uint8Array; json<T>(): T }): {
  error: string;
  description: string;
} {
  if (!r.body.byteLength) return { error: "", description: "" };
  try {
    const b = r.json<{ error?: unknown; error_description?: unknown }>();
    return {
      error: typeof b.error === "string" ? b.error : "",
      description: typeof b.error_description === "string" ? b.error_description : "",
    };
  } catch {
    return { error: "", description: "" };
  }
}

/**
 * The payload of a JWT, unverified. Used only to name the session to revoke after the IdP has
 * verified a refresh token and reported its reuse; never to authorise anything. `{}` when the
 * token is not a JWT.
 */
export function unverifiedJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split(".");
  if (parts.length !== 3) return {};
  try {
    const p = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8")) as unknown;
    return p && typeof p === "object" && !Array.isArray(p) ? (p as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** The session a refresh token belongs to. */
export interface RefreshFamily {
  tenantId: string;
  userId: string;
  /** IdP session id, when the access tokens carry one (`sid`). */
  sid?: string;
}

/**
 * What an adapter that detects reuse itself remembers of refresh tokens: SHA-256 hashes only,
 * never a token. Used where the IdP rotates refresh tokens but does not report a reused one as
 * such (Zitadel). One family per session; a family is revoked as a whole.
 */
export interface RefreshTokenLedger {
  /** `fromHash` was spent for `toHash`; `toHash` joins `fromHash`'s family, or starts one. */
  rotated(fromHash: string, toHash: string, family: RefreshFamily, expiresAt: Date): Promise<void>;
  /** A hash's state; undefined when the ledger has never seen it (or it has expired). */
  lookup(
    hash: string,
  ): Promise<{ spent: boolean; revoked: boolean; family: RefreshFamily } | undefined>;
  /** Revoke the family of `hash`: every token in it is refused from now on. */
  revokeFamily(hash: string): Promise<void>;
}

/**
 * Single-process ledger for one API replica, tests and local development. Entries expire with
 * the IdP's absolute refresh lifetime. Several replicas need a shared ledger: on another replica a
 * reused token is still refused by the IdP, as `refresh_invalid`, without revoking the session.
 */
export class MemoryRefreshTokenLedger implements RefreshTokenLedger {
  private readonly hashes = new Map<string, { familyId: string; spent: boolean; until: number }>();
  private readonly families = new Map<
    string,
    { family: RefreshFamily; revoked: boolean; until: number }
  >();

  constructor(private readonly now: () => number = Date.now) {}

  private prune(): void {
    const t = this.now();
    for (const [k, v] of this.hashes) if (v.until <= t) this.hashes.delete(k);
    for (const [k, v] of this.families) if (v.until <= t) this.families.delete(k);
  }

  async rotated(
    fromHash: string,
    toHash: string,
    family: RefreshFamily,
    expiresAt: Date,
  ): Promise<void> {
    this.prune();
    const until = expiresAt.getTime();
    const from = this.hashes.get(fromHash);
    const familyId = from?.familyId ?? newId("rtf");
    const f = this.families.get(familyId);
    this.families.set(familyId, {
      family: { ...family },
      revoked: f?.revoked ?? false,
      until: Math.max(until, f?.until ?? 0),
    });
    this.hashes.set(fromHash, { familyId, spent: true, until: Math.max(until, from?.until ?? 0) });
    this.hashes.set(toHash, { familyId, spent: false, until });
  }

  async lookup(hash: string) {
    const h = this.hashes.get(hash);
    if (!h || h.until <= this.now()) return undefined;
    const f = this.families.get(h.familyId);
    if (!f) return undefined;
    return { spent: h.spent, revoked: f.revoked, family: { ...f.family } };
  }

  async revokeFamily(hash: string): Promise<void> {
    const h = this.hashes.get(hash);
    const f = h && this.families.get(h.familyId);
    if (f) f.revoked = true;
  }
}

// ---- identity-provider brokers (PR-LDC-09, R1-D-78) ---------------------------------------------

/** Resolves a SECRETS reference (`secretsResolver` from `@infrabyx/config` fits). */
export type BrokerSecretResolver = (ref: SecretRef, name: string) => Promise<string>;

/** A broker as an adapter reads it back; `managed` is false for one configured by hand. */
export interface BrokerRecord extends IdentityProviderInfo {
  managed: boolean;
  /** The IdP's own id where it differs from the alias (Zitadel). */
  idpId?: string;
}

/** Validate a broker spec (schema, then the adapter's URL rule) before any call. */
export function parseBrokerSpec(
  raw: unknown,
  adapter: string,
  allowLoopbackHttp = false,
): IdentityProviderConfig {
  const spec = IdentityProviderSpec.parse(raw);
  const url = spec.protocol === "oidc" ? spec.discoveryUrl : spec.metadataUrl;
  if (!idpUrlAllowed(url, allowLoopbackHttp))
    throw new PortError("IPB-SEC-018", "IDENTITY", {
      adapter,
      detail: "an identity provider's discovery or metadata URL must be https",
    });
  return spec;
}

/**
 * Check an upsert against the brokers there are: the alias must be free or this tenant's own
 * managed broker, and no domain may already route to another broker. Returns the one updated.
 */
export function claimBroker(
  spec: IdentityProviderConfig,
  existing: readonly BrokerRecord[],
  adapter: string,
): BrokerRecord | undefined {
  const conflict = (reason: "alias_taken" | "domain_taken", detail: string): never => {
    throw new PortError("IPB-PORT-004", "IDENTITY", {
      adapter,
      detail,
      meta: { reason, definite: true },
    });
  };
  const same = existing.find((b) => b.alias === spec.alias);
  if (same && (!same.managed || same.tenantId !== spec.tenantId))
    conflict("alias_taken", "the alias belongs to another tenant or was configured by hand");
  const wanted = new Set(spec.domains.map((d) => d.domain));
  for (const b of existing)
    if (b.alias !== spec.alias && b.domains.some((d) => wanted.has(d.domain)))
      conflict("domain_taken", "a domain already routes to another identity provider");
  return same;
}

/** The enabled managed broker a sign-in email routes to, by verified domain. */
export function discoverBroker(
  existing: readonly BrokerRecord[],
  email: string,
): { tenantId: string; alias: string } | null {
  const domain = emailDomainOf(email);
  if (!domain) return null;
  const hit = existing.find(
    (b) => b.managed && b.enabled && b.domains.some((d) => d.domain === domain),
  );
  return hit ? { tenantId: hit.tenantId, alias: hit.alias } : null;
}

/** The secret behind an OIDC broker's reference; IPB-PORT-001 without a resolver. */
export async function resolveBrokerSecret(
  spec: IdentityProviderConfig & { protocol: "oidc" },
  resolver: BrokerSecretResolver | undefined,
  adapter: string,
): Promise<string> {
  const ref = parseSecretRef(spec.clientSecretRef);
  if (!resolver || !ref)
    throw new PortError("IPB-PORT-001", "IDENTITY", {
      adapter,
      detail: "no SECRETS resolver is configured for identity-provider client secrets",
      meta: { reason: "not_configured" },
    });
  return resolver(ref, `idp:${spec.alias}`);
}

/** The broker fields reported back: never a secret. */
export function brokerInfo(b: BrokerRecord): IdentityProviderInfo {
  return {
    tenantId: b.tenantId,
    alias: b.alias,
    protocol: b.protocol,
    displayName: b.displayName,
    enabled: b.enabled,
    domains: b.domains.map((d) => ({ ...d })),
    ...(b.discoveryUrl ? { discoveryUrl: b.discoveryUrl } : {}),
    ...(b.clientId ? { clientId: b.clientId } : {}),
    ...(b.metadataUrl ? { metadataUrl: b.metadataUrl } : {}),
  };
}

// ---- verifier -----------------------------------------------------------------------------------

export interface TokenVerifierOptions {
  issuer: string;
  audience: string | readonly string[];
  jwksUrl: string;
  egress: Egress;
  /** The issuer's allow-list (C-12: ES256 on Keycloak and Zitadel). */
  algorithms?: readonly JwsAlgorithm[];
  jwksCacheSeconds?: number;
  revocations?: RevocationStore;
  /** IdP-specific claim shaping before the platform mapping (e.g. Zitadel's URN claims). */
  mapClaims?: (raw: Record<string, unknown>) => Record<string, unknown>;
  now?: () => number;
}

export class TokenVerifier {
  private readonly jwks: JwksCache;

  constructor(private readonly o: TokenVerifierOptions) {
    this.jwks = new JwksCache({
      fetchJwks: async () => {
        const r = await o.egress(o.jwksUrl);
        if (r.status !== 200) throw new Error(`JWKS answered ${r.status}`);
        return r.json<{ keys: unknown[] }>();
      },
      ttlMs: (o.jwksCacheSeconds ?? 86_400) * 1000,
      ...(o.now ? { now: o.now } : {}),
    });
  }

  /** Verify signature and claims (C-11), map to VerifiedClaims, refuse revoked sessions. */
  async verify(jwt: string): Promise<VerifiedClaims> {
    return (await this.verifyWithRaw(jwt)).claims;
  }

  /** As `verify`, with the verified payload as the IdP issued it (e.g. its `cnf`). */
  async verifyWithRaw(
    jwt: string,
  ): Promise<{ claims: VerifiedClaims; raw: Record<string, unknown> }> {
    const { claims } = await verifyJwt(
      jwt,
      {
        issuer: this.o.issuer,
        audience: this.o.audience,
        algorithms: this.o.algorithms ?? ["ES256"],
        resolveKey: this.jwks.resolveKey,
      },
      this.o.now?.() ?? Date.now(),
    );
    const v = toVerifiedClaims(this.o.mapClaims ? this.o.mapClaims(claims) : claims);
    if (await this.o.revocations?.isRevoked(v))
      refused("revoked", "session or user has been revoked");
    return { claims: v, raw: claims };
  }

  /** Verify an OIDC back-channel logout token (Back-Channel Logout 1.0 §2.6); `aud` is the client id. */
  async verifyLogoutToken(jwt: string, clientId: string): Promise<{ sid?: string; sub?: string }> {
    const { claims } = await verifyJwt(
      jwt,
      {
        issuer: this.o.issuer,
        audience: clientId,
        algorithms: this.o.algorithms ?? ["ES256"],
        resolveKey: this.jwks.resolveKey,
      },
      this.o.now?.() ?? Date.now(),
    );
    const events = claims.events as Record<string, unknown> | undefined;
    if (
      !events ||
      typeof events !== "object" ||
      !("http://schemas.openid.net/event/backchannel-logout" in events)
    )
      refused("logout_token", "not a back-channel logout token");
    if ("nonce" in claims) refused("logout_token", "a logout token must not carry a nonce");
    const sid = typeof claims.sid === "string" ? claims.sid : undefined;
    const sub = typeof claims.sub === "string" ? claims.sub : undefined;
    if (!sid && !sub) refused("logout_token", "a logout token names a sid or a sub");
    return { ...(sid ? { sid } : {}), ...(sub ? { sub } : {}) };
  }
}
