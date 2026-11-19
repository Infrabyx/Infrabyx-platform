// KYC contract legs for the IDfy alternative (R1-plan M25, owner answer #91). Hermetic: the IDfy
// stub, whose shapes are stub-shaped until the owner's sandbox exists; the adapter stays
// `unproven` and off. Also the per-method router (PR-FBX-24: Digio first, IDfy second).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PortError } from "@infrabyx/contracts/errors";
import type { KycFileRef, KycPort } from "@infrabyx/contracts/ports";
import { MemoryReplayStore, sha256Hex } from "@infrabyx/crypto";
import {
  defineContractSuite,
  FakeKyc,
  kycContractCases,
  KYC_FAKE_FIXTURES,
  MemoryStorage,
  startDigioKycStub,
  startIdfyKycStub,
  type DigioKycStub,
  type IdfyKycStub,
  type KycFixtures,
} from "@infrabyx/testing";
import { DigioKyc } from "../digio.js";
import {
  IdfyKyc,
  mapIdfyAadhaarOtpRefusal,
  mapIdfyAadhaarOtpVerify,
  mapIdfyPan,
  mapIdfyScore,
} from "../idfy.js";
import { kycMethodRouter } from "../routing.js";

let idfy: IdfyKycStub;
let dg: DigioKycStub;
const storage = new MemoryStorage();
let fixtures: KycFixtures;
let n = 0;
const put = async (body: Buffer): Promise<KycFileRef> => {
  const key = `tenant/tnt_kyc/kyc/01JA00000000000000000000${String(++n).padStart(2, "0")}.jpg`;
  await storage.put(key, body, { bucketClass: "REGULATED", contentType: "image/jpeg" });
  return { storageKey: key, sha256: sha256Hex(body) };
};

beforeAll(async () => {
  idfy = await startIdfyKycStub();
  dg = await startDigioKycStub();
  fixtures = {
    ...KYC_FAKE_FIXTURES,
    pan: idfy.pan,
    faces: {
      a: await put(idfy.faces.a),
      same: await put(idfy.faces.same),
      other: await put(idfy.faces.other),
    },
    frames: await Promise.all(idfy.frames.map(put)),
    aadhaarOtp: {
      ...idfy.aadhaarOtp,
      notNotified: () => ({
        port: make({ notifiedEntity: false }),
        vendorCalls: () => idfy.requests.length,
      }),
      vendorCalls: () => idfy.requests.length,
      expire: (_p, txn) => idfy.expireAadhaarOtp(txn),
    },
  };
});
afterAll(async () => {
  await idfy?.close();
  await dg?.close();
});

let enabled = true;
const make = (over: Partial<ConstructorParameters<typeof IdfyKyc>[0]> = {}) =>
  new IdfyKyc({
    storage,
    enabled: () => enabled,
    accountId: () => idfy.accountId,
    apiKey: () => idfy.apiKey,
    currentTenant: () => "tnt_kyc",
    // Built for a notified entity, so the Aadhaar OTP cases run (PR-UDF-041).
    notifiedEntity: true,
    baseUrl: idfy.url,
    allowLoopbackHttp: true,
    ...over,
  });

describe("@IPB-01-15 KYC hermetic leg (IDfy stub)", () => {
  const cases = kycContractCases(
    new Proxy({} as KycFixtures, { get: (_t, k) => fixtures[k as keyof KycFixtures] }),
  );
  defineContractSuite("KYC", () => make(), cases, { leg: "hermetic" });
});

describe("R1-D-45 IDfy KYC behind its flag, by reference", () => {
  it("is off until int.kyc.idfy.enabled: nothing reaches IDfy and health is down", async () => {
    enabled = false;
    try {
      const p = make();
      const before = idfy.requests.length;
      await expect(p.verifyPan({ pan: idfy.pan.pan, name: idfy.pan.name })).rejects.toMatchObject({
        code: "IPB-PORT-001",
        meta: { reason: "adapter_disabled" },
      });
      expect((await p.health()).status).toBe("down");
      expect(idfy.requests.length).toBe(before);
    } finally {
      enabled = true;
    }
  });

  it("checks each image against its SHA-256 before it leaves, and stores nothing", async () => {
    const p = make();
    const before = idfy.requests.length;
    await expect(
      p.faceMatch({ a: { ...fixtures.faces.a, sha256: "0".repeat(64) }, b: fixtures.faces.same }),
    ).rejects.toMatchObject({ meta: { reason: "hash_mismatch" } });
    expect(idfy.requests.length).toBe(before);
    const keys = (await storage.list("tenant/")).keys.length;
    const r = await p.faceMatch({ a: fixtures.faces.a, b: fixtures.faces.same });
    expect(r).toMatchObject({ adapter: "idfy-kyc", passed: true });
    expect(r.vendorRef).toMatch(/^REQ/);
    expect((await storage.list("tenant/")).keys.length).toBe(keys);
  });

  it("scores liveness by its weakest frame and sends no personal data in the task ids", async () => {
    const p = make();
    const weak = await put(Buffer.from("not-a-live-frame"));
    const r = await p.livenessCheck({ frames: [...fixtures.frames, weak] });
    expect(r.passed).toBe(false);
    const last = idfy.requests.at(-1)!;
    const body = last.json() as { task_id: string; group_id: string };
    expect(body.task_id).toMatch(/^kyt_/);
    expect(body.group_id).toMatch(/^kyg_/);
  });

  it("maps the stub-shaped results conservatively", () => {
    expect(
      mapIdfyPan({ source_output: { status: "id_found", name_match_score: 0.5 } }),
    ).toMatchObject({
      status: "valid",
      nameMatch: "partial",
    });
    expect(mapIdfyPan({ source_output: { status: "something_else" } }).status).toBe("invalid");
    expect(() => mapIdfyPan({})).toThrow();
    expect(mapIdfyScore({ match_score: 87 }, "match_score").score).toBeCloseTo(0.87);
    expect(() => mapIdfyScore({}, "liveness_score")).toThrow();
  });
});

describe("PR-FBX-24 per-method KYC routing: Digio first, IDfy second", () => {
  const digio = () =>
    new DigioKyc({
      storage,
      consents: new MemoryReplayStore(),
      enabled: () => true,
      clientId: () => dg.clientId,
      clientSecret: () => dg.clientSecret,
      currentTenant: () => "tnt_kyc",
      baseUrl: dg.url,
      allowLoopbackHttp: true,
    });

  it("sends each method to the first adapter that provides it", async () => {
    const k = kycMethodRouter({ adapters: [digio(), make()] });
    expect((await k.verifyPan({ pan: idfy.pan.pan, name: idfy.pan.name })).adapter).toBe(
      "idfy-kyc",
    );
    const docs = await k.digilockerPull({
      consentSession: dg.completedDigilocker(["PANCR"]),
      docTypes: ["PANCR"],
    });
    expect(docs).toHaveLength(1);
    expect(k.descriptor.capabilities?.verifyPan).toBeUndefined();
    expect(k.descriptor.capabilities?.ckycSearch).toBe("unsupported");
    await expect(k.ckycSearch({ idType: "PAN", idNumber: idfy.pan.pan })).rejects.toMatchObject({
      code: "IPB-PORT-001",
      meta: { reason: "unsupported" },
    });
  });

  it("falls through only when an adapter is off or unavailable, never on an answer about the customer", async () => {
    let calls = 0;
    const down = new FakeKyc();
    const flaky: KycPort = Object.assign(Object.create(down) as KycPort, {
      descriptor: { ...down.descriptor, adapter: "flaky-kyc" },
      verifyPan: async () => {
        calls++;
        throw new PortError("IPB-PORT-002", "KYC", { adapter: "flaky-kyc", detail: "down" });
      },
    });
    const k = kycMethodRouter({
      adapters: [flaky, make()],
      order: { pan: ["flaky-kyc", "idfy-kyc"] },
    });
    expect((await k.verifyPan({ pan: idfy.pan.pan, name: idfy.pan.name })).adapter).toBe(
      "idfy-kyc",
    );
    expect(calls).toBe(1);
    // A refusal that is about the request (a malformed PAN) is not retried at the next adapter.
    const before = idfy.requests.length;
    await expect(k.verifyPan({ pan: "abc", name: "x" })).rejects.toThrow();
    expect(idfy.requests.length).toBe(before);
    expect(() => kycMethodRouter({ adapters: [make()], order: { pan: ["nobody"] } })).toThrow(
      /unknown adapter/,
    );
  });
});

describe("PR-UDF-041 IDfy Aadhaar OTP e-KYC for a notified RE", () => {
  const consent = { version: "1.0", textHash: "cd".repeat(32), at: "2026-11-19T05:00:00Z" };

  it("is off by default: not_configured before any request", async () => {
    const before = idfy.requests.length;
    const p = new IdfyKyc({
      storage,
      enabled: () => true,
      accountId: () => idfy.accountId,
      apiKey: () => idfy.apiKey,
      baseUrl: idfy.url,
      allowLoopbackHttp: true,
    });
    await expect(
      p.aadhaarOtpRequest({ uid: idfy.aadhaarOtp.uid, uidKind: "AADHAAR", consent }),
    ).rejects.toMatchObject({ meta: { reason: "not_configured", definite: true } });
    await expect(p.aadhaarOtpVerify({ txn: "TXN0000000001", otp: "123456" })).rejects.toMatchObject(
      { meta: { reason: "not_configured" } },
    );
    expect(idfy.requests.length).toBe(before);
  });

  it("stores the e-KYC under the tenant, REGULATED, and refuses one that carries the number", async () => {
    const p = make();
    const s = await p.aadhaarOtpRequest({ uid: idfy.aadhaarOtp.vid, uidKind: "VID", consent });
    const sent = idfy.requests.at(-1)!.json() as { data: Record<string, string> };
    expect(sent.data).toMatchObject({
      id_type: "vid",
      id_number: idfy.aadhaarOtp.vid,
      consent: "Y",
    });
    const r = await p.aadhaarOtpVerify(
      { txn: s.txn, otp: idfy.aadhaarOtp.otp },
      { tenantId: "tnt_other" },
    );
    expect(r).toMatchObject({
      adapter: "idfy-kyc",
      signatureValid: true,
      uidLast4: idfy.aadhaarOtp.uid.slice(-4),
    });
    const o = await storage.get(r.ekyc.storageKey);
    expect(r.ekyc.storageKey).toMatch(/^tenant\/tnt_other\/kyc\//);
    expect(o.meta.bucketClass).toBe("REGULATED");
    expect(sha256Hex(o.body)).toBe(r.ekyc.sha256);
    const t = await p.aadhaarOtpRequest({ uid: idfy.aadhaarOtp.uid, uidKind: "AADHAAR", consent });
    idfy.ekycWithNumberOnce(idfy.aadhaarOtp.uid);
    await expect(
      p.aadhaarOtpVerify({ txn: t.txn, otp: idfy.aadhaarOtp.otp }),
    ).rejects.toMatchObject({
      meta: { reason: "ekyc_holds_number" },
    });
  });

  it("maps the stub-shaped answers conservatively", () => {
    expect(mapIdfyAadhaarOtpRefusal({ error: "INVALID_ID" })).toBe("uid_invalid");
    expect(mapIdfyAadhaarOtpRefusal({ error: "MOBILE_NOT_LINKED" })).toBe("mobile_not_linked");
    expect(mapIdfyAadhaarOtpRefusal({ error: "TRANSACTION_NOT_FOUND" })).toBe("otp_expired");
    expect(mapIdfyAadhaarOtpRefusal({ error: "INVALID_OTP" })).toBe("otp_invalid");
    expect(mapIdfyAadhaarOtpRefusal({ error: "BAD_REQUEST" })).toBeUndefined();
    expect(() =>
      mapIdfyAadhaarOtpVerify({ aadhaar_last_4: "12345", ekyc_xml: "PEt5Yz4=" }),
    ).toThrow();
    expect(mapIdfyAadhaarOtpVerify({ aadhaar_last_4: "1234", ekyc_xml: "PEt5Yz4=" })).toMatchObject(
      {
        uidLast4: "1234",
        signatureValid: null,
      },
    );
  });

  it("the router sends the OTP and its verify to the same adapter, and a not_configured refusal is final", async () => {
    const notified = new DigioKyc({
      storage,
      consents: new MemoryReplayStore(),
      enabled: () => false,
      clientId: () => dg.clientId,
      clientSecret: () => dg.clientSecret,
      currentTenant: () => "tnt_kyc",
      notifiedEntity: true,
      baseUrl: dg.url,
      allowLoopbackHttp: true,
    });
    // Digio is off: the router falls through to IDfy for both steps.
    const k = kycMethodRouter({ adapters: [notified, make()] });
    const s = await k.aadhaarOtpRequest!({ uid: idfy.aadhaarOtp.uid, uidKind: "AADHAAR", consent });
    expect(s.adapter).toBe("idfy-kyc");
    expect((await k.aadhaarOtpVerify!({ txn: s.txn, otp: idfy.aadhaarOtp.otp })).adapter).toBe(
      "idfy-kyc",
    );
    // Not notified is the RE's answer, not an outage: never retried at the next adapter.
    const before = idfy.requests.length;
    const plain = make({ notifiedEntity: false });
    const unnotified: KycPort = Object.assign(Object.create(plain) as KycPort, {
      descriptor: { ...plain.descriptor, adapter: "idfy-unnotified" },
    });
    const strict = kycMethodRouter({ adapters: [unnotified, make()] });
    await expect(
      strict.aadhaarOtpRequest!({ uid: idfy.aadhaarOtp.uid, uidKind: "AADHAAR", consent }),
    ).rejects.toMatchObject({ meta: { reason: "not_configured" } });
    expect(idfy.requests.length).toBe(before);
  });
});
