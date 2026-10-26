// IPB-02-23 telemetry scrubber: REGULATED values are masked with the PL1 mask rules, credentials are
// redacted and identifiers are hashed (C-21) before anything reaches an exporter. It runs on span
// attributes, metric attributes, log context and log messages alike.
import { MASK_RULES, mask } from "@infrabyx/tenancy";

export type ScrubValue = string | number | boolean;

/** Keys whose values are credentials; the value never leaves the process. */
const SECRET_KEY =
  /(pass(word)?|secret|token|api[_-]?key|authorization|cookie|signature|otp|pin)$/i;
/** Keys whose values are identifiers of a person or tenant; exported only as C-21 hashes. */
const ID_KEY =
  /^(tenant[_-]?id|tenantId|user[_-]?id|userId|actor[_-]?id|actorId|customer[_-]?id|customerId)$/;
/** Keys that carry message or vendor payloads; dropped entirely (IPB-01 §01.4.4.1). */
const PAYLOAD_KEY = /^(body|payload|headers|request|response|html|text|prompt|completion)$/i;

const PATTERNS: ReadonlyArray<[RegExp, (m: string) => string]> = [
  [/\b[\w.+-]+@[\w-]+(\.[\w-]+)+\b/g, (m) => mask("email", m)],
  [/\b[A-Z]{5}\d{4}[A-Z]\b/g, (m) => mask("pan", m)],
  // 12 digits is an Aadhaar number, 13–19 a card number (optional space or hyphen separators).
  [
    /\b(?:\d[ -]?){11,18}\d\b/g,
    (m) => (m.replace(/\D/g, "").length === 12 ? mask("aadhaar", m) : mask("card_pan", m)),
  ],
  [/(?:\+91[\s-]?)?\b[6-9]\d{9}\b/g, (m) => mask("mobile", m)],
];

/** Mask REGULATED patterns inside free text. */
export function scrubText(s: string): string {
  let out = s;
  for (const [re, fn] of PATTERNS) out = out.replace(re, fn);
  return out;
}

export interface Scrubber {
  /** `hashed` names identifier keys whose values the caller already hashed (C-21). */
  attrs(
    input: Readonly<Record<string, unknown>> | undefined,
    hashed?: ReadonlySet<string>,
  ): Record<string, ScrubValue>;
  text(s: string): string;
}

/**
 * Flatten `input` (nested objects to dotted keys, depth ≤ 4, arrays as JSON of scrubbed scalars)
 * and scrub every value. `hashId` is the C-21 hasher; without one identifier keys are dropped.
 */
export function createScrubber(hashId?: (id: string) => string): Scrubber {
  const scalar = (key: string, v: unknown): ScrubValue | undefined => {
    const leaf = key.slice(key.lastIndexOf(".") + 1);
    if (PAYLOAD_KEY.test(leaf)) return undefined;
    if (SECRET_KEY.test(leaf)) return "[REDACTED]";
    if (ID_KEY.test(leaf)) return typeof v === "string" && hashId ? hashId(v) : undefined;
    if (Object.hasOwn(MASK_RULES, leaf) && (typeof v === "string" || typeof v === "number"))
      return mask(leaf, String(v));
    if (typeof v === "string") return scrubText(v);
    if (typeof v === "number" || typeof v === "boolean") return v;
    if (typeof v === "bigint") return v.toString();
    return undefined;
  };
  const walk = (prefix: string, v: unknown, out: Record<string, ScrubValue>, depth: number) => {
    if (v === null || v === undefined) return;
    if (Array.isArray(v)) {
      const items = v.map((x) => scalar(prefix, x)).filter((x) => x !== undefined);
      if (items.length) out[prefix] = JSON.stringify(items);
      return;
    }
    if (typeof v === "object" && !(v instanceof Date)) {
      if (depth >= 4) return;
      const leaf = prefix.slice(prefix.lastIndexOf(".") + 1);
      if (prefix && (PAYLOAD_KEY.test(leaf) || SECRET_KEY.test(leaf))) return;
      for (const [k, x] of Object.entries(v))
        walk(prefix ? `${prefix}.${k}` : k, x, out, depth + 1);
      return;
    }
    const s = scalar(prefix, v instanceof Date ? v.toISOString() : v);
    if (s !== undefined) out[prefix] = s;
  };
  return {
    attrs(input, hashed) {
      const out: Record<string, ScrubValue> = {};
      if (!input) return out;
      const rest: Record<string, unknown> = { ...input };
      for (const k of hashed ?? []) {
        const v = rest[k];
        delete rest[k];
        if (typeof v === "string" && /^[0-9a-z_]{1,64}$/.test(v)) out[k] = v;
      }
      walk("", rest, out, 0);
      return out;
    },
    text: scrubText,
  };
}
