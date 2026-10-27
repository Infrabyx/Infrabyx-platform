// Pricing from the catalogue only (IPB-04 §04.3.3; `@IPB-04-AT-30`…`-32`; PL5 plan §5.8). Prices are
// facts of the billing engine (OH8): the pricing copy has no price field (`pricing_copy` is a strict
// schema, so a typed price is `IPB-CMS-001`), and every figure comes from
// `BILLING_PORT.getCatalogue` at render, cached for `web.pricing.catalogue_cache_seconds` (300) and
// dropped on `CatalogueChanged`. When the port is down, a catalogue up to 24 hours old may be shown;
// older, the page says "pricing temporarily unavailable" (`IPB-WEB-006`), never stale figures.
// GST: `exclusive_labelled` shows "₹4,999.00/month + 18% GST" and the total payable including GST;
// `inclusive` shows the inclusive figure. Integer paise only.
import { IpbError } from "@infrabyx/contracts/errors";
import type { BillingCataloguePort, Catalogue } from "@infrabyx/contracts/ports";
import { formatAmountInr } from "@infrabyx/ui/i18n";
import { z } from "zod";
import type { LintFinding } from "./lint.js";

export const CATALOGUE_STALE_LIMIT_MS = 24 * 3_600_000;
export type GstDisplay = "exclusive_labelled" | "inclusive";
type Period = "month" | "year" | "one_time";

const text = (max: number) => z.string().trim().min(1).max(max);

/** The pricing copy body: presentation only, never a figure (IPB-04-34). */
export const PricingCopy = z
  .object({
    plans: z
      .array(
        z
          .object({
            plan_key: z.string().regex(/^[a-z][a-z0-9_]{1,40}$/),
            display_name: text(80).optional(),
            tagline: text(160).optional(),
            bullets: z
              .array(z.object({ feature_key: z.string(), text: text(120) }).strict())
              .default([]),
            most_popular: z.boolean().default(false),
            cta: z.object({ label: text(40), href: z.string().regex(/^\/[^\s]*$/) }).strict(),
            trial_text: text(120).optional(),
          })
          .strict(),
      )
      .min(1),
    banners: z.array(z.object({ coupon_key: z.string(), text: text(160) }).strict()).default([]),
    /** Which price periods the table shows; all by default. Hiding a mandatory fee is drip pricing. */
    price_periods_shown: z
      .array(z.enum(["month", "year", "one_time"]))
      .default(["month", "year", "one_time"]),
    countdown: z.object({ coupon_key: z.string() }).strict().optional(),
    contact_sales: z
      .object({ above_seats: z.number().int().positive(), label: text(40) })
      .strict()
      .optional(),
  })
  .strict();
export type PricingCopy = z.infer<typeof PricingCopy>;

const mulBp = (minor: number, bp: number) =>
  Number((BigInt(minor) * BigInt(10_000 + bp) + 5_000n) / 10_000n);
const periodLabel: Record<Period, string> = {
  month: "/month",
  year: "/year",
  one_time: " one-time",
};
const pct = (bp: number) => `${bp % 100 === 0 ? bp / 100 : (bp / 100).toFixed(2)}%`;

export interface PriceView {
  period: Period;
  currency: string;
  /** "₹4,999.00/month + 18% GST" or "₹5,898.82/month incl. GST". */
  label: string;
  /** The total payable including GST, shown before any checkout hand-off (IPB-04-35). */
  totalPayable: string;
}

export interface PricingView {
  plans: {
    planKey: string;
    name: string;
    tagline: string | null;
    bullets: string[];
    mostPopular: boolean;
    cta: { label: string; href: string };
    trialDays: number | null;
    prices: PriceView[];
  }[];
  banners: string[];
  /** Payment & Subscription Terms and Refund & Cancellation, linked above the fold (IPB-04-39). */
  legalLinks: { key: "payment_terms" | "refund"; href: string }[];
  catalogueVersion: string;
  asOf: string;
}

export function priceView(
  p: Catalogue["plans"][number]["prices"][number],
  gst: GstDisplay,
): PriceView {
  const fmt = (minor: number) =>
    p.currency === "INR" ? formatAmountInr(minor) : `${p.currency} ${(minor / 100).toFixed(2)}`;
  const rate = p.gst_rate_bp ?? 0;
  const exclusive = p.tax_inclusive
    ? Number(
        (BigInt(p.amount_minor) * 10_000n + BigInt(10_000 + rate) / 2n) / BigInt(10_000 + rate),
      )
    : p.amount_minor;
  const inclusive = p.tax_inclusive ? p.amount_minor : mulBp(p.amount_minor, rate);
  const per = periodLabel[p.period];
  if (p.gst_rate_bp === null)
    return {
      period: p.period,
      currency: p.currency,
      label: `${fmt(p.amount_minor)}${per}`,
      totalPayable: `${fmt(p.amount_minor)}${per}`,
    };
  return {
    period: p.period,
    currency: p.currency,
    label:
      gst === "inclusive"
        ? `${fmt(inclusive)}${per} incl. GST`
        : `${fmt(exclusive)}${per} + ${pct(rate)} GST`,
    totalPayable: `${fmt(inclusive)}${per} incl. ${pct(rate)} GST`,
  };
}

export class PricingService {
  private readonly cache = new Map<string, { catalogue: Catalogue; at: number }>();
  constructor(
    private readonly o: {
      billing: BillingCataloguePort;
      product: string;
      cacheSeconds?: number;
      now?: () => number;
      legalHref?: (key: "payment_terms" | "refund") => string;
    },
  ) {}

  private now(): number {
    return this.o.now?.() ?? Date.now();
  }

  /** Drop the cache for a pack (on `CatalogueChanged`, IPB-04-33). */
  invalidate(packId?: string): void {
    if (!packId) this.cache.clear();
    else this.cache.delete(`${this.o.product}|${packId}`);
  }

  /** The catalogue: cached ≤5 minutes; on failure, a copy up to 24 hours old; else `IPB-WEB-006`. */
  async catalogue(packId: string | null): Promise<Catalogue> {
    const key = `${this.o.product}|${packId}`;
    const hit = this.cache.get(key);
    const ttl = Math.min(this.o.cacheSeconds ?? 300, 300) * 1000;
    if (hit && this.now() - hit.at < ttl) return hit.catalogue;
    try {
      const catalogue = await this.o.billing.getCatalogue(this.o.product, packId);
      this.cache.set(key, { catalogue, at: this.now() });
      return catalogue;
    } catch (e) {
      if (hit && this.now() - Date.parse(hit.catalogue.fetched_at) < CATALOGUE_STALE_LIMIT_MS)
        return hit.catalogue;
      throw new IpbError("IPB-WEB-006", { detail: "pricing temporarily unavailable", cause: e });
    }
  }

  /** The pricing table for a pack: catalogue figures with the copy overlay (`@IPB-04-AT-30`, `-31`). */
  async view(packId: string, copyBody: unknown, gst: GstDisplay): Promise<PricingView> {
    const copy = PricingCopy.parse(copyBody);
    const cat = await this.catalogue(packId);
    const now = this.now();
    const active = new Set(
      cat.coupons.filter((c) => !c.ends_at || Date.parse(c.ends_at) > now).map((c) => c.coupon_key),
    );
    const plans = copy.plans
      .map((cp) => {
        const plan = cat.plans.find((p) => p.plan_key === cp.plan_key);
        if (!plan) return null;
        return {
          planKey: plan.plan_key,
          name: cp.display_name ?? plan.name,
          tagline: cp.tagline ?? null,
          // A bullet whose feature left the catalogue disappears with it (IPB-04-34).
          bullets: cp.bullets
            .filter((b) => plan.features.includes(b.feature_key))
            .map((b) => b.text),
          mostPopular: cp.most_popular,
          cta: cp.cta,
          trialDays: plan.trial_days,
          prices: plan.prices
            .filter((p) => copy.price_periods_shown.includes(p.period))
            .map((p) => priceView(p, gst)),
        };
      })
      .filter((p): p is NonNullable<typeof p> => p !== null);
    const href = this.o.legalHref ?? ((k: string) => `/legal/${k.replace(/_/g, "-")}`);
    return {
      plans,
      banners: copy.banners.filter((b) => active.has(b.coupon_key)).map((b) => b.text),
      legalLinks: [
        { key: "payment_terms", href: href("payment_terms") },
        { key: "refund", href: href("refund") },
      ],
      catalogueVersion: cat.catalogue_version,
      asOf: cat.fetched_at,
    };
  }

  /**
   * The catalogue-aware dark-pattern lint for pricing copy (IPB-04-36, `@IPB-04-AT-32`): hiding a
   * mandatory one-time fee is drip pricing; a countdown needs a coupon with a real end date.
   */
  async lintCopy(packId: string, copyBody: unknown): Promise<LintFinding[]> {
    const copy = PricingCopy.parse(copyBody);
    const cat = await this.catalogue(packId);
    const findings: LintFinding[] = [];
    for (const cp of copy.plans) {
      const plan = cat.plans.find((p) => p.plan_key === cp.plan_key);
      if (!plan) {
        findings.push({
          code: "IPB-CMS-003",
          path: `plans.${cp.plan_key}`,
          message: "plan not in the catalogue",
        });
        continue;
      }
      for (const p of plan.prices)
        if (!copy.price_periods_shown.includes(p.period))
          findings.push({
            code: "IPB-CMS-015",
            path: `plans.${cp.plan_key}`,
            message: `drip pricing: the ${p.period.replace("_", "-")} price is hidden from the table`,
          });
    }
    if (copy.countdown) {
      const c = cat.coupons.find((x) => x.coupon_key === copy.countdown!.coupon_key);
      if (!c?.ends_at)
        findings.push({
          code: "IPB-CMS-015",
          path: "countdown",
          message: "false urgency: a countdown needs a coupon with an end date",
        });
    }
    return findings;
  }
}
