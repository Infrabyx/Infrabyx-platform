// Contrast guard (IPB-04-24, IPB-07-32, IPB-06-59; `@IPB-04-AT-23`, `@IPB-06-AT-11`,
// `@IPB-07-AT-24`). A pack's colours pass only when, in the light scheme as set:
//   - text (`on_surface`) on the surface meets `brand.contrast.min_text` (4.5:1);
//   - the primary and the accent stand out from the surface by `brand.contrast.min_ui` (3:1);
//   - text on the primary and on the accent can reach the text minimum with the computed
//     white-or-dark on-colour (derived, never set);
// and every derived theme (dark, both high-contrast themes) passes its declared pairs. Each
// failure names the pair, the scheme, the ratio and the nearest compliant colour.
import {
  buildTheme,
  contrastFailures,
  contrastRatio,
  formatRatio,
  nearestCompliant,
  onColour,
  THEMES,
  type Product,
  type TokenSet,
} from "@infrabyx/ui/tokens";
import type { BrandPackBody } from "./shape.js";

export const CONTRAST_FLOOR = { text: 4.5, ui: 3 } as const;

export interface ContrastFailure {
  pair: string;
  scheme: string;
  ratio: number;
  min: number;
  /** The nearest colour that would pass, for the person to try. */
  suggestion: string | null;
}

export interface ContrastGuardResult {
  passed: boolean;
  failures: ContrastFailure[];
  /** The four theme previews that must render before Save (IPB-07-32). */
  previews: Record<(typeof THEMES)[number], TokenSet>;
  /** The computed on-primary and on-accent text colours in the light scheme. */
  derived: { onPrimary: string; onAccent: string };
}

export function contrastGuard(
  product: Product,
  colour: BrandPackBody["tokens"]["colour"],
  o: { minText?: number; minUi?: number } = {},
): ContrastGuardResult {
  // `brand.contrast.min_*` may only be raised (IPB-04 §04.5).
  const minText = Math.max(o.minText ?? CONTRAST_FLOOR.text, CONTRAST_FLOOR.text);
  const minUi = Math.max(o.minUi ?? CONTRAST_FLOOR.ui, CONTRAST_FLOOR.ui);
  const { primary, accent, surface, on_surface: onSurface } = colour;
  const failures: ContrastFailure[] = [];
  const check = (pair: string, fg: string, bg: string, min: number, fix: () => string | null) => {
    const ratio = contrastRatio(fg, bg);
    if (ratio < min)
      failures.push({
        pair,
        scheme: "light",
        ratio: Number(formatRatio(ratio)),
        min,
        suggestion: fix(),
      });
  };

  check("on_surface/surface", onSurface, surface, minText, () =>
    nearestCompliant(onSurface, surface, minText),
  );
  check("primary/surface", primary, surface, minUi, () =>
    nearestCompliant(primary, surface, minUi),
  );
  check("accent/surface", accent, surface, minUi, () => nearestCompliant(accent, surface, minUi));
  const onPrimary = onColour(primary, minText);
  const onAccent = onColour(accent, minText);
  check("on_primary/primary", onPrimary, primary, minText, () => null);
  check("on_accent/accent", onAccent, accent, minText, () => null);

  const previews = Object.fromEntries(
    THEMES.map((t) => [t, buildTheme(product, t, { primary, accent })]),
  ) as ContrastGuardResult["previews"];
  for (const t of THEMES) {
    if (t === "light") continue;
    for (const f of contrastFailures(previews[t]))
      failures.push({
        pair: `${f.fg}/${f.bg}`,
        scheme: t,
        ratio: Number(formatRatio(f.ratio)),
        min: f.min,
        suggestion: null,
      });
  }
  return { passed: failures.length === 0, failures, previews, derived: { onPrimary, onAccent } };
}

/** The IPB-06 §06.6.3 message for the first failure. */
export function contrastMessage(f: ContrastFailure): string {
  const base = `This colour pair (${f.pair}, ${f.scheme}) has contrast ${f.ratio.toFixed(2)}:1; at least ${f.min}:1 is required.`;
  return f.suggestion ? `${base} Try ${f.suggestion}.` : base;
}
