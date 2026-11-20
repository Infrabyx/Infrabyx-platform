// Partner mTLS client certificates (PR-UDF-064, R1-D-238; IPB-10-16, IPB-10-17; RFC 8705 §3.1).
// Verification only, no new primitive: node:crypto's `X509Certificate` parses the certificate,
// `checkIssued` and `verify(publicKey)` run the optional pinned-CA check, and the binding value is
// the SHA-256 the platform already uses (`x5t#S256`, base64url of the SHA-256 of the DER). The
// pinned-CA check accepts only issuer signatures made with ECDSA P-256 / SHA-256, the approved
// `ecdsa-p256-sha256` entry; any other issuer algorithm is refused `issuer_algorithm` until the
// owner widens it (owner question #170). No CRL, OCSP, name-constraint or policy processing.
// Nothing here logs, and no refusal carries the certificate or any value from it.
import { X509Certificate } from "node:crypto";
import type { TLSSocket } from "node:tls";
import { toBase64Url, toHex } from "./encoding.js";
import { sha256 } from "./hash.js";

/**
 * The fixed refusal labels, in the order they are checked: `no_certificate`, none was presented
 * (or the header is absent or empty); `too_large`, the header is over `CLIENT_CERT_MAX_HEADER_BYTES`;
 * `multiple_certificates`, the header holds more than one certificate (a chain, two PEM blocks,
 * two header values or two XFCC elements) where exactly one leaf is required; `unparsable`, not
 * percent-encoding, PEM or X.509 as the contract defines; `tls_unauthorized`, the TLS layer did not
 * authorise the peer and the caller requires it; `not_yet_valid` and `expired`, by the given clock;
 * `not_client_certificate`, the certificate is a CA or its extended key usage excludes TLS client
 * authentication; `untrusted_issuer`, a pinned-CA set was given and no path of at most
 * `CLIENT_CERT_MAX_INTERMEDIATES` configured intermediates reaches a pinned CA; `issuer_algorithm`,
 * the only issuer that could vouch for it signed with an algorithm the check does not accept.
 */
export const CLIENT_CERT_REFUSALS = [
  "no_certificate",
  "too_large",
  "multiple_certificates",
  "unparsable",
  "tls_unauthorized",
  "not_yet_valid",
  "expired",
  "not_client_certificate",
  "untrusted_issuer",
  "issuer_algorithm",
] as const;
export type ClientCertRefusal = (typeof CLIENT_CERT_REFUSALS)[number];

/** The longest edge header value read, in characters (a leaf is 1–4 KiB of PEM before encoding). */
export const CLIENT_CERT_MAX_HEADER_BYTES = 16_384;
/** The most configured intermediates a path from the leaf to a pinned CA may cross. */
export const CLIENT_CERT_MAX_INTERMEDIATES = 2;
/** The issuer signature the pinned-CA check accepts: ecdsa-with-SHA256 (RFC 5758) on P-256. */
export const CLIENT_CERT_ISSUER_SIGNATURE_OID = "1.2.840.10045.4.3.2";

const EKU_CLIENT_AUTH = "1.3.6.1.5.5.7.3.2";
const EKU_ANY = "2.5.29.37.0";

/** What the platform reads from a partner's client certificate. */
export interface ClientCertificate {
  /** RFC 8705 §3.1 `x5t#S256`: base64url (no padding) of the SHA-256 of the DER. The binding value. */
  x5tS256: string;
  /** The same SHA-256, lowercase hex, for operators comparing with `openssl x509 -fingerprint`. */
  fingerprintSha256: string;
  /** `notBefore` and `notAfter`, ISO 8601 UTC. */
  notBefore: string;
  notAfter: string;
  /**
   * Subject and issuer distinguished names as node:crypto prints them (`C=…`, `O=…`, `CN=…`,
   * newline-separated). For display and records only: authorise on `x5tS256`, never on a name.
   */
  subject: string;
  issuer: string;
  /** The serial number, uppercase hex. */
  serialNumber: string;
  /** Where it came from: the platform's own TLS socket, or the edge's forwarded header. */
  source: "tls" | "edge";
  /**
   * Whether the TLS layer authorised the peer against the listener's `ca` (`socket.authorized`);
   * null for `edge`, where the app cannot know and the edge contract decides (see the docs page).
   */
  tlsAuthorized: boolean | null;
  /** `pinned` when a pinned-CA set was given and the certificate chains to it, else `not_checked`. */
  chain: "pinned" | "not_checked";
}

export type ClientCertResult =
  { ok: true; certificate: ClientCertificate } | { ok: false; reason: ClientCertRefusal };

/** The edge header formats read (`docs/platform/mtls-edge-header.md`). */
export type EdgeHeaderFormat = "pem-url" | "xfcc";

/** Where the certificate is read from. */
export type ClientCertificateSource =
  | { socket: Pick<TLSSocket, "getPeerX509Certificate" | "authorized"> }
  | {
      /** The header's value(s) as the HTTP server gives them; more than one value is refused. */
      header: string | readonly string[] | undefined;
      /** `pem-url` (default): the percent-encoded PEM of one certificate. `xfcc`: Envoy's XFCC. */
      format?: EdgeHeaderFormat;
    };

export interface ReadClientCertificateOptions {
  /** The clock for the validity window. Default: now. */
  now?: Date;
  /** The partner's pinned CAs, when the product checks the chain itself. */
  trust?: PinnedCaSet;
  /**
   * Socket only. `required` (default): a peer the TLS layer did not authorise is refused
   * `tls_unauthorized`. `reported`: it is read and `tlsAuthorized` says false, for a listener that
   * requests but does not require a certificate and decides with `trust` instead.
   */
  tlsAuthorization?: "required" | "reported";
}

const PEM_BLOCK = /-----BEGIN CERTIFICATE-----([\s\S]*?)-----END CERTIFICATE-----/g;

/** Every PEM CERTIFICATE block in `text`; null when anything else is there (a key, stray text). */
function pemCertificates(text: string): Buffer[] | null {
  const out: Buffer[] = [];
  for (const m of text.matchAll(PEM_BLOCK)) {
    const b64 = m[1]!.replace(/[\s]/g, "");
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64) || b64.length % 4 !== 0) return null;
    const d = Buffer.from(b64, "base64");
    if (d.toString("base64") !== b64) return null;
    out.push(d);
  }
  return text.replace(PEM_BLOCK, "").trim() === "" ? out : null;
}

function parseDer(d: Buffer): X509Certificate | null {
  try {
    const c = new X509Certificate(d);
    return c.raw.equals(d) ? c : null;
  } catch {
    return null;
  }
}

/** Split on `sep` outside double quotes (backslash escapes inside quotes); null when unbalanced. */
function splitOutside(s: string, sep: string): string[] | null {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (quoted && ch === "\\") {
      cur += ch + (s[i + 1] ?? "");
      i++;
    } else if (ch === '"') {
      quoted = !quoted;
      cur += ch;
    } else if (!quoted && ch === sep) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (quoted) return null;
  out.push(cur);
  return out;
}

/** The `Cert` value of a single-element XFCC header, still percent-encoded, or a refusal. */
function xfccCert(v: string): { cert: string } | { refusal: ClientCertRefusal } {
  const elements = splitOutside(v, ",");
  if (elements === null || elements.some((e) => e.trim() === "")) return { refusal: "unparsable" };
  if (elements.length !== 1) return { refusal: "multiple_certificates" };
  const pairs = splitOutside(elements[0]!, ";");
  if (pairs === null) return { refusal: "unparsable" };
  const certs: string[] = [];
  for (const p of pairs) {
    const i = p.indexOf("=");
    if (i < 1) return { refusal: "unparsable" };
    let val = p.slice(i + 1).trim();
    if (val.startsWith('"')) {
      if (val.length < 2 || !val.endsWith('"')) return { refusal: "unparsable" };
      val = val.slice(1, -1).replace(/\\(.)/g, "$1");
    }
    if (p.slice(0, i).trim().toLowerCase() === "cert") certs.push(val);
  }
  if (certs.length === 0) return { refusal: "no_certificate" };
  return certs.length === 1 ? { cert: certs[0]! } : { refusal: "multiple_certificates" };
}

function fromHeader(
  header: string | readonly string[] | undefined,
  format: EdgeHeaderFormat,
): X509Certificate | ClientCertRefusal {
  if (header === undefined) return "no_certificate";
  if (typeof header !== "string") {
    if (header.length === 0) return "no_certificate";
    if (header.length > 1) return "multiple_certificates";
    header = header[0]!;
  }
  if (header.trim() === "") return "no_certificate";
  if (header.length > CLIENT_CERT_MAX_HEADER_BYTES) return "too_large";
  let encoded = header.trim();
  if (format === "xfcc") {
    const c = xfccCert(encoded);
    if ("refusal" in c) return c.refusal;
    encoded = c.cert;
  }
  let text: string;
  try {
    // Percent-decoding only: `+` stays `+` (a base64 character), never a space.
    text = decodeURIComponent(encoded);
  } catch {
    return "unparsable";
  }
  const ders = pemCertificates(text);
  if (ders === null) return "unparsable";
  if (ders.length === 0) return "unparsable";
  if (ders.length > 1) return "multiple_certificates";
  return parseDer(ders[0]!) ?? "unparsable";
}

const within = (c: X509Certificate, now: Date) => now >= c.validFromDate && now <= c.validToDate;

/** True when `child` carries an approved issuer signature from `issuer` that verifies. */
function signedBy(child: X509Certificate, issuer: X509Certificate): "ok" | "algorithm" | "bad" {
  const k = issuer.publicKey;
  if (
    child.signatureAlgorithmOid !== CLIENT_CERT_ISSUER_SIGNATURE_OID ||
    k.asymmetricKeyType !== "ec" ||
    k.asymmetricKeyDetails?.namedCurve !== "prime256v1"
  )
    return "algorithm";
  return child.verify(k) ? "ok" : "bad";
}

/**
 * A partner's pinned CAs, and the intermediates the partner registered with them, parsed once at
 * configuration. Every certificate must be a CA. Intermediates come from configuration only: a
 * chain sent with the request is never trusted (the header carries exactly one leaf).
 */
export class PinnedCaSet {
  private constructor(
    private readonly anchors: readonly X509Certificate[],
    private readonly intermediates: readonly X509Certificate[],
  ) {}

  /**
   * Parse PEM (each string one certificate or a bundle). Throws `RangeError` on a configuration
   * fault: nothing pinned, more than 32 anchors or 8 intermediates, an unparsable or non-CA
   * certificate.
   */
  static fromPem(anchors: readonly string[], o: { intermediates?: readonly string[] } = {}) {
    const parse = (pems: readonly string[], what: string) =>
      pems.flatMap((p) => {
        const ders = pemCertificates(p);
        if (ders === null || ders.length === 0)
          throw new RangeError(`a pinned ${what} is not PEM certificates`);
        return ders.map((d) => {
          const c = parseDer(d);
          if (c === null) throw new RangeError(`a pinned ${what} is not a certificate`);
          if (!c.ca) throw new RangeError(`a pinned ${what} is not a CA certificate`);
          return c;
        });
      });
    const a = parse(anchors, "CA");
    const i = parse(o.intermediates ?? [], "intermediate");
    if (a.length === 0 || a.length > 32) throw new RangeError("pin 1 to 32 CA certificates");
    if (i.length > 8) throw new RangeError("at most 8 pinned intermediates");
    return new PinnedCaSet(a, i);
  }

  /** The SHA-256 fingerprints (hex) of the pinned CAs, for a configuration record. */
  get fingerprints(): string[] {
    return this.anchors.map((a) => toHex(sha256(a.raw)));
  }

  /** @internal Whether `leaf` chains to a pinned CA by `now`. */
  check(leaf: X509Certificate, now: Date): "pinned" | "untrusted_issuer" | "issuer_algorithm" {
    let algorithmOnly = false;
    const walk = (cert: X509Certificate, depth: number): boolean => {
      for (const anchor of this.anchors) {
        if (!cert.checkIssued(anchor) || !within(anchor, now)) continue;
        const s = signedBy(cert, anchor);
        if (s === "ok") return true;
        if (s === "algorithm") algorithmOnly = true;
      }
      if (depth >= CLIENT_CERT_MAX_INTERMEDIATES) return false;
      for (const inter of this.intermediates) {
        if (inter === cert || !cert.checkIssued(inter) || !within(inter, now)) continue;
        const s = signedBy(cert, inter);
        if (s === "algorithm") algorithmOnly = true;
        if (s === "ok" && walk(inter, depth + 1)) return true;
      }
      return false;
    };
    if (walk(leaf, 0)) return "pinned";
    return algorithmOnly ? "issuer_algorithm" : "untrusted_issuer";
  }
}

/**
 * Read a partner's mTLS client certificate (PR-UDF-064) from the platform's own TLS socket or from
 * the edge's forwarded header, and check exactly one certificate, its validity window by `now`,
 * that it is a TLS client certificate, and, with `trust`, that it chains to a pinned CA. Returns
 * the certificate's `x5t#S256` and what a product records, or a fixed refusal label (answer
 * `IPB-API-009`, 401). It never logs, and a refusal never carries the certificate.
 */
export function readClientCertificate(
  source: ClientCertificateSource,
  o: ReadClientCertificateOptions = {},
): ClientCertResult {
  const fail = (reason: ClientCertRefusal): ClientCertResult => ({ ok: false, reason });
  let cert: X509Certificate;
  let tlsAuthorized: boolean | null = null;
  if ("socket" in source) {
    const c = source.socket.getPeerX509Certificate();
    if (c === undefined) return fail("no_certificate");
    tlsAuthorized = source.socket.authorized === true;
    if (!tlsAuthorized && (o.tlsAuthorization ?? "required") === "required")
      return fail("tls_unauthorized");
    cert = c;
  } else {
    const c = fromHeader(source.header, source.format ?? "pem-url");
    if (typeof c === "string") return fail(c);
    cert = c;
  }
  const now = o.now ?? new Date();
  if (now < cert.validFromDate) return fail("not_yet_valid");
  if (now > cert.validToDate) return fail("expired");
  const eku = cert.keyUsage;
  if (cert.ca || (eku !== undefined && !eku.includes(EKU_CLIENT_AUTH) && !eku.includes(EKU_ANY)))
    return fail("not_client_certificate");
  let chain: ClientCertificate["chain"] = "not_checked";
  if (o.trust) {
    const r = o.trust.check(cert, now);
    if (r !== "pinned") return fail(r);
    chain = "pinned";
  }
  const digest = sha256(cert.raw);
  return {
    ok: true,
    certificate: {
      x5tS256: toBase64Url(digest),
      fingerprintSha256: toHex(digest),
      notBefore: cert.validFromDate.toISOString(),
      notAfter: cert.validToDate.toISOString(),
      subject: cert.subject,
      issuer: cert.issuer,
      serialNumber: cert.serialNumber.toUpperCase(),
      source: "socket" in source ? "tls" : "edge",
      tlsAuthorized,
      chain,
    },
  };
}
