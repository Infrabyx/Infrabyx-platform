// IDENTITY contract cases and fakes for the 1.x additions to the workforce port (LawDocsComply).
// The refresh-token grant with rotation and reuse detection (PR-LDC-03, R1-D-77): every adapter
// passes the same cases against something that can sign a user in. The fake signs in itself;
// Keycloak and Zitadel run them in their hermetic legs (CI) after a real login. Identity-provider
// brokers and domain discovery (PR-LDC-09, R1-D-78): the same cases against the fake and both
// IdPs, with a client secret given by SECRETS reference only.
// IDENTITY contract cases and fakes for the 1.x additions to the workforce port (LawDocsComply).
// The refresh-token grant with rotation and reuse detection (PR-LDC-03, R1-D-77): every adapter
// passes the same cases against something that can sign a user in. The fake signs in itself;
// Keycloak and Zitadel run them in their hermetic legs (CI) after a real login. Identity-provider
// brokers and domain discovery (PR-LDC-09, R1-D-78): the same cases against the fake and both
// IdPs, with a client secret given by SECRETS reference only.
import { expect } from "vitest";
import type { IdentityBrokerAdmin, IdentitySessionRefresh } from "@infrabyx/contracts/ports";
import { randomBytes, toHex } from "@infrabyx/crypto";
import type { ContractCase } from "../contract.js";
import { type IdentityRefreshFixtures, type IdentityBrokerFixtures } from "@infrabyx/fakes";
export {
  type IdentityRefreshFixtures,
  FakeIdentitySessions,
  type IdentityBrokerFixtures,
  FakeIdentityBrokers,
  FAKE_BROKER_SIGN_IN,
} from "@infrabyx/fakes";

export interface IdentityRefreshCaseOptions {
  /**
   * Pause between issuing a token and presenting the next one. IdPs compare token issue times in
   * whole seconds (Keycloak's stale-token rule), so hermetic legs pass about 1 100 ms; 0 for fakes.
   */
  pauseMs?: number;
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
