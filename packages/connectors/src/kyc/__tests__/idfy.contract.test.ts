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
import { IdfyKyc, mapIdfyPan, mapIdfyScore } from "../idfy.js";
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
  };
});
afterAll(async () => {
  await idfy?.close();
  await dg?.close();
});

let enabled = true;
const make = () =>
  new IdfyKyc({
    storage,
    enabled: () => enabled,
    accountId: () => idfy.accountId,
    apiKey: () => idfy.apiKey,
    baseUrl: idfy.url,
    allowLoopbackHttp: true,
  });

describe("@IPB-01-15 KYC hermetic leg (IDfy stub)", () => {
  const cases = kycContractCases(
    new Proxy({} as KycFixtures, { get: (_t, k) => fixtures[k as keyof KycFixtures] }),
  );
  defineContractSuite("KYC", make, cases, { leg: "hermetic" });
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
