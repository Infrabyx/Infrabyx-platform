// Contrast maths (WCAG 2.2 SC 1.4.3, 1.4.6, 1.4.11; IPB-06-59). Used by the token tests and by the
// brand contrast guard, which rejects a pair below the floor and suggests the nearest compliant
// colour (IPB-A11Y-006).

/** WCAG floors: normal text, large text and non-text UI, and the enhanced (AAA) text level. */
export const CONTRAST_MIN = { text: 4.5, large: 3, ui: 3, enhanced: 7 } as const;

type Rgb = [number, number, number];

export function parseHex(hex: string): Rgb {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`not a hex colour: ${hex}`);
  let h = m[1]!;
  if (h.length === 3)
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as Rgb;
}

export function toHex([r, g, b]: Rgb): string {
  return `#${[r, g, b]
    .map((v) =>
      Math.round(Math.min(255, Math.max(0, v)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")
    .toUpperCase()}`;
}

const channel = (v: number) => {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

/** Relative luminance per WCAG 2.2. */
export function luminance(hex: string): number {
  const [r, g, b] = parseHex(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** Contrast ratio between two colours, 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Rounded down to two decimals, so a ratio shown to a person is never better than the truth. */
export const formatRatio = (r: number) => (Math.floor(r * 100) / 100).toFixed(2);

export function meetsContrast(fg: string, bg: string, min: number): boolean {
  return contrastRatio(fg, bg) >= min;
}

function toHsl([r, g, b]: Rgb): [number, number, number] {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h =
    max === rn
      ? (gn - bn) / d + (gn < bn ? 6 : 0)
      : max === gn
        ? (bn - rn) / d + 2
        : (rn - gn) / d + 4;
  return [h / 6, s, l];
}

function fromHsl([h, s, l]: [number, number, number]): Rgb {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue = (t: number) => {
    const u = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
    if (u < 1 / 6) return p + (q - p) * 6 * u;
    if (u < 1 / 2) return q;
    if (u < 2 / 3) return p + (q - p) * (2 / 3 - u) * 6;
    return p;
  };
  return [hue(h + 1 / 3) * 255, hue(h) * 255, hue(h - 1 / 3) * 255];
}

/**
 * The colour closest to `fg` (same hue and saturation, lightness moved away from `bg`) that meets
 * `min` against `bg`. Returns `fg` itself when it already passes.
 */
export function nearestCompliant(fg: string, bg: string, min: number): string {
  if (meetsContrast(fg, bg, min)) return toHex(parseHex(fg));
  const [h, s, l] = toHsl(parseHex(fg));
  const darken = luminance(bg) > 0.18;
  for (let step = 1; step <= 100; step++) {
    const nl = darken ? l - step / 100 : l + step / 100;
    if (nl < 0 || nl > 1) break;
    const candidate = toHex(fromHsl([h, s, nl]));
    if (meetsContrast(candidate, bg, min)) return candidate;
  }
  return darken ? "#000000" : "#FFFFFF";
}

/** White or near-black text on a fill, whichever meets `min`; the higher ratio if both do. */
export function onColour(fill: string, min: number = CONTRAST_MIN.text): string {
  const light = "#FFFFFF";
  const dark = "#111827";
  const [rl, rd] = [contrastRatio(light, fill), contrastRatio(dark, fill)];
  if (rl >= min && rl >= rd) return light;
  if (rd >= min) return dark;
  return contrastRatio("#000000", fill) > rl ? "#000000" : light;
}
