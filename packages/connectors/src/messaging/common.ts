// Shared pieces of the EMAIL, SMS and WHATSAPP adapters (PL2 plan §6.10–6.12, §3.8, §3.12).
// - Bodies are INTERNAL: a call raised above the adapter's class is refused before any request
//   (CONFIDENTIAL content goes as a secure link, never inline).
// - Inbound webhooks: a vendor signature where the vendor signs (C-13); otherwise our generated
//   secret (C-19) as a bearer header or URL credentials plus the vendor's source-IP ranges.
//   Failures throw IPB-API-018 and never carry the body.
// - Recipients never appear in errors or logs; the router hashes them for telemetry (C-21).
import { atLeast, type DataClass } from "@infrabyx/contracts/data-class";
import { PortError } from "@infrabyx/contracts/errors";
import type { AdapterDescriptor, PortCall, StoragePort } from "@infrabyx/contracts/ports";
import { verifyWebhookSecret } from "@infrabyx/crypto";

/** Refuse a call whose stated class is above what the adapter takes for bodies. */
export function assertBodyClass(d: AdapterDescriptor, call?: PortCall): void {
  const cls: DataClass = call?.dataClass ?? "INTERNAL";
  if (!atLeast(d.maxDataClass, cls))
    throw new PortError("IPB-PORT-003", d.port, {
      adapter: d.adapter,
      detail: `${cls} content is not sent inline; send a secure link instead`,
    });
}

/** Attachments: at most 10 files and 10 MiB together (PL2-D-64), INTERNAL storage classes only. */
export const EMAIL_ATTACHMENTS_MAX = 10;
export const EMAIL_ATTACHMENTS_MAX_BYTES = 10 * 1024 * 1024;

export interface LoadedAttachment {
  filename: string;
  contentType: string;
  body: Uint8Array;
}

export async function loadAttachments(
  d: AdapterDescriptor,
  keys: readonly string[] | undefined,
  storage: StoragePort | undefined,
): Promise<LoadedAttachment[]> {
  if (!keys?.length) return [];
  const refuse = (detail: string) =>
    new PortError("IPB-PORT-003", d.port, { adapter: d.adapter, detail });
  if (!storage) throw refuse("attachments need a STORAGE port");
  if (keys.length > EMAIL_ATTACHMENTS_MAX) throw refuse("more than 10 attachments");
  const out: LoadedAttachment[] = [];
  let total = 0;
  for (const key of keys) {
    const o = await storage.get(key);
    if (o.meta.bucketClass !== "GENERAL" && o.meta.bucketClass !== "PUBLIC_ASSETS")
      throw refuse(`a ${o.meta.bucketClass} document is sent as a secure link, not attached`);
    total += o.body.byteLength;
    if (total > EMAIL_ATTACHMENTS_MAX_BYTES) throw refuse("attachments exceed 10 MiB");
    out.push({
      filename: key.slice(key.lastIndexOf("/") + 1),
      contentType: o.meta.contentType ?? "application/octet-stream",
      body: o.body,
    });
  }
  return out;
}

export function webhookRefused(port: string, adapter: string, reason: string): PortError {
  return new PortError("IPB-API-018", port, { adapter, detail: `webhook refused: ${reason}` });
}

/** Case-insensitive header lookup. */
export function header(h: Readonly<Record<string, string>>, name: string): string | undefined {
  const n = name.toLowerCase();
  for (const [k, v] of Object.entries(h)) if (k.toLowerCase() === n) return v;
  return undefined;
}

/** True when `ts` (ms since the epoch) is inside ±`windowMs` of now. */
export function withinWindow(tsMs: number, windowMs: number, now = Date.now()): boolean {
  return Number.isFinite(tsMs) && Math.abs(now - tsMs) <= windowMs;
}

const ipv4 = (s: string): number | null => {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (!m) return null;
  const p = m.slice(1).map(Number);
  return p.some((x) => x > 255)
    ? null
    : ((p[0]! << 24) | (p[1]! << 16) | (p[2]! << 8) | p[3]!) >>> 0;
};

/** IPv4 CIDR match (`a.b.c.d/n` or a single address); IPv6 sources are refused. */
export function ipAllowed(ip: string | undefined, cidrs: readonly string[]): boolean {
  const addr = ip ? ipv4(ip.replace(/^::ffff:/, "")) : null;
  if (addr === null) return false;
  return cidrs.some((c) => {
    const [base, bits = "32"] = c.split("/");
    const b = base ? ipv4(base) : null;
    const n = Number(bits);
    if (b === null || !Number.isInteger(n) || n < 0 || n > 32) return false;
    const mask = n === 0 ? 0 : (~0 << (32 - n)) >>> 0;
    return (addr & mask) === (b & mask);
  });
}

export interface SharedSecretAuth {
  /** Our C-19 secret for this endpoint, read from SECRETS. */
  secret: () => Promise<string> | string;
  /** Vendor source ranges; when set, the caller's IP must be in one of them. */
  sourceCidrs?: readonly string[];
}

/** Query parameter for gateways that can only call a configured URL (no headers, no userinfo). */
export const WEBHOOK_TOKEN_PARAM = "ipb_token";
/** A URL token is at least 32 random bytes: 43 base64url characters (PL2-D-65, C-19). */
export const URL_TOKEN_MIN_CHARS = 43;

/**
 * Bearer token (`Authorization: Bearer …`), URL credentials (`Authorization: Basic …`, password),
 * or, for gateways that cannot send headers, the `ipb_token` query parameter of the configured
 * URL (ingress logs must redact it).
 */
export async function checkSharedSecret(
  port: string,
  adapter: string,
  auth: SharedSecretAuth,
  headers: Readonly<Record<string, string>>,
  sourceIp?: string,
  query?: string,
): Promise<void> {
  if (auth.sourceCidrs?.length && !ipAllowed(sourceIp, auth.sourceCidrs))
    throw webhookRefused(port, adapter, "source address not in the vendor's ranges");
  const a = header(headers, "authorization") ?? "";
  let presented = "";
  if (/^Bearer /i.test(a)) presented = a.slice(7).trim();
  else if (/^Basic /i.test(a)) {
    const decoded = Buffer.from(a.slice(6).trim(), "base64").toString("utf8");
    presented = decoded.slice(decoded.indexOf(":") + 1);
  } else if (query) presented = new URLSearchParams(query).get(WEBHOOK_TOKEN_PARAM) ?? "";
  const expected = await auth.secret();
  if (!/^(Bearer|Basic) /i.test(a) && expected.length < URL_TOKEN_MIN_CHARS)
    throw webhookRefused(port, adapter, "the URL token must be at least 32 random bytes");
  if (!presented || !verifyWebhookSecret(expected, presented))
    throw webhookRefused(port, adapter, "shared secret missing or wrong");
}

/**
 * Gupshup webhooks rest on a URL secret only, so a state-changing event is acted on only after its
 * status is confirmed at the vendor (owner condition, PL2-D-65). Gupshup documents no status lookup
 * yet [VERIFY in the sandbox]; until one is wired, the lookup is injected and, without it, events
 * are acknowledged but withheld.
 */
export type ConfirmStatus = (e: { messageId: string; status: string }) => Promise<boolean>;

export async function confirmed<E extends { messageId?: string; type?: string; status?: string }>(
  events: E[],
  confirm: ConfirmStatus | undefined,
  onWithheld?: (n: number) => void,
): Promise<E[]> {
  if (!confirm) {
    if (events.length) onWithheld?.(events.length);
    return [];
  }
  const out: E[] = [];
  for (const e of events)
    if (
      e.messageId &&
      (await confirm({ messageId: e.messageId, status: e.status ?? e.type ?? "" }))
    )
      out.push(e);
  if (out.length < events.length) onWithheld?.(events.length - out.length);
  return out;
}

/** Parse JSON, refusing anything that is not an object or array. */
export function parseJson(port: string, adapter: string, raw: Uint8Array): unknown {
  try {
    const v: unknown = JSON.parse(new TextDecoder().decode(raw));
    if (v && typeof v === "object") return v;
  } catch {
    // fall through
  }
  throw webhookRefused(port, adapter, "body is not JSON");
}

/**
 * Map a vendor error status (same convention as the other REST adapters): 429 and 5xx are
 * IPB-PORT-002 with an unknown outcome; any other 4xx means "not sent" and is definite, so the
 * idempotency key may be used again (credentials: IPB-PORT-001; rejected requests: IPB-PORT-001
 * with reason `vendor_rejected`).
 */
export function vendorError(
  port: string,
  adapter: string,
  status: number,
  detail: string,
): PortError {
  if (status === 429 || status >= 500)
    return new PortError("IPB-PORT-002", port, {
      adapter,
      detail: `${detail}: ${adapter} answered ${status}`,
      meta: { vendorStatus: status },
    });
  const credentials = status === 401 || status === 403;
  return new PortError("IPB-PORT-001", port, {
    adapter,
    detail: credentials
      ? `${adapter} refused the credentials`
      : `${detail}: ${adapter} rejected it`,
    meta: {
      vendorStatus: status,
      reason: credentials ? "credentials" : "vendor_rejected",
      definite: true,
    },
  });
}
