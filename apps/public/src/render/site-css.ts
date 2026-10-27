// The site's own layout rules, on the `@infrabyx/ui` tokens only (so every theme and the contrast
// guard apply). Reflow at 320 px (IPB-06 SC 1.4.10): grids collapse to one column, nothing has a
// fixed width. The honeypot field is moved off-screen, not hidden from assistive technology alone.
export const SITE_CSS = String.raw`
.ibx-page > * + * { margin-top: var(--space-6); }
.ibx-prose ul, .ibx-prose ol { padding-left: var(--space-6); }
.ibx-hero { padding: var(--space-10) 0 var(--space-6); }
.ibx-hero__eyebrow { color: var(--color-text-muted); font-weight: 600; }
.ibx-hero__title { font-size: var(--text-4xl); max-width: 30ch; }
.ibx-hero__sub { font-size: var(--text-lg); color: var(--color-text-muted); }
.ibx-hero__actions { display: flex; flex-wrap: wrap; gap: var(--space-3); }
.ibx-grid { display: grid; gap: var(--space-4); list-style: none; margin: 0; padding: 0; grid-template-columns: 1fr; }
@media (min-width: 48rem) {
  .ibx-grid--2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .ibx-grid--3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .ibx-grid--4 { grid-template-columns: repeat(4, minmax(0, 1fr)); }
}
.ibx-card { border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: var(--space-4);
  background: var(--color-surface-raised); }
.ibx-card__title { font-size: var(--text-xl); }
.ibx-steps { display: grid; gap: var(--space-4); padding-left: var(--space-6); }
.ibx-steps__title { font-size: var(--text-lg); }
.ibx-cta { border-left: 4px solid var(--color-primary); padding: var(--space-4); background: var(--color-surface-raised); }
.ibx-faq__item { border-bottom: 1px solid var(--color-border); padding: var(--space-3) 0; }
.ibx-faq__item summary { cursor: pointer; font-weight: 600; min-height: 1.5rem; }
.ibx-timeline { list-style: none; padding: 0; border-left: 2px solid var(--color-border-strong); }
.ibx-timeline li { padding: 0 0 var(--space-4) var(--space-4); }
.ibx-timeline time { font-weight: 700; }
.ibx-timeline__title { font-size: var(--text-lg); margin-top: var(--space-1); }
.ibx-facts { display: grid; grid-template-columns: minmax(8rem, max-content) 1fr; gap: var(--space-2) var(--space-4); }
.ibx-facts dt { font-weight: 600; }
.ibx-facts dd { margin: 0; overflow-wrap: anywhere; }
.ibx-line { display: block; }
.ibx-meta { color: var(--color-text-muted); font-size: var(--text-sm); }
.ibx-glossary > div { padding: var(--space-3) 0; border-bottom: 1px solid var(--color-border); }
.ibx-glossary dt { font-weight: 700; }
.ibx-glossary dd { margin: var(--space-1) 0 0; }
.ibx-lang { margin: 0; }
.ibx-lang__note { color: var(--color-text-muted); }
.ibx-form form { display: grid; gap: var(--space-4); max-width: 40rem; }
.ibx-honeypot { position: absolute; left: -10000px; width: 1px; height: 1px; overflow: hidden; }
.ibx-trust__asof { color: var(--color-text-muted); }
.ibx-gallery > section { border-top: 1px solid var(--color-border); padding-top: var(--space-6); }
@media (max-width: 30rem) {
  .ibx-hero__title { font-size: var(--text-3xl); }
  .ibx-facts { grid-template-columns: 1fr; }
}
`;
