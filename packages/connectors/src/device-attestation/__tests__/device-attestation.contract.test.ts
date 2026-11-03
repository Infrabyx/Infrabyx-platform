// DEVICE_ATTESTATION contract legs (Udofin PR-UDF-028; ADR-0004; owner answer #99; R1-D-59): the
// `native` adapter (Play Integrity through the stub with a C-24 token, App Attest verified with
// C-27 against a test authority) and the fake run the same cases; then what only `native` promises:
// both halves off until their flags, a stale token or a foreign signing certificate refused, a
// development key refused unless allowed, and production refusing any root but Apple's.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MemoryReplayStore } from "@infrabyx/crypto";
import {
  defineContractSuite,
  deviceAttestationContractCases,
  FakeDeviceAttestation,
  nativeDeviceEvidence,
  startPlayIntegrityStub,
  type DeviceEvidence,
  type PlayIntegrityStub,
} from "@infrabyx/testing";
import { NativeDeviceAttestation, type NativeDeviceAttestationOptions } from "../native.js";

const PKG = "in.example.borrower";
const APP = "ABCDE12345.in.example.borrower";
let stub: PlayIntegrityStub;
let evidence: ReturnType<typeof nativeDeviceEvidence>;
let playOn = true;
let iosOn = true;
beforeAll(async () => {
  stub = await startPlayIntegrityStub();
  evidence = nativeDeviceEvidence(stub);
});
afterAll(async () => stub?.close());

const native = (over: Partial<NativeDeviceAttestationOptions> = {}) => {
  const keys = new Set<string>();
  return new NativeDeviceAttestation({
    replay: new MemoryReplayStore(),
    keys: { has: async (k) => keys.has(k), add: async (k) => void keys.add(k) },
    playIntegrity: {
      enabled: () => playOn,
      credentials: {
        kind: "service_account",
        clientEmail: stub.clientEmail,
        privateKey: () => stub.privateKeyPem,
      },
      signingCerts: { [PKG]: [stub.certDigest], "in.example.other": [stub.certDigest] },
      baseUrl: stub.url,
      tokenUrl: `${stub.url}/token`,
    },
    appAttest: { enabled: () => iosOn, testRoots: [evidence.authority.rootPem] },
    allowLoopbackHttp: true,
    ...over,
  });
};
const nonce = () => ({
  kind: "nonce" as const,
  value: `n-${Math.random().toString(36).slice(2)}-0000`,
});

describe("DEVICE_ATTESTATION hermetic legs", () => {
  // The cases are built before beforeAll runs, so they reach the evidence through this.
  const lazy: DeviceEvidence = {
    playToken: (o) => evidence.playToken(o),
    attestation: (o) => evidence.attestation(o),
    assertion: (o) => evidence.assertion(o),
  };
  defineContractSuite("DEVICE_ATTESTATION", () => native(), deviceAttestationContractCases(lazy), {
    leg: "hermetic",
  });
  const fake = new FakeDeviceAttestation();
  defineContractSuite("DEVICE_ATTESTATION", () => fake, deviceAttestationContractCases(fake));
});

describe("R1-D-59 the native adapter", () => {
  it("stays off until each half's flag is on", async () => {
    const p = native();
    playOn = false;
    iosOn = false;
    try {
      const b = nonce();
      await expect(
        p.verifyPlayIntegrity({
          packageName: PKG,
          token: evidence.playToken({ packageName: PKG, binding: b }),
          binding: b,
        }),
      ).rejects.toMatchObject({ code: "IPB-PORT-001" });
      const a = evidence.attestation({ appId: APP, binding: b });
      await expect(
        p.registerAppAttestKey({
          appId: APP,
          keyId: a.keyId,
          attestation: a.attestation,
          binding: b,
        }),
      ).rejects.toMatchObject({ code: "IPB-PORT-001" });
      expect((await p.health()).status).toBe("down");
    } finally {
      playOn = true;
      iosOn = true;
    }
  });

  it("refuses a stale Play Integrity token and a foreign signing certificate", async () => {
    const b = nonce();
    const old = stub.mint({
      packageName: PKG,
      requestHash: b.value,
      timestampMillis: Date.now() - 600_000,
    });
    expect(
      await native().verifyPlayIntegrity({ packageName: PKG, token: old, binding: b }),
    ).toEqual({
      ok: false,
      reason: "invalid",
    });
    const t = evidence.playToken({ packageName: PKG, binding: b });
    const p = native({
      playIntegrity: {
        enabled: () => true,
        credentials: {
          kind: "service_account",
          clientEmail: stub.clientEmail,
          privateKey: () => stub.privateKeyPem,
        },
        signingCerts: { [PKG]: ["another-cert-digest"] },
        baseUrl: stub.url,
        tokenUrl: `${stub.url}/token`,
      },
    });
    expect(await p.verifyPlayIntegrity({ packageName: PKG, token: t, binding: b })).toEqual({
      ok: false,
      reason: "app_mismatch",
    });
  });

  it("refuses development keys unless allowed, and any root but Apple's without test roots", async () => {
    const b = nonce();
    const dev = evidence.authority.attest(APP, b.value, { development: true });
    const req = { appId: APP, keyId: dev.key.keyId, attestation: dev.attestation, binding: b };
    expect((await native().registerAppAttestKey(req)).verdict).toEqual({
      ok: false,
      reason: "invalid",
    });
    const allowed = native({
      appAttest: {
        enabled: () => true,
        allowDevelopment: true,
        testRoots: [evidence.authority.rootPem],
      },
    });
    expect((await allowed.registerAppAttestKey(req)).verdict).toMatchObject({
      ok: true,
      platform: "ios",
    });
    const prod = native({ appAttest: { enabled: () => true } });
    const a = evidence.attestation({ appId: APP, binding: b });
    expect(
      (
        await prod.registerAppAttestKey({
          appId: APP,
          keyId: a.keyId,
          attestation: a.attestation,
          binding: b,
        })
      ).verdict,
    ).toEqual({ ok: false, reason: "invalid" });
  });

  it("sends Google only the integrity token", async () => {
    const b = nonce();
    const before = stub.requests.length;
    await native().verifyPlayIntegrity({
      packageName: PKG,
      token: evidence.playToken({ packageName: PKG, binding: b }),
      binding: b,
    });
    const decode = stub.requests
      .slice(before)
      .find((r) => r.path.endsWith(":decodeIntegrityToken"))!;
    expect(Object.keys(decode.json<Record<string, unknown>>())).toEqual(["integrity_token"]);
  });
});
