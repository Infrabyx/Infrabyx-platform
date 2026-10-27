// Product autonomy ceilings (IPB-03 §03.4.11; owner decision O-4; PL4 plan §8.4). Platform constants:
// products cannot raise them. Udofin: borrowers L1, staff L2 (owner). No product reaches L4.
import type { AutonomyLevel, VidhiProduct } from "@infrabyx/contracts/vidhi";

export type Audience = "staff" | "borrower" | "customer" | "any";

interface CeilingRule {
  /** The ceiling for this audience (or for every audience with `any`). */
  base: Partial<Record<Audience, AutonomyLevel>>;
  /** Skills whose key matches get this higher (never above L3) ceiling. */
  raised?: { match: RegExp; level: AutonomyLevel };
}

const RULES: Record<VidhiProduct, CeilingRule> = {
  UDF: { base: { borrower: "L1", customer: "L1", staff: "L2", any: "L1" } },
  EQ: {
    base: { any: "L2" },
    raised: { match: /(schedul|reminder)/, level: "L3" },
  },
  FBX: {
    base: { any: "L2" },
    raised: { match: /(data_check|classification|narrative)/, level: "L3" },
  },
  LD: {
    base: { any: "L2" },
    raised: {
      match: /(summar|draft|remind|deadline|extract|compare|explain|_qa|notebook)/,
      level: "L3",
    },
  },
  LDC: {
    base: { any: "L2" },
    raised: { match: /(extract|summary|draft|remind|digest|narrative|redline|_qa)/, level: "L3" },
  },
  OH: {
    base: { any: "L2" },
    raised: {
      match: /(triage|summary|draft|remind|answer|lookup|narrative|checklist|notes)/,
      level: "L3",
    },
  },
  PLATFORM: { base: { any: "L2" } },
};

export const PRODUCT_CEILINGS: Readonly<Record<VidhiProduct, Readonly<CeilingRule>>> =
  Object.freeze(
    Object.fromEntries(
      Object.entries(RULES).map(([k, v]) => [
        k,
        Object.freeze({ ...v, base: Object.freeze(v.base) }),
      ]),
    ) as Record<VidhiProduct, CeilingRule>,
  );

/** The product ceiling for a skill and the audience it serves. */
export function productCeiling(
  product: VidhiProduct,
  audience: Audience,
  skillKey: string,
): AutonomyLevel {
  const rule = PRODUCT_CEILINGS[product];
  const base = rule.base[audience] ?? rule.base.any ?? "L0";
  // Borrower- and customer-facing skills never get the raised staff ceiling.
  if (
    rule.raised &&
    (audience === "staff" || audience === "any") &&
    rule.raised.match.test(skillKey)
  )
    return rule.raised.level;
  return base;
}
