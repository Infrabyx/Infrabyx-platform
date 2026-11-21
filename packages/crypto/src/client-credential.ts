// The platform's own mTLS client credential, before it is used outbound (PR-UDF-069, R1-D-250;
// IPB-02-21; IPB-12-05). `PartnerMtlsClient` in `@infrabyx/connectors/egress` calls this on the
// certificate and key it resolved from SECRETS, so the parse and the key check stay in the crypto
// call-site. No new primitive: node:crypto's `X509Certificate` parses the certificate,
// `createPrivateKey` the key, and `checkPrivateKey` compares the two public keys. The key must be
// ECDSA P-256, the approved `ecdsa-p256-sha256` entry, which TLS then uses for the client's
// CertificateVerify signature; any other key type is refused `key_type` until the owner widens it
// (owner question #180). Nothing here logs, and no refusal carries the certificate, the key or any
// value from them.
import { X509Certificate, createPrivateKey, type KeyObject } from "node:crypto";
import { toBase64Url, toHex } from "./encoding.js";
import { sha256 } from "./hash.js";

/**
 * The fixed refusal labels, in the order they are checked: `certificate_unparsable` (not a PEM
 * X.509 certificate), `key_unparsable` (not an unencrypted PEM private key), `key_type` (not
 * ECDSA P-256), `key_mismatch` (the key is not the certificate's), `not_client_certificate` (a CA,
 * or an extended key usage without TLS client authentication), `not_yet_valid` and `expired` (by
 * the given clock).
 */
export const CLIENT_CREDENTIAL_REFUSALS = [
  "certificate_unparsable",
  "key_unparsable",
  "key_type",
  "key_mismatch",
  "not_client_certificate",
  "not_yet_valid",
  "expired",
] as const;
export type ClientCredentialRefusal = (typeof CLIENT_CREDENTIAL_REFUSALS)[number];

/** What a usable credential is: its dates and its binding values, never the key. */
export interface ClientCredentialInfo {
  /** ISO 8601 UTC. */
  notBefore: string;
  notAfter: string;
  /** RFC 8705 §3.1 `x5t#S256` of the leaf: what the partner registers the platform by. */
  x5tS256: string;
  /** The same SHA-256, lowercase hex. */
  fingerprintSha256: string;
}

export type ClientCredentialResult =
  { ok: true; credential: ClientCredentialInfo } | { ok: false; reason: ClientCredentialRefusal };

const EKU_CLIENT_AUTH = "1.3.6.1.5.5.7.3.2";
const EKU_ANY = "2.5.29.37.0";

/**
 * Check a client certificate (PEM; the leaf first, any intermediates after it) and its private key
 * (PEM, unencrypted) for outbound mTLS: both parse, the key is P-256 and is the certificate's, the
 * certificate is a leaf for TLS client authentication and is valid at `now` (default: the clock).
 */
export function checkClientCredential(
  certificatePem: string,
  keyPem: string,
  o: { now?: Date | number } = {},
): ClientCredentialResult {
  const fail = (reason: ClientCredentialRefusal): ClientCredentialResult => ({ ok: false, reason });
  let cert: X509Certificate;
  try {
    cert = new X509Certificate(certificatePem);
  } catch {
    return fail("certificate_unparsable");
  }
  let key: KeyObject;
  try {
    key = createPrivateKey({ key: keyPem, format: "pem" });
  } catch {
    return fail("key_unparsable");
  }
  if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1")
    return fail("key_type");
  if (!cert.checkPrivateKey(key)) return fail("key_mismatch");
  const eku = cert.keyUsage;
  if (cert.ca || (eku !== undefined && !eku.includes(EKU_CLIENT_AUTH) && !eku.includes(EKU_ANY)))
    return fail("not_client_certificate");
  const now = o.now === undefined ? Date.now() : Number(o.now);
  const notBefore = Date.parse(cert.validFrom);
  const notAfter = Date.parse(cert.validTo);
  if (!Number.isFinite(notBefore) || !Number.isFinite(notAfter))
    return fail("certificate_unparsable");
  if (now < notBefore) return fail("not_yet_valid");
  if (now >= notAfter) return fail("expired");
  const digest = sha256(cert.raw);
  return {
    ok: true,
    credential: {
      notBefore: new Date(notBefore).toISOString(),
      notAfter: new Date(notAfter).toISOString(),
      x5tS256: toBase64Url(digest),
      fingerprintSha256: toHex(digest),
    },
  };
}
