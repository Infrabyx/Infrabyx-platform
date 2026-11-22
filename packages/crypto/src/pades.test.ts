// @IPB-02 C-28 (R1-D-246, R1-D-272; owner answers #162 and #178; Udofin PR-UDF-059): the
// verify-only PAdES/CMS verifier. Fixtures come from a throwaway CA made at test time
// (`pades-test`); no test key is committed. The only real certificates read are the CCA India
// roots under `docs/regulations/cca/` (public trust anchors, read to check the pins).
import { describe, expect, it } from "vitest";
import { X509Certificate, createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import {
  CCA_INDIA_TRUST,
  CCA_INDIA_ROOTS,
  CCA_INDIA_INTERMEDIATES,
  PADES_DOCUMENT_OUTCOMES,
  PADES_LIMITS,
  PADES_OUTCOMES,
  customTrustStore,
  verifyPadesSignatures,
  type PadesVerifyResult,
} from "./index.js";
import {
  appendIncrementalUpdate,
  minimalPdf,
  padesTestAuthority,
  testCertificate,
  testKey,
  type TestCert,
  type TestCertSpec,
  type TestSigner,
} from "./pades-test.js";
import { assertApproved } from "./registry.js";

const ca = padesTestAuthority();
const trust = ca.trust;
const signed = ca.sign(minimalPdf());

const one = (r: PadesVerifyResult) => {
  expect(r.signatures).toHaveLength(1);
  return r.signatures[0]!;
};
const flip = (b: Buffer, at: number): Buffer => {
  const c = Buffer.from(b);
  c[at] = c[at]! ^ 0x01;
  return c;
};
const sha = (d: Uint8Array): string => createHash("sha256").update(d).digest("hex");
const contentsRange = (pdf: Buffer): [number, number] => {
  const m = /\/ByteRange \[0 (\d+)\s+(\d+)/.exec(pdf.toString("latin1"))!;
  return [Number(m[1]), Number(m[2])];
};

describe("PAdES verification: valid signatures", () => {
  it("verifies an RSA PKCS#1 v1.5 SHA-256 CAdES-detached signature to the pinned test root", () => {
    const r = verifyPadesSignatures(signed, { trust });
    expect(r).toMatchObject({ outcome: "valid", valid: true, trustStore: "custom" });
    const s = one(r);
    expect(s).toMatchObject({
      outcome: "valid",
      valid: true,
      subFilter: "ETSI.CAdES.detached",
      coversWholeDocument: true,
      chain: "trusted",
      revocation: "not_checked",
      timestamp: "absent",
      timeSource: "signature_dictionary",
      algorithm: "rsassa-pkcs1-v1_5-sha256",
    });
    expect(s.signer?.subject).toContain("CN=Test PAdES Signer");
    expect(s.signer?.certSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(s.chainSha256).toEqual([sha(ca.signer.der), sha(ca.intermediate.der), sha(ca.root.der)]);
    expect(s.timestampChainSha256).toBeNull();
  });

  it.each([
    ["sha384", false, "rsassa-pkcs1-v1_5-sha384"],
    ["sha512", false, "rsassa-pkcs1-v1_5-sha512"],
    ["sha256", true, "rsassa-pss-sha256"],
    ["sha512", true, "rsassa-pss-sha512"],
  ] as const)("verifies RSA %s (PSS %s) as %s", (hash, pss, alg) => {
    const r = verifyPadesSignatures(ca.sign(minimalPdf(), { hash, pss }), { trust });
    expect(one(r)).toMatchObject({ outcome: "valid", algorithm: alg });
  });

  it("verifies ECDSA P-256 and P-384 signers", () => {
    for (const [kind, alg] of [
      ["ec256", "ecdsa-p256-sha256"],
      ["ec384", "ecdsa-p384-sha384"],
    ] as const) {
      const signer = ca.newSigner({ kind });
      const r = verifyPadesSignatures(ca.sign(minimalPdf(), { signer }), { trust });
      expect(one(r)).toMatchObject({ outcome: "valid", algorithm: alg });
    }
  });

  it("accepts adbe.pkcs7.detached, a signed signingTime, an SKI signer id, and no ESS attribute", () => {
    const ski = Buffer.alloc(20, 7);
    const signer = ca.newSigner({ ski });
    const at = new Date(Date.now() - 60_000);
    const r = verifyPadesSignatures(
      ca.sign(minimalPdf(), {
        signer,
        subFilter: "adbe.pkcs7.detached",
        signingTime: at,
        sidBySki: true,
        ess: false,
      }),
      { trust },
    );
    expect(one(r)).toMatchObject({
      outcome: "valid",
      subFilter: "adbe.pkcs7.detached",
      timeSource: "signing_time_attribute",
      signedAt: new Date(Math.floor(at.getTime() / 1000) * 1000).toISOString(),
    });
  });

  it("uses the verification time when no time is signed or claimed", () => {
    expect(one(verifyPadesSignatures(ca.sign(minimalPdf(), { m: null }), { trust }))).toMatchObject(
      {
        outcome: "valid",
        timeSource: "verification_time",
      },
    );
  });

  it("verifies a B-T timestamp and uses its time", () => {
    const at = new Date(Date.now() - 120_000);
    const r = verifyPadesSignatures(ca.sign(minimalPdf(), { timestamp: { at } }), { trust });
    expect(one(r)).toMatchObject({
      outcome: "valid",
      timestamp: "valid",
      timeSource: "timestamp",
      signedAt: new Date(Math.floor(at.getTime() / 1000) * 1000).toISOString(),
    });
    expect(one(r).timestampChainSha256).toEqual([
      sha(ca.tsa.der),
      sha(ca.intermediate.der),
      sha(ca.root.der),
    ]);
  });

  it("signs any classic-xref PDF and verifies two signatures in sequence", () => {
    const twice = ca.sign(ca.sign(minimalPdf()));
    const r = verifyPadesSignatures(twice, { trust });
    expect(r.outcome).toBe("valid");
    expect(r.signatures.map((s) => [s.outcome, s.coversWholeDocument])).toEqual([
      ["valid", false],
      ["valid", true],
    ]);
  });
});

describe("PAdES verification: document outcomes", () => {
  it("refuses non-PDF, oversize, unsigned input and bad options", () => {
    expect(verifyPadesSignatures(Buffer.from("hello"), { trust }).outcome).toBe("not_pdf");
    expect(verifyPadesSignatures(signed, { trust, maxBytes: 100 }).outcome).toBe("too_large");
    expect(verifyPadesSignatures(minimalPdf(), { trust }).outcome).toBe("no_signature");
    expect(() => verifyPadesSignatures(signed, { maxBytes: 65 * 1024 * 1024 })).toThrow(RangeError);
    expect(() =>
      verifyPadesSignatures(signed, {
        trust: { id: "cca-india", roots: [], intermediates: [] },
      }),
    ).toThrow(TypeError);
  });

  it("reports an incremental update after the only signature as a distinct outcome", () => {
    const r = verifyPadesSignatures(appendIncrementalUpdate(signed), { trust });
    expect(r).toMatchObject({ outcome: "incremental_update_after_signature", valid: false });
    expect(one(r)).toMatchObject({ outcome: "valid", coversWholeDocument: false });
  });

  it("caps the number of signatures", () => {
    let pdf = minimalPdf();
    for (let i = 0; i < 17; i++) pdf = ca.sign(pdf, { contentsBytes: 4096 });
    expect(verifyPadesSignatures(pdf, { trust }).outcome).toBe("too_many_signatures");
  });

  it("uses only fixed labels", () => {
    const r = verifyPadesSignatures(flip(signed, 20), { trust });
    expect(PADES_DOCUMENT_OUTCOMES).toContain(r.outcome);
    for (const s of r.signatures) expect(PADES_OUTCOMES).toContain(s.outcome);
  });
});

describe("PAdES verification: refusals", () => {
  it("a tampered covered byte is digest_mismatch", () => {
    const r = verifyPadesSignatures(flip(signed, 30), { trust });
    expect(r.outcome).toBe("invalid");
    expect(one(r).outcome).toBe("digest_mismatch");
  });

  it("a ByteRange that leaves a gap other than /Contents is malformed", () => {
    const s = signed.toString("latin1");
    const [b] = contentsRange(signed);
    expect(String(b - 1)).toHaveLength(String(b).length);
    // The first range ends one byte early: one covered byte is outside both ranges.
    const shifted = s.replace(`/ByteRange [0 ${b} `, `/ByteRange [0 ${b - 1} `);
    expect(shifted).not.toBe(s);
    const r = verifyPadesSignatures(Buffer.from(shifted, "latin1"), { trust });
    expect(one(r)).toMatchObject({ outcome: "malformed", signer: null });
  });

  it("a hostile file with many /ByteRange keys in one large object stays bounded", () => {
    const big = `%PDF-1.7\n1 0 obj\n<< /X <${"0".repeat(3 * 1024 * 1024)}> ${"/ByteRange [0 1 2 3] ".repeat(1)}${Array.from({ length: 15 }, (_, i) => `/K${i} << /ByteRange [0 1 2 3] >>`).join(" ")} >>\nendobj\n`;
    const t0 = Date.now();
    const r = verifyPadesSignatures(Buffer.from(big, "latin1"), { trust });
    expect(r.outcome).toBe("invalid");
    expect(r.signatures).toHaveLength(16);
    expect(r.signatures.every((x) => x.outcome === "malformed")).toBe(true);
    expect(Date.now() - t0).toBeLessThan(5000);
  });

  it("a ByteRange past the end of the file is malformed", () => {
    const cut = signed.subarray(0, signed.length - 10);
    expect(one(verifyPadesSignatures(cut, { trust })).outcome).toBe("malformed");
  });

  it("another root is chain_untrusted; an unpinned CA past a pathLen 0 intermediate too", () => {
    const other = padesTestAuthority();
    expect(one(verifyPadesSignatures(signed, { trust: other.trust }))).toMatchObject({
      outcome: "chain_untrusted",
      chain: "untrusted",
      chainSha256: null,
    });
    // The unpinned CA is carried in the CMS, but the intermediate above it has pathLen 0.
    const viaUnpinned = ca.sign(minimalPdf(), { signer: ca.newSigner({ issuer: "unpinned" }) });
    expect(one(verifyPadesSignatures(viaUnpinned, { trust })).outcome).toBe("chain_untrusted");
  });

  it("the default CCA India store refuses a chain to another root", () => {
    const r = verifyPadesSignatures(signed);
    expect(r.trustStore).toBe("cca-india");
    expect(r.outcome).toBe("invalid");
    expect(one(r)).toMatchObject({ outcome: "chain_untrusted", chainSha256: null });
    expect(CCA_INDIA_TRUST.id).toBe("cca-india");
  });

  it("a signer expired at the signing time is not_valid_at_signing_time", () => {
    const signer = ca.newSigner({
      notBefore: new Date(Date.now() - 10 * 86_400_000),
      notAfter: new Date(Date.now() - 86_400_000),
    });
    const r = verifyPadesSignatures(ca.sign(minimalPdf(), { signer }), { trust });
    expect(one(r).outcome).toBe("not_valid_at_signing_time");
    // …and valid when the signed time falls inside its validity.
    const earlier = ca.sign(minimalPdf(), {
      signer,
      signingTime: new Date(Date.now() - 2 * 86_400_000),
    });
    expect(one(verifyPadesSignatures(earlier, { trust })).outcome).toBe("valid");
  });

  it("a signing time in the future is refused", () => {
    const pdf = ca.sign(minimalPdf(), { signingTime: new Date(Date.now() + 3600_000) });
    expect(one(verifyPadesSignatures(pdf, { trust })).outcome).toBe("signing_time_in_future");
  });

  it.each([
    ["1.3.14.3.2.26", "weak_algorithm"],
    ["1.2.840.113549.2.5", "weak_algorithm"],
    ["2.16.840.1.101.3.4.2.4", "unsupported_algorithm"],
  ])("CMS digest algorithm %s is %s", (digestOid, label) => {
    const r = verifyPadesSignatures(ca.sign(minimalPdf(), { digestOid }), { trust });
    expect(one(r).outcome).toBe(label);
  });

  it.each([
    ["1.2.840.113549.1.1.5", "weak_algorithm"],
    ["1.2.840.113549.1.1.4", "weak_algorithm"],
    ["1.2.840.113549.1.1.14", "unsupported_algorithm"],
    ["1.2.840.113549.1.1.12", "unsupported_algorithm"],
  ])("CMS signature algorithm %s is %s", (sigAlgOid, label) => {
    const r = verifyPadesSignatures(ca.sign(minimalPdf(), { sigAlgOid }), { trust });
    expect(one(r).outcome).toBe(label);
  });

  it("a SHA-1 certificate signature fails the chain as weak_algorithm", () => {
    const signer = ca.newSigner({ algOid: "1.2.840.113549.1.1.5" });
    const r = verifyPadesSignatures(ca.sign(minimalPdf(), { signer }), { trust });
    expect(one(r).outcome).toBe("weak_algorithm");
  });

  it("a signature over other attributes is signature_invalid", () => {
    const pdf = ca.sign(minimalPdf());
    const s = pdf.toString("latin1");
    // Flip a bit inside the signature value: the last bytes of the DER before the zero padding.
    const [b] = contentsRange(pdf);
    const hex = /<([0-9a-f]+)>/.exec(s.slice(b))![1]!.replace(/(00)+$/, "");
    const at = b + 1 + hex.length - 4;
    const ch = s[at] === "0" ? "1" : "0";
    const bad = Buffer.from(s.slice(0, at) + ch + s.slice(at + 1), "latin1");
    expect(one(verifyPadesSignatures(bad, { trust })).outcome).toBe("signature_invalid");
  });

  it("an ESS hash of another certificate is signer_certificate_mismatch", () => {
    const r = verifyPadesSignatures(ca.sign(minimalPdf(), { ess: "wrong" }), { trust });
    expect(one(r).outcome).toBe("signer_certificate_mismatch");
  });

  it("no signer certificate in the CMS is signer_certificate_missing", () => {
    const r = verifyPadesSignatures(ca.sign(minimalPdf(), { certificates: "none" }), { trust });
    expect(one(r).outcome).toBe("signer_certificate_missing");
  });

  it("intermediates come from the pinned store, not only from the CMS", () => {
    const r = verifyPadesSignatures(ca.sign(minimalPdf(), { certificates: "signer" }), { trust });
    expect(one(r).outcome).toBe("valid");
  });

  it.each([
    [{ keyUsage: [5] }, "key_usage_not_allowed"],
    [{ keyUsage: [] }, "key_usage_not_allowed"],
    [{ eku: ["1.3.6.1.5.5.7.3.1"] }, "key_usage_not_allowed"],
    [{ eku: ["1.3.6.1.5.5.7.3.36"] }, "valid"],
    [{ unknownCritical: true }, "chain_untrusted"],
  ] as const)("signer %j is %s", (opts, label) => {
    const o = opts as {
      keyUsage?: readonly number[];
      eku?: readonly string[];
      unknownCritical?: boolean;
    };
    const signer = ca.newSigner({
      keyUsage: [...(o.keyUsage ?? [0, 1])],
      ...(o.eku ? { eku: [...o.eku] } : {}),
      ...(o.unknownCritical ? { unknownCritical: true } : {}),
    });
    const r = verifyPadesSignatures(ca.sign(minimalPdf(), { signer }), { trust });
    expect(one(r).outcome).toBe(label);
  });

  it("a signer issued by the root directly is valid (the path need not use an intermediate)", () => {
    const signer = ca.newSigner({ issuer: "root" });
    const r = verifyPadesSignatures(ca.sign(minimalPdf(), { signer }), { trust });
    expect(one(r).outcome).toBe("valid");
  });

  it("an unsupported /SubFilter is refused", () => {
    for (const subFilter of ["adbe.pkcs7.sha1", "ETSI.RFC3161", "adbe.x509.rsa_sha1"]) {
      const r = verifyPadesSignatures(ca.sign(minimalPdf(), { subFilter }), { trust });
      expect(one(r)).toMatchObject({ outcome: "unsupported_subfilter", subFilter: null });
    }
  });

  it("a timestamp over another value is timestamp_invalid; an untrusted TSA is not used", () => {
    expect(
      one(
        verifyPadesSignatures(ca.sign(minimalPdf(), { timestamp: { wrongImprint: true } }), {
          trust,
        }),
      ),
    ).toMatchObject({ outcome: "timestamp_invalid", timestamp: "invalid" });
    const other = padesTestAuthority();
    const r = one(
      verifyPadesSignatures(ca.sign(minimalPdf(), { timestamp: { tsa: other.tsa } }), { trust }),
    );
    expect(r).toMatchObject({
      outcome: "valid",
      timestamp: "untrusted",
      timeSource: "signature_dictionary",
    });
    // A TSA without the timeStamping usage is invalid.
    const notTsa = ca.newSigner();
    expect(
      one(verifyPadesSignatures(ca.sign(minimalPdf(), { timestamp: { tsa: notTsa } }), { trust }))
        .outcome,
    ).toBe("timestamp_invalid");
  });
});

describe("PAdES verification: caller-supplied revocation evidence", () => {
  const serial = ca.signer.serial;

  it("a current CRL from the issuer covering every certificate is good", () => {
    const rootCrl = ca.crl({ issuer: "root" });
    const r = verifyPadesSignatures(signed, {
      trust,
      revocation: { crls: [ca.crl(), rootCrl] },
    });
    expect(one(r)).toMatchObject({ outcome: "valid", revocation: "good" });
  });

  it("evidence for the signer only leaves the intermediate not_checked", () => {
    const r = verifyPadesSignatures(signed, { trust, revocation: { crls: [ca.crl()] } });
    expect(one(r)).toMatchObject({ outcome: "valid", revocation: "not_checked" });
  });

  it("a CRL listing the signer is certificate_revoked", () => {
    const r = verifyPadesSignatures(signed, {
      trust,
      revocation: { crls: [ca.crl({ revoked: [serial] })] },
    });
    expect(r.valid).toBe(false);
    expect(one(r)).toMatchObject({ outcome: "certificate_revoked", revocation: "revoked" });
  });

  it("stale, wrongly signed, critical-extension or wrong-issuer CRLs do not count", () => {
    const now = Date.now();
    for (const crl of [
      ca.crl({
        revoked: [serial],
        nextUpdate: new Date(now - 3600_000),
        thisUpdate: new Date(now - 7200_000),
      }),
      ca.crl({ revoked: [serial], wrongKey: true }),
      ca.crl({ revoked: [serial], critical: true }),
      ca.crl({ revoked: [serial], nextUpdate: null }),
      padesTestAuthority().crl({ revoked: [serial] }),
      Buffer.from("not a crl"),
    ]) {
      const r = verifyPadesSignatures(signed, { trust, revocation: { crls: [crl] } });
      expect(one(r)).toMatchObject({ outcome: "valid", revocation: "not_checked" });
    }
  });

  it("OCSP: good from the CA or a delegated responder, revoked, unknown, untrusted", () => {
    const rootCrl = ca.crl({ issuer: "root" });
    const check = (ocsp: Buffer) =>
      one(verifyPadesSignatures(signed, { trust, revocation: { ocsp: [ocsp], crls: [rootCrl] } }));
    expect(check(ca.ocsp(serial))).toMatchObject({ outcome: "valid", revocation: "good" });
    expect(check(ca.ocsp(serial, { responder: "delegated" })).revocation).toBe("good");
    expect(check(ca.ocsp(serial, { certIdHash: "sha1" })).revocation).toBe("good");
    expect(check(ca.ocsp(serial, { status: "revoked" })).outcome).toBe("certificate_revoked");
    expect(check(ca.ocsp(serial, { status: "unknown" })).revocation).toBe("not_checked");
    expect(check(ca.ocsp(serial, { responder: "untrusted", status: "revoked" })).revocation).toBe(
      "not_checked",
    );
    expect(check(ca.ocsp(Buffer.from([1, 2, 3]))).revocation).toBe("not_checked");
    expect(check(ca.ocsp(serial, { responseStatus: 6 })).revocation).toBe("not_checked");
    expect(
      check(
        ca.ocsp(serial, {
          thisUpdate: new Date(Date.now() - 3 * 86_400_000),
          nextUpdate: new Date(Date.now() - 2 * 86_400_000),
        }),
      ).revocation,
    ).toBe("not_checked");
  });

  it("too much evidence is an options error", () => {
    expect(() =>
      verifyPadesSignatures(signed, { trust, revocation: { crls: Array(17).fill(ca.crl()) } }),
    ).toThrow(RangeError);
  });
});

describe("PAdES verification: hostile input never throws", () => {
  it("survives truncations and byte flips across the signature dictionary and CMS", () => {
    const [b, c] = contentsRange(signed);
    const start = signed.lastIndexOf("obj", b) - 10;
    let seen = 0;
    for (let i = 0; i < 400; i++) {
      const at = start + Math.floor(((c - start) * i) / 400);
      const mutated = Buffer.from(signed);
      mutated[at] = (mutated[at]! + 1 + (i % 250)) & 0xff;
      const r = verifyPadesSignatures(mutated, { trust });
      expect(PADES_DOCUMENT_OUTCOMES).toContain(r.outcome);
      if (!r.valid) seen++;
    }
    for (let n = 0; n < signed.length; n += 997) {
      const r = verifyPadesSignatures(signed.subarray(0, n), { trust });
      expect(PADES_DOCUMENT_OUTCOMES).toContain(r.outcome);
    }
    expect(seen).toBeGreaterThan(0);
  });

  it("random CMS bytes in /Contents are cms_malformed, BER is refused", () => {
    const [b, c] = contentsRange(signed);
    const s = Buffer.from(signed);
    const junk = Buffer.from("3080" + "00".repeat(10), "hex").toString("hex");
    s.write(junk.padEnd(c - b - 2, "0"), b + 1, "latin1");
    expect(one(verifyPadesSignatures(s, { trust })).outcome).toBe("cms_malformed");
  });

  it("deeply nested or oversized dictionaries do not crash the tokeniser", () => {
    const deep = Buffer.from(
      `%PDF-1.7\n1 0 obj\n${"<< /A ".repeat(5000)}/ByteRange [0 1 2 3]${" >>".repeat(5000)}\nendobj\n`,
      "latin1",
    );
    expect(one(verifyPadesSignatures(deep, { trust })).outcome).toBe("malformed");
  });
});

describe("C-28 registry and scope", () => {
  it("registers every algorithm the verifier uses as approved, verify only", () => {
    for (const id of [
      "sha-256",
      "sha-384",
      "sha-512",
      "rsassa-pkcs1-v1_5-sha256",
      "rsassa-pkcs1-v1_5-sha384",
      "rsassa-pkcs1-v1_5-sha512",
      "rsassa-pss-sha256",
      "rsassa-pss-sha384",
      "rsassa-pss-sha512",
      "ecdsa-p256-sha256",
      "ecdsa-p384-sha384",
    ])
      expect(() => assertApproved(id)).not.toThrow();
  });

  it("the verifier modules never sign and never reach the network", () => {
    for (const f of [
      "pades.ts",
      "pades-x509.ts",
      "pades-cms.ts",
      "pades-pdf.ts",
      "pades-revocation.ts",
      "der.ts",
      "cca-india-trust.ts",
      "signer-certificate.ts",
    ]) {
      const src = readFileSync(new URL(f, import.meta.url), "utf8");
      expect(src).not.toMatch(/\bsign\(|createSign|privateKey|node:(https?|net|tls|dns)|fetch\(/);
      expect(src).not.toMatch(/createHash\("(sha1|md5)"\)/);
    }
  });
});

// ---------------------------------------------------------------- R1-D-272 (owner answer #178)

const ROOT_CN = "Test PAdES Root CA";
interface CaNode {
  cn: string;
  cert: TestCert;
}
const rootNode: CaNode = { cn: ROOT_CN, cert: ca.root };
/** Only the test root is pinned: every intermediate must come from the CMS set. */
const rootOnly = customTrustStore({ roots: [ca.root.der] });
const subCa = (
  parent: CaNode,
  cn: string,
  o: Omit<Partial<TestCertSpec>, "subject" | "issuer" | "key" | "issuerKey"> = {},
): CaNode => ({
  cn,
  cert: testCertificate({
    subject: cn,
    issuer: parent.cn,
    key: testKey("ec256"),
    issuerKey: parent.cert.key,
    ca: true,
    ...o,
  }),
});
/** A signer under `parent` whose CMS carries `chain` (in that order). */
const signerUnder = (
  parent: CaNode,
  chain: readonly TestCert[],
  o: Partial<Pick<TestCertSpec, "keyUsage" | "eku">> = {},
): TestSigner => ({
  ...testCertificate({
    subject: "Test PAdES Signer",
    issuer: parent.cn,
    key: testKey("ec256"),
    issuerKey: parent.cert.key,
    keyUsage: [0, 1],
    ...o,
  }),
  chain: chain.map((c) => c.der),
});
const verifyWith = (signer: TestSigner, store = rootOnly) =>
  one(verifyPadesSignatures(ca.sign(minimalPdf(), { signer }), { trust: store }));

describe("PAdES verification: intermediates carried in the CMS (R1-D-272)", () => {
  it("a path through a CMS-carried intermediate validates to a root-only store and reports chainSha256", () => {
    const r = one(verifyPadesSignatures(signed, { trust: rootOnly }));
    expect(r).toMatchObject({ outcome: "valid", chain: "trusted" });
    expect(r.chainSha256).toEqual([sha(ca.signer.der), sha(ca.intermediate.der), sha(ca.root.der)]);
  });

  it("the same intermediate absent from the CMS is chain_untrusted", () => {
    const r = one(
      verifyPadesSignatures(ca.sign(minimalPdf(), { certificates: "signer" }), {
        trust: rootOnly,
      }),
    );
    expect(r).toMatchObject({ outcome: "chain_untrusted", chain: "untrusted", chainSha256: null });
  });

  it.each([
    ["cA FALSE (no basicConstraints)", { ca: false, keyUsage: [5, 6] }],
    ["keyUsage without keyCertSign", { keyUsage: [6] }],
    ["no keyUsage", { keyUsage: [] }],
    ["an unknown critical extension", { unknownCritical: true }],
  ] as const)("a carried intermediate with %s fails the path", (_, o) => {
    const inter = subCa(rootNode, "Test Carried Sub CA", {
      ...("ca" in o ? { ca: o.ca } : {}),
      ...("keyUsage" in o ? { keyUsage: [...o.keyUsage] } : {}),
      ...("unknownCritical" in o ? { unknownCritical: true } : {}),
    });
    expect(verifyWith(signerUnder(inter, [inter.cert]))).toMatchObject({
      outcome: "chain_untrusted",
      chainSha256: null,
    });
  });

  it("a pinned intermediate without keyUsage is still accepted (unchanged behaviour)", () => {
    const inter = subCa(rootNode, "Test Pinned Sub CA", { keyUsage: [] });
    const pinnedStore = customTrustStore({ roots: [ca.root.der], intermediates: [inter.cert.der] });
    expect(verifyWith(signerUnder(inter, [inter.cert]), pinnedStore).outcome).toBe("valid");
    expect(verifyWith(signerUnder(inter, []), pinnedStore).outcome).toBe("valid");
  });

  it.each([
    ["nameConstraints", "2.5.29.30"],
    ["policyConstraints", "2.5.29.36"],
    ["inhibitAnyPolicy", "2.5.29.54"],
    ["certificatePolicies", "2.5.29.32"],
    ["policyMappings", "2.5.29.33"],
  ])("a critical %s (%s) on a carried intermediate fails the path (not processed)", (_, oid) => {
    const inter = subCa(rootNode, "Test Carried Sub CA", { criticalOids: [oid] });
    expect(verifyWith(signerUnder(inter, [inter.cert])).outcome).toBe("chain_untrusted");
    // …and the same extension not marked critical is ignored.
    const plain = subCa(rootNode, "Test Carried Sub CA");
    expect(verifyWith(signerUnder(plain, [plain.cert])).outcome).toBe("valid");
  });

  it("pathLenConstraint is honoured for carried intermediates", () => {
    const tight = subCa(rootNode, "Test Upper CA", { pathLen: 0 });
    const lower = subCa(tight, "Test Lower CA");
    expect(verifyWith(signerUnder(lower, [lower.cert, tight.cert])).outcome).toBe(
      "chain_untrusted",
    );
    const roomy = subCa(rootNode, "Test Upper CA", { pathLen: 1 });
    const lower2 = subCa(roomy, "Test Lower CA");
    const r = verifyWith(signerUnder(lower2, [lower2.cert, roomy.cert]));
    expect(r.outcome).toBe("valid");
    expect(r.chainSha256).toHaveLength(4);
  });

  it(`a path of ${PADES_LIMITS.maxPath} certificates validates; one of 7 fails`, () => {
    const cas: CaNode[] = [];
    let parent = rootNode;
    for (let i = 1; i <= 5; i++) {
      parent = subCa(parent, `Test Level ${i} CA`);
      cas.push(parent);
    }
    const four = cas.slice(0, 4);
    const r6 = verifyWith(signerUnder(four[3]!, four.map((c) => c.cert).reverse()));
    expect(r6.outcome).toBe("valid");
    expect(r6.chainSha256).toHaveLength(6);
    const r7 = verifyWith(signerUnder(cas[4]!, cas.map((c) => c.cert).reverse()));
    expect(r7).toMatchObject({ outcome: "chain_untrusted", chainSha256: null });
  });

  it("a carried intermediate expired at the signing time is not_valid_at_signing_time", () => {
    const inter = subCa(rootNode, "Test Expired Sub CA", {
      notBefore: new Date(Date.now() - 10 * 86_400_000),
      notAfter: new Date(Date.now() - 86_400_000),
    });
    const r = verifyWith(signerUnder(inter, [inter.cert]));
    expect(r).toMatchObject({ outcome: "not_valid_at_signing_time", chain: "trusted" });
    expect(r.chainSha256).toEqual([r.signer!.certSha256, sha(inter.cert.der), sha(ca.root.der)]);
  });

  it(`only the first ${PADES_LIMITS.maxChainCandidates} carried certificates are considered`, () => {
    const fillerKey = testKey("ec256");
    const fillers = Array.from({ length: PADES_LIMITS.maxChainCandidates }, (_, i) =>
      testCertificate({
        subject: `Test Filler CA ${i}`,
        issuer: `Test Filler CA ${i}`,
        key: fillerKey,
        issuerKey: fillerKey,
        ca: true,
      }),
    );
    const inter = subCa(rootNode, "Test Carried Sub CA");
    const within = [...fillers.slice(1), inter.cert];
    expect(verifyWith(signerUnder(inter, within)).outcome).toBe("valid");
    const past = [...fillers, inter.cert];
    expect(verifyWith(signerUnder(inter, past)).outcome).toBe("chain_untrusted");
  });

  it.each([
    // Each CA signed by the next one's key: one valid issuer each, many signature checks.
    ["a ring", (i: number, n: number) => [i, (i + 1) % n] as const],
    // Every CA with the same key: each is a valid issuer of every other, so an unbounded search
    // would walk 31 x 30 x 29 x 28 x 27 (about 20 million) paths.
    ["one shared key", () => [0, 0] as const],
  ])("a hostile set of look-alike CAs (%s) fails quickly as chain_untrusted", (_, keyOf) => {
    // 31 look-alikes and the signer: the most certificates a CMS set may carry (32).
    const n = 31;
    const keys = Array.from({ length: n }, () => testKey("ec256"));
    const cn = "Test Look-alike CA";
    const mesh = keys.map((_k, i) => {
      const [own, by] = keyOf(i, n);
      return testCertificate({
        subject: cn,
        issuer: cn,
        key: keys[own]!,
        issuerKey: keys[by]!,
        ca: true,
      });
    });
    const leaf = signerUnder({ cn, cert: mesh[0]! }, mesh);
    const t0 = performance.now();
    const r = verifyWith(leaf);
    expect(r).toMatchObject({ outcome: "chain_untrusted", chain: "untrusted", chainSha256: null });
    expect(performance.now() - t0).toBeLessThan(1000);
    // The same set against the store with the real intermediate pinned still fails.
    expect(verifyWith(leaf, trust).outcome).toBe("chain_untrusted");
  });

  it("the TSA chain may use an intermediate carried in the timestamp token", () => {
    const r = one(
      verifyPadesSignatures(ca.sign(minimalPdf(), { timestamp: true }), { trust: rootOnly }),
    );
    expect(r).toMatchObject({ outcome: "valid", timestamp: "valid", timeSource: "timestamp" });
    expect(r.timestampChainSha256).toEqual([
      sha(ca.tsa.der),
      sha(ca.intermediate.der),
      sha(ca.root.der),
    ]);
    // Without the intermediate in the token, the TSA is untrusted and its time is not used.
    const bare: TestSigner = { ...ca.tsa, chain: [] };
    const u = one(
      verifyPadesSignatures(ca.sign(minimalPdf(), { timestamp: { tsa: bare } }), {
        trust: rootOnly,
      }),
    );
    expect(u).toMatchObject({
      outcome: "valid",
      timestamp: "untrusted",
      timestampChainSha256: null,
      timeSource: "signature_dictionary",
    });
  });
});

describe("PAdES verification: requireTimestamp (R1-D-272)", () => {
  it("is off by default: a signature without a timestamp is valid", () => {
    expect(one(verifyPadesSignatures(signed, { trust })).outcome).toBe("valid");
    expect(PADES_OUTCOMES).toContain("timestamp_required");
  });

  it("refuses a signature with no verified timestamp, accepts one with a valid timestamp", () => {
    const r = verifyPadesSignatures(signed, { trust, requireTimestamp: true });
    expect(r).toMatchObject({ outcome: "invalid", valid: false });
    expect(one(r)).toMatchObject({
      outcome: "timestamp_required",
      valid: false,
      timestamp: "absent",
      chain: "trusted",
    });
    const stamped = ca.sign(minimalPdf(), { timestamp: true });
    expect(verifyPadesSignatures(stamped, { trust, requireTimestamp: true })).toMatchObject({
      outcome: "valid",
    });
    const untrustedTsa = ca.sign(minimalPdf(), { timestamp: { tsa: padesTestAuthority().tsa } });
    expect(
      one(verifyPadesSignatures(untrustedTsa, { trust, requireTimestamp: true })),
    ).toMatchObject({ outcome: "timestamp_required", timestamp: "untrusted" });
  });

  it("is evaluated last: other refusals take precedence", () => {
    const req = { trust, requireTimestamp: true } as const;
    expect(one(verifyPadesSignatures(flip(signed, 30), req)).outcome).toBe("digest_mismatch");
    expect(
      one(verifyPadesSignatures(signed, { ...req, trust: padesTestAuthority().trust })).outcome,
    ).toBe("chain_untrusted");
    expect(
      one(verifyPadesSignatures(ca.sign(minimalPdf(), { timestamp: { wrongImprint: true } }), req))
        .outcome,
    ).toBe("timestamp_invalid");
    expect(
      one(
        verifyPadesSignatures(signed, {
          ...req,
          revocation: { crls: [ca.crl({ revoked: [ca.signer.serial] })] },
        }),
      ).outcome,
    ).toBe("certificate_revoked");
  });
});

describe("CCA India pinned roots (owner answer #178, R1-D-271, R1-D-272)", () => {
  const dir = new URL("../../../docs/regulations/cca/", import.meta.url);
  const derOf = (file: string): Buffer =>
    Buffer.from(
      readFileSync(new URL(file, dir), "latin1")
        .replace(/-----(BEGIN|END) CERTIFICATE-----/g, "")
        .replace(/[^A-Za-z0-9+/=]/g, ""),
      "base64",
    );
  const files = Object.fromEntries(
    readdirSync(dir)
      .filter((f) => f.endsWith(".cer"))
      .map((f) => [f, sha(derOf(f))]),
  );
  const EXISTING = {
    "CCAIndia2022.cer": "9a3fd3176798e842ddcb12c262f11cfacca70a8b84c6ea6fda30842a95a94cd8",
    "CCAIndia2022SPL.cer": "b724689b79b2ef9421ef8f5cc733eb093851b170ee715177005a09f226d8c91a",
  };
  const EXPIRED = {
    "CCAIndia2014.cer": "60109bc6c38328598a112c7a25e38b0f23e5a7511cb815fb64e0c4ff05db7df7",
    "CCAIndia2015.cer": "c34c5df53080078ffe45b21a7f600469917204f4f0293f1d7209393e5265c04f",
  };

  it("the files under docs/regulations/cca have the fingerprints in SOURCES.md", () => {
    expect(files).toEqual({ ...EXISTING, ...EXPIRED });
  });

  it("pins exactly the two existing roots, as canonical PEM byte-identical to the files' DER", () => {
    expect(CCA_INDIA_ROOTS.map((p) => [p.label, p.sha256])).toEqual([
      ["CCA India 2022", EXISTING["CCAIndia2022.cer"]],
      ["CCA India 2022 SPL", EXISTING["CCAIndia2022SPL.cer"]],
    ]);
    const canonical =
      /^-----BEGIN CERTIFICATE-----\n(?:[A-Za-z0-9+/]{64}\n)*[A-Za-z0-9+/=]{1,64}\n-----END CERTIFICATE-----\n$/;
    for (const [p, file] of [
      [CCA_INDIA_ROOTS[0]!, "CCAIndia2022.cer"],
      [CCA_INDIA_ROOTS[1]!, "CCAIndia2022SPL.cer"],
    ] as const) {
      expect(p.pem).toMatch(canonical);
      const raw = new X509Certificate(p.pem).raw;
      expect(raw.equals(derOf(file))).toBe(true);
      expect(sha(raw)).toBe(p.sha256);
    }
    // The SPL file is not canonical PEM as served (CRLF): only the code's copy is normalised.
    expect(readFileSync(new URL("CCAIndia2022SPL.cer", dir), "latin1")).toContain("\r\n");
  });

  it("the store holds exactly those two roots, no intermediate, and not the expired roots", () => {
    expect([...CCA_INDIA_TRUST.roots].sort()).toEqual(Object.values(EXISTING).sort());
    expect(CCA_INDIA_TRUST.intermediates).toEqual([]);
    expect(CCA_INDIA_INTERMEDIATES).toHaveLength(0);
    for (const fp of Object.values(EXPIRED)) expect(CCA_INDIA_TRUST.roots).not.toContain(fp);
  });
});
