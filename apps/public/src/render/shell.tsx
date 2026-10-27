// The site shell (PL5 plan §9.2; IPB-04 §04.3.8, §04.4.5; owner rule O-4): header with at most seven
// items, the footer with the entity line and officers from the brand pack and policy set (never
// from code), the language switch with Hindi marked unavailable (OWN-11), the cookie banner, and
// the first-party controllers under the CSP nonce.
import type { ReactNode } from "react";
import { entityLine, type PublishedContent } from "@infrabyx/cms";
import { CookieBanner } from "@infrabyx/consent";
import { FeedbackTrigger } from "@infrabyx/feedback";
import { AppShell, Footer, Header, copyrightLine, type FooterLink } from "@infrabyx/ui";
import type { RequestContext } from "../server/request.ts";
import { listed } from "../server/site.ts";

interface NavBody {
  location: string;
  items: { label: string; href?: string; children?: unknown[] }[];
}

const linksOf = (menus: PublishedContent[], location: string): FooterLink[] =>
  menus
    .map((m) => m.body as unknown as NavBody)
    .filter((m) => m.location === location)
    .flatMap((m) => m.items)
    .filter((i): i is { label: string; href: string } => Boolean(i.href))
    .map((i) => ({
      label: i.label,
      href: i.href,
      ...(i.href.startsWith("https:") ? { external: true } : {}),
    }));

export interface ShellData {
  nav: { label: string; href: string }[];
  footer: Parameters<typeof Footer>[0];
}

/** Everything the shell shows, from published content only. */
export async function shellData(ctx: RequestContext, now = new Date()): Promise<ShellData> {
  const { site, packId, pack } = ctx;
  const [menus, footers, offices, officers, policies] = await Promise.all([
    listed(site, packId, "nav_menu"),
    listed(site, packId, "footer"),
    listed(site, packId, "office"),
    site.policies.officers(packId),
    site.policies.index(packId, site.env.APP_BASE_URL),
  ]);
  const footer = (footers[0]?.body ?? {}) as {
    description?: string;
    contact?: { phone?: string; email?: string };
    social?: { network: string; url: string; label: string }[];
    disclaimer?: string;
    status_url?: string;
  };
  const le = pack.body.legal_entity;
  const utilities: FooterLink[] = [
    ...(footer.status_url
      ? [{ label: "Service status", href: footer.status_url, external: true }]
      : []),
    { label: "Cookie settings", href: "/cookie-settings" },
    { label: "Accessibility", href: "/accessibility" },
    { label: "Sitemap", href: "/sitemap" },
    { label: "Report a problem", href: "/feedback" },
  ];
  return {
    nav: linksOf(menus, "header").map((l) => ({ label: l.label, href: l.href })),
    footer: {
      brand: {
        name: pack.body.app_name,
        href: "/",
        ...(footer.description ? { line: footer.description } : {}),
      },
      groupLink: { label: "Part of the Infrabyx Group", href: "/about" },
      columns: [
        { heading: "Group companies", links: linksOf(menus, "footer_col_product") },
        { heading: "Resources", links: linksOf(menus, "footer_col_resources") },
        { heading: "Company", links: linksOf(menus, "footer_col_company") },
        {
          heading: "Policies",
          links: policies.policies.map((p) => ({ label: p.title, href: new URL(p.url).pathname })),
        },
      ],
      contact: {
        registeredOffice: le.registered_office.split(/,\s*/),
        phone: footer.contact?.phone ?? "",
        email: footer.contact?.email ?? "",
        offices: offices.map((o) => {
          const b = o.body as { label: string; lines: string[]; city: string; pin: string };
          return { label: b.label, lines: [...b.lines, `${b.city} ${b.pin}`] };
        }),
      },
      entityLine: entityLine({ name: le.name, cin: le.cin, gstin: le.gstin }),
      officers: [
        ...(officers.grievance.name && officers.grievance.email
          ? [
              {
                role: "Grievance Officer",
                name: officers.grievance.name,
                email: officers.grievance.email,
                href: "/grievance",
              },
            ]
          : []),
        ...(officers.dpo.name && officers.dpo.email
          ? [
              {
                role: "Data Protection Officer",
                name: officers.dpo.name,
                email: officers.dpo.email,
                href: "/legal/privacy",
              },
            ]
          : []),
      ],
      social: (footer.social ?? []).map((s) => ({ network: s.label, href: s.url })),
      utilities,
      ...(footer.disclaimer ? { disclaimer: footer.disclaimer } : {}),
      copyright: copyrightLine(le.name, now),
    },
  };
}

/** English now; Hindi is shown as not yet available (OWN-11). */
function LanguageSwitch() {
  return (
    <p className="ibx-lang">
      <span className="ibx-visually-hidden">Language: </span>
      <span aria-current="true">English</span>
      {" · "}
      <span lang="hi">हिन्दी</span> <span className="ibx-lang__note">(coming later)</span>
    </p>
  );
}

export function SiteShell({
  ctx,
  data,
  path,
  children,
}: {
  ctx: RequestContext;
  data: ShellData;
  path: string;
  children: ReactNode;
}) {
  const nav = data.nav.map((n) => ({
    ...n,
    current: n.href === path || (n.href !== "/" && path.startsWith(`${n.href}/`)),
  }));
  return (
    <AppShell
      header={
        <Header
          brand={{
            name: ctx.pack.body.app_name,
            href: "/",
            logoSrc: "/icon.svg",
            logoAlt: `${ctx.pack.body.app_name} home`,
          }}
          nav={nav}
          actions={<LanguageSwitch />}
        />
      }
      footer={<Footer {...data.footer} />}
      afterFooter={
        <>
          <aside className="ibx-feedback-entry" aria-label="Feedback">
            <FeedbackTrigger floating />
          </aside>
          <CookieBanner state={ctx.consent} texts={ctx.cmpTexts} />
          <script src="/consent.js" nonce={ctx.nonce} defer />
          <script src="/feedback.js" nonce={ctx.nonce} defer />
        </>
      }
    >
      {children}
    </AppShell>
  );
}
