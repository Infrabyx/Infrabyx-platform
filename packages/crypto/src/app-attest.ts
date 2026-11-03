// C-27 (owner answer #99, R1-D-57, R1-D-59): Apple App Attest verification on the server, on
// `node:crypto` only. An attestation (once per app key) is a CBOR object whose `x5c` chain must end
// at Apple's App Attestation root, pinned here. Its leaf certificate carries, in extension
// 1.2.840.113635.100.8.2, the SHA-256 of the authenticator data followed by the SHA-256 of the
// client data, which proves the key was made for this challenge. The authenticator data names the
// app (SHA-256 of `<team id>.<bundle id>`), the key (its id is the SHA-256 of the public point) and
// a counter of 0. An assertion (per request) is an ES256 signature by that key over the same nonce
// construction, with a counter that must grow. Nothing here signs: C-27 only verifies.
import { X509Certificate, createHash, createPublicKey, timingSafeEqual, verify } from "node:crypto";

/** Apple App Attestation Root CA (P-384; valid 2020-03-18 to 2045-03-15). */
export const APPLE_APP_ATTEST_ROOT_PEM = `-----BEGIN CERTIFICATE-----
MIICITCCAaegAwIBAgIQC/O+DvHN0uD7jG5yH2IXmDAKBggqhkjOPQQDAzBSMSYw
JAYDVQQDDB1BcHBsZSBBcHAgQXR0ZXN0YXRpb24gUm9vdCBDQTETMBEGA1UECgwK
QXBwbGUgSW5jLjETMBEGA1UECAwKQ2FsaWZvcm5pYTAeFw0yMDAzMTgxODMyNTNa
Fw00NTAzMTUwMDAwMDBaMFIxJjAkBgNVBAMMHUFwcGxlIEFwcCBBdHRlc3RhdGlv
biBSb290IENBMRMwEQYDVQQKDApBcHBsZSBJbmMuMRMwEQYDVQQIDApDYWxpZm9y
bmlhMHYwEAYHKoZIzj0CAQYFK4EEACIDYgAERTHhmLW07ATaFQIEVwTtT4dyctdh
NbJhFs/Ii2FdCgAHGbpphY3+d8qjuDngIN3WVhQUBHAoMeQ/cLiP1sOUtgjqK9au
Yen1mMEvRq9Sk3Jm5X8U62H+xTD3FE9TgS41o0IwQDAPBgNVHRMBAf8EBTADAQH/
MB0GA1UdDgQWBBSskRBTM72+aEH/pwyp5frq5eWKoTAOBgNVHQ8BAf8EBAMCAQYw
CgYIKoZIzj0EAwMDaAAwZQIwQgFGnByvsiVbpTKwSga0kP0e8EeDS4+sQmTvb7vn
53O5+FRXgeLhpJ06ysC5PrOyAjEAp5U4xDgEgllF7En3VcE3iexZZtKeYnpqtijV
oyFraWVIyd/dganmrduC1bmTBGwD
-----END CERTIFICATE-----
`;
/** SHA-256 of the pinned root's DER, as Apple publishes it; checked when the module loads. */
export const APPLE_APP_ATTEST_ROOT_SHA256 =
  "1cb9823ba28ba6ad2d33a006941de2ae4f513ef1d4e831b9f7e0fa7b6242c932";

const NONCE_OID = [0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x63, 0x64, 0x08, 0x02];
const AAGUID_PROD = Buffer.concat([Buffer.from("appattest"), Buffer.alloc(7)]);
const AAGUID_DEV = Buffer.from("appattestdevelop");
const APP_ID = /^[A-Z0-9]{10}\.[A-Za-z0-9.-]+$/;

export type AppAttestFailure =
  "invalid" | "app_mismatch" | "binding_mismatch" | "unknown_key" | "replayed";

/** A refused attestation or assertion; `reason` maps onto the DEVICE_ATTESTATION verdicts. */
export class AppAttestError extends Error {
  constructor(
    readonly reason: AppAttestFailure,
    detail: string,
  ) {
    super(`App Attest: ${detail}`);
    this.name = "AppAttestError";
  }
}
const fail = (reason: AppAttestFailure, detail: string): never => {
  throw new AppAttestError(reason, detail);
};

const sha256 = (...parts: Uint8Array[]): Buffer => {
  const h = createHash("sha256");
  for (const p of parts) h.update(p);
  return h.digest();
};
const same = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

if (
  createHash("sha256").update(new X509Certificate(APPLE_APP_ATTEST_ROOT_PEM).raw).digest("hex") !==
  APPLE_APP_ATTEST_ROOT_SHA256
)
  throw new Error("C-27: the pinned Apple App Attestation root does not match its fingerprint");

// ---------------------------------------------------------------- CBOR (RFC 8949), the subset used

type Cbor = number | bigint | Uint8Array | string | Cbor[] | Map<Cbor, Cbor> | boolean | null;

/** Decode one CBOR item: unsigned and negative integers, byte and text strings, arrays, maps. */
export function decodeCbor(bytes: Uint8Array, maxDepth = 8): Cbor {
  const b = Buffer.from(bytes);
  let at = 0;
  const need = (n: number) => {
    if (at + n > b.length) fail("invalid", "truncated CBOR");
  };
  const len = (info: number): number => {
    if (info < 24) return info;
    const size = info === 24 ? 1 : info === 25 ? 2 : info === 26 ? 4 : info === 27 ? 8 : 0;
    if (!size) return fail("invalid", "indefinite or reserved CBOR length");
    need(size);
    const v =
      size === 1
        ? b.readUInt8(at)
        : size === 2
          ? b.readUInt16BE(at)
          : size === 4
            ? b.readUInt32BE(at)
            : Number(b.readBigUInt64BE(at));
    at += size;
    if (!Number.isSafeInteger(v)) fail("invalid", "CBOR length out of range");
    return v;
  };
  const item = (depth: number): Cbor => {
    if (depth > maxDepth) fail("invalid", "CBOR nested too deeply");
    need(1);
    const head = b.readUInt8(at++);
    const major = head >> 5;
    const info = head & 31;
    switch (major) {
      case 0:
        return len(info);
      case 1:
        return -1 - len(info);
      case 2:
      case 3: {
        const n = len(info);
        need(n);
        const v = b.subarray(at, at + n);
        at += n;
        return major === 2 ? new Uint8Array(v) : v.toString("utf8");
      }
      case 4: {
        const n = len(info);
        if (n > 64) fail("invalid", "CBOR array too long");
        return Array.from({ length: n }, () => item(depth + 1));
      }
      case 5: {
        const n = len(info);
        if (n > 64) fail("invalid", "CBOR map too long");
        const m = new Map<Cbor, Cbor>();
        for (let i = 0; i < n; i++) m.set(item(depth + 1), item(depth + 1));
        return m;
      }
      case 7:
        if (info === 20) return false;
        if (info === 21) return true;
        if (info === 22) return null;
        return fail("invalid", "unsupported CBOR simple value");
      default:
        return fail("invalid", "unsupported CBOR type");
    }
  };
  const out = item(0);
  if (at !== b.length) fail("invalid", "trailing bytes after CBOR");
  return out;
}

const field = (m: Cbor, k: string): Cbor | undefined => (m instanceof Map ? m.get(k) : undefined);
const bytesOf = (v: Cbor | undefined, what: string): Uint8Array =>
  v instanceof Uint8Array ? v : fail("invalid", `${what} missing`);

// ---------------------------------------------------------------- DER, only to find one extension

interface Tlv {
  tag: number;
  start: number;
  end: number;
}
function tlv(d: Buffer, at: number, limit: number): Tlv {
  if (at + 2 > limit) fail("invalid", "truncated DER");
  const tag = d[at]!;
  let n = d[at + 1]!;
  let p = at + 2;
  if (n & 0x80) {
    const k = n & 0x7f;
    if (k < 1 || k > 3 || p + k > limit) fail("invalid", "bad DER length");
    n = 0;
    for (let i = 0; i < k; i++) n = (n << 8) | d[p + i]!;
    p += k;
  }
  if (p + n > limit) fail("invalid", "DER overruns its parent");
  return { tag, start: p, end: p + n };
}
function children(d: Buffer, parent: Tlv): Tlv[] {
  const out: Tlv[] = [];
  for (let at = parent.start; at < parent.end;) {
    const t = tlv(d, at, parent.end);
    out.push(t);
    at = t.end;
  }
  return out;
}

/** The 32-byte nonce in the leaf certificate's Apple extension (1.2.840.113635.100.8.2). */
export function appleNonceOf(certDer: Uint8Array): Uint8Array {
  const d = Buffer.from(certDer);
  const cert = tlv(d, 0, d.length);
  const tbs = children(d, cert)[0] ?? fail("invalid", "no TBSCertificate");
  const exts = children(d, tbs).find((t) => t.tag === 0xa3);
  const list = exts ? children(d, exts)[0] : undefined;
  for (const ext of list ? children(d, list) : []) {
    const [oid, ...rest] = children(d, ext);
    if (!oid || !same(d.subarray(oid.start - 2, oid.end), Buffer.from(NONCE_OID))) continue;
    const value = rest.at(-1);
    if (!value || value.tag !== 0x04) break;
    // OCTET STRING { SEQUENCE { [1] { OCTET STRING nonce } } }
    const seq = tlv(d, value.start, value.end);
    const tagged = children(d, seq).find((t) => t.tag === 0xa1);
    const inner = tagged ? tlv(d, tagged.start, tagged.end) : undefined;
    if (!inner || inner.tag !== 0x04 || inner.end - inner.start !== 32) break;
    return new Uint8Array(d.subarray(inner.start, inner.end));
  }
  return fail("invalid", "the credential certificate has no App Attest nonce");
}

// ---------------------------------------------------------------- attestation and assertion

export interface AppAttestAttestationInput {
  /** The CBOR attestation object, base64. */
  attestation: string;
  /** `<team id>.<bundle id>`. */
  appId: string;
  /** The key id the app reported (base64 of the SHA-256 of the public point). */
  keyId: string;
  /** The challenge the app hashed into its client data: the server's nonce or the DPoP `jkt`. */
  challenge: string;
  /** Accept the development environment (`appattestdevelop`); production only by default. */
  allowDevelopment?: boolean;
  /** Tests only: other roots in place of Apple's. Never set in production. */
  roots?: readonly string[];
  now?: Date;
}

export interface AppAttestKey {
  /** The credential's public key, SPKI DER. */
  publicKey: Uint8Array;
  environment: "production" | "development";
  /** Apple's receipt, kept by the product for fraud-risk checks. */
  receipt?: Uint8Array;
}

function within(c: X509Certificate, now: Date, what: string): void {
  if (now < new Date(c.validFrom) || now > new Date(c.validTo))
    fail("invalid", `the ${what} certificate is not valid now`);
}

function authFlags(auth: Buffer, appId: string): { counter: number } {
  if (auth.length < 37) fail("invalid", "authenticator data too short");
  if (!same(auth.subarray(0, 32), sha256(Buffer.from(appId))))
    fail("app_mismatch", "the authenticator data names another app");
  return { counter: auth.readUInt32BE(33) };
}

/** Verify a key's attestation (C-27); returns the key to keep with the device. */
export function verifyAppAttestAttestation(i: AppAttestAttestationInput): AppAttestKey {
  if (!APP_ID.test(i.appId)) fail("app_mismatch", "invalid app id");
  const obj = decodeCbor(Buffer.from(i.attestation, "base64"));
  if (field(obj, "fmt") !== "apple-appattest") fail("invalid", "not an App Attest attestation");
  const stmt = field(obj, "attStmt");
  const x5c = field(stmt ?? null, "x5c");
  if (!Array.isArray(x5c) || x5c.length < 2) fail("invalid", "the certificate chain is missing");
  const [leaf, inter] = (x5c as Cbor[])
    .slice(0, 2)
    .map((c) => new X509Certificate(Buffer.from(bytesOf(c, "certificate"))));
  const now = i.now ?? new Date();
  const roots = (i.roots ?? [APPLE_APP_ATTEST_ROOT_PEM]).map((p) => new X509Certificate(p));
  const root = roots.find((r) => inter!.checkIssued(r) && inter!.verify(r.publicKey));
  if (!root) fail("invalid", "the chain does not end at the App Attest root");
  if (!inter!.ca) fail("invalid", "the intermediate certificate is not a CA");
  if (!leaf!.checkIssued(inter!) || !leaf!.verify(inter!.publicKey))
    fail("invalid", "the credential certificate is not issued by the intermediate");
  within(leaf!, now, "credential");
  within(inter!, now, "intermediate");
  within(root!, now, "root");

  const auth = Buffer.from(bytesOf(field(obj, "authData"), "authData"));
  const nonce = sha256(auth, sha256(Buffer.from(i.challenge, "utf8")));
  if (!same(appleNonceOf(leaf!.raw), nonce))
    fail("binding_mismatch", "the attestation was made for another challenge");

  const key = leaf!.publicKey;
  const jwk = key.export({ format: "jwk" }) as {
    kty?: string;
    crv?: string;
    x?: string;
    y?: string;
  };
  if (jwk.kty !== "EC" || jwk.crv !== "P-256" || !jwk.x || !jwk.y)
    fail("invalid", "the credential key is not P-256");
  const point = Buffer.concat([
    Buffer.from([4]),
    Buffer.from(jwk.x!, "base64url"),
    Buffer.from(jwk.y!, "base64url"),
  ]);
  const keyId = Buffer.from(i.keyId, "base64");
  if (!same(sha256(point), keyId)) fail("unknown_key", "the key id does not match the key");

  const { counter } = authFlags(auth, i.appId);
  if (counter !== 0) fail("invalid", "a new key's counter must be 0");
  if (auth.length < 55) fail("invalid", "authenticator data has no credential");
  const aaguid = auth.subarray(37, 53);
  const environment = same(aaguid, AAGUID_PROD)
    ? "production"
    : same(aaguid, AAGUID_DEV)
      ? "development"
      : fail("invalid", "unknown App Attest environment");
  if (environment === "development" && !i.allowDevelopment)
    fail("invalid", "a development attestation is refused");
  const idLen = auth.readUInt16BE(53);
  if (auth.length < 55 + idLen || !same(auth.subarray(55, 55 + idLen), keyId))
    fail("unknown_key", "the credential id does not match the key id");

  const receipt = field(stmt ?? null, "receipt");
  return {
    publicKey: new Uint8Array(key.export({ type: "spki", format: "der" })),
    environment,
    ...(receipt instanceof Uint8Array ? { receipt } : {}),
  };
}

export interface AppAttestAssertionInput {
  /** The CBOR assertion, base64. */
  assertion: string;
  appId: string;
  /** The key's public key from its attestation, SPKI DER. */
  publicKey: Uint8Array;
  /** The challenge the app hashed into this request's client data. */
  challenge: string;
  /** The counter stored after the key's last accepted assertion. */
  counter: number;
}

/** Verify an assertion (C-27: ES256 by the attested key); returns the new counter to store. */
export function verifyAppAttestAssertion(i: AppAttestAssertionInput): { counter: number } {
  const obj = decodeCbor(Buffer.from(i.assertion, "base64"));
  const signature = Buffer.from(bytesOf(field(obj, "signature"), "signature"));
  const auth = Buffer.from(bytesOf(field(obj, "authenticatorData"), "authenticatorData"));
  const nonce = sha256(auth, sha256(Buffer.from(i.challenge, "utf8")));
  const key = createPublicKey({ key: Buffer.from(i.publicKey), format: "der", type: "spki" });
  if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1")
    fail("invalid", "the stored key is not P-256");
  if (!verify("sha256", nonce, { key, dsaEncoding: "der" }, signature))
    fail("binding_mismatch", "the assertion's signature does not cover this challenge");
  const { counter } = authFlags(auth, i.appId);
  if (counter <= i.counter) fail("replayed", "the assertion counter did not grow");
  return { counter };
}
