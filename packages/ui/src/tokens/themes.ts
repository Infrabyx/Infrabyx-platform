// Design tokens per product and theme (IPB-07 §07.4.1, IPB-06-16, IPB-06-59). One identity per
// product (IPB-D-11); four themes — light, dark, high-contrast light and high-contrast dark. Brand
// colours are moved, never replaced, until every declared pair meets its floor: text 4.5:1 (7:1 in
// the high-contrast themes), large text and UI 3:1. Components use these names only (IPB-07-31).
import {
  CONTRAST_MIN,
  contrastRatio,
  nearestCompliant,
  onColour,
  parseHex,
  toHex,
} from "./contrast.js";

export const PRODUCTS = ["LD", "LDC", "EQ", "FBX", "UDF", "OH", "GRP"] as const;
export type Product = (typeof PRODUCTS)[number];
export const THEMES = ["light", "dark", "hc_light", "hc_dark"] as const;
export type Theme = (typeof THEMES)[number];

export interface ProductIdentity {
  primary: string;
  accent: string;
  body: string;
  heading: string;
  mono: string;
}

const SYSTEM_SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", sans-serif';
const SYSTEM_SERIF = 'Georgia, "Noto Serif", serif';
const SYSTEM_MONO = 'ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace';
const stack = (family: string, fallback: string) => `"${family}", ${fallback}`;

/** IPB-07 §07.4.1 (IPB-D-11). The group pack uses the Operations Hub identity. */
export const PRODUCT_IDENTITY: Readonly<Record<Product, ProductIdentity>> = {
  LD: {
    primary: "#0B2545",
    accent: "#E07A1F",
    body: stack("Inter", SYSTEM_SANS),
    heading: stack("Source Serif 4", SYSTEM_SERIF),
    mono: stack("JetBrains Mono", SYSTEM_MONO),
  },
  LDC: {
    primary: "#0F4C3A",
    accent: "#C9A227",
    body: stack("IBM Plex Sans", SYSTEM_SANS),
    heading: stack("IBM Plex Sans", SYSTEM_SANS),
    mono: stack("IBM Plex Mono", SYSTEM_MONO),
  },
  EQ: {
    primary: "#0E6E6E",
    accent: "#F26B5B",
    body: stack("Manrope", SYSTEM_SANS),
    heading: stack("Manrope", SYSTEM_SANS),
    mono: stack("JetBrains Mono", SYSTEM_MONO),
  },
  FBX: {
    primary: "#1E3A8A",
    accent: "#10B981",
    body: stack("Inter", SYSTEM_SANS),
    heading: stack("Inter", SYSTEM_SANS),
    mono: stack("JetBrains Mono", SYSTEM_MONO),
  },
  UDF: {
    primary: "#4338CA",
    accent: "#F59E0B",
    body: stack("Plus Jakarta Sans", SYSTEM_SANS),
    heading: stack("Plus Jakarta Sans", SYSTEM_SANS),
    mono: SYSTEM_MONO,
  },
  OH: {
    primary: "#1F2937",
    accent: "#2563EB",
    body: stack("Inter", SYSTEM_SANS),
    heading: stack("Inter", SYSTEM_SANS),
    mono: stack("JetBrains Mono", SYSTEM_MONO),
  },
  GRP: {
    primary: "#1F2937",
    accent: "#2563EB",
    body: stack("Inter", SYSTEM_SANS),
    heading: stack("Inter", SYSTEM_SANS),
    mono: stack("JetBrains Mono", SYSTEM_MONO),
  },
};

interface Neutrals {
  bg: string;
  surface: string;
  surfaceRaised: string;
  text: string;
  textMuted: string;
  border: string;
  borderStrong: string;
  focus: string;
  status: Record<"success" | "warning" | "danger" | "info", [fg: string, bg: string]>;
}

const NEUTRALS: Readonly<Record<Theme, Neutrals>> = {
  light: {
    bg: "#FFFFFF",
    surface: "#FFFFFF",
    surfaceRaised: "#F9FAFB",
    text: "#111827",
    textMuted: "#4B5563",
    border: "#8A9099",
    borderStrong: "#4B5563",
    focus: "#1D4ED8",
    status: {
      success: ["#166534", "#F0FDF4"],
      warning: ["#92400E", "#FFFBEB"],
      danger: ["#B91C1C", "#FEF2F2"],
      info: ["#1D4ED8", "#EFF6FF"],
    },
  },
  dark: {
    bg: "#0B0F19",
    surface: "#111827",
    surfaceRaised: "#1F2937",
    text: "#F9FAFB",
    textMuted: "#D1D5DB",
    border: "#6B7280",
    borderStrong: "#9CA3AF",
    focus: "#93C5FD",
    status: {
      success: ["#86EFAC", "#052E16"],
      warning: ["#FCD34D", "#3B2205"],
      danger: ["#FCA5A5", "#450A0A"],
      info: ["#93C5FD", "#172554"],
    },
  },
  hc_light: {
    bg: "#FFFFFF",
    surface: "#FFFFFF",
    surfaceRaised: "#FFFFFF",
    text: "#000000",
    textMuted: "#1F2937",
    border: "#000000",
    borderStrong: "#000000",
    focus: "#0000B3",
    status: {
      success: ["#14532D", "#FFFFFF"],
      warning: ["#78350F", "#FFFFFF"],
      danger: ["#7F1D1D", "#FFFFFF"],
      info: ["#1E3A8A", "#FFFFFF"],
    },
  },
  hc_dark: {
    bg: "#000000",
    surface: "#000000",
    surfaceRaised: "#000000",
    text: "#FFFFFF",
    textMuted: "#E5E7EB",
    border: "#FFFFFF",
    borderStrong: "#FFFFFF",
    focus: "#FFFF00",
    status: {
      success: ["#86EFAC", "#000000"],
      warning: ["#FDE68A", "#000000"],
      danger: ["#FCA5A5", "#000000"],
      info: ["#93C5FD", "#000000"],
    },
  },
};

/** Fixed scales (IPB-07-03, -04; IPB-06-21). */
export const SCALES = {
  space: { 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40, 12: 48, 16: 64 },
  text: { xs: 12, sm: 14, base: 16, lg: 18, xl: 20, "2xl": 24, "3xl": 30, "4xl": 36, "5xl": 48 },
  radius: { sm: 4, md: 8, lg: 12 },
  duration: { fast: 100, base: 200, slow: 300 },
  focusWidth: { normal: 2, enhanced: 4 },
} as const;

export type ColourToken =
  | "primary"
  | "on-primary"
  | "accent"
  | "on-accent"
  | "bg"
  | "surface"
  | "surface-raised"
  | "text"
  | "text-muted"
  | "border"
  | "border-strong"
  | "focus"
  | "link"
  | "success"
  | "success-bg"
  | "warning"
  | "warning-bg"
  | "danger"
  | "danger-bg"
  | "info"
  | "info-bg";

export type PairKind = "text" | "ui";
export interface ContrastPair {
  fg: ColourToken;
  bg: ColourToken;
  kind: PairKind;
}

export interface TokenSet {
  product: Product;
  theme: Theme;
  colours: Readonly<Record<ColourToken, string>>;
  fonts: { body: string; heading: string; mono: string };
  /** Every pair a component may place together, with the floor it must meet. */
  pairs: readonly ContrastPair[];
}

/** The pairs IPB-07 §07.4.1 declares; the token test checks every one. */
export const DECLARED_PAIRS: readonly ContrastPair[] = [
  { fg: "text", bg: "bg", kind: "text" },
  { fg: "text", bg: "surface", kind: "text" },
  { fg: "text", bg: "surface-raised", kind: "text" },
  { fg: "text-muted", bg: "bg", kind: "text" },
  { fg: "text-muted", bg: "surface", kind: "text" },
  { fg: "text-muted", bg: "surface-raised", kind: "text" },
  { fg: "link", bg: "bg", kind: "text" },
  { fg: "link", bg: "surface", kind: "text" },
  { fg: "link", bg: "surface-raised", kind: "text" },
  { fg: "on-primary", bg: "primary", kind: "text" },
  { fg: "on-accent", bg: "accent", kind: "text" },
  { fg: "success", bg: "success-bg", kind: "text" },
  { fg: "warning", bg: "warning-bg", kind: "text" },
  { fg: "danger", bg: "danger-bg", kind: "text" },
  { fg: "info", bg: "info-bg", kind: "text" },
  { fg: "border", bg: "surface", kind: "ui" },
  { fg: "border-strong", bg: "surface", kind: "ui" },
  { fg: "focus", bg: "bg", kind: "ui" },
  { fg: "focus", bg: "surface", kind: "ui" },
  { fg: "primary", bg: "surface", kind: "ui" },
  // No accent/surface pair: the accent is never text, an icon, a border or a focus ring (PL5-D-05).
];

const isHighContrast = (t: Theme) => t === "hc_light" || t === "hc_dark";

/** The floor a pair must meet in a theme. */
export function pairFloor(kind: PairKind, theme: Theme): number {
  if (kind === "ui") return CONTRAST_MIN.ui;
  return isHighContrast(theme) ? CONTRAST_MIN.enhanced : CONTRAST_MIN.text;
}

/**
 * The token set of a product in a theme. `override` is a tenant's white-label layer (IPB-07-32):
 * only primary and accent; derived colours are recomputed and the contrast guard in `brand`
 * refuses an override this function had to move.
 */
export function buildTheme(
  product: Product,
  theme: Theme,
  override: Partial<Pick<ProductIdentity, "primary" | "accent">> = {},
): TokenSet {
  const id = { ...PRODUCT_IDENTITY[product], ...override };
  const n = NEUTRALS[theme];
  const textMin = pairFloor("text", theme);
  // The primary is also the link colour, so it must read as text on every surface.
  const darkest = [n.bg, n.surface, n.surfaceRaised].reduce((worst, s) =>
    contrastRatio(id.primary, s) < contrastRatio(id.primary, worst) ? s : worst,
  );
  const primary = nearestCompliant(id.primary, darkest, textMin);
  // The accent is a fill only (badges, highlights, chart fills, decorative bands; PL5-D-05): it
  // need not stand out from the surface, but text on it must meet the text floor. A mid-tone that
  // neither white nor dark text can meet (7:1 in high contrast) moves away from the surface.
  let accent = toHex(parseHex(id.accent));
  if (contrastRatio(onColour(accent, textMin), accent) < textMin) {
    const lightSurface = contrastRatio(n.surface, "#000000") > contrastRatio(n.surface, "#FFFFFF");
    accent = nearestCompliant(accent, lightSurface ? "#FFFFFF" : "#000000", textMin);
  }
  const colours: Record<ColourToken, string> = {
    primary,
    "on-primary": onColour(primary, textMin),
    accent,
    "on-accent": onColour(accent, textMin),
    bg: n.bg,
    surface: n.surface,
    "surface-raised": n.surfaceRaised,
    text: n.text,
    "text-muted": n.textMuted,
    border: n.border,
    "border-strong": n.borderStrong,
    focus: n.focus,
    link: primary,
    success: n.status.success[0],
    "success-bg": n.status.success[1],
    warning: n.status.warning[0],
    "warning-bg": n.status.warning[1],
    danger: n.status.danger[0],
    "danger-bg": n.status.danger[1],
    info: n.status.info[0],
    "info-bg": n.status.info[1],
  };
  return {
    product,
    theme,
    colours,
    fonts: { body: id.body, heading: id.heading, mono: id.mono },
    pairs: DECLARED_PAIRS,
  };
}

/** Pairs below their floor; empty when the set is compliant. */
export function contrastFailures(
  set: TokenSet,
): { fg: ColourToken; bg: ColourToken; ratio: number; min: number }[] {
  return set.pairs
    .map((p) => ({
      fg: p.fg,
      bg: p.bg,
      ratio: contrastRatio(set.colours[p.fg], set.colours[p.bg]),
      min: pairFloor(p.kind, set.theme),
    }))
    .filter((r) => r.ratio < r.min);
}
