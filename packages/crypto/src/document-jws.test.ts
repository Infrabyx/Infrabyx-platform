// PR-UDF-053 (R1-D-219): the document JWS on the C-22 profile (plan R1-udofin-phase8 §C, §E).
import { describe, expect, it } from "vitest";
import {
  DOCUMENT_JWS_TYP,
  DOCUMENT_JWS_V2_TYP,
  RegulatedKeyRing,
  fromBase64Url,
  localRegulatedSigner,
  signDocumentJws,
  signDocumentJwsV2,
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

  describe("descriptor v2 (PR-UDF-061 item 13; R1-D-236)", () => {
    const d2 = {
      ...d,
      type: "KFS",
      media_type: "application/pdf",
      size_bytes: 2048,
      application_id: "app_0001",
    };

    it("signs the type, media type, size and application under its own typ, and verifies", async () => {
      const jws = await signDocumentJwsV2({ descriptor: d2, kid: s.kid, sign: s.sign });
      const header = JSON.parse(new TextDecoder().decode(fromBase64Url(jws.split(".")[0]!)));
      expect(header).toEqual({ alg: "ES256", kid: "lender-doc-1", typ: DOCUMENT_JWS_V2_TYP });
      expect(verifyDocumentJws(jws, d2, keys)).toEqual({ ok: true, kid: "lender-doc-1" });
      expect(verifyDocumentJws(jws, d2, keys, new Date(), { requireV2: true }).ok).toBe(true);
      // A whole DocumentShared payload, with fields the descriptor does not sign, verifies too.
      expect(verifyDocumentJws(jws, { ...d2, legal_hold: false } as typeof d2, keys).ok).toBe(true);
    });

    it("fails when any bound field differs, is added or is dropped", async () => {
      const jws = await signDocumentJwsV2({ descriptor: d2, kid: s.kid, sign: s.sign });
      for (const other of [
        { ...d2, type: "SANCTION_LETTER" },
        { ...d2, media_type: "application/json" },
        { ...d2, size_bytes: 2049 },
        { ...d2, application_id: "app_0002" },
        { ...d2, application_id: undefined },
        { ...d2, sha256: "b".repeat(64) },
      ])
        expect(verifyDocumentJws(jws, other, keys)).toEqual({
          ok: false,
          reason: "signature_invalid",
        });
      const without = { ...d2 } as Partial<typeof d2>;
      delete without.application_id;
      const jwsNoApp = await signDocumentJwsV2({
        descriptor: without as typeof d2,
        kid: s.kid,
        sign: s.sign,
      });
      expect(verifyDocumentJws(jwsNoApp, without as typeof d2, keys).ok).toBe(true);
      expect(verifyDocumentJws(jwsNoApp, d2, keys).ok).toBe(false);
    });

    it("is malformed against a descriptor without the v2 fields, and v1 is refused under requireV2", async () => {
      const jws = await signDocumentJwsV2({ descriptor: d2, kid: s.kid, sign: s.sign });
      expect(verifyDocumentJws(jws, d, keys)).toEqual({ ok: false, reason: "malformed" });
      const v1 = await signDocumentJws({ descriptor: d, kid: s.kid, sign: s.sign });
      // A v1 JWS still verifies against a v2-shaped descriptor (old producers), unless required.
      expect(verifyDocumentJws(v1, d2, keys).ok).toBe(true);
      expect(verifyDocumentJws(v1, d2, keys, new Date(), { requireV2: true })).toEqual({
        ok: false,
        reason: "wrong_typ",
      });
    });

    it("refuses to sign bad v2 fields", async () => {
      for (const bad of [
        { type: "kfs" },
        { media_type: "PDF" },
        { size_bytes: -1 },
        { size_bytes: 1.5 },
        { application_id: "x" },
      ])
        await expect(
          signDocumentJwsV2({ descriptor: { ...d2, ...bad }, kid: s.kid, sign: s.sign }),
          JSON.stringify(bad),
        ).rejects.toThrow();
    });
  });

  it("refuses to sign an upper-case or short hash", async () => {
    await expect(
      signDocumentJws({ descriptor: { ...d, sha256: "A".repeat(64) }, kid: s.kid, sign: s.sign }),
    ).rejects.toThrow(/lower-case/);
  });
});
