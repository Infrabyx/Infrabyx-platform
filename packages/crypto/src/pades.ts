// PAdES / CMS signature verification, verify only (C-28; owner answer #162, R1-D-228, R1-D-246;
// Udofin PR-UDF-059). A PDF's embedded CAdES-detached or PKCS#7-detached signatures are checked
// locally: the ByteRange digest, the CMS signature over the signed attributes, the signer's chain
// to a pinned CCA India root through pinned intermediates, validity at the signing time, key
// usage, a B-T signature timestamp when present, and revocation only from evidence the caller
// passes. Nothing is signed, fetched or logged; results are fixed labels, never document text
// (the signer block comes from the certificate). node:crypto only, with the package's own DER
// reader (no third-party ASN.1 library).
import { X509Certificate } from "node:crypto";
import {
  CCA_INDIA_INTERMEDIATES,
  CCA_INDIA_ROOTS,
  type PinnedCertificate,
} from "./cca-india-trust.js";
import { readTlv } from "./der.js";
import { OID, parseSignedData, parseTstInfo, type ParsedSignerInfo } from "./pades-cms.js";
import { findSignatures, pdfDate, type FoundSignature } from "./pades-pdf.js";
import {
  checkEvidenceLimits,
  revocationStatus,
  type RevocationEvidence,
  type RevocationStatus,
} from "./pades-revocation.js";
import {
  AlgError,
  basicConstraints,
  criticalExtensionsKnown,
  digestOf,
  extKeyUsage,
  issuedBy,
  keyUsage,
  parseCert,
  registryIdFor,
  sigAlgOf,
  subjectKeyId,
  validAt,
  verifySig,
  type ParsedCert,
} from "./pades-x509.js";

export type { RevocationEvidence, RevocationStatus } from "./pades-revocation.js";
export type { PinnedCertificate } from "./cca-india-trust.js";

/** Per-signature outcomes (fixed labels). */
export const PADES_OUTCOMES = Object.freeze([
  "valid",
  "malformed",
  "unsupported_subfilter",
  "cms_malformed",
  "weak_algorithm",
  "unsupported_algorithm",
  "key_too_weak",
  "digest_mismatch",
  "signer_certificate_missing",
  "signer_certificate_mismatch",
  "signature_invalid",
  "timestamp_invalid",
  "signing_time_in_future",
  "key_usage_not_allowed",
  "chain_untrusted",
  "not_valid_at_signing_time",
  "certificate_revoked",
] as const);
export type PadesOutcome = (typeof PADES_OUTCOMES)[number];

/** Document outcomes (fixed labels). */
export const PADES_DOCUMENT_OUTCOMES = Object.freeze([
  "valid",
  "invalid",
  "incremental_update_after_signature",
  "no_signature",
  "not_pdf",
  "too_large",
  "too_many_signatures",
] as const);
export type PadesDocumentOutcome = (typeof PADES_DOCUMENT_OUTCOMES)[number];

export type PadesTimeSource =
  "timestamp" | "signing_time_attribute" | "signature_dictionary" | "verification_time";

export interface PadesSignatureResult {
  outcome: PadesOutcome;
  valid: boolean;
  /** The signature format, only when it is one of the two accepted ones. */
  subFilter: "ETSI.CAdES.detached" | "adbe.pkcs7.detached" | null;
  /** True when the ByteRange reaches the end of the file (no incremental update after it). */
  coversWholeDocument: boolean;
  /** From the signer's certificate (Node's formatting of the names; serial in hex). */
  signer: { subject: string; serial: string; issuer: string; certSha256: string } | null;
  /** RFC 3339, the time the checks used, or null when not reached. */
  signedAt: string | null;
  timeSource: PadesTimeSource | null;
  timestamp: "valid" | "untrusted" | "invalid" | "absent";
  chain: "trusted" | "untrusted" | "not_checked";
  revocation: RevocationStatus;
  /** The crypto registry id of the signature algorithm, once known. */
  algorithm: string | null;
}

export interface PadesVerifyResult {
  outcome: PadesDocumentOutcome;
  valid: boolean;
  /** `cca-india` for the pinned store; `custom` only for a test store. */
  trustStore: PadesTrustStore["id"];
  signatures: PadesSignatureResult[];
}

/** A set of trust anchors and intermediates. Build only with `customTrustStore` (tests). */
export interface PadesTrustStore {
  readonly id: "cca-india" | "custom";
  /** SHA-256 fingerprints of the roots. */
  readonly roots: readonly string[];
  /** SHA-256 fingerprints of the intermediates. */
  readonly intermediates: readonly string[];
}

const stores = new WeakMap<PadesTrustStore, { roots: ParsedCert[]; inters: ParsedCert[] }>();

const toDer = (c: string | Uint8Array): Buffer =>
  typeof c === "string" ? new X509Certificate(c).raw : Buffer.from(c);

function makeStore(
  id: PadesTrustStore["id"],
  roots: ReadonlyArray<string | Uint8Array>,
  inters: ReadonlyArray<string | Uint8Array>,
): PadesTrustStore {
  const r = roots.map((c) => parseCert(toDer(c)));
  const i = inters.map((c) => parseCert(toDer(c)));
  const store: PadesTrustStore = Object.freeze({
    id,
    roots: Object.freeze(r.map((c) => c.sha256)),
    intermediates: Object.freeze(i.map((c) => c.sha256)),
  });
  stores.set(store, { roots: r, inters: i });
  return store;
}

function pinned(list: readonly PinnedCertificate[]): string[] {
  return list.map((p) => {
    const der = new X509Certificate(p.pem).raw;
    if (digestOf("sha256", der).toString("hex") !== p.sha256.toLowerCase())
      throw new Error(`the pinned certificate "${p.label}" does not match its fingerprint`);
    return p.pem;
  });
}

/**
 * The pinned CCA India store (`cca-india-trust.ts`), checked at load. It is empty until the owner
 * supplies CCA's certificates (#178), so today every chain is `chain_untrusted`.
 */
export const CCA_INDIA_TRUST: PadesTrustStore = makeStore(
  "cca-india",
  pinned(CCA_INDIA_ROOTS),
  pinned(CCA_INDIA_INTERMEDIATES),
);

/**
 * Tests only: a store of throwaway anchors (`@infrabyx/crypto/pades-test`). Results using it say
 * `trustStore: "custom"`; production code uses the default `CCA_INDIA_TRUST`.
 */
export function customTrustStore(o: {
  roots: ReadonlyArray<string | Uint8Array>;
  intermediates?: ReadonlyArray<string | Uint8Array>;
}): PadesTrustStore {
  if (!o.roots.length) throw new TypeError("a trust store needs a root");
  return makeStore("custom", o.roots, o.intermediates ?? []);
}

export interface PadesVerifyOptions {
  /** Defaults to `CCA_INDIA_TRUST`. */
  trust?: PadesTrustStore;
  /** CRLs and OCSP responses the caller fetched (never fetched here). */
  revocation?: RevocationEvidence;
  /** The verification time (default now). */
  now?: Date;
  /** Largest file accepted, default 32 MiB, at most 64 MiB. */
  maxBytes?: number;
}

export const PADES_LIMITS = Object.freeze({
  defaultMaxBytes: 32 * 1024 * 1024,
  maxBytes: 64 * 1024 * 1024,
  maxSignatures: 16,
  maxCmsBytes: 1024 * 1024,
  maxPath: 6,
  skewMs: 5 * 60 * 1000,
});

const SIGNER_EKU = new Set([
  "2.5.29.37.0", // any extended key usage
  "1.3.6.1.5.5.7.3.4", // email protection
  "1.3.6.1.5.5.7.3.36", // document signing (RFC 9336)
  "1.2.840.113583.1.1.5", // Adobe authentic documents trust
  "1.3.6.1.4.1.311.10.3.12", // Microsoft document signing
]);
const KP_TIME_STAMPING = "1.3.6.1.5.5.7.3.8";
const KU = { digitalSignature: 0, nonRepudiation: 1, keyCertSign: 5 } as const;

class Refusal extends Error {
  constructor(readonly outcome: PadesOutcome) {
    super(outcome);
  }
}

/** The path signer → … → pinned root, or the reason none exists. */
function buildPath(
  leaf: ParsedCert,
  store: PadesTrustStore,
  at: Date,
): { path: ParsedCert[] } | { fail: PadesOutcome } {
  const s = stores.get(store);
  if (!s) throw new TypeError("not a trust store");
  if (!criticalExtensionsKnown(leaf)) return { fail: "chain_untrusted" };
  let weak = false;
  const caOk = (c: ParsedCert, below: number): boolean => {
    const bc = basicConstraints(c);
    const ku = keyUsage(c);
    return (
      bc.ca &&
      (!ku || ku(KU.keyCertSign)) &&
      (bc.pathLen === undefined || bc.pathLen >= below) &&
      criticalExtensionsKnown(c)
    );
  };
  const issuers = (c: ParsedCert): Array<{ cert: ParsedCert; root: boolean }> => {
    const out: Array<{ cert: ParsedCert; root: boolean }> = [];
    for (const [list, root] of [
      [s.roots, true],
      [s.inters, false],
    ] as const)
      for (const cand of list) {
        try {
          if (issuedBy(c, cand)) out.push({ cert: cand, root });
        } catch (e) {
          if (e instanceof AlgError && e.label === "weak_algorithm") weak = true;
        }
      }
    return out;
  };
  const search = (path: ParsedCert[]): ParsedCert[] | undefined => {
    if (path.length >= PADES_LIMITS.maxPath) return undefined;
    for (const { cert, root } of issuers(path[path.length - 1]!)) {
      if (path.some((p) => p.sha256 === cert.sha256) && !root) continue;
      if (!caOk(cert, path.length - 1)) continue;
      if (root) return [...path, cert];
      const found = search([...path, cert]);
      if (found) return found;
    }
    return undefined;
  };
  const path = search([leaf]);
  if (!path) return { fail: weak ? "weak_algorithm" : "chain_untrusted" };
  if (!path.every((c) => validAt(c, at))) return { fail: "not_valid_at_signing_time" };
  return { path };
}

function signerCert(si: ParsedSignerInfo, certs: Buffer[]): ParsedCert | undefined {
  for (const der of certs) {
    let c: ParsedCert;
    try {
      c = parseCert(der);
    } catch {
      continue;
    }
    const match =
      "ski" in si.sid
        ? subjectKeyId(c)?.equals(si.sid.ski) === true
        : c.issuer.equals(si.sid.issuer) && c.serial.equals(si.sid.serial);
    if (match) return c;
  }
  return undefined;
}

/** Checks the CMS signer: attributes, ESS binding, algorithm and signature. Returns the registry id. */
function checkSigner(si: ParsedSignerInfo, cert: ParsedCert, contentType: string): string {
  if (si.contentType !== contentType) throw new Refusal("cms_malformed");
  if (si.essCert && !digestOf(si.essCert.hash, cert.der).equals(si.essCert.certHash))
    throw new Refusal("signer_certificate_mismatch");
  const alg = sigAlgOf(si.sigAlg.d, si.sigAlg.t, si.digest);
  const id = registryIdFor(alg, cert.x509.publicKey);
  if (!verifySig(alg, cert.x509.publicKey, si.signedAttrs, si.signature))
    throw new Refusal("signature_invalid");
  return id;
}

type TimestampCheck =
  { status: "valid"; genTime: Date } | { status: "untrusted" } | { status: "invalid" };

function checkTimestamp(
  token: Buffer,
  signatureValue: Buffer,
  store: PadesTrustStore,
  now: Date,
): TimestampCheck {
  let tsa: ParsedCert;
  let genTime: Date;
  try {
    const sd = parseSignedData(token);
    if (sd.eContentType !== OID.TST_INFO || !sd.eContent) return { status: "invalid" };
    if (!digestOf(sd.signer.digest, sd.eContent).equals(sd.signer.messageDigest))
      return { status: "invalid" };
    const cert = signerCert(sd.signer, sd.certificates);
    if (!cert) return { status: "invalid" };
    checkSigner(sd.signer, cert, OID.TST_INFO);
    const tst = parseTstInfo(sd.eContent);
    if (!digestOf(tst.imprintHash, signatureValue).equals(tst.imprint))
      return { status: "invalid" };
    if (tst.genTime.getTime() > now.getTime() + PADES_LIMITS.skewMs) return { status: "invalid" };
    const ku = keyUsage(cert);
    if (
      !(extKeyUsage(cert) ?? []).includes(KP_TIME_STAMPING) ||
      (ku && !ku(KU.digitalSignature) && !ku(KU.nonRepudiation))
    )
      return { status: "invalid" };
    tsa = cert;
    genTime = tst.genTime;
  } catch {
    return { status: "invalid" };
  }
  const p = buildPath(tsa, store, genTime);
  return "path" in p ? { status: "valid", genTime } : { status: "untrusted" };
}

function contentsDer(pdf: Buffer, sig: FoundSignature): Buffer {
  const hex = pdf
    .toString("latin1", sig.contents.start + 1, sig.contents.end - 1)
    .replace(/[\0\t\n\f\r ]/g, "");
  if (hex.length % 2 || hex.length > PADES_LIMITS.maxCmsBytes * 2) throw new Refusal("malformed");
  const raw = Buffer.from(hex, "hex");
  // One DER element, followed only by zero padding.
  let n: number;
  try {
    n = readTlv(raw, 0).end;
  } catch {
    throw new Refusal("cms_malformed");
  }
  if (raw.subarray(n).some((x) => x !== 0)) throw new Refusal("cms_malformed");
  return raw.subarray(0, n);
}

function verifyOne(
  pdf: Buffer,
  sig: FoundSignature | null,
  store: PadesTrustStore,
  o: PadesVerifyOptions,
  now: Date,
): PadesSignatureResult {
  const r: PadesSignatureResult = {
    outcome: "malformed",
    valid: false,
    subFilter: null,
    coversWholeDocument: false,
    signer: null,
    signedAt: null,
    timeSource: null,
    timestamp: "absent",
    chain: "not_checked",
    revocation: "not_checked",
    algorithm: null,
  };
  if (!sig) return r;
  const [a, b, c, d] = sig.byteRange;
  if (a !== 0 || b < 1 || sig.contents.start !== b || sig.contents.end !== c || c + d > pdf.length)
    return r;
  r.coversWholeDocument = c + d === pdf.length;
  if (sig.type !== undefined && sig.type !== "Sig")
    return { ...r, outcome: "unsupported_subfilter" };
  if (sig.subFilter !== "ETSI.CAdES.detached" && sig.subFilter !== "adbe.pkcs7.detached")
    return { ...r, outcome: "unsupported_subfilter" };
  r.subFilter = sig.subFilter;
  const done = (outcome: PadesOutcome): PadesSignatureResult => {
    r.outcome = outcome;
    r.valid = outcome === "valid";
    return r;
  };
  try {
    const der = contentsDer(pdf, sig);
    let sd;
    try {
      sd = parseSignedData(der);
    } catch (e) {
      if (e instanceof AlgError) throw e;
      return done("cms_malformed");
    }
    if (sd.eContentType !== OID.DATA || sd.eContent) return done("cms_malformed");
    const si = sd.signer;
    const digest = digestOf(si.digest, pdf.subarray(a, a + b), pdf.subarray(c, c + d));
    if (!digest.equals(si.messageDigest)) return done("digest_mismatch");
    const cert = signerCert(si, sd.certificates);
    if (!cert) return done("signer_certificate_missing");
    r.signer = {
      subject: cert.x509.subject,
      serial: cert.x509.serialNumber,
      issuer: cert.x509.issuer,
      certSha256: cert.sha256,
    };
    r.algorithm = checkSigner(si, cert, OID.DATA);

    let at: Date = now;
    if (si.timestampToken) {
      const ts = checkTimestamp(si.timestampToken, si.signature, store, now);
      r.timestamp = ts.status;
      if (ts.status === "invalid") return done("timestamp_invalid");
      if (ts.status === "valid") {
        at = ts.genTime;
        r.timeSource = "timestamp";
      }
    }
    const m = pdfDate(sig.m);
    if (r.timeSource === "timestamp") {
      // `at` is the verified genTime, set above
    } else if (si.signingTime) {
      at = si.signingTime;
      r.timeSource = "signing_time_attribute";
    } else if (m) {
      at = m;
      r.timeSource = "signature_dictionary";
    } else r.timeSource = "verification_time";
    r.signedAt = at.toISOString();
    if (at.getTime() > now.getTime() + PADES_LIMITS.skewMs) return done("signing_time_in_future");

    const ku = keyUsage(cert);
    const eku = extKeyUsage(cert);
    if (
      !ku ||
      (!ku(KU.digitalSignature) && !ku(KU.nonRepudiation)) ||
      (eku && !eku.some((x) => SIGNER_EKU.has(x)))
    )
      return done("key_usage_not_allowed");

    const p = buildPath(cert, store, at);
    if ("fail" in p) {
      r.chain = p.fail === "not_valid_at_signing_time" ? "trusted" : "untrusted";
      return done(p.fail);
    }
    r.chain = "trusted";
    r.revocation = revocationStatus(p.path, o.revocation, now);
    if (r.revocation === "revoked") return done("certificate_revoked");
    return done("valid");
  } catch (e) {
    if (e instanceof Refusal) return done(e.outcome);
    if (e instanceof AlgError) return done(e.label);
    return done("cms_malformed");
  }
}

/**
 * Verifies every signature embedded in `pdf`. Never throws for document content; throws only for
 * bad options (a foreign trust store, `maxBytes` out of range, too much revocation evidence).
 */
export function verifyPadesSignatures(
  pdf: Uint8Array,
  o: PadesVerifyOptions = {},
): PadesVerifyResult {
  const store = o.trust ?? CCA_INDIA_TRUST;
  if (!stores.has(store)) throw new TypeError("not a trust store");
  const max = o.maxBytes ?? PADES_LIMITS.defaultMaxBytes;
  if (!Number.isSafeInteger(max) || max < 1 || max > PADES_LIMITS.maxBytes)
    throw new RangeError("maxBytes out of range");
  checkEvidenceLimits(o.revocation);
  const now = o.now ?? new Date();
  const res = (outcome: PadesDocumentOutcome, signatures: PadesSignatureResult[] = []) => ({
    outcome,
    valid: outcome === "valid",
    trustStore: store.id,
    signatures,
  });
  if (pdf.length > max) return res("too_large");
  const buf = Buffer.from(pdf.buffer, pdf.byteOffset, pdf.length);
  if (buf.toString("latin1", 0, 5) !== "%PDF-") return res("not_pdf");
  const found = findSignatures(buf, PADES_LIMITS.maxSignatures);
  if (found === "too_many") return res("too_many_signatures");
  if (!found.length) return res("no_signature");
  const signatures = found.map((s) => verifyOne(buf, s, store, o, now));
  if (!signatures.every((s) => s.valid)) return res("invalid", signatures);
  if (!signatures.some((s) => s.coversWholeDocument))
    return res("incremental_update_after_signature", signatures);
  return res("valid", signatures);
}
