// Vendor webhook signature verification (C-13) and the secrets we generate for inbound webhooks
// (C-19). The algorithm is the vendor's; the choice here is how strictly we verify: raw request
// bytes, constant-time comparison of decoded MACs, timestamp windows where the vendor sends one.
import {
  X509Certificate,
  createHash,
  createHmac,
  timingSafeEqual,
  verify as nodeVerify,
} from "node:crypto";
import { toBase64Url, toBytes, type BytesLike } from "./encoding.js";
import { randomBytes } from "./random.js";

const mac = (secret: BytesLike, data: Uint8Array): Buffer =>
  createHmac("sha256", Buffer.from(toBytes(secret)))
    .update(data)
    .digest();

const equal = (a: Uint8Array, b: Uint8Array): boolean =>
  a.byteLength === b.byteLength && timingSafeEqual(a, b);

const decodeHex = (s: string): Buffer | null =>
  /^(?:[0-9a-f]{2})+$/i.test(s) ? Buffer.from(s, "hex") : null;
const decodeBase64 = (s: string): Buffer | null => {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(s) || s.length % 4 !== 0) return null;
  const b = Buffer.from(s, "base64");
  return b.toString("base64") === s ? b : null;
};

/** Razorpay `X-Razorpay-Signature`: hex HMAC-SHA256 of the raw body. */
export function verifyRazorpaySignature(
  secret: BytesLike,
  rawBody: Uint8Array,
  signatureHex: string,
): boolean {
  const got = decodeHex(signatureHex);
  return got !== null && equal(got, mac(secret, rawBody));
}

/**
 * Cashfree `x-webhook-signature`: base64 HMAC-SHA256 of timestamp ‖ raw body, with
 * `x-webhook-timestamp` inside ±`windowSeconds` (seconds or milliseconds since the epoch).
 */
export function verifyCashfreeSignature(
  secret: BytesLike,
  rawBody: Uint8Array,
  timestamp: string,
  signatureB64: string,
  opts: { now?: number; windowSeconds?: number } = {},
): boolean {
  if (!/^\d{10,13}$/.test(timestamp)) return false;
  const ts = Number(timestamp);
  const tsMs = timestamp.length === 13 ? ts : ts * 1000;
  if (Math.abs((opts.now ?? Date.now()) - tsMs) > (opts.windowSeconds ?? 300) * 1000) return false;
  const got = decodeBase64(signatureB64);
  return (
    got !== null &&
    equal(got, mac(secret, Buffer.concat([Buffer.from(timestamp, "ascii"), rawBody])))
  );
}

/** Meta `X-Hub-Signature-256: sha256=<hex>` over the raw body with the app secret. */
export function verifyMetaSignature(
  appSecret: BytesLike,
  rawBody: Uint8Array,
  header: string,
): boolean {
  const m = /^sha256=([0-9a-f]{64})$/i.exec(header);
  const got = m?.[1] ? decodeHex(m[1]) : null;
  return got !== null && equal(got, mac(appSecret, rawBody));
}

/**
 * C-19 in use: a vendor that cannot sign its webhooks presents our generated secret (bearer header
 * or URL credentials). Both values are hashed first, so the comparison is constant-time and does
 * not leak the secret's length.
 */
export function verifyWebhookSecret(expected: BytesLike, presented: string): boolean {
  const e = toBytes(expected);
  if (e.byteLength < 16) return false;
  const digest = (b: Uint8Array) => createHash("sha256").update(b).digest();
  return equal(digest(e), digest(Buffer.from(presented, "utf8")));
}

/** C-19: a 32-byte inbound-webhook secret, base64url, to be stored in SECRETS. */
export function generateWebhookSecret(): string {
  return toBase64Url(randomBytes(32));
}

// ---- Amazon SNS (SES event topics) -------------------------------------------------------------

export interface SnsMessage {
  Type: "Notification" | "SubscriptionConfirmation" | "UnsubscribeConfirmation" | string;
  MessageId: string;
  TopicArn: string;
  Message: string;
  Timestamp: string;
  SignatureVersion: string;
  Signature: string;
  SigningCertURL: string;
  Subject?: string;
  Token?: string;
  SubscribeURL?: string;
}

export interface SnsVerifyOptions {
  /** The one topic this endpoint accepts. */
  topicArn: string;
  /** Regions whose signing certificates are accepted (ap-south-1, plus ap-south-2 for DR). */
  regions: readonly string[];
  /** PEM certificate for an already-validated SigningCertURL (fetched through egress and cached). */
  fetchCertificate(url: string): Promise<string>;
  now?: number;
}

export type SnsFailure =
  "signature_version" | "cert_url" | "topic" | "fields" | "certificate" | "signature";

/** True when the URL is an SNS signing certificate in one of the allowed regions. */
export function snsCertUrlAllowed(url: string, regions: readonly string[]): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  return (
    u.protocol === "https:" &&
    u.port === "" &&
    u.username === "" &&
    u.password === "" &&
    u.search === "" &&
    u.hash === "" &&
    regions.some((r) => u.hostname === `sns.${r}.amazonaws.com`) &&
    /^\/SimpleNotificationService-[0-9a-f]+\.pem$/.test(u.pathname)
  );
}

function snsStringToSign(m: SnsMessage): string | null {
  const fields =
    m.Type === "Notification"
      ? [
          "Message",
          "MessageId",
          ...(m.Subject !== undefined ? ["Subject"] : []),
          "Timestamp",
          "TopicArn",
          "Type",
        ]
      : m.Type === "SubscriptionConfirmation" || m.Type === "UnsubscribeConfirmation"
        ? ["Message", "MessageId", "SubscribeURL", "Timestamp", "Token", "TopicArn", "Type"]
        : null;
  if (!fields) return null;
  let out = "";
  for (const f of fields) {
    const v = (m as unknown as Record<string, unknown>)[f];
    if (typeof v !== "string") return null;
    out += `${f}\n${v}\n`;
  }
  return out;
}

/**
 * Verify an SNS message: SignatureVersion 2 (RSA-SHA256) only, v1 (SHA-1) refused; the signing
 * certificate URL pinned to the allowed regions; the TopicArn equal to the configured topic; the
 * certificate valid now. Returns null when valid, else the failure.
 */
export async function verifySnsMessage(
  m: SnsMessage,
  opts: SnsVerifyOptions,
): Promise<SnsFailure | null> {
  if (m.SignatureVersion !== "2") return "signature_version";
  if (!snsCertUrlAllowed(m.SigningCertURL, opts.regions)) return "cert_url";
  if (m.TopicArn !== opts.topicArn) return "topic";
  const toSign = snsStringToSign(m);
  const sig = typeof m.Signature === "string" ? decodeBase64(m.Signature) : null;
  if (toSign === null || sig === null) return "fields";
  let cert: X509Certificate;
  try {
    cert = new X509Certificate(await opts.fetchCertificate(m.SigningCertURL));
  } catch {
    return "certificate";
  }
  const now = opts.now ?? Date.now();
  if (now < Date.parse(cert.validFrom) || now > Date.parse(cert.validTo)) return "certificate";
  const ok = nodeVerify("sha256", Buffer.from(toSign, "utf8"), cert.publicKey, sig);
  return ok ? null : "signature";
}

/**
 * C-25 (PL3-C-02): Leegality webhook `mac`, HMAC-SHA1 over the document id with the account's
 * private salt, compared in constant time. Verification only, for Leegality and nothing else; a
 * verified webhook is still only a trigger, and the adapter reads the status back before any
 * state change. `timestamp` (seconds, milliseconds or ISO 8601), when Leegality sends one, must
 * fall inside ±`windowSeconds`.
 */
export function verifyLeegalityMac(
  salt: BytesLike,
  documentId: string,
  macHex: string,
  opts: { timestamp?: string | number; now?: number; windowSeconds?: number } = {},
): boolean {
  if (!documentId || documentId.length > 200) return false;
  if (opts.timestamp !== undefined) {
    const t = opts.timestamp;
    const ms =
      typeof t === "number"
        ? t < 1e12
          ? t * 1000
          : t
        : /^\d{10}$/.test(t)
          ? Number(t) * 1000
          : /^\d{13}$/.test(t)
            ? Number(t)
            : Date.parse(t);
    if (!Number.isFinite(ms)) return false;
    if (Math.abs((opts.now ?? Date.now()) - ms) > (opts.windowSeconds ?? 300) * 1000) return false;
  }
  const got = decodeHex(macHex);
  const want = createHmac("sha1", Buffer.from(toBytes(salt)))
    .update(Buffer.from(documentId, "utf8"))
    .digest();
  return got !== null && equal(got, want);
}
