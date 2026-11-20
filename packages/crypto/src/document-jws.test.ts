// PR-UDF-053 (R1-D-219): the document JWS on the C-22 profile (plan R1-udofin-phase8 §C, §E).
import { describe, expect, it } from "vitest";
import {
  DOCUMENT_JWS_TYP,
  RegulatedKeyRing,
  fromBase64Url,
  localRegulatedSigner,
  signDocumentJws,
  verifyDocumentJws,
} from "./index.js";

const d = { document_id: "doc_kfs_0001", version: 1, sha256: "a".repeat(64) };

describe("document JWS (Ecosystem §3.6, C-22 profile)", () => {
  const s = localRegulatedSigner("lender-doc-1");
  const keys = new RegulatedKeyRing([{ kid: s.kid, key: s.publicKey }]);

  it("signs a detached JWS over the descriptor that verifies with the producer's key", async () => {
    const jws = await signDocumentJws({ descriptor: d, kid: s.kid, sign: s.sign });
    expect(jws).toMatch(/^[A-Za-z0-9_-]+\.\.[A-Za-z0-9_-]+$/);
    const header = JSON.parse(new TextDecoder().decode(fromBase64Url(jws.split(".")[0]!)));
    expect(header).toEqual({ alg: "ES256", kid: "lender-doc-1", typ: DOCUMENT_JWS_TYP });
    expect(verifyDocumentJws(jws, d, keys)).toEqual({ ok: true, kid: "lender-doc-1" });
  });

  it("fails for another hash, version or document, and for another key", async () => {
    const jws = await signDocumentJws({ descriptor: d, kid: s.kid, sign: s.sign });
    for (const other of [
      { ...d, sha256: "b".repeat(64) },
      { ...d, version: 2 },
      { ...d, document_id: "doc_kfs_0002" },
    ])
      expect(verifyDocumentJws(jws, other, keys).ok).toBe(false);
    const t = localRegulatedSigner("lender-doc-1");
    const forged = await signDocumentJws({ descriptor: d, kid: t.kid, sign: t.sign });
    expect(verifyDocumentJws(forged, d, keys)).toEqual({ ok: false, reason: "signature_invalid" });
    const u = localRegulatedSigner("someone-else");
    const stranger = await signDocumentJws({ descriptor: d, kid: u.kid, sign: u.sign });
    expect(verifyDocumentJws(stranger, d, keys)).toEqual({ ok: false, reason: "unknown_key" });
  });

  it("refuses a malformed JWS, an attached payload and a JWS of another typ", async () => {
    expect(verifyDocumentJws("x.y.z", d, keys).ok).toBe(false);
    expect(verifyDocumentJws("", d, keys)).toEqual({ ok: false, reason: "malformed" });
    const jws = await signDocumentJws({ descriptor: d, kid: s.kid, sign: s.sign });
    const [h, , sig] = jws.split(".");
    expect(verifyDocumentJws(`${h}.e30.${sig}`, d, keys)).toEqual({
      ok: false,
      reason: "malformed",
    });
  });

  it("refuses to sign an upper-case or short hash", async () => {
    await expect(
      signDocumentJws({ descriptor: { ...d, sha256: "A".repeat(64) }, kid: s.kid, sign: s.sign }),
    ).rejects.toThrow(/lower-case/);
  });
});
