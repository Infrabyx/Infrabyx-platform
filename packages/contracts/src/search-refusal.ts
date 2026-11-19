// Protected identifier patterns that search and saved filters refuse (IPB-07-17, `IPB-UX-003`;
// Finbyx PR-FBX-09, R1-D-32). One function for the browser, the server and the saved-view store,
// so an Aadhaar number, a VID, a card number or a PAN never reaches a search index, a log, history,
// analytics or a stored filter. The refusal carries the pattern class only, never the text.
// `verhoeffValid` lives with the shared no-Aadhaar rule (`./aadhaar.js`, PR-UDF-042) and is
// re-exported here unchanged for the callers that import it from this module.
import { verhoeffValid } from "./aadhaar.js";

export { verhoeffValid };

export const SEARCH_PATTERN_CLASSES = ["aadhaar_pattern", "pan_pattern", "card_pattern"] as const;
export type SearchPatternClass = (typeof SEARCH_PATTERN_CLASSES)[number];

export interface SearchRefusal {
  code: "IPB-UX-003";
  patternClass: SearchPatternClass;
  /** "Search by name or reference instead" (IPB-07-17); a message key for products' catalogues. */
  messageKey: "ui.search.refused";
}

/** True when the digit string passes the Luhn check (payment card numbers). */
export function luhnValid(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

/** Every digit run that could be an identifier, read with spaces and hyphens removed. */
function digitCandidates(q: string): string[] {
  const out = new Set<string>();
  for (const run of q.match(/\d[\d -]*\d/g) ?? []) out.add(run.replace(/[ -]/g, ""));
  // An Aadhaar-shaped group inside a longer run ("2345 6789 0123 99").
  for (const m of q.matchAll(/(?<!\d)\d{4}[ -]?\d{4}[ -]?\d{4}(?!\d)/g))
    out.add(m[0].replace(/[ -]/g, ""));
  return [...out];
}

const refuse = (patternClass: SearchPatternClass): SearchRefusal => ({
  code: "IPB-UX-003",
  patternClass,
  messageKey: "ui.search.refused",
});

/**
 * Why `text` may not be searched or stored as a filter, or null when it may. IPB-07-17 refuses
 * twelve digits that are Verhoeff-valid or match `\d{4}\s?\d{4}\s?\d{4}`; the pattern covers every
 * twelve-digit run, so every one is refused. A Verhoeff-valid sixteen-digit Aadhaar VID is refused
 * as an Aadhaar, a Luhn-valid run of 13 to 19 digits as a card, and `[A-Z]{5}\d{4}[A-Z]` as a PAN,
 * whatever the caller's role: IPB-07-17 has no exception.
 */
export function searchRefusal(text: string): SearchRefusal | null {
  const q = text.normalize("NFKC");
  for (const digits of digitCandidates(q)) {
    if (digits.length === 12) return refuse("aadhaar_pattern");
    if (digits.length === 16 && verhoeffValid(digits)) return refuse("aadhaar_pattern");
    if (digits.length >= 13 && digits.length <= 19 && luhnValid(digits))
      return refuse("card_pattern");
  }
  if (/(^|[^A-Z0-9])[A-Z]{5}\d{4}[A-Z]($|[^A-Z0-9])/i.test(q)) return refuse("pan_pattern");
  return null;
}
