// JWS for regulated Ecosystem messages (Ecosystem Spec §3.6; G5, owner answer #82, R1-D-08). A
// detached JWS (RFC 7515 Appendix F) over the JCS form of the CloudEvent without its `signature`
// attribute (`cloudEventSigningPayload`), stored with the event so the proof can be re-verified.
// The profile is C-22's, as the owner set it:
//   * ES256 only, through an allow-list: `none`, every `HS*` and any other algorithm are refused;
//   * the key is in KMS (the signer is KMS `sign`, which returns DER) and `kid` is on every message;
//   * rotation without downtime: a key ring verifies with the current key and the previous one
//     during their overlap, each by its own validity window;
//   * replay protection: a fresh `jti` and an `iat` in the protected header; a verifier refuses an
//     `iat` outside a short window and a `jti` it has already accepted.
// The protected header holds `alg`, `kid`, `typ`, `iat` and `jti` only; `b64`, `crit`, `jku`,
// `jwk`, `x5u`, `x5c` and anything else is refused, as is an attached payload or a DER signature.
import { createPublicKey, verify as nodeVerify, type KeyObject } from "node:crypto";
import { derToJose, cloudEventSigningPayload, type DerSigner } from "./detached-jws.js";
import { toBase64Url } from "./encoding.js";
import { canonicalize } from "./jcs.js";
import { strictBase64Url } from "./jwt.js";
import { randomBytes } from "./random.js";

/** `typ` of a regulated-message JWS. */
export const REGULATED_JWS_TYP = "ipb-regulated-message+jws";
/** Default acceptance window for `iat`: five minutes back, one minute ahead (clock skew). */
export const REGULATED_JWS_MAX_AGE_SECONDS = 300;
export const REGULATED_JWS_MAX_SKEW_SECONDS = 60;

const HEADER_KEYS = ["alg", "kid", "typ", "iat", "jti"] as const;
const JTI = /^[A-Za-z0-9_-]{22,64}$/;
const KID = /^[\x21-\x7e]{1,256}$/;

export interface RegulatedJwsHeader {
  alg: "ES256";
  kid: string;
  typ: typeof REGULATED_JWS_TYP;
  /** Seconds since the epoch. */
  iat: number;
  jti: string;
}

/** Signs a regulated CloudEvent with the KMS key `kid`; returns the detached compact JWS. */
export async function signRegulatedMessage(o: {
  event: Record<string, unknown>;
  kid: string;
  sign: DerSigner;
  now?: Date;
  /** Only for tests; otherwise 128 random bits. */
  jti?: string;
}): Promise<string> {
  if (!KID.test(o.kid)) throw new Error("kid is required (R1-D-08)");
  const header: RegulatedJwsHeader = {
    alg: "ES256",
    kid: o.kid,
    typ: REGULATED_JWS_TYP,
    iat: Math.floor((o.now ?? new Date()).getTime() / 1000),
    jti: o.jti ?? toBase64Url(randomBytes(16)),
  };
  if (!JTI.test(header.jti)) throw new Error("jti must be 22 to 64 base64url characters");
  const h = toBase64Url(new TextEncoder().encode(canonicalize(header)));
  const input = new TextEncoder().encode(`${h}.${toBase64Url(cloudEventSigningPayload(o.event))}`);
  return `${h}..${toBase64Url(derToJose(await o.sign(input)))}`;
}

/** One verification key: an ES256 public key (SPKI DER or P-256 JWK) and when it may verify. */
export interface RegulatedVerifyKey {
  kid: string;
  key: Uint8Array | { kty: string; crv?: string; x?: string; y?: string };
  /** First and last instant a message signed (`iat`) under this key is accepted. */
  notBefore?: Date;
  notAfter?: Date;
}

/**
 * The keys a verifier trusts, by `kid`. Rotation: add the new key, start signing with it, and set
 * the old key's `notAfter` to the end of the overlap; messages signed before then still verify.
 */
export class RegulatedKeyRing {
  private readonly keys = new Map<string, { k: RegulatedVerifyKey; pub: KeyObject }>();
  constructor(keys: readonly RegulatedVerifyKey[] = []) {
    for (const k of keys) this.add(k);
  }
  add(k: RegulatedVerifyKey): void {
    if (!KID.test(k.kid)) throw new Error("invalid kid");
    const pub =
      k.key instanceof Uint8Array
        ? createPublicKey({ key: Buffer.from(k.key), format: "der", type: "spki" })
        : createPublicKey({
            key: { kty: "EC", crv: "P-256", x: String(k.key.x), y: String(k.key.y) },
            format: "jwk",
          });
    const d = pub.asymmetricKeyDetails;
    if (pub.asymmetricKeyType !== "ec" || d?.namedCurve !== "prime256v1")
      throw new Error("regulated messages are verified with EC P-256 keys only (ES256)");
    this.keys.set(k.kid, { k, pub });
  }
  /** The key for `kid` if a message signed at `iat` may be verified with it. */
  get(kid: string, iat: Date): KeyObject | undefined {
    const e = this.keys.get(kid);
    if (!e) return undefined;
    if (e.k.notBefore && iat < e.k.notBefore) return undefined;
    if (e.k.notAfter && iat > e.k.notAfter) return undefined;
    return e.pub;
  }
}

/** Remembers accepted `jti`s until they leave the `iat` window. Products back it with storage. */
export interface ReplayStore {
  /** True the first time `jti` is claimed; false if it was claimed before. */
  claim(jti: string, expiresAt: Date): Promise<boolean>;
}

/** An in-process replay store, for tests and single-instance verifiers. */
export class MemoryReplayStore implements ReplayStore {
  private readonly seen = new Map<string, number>();
  constructor(private readonly now: () => Date = () => new Date()) {}
  async claim(jti: string, expiresAt: Date): Promise<boolean> {
    const t = this.now().getTime();
    for (const [k, exp] of this.seen) if (exp < t) this.seen.delete(k);
    if (this.seen.has(jti)) return false;
    this.seen.set(jti, expiresAt.getTime());
    return true;
  }
}

export type RegulatedJwsFailure =
  "format" | "header" | "alg" | "typ" | "kid" | "signature" | "stale" | "future" | "replay";

export type RegulatedJwsResult =
  { ok: true; kid: string; jti: string; iat: Date } | { ok: false; reason: RegulatedJwsFailure };

/**
 * Verifies the detached JWS of a regulated CloudEvent: header allow-list, ES256, a key of the ring
 * valid at `iat`, the signature, the `iat` window, and finally the `jti` claim (only for a
 * message that verified, so a forgery cannot burn a real message's `jti`).
 */
export async function verifyRegulatedMessage(
  event: Record<string, unknown>,
  jws: string,
  o: {
    keys: RegulatedKeyRing;
    replay: ReplayStore;
    now?: Date;
    maxAgeSeconds?: number;
    maxSkewSeconds?: number;
  },
): Promise<RegulatedJwsResult> {
  const fail = (reason: RegulatedJwsFailure): RegulatedJwsResult => ({ ok: false, reason });
  const parts = jws.split(".");
  if (parts.length !== 3 || parts[1] !== "" || !parts[0] || !parts[2]) return fail("format");
  const [h, , s] = parts as [string, string, string];
  let header: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(strictBase64Url(h)),
    );
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
      return fail("format");
    header = parsed as Record<string, unknown>;
  } catch {
    return fail("format");
  }
  if (header.alg !== "ES256") return fail("alg");
  const keys = Object.keys(header);
  if (
    keys.some((k) => !(HEADER_KEYS as readonly string[]).includes(k)) ||
    keys.length !== HEADER_KEYS.length
  )
    return fail("header");
  if (header.typ !== REGULATED_JWS_TYP) return fail("typ");
  const { kid, iat, jti } = header;
  if (typeof kid !== "string" || !KID.test(kid)) return fail("kid");
  if (typeof jti !== "string" || !JTI.test(jti)) return fail("header");
  if (typeof iat !== "number" || !Number.isSafeInteger(iat) || iat < 0) return fail("header");
  const issued = new Date(iat * 1000);
  const pub = o.keys.get(kid, issued);
  if (!pub) return fail("kid");
  let sig: Uint8Array;
  try {
    sig = strictBase64Url(s);
  } catch {
    return fail("format");
  }
  if (sig.byteLength !== 64) return fail("signature");
  const input = Buffer.from(`${h}.${toBase64Url(cloudEventSigningPayload(event))}`, "ascii");
  if (!nodeVerify("sha256", input, { key: pub, dsaEncoding: "ieee-p1363" }, sig))
    return fail("signature");
  const now = (o.now ?? new Date()).getTime();
  const maxAge = (o.maxAgeSeconds ?? REGULATED_JWS_MAX_AGE_SECONDS) * 1000;
  const skew = (o.maxSkewSeconds ?? REGULATED_JWS_MAX_SKEW_SECONDS) * 1000;
  if (issued.getTime() > now + skew) return fail("future");
  if (issued.getTime() < now - maxAge) return fail("stale");
  if (!(await o.replay.claim(jti, new Date(issued.getTime() + maxAge + skew))))
    return fail("replay");
  return { ok: true, kid, jti, iat: issued };
}
