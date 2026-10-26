// JWT/JWS verification for IDENTITY (C-11, PL2-C-02): node:crypto only, compact serialisation.
// Rules: per-issuer algorithm allow-list (ES256, PS256); `none`, HS* and every other alg refused;
// `kid` required and resolved only from the configured JWKS; `crit`, `jku`, `x5u`, `x5c`, `x5t`,
// `jwk` and `b64` headers refused; strict base64url with exactly three segments; ES256 as IEEE P1363
// (64 bytes); PS256 with MGF1-SHA-256 and a 32-byte salt; RSA keys ≥ 2048 bits; `alg` must match
// the JWK; `iss`, `aud`, `exp`, `nbf`, `iat` checked with ±60 s skew. Failures are IPB-IDN-001.
import { constants, createPublicKey, verify as nodeVerify, type KeyObject } from "node:crypto";
import { IpbError } from "@infrabyx/contracts/errors";

export type JwsAlgorithm = "ES256" | "PS256";
export const JWS_ALGORITHMS: readonly JwsAlgorithm[] = Object.freeze(["ES256", "PS256"]);

/** Public JWK members this verifier reads. Private members are refused. */
export interface PublicJwk {
  kty: string;
  kid?: string;
  alg?: string;
  use?: string;
  key_ops?: string[];
  crv?: string;
  x?: string;
  y?: string;
  n?: string;
  e?: string;
  [member: string]: unknown;
}

export type JwtFailure =
  | "malformed"
  | "alg_not_allowed"
  | "header_refused"
  | "kid_missing"
  | "key_unknown"
  | "key_unsuitable"
  | "signature"
  | "iss"
  | "aud"
  | "exp"
  | "nbf"
  | "iat";

const fail = (reason: JwtFailure, detail: string): never => {
  throw new IpbError("IPB-IDN-001", { detail, meta: { reason } });
};

const REFUSED_HEADERS = ["crit", "jku", "x5u", "x5c", "x5t", "x5t#S256", "jwk", "b64"] as const;
const PRIVATE_MEMBERS = ["d", "p", "q", "dp", "dq", "qi", "oth", "k"] as const;
const SEGMENT = /^[A-Za-z0-9_-]+$/;

/** Strict base64url: alphabet only, no padding, canonical trailing bits. */
export function strictBase64Url(s: string): Uint8Array {
  if (!SEGMENT.test(s) || s.length % 4 === 1) fail("malformed", "segment is not strict base64url");
  const b = Buffer.from(s, "base64url");
  if (b.toString("base64url") !== s) fail("malformed", "segment is not canonical base64url");
  return new Uint8Array(b);
}

function jsonObject(bytes: Uint8Array, what: string): Record<string, unknown> {
  let v: unknown;
  try {
    v = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    fail("malformed", `${what} is not UTF-8 JSON`);
  }
  if (typeof v !== "object" || v === null || Array.isArray(v))
    fail("malformed", `${what} is not a JSON object`);
  return v as Record<string, unknown>;
}

/** Turn a JWK into a verification key for `alg`, refusing anything that does not fit it. */
export function jwkToVerifyKey(jwk: PublicJwk, alg: JwsAlgorithm): KeyObject {
  for (const m of PRIVATE_MEMBERS)
    if (m in jwk) fail("key_unsuitable", "JWK carries private key material");
  if (jwk.alg !== undefined && jwk.alg !== alg)
    fail("key_unsuitable", `JWK alg ${String(jwk.alg)} does not match ${alg}`);
  if (jwk.use !== undefined && jwk.use !== "sig") fail("key_unsuitable", "JWK use is not sig");
  if (jwk.key_ops !== undefined && !(Array.isArray(jwk.key_ops) && jwk.key_ops.includes("verify")))
    fail("key_unsuitable", "JWK key_ops does not allow verify");
  let key: KeyObject;
  try {
    if (alg === "ES256") {
      if (jwk.kty !== "EC" || jwk.crv !== "P-256" || !jwk.x || !jwk.y)
        fail("key_unsuitable", "ES256 needs an EC P-256 JWK");
      key = createPublicKey({
        key: { kty: "EC", crv: "P-256", x: jwk.x as string, y: jwk.y as string },
        format: "jwk",
      });
    } else {
      if (jwk.kty !== "RSA" || !jwk.n || !jwk.e) fail("key_unsuitable", "PS256 needs an RSA JWK");
      key = createPublicKey({
        key: { kty: "RSA", n: jwk.n as string, e: jwk.e as string },
        format: "jwk",
      });
      if ((key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048)
        fail("key_unsuitable", "RSA keys must be at least 2048 bits");
    }
  } catch (e) {
    if (e instanceof IpbError) throw e;
    fail("key_unsuitable", "JWK cannot be imported");
  }
  return key!;
}

export interface JwsVerifyOptions {
  /** The issuer's allow-list (C-12), never the union of all issuers. */
  algorithms: readonly JwsAlgorithm[];
  /** Key for a `kid`, from the configured JWKS only. */
  resolveKey(kid: string, alg: JwsAlgorithm): Promise<PublicJwk | undefined>;
}

export interface VerifiedJws {
  header: Record<string, unknown> & { alg: JwsAlgorithm; kid: string };
  payload: Uint8Array;
}

/** Verify a compact JWS signature and return its header and payload bytes. */
export async function verifyJws(compact: string, opts: JwsVerifyOptions): Promise<VerifiedJws> {
  if (typeof compact !== "string") fail("malformed", "token is not a string");
  const parts = compact.split(".");
  if (parts.length !== 3) fail("malformed", "token must have exactly three segments");
  const [h, p, s] = parts as [string, string, string];
  const header = jsonObject(strictBase64Url(h), "header");
  const payload = strictBase64Url(p);
  const signature = strictBase64Url(s);
  const alg = header.alg;
  if (
    typeof alg !== "string" ||
    !(JWS_ALGORITHMS as readonly string[]).includes(alg) ||
    !opts.algorithms.includes(alg as JwsAlgorithm)
  )
    fail("alg_not_allowed", `alg ${String(alg)} is not allowed for this issuer`);
  for (const r of REFUSED_HEADERS)
    if (r in header) fail("header_refused", `header ${r} is refused`);
  const kid = header.kid;
  if (typeof kid !== "string" || kid.length === 0) fail("kid_missing", "kid is required");
  const jwk = await opts.resolveKey(kid as string, alg as JwsAlgorithm);
  if (!jwk) fail("key_unknown", "no key for this kid in the configured JWKS");
  const key = jwkToVerifyKey(jwk!, alg as JwsAlgorithm);
  const input = Buffer.from(`${h}.${p}`, "ascii");
  const ok =
    alg === "ES256"
      ? signature.byteLength === 64 &&
        nodeVerify("sha256", input, { key, dsaEncoding: "ieee-p1363" }, signature)
      : nodeVerify(
          "sha256",
          input,
          { key, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 },
          signature,
        );
  if (!ok) fail("signature", "signature does not verify");
  return { header: header as VerifiedJws["header"], payload };
}

export interface JwtPolicy extends JwsVerifyOptions {
  issuer: string;
  /** Accepted audiences; the token's `aud` must contain at least one. */
  audience: string | readonly string[];
  clockSkewSeconds?: number;
}

export interface VerifiedJwt {
  header: VerifiedJws["header"];
  claims: Record<string, unknown> & { iss: string; exp: number };
}

const isNumericDate = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Verify signature and registered claims. `now` is milliseconds since the epoch. */
export async function verifyJwt(
  compact: string,
  policy: JwtPolicy,
  now: number = Date.now(),
): Promise<VerifiedJwt> {
  const { header, payload } = await verifyJws(compact, policy);
  const claims = jsonObject(payload, "payload");
  const skew = policy.clockSkewSeconds ?? 60;
  const t = now / 1000;
  if (claims.iss !== policy.issuer) fail("iss", "issuer mismatch");
  const want = typeof policy.audience === "string" ? [policy.audience] : policy.audience;
  const aud = claims.aud;
  const got =
    typeof aud === "string"
      ? [aud]
      : Array.isArray(aud) && aud.every((a) => typeof a === "string")
        ? aud
        : null;
  if (!got || !got.some((a) => want.includes(a))) fail("aud", "audience mismatch");
  if (!isNumericDate(claims.exp)) fail("exp", "exp is required");
  if (t > (claims.exp as number) + skew) fail("exp", "token expired");
  if (claims.nbf !== undefined && (!isNumericDate(claims.nbf) || t < claims.nbf - skew))
    fail("nbf", "token not yet valid");
  if (claims.iat !== undefined && (!isNumericDate(claims.iat) || claims.iat > t + skew))
    fail("iat", "iat is in the future");
  return { header, claims: claims as VerifiedJwt["claims"] };
}

export interface JwksCacheOptions {
  /** Fetch the configured JWKS URL (through the egress client in connectors). */
  fetchJwks(): Promise<{ keys: unknown[] }>;
  ttlMs?: number;
  /** An unknown kid triggers at most one refetch per interval. */
  minRefetchMs?: number;
  now?: () => number;
}

/** JWKS cache: 24 h, refetched on an unknown kid at most once a minute (C-11). */
export class JwksCache {
  private keys = new Map<string, PublicJwk>();
  private fetchedAt = 0;
  private lastAttempt = 0;
  private inflight: Promise<void> | null = null;
  private readonly now: () => number;

  constructor(private readonly o: JwksCacheOptions) {
    this.now = o.now ?? Date.now;
  }

  private async refresh(): Promise<void> {
    this.inflight ??= (async () => {
      this.lastAttempt = this.now();
      try {
        const { keys } = await this.o.fetchJwks();
        const next = new Map<string, PublicJwk>();
        for (const k of Array.isArray(keys) ? keys : []) {
          const j = k as PublicJwk;
          if (typeof j?.kid !== "string" || typeof j.kty !== "string") continue;
          if (PRIVATE_MEMBERS.some((m) => m in j)) continue;
          next.set(j.kid, j);
        }
        this.keys = next;
        this.fetchedAt = this.now();
      } catch {
        // Keep the current keys until they expire; resolve() fails closed after the TTL.
      } finally {
        this.inflight = null;
      }
    })();
    return this.inflight;
  }

  async resolve(kid: string): Promise<PublicJwk | undefined> {
    const ttl = this.o.ttlMs ?? 24 * 3_600_000;
    const fresh = () => this.fetchedAt > 0 && this.now() - this.fetchedAt <= ttl;
    if (!fresh()) await this.refresh();
    let k = fresh() ? this.keys.get(kid) : undefined;
    if (!k && this.now() - this.lastAttempt >= (this.o.minRefetchMs ?? 60_000)) {
      await this.refresh();
      k = fresh() ? this.keys.get(kid) : undefined;
    }
    return k;
  }

  /** `resolveKey` for JwsVerifyOptions. */
  readonly resolveKey = (kid: string): Promise<PublicJwk | undefined> => this.resolve(kid);
}
