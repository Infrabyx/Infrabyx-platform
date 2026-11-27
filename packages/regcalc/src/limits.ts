// The lending limits of the Credit Facilities Directions as a parameter pack (R1-regcalc plan §1
// and §2; owner answer 5, R1-D-301): versioned data with citations and an effective date, shipped
// in the package. A product may pass a stricter pack (a Board-approved internal limit); a pack
// looser than the regulatory floor is refused `rule_pack_invalid`. Oracle: LEND-M01, sheet Setup.
import { z } from "zod";
import { D, type Dec } from "./decimal.js";
import { RegcalcError } from "./errors.js";

export const CFD = "RBI (NBFCs – Credit Facilities) Directions, 2025";

const fraction = z.string().regex(/^(0|1)(\.[0-9]+)?$/);
const amount = z.string().regex(/^[0-9]+(\.[0-9]+)?$/);

export const LendingLimitsPack = z
  .object({
    id: z.string().min(1).max(64),
    version: z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+$/),
    effectiveFrom: z.iso.date(),
    /** Amber from this share of a limit (Board-approved). */
    internalTrigger: fraction,
    dlg: z.object({ cap: fraction, invokeWithinDays: z.number().int().positive() }).strict(),
    gold: z
      .object({
        slabs: z
          .array(z.object({ upTo: amount.nullable(), maxLtv: fraction }).strict())
          .min(1)
          .max(10),
        /** The Board's internal LTV limit for income-generating loans (null: none set). */
        incomeGeneratingMaxLtv: fraction.nullable(),
      })
      .strict(),
    shares: z
      .object({
        /** Whether the share-loan conditions apply (assets of ₹100 crore and above). */
        apply: z.boolean(),
        maxLtv: fraction,
        cureWorkingDays: z.number().int().positive(),
      })
      .strict(),
    microfinance: z
      .object({
        incomeUpTo: amount,
        /** The Board's limit on monthly obligations as a share of monthly income. */
        obligationsMax: fraction,
      })
      .strict(),
    citations: z.record(z.string(), z.string()),
  })
  .strict();
export type LendingLimitsPack = z.infer<typeof LendingLimitsPack>;

/** The regulatory floor (Credit Facilities Directions 2025; the defaults on LEND-M01's Setup). */
export const LENDING_LIMITS_FLOOR = Object.freeze({
  dlgCap: "0.05",
  invokeWithinDays: 120,
  goldSlabs: [
    { upTo: "250000", maxLtv: "0.85" },
    { upTo: "500000", maxLtv: "0.8" },
    { upTo: null, maxLtv: "0.75" },
  ],
  sharesMaxLtv: "0.5",
  cureWorkingDays: 7,
  microfinanceIncomeUpTo: "300000",
  microfinanceObligationsMax: "0.5",
});

/** The default pack: the floor, with the model's Board choices (trigger 95 %, income-generating 75 %). */
export const DEFAULT_LENDING_LIMITS: LendingLimitsPack = Object.freeze({
  id: "rbi-credit-facilities-2025",
  version: "1.0.0",
  effectiveFrom: "2025-11-28",
  internalTrigger: "0.95",
  dlg: {
    cap: LENDING_LIMITS_FLOOR.dlgCap,
    invokeWithinDays: LENDING_LIMITS_FLOOR.invokeWithinDays,
  },
  gold: {
    slabs: LENDING_LIMITS_FLOOR.goldSlabs.map((s) => ({ ...s })),
    incomeGeneratingMaxLtv: "0.75",
  },
  shares: {
    apply: true,
    maxLtv: LENDING_LIMITS_FLOOR.sharesMaxLtv,
    cureWorkingDays: LENDING_LIMITS_FLOOR.cureWorkingDays,
  },
  microfinance: {
    incomeUpTo: LENDING_LIMITS_FLOOR.microfinanceIncomeUpTo,
    obligationsMax: LENDING_LIMITS_FLOOR.microfinanceObligationsMax,
  },
  citations: {
    dlgCap: `${CFD}, para 24`,
    dlgInvocation: `${CFD}, para 27`,
    gold: `${CFD}, paras 43 and 44`,
    goldIncomeGenerating: `${CFD}, para 32 (Board-approved policy)`,
    shares: `${CFD}, para 106`,
    microfinanceIncome: `${CFD}, para 51`,
    microfinanceObligations: `${CFD}, paras 55 and 56`,
  },
}) as LendingLimitsPack;

const looser = (what: string) =>
  new RegcalcError("rule_pack_invalid", `${what} is looser than the regulatory floor`, "pack");

/** The checked pack: its schema, then never looser than the floor. */
export function lendingLimits(raw: unknown = DEFAULT_LENDING_LIMITS) {
  const r = LendingLimitsPack.safeParse(raw);
  if (!r.success) throw new RegcalcError("rule_pack_invalid", r.error.issues[0]!.message, "pack");
  const p = r.data;
  const f = LENDING_LIMITS_FLOOR;
  if (new D(p.dlg.cap).gt(f.dlgCap)) throw looser("dlg.cap");
  if (p.dlg.invokeWithinDays > f.invokeWithinDays) throw looser("dlg.invokeWithinDays");
  // Each slab: its LTV may not exceed the floor's LTV for any amount it covers.
  const slabs = p.gold.slabs.map((s) => ({
    upTo: s.upTo === null ? null : new D(s.upTo),
    maxLtv: new D(s.maxLtv),
  }));
  for (let i = 0; i < slabs.length; i++) {
    const s = slabs[i]!;
    if (i < slabs.length - 1 && s.upTo === null)
      throw new RegcalcError("rule_pack_invalid", "only the last gold slab is open-ended", "pack");
    if (i > 0 && s.upTo !== null && slabs[i - 1]!.upTo!.gte(s.upTo))
      throw new RegcalcError("rule_pack_invalid", "gold slabs must rise", "pack");
    // The floor falls as the total rises, so the slab is checked at the top of its range.
    const top = s.upTo ?? new D("1e30");
    if (s.maxLtv.gt(floorGoldLtv(top))) throw looser(`gold.slabs[${i}]`);
  }
  if (slabs.at(-1)!.upTo !== null)
    throw new RegcalcError("rule_pack_invalid", "the last gold slab must be open-ended", "pack");
  if (new D(p.shares.maxLtv).gt(f.sharesMaxLtv)) throw looser("shares.maxLtv");
  if (p.shares.cureWorkingDays > f.cureWorkingDays) throw looser("shares.cureWorkingDays");
  if (new D(p.microfinance.incomeUpTo).gt(f.microfinanceIncomeUpTo))
    throw looser("microfinance.incomeUpTo");
  if (new D(p.microfinance.obligationsMax).gt(f.microfinanceObligationsMax))
    throw looser("microfinance.obligationsMax");
  return {
    pack: p,
    trigger: new D(p.internalTrigger),
    slabs,
    incomeGeneratingMaxLtv:
      p.gold.incomeGeneratingMaxLtv === null ? null : new D(p.gold.incomeGeneratingMaxLtv),
  };
}

/** The floor's gold LTV for a borrower's total consumption loans of `total`. */
function floorGoldLtv(total: Dec): Dec {
  for (const s of LENDING_LIMITS_FLOOR.goldSlabs)
    if (s.upTo === null || total.lte(s.upTo)) return new D(s.maxLtv);
  return new D("0.75");
}

export const RAG = ["GREEN", "AMBER", "RED"] as const;
export type Rag = (typeof RAG)[number];

/**
 * RED above the limit, AMBER above the trigger share of it, GREEN otherwise (the model's rule). The
 * comparison is exact: the model's 1e-7 slack absorbs Excel's float noise, which decimals do not
 * have, so one paisa over a limit is RED here (R1-D-307).
 */
export function rag(x: Dec, limit: Dec, trigger: Dec): Rag {
  if (x.gt(limit)) return "RED";
  if (x.gt(trigger.times(limit))) return "AMBER";
  return "GREEN";
}

/** The worst of `statuses` (`null` for none). */
export function overall(statuses: readonly Rag[]): Rag | null {
  if (!statuses.length) return null;
  return statuses.includes("RED") ? "RED" : statuses.includes("AMBER") ? "AMBER" : "GREEN";
}
