// ESIGN contract legs (PL3 plan §8, §12; PL3-D-23). Hermetic: Leegality and Digio stubs; the
// sandbox legs wait for the vendors' test accounts (port-contract issues) and stay `unproven`.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DocumentRef, EsignPort, Signer } from "@infrabyx/contracts/ports";
import { sha256Hex } from "@infrabyx/crypto";
import {
  defineContractSuite,
  MemoryEsignEnvelopeStore,
  MemoryStorage,
  startDigioStub,
  startLeegalityStub,
  stubCredential,
  type ContractCase,
  type DigioStub,
  type LeegalityStub,
} from "@infrabyx/testing";
import { DigioEsign } from "../digio.js";
import { LeegalityEsign } from "../leegality.js";

let lg: LeegalityStub;
let dg: DigioStub;
const urlToken = stubCredential();
beforeAll(async () => {
  lg = await startLeegalityStub();
  dg = await startDigioStub();
});
afterAll(async () => {
  await lg?.close();
  await dg?.close();
});

const storage = new MemoryStorage();
let seq = 0;
async function pdf(): Promise<DocumentRef> {
  const body = Buffer.from(`%PDF-1.7\n% agreement ${++seq}\n%%EOF\n`);
  const storageKey = `tenant/tnt_a/documents/01JA00000000000000000000${String(seq).padStart(2, "0")}.pdf`;
  await storage.put(storageKey, body, { bucketClass: "REGULATED", contentType: "application/pdf" });
  return { documentId: `doc_${seq}`, sha256: sha256Hex(body), storageKey };
}
const signer = (n: number, method: Signer["method"] = "AADHAAR_OTP_ESIGN"): Signer => ({
  ref: `usr_signer_${n}`,
  name: `Signer ${n}`,
  email: `signer${n}@example.test`,
  method,
});

const stores = new WeakMap<EsignPort, MemoryEsignEnvelopeStore>();
const leegality = (now?: () => number) => {
  const store = new MemoryEsignEnvelopeStore();
  const p = new LeegalityEsign({
    store,
    storage,
    authToken: () => lg.authToken,
    privateSalt: () => lg.privateSalt,
    profiles: { AADHAAR_OTP_ESIGN: "PRF-AADHAAR", DSC: "PRF-DSC", E_ACCEPTANCE_OTP: "PRF-OTP" },
    baseUrl: lg.url,
    allowLoopbackHttp: true,
    ...(now ? { now } : {}),
  });
  stores.set(p, store);
  return p;
};
const digio = () => {
  const store = new MemoryEsignEnvelopeStore();
  const p = new DigioEsign({
    store,
    storage,
    clientId: () => dg.clientId,
    clientSecret: () => dg.clientSecret,
    webhookToken: () => urlToken,
    baseUrl: dg.url,
    allowLoopbackHttp: true,
  });
  stores.set(p, store);
  return p;
};
const vendorRef = async (p: EsignPort, envelopeId: string) =>
  (await stores.get(p)!.get(envelopeId))!.vendorRef;
const signAt = (p: EsignPort, ref: string, n: number) =>
  p.descriptor.adapter === "leegality" ? lg.sign(ref, n) : dg.sign(ref, n);
const webhook = (p: EsignPort, ref: string) =>
  p.descriptor.adapter === "leegality"
    ? p.handleWebhook(lg.webhook(ref), { "content-type": "application/json" })
    : p.handleWebhook(
        Buffer.from(JSON.stringify({ event: "doc.signed", payload: { document: { id: ref } } })),
        {},
        { query: `ipb_token=${urlToken}` },
      );

const cases: ContractCase<EsignPort>[] = [
  {
    name: "create → sign → completed: the signed PDF goes to STORAGE with its SHA-256 and signature records",
    async run(p) {
      const doc = await pdf();
      const { envelopeId } = await p.createEnvelope(doc, [signer(1), signer(2)], "sequential", []);
      expect(envelopeId).toMatch(/^esr_/);
      const sent = await p.sendForSignature(envelopeId);
      expect(sent.state).toBe("sent");
      const ref = await vendorRef(p, envelopeId);
      signAt(p, ref, 0);
      expect((await p.getStatus(envelopeId)).state).toBe("partially_signed");
      signAt(p, ref, 1);
      const done = await p.getStatus(envelopeId);
      expect(done.state).toBe("completed");
      expect(done.signers.map((s) => s.state)).toEqual(["signed", "signed"]);
      const out = await p.downloadSigned(envelopeId);
      const stored = await storage.get(out.storageKey);
      expect(sha256Hex(stored.body)).toBe(out.sha256);
      expect(stored.meta.bucketClass).toBe("REGULATED");
      expect(out.storageKey).toMatch(/^tenant\/tnt_a\/esign\//);
      expect(out.signatures.map((s) => s.signerRef)).toEqual(["usr_signer_1", "usr_signer_2"]);
    },
  },
  {
    name: "the document travels by reference: a SHA-256 mismatch is refused before any request",
    async run(p) {
      const doc = await pdf();
      const before = (p.descriptor.adapter === "leegality" ? lg : dg).requests.length;
      await expect(
        p.createEnvelope({ ...doc, sha256: "0".repeat(64) }, [signer(1)], "parallel", []),
      ).rejects.toMatchObject({ code: "IPB-PORT-001", meta: { reason: "hash_mismatch" } });
      expect((p.descriptor.adapter === "leegality" ? lg : dg).requests.length).toBe(before);
    },
  },
  {
    name: "a signature type is never downgraded: an unavailable method is refused, and sessions keep the method",
    async run(p) {
      const doc = await pdf();
      for (const m of ["WET_INK", "ACCOUNT_ESIGN"] as const)
        await expect(p.createEnvelope(doc, [signer(1, m)], "parallel", [])).rejects.toMatchObject({
          code: "IPB-PORT-001",
          meta: { reason: "method_unsupported" },
        });
      const { envelopeId } = await p.createEnvelope(doc, [signer(1, "DSC")], "parallel", []);
      await expect(
        p.aadhaarEsign({ envelopeId, signerRef: "usr_signer_1", method: "AADHAAR_OTP_ESIGN" }),
      ).rejects.toMatchObject({ meta: { reason: "method_unsupported" } });
      const s = await p.dscSign({ envelopeId, signerRef: "usr_signer_1" });
      expect(s.redirectUrl).toMatch(/^https?:\/\//);
    },
  },
  {
    name: "a declined signer declines the envelope; cancel stops it",
    async run(p) {
      const a = await p.createEnvelope(await pdf(), [signer(1), signer(2)], "parallel", []);
      const ref = await vendorRef(p, a.envelopeId);
      if (p.descriptor.adapter === "leegality") lg.reject(ref, 1);
      else dg.reject(ref, 1);
      expect((await p.getStatus(a.envelopeId)).state).toBe("declined");
      const b = await p.createEnvelope(await pdf(), [signer(1)], "parallel", []);
      await p.cancel(b.envelopeId, "replaced by a new version");
      expect((await p.getStatus(b.envelopeId)).state).toBe("cancelled");
      await expect(p.downloadSigned(b.envelopeId)).rejects.toMatchObject({
        meta: { reason: "not_completed" },
      });
    },
  },
  {
    name: "the same idempotency key creates the envelope once",
    async run(p) {
      const doc = await pdf();
      const n = (p.descriptor.adapter === "leegality" ? lg : dg).documents.size;
      const a = await p.createEnvelope(doc, [signer(1)], "parallel", [], { idempotencyKey: "k-1" });
      const b = await p.createEnvelope(doc, [signer(1)], "parallel", [], { idempotencyKey: "k-1" });
      expect(b.envelopeId).toBe(a.envelopeId);
      expect((p.descriptor.adapter === "leegality" ? lg : dg).documents.size).toBe(n + 1);
    },
  },
  {
    name: "@IPB-10-27 a webhook is a trigger only: the status returned is read back from the vendor",
    async run(p) {
      const { envelopeId } = await p.createEnvelope(await pdf(), [signer(1)], "parallel", []);
      const ref = await vendorRef(p, envelopeId);
      // The webhook claims completion before anything is signed: the read-back says "sent".
      expect((await webhook(p, ref)).state).toBe("sent");
      signAt(p, ref, 0);
      expect((await webhook(p, ref)).state).toBe("completed");
    },
  },
  {
    name: "verifySignature: neither adapter validates PAdES yet (unsupported)",
    method: "verifySignature",
    invoke: async (p) => p.verifySignature(await pdf()),
    async run() {},
  },
];

describe("@IPB-01-15 ESIGN hermetic legs (Leegality and Digio stubs)", () => {
  defineContractSuite("ESIGN", () => leegality(), cases, { leg: "hermetic" });
  defineContractSuite("ESIGN", digio, cases, { leg: "hermetic" });
});

describe("C-25 Leegality webhooks (PL3-C-02)", () => {
  it("a wrong or missing mac, or an unknown document, is refused before any read-back", async () => {
    const p = leegality();
    const { envelopeId } = await p.createEnvelope(await pdf(), [signer(1)], "parallel", []);
    const ref = await vendorRef(p, envelopeId);
    const before = lg.requests.length;
    for (const body of [
      lg.webhook(ref, { mac: "0".repeat(40) }),
      Buffer.from(JSON.stringify({ documentId: ref })),
      lg.webhook("LGDOC-unknown"),
      Buffer.from("not json"),
    ])
      await expect(p.handleWebhook(body, {})).rejects.toMatchObject({ code: "IPB-API-018" });
    expect(lg.requests.length).toBe(before);
  });
  it("a timestamp outside the 5-minute window is refused", async () => {
    const now = Date.parse("2026-10-27T10:00:00Z");
    const p = leegality(() => now);
    const { envelopeId } = await p.createEnvelope(await pdf(), [signer(1)], "parallel", []);
    const ref = await vendorRef(p, envelopeId);
    await expect(
      p.handleWebhook(lg.webhook(ref, { timestamp: "2026-10-27T09:50:00Z" }), {}),
    ).rejects.toMatchObject({ code: "IPB-API-018" });
    expect(
      (await p.handleWebhook(lg.webhook(ref, { timestamp: "2026-10-27T09:58:00Z" }), {})).state,
    ).toBe("sent");
  });
  it("one workflow per envelope: mixed methods are refused, and positions come from the workflow", async () => {
    const p = leegality();
    await expect(
      p.createEnvelope(await pdf(), [signer(1), signer(2, "DSC")], "parallel", []),
    ).rejects.toMatchObject({ meta: { reason: "method_unsupported" } });
    await expect(
      p.createEnvelope(await pdf(), [signer(1)], "parallel", [
        { signerRef: "usr_signer_1", page: 1, x: 10, y: 10, width: 100, height: 40 },
      ]),
    ).rejects.toMatchObject({ code: "IPB-PORT-001" });
  });
});

describe("Digio specifics", () => {
  it("a callback without our URL token is refused", async () => {
    const p = digio();
    const body = Buffer.from(JSON.stringify({ payload: { document: { id: "DID1" } } }));
    await expect(p.handleWebhook(body, {}, { query: "ipb_token=wrong" })).rejects.toMatchObject({
      code: "IPB-API-018",
    });
    await expect(p.handleWebhook(body, {})).rejects.toMatchObject({ code: "IPB-API-018" });
  });
  it("sends signature positions per signer identifier and the signing order", async () => {
    const p = digio();
    const { envelopeId } = await p.createEnvelope(
      await pdf(),
      [signer(1), signer(2)],
      "sequential",
      [{ signerRef: "usr_signer_2", page: 2, x: 10, y: 20, width: 100, height: 40 }],
    );
    const d = dg.documents.get(await vendorRef(p, envelopeId))!;
    expect(d.sequential).toBe(true);
    expect(d.coordinates).toEqual({
      "signer2@example.test": { "2": [{ llx: 10, lly: 20, urx: 110, ury: 60 }] },
    });
  });
  it("biometric Aadhaar has no Digio type here and is refused, never sent as OTP", async () => {
    await expect(
      digio().createEnvelope(await pdf(), [signer(1, "AADHAAR_BIO_ESIGN")], "parallel", []),
    ).rejects.toMatchObject({ meta: { reason: "method_unsupported" } });
  });
});
