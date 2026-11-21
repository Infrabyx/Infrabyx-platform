// @IPB-01-15 ESIGN signer certificate summaries (Udofin PR-UDF-070, R1-D-251): field reading of the
// ESP's certificate, and the signer certificate of each signature embedded in a signed PDF.
// Certificates come from the throwaway `pades-test` CA (and, for names it cannot write, the
// openssl CLI); no real certificate or key is used or committed.
import { execFileSync } from "node:child_process";
import { createHash, X509Certificate } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  padesSignerCertificates,
  signerCertificateSummary,
  verifyPadesSignatures,
} from "./index.js";
import { appendIncrementalUpdate, minimalPdf, padesTestAuthority, pem } from "./pades-test.js";

const ca = padesTestAuthority({ kind: "ec256" });
const notBefore = new Date("2026-11-01T00:00:00Z");
const notAfter = new Date("2026-11-30T23:59:59Z");
const alice = ca.newSigner({ kind: "ec256", subject: "Alice Test", notBefore, notAfter });
const bob = ca.newSigner({ kind: "ec256", subject: "Bob Test" });

const opensslCert = (subj: string): string =>
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "ec",
      "-pkeyopt",
      "ec_paramgen_curve:P-256",
      "-nodes",
      "-utf8",
      "-subj",
      subj,
      "-keyout",
      "/dev/null",
      "-days",
      "1",
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  );

describe("signerCertificateSummary (PR-UDF-070)", () => {
  it("reads serial, issuer, validity, DER SHA-256 and the subject CN, from DER or PEM alike", () => {
    const s = signerCertificateSummary(alice.der);
    const x = new X509Certificate(alice.der);
    expect(s).toEqual({
      serialNumber: x.serialNumber,
      issuer: x.issuer,
      notBefore: "2026-11-01T00:00:00.000Z",
      notAfter: "2026-11-30T23:59:59.000Z",
      sha256: createHash("sha256").update(alice.der).digest("hex"),
      subjectCommonName: "Alice Test",
    });
    expect(s.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(s.issuer).toContain("CN=Test PAdES Sub CA");
    expect(signerCertificateSummary(pem(alice.der))).toEqual(s);
    // The first certificate of a PEM bundle.
    expect(signerCertificateSummary(pem(alice.der) + pem(ca.intermediate.der))).toEqual(s);
  });

  it("decodes a UTF-8 common name and omits a missing one", () => {
    expect(
      signerCertificateSummary(opensslCert("/O=Test Org/CN=Tëst Ñame")).subjectCommonName,
    ).toBe("Tëst Ñame");
    const none = signerCertificateSummary(opensslCert("/O=Test Org"));
    expect(none).not.toHaveProperty("subjectCommonName");
    expect(none.serialNumber).toMatch(/^[0-9A-F]+$/);
  });

  it("refuses anything that is not one certificate, with a fixed message", () => {
    for (const bad of [
      new Uint8Array([0x30, 0x03, 0x02, 0x01, 0x01]),
      new Uint8Array(),
      "not a certificate",
      Buffer.from(alice.der).toString("base64"),
      "-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n",
    ])
      expect(() => signerCertificateSummary(bad)).toThrow(
        new TypeError("not an X.509 certificate"),
      );
  });
});

describe("padesSignerCertificates (PR-UDF-070)", () => {
  const once = ca.sign(minimalPdf(), { signer: alice });
  const twice = ca.sign(once, { signer: bob });

  it("names each embedded signature's certificate in file order, as the verifier's signer block", () => {
    const certs = padesSignerCertificates(twice);
    expect(certs).toEqual([signerCertificateSummary(alice.der), signerCertificateSummary(bob.der)]);
    const v = verifyPadesSignatures(twice, {
      trust: ca.trust,
      now: new Date("2026-11-15T00:00:00Z"),
    });
    expect(v.signatures.map((s) => s.signer?.certSha256)).toEqual(certs.map((c) => c?.sha256));
    expect(v.signatures.map((s) => s.signer?.serial)).toEqual(certs.map((c) => c?.serialNumber));
  });

  it("does not judge trust: a certificate under an unpinned CA is still named", () => {
    const stranger = ca.newSigner({ kind: "ec256", issuer: "unpinned", subject: "Stranger Test" });
    const pdf = ca.sign(minimalPdf(), { signer: stranger });
    expect(verifyPadesSignatures(pdf, { trust: ca.trust }).signatures[0]?.outcome).toBe(
      "chain_untrusted",
    );
    expect(padesSignerCertificates(pdf)[0]?.subjectCommonName).toBe("Stranger Test");
  });

  it("a signature not bound to its certificate is null; an appended update keeps the names", () => {
    const flipped = Buffer.from(once);
    const at = once.indexOf("/Type /Catalog");
    flipped[at + 1] = flipped[at + 1]! ^ 0x01;
    expect(padesSignerCertificates(flipped)).toEqual([null]);
    expect(padesSignerCertificates(ca.sign(minimalPdf(), { certificates: "none" }))).toEqual([
      null,
    ]);
    expect(
      padesSignerCertificates(ca.sign(minimalPdf(), { subFilter: "adbe.x509.rsa_sha1" })),
    ).toEqual([null]);
    expect(padesSignerCertificates(appendIncrementalUpdate(once))).toEqual([
      signerCertificateSummary(alice.der),
    ]);
  });

  it("gives [] for a file that is not a signed PDF, and never throws for content", () => {
    expect(padesSignerCertificates(minimalPdf())).toEqual([]);
    expect(padesSignerCertificates(Buffer.from("hello"))).toEqual([]);
    expect(padesSignerCertificates(once, { maxBytes: 100 })).toEqual([]);
    for (let n = 0; n < once.length; n += 997)
      expect(() => padesSignerCertificates(once.subarray(0, n))).not.toThrow();
    expect(() => padesSignerCertificates(once, { maxBytes: 0 })).toThrow(RangeError);
  });
});
