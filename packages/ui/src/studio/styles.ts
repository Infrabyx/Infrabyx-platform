// The Studio frame's layout on the `ui` tokens: the section list beside the content from 64rem,
// above it below that; everything reflows at 320 px.
export const STUDIO_CSS = String.raw`
.ibx-studio { display: grid; gap: var(--space-6); grid-template-columns: minmax(0, 1fr); }
@media (min-width: 64rem) { .ibx-studio { grid-template-columns: 14rem minmax(0, 1fr); } }
.ibx-studio__nav ul { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: var(--space-2); }
@media (min-width: 64rem) { .ibx-studio__nav ul { flex-direction: column; } }
.ibx-studio__nav a { display: block; padding: var(--space-2) var(--space-3); border-radius: var(--radius-md); }
.ibx-studio__nav a[aria-current="page"] { font-weight: 700; text-decoration: underline; background: var(--color-surface-raised); }
.ibx-studio__content { min-width: 0; }
.ibx-studio__content > * + * { margin-top: var(--space-5); }
.ibx-studio__box { border-top: 1px solid var(--color-border); padding-top: var(--space-4); }
.ibx-studio__box form { display: grid; gap: var(--space-3); max-width: 48rem; }
.ibx-studio__box textarea { font-family: var(--font-mono, monospace); min-height: 12rem; }
.ibx-studio__op { display: inline-block; margin: 0 var(--space-2) var(--space-2) 0; }
.ibx-studio__filter { display: flex; flex-wrap: wrap; gap: var(--space-3); align-items: end; }
.ibx-studio__reveal { overflow-wrap: anywhere; }
.ibx-badge { display: inline-block; padding: 0 var(--space-2); border: 1px solid var(--color-border-strong); border-radius: var(--radius-sm); font-size: var(--text-sm); }
.ibx-table td form { margin: 0 0 var(--space-2); }
`;
