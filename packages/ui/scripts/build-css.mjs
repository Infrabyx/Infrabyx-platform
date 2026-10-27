// Writes dist/styles.css (components) and dist/tokens/<product>.css (one per product, all four
// themes) from the compiled modules, so products link plain stylesheets (no inline styles; CSP).
import { mkdirSync, writeFileSync } from "node:fs";
import { COMPONENT_CSS } from "../dist/styles.js";
import { PRODUCTS, themeCss } from "../dist/tokens/index.js";

const dist = new URL("../dist/", import.meta.url);
writeFileSync(new URL("styles.css", dist), COMPONENT_CSS.trimStart());
mkdirSync(new URL("tokens/", dist), { recursive: true });
for (const p of PRODUCTS)
  writeFileSync(new URL(`tokens/${p.toLowerCase()}.css`, dist), themeCss(p));
console.log(`ui: wrote styles.css and ${PRODUCTS.length} token stylesheets`);
