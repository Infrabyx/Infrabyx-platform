// Request proofs of an enrolled on-premises agent (the TallyPrime agent; Finbyx PR-FBX-46,
// R1-D-137, R1-D-178; threat model §3.121). The C-22 profile of regulated messages, applied to an
// HTTP request instead of a CloudEvent, so no new cryptography is introduced:
//   * a detached JWS (RFC 7515 Appendix F), ES256 only through an allow-list (`none`, `HS*`, `RS*`,
//     `PS*`, `ES384` and anything else refused), signature as IEEE P1363 r||s (64 bytes);
//   * the protected header holds exactly `alg`, `kid`, `typ`, `iat` and `jti`; `typ` is
//     `ipb-agent-request+jws`, never the regulated-message `typ`, so neither proof can pass as the
//     other;
//   * the signed payload is the JCS form (RFC 8785) of `{ v: 1, tenant, agent, seq, htm, path,
//     body_sha256 }`: the proof is bound to the tenant, the agent, the request method, its path and
//     its body digest, and to `seq`, a strictly increasing integer per agent;
//   * a short `iat` window (300 s back, 60 s ahead) and a single-use `jti`, claimed only after the
//     proof verified, so a forgery cannot burn a real proof's `jti`.
// The agent's key pair is generated on the agent (P-256, `generateAgentKeyPair`) and only its
// public JWK leaves it; the private key never reaches the platform.
import {
  createPublicKey,
  generateKeyPairSync,
  sign as nodeSign,
  verify as nodeVerify,
  type KeyObject,
} from "node:crypto";
import { jwkThumbprint } from "./dpop.js";
import { toBase64Url } from "./encoding.js";
import { sha256Hex } from "./hash.js";
import { canonicalize } from "./jcs.js";
import { strictBase64Url } from "./jwt.js";
import { randomBytes } from "./random.js";
import type { ReplayStore } from "./regulated-jws.js";

/** `typ` of an agent request proof (never the regulated-message `typ`). */
export const AGENT_REQUEST_JWS_TYP = "ipb-agent-request+jws";
export const AGENT_REQUEST_MAX_AGE_SECONDS = 300;
export const AGENT_REQUEST_MAX_SKEW_SECONDS = 60;

const HEADER_KEYS = ["alg", "kid", "typ", "iat", "jti"] as const;
const JTI = /^[A-Za-z0-9_-]{22,64}$/;
const KID = /^[\x21-\x7e]{1,256}$/;
const HTM = /^[A-Z]{3,10}$/;
const PATH = /^\/[\x21-\x7e]{0,511}$/;

/** What a proof is bound to. `body` is the exact bytes sent (empty for a GET). */
export interface AgentRequest {
  tenant: string;
  agent: string;
  method: string;
  /** The request path without scheme, host or query. */
  path: string;
  body: Uint8Array;
}

/** The public half of an agent key, as the platform stores it. */
export interface AgentJwk {
  kty: "EC";
  crv: "P-256";
  x: string;
  y: string;
}

export interface AgentKeyPair {
  privateKey: KeyObject;
  publicJwk: AgentJwk;
  /** RFC 7638 thumbprint of the public key. */
  thumbprint: string;
}

/** A fresh P-256 key pair for an agent (C-12's curve; generated on the agent itself). */
export function generateAgentKeyPair(): AgentKeyPair {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const publicJwk = agentPublicJwk(publicKey);
  return { privateKey, publicJwk, thumbprint: jwkThumbprint(publicJwk) };
}

/** The four public members of a P-256 key (a private key's public half). */
export function agentPublicJwk(key: KeyObject): AgentJwk {
  const pub = key.type === "private" ? createPublicKey(key) : key;
  const d = pub.asymmetricKeyDetails;
  if (pub.asymmetricKeyType !== "ec" || d?.namedCurve !== "prime256v1")
    throw new Error("agent keys are EC P-256 (ES256)");
  const j = pub.export({ format: "jwk" });
  return { kty: "EC", crv: "P-256", x: String(j.x), y: String(j.y) };
}

/** The bytes a proof signs over, after the protected header. */
export function agentRequestPayload(r: AgentRequest, seq: number): Uint8Array {
  if (!HTM.test(r.method)) throw new Error("method must be an upper-case HTTP method");
  if (!PATH.test(r.path)) throw new Error("path must be an absolute path without spaces");
  if (!Number.isSafeInteger(seq) || seq < 1) throw new Error("seq must be a positive integer");
  return new TextEncoder().encode(
    canonicalize({
      v: 1,
      tenant: r.tenant,
      agent: r.agent,
      seq,
      htm: r.method,
      path: r.path,
      body_sha256: sha256Hex(r.body),
    }),
  );
}

/** Signs one request with its `seq`; returns the compact detached JWS. */
export function signAgentRequest(o: {
  privateKey: KeyObject;
  kid: string;
  request: AgentRequest;
  seq: number;
  now?: Date;
  /** Only for tests; otherwise 128 random bits. */
  jti?: string;
}): string {
  if (!KID.test(o.kid)) throw new Error("kid is required");
  const header = {
    alg: "ES256",
    kid: o.kid,
    typ: AGENT_REQUEST_JWS_TYP,
    iat: Math.floor((o.now ?? new Date()).getTime() / 1000),
    jti: o.jti ?? toBase64Url(randomBytes(16)),
  };
  if (!JTI.test(header.jti)) throw new Error("jti must be 22 to 64 base64url characters");
  const h = toBase64Url(new TextEncoder().encode(canonicalize(header)));
  const input = Buffer.from(`${h}.${toBase64Url(agentRequestPayload(o.request, o.seq))}`, "ascii");
  const sig = nodeSign("sha256", input, { key: o.privateKey, dsaEncoding: "ieee-p1363" });
  return `${h}..${toBase64Url(sig)}`;
}

export type AgentRequestFailure =
  "format" | "header" | "alg" | "typ" | "kid" | "signature" | "stale" | "future" | "replay";

export type AgentRequestResult =
  { ok: true; kid: string; jti: string; iat: Date } | { ok: false; reason: AgentRequestFailure };

/** Reads the `kid` of a proof without verifying it (to find the agent's key); null if malformed. */
export function agentRequestKid(compact: string): string | null {
  const header = decodeHeader(compact);
  return header && typeof header.kid === "string" && KID.test(header.kid) ? header.kid : null;
}

function decodeHeader(compact: string): Record<string, unknown> | null {
  const parts = compact.split(".");
  if (parts.length !== 3 || parts[1] !== "" || !parts[0] || !parts[2]) return null;
  try {
    const parsed: unknown = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(strictBase64Url(parts[0])),
    );
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Verifies a proof against the agent's stored public key: header allow-list, ES256, `kid` equal to
 * `expectedKid`, the signature over this request and `seq`, the `iat` window, then the `jti`
 * claim. The caller enforces `seq` (strictly above the agent's last accepted one) in the same
 * statement that stores it.
 */
export async function verifyAgentRequest(
  compact: string,
  request: AgentRequest,
  o: {
    key: AgentJwk;
    expectedKid: string;
    /** The `seq` the request names (the `IPB-Agent-Seq` header); signed in the payload. */
    seq: number;
    replay: ReplayStore;
    now?: Date;
  },
): Promise<AgentRequestResult> {
  const fail = (reason: AgentRequestFailure): AgentRequestResult => ({ ok: false, reason });
  const header = decodeHeader(compact);
  if (!header) return fail("format");
  if (header.alg !== "ES256") return fail("alg");
  const keys = Object.keys(header);
  if (
    keys.length !== HEADER_KEYS.length ||
    keys.some((k) => !(HEADER_KEYS as readonly string[]).includes(k))
  )
    return fail("header");
  if (header.typ !== AGENT_REQUEST_JWS_TYP) return fail("typ");
  const { kid, iat, jti } = header;
  if (typeof kid !== "string" || kid !== o.expectedKid) return fail("kid");
  if (typeof jti !== "string" || !JTI.test(jti)) return fail("header");
  if (typeof iat !== "number" || !Number.isSafeInteger(iat) || iat < 0) return fail("header");
  let pub: KeyObject;
  try {
    pub = createPublicKey({
      key: { kty: "EC", crv: "P-256", x: o.key.x, y: o.key.y },
      format: "jwk",
    });
  } catch {
    return fail("kid");
  }
  const [h, , s] = compact.split(".") as [string, string, string];
  let sig: Uint8Array;
  try {
    sig = strictBase64Url(s);
  } catch {
    return fail("format");
  }
  if (sig.byteLength !== 64) return fail("signature");
  let payload: Uint8Array;
  try {
    payload = agentRequestPayload(request, o.seq);
  } catch {
    return fail("signature");
  }
  const input = Buffer.from(`${h}.${toBase64Url(payload)}`, "ascii");
  if (!nodeVerify("sha256", input, { key: pub, dsaEncoding: "ieee-p1363" }, sig))
    return fail("signature");
  const issued = new Date(iat * 1000);
  const now = (o.now ?? new Date()).getTime();
  if (issued.getTime() > now + AGENT_REQUEST_MAX_SKEW_SECONDS * 1000) return fail("future");
  if (issued.getTime() < now - AGENT_REQUEST_MAX_AGE_SECONDS * 1000) return fail("stale");
  const expires = new Date(
    issued.getTime() + (AGENT_REQUEST_MAX_AGE_SECONDS + AGENT_REQUEST_MAX_SKEW_SECONDS) * 1000,
  );
  if (!(await o.replay.claim(`${kid}:${jti}`, expires))) return fail("replay");
  return { ok: true, kid, jti, iat: issued };
}
