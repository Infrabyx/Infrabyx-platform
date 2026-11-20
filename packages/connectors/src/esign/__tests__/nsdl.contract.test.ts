// ESIGN legs for `nsdl-esign` (Udofin PR-UDF-054, R1-D-245): an adapter shell, off and `unproven`.
// No stub: the adapter makes no network call. The port's descriptor and health checks, then what
// the shell promises: off until its flag; Aadhaar OTP and biometric eSign only (never a downgrade);
// the document checked against its SHA-256 before an envelope is kept; the unsigned CCA request
// built from fixtures; and the ASP request signature refused, because RSA XML-DSig signing is not
// an approved cryptography item (OWNER-QUESTIONS #177).
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DocumentRef, Signer } from "@infrabyx/contracts/ports";
import { sha256Hex } from "@infrabyx/crypto";
import { defineContractSuite, MemoryEsignEnvelopeStore, MemoryStorage } from "@infrabyx/testing";
import {
  NSDL_AUTH_MODE,
  NsdlEsign,
  REFUSING_ESIGN_REQUEST_SIGNER,
  buildEsignRequestXml,
} from "../nsdl.js";

const storage = new MemoryStorage();
let enabled = true;
let seq = 0;
async function pdf(): Promise<DocumentRef> {
  const body = Buffer.from(`%PDF-1.7\n% loan agreement ${++seq}\n%%EOF\n`);
  const storageKey = `tenant/tnt_n/documents/01JN00000000000000000000${String(seq).padStart(2, "0")}.pdf`;
  await storage.put(storageKey, body, { bucketClass: "REGULATED", contentType: "application/pdf" });
  return { documentId: `doc_${seq}`, sha256: sha256Hex(body), storageKey };
}
const signer = (n: number, method: Signer["method"] = "AADHAAR_OTP_ESIGN"): Signer => ({
  ref: `usr_signer_${n}`,
  name: `Signer ${n}`,
  method,
});
const make = () =>
  new NsdlEsign({
    enabled: () => enabled,
    store: new MemoryEsignEnvelopeStore(),
    storage,
    aspId: () => "ASP-TEST-01",
    responseUrl: "https://app.example.test/esign/nsdl/response",
    now: () => Date.parse("2026-11-20T06:30:00Z"),
  });

afterEach(() => {
  enabled = true;
  vi.restoreAllMocks();
});

describe("@IPB-01-15 ESIGN nsdl-esign shell (no network)", () => {
  defineContractSuite("ESIGN", make, [], { leg: "hermetic" });
});

describe("R1-D-245 the NSDL eSign shell", () => {
  it("is off until int.esign.nsdl.enabled, and health is down either way", async () => {
    enabled = false;
    const p = make();
    await expect(p.createEnvelope(await pdf(), [signer(1)], "parallel", [])).rejects.toMatchObject({
      meta: { reason: "adapter_disabled" },
    });
    expect((await p.health()).status).toBe("down");
    enabled = true;
    expect((await make().health()).status).toBe("down");
  });

  it("takes Aadhaar OTP and biometric eSign only, never downgrading another method", async () => {
    const p = make();
    const doc = await pdf();
    for (const m of ["DSC", "E_ACCEPTANCE_OTP", "ACCOUNT_ESIGN", "WET_INK"] as const)
      await expect(p.createEnvelope(doc, [signer(1, m)], "parallel", [])).rejects.toMatchObject({
        meta: { reason: "method_unsupported" },
      });
    const { envelopeId } = await p.createEnvelope(
      doc,
      [signer(1), signer(2, "AADHAAR_BIO_ESIGN")],
      "sequential",
      [],
    );
    const st = await p.sendForSignature(envelopeId);
    expect(st).toMatchObject({ envelopeId, state: "sent" });
    expect(st.signers.map((s) => [s.ref, s.state])).toEqual([
      ["usr_signer_1", "pending"],
      ["usr_signer_2", "pending"],
    ]);
    await expect(
      p.aadhaarEsign({ envelopeId, signerRef: "usr_signer_2", method: "AADHAAR_OTP_ESIGN" }),
    ).rejects.toMatchObject({ meta: { reason: "method_unsupported" } });
  });

  it("checks the document against its SHA-256 before keeping an envelope", async () => {
    const doc = await pdf();
    await expect(
      make().createEnvelope({ ...doc, sha256: "0".repeat(64) }, [signer(1)], "parallel", []),
    ).rejects.toMatchObject({ meta: { reason: "hash_mismatch" } });
  });

  it("builds the unsigned CCA request, then refuses the ASP signature (not approved), with no network call", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const signSpy = vi.spyOn(REFUSING_ESIGN_REQUEST_SIGNER, "sign");
    const p = make();
    const doc = await pdf();
    const { envelopeId } = await p.createEnvelope(doc, [signer(1)], "parallel", [], {
      idempotencyKey: "nsdl-env-0001",
    });
    await expect(
      p.aadhaarEsign({ envelopeId, signerRef: "usr_signer_1", method: "AADHAAR_OTP_ESIGN" }),
    ).rejects.toMatchObject({
      code: "IPB-PORT-001",
      meta: { reason: "unsupported", step: "asp_request_signature" },
    });
    expect(signSpy).toHaveBeenCalledTimes(1);
    const xml = signSpy.mock.calls[0]![0];
    expect(xml).toContain(
      `<InputHash id="1" hashAlgorithm="SHA256" docInfo="Loan document">${doc.sha256}</InputHash>`,
    );
    expect(xml).toContain('AuthMode="1"');
    expect(xml).toContain('aspId="ASP-TEST-01"');
    expect(xml).toContain('ts="2026-11-20T12:00:00"');
    expect(xml).toContain('ekycIdType="A"');
    // No Aadhaar number and no signature element: the signer types the number at the ESP.
    expect(xml).not.toMatch(/ekycId=|<Signature/);
    expect(xml).not.toMatch(/\d{12}/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("keeps everything that needs the ESP or a signature verifier unsupported", async () => {
    const p = make();
    for (const call of [
      () => p.dscSign(),
      () => p.downloadSigned(),
      () => p.verifySignature(),
      () => p.cancel(),
      () => p.handleWebhook(),
    ])
      await expect(call()).rejects.toMatchObject({ meta: { reason: "unsupported" } });
    expect(p.descriptor.capabilities).toMatchObject({
      aadhaarEsign: "unsupported",
      verifySignature: "unsupported",
    });
    expect(p.descriptor).toMatchObject({ residency: "IN", maxDataClass: "REGULATED" });
  });

  it("escapes and validates the request fields (fixture)", () => {
    const base = {
      txn: "txn-0001-abcd",
      ts: new Date("2026-11-20T00:00:00Z"),
      aspId: "ASP-1",
      authMode: NSDL_AUTH_MODE.AADHAAR_BIO_ESIGN!,
      responseUrl: "https://app.example.test/r?a=1&b=2",
      docs: [{ id: "1", hash: "a".repeat(64), docInfo: `Loan <"agreement"> & KFS` }],
    };
    expect(buildEsignRequestXml(base)).toBe(
      '<?xml version="1.0" encoding="UTF-8"?>' +
        '<Esign ver="2.1" sc="Y" ts="2026-11-20T05:30:00" txn="txn-0001-abcd" ekycIdType="A" aspId="ASP-1" AuthMode="2"' +
        ' responseSigType="pkcs7" responseUrl="https://app.example.test/r?a=1&amp;b=2">' +
        `<Docs><InputHash id="1" hashAlgorithm="SHA256" docInfo="Loan &lt;&quot;agreement&quot;&gt; &amp; KFS">${"a".repeat(64)}</InputHash></Docs>` +
        "</Esign>",
    );
    for (const over of [
      { txn: "short" },
      { aspId: 'A"B' },
      { authMode: "12" },
      { responseUrl: "http://app.example.test/r" },
      { docs: [] },
      { docs: [{ id: "1", hash: "A".repeat(64), docInfo: "x" }] },
    ])
      expect(() => buildEsignRequestXml({ ...base, ...over })).toThrow(/invalid eSign request/);
  });
});
