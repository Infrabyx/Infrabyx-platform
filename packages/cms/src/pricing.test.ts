// Pricing from the catalogue (IPB-04 §04.3.3; PL5 plan §5.8).
import { describe, expect, it } from "vitest";
import { FakeCatalogue, fixtureCatalogue } from "@infrabyx/testing";
import { citeAs, parseBody, priceView, PricingService } from "./index.js";

const PACK = "brd_01JB0000000000000000000001";
const copy = {
  plans: [
    {
      plan_key: "fixture_basic",
      bullets: [
        { feature_key: "fixture.feature_a", text: "Feature A" },
        { feature_key: "gone", text: "Gone" },
      ],
      cta: { label: "Start", href: "/signup" },
    },
    { plan_key: "fixture_plus", most_popular: true, cta: { label: "Start", href: "/signup" } },
  ],
  banners: [{ coupon_key: "launch", text: "Launch offer" }],
};

describe("@IPB-04-AT-30 prices from the catalogue only", () => {
  it("the pricing copy has no price field", () => {
    const p = parseBody("pricing_copy", { ...copy, plans: [{ ...copy.plans[0], price: 4999 }] });
    expect(p.issues[0]?.path).toBe("body.plans.0");
  });

  it("shows a new catalogue price after invalidation, drops removed features and expired coupons", async () => {
    let now = Date.parse("2026-10-27T10:00:00Z");
    const c = fixtureCatalogue();
    c.coupons = [{ coupon_key: "launch", label: "Launch", ends_at: "2026-10-27T12:00:00Z" }];
    const billing = new FakeCatalogue(c);
    const svc = new PricingService({ billing, product: "OH", now: () => now });
    const v1 = await svc.view(PACK, copy, "exclusive_labelled");
    expect(v1.plans[0]).toMatchObject({
      bullets: ["Feature A"],
      prices: [{ label: "₹100.00/month + 18% GST" }],
    });
    expect(v1.banners).toEqual(["Launch offer"]);
    billing.catalogue!.plans[0]!.prices[0]!.amount_minor = 150_00;
    expect((await svc.view(PACK, copy, "exclusive_labelled")).plans[0]!.prices[0]!.label).toBe(
      "₹100.00/month + 18% GST",
    );
    svc.invalidate(PACK);
    expect((await svc.view(PACK, copy, "exclusive_labelled")).plans[0]!.prices[0]!.label).toBe(
      "₹150.00/month + 18% GST",
    );
    now = Date.parse("2026-10-27T13:00:00Z");
    expect((await svc.view(PACK, copy, "exclusive_labelled")).banners).toEqual([]);
  });

  it("serves a catalogue up to 24 hours old when the port is down, and IPB-WEB-006 after that", async () => {
    let now = Date.now();
    const billing = new FakeCatalogue();
    const svc = new PricingService({ billing, product: "OH", now: () => now });
    await svc.catalogue(PACK);
    billing.catalogue = null;
    now += 10 * 60_000;
    expect((await svc.catalogue(PACK)).catalogue_version).toBe("fixture-1");
    now += 25 * 3_600_000;
    await expect(svc.catalogue(PACK)).rejects.toMatchObject({ code: "IPB-WEB-006" });
  });
});

describe("@IPB-04-AT-31 GST labels", () => {
  it("labels exclusive and inclusive prices with the rate and the total payable", () => {
    const p = {
      currency: "INR",
      amount_minor: 4999_00,
      period: "month" as const,
      gst_rate_bp: 1800,
      tax_inclusive: false,
    };
    expect(priceView(p, "exclusive_labelled")).toEqual({
      period: "month",
      currency: "INR",
      label: "₹4,999.00/month + 18% GST",
      totalPayable: "₹5,898.82/month incl. 18% GST",
    });
    expect(priceView(p, "inclusive").label).toBe("₹5,898.82/month incl. GST");
    expect(
      priceView({ ...p, amount_minor: 5898_82, tax_inclusive: true }, "exclusive_labelled").label,
    ).toBe("₹4,999.00/month + 18% GST");
  });
});

describe("@IPB-04-AT-32 dark-pattern guard (drip pricing, false urgency)", () => {
  it("refuses hiding a mandatory one-time fee and a countdown without an end date", async () => {
    const c = fixtureCatalogue();
    c.plans[0]!.prices.push({
      currency: "INR",
      amount_minor: 500_00,
      period: "one_time",
      gst_rate_bp: 1800,
      tax_inclusive: false,
    });
    c.coupons = [{ coupon_key: "forever", label: "x", ends_at: null }];
    const svc = new PricingService({ billing: new FakeCatalogue(c), product: "OH" });
    const findings = await svc.lintCopy(PACK, {
      ...copy,
      price_periods_shown: ["month"],
      countdown: { coupon_key: "forever" },
    });
    expect(findings.map((f) => f.code)).toEqual(["IPB-CMS-015", "IPB-CMS-015"]);
    expect(await svc.lintCopy(PACK, copy)).toEqual([]);
  });
});

describe("cite-as (IPB-04-58)", () => {
  it("includes the version and the stable URL", () => {
    expect(
      citeAs({
        author: "Example Group",
        year: "2026",
        title: "A report",
        version: "3",
        url: "https://g.example.org/resources/report/a",
      }),
    ).toBe("Example Group. (2026). A report (v3). https://g.example.org/resources/report/a");
  });
});
