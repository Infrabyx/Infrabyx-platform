// The broker spec of the IDENTITY port (LawDocsComply PR-LDC-09; R1-D-78): a client secret by
// SECRETS reference only, verified domains, and the URL rule adapters apply.
import { describe, expect, it } from "vitest";
import { emailDomainOf, IdentityProviderSpec, idpUrlAllowed } from "./identity.js";

const oidc = {
  tenantId: "tnt_a",
  alias: "acme-sso",
  protocol: "oidc",
  displayName: "Acme SSO",
  discoveryUrl: "https://sso.example.test/.well-known/openid-configuration",
  clientId: "acme",
  clientSecretRef: "secret://aws-sm/infrabyx/ldc/prod/idp-acme#client_secret",
};

describe("IdentityProviderSpec", () => {
  it("fills the defaults and lower-cases domains", () => {
    expect(
      IdentityProviderSpec.parse({
        ...oidc,
        domains: [{ domain: " Acme.Example.IN ", verifiedAt: "2026-11-01T10:00:00+05:30" }],
      }),
    ).toMatchObject({
      enabled: true,
      scopes: ["openid", "email", "profile"],
      domains: [{ domain: "acme.example.in" }],
    });
  });

  it("refuses a literal secret, a non-reference, an unknown key and a bad alias", () => {
    for (const bad of [
      { ...oidc, clientSecret: "s3cret" },
      { ...oidc, clientSecretRef: "s3cret" },
      { ...oidc, alias: "Acme_SSO" },
      { ...oidc, alias: "a" },
      { ...oidc, discoveryUrl: "https://sso.example.test/" },
      { ...oidc, domains: [{ domain: "example", verifiedAt: "2026-11-01T00:00:00Z" }] },
      { ...oidc, domains: [{ domain: "acme.example.in" }] },
      { ...oidc, protocol: "saml" },
    ])
      expect(IdentityProviderSpec.safeParse(bad).success).toBe(false);
    expect(
      IdentityProviderSpec.safeParse({
        tenantId: "tnt_a",
        alias: "acme-saml",
        protocol: "saml",
        displayName: "Acme",
        metadataUrl: "https://sso.example.test/saml/metadata",
      }).success,
    ).toBe(true);
  });

  it("emailDomainOf and idpUrlAllowed", () => {
    expect(emailDomainOf("Asha.Rao@Acme.Example.IN")).toBe("acme.example.in");
    expect(emailDomainOf("a@b@acme.example.in")).toBe("acme.example.in");
    expect(emailDomainOf("not an email")).toBeNull();
    expect(emailDomainOf("@acme.example.in")).toBeNull();
    expect(idpUrlAllowed("https://sso.example.test/x")).toBe(true);
    expect(idpUrlAllowed("http://sso.example.test/x")).toBe(false);
    expect(idpUrlAllowed("http://localhost:8080/x")).toBe(false);
    expect(idpUrlAllowed("http://localhost:8080/x", true)).toBe(true);
    expect(idpUrlAllowed("http://sso.example.test/x", true)).toBe(false);
  });
});
