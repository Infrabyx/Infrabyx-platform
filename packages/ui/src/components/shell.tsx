// The page shell (IPB-06 SC 2.4.1, 2.4.2, 2.4.8, 3.2.3; IPB-07-05; IPB-04 §04.4.5). Server-rendered:
// skip links first in the DOM, landmarks, one `main`, at most seven primary nav items, and a
// breadcrumb on every page below the top level. No inline styles (the CSP has no unsafe-inline).
import type { ReactNode } from "react";
import { IpbError } from "@infrabyx/contracts/errors";
import { messages, type Messages } from "../i18n/messages.js";

export const MAX_TOP_LEVEL_NAV = 7;
const en = messages("en-IN");

export interface NavLink {
  label: string;
  href: string;
  /** Marks the current section (`aria-current="page"` on an exact match). */
  current?: boolean;
}

export function SkipLinks({
  t = en,
  filters,
  table,
}: {
  t?: Messages;
  filters?: boolean;
  table?: boolean;
}) {
  return (
    <div className="ibx-skip">
      <a className="ibx-skip__link" href="#main">
        {t.t("ui.skip.main")}
      </a>
      <a className="ibx-skip__link" href="#navigation">
        {t.t("ui.skip.navigation")}
      </a>
      {filters ? (
        <a className="ibx-skip__link" href="#filters">
          Skip to filters
        </a>
      ) : null}
      {table ? (
        <a className="ibx-skip__link" href="#table">
          Skip to table
        </a>
      ) : null}
    </div>
  );
}

export interface HeaderProps {
  brand: { name: string; href: string; logoSrc?: string; logoAlt?: string };
  nav: readonly NavLink[];
  /** Language switch, log in, primary call to action (IPB-04 §04.4.5). */
  actions?: ReactNode;
  t?: Messages;
}

export function Header({ brand, nav, actions, t = en }: HeaderProps) {
  if (nav.length > MAX_TOP_LEVEL_NAV)
    throw new IpbError("IPB-UX-002", {
      detail: `${nav.length} top-level nav items; at most ${MAX_TOP_LEVEL_NAV}`,
    });
  return (
    <header className="ibx-header">
      <a className="ibx-header__brand" href={brand.href}>
        {brand.logoSrc ? (
          <img className="ibx-header__logo" src={brand.logoSrc} alt={brand.logoAlt ?? brand.name} />
        ) : (
          <span className="ibx-header__name">{brand.name}</span>
        )}
      </a>
      <nav id="navigation" className="ibx-nav" aria-label={t.t("ui.nav.main")}>
        <ul className="ibx-nav__list">
          {nav.map((item) => (
            <li key={item.href}>
              <a
                className="ibx-nav__link"
                href={item.href}
                aria-current={item.current ? "page" : undefined}
              >
                {item.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      {actions ? <div className="ibx-header__actions">{actions}</div> : null}
    </header>
  );
}

export function Breadcrumb({ items, t = en }: { items: readonly NavLink[]; t?: Messages }) {
  if (items.length < 2) return null;
  return (
    <nav className="ibx-breadcrumb" aria-label={t.t("ui.nav.breadcrumb")}>
      <ol className="ibx-breadcrumb__list">
        {items.map((item, i) =>
          i === items.length - 1 ? (
            <li key={item.href}>
              <span aria-current="page">{item.label}</span>
            </li>
          ) : (
            <li key={item.href}>
              <a href={item.href}>{item.label}</a>
            </li>
          ),
        )}
      </ol>
    </nav>
  );
}

export interface AppShellProps {
  header: ReactNode;
  footer: ReactNode;
  children: ReactNode;
  /** Before `main`: a breadcrumb, a preview banner. */
  beforeMain?: ReactNode;
  /** After the footer: the cookie banner, the feedback dialog (they must not cover focus). */
  afterFooter?: ReactNode;
  t?: Messages;
}

/** One shell for every page (IPB-06 SC 3.2.3). `main` takes focus from the skip link. */
export function AppShell({
  header,
  footer,
  children,
  beforeMain,
  afterFooter,
  t = en,
}: AppShellProps) {
  return (
    <>
      <SkipLinks t={t} />
      {header}
      {beforeMain}
      <main id="main" className="ibx-main" tabIndex={-1}>
        {children}
      </main>
      {footer}
      {afterFooter}
    </>
  );
}

/** `<Page> · <Module> · <Product display name>` (IPB-06 SC 2.4.2). */
export function pageTitle(page: string, product: string, module?: string): string {
  return [page, module, product].filter((p): p is string => Boolean(p && p.trim())).join(" · ");
}
