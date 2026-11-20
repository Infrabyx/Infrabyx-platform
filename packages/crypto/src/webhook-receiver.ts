// A generic Standard Webhooks v1 receiver (PR-UDF-064, R1-D-238; IPB-10-21, IPB-10-27; C-13 as
// widened by owner answer #150). It adds nothing cryptographic to `verifyStandardWebhook`: it bounds
// the body, reads the three headers, verifies with the endpoint's one or two secrets (two during a
// rotation), and then claims the delivery in a replay store, so a captured delivery sent again
// inside the window is refused. The claim is made only after the signature verified, so a forgery
// cannot burn a real delivery's claim. Refusals are fixed labels and never carry a value.
import type { ReplayStore } from "./regulated-jws.js";
import { STANDARD_WEBHOOK_TOLERANCE_SECONDS, verifyStandardWebhook } from "./webhook-sig.js";

/**
 * The fixed refusal labels, in the order they are checked (answer 401 to each): `body_too_large`,
 * over `maxBodyBytes`, decided before anything else; `headers_missing`, `webhook-id`,
 * `webhook-timestamp` or `webhook-signature` is absent; `headers_malformed`, one is repeated or not
 * the Standard Webhooks form; `timestamp_stale`, more than `toleranceSeconds` from now either way;
 * `signature_invalid`, no `v1` signature verifies with any of the secrets; `replayed`, the same
 * delivery was accepted before (see `replayKey`).
 */
export const STANDARD_WEBHOOK_REFUSALS = [
  "body_too_large",
  "headers_missing",
  "headers_malformed",
  "timestamp_stale",
  "signature_invalid",
  "replayed",
] as const;
export type StandardWebhookRefusal = (typeof STANDARD_WEBHOOK_REFUSALS)[number];

/** The default body limit (as the V-CIP webhooks', R1-D-199) and the highest one accepted. */
export const STANDARD_WEBHOOK_MAX_BODY_BYTES = 65_536;
export const STANDARD_WEBHOOK_BODY_LIMIT_BYTES = 1_048_576;

/** Request headers as Node's `IncomingHttpHeaders` or a Fetch `Headers` give them. */
export type WebhookHeaderBag =
  | { get(name: string): string | null }
  | Readonly<Record<string, string | readonly string[] | undefined>>;

export interface StandardWebhookReceiverOptions {
  /** The endpoint's name (`[a-z0-9][a-z0-9._-]{0,62}`): it namespaces its replay keys. */
  name: string;
  /**
   * The endpoint's `whsec_` secrets from SECRETS, read on every delivery: the current one, and the
   * previous one during a rotation (at most two; more is a configuration fault and throws).
   */
  secrets: () => Promise<readonly string[]> | readonly string[];
  /**
   * The replay store: durable and shared by every instance in production (`RedisReplayStore` of
   * `@infrabyx/connectors/identity`); `MemoryReplayStore` for tests and a single instance.
   */
  replay: ReplayStore;
  /**
   * What is claimed: `delivery` (default), the `webhook-id` with its signed `webhook-timestamp`, as
   * the V-CIP webhooks (R1-D-199), so a captured delivery is refused while the sender's retry (same
   * id, new timestamp and signature) verifies and the product's module inbox de-duplicates it by id
   * (IPB-10-27); `event`, the `webhook-id` alone, so a retry inside the window is refused too, for a
   * product with no inbox for these events.
   */
  replayKey?: "delivery" | "event";
  /** At most 300 (IPB-10-21's five minutes); default 300. */
  toleranceSeconds?: number;
  /** Default `STANDARD_WEBHOOK_MAX_BODY_BYTES`; at most `STANDARD_WEBHOOK_BODY_LIMIT_BYTES`. */
  maxBodyBytes?: number;
  now?: () => Date;
}

/** A verified delivery: its id (the inbox key), its signed timestamp and when it was received. */
export interface StandardWebhookDelivery {
  id: string;
  timestamp: Date;
  receivedAt: Date;
}

export type StandardWebhookResult =
  ({ ok: true } & StandardWebhookDelivery) | { ok: false; reason: StandardWebhookRefusal };

const NAME = /^[a-z0-9][a-z0-9._-]{0,62}$/;

function headerOf(h: WebhookHeaderBag, name: string): string | null | "repeated" {
  if (typeof (h as { get?: unknown }).get === "function") {
    const v = (h as { get(n: string): string | null }).get(name);
    // Fetch `Headers` joins repeated values with ", "; no Standard Webhooks id or timestamp holds one.
    return v === null ? null : name !== "webhook-signature" && v.includes(",") ? "repeated" : v;
  }
  let found: string | null | "repeated" = null;
  for (const [k, v] of Object.entries(
    h as Record<string, string | readonly string[] | undefined>,
  )) {
    if (k.toLowerCase() !== name || v === undefined) continue;
    if (found !== null || (typeof v !== "string" && v.length !== 1)) return "repeated";
    found = typeof v === "string" ? v : v[0]!;
  }
  return found;
}

/**
 * Receive Standard Webhooks v1 deliveries for one endpoint (PR-UDF-064). Pass the raw request
 * bytes, before any JSON parsing, and the request headers; act on the body only after `ok`.
 */
export class StandardWebhookReceiver {
  private readonly tolerance: number;
  private readonly maxBody: number;

  constructor(private readonly o: StandardWebhookReceiverOptions) {
    if (!NAME.test(o.name)) throw new RangeError("a receiver name is [a-z0-9][a-z0-9._-]{0,62}");
    this.tolerance = o.toleranceSeconds ?? STANDARD_WEBHOOK_TOLERANCE_SECONDS;
    if (
      !Number.isInteger(this.tolerance) ||
      this.tolerance < 1 ||
      this.tolerance > STANDARD_WEBHOOK_TOLERANCE_SECONDS
    )
      throw new RangeError("toleranceSeconds is an integer from 1 to 300");
    this.maxBody = o.maxBodyBytes ?? STANDARD_WEBHOOK_MAX_BODY_BYTES;
    if (
      !Number.isInteger(this.maxBody) ||
      this.maxBody < 1 ||
      this.maxBody > STANDARD_WEBHOOK_BODY_LIMIT_BYTES
    )
      throw new RangeError("maxBodyBytes is an integer from 1 to 1 MiB");
  }

  async receive(rawBody: Uint8Array, headers: WebhookHeaderBag): Promise<StandardWebhookResult> {
    const fail = (reason: StandardWebhookRefusal): StandardWebhookResult => ({ ok: false, reason });
    if (rawBody.byteLength > this.maxBody) return fail("body_too_large");
    const id = headerOf(headers, "webhook-id");
    const timestamp = headerOf(headers, "webhook-timestamp");
    const signature = headerOf(headers, "webhook-signature");
    if (id === null || timestamp === null || signature === null) return fail("headers_missing");
    if (id === "repeated" || timestamp === "repeated" || signature === "repeated")
      return fail("headers_malformed");
    const secrets = await this.o.secrets();
    if (secrets.length > 2)
      throw new RangeError("at most two Standard Webhooks secrets (rotation)");
    const now = this.o.now?.() ?? new Date();
    const failed = verifyStandardWebhook(
      secrets,
      rawBody,
      { id, timestamp, signature },
      { now: now.getTime(), toleranceSeconds: this.tolerance },
    );
    if (failed === "headers") return fail("headers_malformed");
    if (failed === "timestamp") return fail("timestamp_stale");
    if (failed === "signature") return fail("signature_invalid");
    const key =
      (this.o.replayKey ?? "delivery") === "delivery"
        ? `standard-webhook:${this.o.name}:${id}.${timestamp}`
        : `standard-webhook:${this.o.name}:${id}`;
    const until = new Date((Number(timestamp) + this.tolerance) * 1000 + 60_000);
    if (!(await this.o.replay.claim(key, until))) return fail("replayed");
    return { ok: true, id, timestamp: new Date(Number(timestamp) * 1000), receivedAt: now };
  }
}
