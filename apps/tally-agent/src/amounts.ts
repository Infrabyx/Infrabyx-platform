// Integer paise to TallyPrime amounts and back, by string arithmetic only (never floating point;
// P-04). TallyPrime writes rupees with up to two decimals; in a voucher's ledger lines a debit is
// negative with ISDEEMEDPOSITIVE "Yes" and a credit positive with "No", and in a ledger's closing
// balance a debit balance is negative (Tally Help "XML Integration", sample vouchers; search
// snippets of help.tallysolutions.com, 18 Nov 2026) [VERIFY with a TallyPrime sandbox company].
import { ACCOUNTING_MAX_PAISE } from "@infrabyx/contracts/ports";

/** `150000` paise → `"1500.00"`; negative when `negative`. */
export function paiseToRupees(paise: number, negative = false): string {
  if (!Number.isSafeInteger(paise) || paise < 0 || paise > ACCOUNTING_MAX_PAISE)
    throw new RangeError("an amount is a whole number of paise within the platform's limit");
  const s = String(paise).padStart(3, "0");
  const rupees = `${s.slice(0, -2)}.${s.slice(-2)}`;
  return negative && paise !== 0 ? `-${rupees}` : rupees;
}

const AMOUNT = /^\s*(-)?\s*(\d{1,16})(?:\.(\d{1,2}))?\s*$/;

/** `"-1500.00"` → `-150000`; null when it is not a plain amount of at most two decimals. */
export function rupeesToPaise(s: string): number | null {
  const m = AMOUNT.exec(s);
  if (!m) return null;
  const whole = m[2]!.replace(/^0+(?=\d)/, "");
  const frac = (m[3] ?? "").padEnd(2, "0");
  const digits = `${whole}${frac}`.replace(/^0+(?=\d)/, "");
  if (digits.length > 16) return null;
  const v = Number(digits);
  if (!Number.isSafeInteger(v) || v > ACCOUNTING_MAX_PAISE) return null;
  return m[1] && v !== 0 ? -v : v;
}

/** `2026-11-02` → `20261102`, TallyPrime's date form. */
export const tallyDate = (iso: string): string => iso.replace(/-/g, "");

/** `20261102` → `2026-11-02`; null otherwise. */
export function isoDate(tally: string): string | null {
  const m = /^\s*(\d{4})(\d{2})(\d{2})\s*$/.exec(tally);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}
