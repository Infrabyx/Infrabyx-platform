// CSS custom properties from token sets (IPB-07 §07.4.1). The light theme is the default; the OS
// preference (`prefers-color-scheme`, `prefers-contrast`) applies until the person chooses, after
// which `data-theme` on the root element wins (IPB-06-16). Reduced motion zeroes every duration
// (IPB-06-34); `data-focus="enhanced"` widens the focus ring (IPB-06-21).
import { buildTheme, SCALES, THEMES, type Product, type Theme, type TokenSet } from "./themes.js";

const rem = (px: number) => `${px / 16}rem`;

export function tokenDeclarations(set: TokenSet): string {
  const lines: string[] = [];
  for (const [k, v] of Object.entries(set.colours)) lines.push(`--color-${k}: ${v};`);
  lines.push(`--font-body: ${set.fonts.body};`);
  lines.push(`--font-heading: ${set.fonts.heading};`);
  lines.push(`--font-mono: ${set.fonts.mono};`);
  lines.push(
    `color-scheme: ${set.theme === "dark" || set.theme === "hc_dark" ? "dark" : "light"};`,
  );
  return lines.join(" ");
}

function scaleDeclarations(): string {
  const lines: string[] = [];
  for (const [k, v] of Object.entries(SCALES.space)) lines.push(`--space-${k}: ${rem(v)};`);
  for (const [k, v] of Object.entries(SCALES.text)) lines.push(`--text-${k}: ${rem(v)};`);
  for (const [k, v] of Object.entries(SCALES.radius)) lines.push(`--radius-${k}: ${rem(v)};`);
  for (const [k, v] of Object.entries(SCALES.duration)) lines.push(`--duration-${k}: ${v}ms;`);
  lines.push(`--focus-width: ${SCALES.focusWidth.normal}px;`);
  lines.push("--shadow-1: 0 1px 2px rgb(0 0 0 / 0.12);");
  lines.push("--shadow-2: 0 4px 12px rgb(0 0 0 / 0.16);");
  return lines.join(" ");
}

/** The complete token stylesheet for one product, all four themes. */
export function themeCss(product: Product): string {
  const sets = Object.fromEntries(THEMES.map((t) => [t, buildTheme(product, t)])) as Record<
    Theme,
    TokenSet
  >;
  const out: string[] = [];
  out.push(`/* @infrabyx/ui tokens: ${product} (IPB-07 §07.4.1) */`);
  out.push(`:root { ${scaleDeclarations()} ${tokenDeclarations(sets.light)} }`);
  out.push(
    `@media (prefers-color-scheme: dark) { :root:not([data-theme]) { ${tokenDeclarations(sets.dark)} } }`,
  );
  out.push(
    `@media (prefers-contrast: more) { :root:not([data-theme]) { ${tokenDeclarations(sets.hc_light)} } }`,
  );
  out.push(
    `@media (prefers-contrast: more) and (prefers-color-scheme: dark) { :root:not([data-theme]) { ${tokenDeclarations(sets.hc_dark)} } }`,
  );
  for (const t of THEMES) out.push(`:root[data-theme="${t}"] { ${tokenDeclarations(sets[t])} }`);
  out.push(`:root[data-focus="enhanced"] { --focus-width: ${SCALES.focusWidth.enhanced}px; }`);
  out.push(
    "@media (prefers-reduced-motion: reduce) { :root:not([data-motion]) { --duration-fast: 0ms; --duration-base: 0ms; --duration-slow: 0ms; } }",
  );
  out.push(
    ':root[data-motion="reduced"] { --duration-fast: 0ms; --duration-base: 0ms; --duration-slow: 0ms; }',
  );
  return out.join("\n") + "\n";
}
