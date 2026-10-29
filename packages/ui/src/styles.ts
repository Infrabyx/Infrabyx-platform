// Component styles (IPB-06, IPB-07-02…04): tokens only, `rem` sizes, a visible focus ring that is a
// token, targets of at least 24×24 CSS px (44 px for buttons), underlined links in text, and no
// animation beyond the duration tokens (zero under reduced motion). Shipped as `dist/styles.css`.
export const COMPONENT_CSS = String.raw`
*, *::before, *::after { box-sizing: border-box; }
html { font-size: 100%; -webkit-text-size-adjust: 100%; scroll-padding-top: var(--space-6); }
body { margin: 0; background: var(--color-bg); color: var(--color-text); font-family: var(--font-body);
  font-size: var(--text-base); line-height: 1.5; }
h1, h2, h3, h4 { font-family: var(--font-heading); line-height: 1.25; margin: 0 0 var(--space-3); }
h1 { font-size: var(--text-3xl); } h2 { font-size: var(--text-2xl); } h3 { font-size: var(--text-xl); }
p { margin: 0 0 var(--space-3); max-width: 75ch; }
a { color: var(--color-link); text-decoration: underline; text-underline-offset: 0.15em; }
a:hover { text-decoration-thickness: 2px; }
:focus-visible { outline: var(--focus-width) solid var(--color-focus); outline-offset: 2px; }
img { max-width: 100%; height: auto; }
[hidden] { display: none !important; }
.ibx-visually-hidden { position: absolute !important; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }

.ibx-skip__link { position: absolute; left: var(--space-2); top: -10rem; z-index: 100; padding: var(--space-2) var(--space-4);
  background: var(--color-surface); color: var(--color-link); border: 2px solid var(--color-border-strong); }
.ibx-skip__link:focus { top: var(--space-2); }

.ibx-header { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-4); padding: var(--space-3) var(--space-6);
  border-bottom: 1px solid var(--color-border); background: var(--color-surface); }
.ibx-header__brand { font-weight: 700; font-size: var(--text-lg); color: var(--color-text); text-decoration: none; }
.ibx-header__logo { height: 2rem; width: auto; }
.ibx-nav__list { display: flex; flex-wrap: wrap; gap: var(--space-1) var(--space-4); list-style: none; margin: 0; padding: 0; }
.ibx-nav__link { display: inline-block; min-height: 1.5rem; padding: var(--space-2) var(--space-1); color: var(--color-text); }
.ibx-nav__link[aria-current="page"] { font-weight: 700; text-decoration-thickness: 3px; }
.ibx-header__actions { margin-left: auto; display: flex; gap: var(--space-3); align-items: center; }
.ibx-main { display: block; padding: var(--space-6); max-width: 72rem; margin: 0 auto; }
.ibx-main:focus { outline: none; }
.ibx-breadcrumb { padding: var(--space-3) var(--space-6) 0; max-width: 72rem; margin: 0 auto; }
.ibx-breadcrumb__list { display: flex; flex-wrap: wrap; gap: var(--space-2); list-style: none; margin: 0; padding: 0; }
.ibx-breadcrumb__list li + li::before { content: "/"; margin-right: var(--space-2); color: var(--color-text-muted); }

.ibx-button { display: inline-flex; align-items: center; justify-content: center; min-height: 2.75rem; min-width: 2.75rem;
  padding: var(--space-2) var(--space-4); border-radius: var(--radius-md); border: 2px solid var(--color-border-strong);
  background: var(--color-surface); color: var(--color-text); font: inherit; font-weight: 600; cursor: pointer; text-decoration: none; }
.ibx-button--primary { background: var(--color-primary); color: var(--color-on-primary); border-color: var(--color-primary); }
.ibx-button--danger { background: var(--color-danger-bg); color: var(--color-danger); border-color: var(--color-danger); }
.ibx-button--ghost { border-color: transparent; background: transparent; color: var(--color-link); }
.ibx-button[disabled] { cursor: not-allowed; opacity: 0.7; }

.ibx-field { margin: 0 0 var(--space-4); }
.ibx-field__label-row { display: flex; gap: var(--space-2); align-items: center; }
.ibx-field__label { font-weight: 600; }
.ibx-field__req { font-weight: 400; color: var(--color-text-muted); }
.ibx-field__hint { color: var(--color-text-muted); margin: var(--space-1) 0; }
.ibx-field__error { color: var(--color-danger); font-weight: 600; margin: var(--space-1) 0; }
.ibx-field__input { display: block; width: 100%; max-width: 36rem; min-height: 2.75rem; padding: var(--space-2) var(--space-3);
  font: inherit; color: var(--color-text); background: var(--color-surface); border: 2px solid var(--color-border-strong);
  border-radius: var(--radius-sm); }
.ibx-field--error .ibx-field__input { border-color: var(--color-danger); }
.ibx-check { display: flex; flex-wrap: wrap; gap: var(--space-2); align-items: flex-start; margin: 0 0 var(--space-4); }
.ibx-check__input { width: 1.5rem; height: 1.5rem; margin: 0.125rem 0 0; accent-color: var(--color-primary); }
.ibx-check__label { flex: 1 1 20rem; }
.ibx-error-summary { border: 3px solid var(--color-danger); padding: var(--space-4); margin: 0 0 var(--space-6); background: var(--color-surface); }
.ibx-error-summary__title { font-size: var(--text-lg); color: var(--color-danger); }
.ibx-error { border-left: 4px solid var(--color-danger); padding: var(--space-3) var(--space-4); background: var(--color-danger-bg); color: var(--color-text); }
.ibx-error__what { font-weight: 700; }
.ibx-error__code { color: var(--color-text-muted); font-size: var(--text-sm); }

.ibx-help__button { display: inline-flex; align-items: center; justify-content: center; width: 1.5rem; height: 1.5rem;
  border-radius: 50%; border: 2px solid var(--color-border-strong); background: var(--color-surface); color: var(--color-link);
  font-weight: 700; font-size: var(--text-sm); cursor: pointer; padding: 0; }
.ibx-help__popover { max-width: 22rem; padding: var(--space-4); border: 2px solid var(--color-border-strong); border-radius: var(--radius-md);
  background: var(--color-surface-raised); color: var(--color-text); box-shadow: var(--shadow-2); }
.ibx-help__term { font-size: var(--text-lg); }
.ibx-help__footer { color: var(--color-text-muted); font-size: var(--text-sm); }

.ibx-notice { display: flex; gap: var(--space-3); padding: var(--space-3) var(--space-4); border-radius: var(--radius-md); border: 2px solid; }
.ibx-notice__icon { font-weight: 700; }
.ibx-notice__title { font-weight: 700; margin: 0; }
.ibx-notice--success { background: var(--color-success-bg); color: var(--color-success); }
.ibx-notice--warning { background: var(--color-warning-bg); color: var(--color-warning); }
.ibx-notice--danger { background: var(--color-danger-bg); color: var(--color-danger); }
.ibx-notice--info { background: var(--color-info-bg); color: var(--color-info); }
.ibx-ai-label { display: inline-block; padding: 0 var(--space-2); border: 1px solid var(--color-border-strong); border-radius: var(--radius-sm);
  font-size: var(--text-sm); color: var(--color-text); }

.ibx-table-wrap { overflow-x: auto; max-width: 100%; }
.ibx-table { border-collapse: collapse; width: 100%; }
.ibx-table caption { text-align: left; font-weight: 700; padding: var(--space-2) 0; }
.ibx-table th, .ibx-table td { text-align: left; padding: var(--space-2) var(--space-3); border-bottom: 1px solid var(--color-border); }
.ibx-num { text-align: right; font-variant-numeric: tabular-nums; }
.ibx-chart__svg { width: 100%; max-width: 32rem; height: auto; }
.ibx-chart__label, .ibx-chart__value { fill: var(--color-text); font-size: 14px; }
.ibx-chart__bar { fill: var(--color-primary); }

.ibx-table tbody tr { height: 2.75rem; }
.ibx-table--compact tbody tr { height: 2.25rem; }
.ibx-table--compact th, .ibx-table--compact td { padding-top: var(--space-1); padding-bottom: var(--space-1); }
.ibx-table thead th { position: sticky; top: 0; background: var(--color-surface); }
.ibx-kbd { font-family: var(--font-mono); padding: 0 var(--space-1); border: 1px solid var(--color-border-strong); border-radius: var(--radius-sm); }

.ibx-disclosure > summary { display: inline-flex; align-items: center; min-height: 2.75rem; cursor: pointer; font-weight: 600; }
.ibx-palette__row { display: flex; flex-wrap: wrap; gap: var(--space-2); align-items: center; }
.ibx-palette__row .ibx-field__input { flex: 1 1 18rem; }
.ibx-palette__heading { font-size: var(--text-lg); margin-top: var(--space-4); }
.ibx-palette__list, .ibx-workspace__list, .ibx-views__list, .ibx-chooser__list { list-style: none; margin: 0; padding: 0; }
.ibx-palette__hit { display: flex; flex-direction: column; min-height: 2.75rem; padding: var(--space-2) 0; }
.ibx-palette__detail { color: var(--color-text-muted); font-size: var(--text-sm); }
.ibx-palette__code { font-weight: 400; }
.ibx-workspace__list a, .ibx-views__list a { display: inline-block; min-height: 1.5rem; padding: var(--space-2) var(--space-1); }
.ibx-workspace__list a[aria-current="true"], .ibx-views__list a[aria-current="true"] { font-weight: 700; }
.ibx-chooser__item { display: flex; flex-wrap: wrap; gap: var(--space-2); align-items: center; padding: var(--space-1) 0; }
.ibx-chooser__set { border: 1px solid var(--color-border); padding: var(--space-3); margin: 0 0 var(--space-3); }

.ibx-page__head { display: flex; flex-wrap: wrap; gap: var(--space-3); align-items: baseline; margin: 0 0 var(--space-4); }
.ibx-page__head h1 { flex: 1 1 20rem; }
.ibx-page__actions, .ibx-state__actions { display: flex; flex-wrap: wrap; gap: var(--space-3); align-items: center; }
.ibx-page__toolbar { display: flex; flex-wrap: wrap; gap: var(--space-4); margin: 0 0 var(--space-4); }
.ibx-state { border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: var(--space-6); background: var(--color-surface); }
.ibx-state__title { font-size: var(--text-lg); font-weight: 700; }
.ibx-state--error, .ibx-state--denied { border-color: var(--color-danger); }
.ibx-state__ref { color: var(--color-text-muted); font-size: var(--text-sm); }
.ibx-skeleton { display: flex; flex-direction: column; gap: var(--space-2); }
.ibx-skeleton--cards { flex-direction: row; flex-wrap: wrap; }
.ibx-skeleton__line { display: block; height: 2.75rem; border-radius: var(--radius-sm); background: var(--color-border); }
.ibx-skeleton--text .ibx-skeleton__line { height: 1rem; max-width: 60ch; }
.ibx-skeleton--cards .ibx-skeleton__line { width: 16rem; height: 8rem; }
.ibx-facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr)); gap: var(--space-3); margin: 0 0 var(--space-6); }
.ibx-facts dt { font-weight: 600; color: var(--color-text-muted); }
.ibx-facts dd { margin: 0; }
.ibx-steps { display: flex; flex-wrap: wrap; gap: var(--space-2) var(--space-6); list-style: decimal inside; margin: 0 0 var(--space-4); padding: 0; }
.ibx-steps [aria-current="step"] { font-weight: 700; text-decoration: underline; text-decoration-thickness: 3px; }
.ibx-widgets { display: grid; grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr)); gap: var(--space-4); }
.ibx-widget { border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: var(--space-4); background: var(--color-surface); }
.ibx-widget__title { font-size: var(--text-lg); }
.ibx-widget__evidence { font-size: var(--text-sm); margin: var(--space-3) 0 0; }

.ibx-ctl { border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: var(--space-4); margin: 0 0 var(--space-4); }
.ibx-ctl__caption { display: flex; flex-direction: column; gap: var(--space-1); margin: var(--space-2) 0; }
.ibx-ctl__title { font-weight: 700; }
.ibx-ctl__notice { color: var(--color-text-muted); font-size: var(--text-sm); }
.ibx-ctl__frame { width: 100%; aspect-ratio: 16 / 9; border: 0; }

.ibx-footer { border-top: 1px solid var(--color-border); background: var(--color-surface-raised); padding: var(--space-8) var(--space-6); margin-top: var(--space-10); }
.ibx-footer__nav { display: grid; grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr)); gap: var(--space-6); max-width: 72rem; margin: 0 auto; }
.ibx-footer__heading { font-size: var(--text-base); }
.ibx-footer ul { list-style: none; margin: 0; padding: 0; }
.ibx-footer li { margin: 0 0 var(--space-2); }
.ibx-footer li a { display: inline-block; min-height: 1.5rem; padding: 0.125rem 0; }
.ibx-footer__address { display: flex; flex-direction: column; font-style: normal; margin: 0 0 var(--space-3); }
.ibx-footer__label { font-weight: 600; }
.ibx-footer__legal { max-width: 72rem; margin: var(--space-6) auto 0; padding-top: var(--space-4); border-top: 1px solid var(--color-border); }
.ibx-footer__social, .ibx-footer__utilities { display: flex; flex-wrap: wrap; gap: var(--space-2) var(--space-4); }
.ibx-footer__entity, .ibx-footer__officers { font-size: var(--text-sm); }

@media (max-width: 40rem) {
  .ibx-header, .ibx-main, .ibx-footer { padding-left: var(--space-4); padding-right: var(--space-4); }
  .ibx-header__actions { margin-left: 0; }
}
`;
