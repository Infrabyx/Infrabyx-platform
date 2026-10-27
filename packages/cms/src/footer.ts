// The footer validator (IPB-04 §04.3.8, IPB-04-71, 04-72, 04-74; `@IPB-04-AT-73`; owner rule O-4).
// The entity line and officers line are built here as text from the brand pack's legal entity
// and the policy set's officers; no component holds a literal entity name. `validateFooter` names
// the pack and every empty mandatory field; `infrabyx-cms validate-footer` fails CI on any.
export interface FooterInput {
  /** The brand pack id or label, as the report names it. */
  pack: string;
  brand: { logo: boolean; description?: string | undefined; groupUrl?: string | undefined };
  /** Item counts of the footer menus. */
  menus: { product: number; resources: number; company: number };
  legal: { adopted: readonly string[]; linked: readonly string[] };
  legalEntity: {
    name?: string | undefined;
    cin?: string | undefined;
    gstin?: string | undefined;
    registeredOffice?: string | undefined;
  };
  officers: {
    grievance?: { name?: string | undefined; email?: string | undefined } | undefined;
    dpo?: { name?: string | undefined; email?: string | undefined } | undefined;
  };
  contact: { phone?: string | undefined; email?: string | undefined };
  offices: readonly { label: string; city: string; isRegisteredOffice: boolean }[];
  social: readonly { label: string; url: string }[];
  utilities: {
    statusUrl?: string | undefined;
    languageSwitch: boolean;
    cookieSettings: boolean;
    accessibility: boolean;
    sitemap: boolean;
    reportProblem: boolean;
  };
  disclaimer?: string | undefined;
  copyrightYear?: number | undefined;
}

export interface FooterFinding {
  pack: string;
  field: string;
}

/** The offices IPB-04-72 seeds for every product. */
export const SEEDED_OFFICE_CITIES = ["Delhi", "Noida", "Jaipur"] as const;

const blank = (s: string | undefined | null) => !s || !s.trim();

/** "{legal name} · CIN {cin} · GSTIN {gstin}" (IPB-04 §04.3.8 entity line). */
export function entityLine(e: FooterInput["legalEntity"]): string {
  return [e.name, e.cin ? `CIN ${e.cin}` : null, e.gstin ? `GSTIN ${e.gstin}` : null]
    .filter(Boolean)
    .join(" · ");
}

/** "Grievance Officer: {name}, {email} · Data Protection Officer: {name}, {email}". */
export function officersLine(o: FooterInput["officers"]): string {
  return [
    o.grievance ? `Grievance Officer: ${o.grievance.name}, ${o.grievance.email}` : null,
    o.dpo ? `Data Protection Officer: ${o.dpo.name}, ${o.dpo.email}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

export const copyrightLine = (legalName: string, year: number) =>
  `© ${year} ${legalName}. All rights reserved.`;

export function validateFooter(f: FooterInput, now: Date = new Date()): FooterFinding[] {
  const out: string[] = [];
  if (!f.brand.logo) out.push("brand.logo");
  if (blank(f.brand.description)) out.push("brand.description");
  if (blank(f.brand.groupUrl)) out.push("brand.group_url");
  if (f.menus.product < 3) out.push("menus.footer_col_product (at least 3 items)");
  if (f.menus.resources < 1) out.push("menus.footer_col_resources");
  if (f.menus.company < 1) out.push("menus.footer_col_company");
  if (!f.legal.adopted.length) out.push("legal (no adopted policies)");
  for (const k of f.legal.adopted) if (!f.legal.linked.includes(k)) out.push(`legal.${k}`);
  if (blank(f.legalEntity.name)) out.push("legal_entity.name");
  if (blank(f.legalEntity.cin)) out.push("legal_entity.cin");
  if (blank(f.legalEntity.gstin)) out.push("legal_entity.gstin");
  if (blank(f.legalEntity.registeredOffice)) out.push("legal_entity.registered_office");
  if (blank(f.officers.grievance?.name)) out.push("officers.grievance.name");
  if (blank(f.officers.grievance?.email)) out.push("officers.grievance.email");
  if (blank(f.officers.dpo?.name)) out.push("officers.dpo.name");
  if (blank(f.officers.dpo?.email)) out.push("officers.dpo.email");
  if (blank(f.contact.phone)) out.push("contact.phone");
  if (blank(f.contact.email)) out.push("contact.email");
  if (!f.offices.some((o) => o.isRegisteredOffice)) out.push("offices.registered_office");
  for (const city of SEEDED_OFFICE_CITIES)
    if (!f.offices.some((o) => o.city.toLowerCase() === city.toLowerCase()))
      out.push(`offices.${city.toLowerCase()}`);
  if (!f.social.length) out.push("social (at least one)");
  f.social.forEach((s, i) => {
    if (blank(s.label)) out.push(`social[${i}].label`);
  });
  if (blank(f.utilities.statusUrl)) out.push("utilities.status_url");
  for (const k of [
    "languageSwitch",
    "cookieSettings",
    "accessibility",
    "sitemap",
    "reportProblem",
  ] as const)
    if (!f.utilities[k]) out.push(`utilities.${k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)}`);
  if (blank(f.disclaimer)) out.push("disclaimer");
  if (f.copyrightYear !== undefined && f.copyrightYear !== now.getUTCFullYear())
    out.push("copyright.year");
  return out.map((field) => ({ pack: f.pack, field }));
}

/** One line per finding, for CI. */
export const footerReport = (findings: readonly FooterFinding[]) =>
  findings
    .map((x) => `IPB-CMS-003 footer: pack ${x.pack}: ${x.field} is empty or missing`)
    .join("\n");

/** What the footer needs beyond CMS content: the brand pack, policy set and shell (session 5, 7). */
export interface FooterContext {
  pack: string;
  brand: FooterInput["brand"];
  legalEntity: FooterInput["legalEntity"];
  officers: FooterInput["officers"];
  legal: FooterInput["legal"];
  /** Rendered by the `@infrabyx/ui` footer shell: language switch, cookie settings, links. */
  shell: Omit<FooterInput["utilities"], "statusUrl">;
}

interface PublishedLike {
  type: string;
  body: Record<string, unknown>;
}

/** Build the validator input from a pack's published footer, footer menus and offices. */
export function footerInputFrom(
  published: readonly PublishedLike[],
  c: FooterContext,
  now = new Date(),
): FooterInput {
  const footer = published.find((p) => p.type === "footer")?.body ?? {};
  const menus = published.filter((p) => p.type === "nav_menu").map((p) => p.body);
  const count = (loc: string) =>
    menus
      .filter((m) => m.location === loc)
      .reduce((n, m) => n + (Array.isArray(m.items) ? m.items.length : 0), 0);
  const offices = published
    .filter((p) => p.type === "office")
    .map((p) => ({
      label: String(p.body.label ?? ""),
      city: String(p.body.city ?? ""),
      isRegisteredOffice: p.body.is_registered_office === true,
    }));
  const contact = (footer.contact ?? {}) as {
    phone?: string;
    email?: string;
    support_email?: string;
  };
  return {
    pack: c.pack,
    brand: {
      ...c.brand,
      description: (footer.description as string | undefined) ?? c.brand.description,
    },
    menus: {
      product: count("footer_col_product"),
      resources: count("footer_col_resources"),
      company: count("footer_col_company"),
    },
    legal: c.legal,
    legalEntity: c.legalEntity,
    officers: c.officers,
    contact: { phone: contact.phone, email: contact.email ?? contact.support_email },
    offices,
    social: ((footer.social ?? []) as { label: string; url: string }[]).map((s) => ({
      label: s.label,
      url: s.url,
    })),
    utilities: { ...c.shell, statusUrl: footer.status_url as string | undefined },
    disclaimer: footer.disclaimer as string | undefined,
    copyrightYear: now.getUTCFullYear(),
  };
}
