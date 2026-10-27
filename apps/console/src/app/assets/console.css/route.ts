// The console stylesheet: the OH tokens in four themes, the `ui` component CSS and the Studio
// layout. One file from this origin; no inline styles.
import { COMPONENT_CSS } from "@infrabyx/ui";
import { STUDIO_CSS } from "@infrabyx/ui/studio";
import { themeCss } from "@infrabyx/ui/tokens";

const CONSOLE_CSS = String.raw`
.ibx-console__session { display: flex; flex-wrap: wrap; gap: var(--space-2); align-items: center; margin: 0; }
.ibx-console__footer { border-top: 1px solid var(--color-border); padding: var(--space-4); color: var(--color-text-muted); }
.ibx-console__signin { display: grid; gap: var(--space-4); max-width: 32rem; }
.ibx-main { padding: var(--space-4); }
.ibx-prose, .ibx-studio__content { overflow-wrap: anywhere; }
.ibx-studio__json { white-space: pre-wrap; overflow-wrap: anywhere; }
`;

export function GET() {
  return new Response([themeCss("OH"), COMPONENT_CSS, STUDIO_CSS, CONSOLE_CSS].join("\n"), {
    headers: { "Content-Type": "text/css; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
}
