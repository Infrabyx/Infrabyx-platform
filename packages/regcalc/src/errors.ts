// Coded refusals, never `NaN`, `Infinity` or a silent clamp (R1-regcalc plan §1; owner answer 4,
// R1-D-301): no new catalogue area. A product maps a `RegcalcError` to its existing 422 validation
// problem with `reason` (and `field`) as labels.

export const REGCALC_REASONS = [
  /** A value is not a decimal string, or a JavaScript number was passed. */
  "input_invalid",
  /** A value is outside what the calculation allows (a negative amount, 0 instalments). */
  "input_out_of_range",
  /** No rate solves the cash flows (every flow of one sign, or no sign change). */
  "no_solution",
  /** A parameter pack fails its schema, or is looser than the regulatory floor. */
  "rule_pack_invalid",
  /** A pack has no version in force on the date asked. */
  "rule_pack_not_in_force",
] as const;
export type RegcalcReason = (typeof REGCALC_REASONS)[number];

export class RegcalcError extends Error {
  /** The HTTP status of the validation problem a product returns for it. */
  readonly status = 422 as const;
  constructor(
    readonly reason: RegcalcReason,
    message: string,
    readonly field?: string,
  ) {
    super(field ? `${field}: ${message}` : message);
    this.name = "RegcalcError";
  }
  static input(field: string, message: string): RegcalcError {
    return new RegcalcError("input_invalid", message, field);
  }
  static range(field: string, message: string): RegcalcError {
    return new RegcalcError("input_out_of_range", message, field);
  }
}

/** Whether `e` is a refusal of this package. */
export const isRegcalcError = (e: unknown): e is RegcalcError => e instanceof RegcalcError;
