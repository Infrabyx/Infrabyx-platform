// X.509 pieces of the PAdES/CMS verifier (C-28, R1-D-246; verify only): the algorithm allow-list,
// signature verification through node:crypto, and the certificate fields X509Certificate does not
// expose. Internal to @infrabyx/crypto.
import { X509Certificate, createHash, verify, constants, type KeyObject } from "node:crypto";
import {
  DerError,
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
import { assertApproved } from "./registry.js";

export type PadesHash = "sha256" | "sha384" | "sha512";
export type AlgFailure = "weak_algorithm" | "unsupported_algorithm" | "key_too_weak";

/** A refusal of an algorithm or key, with a fixed label. */
export class AlgError extends Error {
  constructor(readonly label: AlgFailure) {
    super(label);
    this.name = "AlgError";
  }
}

const HASHES: Record<string, PadesHash> = {
  "2.16.840.1.101.3.4.2.1": "sha256",
  "2.16.840.1.101.3.4.2.2": "sha384",
  "2.16.840.1.101.3.4.2.3": "sha512",
};
export const HASH_OID: Record<PadesHash, string> = {
  sha256: "2.16.840.1.101.3.4.2.1",
  sha384: "2.16.840.1.101.3.4.2.2",
  sha512: "2.16.840.1.101.3.4.2.3",
};
const HASH_BYTES: Record<PadesHash, number> = { sha256: 32, sha384: 48, sha512: 64 };
const WEAK = new Set([
  "1.3.14.3.2.26", // SHA-1
  "1.2.840.113549.2.5", // MD5
  "1.2.840.113549.2.2", // MD2
  "1.2.840.113549.1.1.2", // md2WithRSA
  "1.2.840.113549.1.1.4", // md5WithRSA
  "1.2.840.113549.1.1.5", // sha1WithRSA
  "1.3.14.3.2.29", // sha1WithRSA (OIW)
  "1.2.840.10045.4.1", // ecdsa-with-SHA1
  "1.2.840.10040.4.3", // dsa-with-SHA1
]);
const RSA = "1.2.840.113549.1.1.1";
const PSS = "1.2.840.113549.1.1.10";
const MGF1 = "1.2.840.113549.1.1.8";
const EC_KEY = "1.2.840.10045.2.1";
const PKCS1: Record<string, PadesHash> = {
  "1.2.840.113549.1.1.11": "sha256",
  "1.2.840.113549.1.1.12": "sha384",
  "1.2.840.113549.1.1.13": "sha512",
};
const ECDSA: Record<string, PadesHash> = {
  "1.2.840.10045.4.3.2": "sha256",
  "1.2.840.10045.4.3.3": "sha384",
};

const refuse = (oid: string): never => {
  throw new AlgError(WEAK.has(oid) ? "weak_algorithm" : "unsupported_algorithm");
};

/** AlgorithmIdentifier: its OID and optional parameters (absent or NULL allowed for digests). */
function algId(d: Uint8Array, t: Tlv): { oid: string; params: Tlv | undefined } {
  const [o, p, ...rest] = children(d, expect(t, TAG.SEQUENCE), 2);
  if (rest.length) throw new DerError("bad AlgorithmIdentifier");
  return { oid: oidOf(d, o!), params: p };
}

function noParams(d: Uint8Array, p: Tlv | undefined): void {
  if (p && (p.tag !== TAG.NULL || p.end !== p.body)) throw new DerError("unexpected parameters");
}

/** A digest AlgorithmIdentifier; SHA-1 and MD5 are `weak_algorithm`. */
export function hashOf(d: Uint8Array, t: Tlv): PadesHash {
  const { oid, params } = algId(d, t);
  const h = HASHES[oid];
  if (!h) return refuse(oid);
  noParams(d, params);
  return h;
}

export interface SigAlg {
  kind: "pkcs1" | "pss" | "ecdsa";
  hash: PadesHash;
  saltLength?: number;
}

function explicit(d: Uint8Array, t: Tlv): Tlv {
  const [inner, ...rest] = children(d, t, 1);
  if (!inner || rest.length) throw new DerError("bad explicit tag");
  return inner;
}

function pssParams(d: Uint8Array, p: Tlv | undefined): SigAlg {
  if (!p || p.tag !== TAG.SEQUENCE) throw new AlgError("weak_algorithm"); // defaults are SHA-1
  let hash: PadesHash | undefined;
  let mgfHash: PadesHash | undefined;
  let salt = 20;
  let last = -1;
  for (const c of children(d, p, 4)) {
    const n = c.tag - 0xa0;
    if (n < 0 || n > 3 || n <= last) throw new DerError("bad PSS parameters");
    last = n;
    const v = explicit(d, c);
    if (n === 0) hash = hashOf(d, v);
    else if (n === 1) {
      const m = algId(d, v);
      if (m.oid !== MGF1 || !m.params) refuse(m.oid);
      mgfHash = hashOf(d, m.params!);
    } else if (n === 2) salt = smallIntOf(d, v);
    else if (smallIntOf(d, v) !== 1) throw new AlgError("unsupported_algorithm");
  }
  if (!hash || !mgfHash) throw new AlgError("weak_algorithm");
  if (mgfHash !== hash || salt > 512) throw new AlgError("unsupported_algorithm");
  return { kind: "pss", hash, saltLength: salt };
}

/**
 * A signature AlgorithmIdentifier. `digest` is the CMS digest algorithm, required for the bare
 * key OIDs (rsaEncryption, id-ecPublicKey) and otherwise required to match the algorithm's hash.
 */
export function sigAlgOf(d: Uint8Array, t: Tlv, digest?: PadesHash): SigAlg {
  const { oid, params } = algId(d, t);
  let a: SigAlg;
  if (oid === PSS) a = pssParams(d, params);
  else if (PKCS1[oid]) {
    noParams(d, params);
    a = { kind: "pkcs1", hash: PKCS1[oid] };
  } else if (ECDSA[oid]) {
    if (params) throw new DerError("unexpected parameters");
    a = { kind: "ecdsa", hash: ECDSA[oid] };
  } else if ((oid === RSA || oid === EC_KEY) && digest) {
    if (oid === RSA) noParams(d, params);
    a = { kind: oid === RSA ? "pkcs1" : "ecdsa", hash: digest };
  } else return refuse(oid);
  if (digest && a.hash !== digest) throw new AlgError("unsupported_algorithm");
  return a;
}

/** The registry id of `alg` used with `key`, or a refusal (RSA ≥ 2048; P-256/SHA-256, P-384/SHA-384). */
export function registryIdFor(alg: SigAlg, key: KeyObject): string {
  const det = key.asymmetricKeyDetails ?? {};
  if (alg.kind === "ecdsa") {
    if (key.asymmetricKeyType !== "ec") throw new AlgError("unsupported_algorithm");
    if (det.namedCurve === "prime256v1" && alg.hash === "sha256") return "ecdsa-p256-sha256";
    if (det.namedCurve === "secp384r1" && alg.hash === "sha384") return "ecdsa-p384-sha384";
    throw new AlgError("unsupported_algorithm");
  }
  if (key.asymmetricKeyType !== "rsa" && key.asymmetricKeyType !== "rsa-pss")
    throw new AlgError("unsupported_algorithm");
  if ((det.modulusLength ?? 0) < 2048) throw new AlgError("key_too_weak");
  const id = `${alg.kind === "pss" ? "rsassa-pss" : "rsassa-pkcs1-v1_5"}-${alg.hash}`;
  return id;
}

/** Verifies `sig` over `data` with `key` under `alg`, after the registry check. */
export function verifySig(alg: SigAlg, key: KeyObject, data: Uint8Array, sig: Uint8Array): boolean {
  const id = registryIdFor(alg, key);
  assertApproved(id, "signature");
  try {
    if (alg.kind === "ecdsa") return verify(alg.hash, data, { key, dsaEncoding: "der" }, sig);
    if (alg.kind === "pss")
      return verify(
        alg.hash,
        data,
        { key, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: alg.saltLength ?? 20 },
        sig,
      );
    return verify(alg.hash, data, { key, padding: constants.RSA_PKCS1_PADDING }, sig);
  } catch {
    return false;
  }
}

export function digestOf(h: PadesHash, ...parts: Uint8Array[]): Buffer {
  assertApproved(h === "sha256" ? "sha-256" : h === "sha384" ? "sha-384" : "sha-512", "hash");
  const x = createHash(h);
  for (const p of parts) x.update(p);
  return x.digest();
}

export const hashBytes = (h: PadesHash): number => HASH_BYTES[h];

// ---------------------------------------------------------------- certificates

export const EXT = {
  KEY_USAGE: "2.5.29.15",
  BASIC_CONSTRAINTS: "2.5.29.19",
  EXT_KEY_USAGE: "2.5.29.37",
  SUBJECT_KEY_ID: "2.5.29.14",
  SUBJECT_ALT_NAME: "2.5.29.17",
} as const;
/** Critical extensions this verifier processes; any other critical extension fails the path. */
const CRITICAL_OK = new Set<string>([
  EXT.KEY_USAGE,
  EXT.BASIC_CONSTRAINTS,
  EXT.EXT_KEY_USAGE,
  EXT.SUBJECT_ALT_NAME,
]);

export interface ParsedCert {
  der: Buffer;
  x509: X509Certificate;
  sha256: string;
  tbs: Buffer;
  sigAlgTlv: { d: Buffer; t: Tlv };
  signature: Buffer;
  serial: Buffer;
  issuer: Buffer;
  subject: Buffer;
  notBefore: Date;
  notAfter: Date;
  /** The subjectPublicKey BIT STRING contents (for OCSP key hashes). */
  publicKeyBits: Buffer;
  extensions: Map<string, { critical: boolean; value: Buffer }>;
}

/** Parses a DER certificate; throws DerError (or Node's error) when it is not one. */
export function parseCert(input: Uint8Array): ParsedCert {
  const der = Buffer.from(input);
  const top = readOne(der);
  const [tbsT, algT, sigT, ...more] = children(der, expect(top, TAG.SEQUENCE), 3);
  if (more.length) throw new DerError("bad certificate");
  const f = children(der, expect(tbsT, TAG.SEQUENCE), 10);
  let i = 0;
  if (f[0]?.tag === 0xa0) i++;
  const serialT = f[i++];
  const innerAlg = f[i++];
  const issuerT = expect(f[i++], TAG.SEQUENCE);
  const validity = children(der, expect(f[i++], TAG.SEQUENCE), 2);
  const subjectT = expect(f[i++], TAG.SEQUENCE);
  const spki = children(der, expect(f[i++], TAG.SEQUENCE), 2);
  const serial = integerOf(der, serialT!);
  if (!innerAlg || !encodingOf(der, innerAlg).equals(encodingOf(der, algT!)))
    throw new DerError("signature algorithms differ");
  const extensions = new Map<string, { critical: boolean; value: Buffer }>();
  for (; i < f.length; i++) {
    const c = f[i]!;
    if (c.tag === 0x81 || c.tag === 0x82) continue;
    if (c.tag !== 0xa3 || i !== f.length - 1) throw new DerError("bad certificate fields");
    for (const e of children(der, expect(explicit(der, c), TAG.SEQUENCE), 64)) {
      const parts = children(der, expect(e, TAG.SEQUENCE), 3);
      const id = oidOf(der, parts[0]!);
      const critical = parts.length === 3 ? booleanOf(der, parts[1]!) : false;
      const value = bytesOf(der, expect(parts[parts.length - 1], TAG.OCTET_STRING));
      if (parts.length < 2 || extensions.has(id)) throw new DerError("bad extension");
      extensions.set(id, { critical, value });
    }
  }
  const x509 = new X509Certificate(der);
  return {
    der,
    x509,
    sha256: createHash("sha256").update(der).digest("hex"),
    tbs: encodingOf(der, tbsT!),
    sigAlgTlv: { d: der, t: algT! },
    signature: bitStringOf(der, sigT!).bytes,
    serial,
    issuer: encodingOf(der, issuerT),
    subject: encodingOf(der, subjectT),
    notBefore: timeOf(der, validity[0]!),
    notAfter: timeOf(der, validity[1]!),
    publicKeyBits: bitStringOf(der, spki[1]!).bytes,
    extensions,
  };
}

/** True when every critical extension of `c` is one this verifier processes. */
export const criticalExtensionsKnown = (c: ParsedCert): boolean =>
  [...c.extensions].every(([id, e]) => !e.critical || CRITICAL_OK.has(id));

/** Key usage bits (bit 0 = digitalSignature) or undefined when the extension is absent. */
export function keyUsage(c: ParsedCert): ((bit: number) => boolean) | undefined {
  const e = c.extensions.get(EXT.KEY_USAGE);
  if (!e) return undefined;
  const { bytes } = bitStringOf(e.value, readOne(e.value));
  return (bit) => ((bytes[bit >> 3] ?? 0) & (0x80 >> (bit & 7))) !== 0;
}

/** Extended key usage OIDs, or undefined when absent. */
export function extKeyUsage(c: ParsedCert): string[] | undefined {
  const e = c.extensions.get(EXT.EXT_KEY_USAGE);
  if (!e) return undefined;
  return children(e.value, expect(readOne(e.value), TAG.SEQUENCE), 32).map((t) =>
    oidOf(e.value, t),
  );
}

/** Basic constraints: whether a CA, and the path length limit if any. */
export function basicConstraints(c: ParsedCert): { ca: boolean; pathLen?: number } {
  const e = c.extensions.get(EXT.BASIC_CONSTRAINTS);
  if (!e) return { ca: false };
  const parts = children(e.value, expect(readOne(e.value), TAG.SEQUENCE), 2);
  let ca = false;
  let pathLen: number | undefined;
  for (const p of parts) {
    if (p.tag === TAG.BOOLEAN) ca = booleanOf(e.value, p);
    else pathLen = smallIntOf(e.value, p);
  }
  return pathLen === undefined ? { ca } : { ca, pathLen };
}

/** The subject key identifier, or undefined. */
export function subjectKeyId(c: ParsedCert): Buffer | undefined {
  const e = c.extensions.get(EXT.SUBJECT_KEY_ID);
  if (!e) return undefined;
  return bytesOf(e.value, expect(readOne(e.value), TAG.OCTET_STRING));
}

/** Verifies that `issuer` signed `cert` (names, key and an allowed algorithm). */
export function issuedBy(cert: ParsedCert, issuer: ParsedCert): boolean {
  if (!cert.issuer.equals(issuer.subject)) return false;
  const alg = sigAlgOf(cert.sigAlgTlv.d, cert.sigAlgTlv.t);
  return verifySig(alg, issuer.x509.publicKey, cert.tbs, cert.signature);
}

export const validAt = (c: ParsedCert, t: Date): boolean =>
  c.notBefore.getTime() <= t.getTime() && t.getTime() <= c.notAfter.getTime();
