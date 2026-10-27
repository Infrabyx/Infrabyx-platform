// The footer (IPB-04 §04.3.8, IPB-04-71…74; IPB-05-02). Everything here is a text node from the
// published brand pack and policy set: the component holds no entity name, CIN, address or officer
// (the caller passes them from configuration). Headed columns, a labelled footer landmark, social
// links with visible text and a new-tab notice, and the utilities every page needs.
import { messages, type Messages } from "../i18n/messages.js";

const en = messages("en-IN");

export interface FooterLink {
  label: string;
  href: string;
  external?: boolean;
}

export interface FooterProps {
  brand: { name: string; href: string; line?: string };
  /** "Part of the Infrabyx Group" (`web.footer.group_url`). */
  groupLink?: FooterLink;
  columns: readonly { heading: string; links: readonly FooterLink[] }[];
  contact: {
    registeredOffice: readonly string[];
    phone: string;
    email: string;
    /** A text channel beside every number (IPB-06-13). */
    textChannel?: FooterLink;
    offices?: readonly { label: string; lines: readonly string[] }[];
  };
  /** "{legal name} · CIN {cin} · GSTIN {gstin}" as one copyable line (Companies Act s.12(3)(c)). */
  entityLine: string;
  /** Grievance Officer and Data Protection Officer, linking to /grievance and the privacy section. */
  officers: readonly { role: string; name: string; email: string; href: string }[];
  social: readonly { network: string; href: string }[];
  /** Status, language switch, cookie settings, accessibility, sitemap, report a problem. */
  utilities: readonly FooterLink[];
  disclaimer?: string;
  copyright: string;
  t?: Messages;
}

function Link({ link }: { link: FooterLink }) {
  return link.external ? (
    <a href={link.href} rel="noopener" target="_blank">
      {link.label}
      <span className="ibx-visually-hidden"> (opens in new tab)</span>
    </a>
  ) : (
    <a href={link.href}>{link.label}</a>
  );
}

export function Footer(p: FooterProps) {
  const t = p.t ?? en;
  return (
    <footer className="ibx-footer">
      <nav className="ibx-footer__nav" aria-label={t.t("ui.nav.footer")}>
        <div className="ibx-footer__brand">
          <a href={p.brand.href} className="ibx-footer__brand-name">
            {p.brand.name}
          </a>
          {p.brand.line ? <p>{p.brand.line}</p> : null}
          {p.groupLink ? (
            <p>
              <Link link={p.groupLink} />
            </p>
          ) : null}
        </div>
        {p.columns.map((col) => (
          <section className="ibx-footer__col" key={col.heading}>
            <h2 className="ibx-footer__heading">{col.heading}</h2>
            <ul>
              {col.links.map((l) => (
                <li key={l.href}>
                  <Link link={l} />
                </li>
              ))}
            </ul>
          </section>
        ))}
        <section className="ibx-footer__col">
          <h2 className="ibx-footer__heading">Contact</h2>
          <address className="ibx-footer__address">
            <span className="ibx-footer__label">Registered office</span>
            {p.contact.registeredOffice.map((line) => (
              <span key={line}>{line}</span>
            ))}
            <a href={`tel:${p.contact.phone.replace(/[^+\d]/g, "")}`}>{p.contact.phone}</a>
            <a href={`mailto:${p.contact.email}`}>{p.contact.email}</a>
            {p.contact.textChannel ? <Link link={p.contact.textChannel} /> : null}
          </address>
          {(p.contact.offices ?? []).map((o) => (
            <address className="ibx-footer__address" key={o.label}>
              <span className="ibx-footer__label">{o.label}</span>
              {o.lines.map((line) => (
                <span key={line}>{line}</span>
              ))}
            </address>
          ))}
        </section>
      </nav>
      <div className="ibx-footer__legal">
        <p className="ibx-footer__entity">{p.entityLine}</p>
        <p className="ibx-footer__officers">
          {p.officers.map((o, i) => (
            <span key={o.role}>
              {i > 0 ? " · " : ""}
              <a href={o.href}>{o.role}</a>: {o.name}, <a href={`mailto:${o.email}`}>{o.email}</a>
            </span>
          ))}
        </p>
        <ul className="ibx-footer__social">
          {p.social.map((s) => (
            <li key={s.href}>
              <a href={s.href} rel="noopener" target="_blank">
                {s.network}
                <span className="ibx-visually-hidden"> (opens in new tab)</span>
              </a>
            </li>
          ))}
        </ul>
        <ul className="ibx-footer__utilities">
          {p.utilities.map((u) => (
            <li key={u.href}>
              <Link link={u} />
            </li>
          ))}
        </ul>
        {p.disclaimer ? <p className="ibx-footer__disclaimer">{p.disclaimer}</p> : null}
        <p className="ibx-footer__copyright">{p.copyright}</p>
      </div>
    </footer>
  );
}

/** "© {year} {legal name}. All rights reserved." with the current year (IPB-04 §04.3.8). */
export function copyrightLine(legalName: string, now: Date = new Date()): string {
  const year = new Intl.DateTimeFormat("en-IN", {
    year: "numeric",
    timeZone: "Asia/Kolkata",
  }).format(now);
  return `© ${year} ${legalName}. All rights reserved.`;
}

/** "{name} · CIN {cin} · GSTIN {gstin}"; the GSTIN part is left out when the entity has none. */
export function entityLine(e: { name: string; cin: string; gstin?: string | null }): string {
  return [e.name, `CIN ${e.cin}`, e.gstin ? `GSTIN ${e.gstin}` : null].filter(Boolean).join(" · ");
}
