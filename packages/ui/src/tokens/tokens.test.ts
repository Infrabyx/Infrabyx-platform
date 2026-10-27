// @IPB-06-AT-10: every declared pair meets its floor in all four themes, for every product.
import { describe, expect, it } from "vitest";
import {
  buildTheme,
  contrastFailures,
  contrastRatio,
  nearestCompliant,
  onColour,
  PRODUCTS,
  THEMES,
  themeCss,
} from "./index.js";

describe("@IPB-06-AT-10 four themes meet contrast", () => {
  for (const product of PRODUCTS)
    for (const theme of THEMES)
      it(`${product} ${theme}: text ≥4.5:1 (≥7:1 high contrast), non-text ≥3:1`, () => {
        expect(contrastFailures(buildTheme(product, theme))).toEqual([]);
      });
});

describe("contrast maths", () => {
  it("matches the WCAG reference values", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
    expect(contrastRatio("#767676", "#FFFFFF")).toBeCloseTo(4.54, 2);
    expect(contrastRatio("#FFFFFF", "#FFFFFF")).toBe(1);
  });

  it("suggests the nearest colour that passes, keeping the hue", () => {
    // @IPB-07-AT-24 example: #FFD54F as a primary on white.
    const fixed = nearestCompliant("#FFD54F", "#FFFFFF", 4.5);
    expect(contrastRatio(fixed, "#FFFFFF")).toBeGreaterThanOrEqual(4.5);
    expect(fixed).not.toBe("#000000");
    // On-primary for #FFD54F is dark text that meets 4.5:1.
    expect(contrastRatio(onColour("#FFD54F"), "#FFD54F")).toBeGreaterThanOrEqual(4.5);
  });

  it("moves a brand colour only when it fails (the Udofin amber needs dark text)", () => {
    const udf = buildTheme("UDF", "light");
    expect(udf.colours.primary).toBe("#4338CA");
    expect(udf.colours["on-accent"]).not.toBe("#FFFFFF");
    // Navy LawDocs primary is lightened for the dark theme so links stay readable.
    expect(buildTheme("LD", "dark").colours.primary).not.toBe("#0B2545");
  });
});

describe("CSS", () => {
  it("emits every theme, the OS preferences and reduced motion", () => {
    const css = themeCss("GRP");
    for (const t of THEMES) expect(css).toContain(`[data-theme="${t}"]`);
    expect(css).toContain("prefers-color-scheme: dark");
    expect(css).toContain("prefers-contrast: more");
    expect(css).toContain("prefers-reduced-motion: reduce");
    expect(css).toContain("--color-focus:");
    expect(css).not.toMatch(/https?:\/\//);
  });
});
