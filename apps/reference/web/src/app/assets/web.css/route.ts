// The web app's stylesheet: the product tokens, the `ui` component CSS and a little layout. One file
// from this origin; no inline styles (the CSP allows `style-src 'self'` only).
import { COMPONENT_CSS } from "@infrabyx/ui";
import { themeCss } from "@infrabyx/ui/tokens";

const WEB_CSS = String.raw`
.ibx-main { padding: var(--space-4); max-width: 60rem; }
.ibx-web__session { display: flex; flex-wrap: wrap; gap: var(--space-2); align-items: center; margin: 0; }
.ibx-web__footer { border-top: 1px solid var(--color-border); padding: var(--space-4); color: var(--color-text-muted); }
.ibx-web__steps { display: grid; gap: var(--space-3); padding-left: var(--space-5); }
.ibx-web__summary { border-left: 4px solid var(--color-border); margin: var(--space-3) 0; padding: var(--space-2) var(--space-4); }
.ibx-web__facts { display: grid; grid-template-columns: max-content 1fr; gap: var(--space-1) var(--space-4); }
.ibx-web__facts dt { font-weight: 600; }
.ibx-web__facts dd { margin: 0; overflow-wrap: anywhere; }
.ibx-prose { overflow-wrap: anywhere; }
`;

export function GET() {
  return new Response([themeCss("LD"), COMPONENT_CSS, WEB_CSS].join("\n"), {
    headers: { "Content-Type": "text/css; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
}
