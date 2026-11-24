// ESIGN contract legs (PL3 plan §8, §12; PL3-D-23). Hermetic: Leegality and Digio stubs; the
// sandbox legs wait for the vendors' test accounts (port-contract issues) and stay `unproven`.
// PR-UDF-070 (R1-D-251): the stubs return real PAdES files signed per signer by a throwaway CA, so
// the legs check that each record's signer certificate is the one in the signed PDF.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DocumentRef, EsignPort, Signer } from "@infrabyx/contracts/ports";
import { sha256Hex, signerCertificateSummary, verifyPadesSignatures } from "@infrabyx/crypto";
import {
  defineContractSuite,
  esignStubAuthority,
  MemoryEsignEnvelopeStore,
  MemoryStorage,
  startDigioStub,
  startLeegalityStub,
  stubCredential,
  type ContractCase,
  type DigioStub,
  type LeegalityStub,
} from "@infrabyx/testing";
import { minimalPdf } from "@infrabyx/crypto/pades-test";
import { signerCertificatesFromPdf } from "../common.js";
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
const stubOf = (p: EsignPort) => (p.descriptor.adapter === "leegality" ? lg : dg);
const tick = () => new Promise((r) => setTimeout(r, 5));
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
    name: "@IPB-01-15 PR-UDF-070 each record carries the signer certificate of its own signature in the signed PDF",
    async run(p) {
      const { envelopeId } = await p.createEnvelope(
        await pdf(),
        [signer(1), signer(2)],
        "sequential",
        [],
      );
      const ref = await vendorRef(p, envelopeId);
      signAt(p, ref, 0);
      signAt(p, ref, 1);
      const out = await p.downloadSigned(envelopeId);
      const stub = stubOf(p);
      expect(out.signatures.map((s) => s.signerCertificate)).toEqual([
        signerCertificateSummary(stub.signerCertificate(ref, 0)),
        signerCertificateSummary(stub.signerCertificate(ref, 1)),
      ]);
      expect(out.signatures.map((s) => s.signerCertificate?.subjectCommonName)).toEqual([
        "Signer 1",
        "Signer 2",
      ]);
      // The file stored is the ESP's PAdES file, which the C-28 verifier accepts under its CA.
      const body = (await storage.get(out.storageKey)).body;
      expect(verifyPadesSignatures(body, { trust: esignStubAuthority().trust }).valid).toBe(true);
    },
  },
  {
    name: "@IPB-01-15 PR-UDF-070 a parallel envelope ties signatures to signers by the ESP's signing times",
    async run(p) {
      const { envelopeId } = await p.createEnvelope(
        await pdf(),
        [signer(1), signer(2)],
        "parallel",
        [],
      );
      const ref = await vendorRef(p, envelopeId);
      signAt(p, ref, 1);
      await tick();
      signAt(p, ref, 0);
      const out = await p.downloadSigned(envelopeId);
      const stub = stubOf(p);
      expect(out.signatures.map((s) => s.signerCertificate?.sha256)).toEqual([
        signerCertificateSummary(stub.signerCertificate(ref, 0)).sha256,
        signerCertificateSummary(stub.signerCertificate(ref, 1)).sha256,
      ]);
    },
  },
  {
    name: "@IPB-01-15 PR-UDF-070 a signed PDF without a readable signature per signer leaves the certificate unset",
    async run(p) {
      const stub = stubOf(p);
      stub.pdfMode = "plain";
      try {
        const { envelopeId } = await p.createEnvelope(await pdf(), [signer(1)], "parallel", []);
        signAt(p, await vendorRef(p, envelopeId), 0);
        const [r] = (await p.downloadSigned(envelopeId)).signatures;
        expect(r?.signerRef).toBe("usr_signer_1");
        expect(r).not.toHaveProperty("signerCertificate");
      } finally {
        stub.pdfMode = "pades";
      }
    },
  },
  {
    name: "@IPB-01-15 PR-UDF-070 multi-document envelopes are refused until the vendor's support is verified",
    method: "createMultiDocumentEnvelope",
    invoke: async (p) =>
      p.createMultiDocumentEnvelope!([{ doc: await pdf(), fields: [] }], [signer(1)], "parallel"),
    async run() {
      throw new Error("multi-document envelopes must be unsupported here");
    },
  },
  {
    name: "@IPB-01-15 PR-UDF-070 downloadSignedDocuments is refused with multi-document envelopes",
    method: "downloadSignedDocuments",
    invoke: (p) => p.downloadSignedDocuments!("esr_unknown"),
    async run() {
      throw new Error("downloadSignedDocuments must be unsupported here");
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

describe("PR-UDF-070 signerCertificatesFromPdf: filled only when each signature is certainly one signer's", () => {
  const ca = esignStubAuthority();
  const a = ca.newSigner({ kind: "ec256", subject: "A Test" });
  const b = ca.newSigner({ kind: "ec256", subject: "B Test" });
  const two = ca.sign(ca.sign(Buffer.from(minimalPdf()), { signer: a }), { signer: b });
  const sa = signerCertificateSummary(a.der);
  const sb = signerCertificateSummary(b.der);
  const at = (ms: number) => new Date(Date.UTC(2026, 10, 21, 2, 0, 0, ms)).toISOString();

  it("sequential: envelope order; parallel: by signing time", () => {
    expect([...signerCertificatesFromPdf(two, "sequential", [{ ref: "x" }, { ref: "y" }])]).toEqual(
      [
        ["x", sa],
        ["y", sb],
      ],
    );
    const m = signerCertificatesFromPdf(two, "parallel", [
      { ref: "x", at: at(9) },
      { ref: "y", at: at(1) },
    ]);
    expect(m.get("y")).toEqual(sa);
    expect(m.get("x")).toEqual(sb);
  });

  it("never guesses: equal or missing times, a count mismatch or an unbound signature leave it empty", () => {
    for (const signers of [
      [
        { ref: "x", at: at(1) },
        { ref: "y", at: at(1) },
      ],
      [{ ref: "x", at: at(1) }, { ref: "y" }],
    ])
      expect(signerCertificatesFromPdf(two, "parallel", signers).size).toBe(0);
    expect(signerCertificatesFromPdf(two, "sequential", [{ ref: "x" }]).size).toBe(0);
    expect(signerCertificatesFromPdf(two, "sequential", []).size).toBe(0);
    const broken = Buffer.from(two);
    broken[20] = broken[20]! ^ 0x01;
    expect(signerCertificatesFromPdf(broken, "sequential", [{ ref: "x" }, { ref: "y" }]).size).toBe(
      0,
    );
    expect(signerCertificatesFromPdf(minimalPdf(), "sequential", [{ ref: "x" }]).size).toBe(0);
  });
});

describe("@IPB-01-15 PR-UDF-086 the ESP's return URL (R1-D-287)", () => {
  const back = "https://app.example.test/loans/01JD3K7Q9M2X4B6C8D0E1F2G3H/sign/return";
  const withBack = (n: number, method: Signer["method"] = "AADHAAR_OTP_ESIGN"): Signer => ({
    ...signer(n, method),
    returnUrl: back,
  });

  for (const [name, make] of [
    ["leegality", leegality],
    ["digio", digio],
  ] as const)
    it(`${name}: a URL with a query string, or not https, is refused before any request`, async () => {
      const p = make();
      const stub = stubOf(p);
      const doc = await pdf();
      const before = stub.requests.length;
      for (const bad of [
        `${back}?loan=01JD3K&name=Asha`,
        `${back}?status=success`,
        "http://app.example.test/r",
      ])
        await expect(
          p.createEnvelope(doc, [{ ...signer(1), returnUrl: bad }], "parallel", []),
        ).rejects.toMatchObject({ code: "IPB-PORT-001", meta: { reason: "return_url_invalid" } });
      expect(stub.requests.length).toBe(before);
      const { envelopeId } = await p.createEnvelope(doc, [signer(1)], "parallel", []);
      await expect(
        p.aadhaarEsign({
          envelopeId,
          signerRef: "usr_signer_1",
          method: "AADHAAR_OTP_ESIGN",
          returnUrl: `${back}?loan=1`,
        }),
      ).rejects.toMatchObject({ meta: { reason: "return_url_invalid" } });
      // The refusal never echoes the URL.
      const e = await p
        .aadhaarEsign({
          envelopeId,
          signerRef: "usr_signer_1",
          method: "AADHAAR_OTP_ESIGN",
          returnUrl: "https://app.example.test/r?mobile=9876543210",
        })
        .catch((x: unknown) => x);
      expect(JSON.stringify(e)).not.toContain("9876543210");
    });

  it("leegality: the signer's return URL goes to its invitee's redirect setting; the sign URL is unchanged", async () => {
    const p = leegality();
    const { envelopeId } = await p.createEnvelope(
      await pdf(),
      [withBack(1), signer(2)],
      "parallel",
      [],
    );
    const d = lg.documents.get(await vendorRef(p, envelopeId))!;
    const invitations = d.invitations as Array<{ redirectUrl?: string; signUrl: string }>;
    expect(invitations[0]?.redirectUrl).toBe(back);
    expect(invitations[1]?.redirectUrl).toBeUndefined();
    const s = await p.aadhaarEsign({
      envelopeId,
      signerRef: "usr_signer_1",
      method: "AADHAAR_OTP_ESIGN",
      returnUrl: back,
    });
    expect(s.redirectUrl).toBe(invitations[0]?.signUrl);
    expect(new URL(s.redirectUrl).search).toBe("");
    // Leegality fixes it at creation: another one, or one for a signer created without, is refused.
    await expect(
      p.aadhaarEsign({
        envelopeId,
        signerRef: "usr_signer_1",
        method: "AADHAAR_OTP_ESIGN",
        returnUrl: "https://app.example.test/other",
      }),
    ).rejects.toMatchObject({ code: "IPB-PORT-001", meta: { reason: "return_url_fixed" } });
    const second = { envelopeId, signerRef: "usr_signer_2", method: "AADHAAR_OTP_ESIGN" } as const;
    await expect(p.aadhaarEsign({ ...second, returnUrl: back })).rejects.toMatchObject({
      meta: { reason: "return_url_fixed" },
    });
    expect((await p.aadhaarEsign(second)).redirectUrl).toBe(invitations[1]?.signUrl);
  });

  it("digio: the return URL is the gateway's own redirect_url parameter, the only query added", async () => {
    const p = digio();
    const { envelopeId } = await p.createEnvelope(
      await pdf(),
      [withBack(1), signer(2, "DSC")],
      "parallel",
      [],
    );
    const query = (u: string) => new URLSearchParams(u.split("?")[1] ?? "");
    const a = await p.aadhaarEsign({
      envelopeId,
      signerRef: "usr_signer_1",
      method: "AADHAAR_OTP_ESIGN",
    });
    expect([...query(a.redirectUrl).keys()]).toEqual(["redirect_url"]);
    expect(query(a.redirectUrl).get("redirect_url")).toBe(back);
    // A session's own replaces the signer's; without either, no query at all.
    const other = "https://app.example.test/loans/01JD3K7Q9M2X4B6C8D0E1F2G3J/sign/return";
    const b = await p.aadhaarEsign({
      envelopeId,
      signerRef: "usr_signer_1",
      method: "AADHAAR_OTP_ESIGN",
      returnUrl: other,
    });
    expect(query(b.redirectUrl).get("redirect_url")).toBe(other);
    expect((await p.dscSign({ envelopeId, signerRef: "usr_signer_2" })).redirectUrl).not.toContain(
      "?",
    );
    const c = await p.dscSign({ envelopeId, signerRef: "usr_signer_2", returnUrl: back });
    expect(query(c.redirectUrl).get("redirect_url")).toBe(back);
    // The record keeps the signer's, for later sessions.
    const rec = await stores.get(p)!.get(envelopeId);
    expect(rec?.signers.map((s) => s.returnUrl)).toEqual([back, undefined]);
  });
});
