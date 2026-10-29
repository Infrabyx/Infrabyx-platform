// KYC contract legs (R1-plan M16, R1-D-24). Hermetic: the Digio KYC stub. The sandbox leg waits
// for the owner's Digio account (OWNER-QUESTIONS #87) and the adapter stays `unproven` and off.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MemoryReplayStore, sha256Hex } from "@infrabyx/crypto";
import {
  defineContractSuite,
  kycContractCases,
  KYC_FAKE_FIXTURES,
  MemoryStorage,
  startDigioKycStub,
  type DigioKycStub,
  type KycFixtures,
} from "@infrabyx/testing";
import { DigioKyc } from "../digio.js";

let dg: DigioKycStub;
const storage = new MemoryStorage();
let fixtures: KycFixtures;
beforeAll(async () => {
  dg = await startDigioKycStub();
  const key = "tenant/tnt_kyc/kyc/01JA0000000000000000000001.zip";
  await storage.put(key, dg.offlineZip, {
    bucketClass: "REGULATED",
    contentType: "application/zip",
  });
  fixtures = {
    ...KYC_FAKE_FIXTURES,
    aadhaar: {
      file: { storageKey: key, sha256: sha256Hex(dg.offlineZip) },
      shareCode: dg.shareCode,
      wrongShareCode: "0000",
    },
    digilockerConsent: () => dg.completedDigilocker(["PANCR", "ADHAR"]),
  };
});
afterAll(async () => {
  await dg?.close();
});

let enabled = true;
const digio = () =>
  new DigioKyc({
    storage,
    consents: new MemoryReplayStore(),
    enabled: () => enabled,
    clientId: () => dg.clientId,
    clientSecret: () => dg.clientSecret,
    currentTenant: () => "tnt_kyc",
    baseUrl: dg.url,
    allowLoopbackHttp: true,
  });

describe("@IPB-01-15 KYC hermetic leg (Digio KYC stub)", () => {
  // The fixtures are built once the stub is up, so the cases are read lazily.
  const cases = kycContractCases(
    new Proxy({} as KycFixtures, { get: (_t, k) => fixtures[k as keyof KycFixtures] }),
  );
  defineContractSuite("KYC", digio, cases, { leg: "hermetic" });
});

describe("R1-D-24 Digio KYC behind its flag, by reference, without the Aadhaar number", () => {
  it("is off until int.kyc.digio.enabled: no request reaches Digio and health is down", async () => {
    enabled = false;
    try {
      const p = digio();
      const before = dg.requests.length;
      await expect(
        p.digilockerPull({
          consentSession: dg.completedDigilocker(["PANCR"]),
          docTypes: ["PANCR"],
        }),
      ).rejects.toMatchObject({ code: "IPB-PORT-001", meta: { reason: "adapter_disabled" } });
      expect((await p.health()).status).toBe("down");
      expect(dg.requests.length).toBe(before);
    } finally {
      enabled = true;
    }
  });

  it("stores DigiLocker files under the tenant, REGULATED, and refuses an unfinished session without burning it", async () => {
    const p = digio();
    const pending = dg.pendingDigilocker();
    await expect(
      p.digilockerPull({ consentSession: pending, docTypes: ["PANCR"] }),
    ).rejects.toMatchObject({ meta: { reason: "consent_incomplete" } });
    const docs = await p.digilockerPull(
      { consentSession: dg.completedDigilocker(["PANCR", "DRVLC"]), docTypes: ["PANCR"] },
      { tenantId: "tnt_other" },
    );
    expect(docs.map((d) => d.docType)).toEqual(["PANCR"]);
    const o = await storage.get(docs[0]!.file.storageKey);
    expect(docs[0]!.file.storageKey).toMatch(/^tenant\/tnt_other\/kyc\//);
    expect(o.meta.bucketClass).toBe("REGULATED");
    expect(sha256Hex(o.body)).toBe(docs[0]!.file.sha256);
  });

  it("checks the file against its SHA-256 before sending it, and keeps only the last four digits", async () => {
    const p = digio();
    const before = dg.requests.length;
    await expect(
      p.verifyAadhaarOffline({
        file: { ...fixtures.aadhaar.file, sha256: "0".repeat(64) },
        shareCode: dg.shareCode,
      }),
    ).rejects.toMatchObject({ meta: { reason: "hash_mismatch" } });
    expect(dg.requests.length).toBe(before);
    const r = await p.verifyAadhaarOffline({
      file: fixtures.aadhaar.file,
      shareCode: dg.shareCode,
    });
    expect(r).toMatchObject({ aadhaarLast4: "0420", signatureValid: true, gender: "F" });
    expect(r.photo?.storageKey).toMatch(/^tenant\/tnt_kyc\/kyc\/.+\.jpg$/);
    await expect(
      p.verifyAadhaarOffline({ file: fixtures.aadhaar.file, shareCode: "0000" }),
    ).rejects.toMatchObject({ meta: { reason: "share_code" } });
  });

  it("names no tenant, no call: a pull without a tenant is refused", async () => {
    const p = new DigioKyc({
      storage,
      consents: new MemoryReplayStore(),
      enabled: () => true,
      clientId: () => dg.clientId,
      clientSecret: () => dg.clientSecret,
      baseUrl: dg.url,
      allowLoopbackHttp: true,
    });
    await expect(
      p.digilockerPull({ consentSession: dg.completedDigilocker(["PANCR"]), docTypes: ["PANCR"] }),
    ).rejects.toMatchObject({ meta: { reason: "no_tenant" } });
  });
});
