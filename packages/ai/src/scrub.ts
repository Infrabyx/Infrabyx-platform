// PII and secret scrubber (IPB-03-27, 03-28; PL4 plan §4.5). Runs on every outbound request above
// PUBLIC. Each detection becomes a reversible token `<PII:KIND:n>`; the reverse map lives only in
// the request's `ScrubSession`, in this process's memory, and is applied to the response inside
// the tenant process. It is never stored, logged or traced. Scrubbing never lowers a request's
// data class (IPB-03-28): the gateway raises the class from what was detected before it scrubs.
//
// Detectors (owner list, 27 Oct 2026, plus IPB-03-27): Aadhaar (Verhoeff check; the masked form
// XXXX XXXX 1234; any 12-digit number after the word Aadhaar), PAN, Indian mobile numbers, e-mail
// addresses, UPI ids, bank account numbers (after an account keyword, or anywhere in a text that
// also carries an IFSC) and IFSC, card numbers (Luhn), voter ID (EPIC), passport, driving licence,
// GSTIN (checksum), date of birth (after a DOB keyword), JWTs, PEM private keys and API-key shapes.
// `ai.scrub.patterns` adds detectors; the built-in list always applies first.
import type { DataClass } from "@infrabyx/contracts/data-class";

export const PII_KINDS = [
  "PEM",
  "JWT",
  "API_KEY",
  "EMAIL",
  "UPI",
  "GSTIN",
  "PAN",
  "IFSC",
  "CARD",
  "AADHAAR",
  "BANK_ACCOUNT",
  "MOBILE",
  "VOTER_ID",
  "PASSPORT",
  "DRIVING_LICENCE",
  "DOB",
] as const;
export type PiiKind = (typeof PII_KINDS)[number];

/** The class a detection proves the text carries (the gateway raises the request to it). */
export const PII_CLASS: Readonly<Record<PiiKind, DataClass>> = {
  PEM: "CONFIDENTIAL",
  JWT: "CONFIDENTIAL",
  API_KEY: "CONFIDENTIAL",
  EMAIL: "CONFIDENTIAL",
  UPI: "CONFIDENTIAL",
  GSTIN: "CONFIDENTIAL",
  PAN: "REGULATED",
  IFSC: "CONFIDENTIAL",
  CARD: "REGULATED",
  AADHAAR: "REGULATED",
  BANK_ACCOUNT: "REGULATED",
  MOBILE: "CONFIDENTIAL",
  VOTER_ID: "REGULATED",
  PASSPORT: "REGULATED",
  DRIVING_LICENCE: "REGULATED",
  DOB: "CONFIDENTIAL",
};

/** An extra detector from `ai.scrub.patterns`. */
export interface ScrubPattern {
  kind: string;
  pattern: string;
  flags?: string;
  dataClass?: DataClass;
}

interface Detector {
  kind: string;
  re: RegExp;
  /** Replace only this capture group (context-anchored detectors). */
  group?: number;
  valid?: (value: string) => boolean;
  /** Applies only when the whole text matches this (e.g. an IFSC is present). */
  when?: RegExp;
}

const digits = (s: string) => s.replace(/\D/g, "");

// Verhoeff (Aadhaar's check digit).
const VD = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const VP = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];
export function verhoeffValid(num: string): boolean {
  const d = digits(num);
  if (!d) return false;
  let c = 0;
  [...d].reverse().forEach((ch, i) => {
    c = VD[c]![VP[i % 8]![Number(ch)]!]!;
  });
  return c === 0;
}

export function luhnValid(num: string): boolean {
  const d = digits(num);
  if (d.length < 12) return false;
  let sum = 0;
  [...d].reverse().forEach((ch, i) => {
    let n = Number(ch);
    if (i % 2 === 1) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
  });
  return sum % 10 === 0;
}

const B36 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
export function gstinValid(gstin: string): boolean {
  const g = gstin.toUpperCase();
  if (!/^[0-9]{2}[A-Z0-9]{13}$/.test(g)) return false;
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const p = B36.indexOf(g[i] as string) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(p / 36) + (p % 36);
  }
  return B36[(36 - (sum % 36)) % 36] === g[14];
}

const NUM_END = String.raw`(?![\d])`;
const NUM_START = String.raw`(?<![\d+])`;

/** The built-in detectors, in the order they run (more specific first). */
const BUILT_IN: readonly Detector[] = [
  {
    kind: "PEM",
    re: /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z0-9]+ )*PRIVATE KEY-----/g,
  },
  { kind: "JWT", re: /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g },
  {
    kind: "API_KEY",
    re: /\b(?:AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{36,}|AIza[0-9A-Za-z_-]{35}|xox[abprs]-[A-Za-z0-9-]{10,}|glpat-[A-Za-z0-9_-]{20,})\b/g,
  },
  {
    kind: "API_KEY",
    re: /\b(?:api[_-]?key|secret|access[_-]?token|auth[_-]?token|password|passwd)\b\s*[:=]\s*["']?([A-Za-z0-9_\-./+=]{12,})/gi,
    group: 1,
  },
  { kind: "EMAIL", re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g },
  { kind: "UPI", re: /\b[A-Za-z0-9._-]{2,256}@[A-Za-z]{2,64}\b(?![@\w]|\.[A-Za-z0-9])/g },
  {
    kind: "GSTIN",
    re: /\b[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b/gi,
    valid: gstinValid,
  },
  { kind: "PAN", re: /\b[A-Z]{3}[ABCFGHLJPT][A-Z][0-9]{4}[A-Z]\b/gi },
  { kind: "IFSC", re: /\b[A-Z]{4}0[A-Z0-9]{6}\b/gi },
  {
    kind: "CARD",
    re: new RegExp(`${NUM_START}[2-6]\\d{3}(?:[\\s-]?\\d{2,4}){2,4}${NUM_END}`, "g"),
    valid: (v) => {
      const n = digits(v).length;
      return n >= 13 && n <= 19 && luhnValid(v);
    },
  },
  {
    kind: "AADHAAR",
    re: new RegExp(`${NUM_START}[2-9]\\d{3}[\\s-]?\\d{4}[\\s-]?\\d{4}${NUM_END}`, "g"),
    valid: verhoeffValid,
  },
  // The masked form printed on e-Aadhaar and in KYC records.
  { kind: "AADHAAR", re: /(?<![\w*•])[Xx*•]{4}[\s-]?[Xx*•]{4}[\s-]?\d{4}(?!\d)/g },
  {
    kind: "AADHAAR",
    re: /\b(?:aadhaar|aadhar|adhaar|uidai|uid)\b(?:\s*(?:no\.?|number|#))?\s*[:-]?\s*(\d{4}[\s-]?\d{4}[\s-]?\d{4})(?!\d)/gi,
    group: 1,
  },
  {
    kind: "BANK_ACCOUNT",
    re: /\b(?:a\/c|acct|account|ac)\b\.?(?:\s*(?:no\.?|number|#))?\s*[:-]?\s*(\d[\d\s-]{7,22}\d)(?!\d)/gi,
    group: 1,
    valid: (v) => digits(v).length >= 9 && digits(v).length <= 18,
  },
  {
    kind: "MOBILE",
    re: new RegExp(
      `${NUM_START}(?:\\+91[\\s-]?|0091[\\s-]?|91[\\s-]?|0)?[6-9]\\d{4}[\\s-]?\\d{5}${NUM_END}`,
      "g",
    ),
  },
  {
    // Any long number in a text that also carries an IFSC is treated as an account number.
    kind: "BANK_ACCOUNT",
    re: new RegExp(`${NUM_START}\\d{9,18}${NUM_END}`, "g"),
    when: /<PII:IFSC:\d+>/,
  },
  { kind: "VOTER_ID", re: /\b[A-Z]{3}[0-9]{7}\b/gi },
  { kind: "PASSPORT", re: /\b[A-PR-WY][1-9][0-9]\s?[0-9]{4}[1-9]\b/gi },
  {
    kind: "DRIVING_LICENCE",
    re: /\b[A-Z]{2}[\s-]?[0-9]{2}[\s-]?(?:19|20)[0-9]{2}[\s-]?[0-9]{7}\b/gi,
  },
  {
    kind: "DOB",
    re: /\b(?:dob|d\.o\.b\.?|date of birth|born on|birth date)\b\s*[:-]?\s*(\d{1,2}[/.\- ]\d{1,2}[/.\- ]\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2}\s+[A-Za-z]{3,9},?\s+\d{4})/gi,
    group: 1,
  },
];

const TOKEN = /<PII:([A-Z][A-Z0-9_]{1,31}):(\d+)>/g;
const KIND_NAME = /^[A-Z][A-Z0-9_]{1,31}$/;

/** Compile `ai.scrub.patterns`; an invalid entry throws, so a bad setting fails closed. */
export function compilePatterns(extra: unknown): Detector[] {
  if (extra === null || extra === undefined) return [];
  if (!Array.isArray(extra)) throw new Error("ai.scrub.patterns must be an array");
  return extra.map((p: ScrubPattern, i) => {
    if (!p || typeof p.pattern !== "string" || !KIND_NAME.test(p.kind ?? ""))
      throw new Error(`ai.scrub.patterns[${i}] needs a kind (A-Z, 0-9, _) and a pattern`);
    const flags = [...new Set(`${(p.flags ?? "").replace(/[^imsu]/g, "")}g`)].join("");
    return { kind: p.kind, re: new RegExp(p.pattern, flags) };
  });
}

/** The class each custom kind proves (default CONFIDENTIAL). */
export function patternClasses(extra: unknown): Record<string, DataClass> {
  if (!Array.isArray(extra)) return {};
  return Object.fromEntries(
    (extra as ScrubPattern[]).map((p) => [p.kind, p.dataClass ?? "CONFIDENTIAL"]),
  );
}

export interface Detection {
  kind: string;
  value: string;
}

/**
 * One request's scrubbing state: the same value gets the same token everywhere in the request,
 * and `restore` maps tokens back. Text that already looks like a token is defused first, so input
 * cannot forge a token that `restore` would expand.
 */
export class ScrubSession {
  private readonly byKey = new Map<string, string>();
  private readonly byToken = new Map<string, string>();
  private readonly counters = new Map<string, number>();
  readonly detections: Detection[] = [];

  constructor(private readonly detectors: readonly Detector[]) {}

  /** `defuse: false` keeps existing tokens (the output check scans text that carries them). */
  scrub(text: string, o: { defuse?: boolean } = {}): string {
    let out = o.defuse === false ? text : text.replace(/<PII:/g, "<PII_:");
    for (const d of this.detectors) {
      if (d.when && !d.when.test(out)) continue;
      d.re.lastIndex = 0;
      out = out.replace(d.re, (m: string, ...rest: unknown[]) => {
        const value = d.group ? (rest[d.group - 1] as string | undefined) : m;
        if (!value || (d.valid && !d.valid(value))) return m;
        const token = this.tokenFor(d.kind, value);
        if (!d.group) return token;
        const at = m.lastIndexOf(value);
        return m.slice(0, at) + token + m.slice(at + value.length);
      });
    }
    return out;
  }

  private tokenFor(kind: string, value: string): string {
    const key = `${kind}|${/^[\d\s+-]+$/.test(value) ? digits(value) : value.toLowerCase()}`;
    const known = this.byKey.get(key);
    if (known) return known;
    const n = (this.counters.get(kind) ?? 0) + 1;
    this.counters.set(kind, n);
    const token = `<PII:${kind}:${n}>`;
    this.byKey.set(key, token);
    this.byToken.set(token, value);
    this.detections.push({ kind, value });
    return token;
  }

  /** Whether this session issued `token`. */
  has(token: string): boolean {
    return this.byToken.has(token);
  }

  /** Map tokens back to the original values (unknown tokens stay as they are). */
  restore(text: string): string {
    return text.replace(TOKEN, (t) => this.byToken.get(t) ?? t);
  }

  /** `restore` over every string inside a JSON-like value (tool-call arguments). */
  restoreDeep<T>(v: T): T {
    if (typeof v === "string") return this.restore(v) as T;
    if (Array.isArray(v)) return v.map((x) => this.restoreDeep(x)) as T;
    if (v && typeof v === "object")
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, this.restoreDeep(x)]),
      ) as T;
    return v;
  }

  /** Kinds detected so far, with counts. */
  kinds(): Record<string, number> {
    return Object.fromEntries(this.counters);
  }
}

export class Scrubber {
  private readonly detectors: readonly Detector[];
  readonly classes: Readonly<Record<string, DataClass>>;

  /** `extra` is the value of `ai.scrub.patterns`. */
  constructor(extra?: unknown) {
    this.detectors = [...BUILT_IN, ...compilePatterns(extra)];
    this.classes = { ...patternClasses(extra), ...PII_CLASS };
  }

  session(): ScrubSession {
    return new ScrubSession(this.detectors);
  }

  /** What a text contains, without keeping a session. */
  detect(text: string): Detection[] {
    const s = this.session();
    s.scrub(text);
    return s.detections;
  }

  /** The class a detection proves; unknown kinds count as CONFIDENTIAL. */
  classOf(kind: string): DataClass {
    return this.classes[kind] ?? "CONFIDENTIAL";
  }
}
