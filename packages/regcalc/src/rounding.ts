// The rounding a loan system applies (owner answer 3, R1-D-301): the product passes its rule; the
// default is half-up to the rupee, the last instalment absorbing the difference.
import { z } from "zod";
import { D, type Dec } from "./decimal.js";

export const ROUNDING_MODES = ["half_up", "half_even"] as const;
export type RoundingMode = (typeof ROUNDING_MODES)[number];

export const RoundingRule = z
  .object({
    /** `rupee` (0 places), `paisa` (2 places), or `none` (the unrounded figure, as a model). */
    to: z.enum(["rupee", "paisa", "none"]),
    mode: z.enum(ROUNDING_MODES),
  })
  .strict();
export type RoundingRule = z.infer<typeof RoundingRule>;

/** Half-up to the rupee (owner answer 3). */
export const DEFAULT_ROUNDING: RoundingRule = Object.freeze({ to: "rupee", mode: "half_up" });

/** No rounding: the model's own unrounded figures (the owner's workbooks keep them). */
export const NO_ROUNDING: RoundingRule = Object.freeze({ to: "none", mode: "half_up" });

/** `x` rounded by `rule`. */
export function roundBy(x: Dec, rule: RoundingRule): Dec {
  if (rule.to === "none") return x;
  const dp = rule.to === "rupee" ? 0 : 2;
  return x.toDecimalPlaces(dp, rule.mode === "half_up" ? D.ROUND_HALF_UP : D.ROUND_HALF_EVEN);
}
