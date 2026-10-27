import { describe, expect, it } from "vitest";
import {
  evaluateLighthouse,
  formatLighthouseVerdict,
  type LighthouseResult,
} from "./lighthouse.js";

function lhr(score: number, metrics: Record<string, number> = {}): LighthouseResult {
  return {
    finalDisplayedUrl: "http://localhost:3000/pricing",
    categories: {
      accessibility: {
        score,
        auditRefs: [
          { id: "color-contrast", weight: 7 },
          { id: "link-name", weight: 7 },
          { id: "image-alt", weight: 10 },
          { id: "manual-check", weight: 0 },
        ],
      },
    },
    audits: {
      "color-contrast": {
        title: "Background and foreground colors have a sufficient contrast ratio",
        score: 0,
      },
      "link-name": { title: "Links have a discernible name", score: 1 },
      "image-alt": { title: "Image elements have [alt] attributes", score: 0 },
      "manual-check": { title: "Manual", score: 0 },
      ...Object.fromEntries(
        Object.entries(metrics).map(([id, v]) => [id, { title: id, score: 1, numericValue: v }]),
      ),
    },
  };
}

describe("@IPB-06-AT-02 Lighthouse accessibility threshold", () => {
  it("blocks a page scoring 92 and lists the failing audits", () => {
    const v = evaluateLighthouse(lhr(0.92));
    expect(v).toMatchObject({ ok: false, score: 92, min: 95 });
    expect(v.failingAudits.map((a) => a.id)).toEqual(["image-alt", "color-contrast"]);
    expect(formatLighthouseVerdict(v)).toContain(
      "FAIL http://localhost:3000/pricing: accessibility 92 (minimum 95)",
    );
  });

  it("passes at 95 within budgets, and the minimum cannot be lowered", () => {
    expect(
      evaluateLighthouse(
        lhr(0.95, { "largest-contentful-paint": 1800, "cumulative-layout-shift": 0.02 }),
      ).ok,
    ).toBe(true);
    expect(evaluateLighthouse(lhr(0.96), { min: 98 }).ok).toBe(false);
    expect(() => evaluateLighthouse(lhr(0.99), { min: 90 })).toThrow(/may not be lowered below 95/);
  });

  it("fails over the IPB-04 budgets, using total blocking time where INP is not measured", () => {
    const v = evaluateLighthouse(
      lhr(1, { "largest-contentful-paint": 3100, "total-blocking-time": 250 }),
    );
    expect(v.ok).toBe(false);
    expect(v.budgetFailures).toEqual([
      { metric: "lcp_ms", value: 3100, budget: 2500 },
      { metric: "inp_ms", value: 250, budget: 200 },
    ]);
  });
});
