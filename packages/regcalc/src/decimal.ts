// The one number type of the package (ADR-0015; R1-regcalc plan §1): every amount, rate and ratio
// is a `Decimal` from a private clone of decimal.js (40 significant digits, half-up), never a
// JavaScript `number`. Inputs are decimal strings or `Decimal`s; a `number` is refused, so a float
// never enters a regulated figure.
import { Decimal } from "decimal.js";
import { RegcalcError } from "./errors.js";

/** The package's Decimal: 40 significant digits, half-up, no exponent notation in `toString`. */
export const D = Decimal.clone({
  precision: 40,
  rounding: Decimal.ROUND_HALF_UP,
  toExpNeg: -40,
  toExpPos: 40,
});
export type Dec = Decimal;

/** What a caller may pass for a number: a decimal string (`"100000"`, `"0.18"`) or a `Decimal`. */
export type DecimalInput = string | Decimal;

const DECIMAL_STRING = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;

/**
 * `x` as a Decimal, or `input_invalid` naming `field`. A `number` (a float), an exponent, a
 * thousands separator, `NaN` or an infinity is refused.
 */
export function dec(x: unknown, field: string): Dec {
  if (Decimal.isDecimal(x)) {
    const d = new D(x as Decimal);
    if (!d.isFinite()) throw RegcalcError.input(field, "not a finite number");
    return d;
  }
  if (typeof x === "number")
    throw RegcalcError.input(field, "a JavaScript number is refused; pass a decimal string");
  if (typeof x !== "string" || !DECIMAL_STRING.test(x.trim()))
    throw RegcalcError.input(field, "not a decimal string");
  return new D(x.trim());
}

/** `dec`, then `lo <= x` (and `x <= hi` when given), or `input_out_of_range`. */
export function decIn(x: unknown, field: string, lo: DecimalInput, hi?: DecimalInput): Dec {
  const d = dec(x, field);
  if (d.lt(lo) || (hi !== undefined && d.gt(hi)))
    throw RegcalcError.range(
      field,
      `must be at least ${String(lo)}${hi === undefined ? "" : ` and at most ${String(hi)}`}`,
    );
  return d;
}

/** A positive whole number of periods or days, or `input_out_of_range`. */
export function count(x: unknown, field: string, max: number): number {
  if (typeof x !== "number" || !Number.isSafeInteger(x) || x < 1 || x > max)
    throw RegcalcError.range(field, `must be a whole number from 1 to ${max}`);
  return x;
}

/** The sum of `xs` (zero for none). */
export const sum = (xs: readonly Dec[]): Dec => xs.reduce((a, b) => a.plus(b), new D(0));

/** A fixed decimal string of `x` to `dp` places (half-up), for a result field. */
export const fixed = (x: Dec, dp: number): string => x.toFixed(dp, D.ROUND_HALF_UP);
