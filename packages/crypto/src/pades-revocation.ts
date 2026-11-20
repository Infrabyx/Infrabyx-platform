// Revocation from caller-supplied CRLs (RFC 5280 §5) and OCSP responses (RFC 6960) for the PAdES
// verifier (C-28, R1-D-246). Nothing is fetched. Evidence that cannot be read, is not signed by
// the right key, is not current or carries a critical extension this reader does not process
// does not count either way. Internal to @infrabyx/crypto.
import {
  TAG,
  bitStringOf,
  booleanOf,
  bytesOf,
  children,
  encodingOf,
  expect,
  integerOf,
  oidOf,
  readOne,
  smallIntOf,
  timeOf,
  type Tlv,
} from "./der.js";
import {
  criticalExtensionsKnown,
  digestOf,
  extKeyUsage,
  hashOf,
  issuedBy,
  keyUsage,
  sigAlgOf,
  validAt,
  verifySig,
  parseCert,
  type ParsedCert,
} from "./pades-x509.js";

export interface RevocationEvidence {
  /** DER CertificateLists the caller fetched (at most 16, each at most 8 MiB). */
  crls?: readonly Uint8Array[];
  /** DER OCSPResponses the caller fetched (at most 16, each at most 64 KiB). */
  ocsp?: readonly Uint8Array[];
}
export type RevocationStatus = "good" | "revoked" | "not_checked";

export const REVOCATION_LIMITS = Object.freeze({
  maxCrls: 16,
  maxCrlBytes: 8 * 1024 * 1024,
  maxCrlEntries: 2_000_000,
  maxOcsp: 16,
  maxOcspBytes: 64 * 1024,
  /** Evidence without a next-update time counts only this long after its this-update time. */
  maxAgeWithoutNextUpdateMs: 24 * 3600 * 1000,
  skewMs: 5 * 60 * 1000,
});

const SHA1 = "1.3.14.3.2.26";
const OCSP_BASIC = "1.3.6.1.5.5.7.48.1.1";
const KP_OCSP_SIGNING = "1.3.6.1.5.5.7.3.9";
const CRL_SIGN_BIT = 6;
const DIGITAL_SIGNATURE_BIT = 0;

type Verdict = "good" | "revoked" | undefined;

function current(thisUpdate: Date, nextUpdate: Date | undefined, now: Date): boolean {
  const n = now.getTime();
  const s = REVOCATION_LIMITS.skewMs;
  if (thisUpdate.getTime() > n + s) return false;
  if (nextUpdate) return n <= nextUpdate.getTime() + s;
  return n - thisUpdate.getTime() <= REVOCATION_LIMITS.maxAgeWithoutNextUpdateMs;
}

function anyCritical(d: Buffer, exts: Tlv): boolean {
  for (const e of children(d, expect(exts, TAG.SEQUENCE), 64)) {
    const parts = children(d, expect(e, TAG.SEQUENCE), 3);
    if (parts.length === 3 && booleanOf(d, parts[1]!)) return true;
  }
  return false;
}

interface ParsedCrl {
  d: Buffer;
  tbs: Buffer;
  sigAlg: Tlv;
  signature: Buffer;
  issuer: Buffer;
  thisUpdate: Date;
  nextUpdate: Date | undefined;
  revoked: Set<string>;
  critical: boolean;
}

function parseCrl(input: Uint8Array): ParsedCrl {
  const d = Buffer.from(input);
  const [tbsT, algT, sigT] = children(d, expect(readOne(d), TAG.SEQUENCE), 3);
  const f = children(d, expect(tbsT, TAG.SEQUENCE), 7);
  let i = 0;
  if (f[0]?.tag === TAG.INTEGER) i++;
  if (!encodingOf(d, f[i++]!).equals(encodingOf(d, algT!))) throw new Error("alg");
  const issuer = encodingOf(d, expect(f[i++], TAG.SEQUENCE));
  const thisUpdate = timeOf(d, f[i++]!);
  let nextUpdate: Date | undefined;
  if (f[i] && (f[i]!.tag === TAG.UTC_TIME || f[i]!.tag === TAG.GENERALIZED_TIME))
    nextUpdate = timeOf(d, f[i++]!);
  const revoked = new Set<string>();
  let critical = false;
  if (f[i]?.tag === TAG.SEQUENCE) {
    for (const e of children(d, f[i++]!, REVOCATION_LIMITS.maxCrlEntries)) {
      const parts = children(d, expect(e, TAG.SEQUENCE), 3);
      revoked.add(integerOf(d, parts[0]!).toString("hex"));
      timeOf(d, parts[1]!);
      if (parts[2] && anyCritical(d, parts[2])) critical = true;
    }
  }
  if (f[i]?.tag === 0xa0) {
    const [exts] = children(d, f[i++]!, 1);
    if (anyCritical(d, exts!)) critical = true;
  }
  if (i !== f.length) throw new Error("fields");
  return {
    d,
    tbs: encodingOf(d, tbsT!),
    sigAlg: algT!,
    signature: bitStringOf(d, sigT!).bytes,
    issuer,
    thisUpdate,
    nextUpdate,
    revoked,
    critical,
  };
}

function crlVerdict(crl: ParsedCrl, cert: ParsedCert, issuer: ParsedCert, now: Date): Verdict {
  if (crl.critical || !crl.nextUpdate || !crl.issuer.equals(issuer.subject)) return undefined;
  if (!cert.issuer.equals(issuer.subject)) return undefined;
  const ku = keyUsage(issuer);
  if (ku && !ku(CRL_SIGN_BIT)) return undefined;
  if (!verifySig(sigAlgOf(crl.d, crl.sigAlg), issuer.x509.publicKey, crl.tbs, crl.signature))
    return undefined;
  if (!current(crl.thisUpdate, crl.nextUpdate, now)) return undefined;
  return crl.revoked.has(cert.serial.toString("hex")) ? "revoked" : "good";
}

function ocspVerdict(input: Uint8Array, cert: ParsedCert, issuer: ParsedCert, now: Date): Verdict {
  const d = Buffer.from(input);
  const [statusT, bytesT] = children(d, expect(readOne(d), TAG.SEQUENCE), 2);
  if (smallIntOf(d, statusT!, TAG.ENUMERATED) !== 0 || bytesT?.tag !== 0xa0) return undefined;
  const [rb] = children(d, bytesT, 1);
  const [typeT, respT] = children(d, expect(rb, TAG.SEQUENCE), 2);
  if (oidOf(d, typeT!) !== OCSP_BASIC) return undefined;
  const b = bytesOf(d, expect(respT, TAG.OCTET_STRING));
  const [tbsT, algT, sigT, certsT] = children(b, expect(readOne(b), TAG.SEQUENCE), 4);
  const tbs = encodingOf(b, tbsT!);
  const signature = bitStringOf(b, sigT!).bytes;
  const alg = sigAlgOf(b, algT!);

  // The signer: the issuing CA itself, or a responder certificate it issued for OCSP signing.
  let signedOk = verifySig(alg, issuer.x509.publicKey, tbs, signature);
  if (!signedOk && certsT?.tag === 0xa0) {
    const [seq] = children(b, certsT, 1);
    for (const c of children(b, expect(seq, TAG.SEQUENCE), 4)) {
      try {
        const r = parseCert(encodingOf(b, c));
        const ku = keyUsage(r);
        if (
          issuedBy(r, issuer) &&
          (extKeyUsage(r) ?? []).includes(KP_OCSP_SIGNING) &&
          (!ku || ku(DIGITAL_SIGNATURE_BIT)) &&
          criticalExtensionsKnown(r) &&
          validAt(r, now) &&
          verifySig(alg, r.x509.publicKey, tbs, signature)
        ) {
          signedOk = true;
          break;
        }
      } catch {
        // not a usable responder certificate
      }
    }
  }
  if (!signedOk) return undefined;

  const f = children(b, expect(tbsT, TAG.SEQUENCE), 5);
  let i = 0;
  if (f[0]?.tag === 0xa0) i++;
  i++; // responderID: the signature check above is what binds the response to the issuer
  const producedAt = timeOf(b, expect(f[i++], TAG.GENERALIZED_TIME));
  if (producedAt.getTime() > now.getTime() + REVOCATION_LIMITS.skewMs) return undefined;
  const responses = children(b, expect(f[i++], TAG.SEQUENCE), 64);
  if (f[i] && (f[i]!.tag !== 0xa1 || anyCritical(b, children(b, f[i]!, 1)[0]!))) return undefined;
  let verdict: Verdict;
  for (const sr of responses) {
    const p = children(b, expect(sr, TAG.SEQUENCE), 5);
    const id = children(b, expect(p[0], TAG.SEQUENCE), 4);
    if (!integerOf(b, id[3]!).equals(cert.serial)) continue;
    const [hOid] = children(b, expect(id[0], TAG.SEQUENCE), 2);
    if (oidOf(b, hOid!) !== SHA1) {
      // SHA-256/384/512 CertIDs are compared; a SHA-1 CertID is matched by serial under the
      // issuer's (or its responder's) signature, and no SHA-1 is computed (#162: SHA-1 refused).
      const h = hashOf(b, id[0]!);
      if (
        !digestOf(h, cert.issuer).equals(bytesOf(b, expect(id[1], TAG.OCTET_STRING))) ||
        !digestOf(h, issuer.publicKeyBits).equals(bytesOf(b, expect(id[2], TAG.OCTET_STRING)))
      )
        continue;
    }
    const status = p[1]!;
    const thisUpdate = timeOf(b, expect(p[2], TAG.GENERALIZED_TIME));
    let j = 3;
    let nextUpdate: Date | undefined;
    if (p[j]?.tag === 0xa0) nextUpdate = timeOf(b, children(b, p[j++]!, 1)[0]!);
    if (p[j] && (p[j]!.tag !== 0xa1 || anyCritical(b, children(b, p[j]!, 1)[0]!))) continue;
    if (!current(thisUpdate, nextUpdate, now)) continue;
    if (status.tag === 0xa1) return "revoked";
    if (status.tag === 0x80 && status.end === status.body) verdict = "good";
  }
  return verdict;
}

/** Throws a RangeError when the caller passed more evidence than the limits allow. */
export function checkEvidenceLimits(ev: RevocationEvidence | undefined): void {
  const crls = ev?.crls ?? [];
  const ocsp = ev?.ocsp ?? [];
  if (crls.length > REVOCATION_LIMITS.maxCrls || ocsp.length > REVOCATION_LIMITS.maxOcsp)
    throw new RangeError("too much revocation evidence");
  if (crls.some((c) => c.length > REVOCATION_LIMITS.maxCrlBytes))
    throw new RangeError("a CRL is too large");
  if (ocsp.some((c) => c.length > REVOCATION_LIMITS.maxOcspBytes))
    throw new RangeError("an OCSP response is too large");
}

/**
 * The revocation status of a path (signer first, trust anchor last): `revoked` if any counting
 * evidence lists a certificate, `good` if counting evidence covers every certificate below the
 * anchor, else `not_checked`.
 */
export function revocationStatus(
  path: readonly ParsedCert[],
  ev: RevocationEvidence | undefined,
  now: Date,
): RevocationStatus {
  checkEvidenceLimits(ev);
  const crlsIn = ev?.crls ?? [];
  const ocspIn = ev?.ocsp ?? [];
  if ((!crlsIn.length && !ocspIn.length) || path.length < 2) return "not_checked";
  const crls: ParsedCrl[] = [];
  for (const c of crlsIn) {
    try {
      crls.push(parseCrl(c));
    } catch {
      // unreadable: does not count
    }
  }
  let allGood = true;
  for (let i = 0; i + 1 < path.length; i++) {
    const cert = path[i]!;
    const issuer = path[i + 1]!;
    const verdicts: Verdict[] = [];
    for (const crl of crls) {
      try {
        verdicts.push(crlVerdict(crl, cert, issuer, now));
      } catch {
        // does not count
      }
    }
    for (const o of ocspIn) {
      try {
        verdicts.push(ocspVerdict(o, cert, issuer, now));
      } catch {
        // does not count
      }
    }
    if (verdicts.includes("revoked")) return "revoked";
    if (!verdicts.includes("good")) allGood = false;
  }
  return allGood ? "good" : "not_checked";
}
