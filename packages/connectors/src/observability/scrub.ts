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

/** A key's words in lower case: `bankAccountNo` → bank, account, no. */
const words = (key: string): string[] =>
  key
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z\d]+/)
    .filter(Boolean);

/** Credential words anywhere in a key (`otp_code`, `otpHash`, `card_cvv`; PR-UDF-007). */
const SECRET_WORDS = new Set(["otp", "totp", "hotp", "mpin", "cvv", "cvc", "passcode"]);
const isSecretKey = (leaf: string) =>
  SECRET_KEY.test(leaf) || words(leaf).some((w) => SECRET_WORDS.has(w));

/** Last words of a key that name a masked field (`customerPan`, `email_address`, `phone`). */
const FIELD_WORDS = new Map([
  ["aadhaar", "aadhaar"],
  ["aadhar", "aadhaar"],
  ["pan", "pan"],
  ["passport", "passport"],
  ["mobile", "mobile"],
  ["phone", "mobile"],
  ["msisdn", "mobile"],
  ["email", "email"],
]);
/** Words that name a field when a number qualifier follows (`account_number`, `cardNo`). */
const NUMBERED_WORDS = new Map([
  ...FIELD_WORDS,
  ["account", "bank_account"],
  ["acct", "bank_account"],
  ["ac", "bank_account"],
  ["card", "card_pan"],
]);
const QUALIFIERS = new Set(["number", "no", "num"]);

/** The mask rule a key names: a rule name itself, or one of its common spellings (PR-UDF-007). */
function maskRuleFor(leaf: string): string | undefined {
  if (Object.hasOwn(MASK_RULES, leaf)) return leaf;
  const w = words(leaf);
  const last = w.at(-1);
  const prev = w.at(-2);
  if (last === undefined) return undefined;
  if (prev !== undefined) {
    if (Object.hasOwn(MASK_RULES, `${prev}_${last}`)) return `${prev}_${last}`;
    if (QUALIFIERS.has(last)) return NUMBERED_WORDS.get(prev);
    if (prev === "email" && (last === "address" || last === "id")) return "email";
  }
  return FIELD_WORDS.get(last);
}

/** Words that announce a one-time code or card security code in free text. */
const OTP_LABEL = String.raw`(?:t?otp|mpin|cvv|cvc|passcode|one[\s-]time[\s-]pass(?:word|code)?|verification[\s-]code|security[\s-]code)`;

const PATTERNS: ReadonlyArray<[RegExp, (m: string, ...groups: string[]) => string]> = [
  // Credential-named query parameters, such as the `ipb_token` webhook secret (PL2-D-65), and
  // one-time codes (`otp=123456`, `otp_code=…`; PR-UDF-007).
  [
    /((?:^|[?&\s])(?:ipb_token|[a-z_]*token|[a-z_]*secret|api[_-]?key|key|signature|sig|password|(?:[a-z]+_)*t?otp(?:_[a-z]+)*|mpin|cvv|cvc|passcode)=)[^&#\s]+/gi,
    (m) => `${m.slice(0, m.indexOf("=") + 1)}[REDACTED]`,
  ],
  // A one-time code or CVV written into a message: "OTP is 482913", `"otp":"482913"`, "482913 is
  // your OTP" (PR-UDF-007). The code goes; the words around it stay.
  [
    new RegExp(String.raw`(\b${OTP_LABEL}(?:[_-][a-z]+)*\b[^\d\n]{0,24}?)\d{3,8}(?!\d)`, "gi"),
    (_m, label = "") => `${label}[REDACTED]`,
  ],
  [new RegExp(String.raw`\b\d{4,8}\b(?=[^\d\n]{0,24}?\b${OTP_LABEL}\b)`, "gi"), () => "[REDACTED]"],
  [/\b[\w.+-]+@[\w-]+(\.[\w-]+)+\b/g, (m) => mask("email", m)],
  [/\b[A-Z]{5}\d{4}[A-Z]\b/g, (m) => mask("pan", m)],
  // Indian passport numbers (IPB-02-22), the form the AI scrubber detects.
  [/\b[A-PR-WY][1-9]\d\s?\d{4}[1-9]\b/g, (m) => mask("passport", m)],
  // A bank account number named as one, separators allowed: "A/c no. 1234 5678 901",
  // `account_number=12345678901` (9 to 18 digits; PR-UDF-007).
  [
    /(\b(?:a\/c|acct|account|ac)(?:[\s._-]*(?:no|num|number))?\.?[\s"'#:=-]*)(\d[\d\s-]{7,22}\d)(?!\d)/gi,
    (m, label = "", num = "") => {
      const n = num.replace(/\D/g, "").length;
      return n >= 9 && n <= 18 ? `${label}${mask("bank_account", num)}` : m;
    },
  ],
  // 12 digits is an Aadhaar number, 13–19 a card number (optional space or hyphen separators).
  [
    /\b(?:\d[ -]?){11,18}\d\b/g,
    (m) => (m.replace(/\D/g, "").length === 12 ? mask("aadhaar", m) : mask("card_pan", m)),
  ],
  [/(?:\+91[\s-]?)?\b[6-9]\d{4}[\s-]?\d{5}\b/g, (m) => mask("mobile", m)],
  // Any other run of 9 to 11 digits is treated as an account number (PR-UDF-007). This also masks
  // epoch seconds and other long counters in free text; structured numeric attributes keep them.
  [/\b\d{9,11}\b/g, (m) => mask("bank_account", m)],
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
    if (isSecretKey(leaf)) return "[REDACTED]";
    if (ID_KEY.test(leaf)) return typeof v === "string" && hashId ? hashId(v) : undefined;
    const rule = maskRuleFor(leaf);
    if (rule && (typeof v === "string" || typeof v === "number")) return mask(rule, String(v));
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
      if (prefix && (PAYLOAD_KEY.test(leaf) || isSecretKey(leaf))) return;
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
