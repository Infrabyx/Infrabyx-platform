// Shared IDENTITY behaviour (PL2 plan §6.5). Tokens are verified with the C-11 verifier from
// @infrabyx/crypto under the issuer's own allow-list (ES256 for both IdPs, C-12); claims are mapped
// to the PL1 VerifiedClaims schema; revoked sessions and users are refused on every replica within
// 60 s (IPB-02-05, PL2-D-53); privileged roles without MFA are refused at the API (IPB-02-02).
import { IpbError } from "@infrabyx/contracts/errors";
import type { AuditSink, KernelContext, MutationKernel } from "@infrabyx/contracts/kernel";
import { VerifiedClaims, mfaRequired, RoleSchema } from "@infrabyx/contracts";
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

/** IPB-02-02 at the API guard: a privileged role without MFA in this session is IPB-SEC-001. */
export function assertMfaForRoles(claims: VerifiedClaims): void {
  if (mfaRequired(claims.roles) && claims.mfa !== true)
    throw new IpbError("IPB-SEC-001", { detail: "this role requires multi-factor authentication" });
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
