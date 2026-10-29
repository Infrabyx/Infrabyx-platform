// IDENTITY hermetic leg, customer sign-in on Keycloak 26.8.1 with the `ipb-customer-otp` extension
// (R1-D-19): the image is built from infra/keycloak/customer-otp (the pinned Keycloak plus the
// extension compiled against its own jars), the customer realm is applied with
// `applyCustomerRealm`, and the shared customer cases run against it. Then the realm read-back,
// the extension's own refusals, and the refusal of a realm without the extension.
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CustomerIdentityPort } from "@infrabyx/contracts/ports";
import { generateSeedPassword, MemoryReplayStore } from "@infrabyx/crypto";
import { defineContractSuite, startService, type StartedService } from "@infrabyx/testing";
import { MemoryRevocationStore } from "../common.js";
import { customerIdentitySettings, MemoryCustomerAuthStore } from "../customer.js";
import {
  KeycloakCustomerIdentity,
  keycloakCustomerRealmSettings,
  keycloakCustomerUsername,
} from "../keycloak-customer.js";
import { capturingSender, testDevice } from "./dpop-device.js";
import { customerCases } from "./customer.cases.js";

const REALM = "ipb-customers";
const ROLES = ["IPB_CUSTOMER"] as const;
const admin = { username: "ipb-bootstrap", password: generateSeedPassword() };
const context = fileURLToPath(
  new URL("../../../../../infra/keycloak/customer-otp", import.meta.url),
);

let kc: StartedService;
let base = "";
let secrets = { clientSecret: "", adminClientSecret: "" };
const store = new MemoryCustomerAuthStore();
const replay = new MemoryReplayStore();
const revocations = new MemoryRevocationStore();
const mail = capturingSender();
const spec = {
  realm: REALM,
  apiClientId: "ipb-customer-api",
  adminClientId: "ipb-customer-admin",
  audience: "ipb-customer-api",
  customerRoles: ROLES,
};

beforeAll(async () => {
  kc = await startService("keycloak", {
    ports: [8080],
    env: {
      KC_BOOTSTRAP_ADMIN_USERNAME: admin.username,
      KC_BOOTSTRAP_ADMIN_PASSWORD: admin.password,
    },
    command: ["start-dev"],
    readyLog: /Listening on/,
    build: { context },
    configure: (c) => c.withStartupTimeout(240_000),
  });
  base = `http://${kc.host}:${kc.ports[8080]}`;
  secrets = await KeycloakCustomerIdentity.applyCustomerRealm({
    baseUrl: base,
    masterAdmin: admin,
    allowLoopbackHttp: true,
    spec,
  });
});
afterAll(async () => {
  await kc?.stop();
});

const adapter = () =>
  new KeycloakCustomerIdentity({
    baseUrl: base,
    realm: REALM,
    clientId: spec.apiClientId,
    clientSecret: secrets.clientSecret,
    adminClientId: spec.adminClientId,
    adminClientSecret: secrets.adminClientSecret,
    audience: spec.audience,
    store,
    replay,
    revocations,
    sender: mail.sender,
    customerRoles: ROLES,
    allowLoopbackHttp: true,
  });

describe("@IPB-01-15 IDENTITY hermetic leg: customer sign-in on keycloak 26.8.1 + ipb-customer-otp", () => {
  defineContractSuite<CustomerIdentityPort>(
    "IDENTITY",
    adapter,
    [
      {
        name: "customer realm settings read back equal to the customer profile (IPB-02-03, C-12)",
        async run(p) {
          expect(await (p as KeycloakCustomerIdentity).readRealmSettings()).toStrictEqual(
            keycloakCustomerRealmSettings(customerIdentitySettings()),
          );
        },
      },
      ...customerCases({ inbox: mail.inbox, nativeBinding: true, roles: ROLES, pauseMs: 1_200 }),
    ],
    { leg: "hermetic" },
  );

  const token = (form: Record<string, string>, dpop?: string) =>
    fetch(`${base}/realms/${REALM}/protocol/openid-connect/token`, {
      method: "POST",
      headers: dpop ? { dpop } : {},
      body: new URLSearchParams(form),
    });
  const htu = () => `${base}/realms/${REALM}/protocol/openid-connect/token`;

  it("the extension: no code without the API client's secret, without DPoP, or for a public client", async () => {
    const p = adapter();
    const login = "+919800001234";
    // Creates the account through the adapter, then talks to the token endpoint directly.
    await p
      .startChallenge({
        tenantId: "tnt_x",
        channel: "sms",
        login,
        dpopProof: testDevice().proof("POST", htu()),
      })
      .catch(() => undefined);
    const username = keycloakCustomerUsername("tnt_x", login);
    const r1 = await token(
      { grant_type: "password", client_id: spec.apiClientId, username, ipb_otp_step: "send" },
      testDevice().proof("POST", htu()),
    );
    expect(r1.status).toBe(401);
    const r2 = await token({
      grant_type: "password",
      client_id: spec.apiClientId,
      client_secret: secrets.clientSecret,
      username,
      ipb_otp_step: "send",
    });
    expect(r2.status).toBe(400);
    expect(((await r2.json()) as { error_description: string }).error_description).toMatch(/DPoP/);
    // A verify without the code's challenge is refused.
    const r3 = await token(
      {
        grant_type: "password",
        client_id: spec.apiClientId,
        client_secret: secrets.clientSecret,
        username,
        ipb_otp_step: "verify",
        ipb_otp_challenge: "x".repeat(22),
        ipb_otp_code: "123456",
      },
      testDevice().proof("POST", htu()),
    );
    expect(r3.status).toBe(401);
    expect(await r3.text()).not.toMatch(/access_token/);
  });

  it("the stock image is refused: applyCustomerRealm needs the extension", async () => {
    const stock = await startService("keycloak", {
      ports: [8080],
      env: {
        KC_BOOTSTRAP_ADMIN_USERNAME: admin.username,
        KC_BOOTSTRAP_ADMIN_PASSWORD: admin.password,
      },
      command: ["start-dev"],
      readyLog: /Listening on/,
      configure: (c) => c.withStartupTimeout(240_000),
    });
    try {
      await expect(
        KeycloakCustomerIdentity.applyCustomerRealm({
          baseUrl: `http://${stock.host}:${stock.ports[8080]}`,
          masterAdmin: admin,
          allowLoopbackHttp: true,
          spec,
        }),
      ).rejects.toMatchObject({ code: "IPB-PORT-002" });
    } finally {
      await stock.stop();
    }
  });
});
