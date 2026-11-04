// IDENTITY contract cases and fakes for the 1.x additions to the workforce port (LawDocsComply).
// The refresh-token grant with rotation and reuse detection (PR-LDC-03, R1-D-77): every adapter
// passes the same cases against something that can sign a user in. The fake signs in itself;
// Keycloak and Zitadel run them in their hermetic legs (CI) after a real login. Identity-provider
// brokers and domain discovery (PR-LDC-09, R1-D-78): the same cases against the fake and both
// IdPs, with a client secret given by SECRETS reference only.
import { expect } from "vitest";
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
import type { ContractCase } from "../contract.js";

// ---- refresh-token grant ------------------------------------------------------------------------

/** Signs a user in and returns the session's first refresh token. */
export interface IdentityRefreshFixtures {
  signIn(): Promise<{ refreshToken: string }>;
}

export interface IdentityRefreshCaseOptions {
  /**
   * Pause between issuing a token and presenting the next one. IdPs compare token issue times in
   * whole seconds (Keycloak's stale-token rule), so hermetic legs pass about 1 100 ms; 0 for fakes.
   */
  pauseMs?: number;
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

const pause = (ms: number) =>
  ms > 0 ? new Promise<void>((r) => setTimeout(r, ms)) : Promise.resolve();

/** The refusal of a refresh, with what it exposes (code, reason, every text it carries). */
async function refusal(
  p: IdentitySessionRefresh,
  refreshToken: string,
): Promise<{ code: unknown; reason: unknown; text: string }> {
  try {
    await p.refreshSession({ refreshToken });
  } catch (e) {
    const x = e as { code?: unknown; message?: unknown; detail?: unknown; meta?: unknown };
    return {
      code: x.code,
      reason: (x.meta as { reason?: unknown } | undefined)?.reason,
      text: JSON.stringify([x.message, x.detail, x.meta]),
    };
  }
  throw new Error("the refresh was accepted");
}

export function identityRefreshContractCases(
  f: IdentityRefreshFixtures,
  o: IdentityRefreshCaseOptions = {},
): ContractCase<IdentitySessionRefresh>[] {
  const wait = () => pause(o.pauseMs ?? 0);
  return [
    {
      name: "refreshSession rotates: a new refresh token and a verifiable access token (PR-LDC-03)",
      method: "refreshSession",
      invoke: (p) => p.refreshSession({ refreshToken: "not-a-refresh-token" }),
      async run(p) {
        const { refreshToken } = await f.signIn();
        await wait();
        const r1 = await p.refreshSession({ refreshToken });
        expect(r1.refreshToken).toBeTruthy();
        expect(r1.refreshToken).not.toBe(refreshToken);
        expect(r1.expiresIn).toBeGreaterThan(0);
        const c = await p.verifyToken(r1.accessToken);
        expect(c.sub).toBeTruthy();
        await wait();
        // The new token rotates in turn.
        const r2 = await p.refreshSession({ refreshToken: r1.refreshToken });
        expect(r2.refreshToken).not.toBe(r1.refreshToken);
        expect((await p.verifyToken(r2.accessToken)).sub).toBe(c.sub);
      },
    },
    {
      name: "a spent refresh token presented again revokes the session: IPB-IDN-001 refresh_reused; its successor fails too (R1-D-77)",
      method: "refreshSession",
      invoke: (p) => p.refreshSession({ refreshToken: "not-a-refresh-token" }),
      async run(p) {
        const { refreshToken } = await f.signIn();
        await wait();
        const r1 = await p.refreshSession({ refreshToken });
        await p.verifyToken(r1.accessToken);
        await wait();
        const reused = await refusal(p, refreshToken);
        expect(reused).toMatchObject({ code: "IPB-IDN-001", reason: "refresh_reused" });
        // Refresh tokens never travel in an error (nor, therefore, in a log of it).
        expect(reused.text).not.toContain(refreshToken);
        await wait();
        const successor = await refusal(p, r1.refreshToken);
        expect(successor.code).toBe("IPB-IDN-001");
        expect(successor.text).not.toContain(r1.refreshToken);
        // The session's access tokens are refused too (IPB-02-05).
        await expect(p.verifyToken(r1.accessToken)).rejects.toMatchObject({
          code: "IPB-IDN-001",
        });
      },
    },
    {
      name: "an unknown refresh token is refused as refresh_invalid, not as a reuse",
      method: "refreshSession",
      invoke: (p) => p.refreshSession({ refreshToken: "not-a-refresh-token" }),
      async run(p) {
        expect(await refusal(p, "not-a-refresh-token")).toMatchObject({
          code: "IPB-IDN-001",
          reason: "refresh_invalid",
        });
        expect(await refusal(p, "")).toMatchObject({
          code: "IPB-IDN-001",
          reason: "refresh_invalid",
        });
        // An unrelated session is untouched by those refusals.
        const { refreshToken } = await f.signIn();
        await wait();
        const r = await p.refreshSession({ refreshToken });
        await p.verifyToken(r.accessToken);
      },
    },
  ];
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

const unique = () => toHex(randomBytes(4));

export function identityBrokerContractCases(
  f: IdentityBrokerFixtures,
): ContractCase<IdentityBrokerAdmin>[] {
  const [tenantA, tenantB] = f.tenants;
  const verifiedAt = "2026-11-01T00:00:00Z";
  const oidc = (alias: string, extra: Record<string, unknown> = {}) => ({
    tenantId: tenantA,
    alias,
    protocol: "oidc" as const,
    displayName: "Tenant SSO",
    discoveryUrl: f.oidc.discoveryUrl,
    clientId: f.oidc.clientId,
    clientSecretRef: f.oidc.clientSecretRef,
    ...extra,
  });
  const invoke = (p: IdentityBrokerAdmin) => p.listIdentityProviders(tenantA);
  return [
    {
      name: "upsertIdentityProvider creates a tenant's OIDC broker and updates it in place; no secret is ever returned (PR-LDC-09)",
      method: "upsertIdentityProvider",
      invoke,
      async run(p) {
        const alias = `ctr-${unique()}`;
        expect(await p.upsertIdentityProvider(oidc(alias))).toEqual({ alias, created: true });
        const listed = await p.listIdentityProviders(tenantA);
        expect(listed.find((b) => b.alias === alias)).toMatchObject({
          tenantId: tenantA,
          alias,
          protocol: "oidc",
          displayName: "Tenant SSO",
          enabled: true,
          domains: [],
          clientId: f.oidc.clientId,
          discoveryUrl: f.oidc.discoveryUrl,
        });
        expect(JSON.stringify(listed)).not.toContain(f.oidc.secretValue);
        expect(
          await p.upsertIdentityProvider(oidc(alias, { displayName: "Tenant SSO (renamed)" })),
        ).toEqual({ alias, created: false });
        const again = await p.listIdentityProviders(tenantA);
        expect(again.filter((b) => b.alias === alias)).toHaveLength(1);
        expect(again.find((b) => b.alias === alias)?.displayName).toBe("Tenant SSO (renamed)");
        expect((await p.listIdentityProviders(tenantB)).some((b) => b.alias === alias)).toBe(false);
      },
    },
    {
      name: "a literal client secret, a reference that is not secret://, a bad alias or a URL that is not https discovery are refused before any change",
      method: "upsertIdentityProvider",
      invoke,
      async run(p) {
        const alias = `ctr-${unique()}`;
        const bad: Array<Record<string, unknown>> = [
          oidc(alias, { clientSecret: f.oidc.secretValue }),
          oidc(alias, { clientSecretRef: f.oidc.secretValue }),
          oidc("Not_An_Alias"),
          oidc(alias, { discoveryUrl: "https://idp.example.test/authorize" }),
          oidc(alias, { discoveryUrl: "http://idp.example.test/.well-known/openid-configuration" }),
          oidc(alias, { domains: [{ domain: "example.test" }] }),
        ];
        for (const spec of bad)
          await expect(p.upsertIdentityProvider(spec as never)).rejects.toThrow();
        expect((await p.listIdentityProviders(tenantA)).some((b) => b.alias === alias)).toBe(false);
      },
    },
    {
      name: "another tenant can neither take over nor remove a broker (IPB-PORT-004 alias_taken)",
      method: "upsertIdentityProvider",
      invoke,
      async run(p) {
        const alias = `ctr-${unique()}`;
        await p.upsertIdentityProvider(oidc(alias));
        await expect(
          p.upsertIdentityProvider(oidc(alias, { tenantId: tenantB })),
        ).rejects.toMatchObject({ code: "IPB-PORT-004", meta: { reason: "alias_taken" } });
        expect(await p.removeIdentityProvider(tenantB, alias)).toEqual({ removed: false });
        expect((await p.listIdentityProviders(tenantA)).some((b) => b.alias === alias)).toBe(true);
      },
    },
    {
      name: "discovery routes a verified domain to its tenant's enabled broker only; a domain routes to one broker (domain_taken)",
      method: "discoverIdentityProvider",
      invoke: (p) => p.discoverIdentityProvider("someone@example.test"),
      async run(p) {
        const alias = `ctr-${unique()}`;
        const domain = `sso-${unique()}.example.test`;
        await p.upsertIdentityProvider(oidc(alias, { domains: [{ domain, verifiedAt }] }));
        expect(await p.discoverIdentityProvider(`Asha.Rao@${domain.toUpperCase()}`)).toEqual({
          tenantId: tenantA,
          alias,
        });
        expect(await p.discoverIdentityProvider(`asha@other-${unique()}.example.test`)).toBeNull();
        expect(await p.discoverIdentityProvider("not an email")).toBeNull();
        const other = `ctr-${unique()}`;
        await expect(
          p.upsertIdentityProvider(
            oidc(other, { tenantId: tenantB, domains: [{ domain, verifiedAt }] }),
          ),
        ).rejects.toMatchObject({ code: "IPB-PORT-004", meta: { reason: "domain_taken" } });
        // A disabled broker keeps its domain but no longer routes.
        await p.upsertIdentityProvider(
          oidc(alias, { enabled: false, domains: [{ domain, verifiedAt }] }),
        );
        expect(await p.discoverIdentityProvider(`asha@${domain}`)).toBeNull();
        expect(
          (await p.listIdentityProviders(tenantA)).find((b) => b.alias === alias),
        ).toMatchObject({ enabled: false, domains: [{ domain, verifiedAt }] });
      },
    },
    ...(f.saml
      ? [
          {
            name: "upsertIdentityProvider registers a SAML broker from its metadata URL",
            method: "upsertIdentityProvider",
            invoke,
            async run(p: IdentityBrokerAdmin) {
              const alias = `ctr-${unique()}`;
              expect(
                await p.upsertIdentityProvider({
                  tenantId: tenantA,
                  alias,
                  protocol: "saml",
                  displayName: "Tenant SAML",
                  metadataUrl: f.saml!.metadataUrl,
                }),
              ).toEqual({ alias, created: true });
              expect(
                (await p.listIdentityProviders(tenantA)).find((b) => b.alias === alias),
              ).toMatchObject({ protocol: "saml", metadataUrl: f.saml!.metadataUrl });
            },
          },
        ]
      : []),
    {
      name: "brokers are linking only: an unknown user signing in through a broker is refused; an existing account of the broker's tenant is linked (R1-D-78)",
      method: "upsertIdentityProvider",
      invoke,
      async run(p) {
        const alias = `ctr-${unique()}`;
        await p.upsertIdentityProvider(oidc(alias));
        expect(await f.brokerSignIn(p, alias, { email: `unknown-${unique()}@example.test` })).toBe(
          "refused",
        );
        expect(
          await f.brokerSignIn(p, alias, {
            email: `member-${unique()}@example.test`,
            existingIn: tenantA,
          }),
        ).toBe("linked");
      },
    },
    ...(f.brokeredSession
      ? [
          {
            name: "a broker never reaches another tenant's account: such a session is refused (R1-D-78)",
            method: "upsertIdentityProvider",
            invoke,
            async run(p: IdentityBrokerAdmin) {
              const alias = `ctr-${unique()}`;
              await p.upsertIdentityProvider(oidc(alias));
              expect(await f.brokeredSession!(p, alias, tenantA)).toBe("accepted");
              expect(await f.brokeredSession!(p, alias, tenantB)).toBe("refused");
            },
          },
        ]
      : []),
    {
      name: "removeIdentityProvider removes the broker and its routing; removing again is a no-op",
      method: "removeIdentityProvider",
      invoke: (p) => p.removeIdentityProvider(tenantA, "ctr-absent"),
      async run(p) {
        const alias = `ctr-${unique()}`;
        const domain = `rm-${unique()}.example.test`;
        await p.upsertIdentityProvider(oidc(alias, { domains: [{ domain, verifiedAt }] }));
        expect(await p.discoverIdentityProvider(`a@${domain}`)).not.toBeNull();
        expect(await p.removeIdentityProvider(tenantA, alias)).toEqual({ removed: true });
        expect((await p.listIdentityProviders(tenantA)).some((b) => b.alias === alias)).toBe(false);
        expect(await p.discoverIdentityProvider(`a@${domain}`)).toBeNull();
        expect(await p.removeIdentityProvider(tenantA, alias)).toEqual({ removed: false });
        // The domain is free again.
        await p.upsertIdentityProvider(
          oidc(`ctr-${unique()}`, { tenantId: tenantB, domains: [{ domain, verifiedAt }] }),
        );
      },
    },
  ];
}
