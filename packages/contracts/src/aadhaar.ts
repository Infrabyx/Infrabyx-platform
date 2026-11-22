// The platform's one no-Aadhaar rule (Udofin PR-UDF-042, R1-D-195): what reads as an Aadhaar number
// or a Virtual ID in free text. The AI gateway's scrubber (`@infrabyx/ai` AADHAAR), the KYC
// adapters' e-KYC check (`connectors`), the repository scanner (`infrabyx-aadhaar-scan`) and the
// test-database sweep (`scanDatabaseForAadhaar`, `testing`) all call `findAadhaarLike`, so a product
// gets the same answer everywhere. No runtime dependency (not even Zod): browsers, CLIs and the
// kernel import it alike.
//
// The rule, exactly:
//   - AADHAAR: 12 digits, the first 2 to 9, with a valid Verhoeff check digit;
//   - VID: 16 digits with a valid Verhoeff check digit (any first digit);
//   - plain (`dddddddddddd`) or grouped in fours: between two groups at most one separator, one
//     whitespace character (a space, tab, no-break space or line break; JavaScript's `\s`) or a
//     hyphen (`dddd dddd dddd`, `dddd-dddd-dddd`, and 4-4-4-4 for a VID), gaps chosen freely, as
//     the AI gateway's rule always read them; two characters (`\r\n`, ` - `) end the number;
//   - bounded by a non-digit (or the start or end of the text) on both sides: a longer run of
//     digits is never split into a find (13 digits in a row find nothing). A letter, `+` or any
//     other non-digit next to the number is a boundary, so `id:A<number>B` and `+<number>` are
//     finds ([ASSUMED – owner review] #146). Separators are non-digits too, so in a grouped run the
//     16-digit reading is tried first at each start and, when it is not a VID, the 12-digit one;
//   - `letters: "join"` makes an ASCII letter part of the run instead (a hash or a base64 run
//     such as `ab<number>cd` is not a number standing alone): the e-KYC check's reading (R1-D-194);
//   - ASCII digits only (no NFKC folding, so offsets index the text as given);
//   - look-alikes (PR-UDF-063, R1-D-242) are finds by default. A product may choose, with `allow`,
//     to let two through: `e164_in`, twelve digits `91` + ten right after a `+` that starts a token
//     (an Indian E.164 phone number, `+91dddddddddd`; without the `+` it is still a find), and
//     `decimal`, a plain run with a `.` right before or after it and a digit beyond the `.`
//     (`0.dddddddddddd`, `dddddddddddd.5`). Only the ungrouped form is let through; an unknown
//     name throws.
//
// A column or JSON field *named* like an Aadhaar carrier (`isAadhaarFieldName`, the names in
// `AADHAAR_FIELD_NAMES`) is suspicious whatever it holds; `findAadhaarNamedFields` walks a parsed
// JSON value for such fields that hold a value (PR-UDF-063). `isAadhaarCarrierName` also reads a
// carrier name inside a longer name, and `findAadhaarLabelledValues` a carrier name followed by a
// value in free text (PR-UDF-079, R1-D-270; the rules are written out at the end of this file).
//
// A find carries the kind, the offsets and the number masked (`XXXX XXXX dddd`, `XXXX XXXX XXXX
// dddd`): never a digit beyond the last four. Callers that hold the text can slice it by offset
// (the scrubber does, to tokenise); nothing here returns more of the number.

// Verhoeff tables (dihedral group D5): multiplication, permutation.
const D = [
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
] as const;
const P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
] as const;

/** True when the digit string carries a valid Verhoeff check digit (Aadhaar and VID). */
export function verhoeffValid(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;
  let c = 0;
  const rev = [...digits].reverse();
  for (let i = 0; i < rev.length; i++) c = D[c]![P[i % 8]![Number(rev[i])]!]!;
  return c === 0;
}

export const AADHAAR_LIKE_KINDS = ["AADHAAR", "VID"] as const;
export type AadhaarLikeKind = (typeof AADHAAR_LIKE_KINDS)[number];

/** One number found by `findAadhaarLike`: where it is and what it is, masked. */
export interface AadhaarLikeFind {
  kind: AadhaarLikeKind;
  /** Offset (UTF-16 code units) of the number's first digit in the text. */
  start: number;
  /** Offset just past its last digit. */
  end: number;
  /** `XXXX XXXX dddd` (AADHAAR) or `XXXX XXXX XXXX dddd` (VID): the last four digits only. */
  masked: string;
}

/**
 * Look-alikes a product may choose to let through (PR-UDF-063): `e164_in` (`+91` and ten digits)
 * and `decimal` (digits joined to a `.` with a digit beyond it). Never the default.
 */
export const AADHAAR_LOOK_ALIKES = ["e164_in", "decimal"] as const;
export type AadhaarLookAlike = (typeof AADHAAR_LOOK_ALIKES)[number];

export interface FindAadhaarOptions {
  /**
   * `"boundary"` (default): a letter next to the digits bounds them, as any non-digit does.
   * `"join"`: an ASCII letter joins the run, so digits inside a hash or base64 run are not found.
   */
  letters?: "boundary" | "join";
  /**
   * Look-alikes to let through (default none: every look-alike is a find). The product's choice,
   * and its risk: an Aadhaar number written as `+<number>` or next to a `.` is then missed.
   */
  allow?: readonly AadhaarLookAlike[];
}

const SEP = "[\\s-]?";
const four = (groups: number) => Array.from({ length: groups }, () => "\\d{4}").join(SEP);
const sticky = (groups: number, join: boolean) =>
  new RegExp(`${four(groups)}(?!${join ? "[0-9A-Za-z]" : "[0-9]"})`, "y");
const READERS = {
  boundary: { vid: sticky(4, false), aadhaar: sticky(3, false), before: /[0-9]/ },
  join: { vid: sticky(4, true), aadhaar: sticky(3, true), before: /[0-9A-Za-z]/ },
} as const;

/** The masked form of a number's digits: X for every digit but the last four, in fours. */
const masked = (digits: string): string =>
  `${"XXXX ".repeat(digits.length / 4 - 1)}${digits.slice(-4)}`;

/**
 * Every Aadhaar number and VID in `text`, by the rule at the top of this file, in order and never
 * overlapping; each masked. An empty array when there is none.
 */
export function findAadhaarLike(text: string, o: FindAadhaarOptions = {}): AadhaarLikeFind[] {
  const r = READERS[o.letters ?? "boundary"];
  const allow = lookAlikes(o.allow);
  const out: AadhaarLikeFind[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text.charCodeAt(i);
    if (c < 48 || c > 57 || (i > 0 && r.before.test(text[i - 1]!))) {
      i++;
      continue;
    }
    const hit = readAt(text, i, r.vid, "VID") ?? readAt(text, i, r.aadhaar, "AADHAAR");
    if (hit) {
      if (!(allow.size && isAllowedLookAlike(text, hit, allow))) out.push(hit);
      i = hit.end;
    } else i++;
  }
  return out;
}

function readAt(
  text: string,
  at: number,
  re: RegExp,
  kind: AadhaarLikeKind,
): AadhaarLikeFind | undefined {
  re.lastIndex = at;
  const m = re.exec(text);
  if (!m) return undefined;
  const digits = m[0].replace(/\D/g, "");
  if (kind === "AADHAAR" && digits[0]! < "2") return undefined;
  if (!verhoeffValid(digits)) return undefined;
  return { kind, start: at, end: at + m[0].length, masked: masked(digits) };
}

function lookAlikes(allow: readonly AadhaarLookAlike[] | undefined): Set<AadhaarLookAlike> {
  const s = new Set<AadhaarLookAlike>();
  for (const a of allow ?? []) {
    // Fail closed: a misspelt name must not pass silently as "allow nothing" or anything else.
    if (!(AADHAAR_LOOK_ALIKES as readonly string[]).includes(a))
      throw new TypeError(`unknown Aadhaar look-alike: ${String(a)}`);
    s.add(a);
  }
  return s;
}

const isDigit = (ch: string | undefined) => ch !== undefined && ch >= "0" && ch <= "9";
const isAlnum = (ch: string | undefined) => ch !== undefined && /[0-9A-Za-z]/.test(ch);

/** Whether a find is a look-alike the caller let through (ungrouped forms only). */
function isAllowedLookAlike(text: string, f: AadhaarLikeFind, allow: Set<AadhaarLookAlike>) {
  const plain = f.end - f.start === (f.kind === "VID" ? 16 : 12);
  if (!plain) return false;
  if (
    allow.has("e164_in") &&
    f.kind === "AADHAAR" &&
    text[f.start - 1] === "+" &&
    !isAlnum(text[f.start - 2]) &&
    text.startsWith("91", f.start)
  )
    return true;
  return (
    allow.has("decimal") &&
    ((text[f.start - 1] === "." && isDigit(text[f.start - 2])) ||
      (text[f.end] === "." && isDigit(text[f.end + 1])))
  );
}

/** True when `text` holds an Aadhaar number or VID by the same rule (`findAadhaarLike`). */
export function holdsAadhaarLike(text: string, o: FindAadhaarOptions = {}): boolean {
  return findAadhaarLike(text, o).length > 0;
}

// ---- Fields named like an Aadhaar carrier (PR-UDF-063, R1-D-242) --------------------------------

const FIELD_STEMS = ["aadhaar", "aadhar"] as const;
const FIELD_SUFFIXES = [
  "",
  "_no",
  "_num",
  "_number",
  "_id",
  "_uid",
  "_vid",
  "_virtual_id",
  "_token",
  "_card",
  "_card_no",
  "_card_number",
] as const;

/**
 * The column and field names that mark an Aadhaar carrier, in snake case: `aadhaar` (and the
 * common spelling `aadhar`) alone or with `_no`, `_num`, `_number`, `_id`, `_uid`, `_vid`,
 * `_virtual_id`, `_token`, `_card`, `_card_no` or `_card_number`; and `uid` alone or with `_no`,
 * `_num`, `_number` or `_token`. `isAadhaarFieldName` matches them whatever the case and
 * separators (`aadhaarNumber`, `AADHAAR-NO`, `UidToken`); nothing else matches (not
 * `aadhaar_last_digits`, `uid_kind` or `user_uid`).
 */
export const AADHAAR_FIELD_NAMES: readonly string[] = [
  ...FIELD_STEMS.flatMap((s) => FIELD_SUFFIXES.map((x) => `${s}${x}`)),
  ...["", "_no", "_num", "_number", "_token"].map((x) => `uid${x}`),
];
const fold = (name: string) => name.toLowerCase().replace(/[^0-9a-z]/g, "");
const FOLDED_FIELD_NAMES = new Set(AADHAAR_FIELD_NAMES.map(fold));

/** True when a column or field name is one of `AADHAAR_FIELD_NAMES`, ignoring case and separators. */
export function isAadhaarFieldName(name: string): boolean {
  return FOLDED_FIELD_NAMES.has(fold(name));
}

/**
 * True when a (parsed JSON) value holds something: a non-blank string, a number, or an array or
 * object with a member that does. `null`, `undefined`, booleans, blank strings and empty
 * containers hold nothing.
 */
export function holdsAadhaarFieldValue(v: unknown): boolean {
  if (typeof v === "string") return v.trim() !== "";
  if (typeof v === "number" || typeof v === "bigint") return true;
  if (Array.isArray(v)) return v.some(holdsAadhaarFieldValue);
  if (v && typeof v === "object") return Object.values(v).some(holdsAadhaarFieldValue);
  return false;
}

/** One field named like an Aadhaar carrier that holds a value: its key path from the root. */
export interface AadhaarNamedFieldFind {
  /** Keys and array indexes from the root, the named field last. */
  path: (string | number)[];
}

/**
 * Every field of a parsed JSON value (objects at any depth, through arrays) whose name
 * `isAadhaarFieldName` and whose value `holdsAadhaarFieldValue`, in document order; the value itself is
 * never returned. A named field that holds a value is one find (nothing below it is searched
 * again); a named field that holds nothing is not a find.
 */
export function findAadhaarNamedFields(value: unknown): AadhaarNamedFieldFind[] {
  return walkNamedFields(value, isAadhaarFieldName, (_k, x) => holdsAadhaarFieldValue(x));
}

function walkNamedFields(
  value: unknown,
  named: (key: string) => boolean,
  holds: (key: string, v: unknown) => boolean,
): AadhaarNamedFieldFind[] {
  const out: AadhaarNamedFieldFind[] = [];
  const walk = (v: unknown, path: (string | number)[]): void => {
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, [...path, i]));
    else if (v && typeof v === "object")
      for (const [k, x] of Object.entries(v)) {
        if (named(k)) {
          if (holds(k, x)) out.push({ path: [...path, k] });
        } else walk(x, [...path, k]);
      }
  };
  walk(value, []);
  return out;
}

// ---- Carrier names inside longer names, and labelled values (PR-UDF-079, R1-D-270) --------------
//
// `isAadhaarCarrierName` widens `isAadhaarFieldName` (unchanged) to names that carry an Aadhaar
// inside a longer name. A name is split into segments: at every character that is not an ASCII
// letter or digit, at a lower-to-upper case change (`borrowerAadhaarRef`), before the last capital
// of a run of capitals followed by a lower-case letter (`UIDToken` is `uid`, `token`), and between
// letters and digits (`aadhaarLast4` is `aadhaar`, `last`, `4`). Segments compare in lower case. A
// name is a carrier name when:
//   - it is one of `AADHAAR_FIELD_NAMES` (`isAadhaarFieldName`); or
//   - a segment is `aadhaar` or `aadhar`, anywhere (`borrower_aadhaar_ref`, `masked_aadhaar_no`,
//     `aadhaar_otp`): the stems are unambiguous; or
//   - it ends with the segments of `uid`, `uid_no`, `uid_num`, `uid_number`, `uid_token` or
//     `uidai_token`, after any prefix (`user_uid`, `kyc_uid_token`, `kyc_uidai_token`). `uid` is
//     short and overloaded, so it counts only as a whole segment run that ends the name: not
//     `uid_kind`, `uid_type`, `uidx`, `uuid`, `guid` or `fluid`.
// A last-four name (`isAadhaarLastFourName`: one `aadhaar`/`aadhar` segment followed by exactly
// `last 4`, `last four`, `last digits`, `last 4 digits` or `last four digits`, after any prefix:
// `aadhaar_last_digits`, `aadhaarLast4`, `aadhaar_last_4`) is a carrier name whose value is
// reported only when it holds more than four ASCII digits: the platform's KYC results keep the
// last four digits (`aadhaarLast4`), which UIDAI allows, and nothing more.
//
// `findAadhaarLabelledValues` reads free text for a carrier name followed by a value, whatever the
// value's check digit and however it is masked (`aadhaar: <number>`, `Aadhaar No. XXXX XXXX dddd`,
// `uid=<number>`), by the rule written out at that function.

const NAME_SEGMENT = /[A-Z]+(?![a-z])|[A-Z]?[a-z]+|[0-9]+/g;
/** A name's segments, lower case (see above). */
function nameSegments(name: string): string[] {
  return (name.match(NAME_SEGMENT) ?? []).map((s) => s.toLowerCase());
}
const STEM_SEGMENTS = new Set<string>(FIELD_STEMS);
const TAIL_RUNS: readonly (readonly string[])[] = [
  ["uid"],
  ["uid", "no"],
  ["uid", "num"],
  ["uid", "number"],
  ["uid", "token"],
  ["uidai", "token"],
];
const LAST_FOUR_TAILS: readonly string[] = [
  "last 4",
  "last four",
  "last digits",
  "last 4 digits",
  "last four digits",
];
const endsWithRun = (s: readonly string[], run: readonly string[]) =>
  s.length >= run.length && run.every((x, i) => s[s.length - run.length + i] === x);

/**
 * The carrier names that `isAadhaarCarrierName` matches as the segments ending a longer name, in
 * snake case: `uid`, `uid_no`, `uid_num`, `uid_number`, `uid_token` and `uidai_token`.
 */
export const AADHAAR_CARRIER_NAME_ENDINGS: readonly string[] = TAIL_RUNS.map((r) => r.join("_"));

/**
 * True when a column, field or label name carries an Aadhaar (PR-UDF-079): one of
 * `AADHAAR_FIELD_NAMES`, a name with an `aadhaar` or `aadhar` segment anywhere, or a name ending
 * with one of `AADHAAR_CARRIER_NAME_ENDINGS` as whole segments (the rule above).
 */
export function isAadhaarCarrierName(name: string): boolean {
  if (isAadhaarFieldName(name)) return true;
  const s = nameSegments(name);
  return s.some((x) => STEM_SEGMENTS.has(x)) || TAIL_RUNS.some((r) => endsWithRun(s, r));
}

/**
 * True when a carrier name names the last four digits only (`aadhaar_last_digits`,
 * `aadhaarLast4`, `kyc_aadhaar_last_4`): one `aadhaar` or `aadhar` segment, followed by exactly
 * `last 4`, `last four`, `last digits`, `last 4 digits` or `last four digits`.
 */
export function isAadhaarLastFourName(name: string): boolean {
  const s = nameSegments(name);
  const stems = s.flatMap((x, i) => (STEM_SEGMENTS.has(x) ? [i] : []));
  return stems.length === 1 && LAST_FOUR_TAILS.includes(s.slice(stems[0]! + 1).join(" "));
}

/** The ASCII digits in a (parsed JSON) value: in its strings and numbers, at any depth. */
function digitCount(v: unknown): number {
  if (typeof v === "string") return v.replace(/[^0-9]/g, "").length;
  if (typeof v === "number" || typeof v === "bigint") return digitCount(String(v));
  if (Array.isArray(v)) return v.reduce((n: number, x) => n + digitCount(x), 0);
  if (v && typeof v === "object") return digitCount(Object.values(v));
  return 0;
}

/**
 * True when the (parsed JSON, or text) value of a field named `name` is reportable: for a
 * last-four name (`isAadhaarLastFourName`), more than four ASCII digits; for any other name,
 * `holdsAadhaarFieldValue`.
 */
export function holdsAadhaarCarrierValue(name: string, v: unknown): boolean {
  return isAadhaarLastFourName(name) ? digitCount(v) > 4 : holdsAadhaarFieldValue(v);
}

/**
 * `findAadhaarNamedFields` with the wider names (PR-UDF-079): every field of a parsed JSON value
 * whose name `isAadhaarCarrierName` and whose value `holdsAadhaarCarrierValue`, in document order,
 * by key path; never the value. A carrier field is not searched below.
 */
export function findAadhaarCarrierFields(value: unknown): AadhaarNamedFieldFind[] {
  return walkNamedFields(value, isAadhaarCarrierName, holdsAadhaarCarrierValue);
}

/** One carrier name followed by a value in free text: offsets only, never the value. */
export interface AadhaarLabelledFind {
  /** Offset of the label's first character. */
  start: number;
  /** Offset of the value's first character. */
  valueStart: number;
  /** Offset just past the value (or past `AADHAAR_LABELLED_VALUE_MAX` value characters). */
  end: number;
}

/** Value characters read at most after a label; a longer value is a find all the same. */
export const AADHAAR_LABELLED_VALUE_MAX = 64;
/** Longest label read (a longer run of word characters is not a name). */
const LABEL_MAX = 128;
const TOKEN = /[A-Za-z0-9_]+/g;
const LABEL_WORD = /[ \t._-]{0,3}(?:card|number|num|no|id|vid|token|ref)(?![A-Za-z0-9_])\.?/iy;
const isValueChar = (c: number) => (c >= 48 && c <= 57) || c === 88 || c === 120 || c === 42;
const isBlank = (c: number) => c === 32 || c === 9;
const isQuote = (c: number) => c === 34 || c === 39 || c === 96;
const isWordChar = (c: number) =>
  (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95;

/**
 * Every carrier name followed by a value in `text` (PR-UDF-079), in order, never overlapping. The
 * rule, exactly (ASCII letters in any case; never across a line break):
 *   - the label: a run of `[A-Za-z0-9_]` (at most 128) that `isAadhaarCarrierName`, then up to
 *     three label words, each after up to three of space, tab, `.`, `_` or `-`: `card`, `number`,
 *     `num`, `no`, `id`, `vid`, `token` or `ref`, each optionally followed by `.` (`Aadhaar No.`,
 *     `Aadhaar card number`, `UID no.`);
 *   - the separator: an optional closing quote (`"`, `'` or a backtick), up to eight spaces or
 *     tabs, an optional mark (`:`, `=`, `#`, `-`, `=>` or `->`) and up to eight more spaces or
 *     tabs, then an optional opening quote; with no mark and no label word there must be a space
 *     or tab;
 *   - the value: characters from `0-9`, `X`, `x` and `*`, groups joined by one space or hyphen, not
 *     followed by another letter, digit or `_`; at least 4 characters when there is a mark or a
 *     label word and the label spells `aadhaar`/`aadhar` or ends with `uidai_token`, and at least 8
 *     otherwise (a bare space after the label, or a `uid` label: `uid=1000`, a Unix user id, is not
 *     a find; `uid=XXXX XXXX dddd` is);
 *   - after a last-four label (`isAadhaarLastFourName`), only a value with more than four digits.
 * Linear: one pass over the text for labels, and a bounded read after each.
 */
export function findAadhaarLabelledValues(text: string): AadhaarLabelledFind[] {
  const out: AadhaarLabelledFind[] = [];
  const token = new RegExp(TOKEN.source, "g");
  for (let m = token.exec(text); m; m = token.exec(text)) {
    const label = m[0];
    if (label.length > LABEL_MAX || !/aadha|uid/i.test(label) || !isAadhaarCarrierName(label))
      continue;
    const f = readLabelledValue(text, m.index, m.index + label.length, label);
    if (f) {
      out.push(f);
      token.lastIndex = f.end;
    }
  }
  return out;
}

function readLabelledValue(
  text: string,
  start: number,
  labelEnd: number,
  label: string,
): AadhaarLabelledFind | undefined {
  const code = (i: number) => (i < text.length ? text.charCodeAt(i) : -1);
  let p = labelEnd;
  let worded = false;
  for (let n = 0; n < 3; n++) {
    LABEL_WORD.lastIndex = p;
    const w = LABEL_WORD.exec(text);
    if (!w) break;
    p += w[0].length;
    worded = true;
  }
  if (isQuote(code(p))) p++;
  const blankAt = p;
  while (p - blankAt < 8 && isBlank(code(p))) p++;
  const blanks = p - blankAt;
  let marked = true;
  const c = code(p);
  if ((c === 61 || c === 45) && code(p + 1) === 62) p += 2;
  else if (c === 58 || c === 61 || c === 35 || c === 45) p++;
  else marked = false;
  if (marked) for (let n = 0; n < 8 && isBlank(code(p)); n++) p++;
  if (!marked && !worded && blanks === 0) return undefined;
  if (isQuote(code(p))) p++;
  const valueStart = p;
  let chars = 0;
  let digits = 0;
  while (chars < AADHAAR_LABELLED_VALUE_MAX) {
    const v = code(p);
    if (isValueChar(v)) {
      chars++;
      if (v <= 57) digits++;
      p++;
    } else if ((v === 32 || v === 45) && chars > 0 && isValueChar(code(p + 1))) p++;
    else break;
  }
  if (chars < AADHAAR_LABELLED_VALUE_MAX && isWordChar(code(p))) return undefined;
  const plain = /aadhaa?r/i.test(label) || endsWithRun(nameSegments(label), ["uidai", "token"]);
  if (chars < ((marked || worded) && plain ? 4 : 8)) return undefined;
  if (isAadhaarLastFourName(label) && digits <= 4) return undefined;
  return { start, valueStart, end: p };
}
