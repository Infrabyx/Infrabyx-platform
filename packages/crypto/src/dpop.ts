// DPoP proof verification (RFC 9449) for customer sessions (OWNER-QUESTIONS #84 (b), R1-D-18).
// The profile is the owner's C-item, under C-11:
//   * ES256 only, through an allow-list: `none`, every `HS*`, `RS*`, `PS*` and `ES384` are refused;
//   * `jkt` binding: the proof's key is named by its RFC 7638 thumbprint, and a caller that expects a
//     key (the access token's `cnf.jkt`, a registered device) gets a refusal for any other;
//   * a short `iat` window: 60 s back and 30 s ahead by default, never more than 300 s and 60 s;
//   * `jti` replay protection: a `jti` is claimed once per key, after the proof has verified, so a
//     forgery cannot burn a real proof's `jti`.
// Strict shapes: the header holds exactly `typ` (`dpop+jwt`), `alg` and `jwk`; the JWK exactly
// `kty`, `crv`, `x` and `y` of a P-256 point (a private member is refused); the payload only `jti`,
// `htm`, `htu`, `iat` and, with an access token, `ath`. `htu` is compared without its query and
// fragment, with the host lowercased and the default port dropped.
import { createPublicKey, verify as nodeVerify, type KeyObject } from "node:crypto";
import { toBase64Url } from "./encoding.js";
import { sha256 } from "./hash.js";
import { strictBase64Url } from "./jwt.js";
import type { ReplayStore } from "./regulated-jws.js";

export const DPOP_TYP = "dpop+jwt";
export const DPOP_MAX_AGE_SECONDS = 60;
export const DPOP_MAX_SKEW_SECONDS = 30;
/** The widest window a verifier may be configured with. */
export const DPOP_MAX_AGE_LIMIT_SECONDS = 300;
export const DPOP_MAX_SKEW_LIMIT_SECONDS = 60;

const HEADER_KEYS = ["typ", "alg", "jwk"] as const;
const JWK_KEYS = ["kty", "crv", "x", "y"] as const;
const PAYLOAD_KEYS = ["jti", "htm", "htu", "iat", "ath"] as const;
const JTI = /^[\x21-\x7e]{16,128}$/;
const HTM = /^[A-Z]{3,10}$/;

/** An EC P-256 public key as a DPoP proof carries it. */
export interface DpopJwk {
  kty: "EC";
  crv: "P-256";
  x: string;
  y: string;
}

export type DpopFailure =
  | "format"
  | "header"
  | "typ"
  | "alg"
  | "jwk"
  | "signature"
  | "claims"
  | "htm"
  | "htu"
  | "ath"
  | "stale"
  | "future"
  | "jkt"
  | "replay";

export type DpopResult =
  | { ok: true; jkt: string; jti: string; iat: Date; jwk: DpopJwk }
  | { ok: false; reason: DpopFailure };

/** RFC 7638 JWK SHA-256 thumbprint of an EC key: the members in lexical order, no whitespace. */
export function jwkThumbprint(jwk: Pick<DpopJwk, "crv" | "kty" | "x" | "y">): string {
  const canonical = `{"crv":${JSON.stringify(jwk.crv)},"kty":${JSON.stringify(jwk.kty)},"x":${JSON.stringify(jwk.x)},"y":${JSON.stringify(jwk.y)}}`;
  return toBase64Url(sha256(new TextEncoder().encode(canonical)));
}

/** `ath`: base64url SHA-256 of the access token's ASCII form (RFC 9449 §4.2). */
export function accessTokenHash(accessToken: string): string {
  return toBase64Url(sha256(new TextEncoder().encode(accessToken)));
}

/** The form of an HTTP target `htu` is compared in: no query or fragment, host lowercased. */
export function normaliseHtu(url: string): string {
  const u = new URL(url);
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new TypeError("htu must be HTTP(S)");
  return `${u.protocol}//${u.host}${u.pathname}`;
}

function object(segment: string): Record<string, unknown> | undefined {
  try {
    const v: unknown = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(strictBase64Url(segment)),
    );
    return typeof v === "object" && v !== null && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

const onlyKeys = (o: Record<string, unknown>, allowed: readonly string[]) =>
  Object.keys(o).every((k) => allowed.includes(k));

/**
 * Verifies a DPoP proof for one request: shape, ES256 signature by the embedded key, `htm`, `htu`,
 * `ath` (when `accessToken` is given), the `iat` window, the expected `jkt` (when given), then
 * claims `jti` in `replay`. The result names the key's thumbprint for the caller's binding checks.
 */
export async function verifyDpopProof(
  proof: string,
  o: {
    method: string;
    url: string;
    replay: ReplayStore;
    accessToken?: string;
    jkt?: string;
    now?: Date;
    maxAgeSeconds?: number;
    maxSkewSeconds?: number;
  },
): Promise<DpopResult> {
  const maxAgeS = o.maxAgeSeconds ?? DPOP_MAX_AGE_SECONDS;
  const skewS = o.maxSkewSeconds ?? DPOP_MAX_SKEW_SECONDS;
  if (maxAgeS <= 0 || maxAgeS > DPOP_MAX_AGE_LIMIT_SECONDS)
    throw new RangeError(`the DPoP iat window is at most ${DPOP_MAX_AGE_LIMIT_SECONDS} s`);
  if (skewS < 0 || skewS > DPOP_MAX_SKEW_LIMIT_SECONDS)
    throw new RangeError(`the DPoP clock skew is at most ${DPOP_MAX_SKEW_LIMIT_SECONDS} s`);
  const fail = (reason: DpopFailure): DpopResult => ({ ok: false, reason });
  if (typeof proof !== "string" || proof.length > 4096) return fail("format");
  const parts = proof.split(".");
  if (parts.length !== 3 || parts.some((p) => p === "")) return fail("format");
  const [h, p, s] = parts as [string, string, string];
  const header = object(h);
  const payload = object(p);
  if (!header || !payload) return fail("format");
  if (header.alg !== "ES256") return fail("alg");
  if (!onlyKeys(header, HEADER_KEYS) || Object.keys(header).length !== HEADER_KEYS.length)
    return fail("header");
  if (header.typ !== DPOP_TYP) return fail("typ");

  const jwk = header.jwk as Record<string, unknown> | null;
  if (typeof jwk !== "object" || jwk === null || Array.isArray(jwk)) return fail("jwk");
  if (!onlyKeys(jwk, JWK_KEYS) || Object.keys(jwk).length !== JWK_KEYS.length) return fail("jwk");
  if (jwk.kty !== "EC" || jwk.crv !== "P-256") return fail("jwk");
  if (typeof jwk.x !== "string" || typeof jwk.y !== "string") return fail("jwk");
  let key: KeyObject;
  try {
    if (strictBase64Url(jwk.x).byteLength !== 32 || strictBase64Url(jwk.y).byteLength !== 32)
      return fail("jwk");
    key = createPublicKey({
      key: { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y },
      format: "jwk",
    });
  } catch {
    return fail("jwk");
  }

  let sig: Uint8Array;
  try {
    sig = strictBase64Url(s);
  } catch {
    return fail("format");
  }
  if (sig.byteLength !== 64) return fail("signature");
  if (
    !nodeVerify(
      "sha256",
      Buffer.from(`${h}.${p}`, "ascii"),
      { key, dsaEncoding: "ieee-p1363" },
      sig,
    )
  )
    return fail("signature");

  if (!onlyKeys(payload, PAYLOAD_KEYS)) return fail("claims");
  const { jti, htm, htu, iat, ath } = payload;
  if (typeof jti !== "string" || !JTI.test(jti)) return fail("claims");
  if (typeof htm !== "string" || !HTM.test(htm) || typeof htu !== "string") return fail("claims");
  if (typeof iat !== "number" || !Number.isSafeInteger(iat) || iat < 0) return fail("claims");
  if (htm !== o.method.toUpperCase()) return fail("htm");
  let target: string;
  try {
    target = normaliseHtu(htu);
  } catch {
    return fail("htu");
  }
  if (target !== normaliseHtu(o.url)) return fail("htu");
  if (o.accessToken !== undefined) {
    if (typeof ath !== "string" || ath !== accessTokenHash(o.accessToken)) return fail("ath");
  } else if (ath !== undefined) return fail("ath");

  const now = (o.now ?? new Date()).getTime();
  const issued = iat * 1000;
  if (issued > now + skewS * 1000) return fail("future");
  if (issued < now - maxAgeS * 1000) return fail("stale");
  const thumbprint = jwkThumbprint({ kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y });
  if (o.jkt !== undefined && o.jkt !== thumbprint) return fail("jkt");
  if (
    !(await o.replay.claim(
      `dpop:${thumbprint}:${jti}`,
      new Date(issued + (maxAgeS + skewS) * 1000),
    ))
  )
    return fail("replay");
  return {
    ok: true,
    jkt: thumbprint,
    jti,
    iat: new Date(issued),
    jwk: { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y },
  };
}
