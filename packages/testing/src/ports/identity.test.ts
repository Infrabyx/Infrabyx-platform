// The IDENTITY fakes pass their own contract cases (LawDocsComply PR-LDC-03 and PR-LDC-09;
// R1-D-77, R1-D-78).
import { describe, expect, it } from "vitest";
import { defineContractSuite } from "../contract.js";
import {
  FAKE_BROKER_SIGN_IN,
  FakeIdentityBrokers,
  FakeIdentitySessions,
  identityBrokerContractCases,
  identityRefreshContractCases,
} from "./identity.js";

const sessions = new FakeIdentitySessions();
defineContractSuite("IDENTITY", () => sessions, identityRefreshContractCases(sessions));

const SECRET = "fake-idp-client-secret";
const brokers = new FakeIdentityBrokers(async (ref) => {
  if (ref.adapter !== "memory" || ref.key !== "client_secret") throw new Error("unknown secret");
  return SECRET;
});
defineContractSuite(
  "IDENTITY",
  () => brokers,
  identityBrokerContractCases({
    tenants: ["tnt_a", "tnt_b"],
    oidc: {
      discoveryUrl: "https://sso.example.test/.well-known/openid-configuration",
      clientId: "tenant-a-client",
      clientSecretRef: "secret://memory/idp/tenant-a#client_secret",
      secretValue: SECRET,
    },
    saml: { metadataUrl: "https://sso.example.test/saml/metadata" },
    ...FAKE_BROKER_SIGN_IN,
  }),
);

describe("FakeIdentityBrokers", () => {
  it("resolves the reference without keeping the secret; refuses OIDC without a resolver", async () => {
    const spec = {
      tenantId: "tnt_a",
      alias: "acme-sso",
      protocol: "oidc" as const,
      displayName: "Acme",
      discoveryUrl: "https://sso.example.test/.well-known/openid-configuration",
      clientId: "c",
      clientSecretRef: "secret://memory/idp/acme#client_secret",
    };
    const f = new FakeIdentityBrokers(async () => SECRET);
    await f.upsertIdentityProvider(spec);
    expect(f.resolved).toEqual(["idp:acme-sso"]);
    expect(JSON.stringify(await f.listIdentityProviders("tnt_a"))).not.toContain(SECRET);
    await expect(new FakeIdentityBrokers().upsertIdentityProvider(spec)).rejects.toMatchObject({
      code: "IPB-PORT-001",
    });
  });
});

describe("FakeIdentitySessions", () => {
  it("keeps hashes only: a reuse revokes the session it belongs to and no other", async () => {
    const f = new FakeIdentitySessions();
    const a = await f.signIn({ tenantId: "tnt_a", userId: "u-a" });
    const b = await f.signIn({ tenantId: "tnt_a", userId: "u-b" });
    const a1 = await f.refreshSession({ refreshToken: a.refreshToken });
    const sid = (await f.verifyToken(a1.accessToken)).sid!;
    await expect(f.refreshSession({ refreshToken: a.refreshToken })).rejects.toMatchObject({
      code: "IPB-IDN-001",
      meta: { reason: "refresh_reused" },
    });
    expect(f.isRevoked(sid)).toBe(true);
    const kept = [...(f as unknown as { refresh: Map<string, unknown> }).refresh.keys()];
    expect(kept).not.toContain(a.refreshToken);
    expect(kept.every((k) => /^[0-9a-f]{64}$/.test(k))).toBe(true);
    const b1 = await f.refreshSession({ refreshToken: b.refreshToken });
    expect((await f.verifyToken(b1.accessToken)).sub).toBe("u-b");
  });

  it("an unreachable IdP is IPB-IDN-002", async () => {
    const f = new FakeIdentitySessions();
    const a = await f.signIn();
    f.down = true;
    await expect(f.refreshSession({ refreshToken: a.refreshToken })).rejects.toMatchObject({
      code: "IPB-IDN-002",
    });
    expect((await f.health()).status).toBe("down");
  });
});
