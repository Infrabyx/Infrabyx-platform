// The signer certificate's summary for an ESIGN signature record (Udofin PR-UDF-070, R1-D-251):
// serial, issuer, validity, SHA-256 of the DER and the subject's common name. Field reading only,
// with `X509Certificate` and the package's strict DER reader (C-28's); the one computation is
// SHA-256 of the DER. It says which certificate it is, never whether to trust it: that is
// `verifyPadesSignatures`' job. Throws a fixed-text TypeError for anything that is not one
// X.509 certificate; nothing is logged.
import { X509Certificate } from "node:crypto";
import type { SignerCertificateSummary } from "@infrabyx/contracts/ports";
import { TAG, children, expect, oidOf, readOne } from "./der.js";
import { parseCert, type ParsedCert } from "./pades-x509.js";

export type { SignerCertificateSummary } from "@infrabyx/contracts/ports";

const CN = "2.5.4.3";
/** Longer than X.520's 64-character bound, to keep a non-conforming name readable but bounded. */
const MAX_CN_CHARS = 256;

function decodeString(tag: number, body: Uint8Array): string | undefined {
  const b = Buffer.from(body);
  switch (tag) {
    case 0x0c: // UTF8String
      return new TextDecoder("utf-8", { fatal: true }).decode(b);
    case 0x13: // PrintableString
    case 0x16: // IA5String
      return b.toString("ascii");
    case 0x14: // TeletexString (read as Latin-1, as most toolkits do)
      return b.toString("latin1");
    case 0x1e: {
      // BMPString (UTF-16BE)
      if (b.length % 2) return undefined;
      return new TextDecoder("utf-16be", { fatal: true }).decode(b);
    }
    case 0x1c: {
      // UniversalString (UTF-32BE)
      if (b.length % 4) return undefined;
      let out = "";
      for (let i = 0; i < b.length; i += 4) {
        const cp = b.readUInt32BE(i);
        if (cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return undefined;
        out += String.fromCodePoint(cp);
      }
      return out;
    }
    default:
      return undefined;
  }
}

/** The subject's most specific (last) common name, without control characters. */
function commonNameOf(subject: Buffer): string | undefined {
  let found: string | undefined;
  try {
    for (const rdn of children(subject, expect(readOne(subject), TAG.SEQUENCE), 64)) {
      for (const atv of children(subject, expect(rdn, TAG.SET), 16)) {
        const [type, value] = children(subject, expect(atv, TAG.SEQUENCE), 2);
        if (!type || !value || oidOf(subject, type) !== CN) continue;
        const s = decodeString(value.tag, subject.subarray(value.body, value.end));
        if (s !== undefined) found = s;
      }
    }
  } catch {
    return undefined;
  }
  // eslint-disable-next-line no-control-regex
  const clean = found?.replace(/[\u0000-\u001f\u007f-\u009f]/g, "").trim();
  return clean ? clean.slice(0, MAX_CN_CHARS) : undefined;
}

/** The summary of an already-parsed certificate (shared with `padesSignerCertificates`). */
export function summaryOf(c: ParsedCert): SignerCertificateSummary {
  const cn = commonNameOf(c.subject);
  return {
    serialNumber: c.x509.serialNumber,
    issuer: c.x509.issuer,
    notBefore: c.notBefore.toISOString(),
    notAfter: c.notAfter.toISOString(),
    sha256: c.sha256,
    ...(cn !== undefined ? { subjectCommonName: cn } : {}),
  };
}

/**
 * The summary of one X.509 certificate, given as DER bytes or PEM text (the first certificate of
 * a PEM bundle). Throws `TypeError("not an X.509 certificate")` otherwise.
 */
export function signerCertificateSummary(cert: string | Uint8Array): SignerCertificateSummary {
  let der: Buffer;
  try {
    if (typeof cert === "string") {
      if (!cert.includes("-----BEGIN CERTIFICATE-----")) throw new TypeError();
      der = new X509Certificate(cert).raw;
    } else der = Buffer.from(cert);
    return summaryOf(parseCert(der));
  } catch {
    throw new TypeError("not an X.509 certificate");
  }
}
