// C-26 (OWNER-QUESTIONS #89, R1-D-33): HS256 for LiveKit only. LiveKit authenticates its server
// API and its clients with HS256 JWTs under the deployment's API key and secret, and signs its
// webhooks the same way. This file is the only HS256 path of the platform (a test fails on any
// other), used only by the LiveKit VIDEO_MEET adapter. Limits, all enforced here:
//   * the API secret encodes at least 32 random bytes (hex or base64url, e.g. `generateWebhookSecret`),
//     comes from SECRETS, one per deployment and environment, and is never logged;
//   * a join token lives at most 300 s and names one room and one identity, with only the join grants
//     (publish, subscribe, data); never an admin, create, list or record grant;
//   * a server-API token lives at most 60 s, carries exactly one server grant, and names the room
//     for room-scoped grants;
//   * a webhook token is HS256 only, issued by the API key, unexpired (60 s skew), and its `sha256`
//     claim equals the body's SHA-256; signature and hash compared in constant time.
// C-11 (ES256, PS256) and C-22 stay the rule for every other token.
import { createHmac, timingSafeEqual } from "node:crypto";
import { fromBase64Url, fromHex, toBase64Url } from "./encoding.js";
import { sha256 } from "./hash.js";
import { matchesDevKey } from "./local-kms.js";

export const LIVEKIT_JOIN_TOKEN_MAX_SECONDS = 300;
export const LIVEKIT_SERVER_TOKEN_MAX_SECONDS = 60;
export const LIVEKIT_WEBHOOK_SKEW_SECONDS = 60;
const ALG = "HS256";
const NAME = /^[A-Za-z0-9_.:@-]{1,128}$/;
const API_KEY = /^[A-Za-z0-9_-]{3,64}$/;

const SECRETS = new WeakMap<LiveKitCredentials, Uint8Array>();

/** HMAC-SHA-256 under the credentials' secret; module-private, so only this file can sign. */
function mac(c: LiveKitCredentials, input: string): Uint8Array {
  const k = SECRETS.get(c);
  if (!k) throw new Error("C-26: unknown LiveKit credentials");
  return new Uint8Array(createHmac("sha256", k).update(input).digest());
}

/** A LiveKit API key and secret, checked once (C-26). The secret is never exposed again. */
export class LiveKitCredentials {
  readonly apiKey: string;

  constructor(apiKey: string, secret: string) {
    if (!API_KEY.test(apiKey)) throw new Error("C-26: invalid LiveKit API key");
    const s = secret.trim();
    let decoded: Uint8Array | undefined;
    if (/^[0-9a-f]+$/i.test(s) && s.length % 2 === 0) decoded = fromHex(s);
    else if (/^[A-Za-z0-9_-]+$/.test(s)) decoded = fromBase64Url(s);
    if (!decoded || decoded.byteLength < 32)
      throw new Error("C-26: the LiveKit secret must encode at least 32 random bytes");
    if (matchesDevKey(s)) throw new Error("C-26: the LiveKit secret is a public dev key");
    this.apiKey = apiKey;
    // LiveKit keys the HMAC with the secret string's bytes, so the string is the key.
    SECRETS.set(this, new TextEncoder().encode(s));
    Object.freeze(this);
  }

  toJSON(): string {
    return `[LiveKitCredentials ${this.apiKey}]`;
  }

  toString(): string {
    return this.toJSON();
  }

  [Symbol.for("nodejs.util.inspect.custom")](): string {
    return this.toJSON();
  }
}

const enc = (o: unknown) => toBase64Url(new TextEncoder().encode(JSON.stringify(o)));

function sign(c: LiveKitCredentials, claims: Record<string, unknown>): string {
  const input = `${enc({ alg: ALG, typ: "JWT" })}.${enc(claims)}`;
  return `${input}.${toBase64Url(mac(c, input))}`;
}

const nowSeconds = (now?: number) => Math.floor((now ?? Date.now()) / 1000);

export interface LiveKitJoinGrants {
  canPublish: boolean;
  canSubscribe: boolean;
  canPublishData: boolean;
}

/** A client join token: one room, one identity, join grants only, at most 300 s. */
export function signLiveKitJoinToken(
  c: LiveKitCredentials,
  i: {
    room: string;
    identity: string;
    grants: LiveKitJoinGrants;
    ttlSeconds?: number;
    /** Milliseconds since the epoch (tests). */
    now?: number;
  },
): { token: string; expiresAt: number } {
  if (!NAME.test(i.room) || !NAME.test(i.identity))
    throw new Error("C-26: one room and one identity, by name");
  const ttl = i.ttlSeconds ?? LIVEKIT_JOIN_TOKEN_MAX_SECONDS;
  if (!(Number.isInteger(ttl) && ttl >= 1 && ttl <= LIVEKIT_JOIN_TOKEN_MAX_SECONDS))
    throw new Error(`C-26: a join token lives 1 to ${LIVEKIT_JOIN_TOKEN_MAX_SECONDS} s`);
  const keys = Object.keys(i.grants).sort().join(",");
  if (keys !== "canPublish,canPublishData,canSubscribe")
    throw new Error("C-26: a join token carries only the publish, subscribe and data grants");
  const iat = nowSeconds(i.now);
  const exp = iat + ttl;
  const token = sign(c, {
    iss: c.apiKey,
    sub: i.identity,
    nbf: iat,
    exp,
    video: {
      room: i.room,
      roomJoin: true,
      canPublish: i.grants.canPublish === true,
      canSubscribe: i.grants.canSubscribe === true,
      canPublishData: i.grants.canPublishData === true,
    },
  });
  return { token, expiresAt: exp * 1000 };
}

/** One server-API grant: create and list are global; admin and record name their room. */
export type LiveKitServerGrant =
  | { roomCreate: true }
  | { roomList: true }
  | { roomAdmin: true; room: string }
  | { roomRecord: true; room: string };

export const LIVEKIT_SERVER_IDENTITY = "ipb-livekit-adapter";

/** A server-API token for one call: exactly one grant, at most 60 s. */
export function signLiveKitServerToken(
  c: LiveKitCredentials,
  grant: LiveKitServerGrant,
  opts: { ttlSeconds?: number; now?: number } = {},
): string {
  const g = grant as Record<string, unknown>;
  const flags = ["roomCreate", "roomList", "roomAdmin", "roomRecord"].filter((k) => g[k] === true);
  const extra = Object.keys(g).filter((k) => !flags.includes(k) && k !== "room");
  if (flags.length !== 1 || extra.length)
    throw new Error("C-26: a server token carries exactly one server grant");
  const scoped = flags[0] === "roomAdmin" || flags[0] === "roomRecord";
  if (scoped !== (typeof g.room === "string" && NAME.test(g.room as string)))
    throw new Error("C-26: admin and record grants name their room; create and list name none");
  const ttl = opts.ttlSeconds ?? LIVEKIT_SERVER_TOKEN_MAX_SECONDS;
  if (!(Number.isInteger(ttl) && ttl >= 1 && ttl <= LIVEKIT_SERVER_TOKEN_MAX_SECONDS))
    throw new Error(`C-26: a server token lives 1 to ${LIVEKIT_SERVER_TOKEN_MAX_SECONDS} s`);
  const iat = nowSeconds(opts.now);
  return sign(c, {
    iss: c.apiKey,
    sub: LIVEKIT_SERVER_IDENTITY,
    nbf: iat,
    exp: iat + ttl,
    video: { ...grant },
  });
}

export type LiveKitWebhookFailure =
  "malformed" | "algorithm" | "signature" | "issuer" | "expired" | "not_yet_valid" | "body_hash";

/**
 * Verify a LiveKit webhook (the `Authorization` header) over the raw body. Returns the failure
 * reason, or null when the token is valid for this body.
 */
export function verifyLiveKitWebhook(
  c: LiveKitCredentials,
  authorization: string | undefined,
  rawBody: Uint8Array,
  opts: { now?: number; skewSeconds?: number } = {},
): LiveKitWebhookFailure | null {
  const token = (authorization ?? "").replace(/^Bearer\s+/i, "").trim();
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((p) => !/^[A-Za-z0-9_-]+$/.test(p))) return "malformed";
  const [h, p, s] = parts as [string, string, string];
  let header: Record<string, unknown>;
  let claims: Record<string, unknown>;
  try {
    header = JSON.parse(new TextDecoder().decode(fromBase64Url(h))) as Record<string, unknown>;
    claims = JSON.parse(new TextDecoder().decode(fromBase64Url(p))) as Record<string, unknown>;
  } catch {
    return "malformed";
  }
  if (header.alg !== ALG || Object.keys(header).some((k) => k !== "alg" && k !== "typ"))
    return "algorithm";
  const expected = mac(c, `${h}.${p}`);
  const given = fromBase64Url(s);
  if (given.byteLength !== expected.byteLength || !timingSafeEqual(given, expected))
    return "signature";
  if (claims.iss !== c.apiKey) return "issuer";
  const now = nowSeconds(opts.now);
  const skew = opts.skewSeconds ?? LIVEKIT_WEBHOOK_SKEW_SECONDS;
  if (typeof claims.exp !== "number" || claims.exp + skew < now) return "expired";
  if (typeof claims.nbf === "number" && claims.nbf - skew > now) return "not_yet_valid";
  const claimed = typeof claims.sha256 === "string" ? claims.sha256 : "";
  const body = new TextEncoder().encode(Buffer.from(sha256(rawBody)).toString("base64"));
  const got = new TextEncoder().encode(claimed);
  if (got.byteLength !== body.byteLength || !timingSafeEqual(got, body)) return "body_hash";
  return null;
}

/** Tests and the hermetic leg only: sign a webhook body as a LiveKit server would. */
export function signLiveKitWebhookForTest(
  c: LiveKitCredentials,
  rawBody: Uint8Array,
  opts: { now?: number; ttlSeconds?: number } = {},
): string {
  const iat = nowSeconds(opts.now);
  return sign(c, {
    iss: c.apiKey,
    nbf: iat,
    exp: iat + (opts.ttlSeconds ?? 300),
    sha256: Buffer.from(sha256(rawBody)).toString("base64"),
  });
}
