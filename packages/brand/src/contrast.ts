// Contrast guard (IPB-04-24, IPB-07-32, IPB-06-59; `@IPB-04-AT-23`, `@IPB-06-AT-11`,
// `@IPB-07-AT-24`), with the owner's role rule (PL5-D-05, OWNER-QUESTIONS #52). Each colour is
// checked against the roles it is used in, in the light scheme as set:
//   - text (`on_surface`) on the surface meets `brand.contrast.min_text` (4.5:1);
//   - the primary keeps the strict rule: it stands out from the surface by `brand.contrast.min_ui`
//     (3:1, its icon and border uses) and text on it meets the text minimum (its fill use);
//   - the accent may be lighter, but only as a filled background (badges, highlights, chart fills,
//     decorative bands) with text on it at the text minimum. On a light surface it is never text,
//     an icon, a border or a focus ring; on a dark surface those uses meet their minimums;
//   - text on a fill is the computed white-or-dark on-colour (derived, never set);
// and every derived theme (dark, both high-contrast themes) passes its declared pairs. Each failure
// names the pair, the role, the scheme, the ratio and, where a colour change fixes the use, the
// nearest compliant colour.
import {
  buildTheme,
  contrastFailures,
  contrastRatio,
  formatRatio,
  luminance,
  nearestCompliant,
  onColour,
  THEMES,
  type Product,
  type TokenSet,
} from "@infrabyx/ui/tokens";
import type { BrandPackBody } from "./shape.js";

export const CONTRAST_FLOOR = { text: 4.5, ui: 3 } as const;

/** The uses a brand colour can have. `fill` is a background that carries text. */
export const COLOUR_ROLES = ["fill", "text", "icon", "border", "focus"] as const;
export type ColourRole = (typeof COLOUR_ROLES)[number];

/**
 * The uses the platform's components make of each colour. The primary's strict rule is always
 * applied (fill and the 3:1 icon and border floor); a product whose own components use a colour
 * another way declares those extra uses, and the guard checks them too.
 */
export const DEFAULT_ROLES: Readonly<Record<"primary" | "accent", readonly ColourRole[]>> = {
  // The primary's 3:1 non-text floor against the surface is checked as its border use.
  primary: ["fill", "border"],
  accent: ["fill"],
};

/** Uses an accent may never have on a light surface (PL5-D-05). */
const ACCENT_FILL_ONLY_ON_LIGHT: readonly ColourRole[] = ["text", "icon", "border", "focus"];

export interface ContrastFailure {
  pair: string;
  scheme: string;
  ratio: number;
  min: number;
  /** The nearest colour that would pass, for the person to try; null when no colour change helps. */
  suggestion: string | null;
  /** The use that failed; absent for the derived-theme pairs. */
  role?: ColourRole;
  reason?: "contrast" | "role_not_permitted";
}

export interface ContrastGuardResult {
  passed: boolean;
  failures: ContrastFailure[];
  /** The four theme previews that must render before Save (IPB-07-32). */
  previews: Record<(typeof THEMES)[number], TokenSet>;
  /** The computed on-primary and on-accent text colours in the light scheme. */
  derived: { onPrimary: string; onAccent: string };
}

export interface ContrastGuardOptions {
  minText?: number;
  minUi?: number;
  /** Extra uses beyond `DEFAULT_ROLES`; the defaults are always checked. */
  roles?: Partial<Record<"primary" | "accent", readonly ColourRole[]>>;
}

/** A surface is light when dark text reads better on it than white text. */
export const isLightSurface = (surface: string) => luminance(surface) > 0.18;

export function contrastGuard(
  product: Product,
  colour: BrandPackBody["tokens"]["colour"],
  o: ContrastGuardOptions = {},
): ContrastGuardResult {
  // `brand.contrast.min_*` may only be raised (IPB-04 §04.5).
  const minText = Math.max(o.minText ?? CONTRAST_FLOOR.text, CONTRAST_FLOOR.text);
  const minUi = Math.max(o.minUi ?? CONTRAST_FLOOR.ui, CONTRAST_FLOOR.ui);
  const { primary, accent, surface, on_surface: onSurface } = colour;
  const light = isLightSurface(surface);
  const failures: ContrastFailure[] = [];
  const push = (f: Omit<ContrastFailure, "scheme">) => failures.push({ scheme: "light", ...f });

  const textRatio = contrastRatio(onSurface, surface);
  if (textRatio < minText)
    push({
      pair: "on_surface/surface",
      ratio: Number(formatRatio(textRatio)),
      min: minText,
      suggestion: nearestCompliant(onSurface, surface, minText),
      role: "text",
      reason: "contrast",
    });

  const checkUse = (name: "primary" | "accent", value: string, role: ColourRole) => {
    if (role === "fill") {
      const on = onColour(value, minText);
      const ratio = contrastRatio(on, value);
      // Move the fill away from dark text until dark text reads on it.
      if (ratio < minText)
        push({
          pair: `on_${name}/${name}`,
          ratio: Number(formatRatio(ratio)),
          min: minText,
          suggestion: nearestCompliant(value, "#111827", minText),
          role,
          reason: "contrast",
        });
      return;
    }
    const min = role === "text" ? minText : minUi;
    const ratio = contrastRatio(value, surface);
    if (name === "accent" && light && ACCENT_FILL_ONLY_ON_LIGHT.includes(role)) {
      push({
        pair: `${name}/surface`,
        ratio: Number(formatRatio(ratio)),
        min,
        suggestion: null,
        role,
        reason: "role_not_permitted",
      });
      return;
    }
    if (ratio < min)
      push({
        pair: `${name}/surface`,
        ratio: Number(formatRatio(ratio)),
        min,
        suggestion: nearestCompliant(value, surface, min),
        role,
        reason: "contrast",
      });
  };
  const rolesOf = (name: "primary" | "accent") =>
    COLOUR_ROLES.filter((r) => DEFAULT_ROLES[name].includes(r) || o.roles?.[name]?.includes(r));
  for (const role of rolesOf("primary")) checkUse("primary", primary, role);
  for (const role of rolesOf("accent")) checkUse("accent", accent, role);

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
  return {
    passed: failures.length === 0,
    failures,
    previews,
    derived: { onPrimary: onColour(primary, minText), onAccent: onColour(accent, minText) },
  };
}

/** The IPB-06 §06.6.3 message for a failure. */
export function contrastMessage(f: ContrastFailure): string {
  if (f.reason === "role_not_permitted")
    return `An accent colour is used only as a filled background on a light surface, never as ${f.role === "focus" ? "a focus ring" : f.role === "icon" ? "an icon" : f.role === "border" ? "a border" : "text"}. Use the primary colour for this.`;
  const base = `This colour pair (${f.pair}, ${f.scheme}) has contrast ${f.ratio.toFixed(2)}:1; at least ${f.min}:1 is required.`;
  return f.suggestion ? `${base} Try ${f.suggestion}.` : base;
}
