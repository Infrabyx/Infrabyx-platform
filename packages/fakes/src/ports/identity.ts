// IDENTITY contract cases and fakes for the 1.x additions to the workforce port (LawDocsComply).
// The refresh-token grant with rotation and reuse detection (PR-LDC-03, R1-D-77): every adapter
// passes the same cases against something that can sign a user in. The fake signs in itself;
// Keycloak and Zitadel run them in their hermetic legs (CI) after a real login. Identity-provider
// brokers and domain discovery (PR-LDC-09, R1-D-78): the same cases against the fake and both
// IdPs, with a client secret given by SECRETS reference only.
import { IpbError, PortError } from "@infrabyx/contracts/errors";
import {
  emailDomainOf,
  IdentityProviderSpec,
  IdpAlias,
  idpUrlAllowed,
  parseSecretRef,
  type AdapterDescriptor,
  type IdentityBrokerAdmin,
  type IdentityProviderConfig,
  type IdentityProviderInfo,
  type IdentitySessionRefresh,
  type PortHealth,
  type RefreshedTokens,
  type SecretRef,
  type VerifiedClaims,
} from "@infrabyx/contracts/ports";
import { randomBytes, sha256Hex, toHex } from "@infrabyx/crypto";

// ---- refresh-token grant ------------------------------------------------------------------------

/** Signs a user in and returns the session's first refresh token. */
export interface IdentityRefreshFixtures {
  signIn(): Promise<{ refreshToken: string }>;
}

const refused = (reason: string, detail: string) =>
  new IpbError("IPB-IDN-001", { detail, meta: { reason } });

/**
 * In-memory refresh grant with rotation: tokens are random and remembered by SHA-256 only; a
 * spent token presented again revokes its session (its access tokens and current refresh token).
 */
export class FakeIdentitySessions implements IdentitySessionRefresh, IdentityRefreshFixtures {
  readonly descriptor: AdapterDescriptor = {
    port: "IDENTITY",
    adapter: "fake-identity",
    residency: "IN",
    maxDataClass: "CONFIDENTIAL",
  };
  private readonly refresh = new Map<string, { sid: string; spent: boolean }>();
  private readonly access = new Map<string, { sid: string; iat: number }>();
  private readonly sessions = new Map<
    string,
    { tenantId: string; userId: string; revoked: boolean }
  >();
  down = false;

  constructor(private readonly now: () => number = Date.now) {}

  private mint(sid: string): RefreshedTokens {
    const refreshToken = `fake-rt.${toHex(randomBytes(24))}`;
    const accessToken = `fake-at.${toHex(randomBytes(24))}`;
    this.refresh.set(sha256Hex(refreshToken), { sid, spent: false });
    this.access.set(accessToken, { sid, iat: Math.floor(this.now() / 1000) });
    return { accessToken, refreshToken, expiresIn: 300 };
  }

  async signIn(o: { tenantId?: string; userId?: string } = {}): Promise<RefreshedTokens> {
    const sid = `sid-${toHex(randomBytes(8))}`;
    this.sessions.set(sid, {
      tenantId: o.tenantId ?? "tnt_fake",
      userId: o.userId ?? `usr-${toHex(randomBytes(6))}`,
      revoked: false,
    });
    return this.mint(sid);
  }

  /** Whether a session has been revoked (test assertions). */
  isRevoked(sid: string): boolean {
    return this.sessions.get(sid)?.revoked ?? false;
  }

  async health(): Promise<PortHealth> {
    return {
      status: this.down ? "down" : "up",
      latency_ms: 0,
      checked_at: new Date().toISOString(),
    };
  }

  async refreshSession(req: { refreshToken: string }): Promise<RefreshedTokens> {
    if (this.down)
      throw new IpbError("IPB-IDN-002", { detail: "identity provider unavailable for refresh" });
    const t = req.refreshToken ? this.refresh.get(sha256Hex(req.refreshToken)) : undefined;
    const s = t && this.sessions.get(t.sid);
    if (!t || !s || s.revoked) throw refused("refresh_invalid", "the refresh token was refused");
    if (t.spent) {
      s.revoked = true;
      throw refused(
        "refresh_reused",
        "a spent refresh token was presented again; the session is revoked",
      );
    }
    t.spent = true;
    return this.mint(t.sid);
  }

  async verifyToken(jwt: string): Promise<VerifiedClaims> {
    const a = this.access.get(jwt);
    const s = a && this.sessions.get(a.sid);
    if (!a || !s) throw refused("signature", "not a token of this identity provider");
    if (s.revoked) throw refused("revoked", "session or user has been revoked");
    return {
      sub: s.userId,
      tid: s.tenantId,
      typ: "user",
      roles: [],
      sid: a.sid,
      iat: a.iat,
      exp: a.iat + 300,
    };
  }
}

// ---- identity-provider brokers ------------------------------------------------------------------

export interface IdentityBrokerFixtures {
  /** Two tenants of the product. */
  tenants: readonly [string, string];
  /** An OIDC IdP the adapter can register; `secretValue` is what `clientSecretRef` resolves to. */
  oidc: { discoveryUrl: string; clientId: string; clientSecretRef: string; secretValue: string };
  /** A SAML metadata URL the IdP can read; omitted where the leg has none. */
  saml?: { metadataUrl: string };
  /**
   * A first sign-in through broker `alias` by an identity whose email has an account in tenant
   * `existingIn`, or none: what the IdP does, `linked` or `refused` (linking only, R1-D-78). Legs
   * that cannot drive a brokered login answer from the IdP's configuration of the broker (its
   * first-login flow or provider options).
   */
  brokerSignIn(
    p: IdentityBrokerAdmin,
    alias: string,
    user: { email: string; existingIn?: string },
  ): Promise<"linked" | "refused">;
  /**
   * A session of an account in tenant `accountTenant` signed in through broker `alias`: does the
   * adapter accept it? Omitted where the leg cannot mint such a session (hermetic legs).
   */
  brokeredSession?(
    p: IdentityBrokerAdmin,
    alias: string,
    accountTenant: string,
  ): Promise<"accepted" | "refused">;
}

type Broker = IdentityProviderInfo & { secretRef?: string };

/**
 * In-memory brokers with the port's rules: owner tenant per alias, one broker per domain,
 * discovery by verified domain to enabled brokers, the client secret resolved (to prove the
 * reference is good) and never kept or returned.
 */
export class FakeIdentityBrokers implements IdentityBrokerAdmin {
  readonly descriptor: AdapterDescriptor = {
    port: "IDENTITY",
    adapter: "fake-identity-brokers",
    residency: "IN",
    maxDataClass: "CONFIDENTIAL",
  };
  private readonly brokers = new Map<string, Broker>();
  /** Names of the references resolved, in order (never the values). */
  readonly resolved: string[] = [];

  constructor(private readonly resolveSecret?: (ref: SecretRef, name: string) => Promise<string>) {}

  async health(): Promise<PortHealth> {
    return { status: "up", latency_ms: 0, checked_at: new Date().toISOString() };
  }

  async upsertIdentityProvider(
    raw: Parameters<IdentityBrokerAdmin["upsertIdentityProvider"]>[0],
  ): Promise<{ alias: string; created: boolean }> {
    const spec: IdentityProviderConfig = IdentityProviderSpec.parse(raw);
    const url = spec.protocol === "oidc" ? spec.discoveryUrl : spec.metadataUrl;
    if (!idpUrlAllowed(url))
      throw new PortError("IPB-SEC-018", "IDENTITY", {
        adapter: this.descriptor.adapter,
        detail: "an identity provider's discovery or metadata URL must be https",
      });
    const conflict = (reason: string) =>
      new PortError("IPB-PORT-004", "IDENTITY", {
        adapter: this.descriptor.adapter,
        meta: { reason, definite: true },
      });
    const same = this.brokers.get(spec.alias);
    if (same && same.tenantId !== spec.tenantId) throw conflict("alias_taken");
    const wanted = new Set(spec.domains.map((d) => d.domain));
    for (const b of this.brokers.values())
      if (b.alias !== spec.alias && b.domains.some((d) => wanted.has(d.domain)))
        throw conflict("domain_taken");
    if (spec.protocol === "oidc") {
      const ref = parseSecretRef(spec.clientSecretRef);
      if (!this.resolveSecret || !ref)
        throw new PortError("IPB-PORT-001", "IDENTITY", {
          adapter: this.descriptor.adapter,
          meta: { reason: "not_configured" },
        });
      await this.resolveSecret(ref, `idp:${spec.alias}`);
      this.resolved.push(`idp:${spec.alias}`);
    }
    this.brokers.set(spec.alias, {
      tenantId: spec.tenantId,
      alias: spec.alias,
      protocol: spec.protocol,
      displayName: spec.displayName,
      enabled: spec.enabled,
      domains: spec.domains.map((d) => ({ ...d })),
      ...(spec.protocol === "oidc"
        ? { discoveryUrl: spec.discoveryUrl, clientId: spec.clientId }
        : { metadataUrl: spec.metadataUrl }),
    });
    return { alias: spec.alias, created: !same };
  }

  async removeIdentityProvider(tenantId: string, alias: string): Promise<{ removed: boolean }> {
    const b = IdpAlias.safeParse(alias).success ? this.brokers.get(alias) : undefined;
    if (!b || b.tenantId !== tenantId) return { removed: false };
    this.brokers.delete(alias);
    return { removed: true };
  }

  async listIdentityProviders(tenantId: string): Promise<IdentityProviderInfo[]> {
    return [...this.brokers.values()]
      .filter((b) => b.tenantId === tenantId)
      .map((b) => structuredClone(b));
  }

  async discoverIdentityProvider(
    email: string,
  ): Promise<{ tenantId: string; alias: string } | null> {
    const domain = emailDomainOf(email);
    if (!domain) return null;
    const hit = [...this.brokers.values()].find(
      (b) => b.enabled && b.domains.some((d) => d.domain === domain),
    );
    return hit ? { tenantId: hit.tenantId, alias: hit.alias } : null;
  }

  /**
   * The fake's brokered login, linking only: an identity without an account, or whose account is
   * in another tenant than the broker's, is refused; nothing is ever created.
   */
  async signInThroughBroker(
    alias: string,
    user: { email: string; existingIn?: string },
  ): Promise<"linked" | "refused"> {
    const b = this.brokers.get(alias);
    if (!b?.enabled || user.existingIn === undefined || user.existingIn !== b.tenantId)
      return "refused";
    return "linked";
  }
}

/** Fixtures that let the fake answer the brokered-login cases itself. */
export const FAKE_BROKER_SIGN_IN: Pick<IdentityBrokerFixtures, "brokerSignIn" | "brokeredSession"> =
  {
    brokerSignIn: (p, alias, user) => (p as FakeIdentityBrokers).signInThroughBroker(alias, user),
    brokeredSession: async (p, alias, accountTenant) =>
      (await (p as FakeIdentityBrokers).signInThroughBroker(alias, {
        email: "someone@example.test",
        existingIn: accountTenant,
      })) === "linked"
        ? "accepted"
        : "refused",
  };
