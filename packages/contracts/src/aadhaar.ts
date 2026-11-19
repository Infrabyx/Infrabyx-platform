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
//   - ASCII digits only (no NFKC folding, so offsets index the text as given).
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

export interface FindAadhaarOptions {
  /**
   * `"boundary"` (default): a letter next to the digits bounds them, as any non-digit does.
   * `"join"`: an ASCII letter joins the run, so digits inside a hash or base64 run are not found.
   */
  letters?: "boundary" | "join";
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
      out.push(hit);
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

/** True when `text` holds an Aadhaar number or VID by the same rule (`findAadhaarLike`). */
export function holdsAadhaarLike(text: string, o: FindAadhaarOptions = {}): boolean {
  return findAadhaarLike(text, o).length > 0;
}
