// SEO fields, structured data and the generated files (IPB-04-08, 04-09, 04-70, 04-74;
// `@IPB-04-AT-04`, `@IPB-04-AT-07`; PL5 plan §5.5). Builders are pure: the site passes published
// items and the brand pack's legal entity; nothing here reads the database.
import { z } from "zod";
import { escapeHtml, safeHref } from "./sanitise.js";

export const JSON_LD_TYPES = [
  "Organization",
  "WebPage",
  "Article",
  "FAQPage",
  "Product",
  "JobPosting",
  "BreadcrumbList",
  "VideoObject",
  "SoftwareApplication",
] as const;

export const SeoFields = z
  .object({
    title: z.string().max(200).optional(),
    description: z.string().max(400).optional(),
    canonical: z
      .string()
      .refine((h) => safeHref(h) !== null && !h.startsWith("#"), "a site path or https: URL")
      .optional(),
    robots: z
      .object({ index: z.boolean().default(true), follow: z.boolean().default(true) })
      .strict()
      .default({ index: true, follow: true }),
    json_ld_type: z.enum(JSON_LD_TYPES).default("WebPage"),
    og: z
      .object({
        title: z.string().max(200).optional(),
        description: z.string().max(400).optional(),
        image_media_id: z.string().regex(/^med_/).optional(),
      })
      .strict()
      .default({}),
    twitter_card: z.enum(["summary", "summary_large_image"]).default("summary_large_image"),
  })
  .strict();
export type SeoFields = z.infer<typeof SeoFields>;

/** Length warnings (IPB-04-08: title ≤60, description ≤160); never a refusal. */
export function seoWarnings(seo: SeoFields, title: string): string[] {
  const w: string[] = [];
  const t = seo.title ?? title;
  if (t.length > 60) w.push(`title is ${t.length} characters; keep it to 60`);
  if (!seo.description) w.push("description is missing");
  else if (seo.description.length > 160)
    w.push(`description is ${seo.description.length} characters; keep it to 160`);
  return w;
}

// --- JSON-LD (schema.org) -----------------------------------------------------------------

export interface LegalEntity {
  name: string;
  cin?: string | undefined;
  gstin?: string | undefined;
  registered_office: string;
}

export interface OrganizationInput {
  base: string;
  legalEntity: LegalEntity;
  brandName: string;
  logoUrl?: string;
  sameAs: readonly string[];
  support?: { email?: string; telephone?: string };
  grievance: { name: string; email: string; url?: string };
}

/** Organization JSON-LD with legal name, CIN as an identifier and the grievance contact (IPB-04-70, 04-74). */
export function organizationLd(o: OrganizationInput): Record<string, unknown> {
  const identifier = [
    ...(o.legalEntity.cin
      ? [{ "@type": "PropertyValue", propertyID: "CIN", value: o.legalEntity.cin }]
      : []),
    ...(o.legalEntity.gstin
      ? [{ "@type": "PropertyValue", propertyID: "GSTIN", value: o.legalEntity.gstin }]
      : []),
  ];
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: o.brandName,
    legalName: o.legalEntity.name,
    url: o.base,
    ...(o.logoUrl ? { logo: o.logoUrl } : {}),
    ...(identifier.length ? { identifier } : {}),
    address: { "@type": "PostalAddress", streetAddress: o.legalEntity.registered_office },
    sameAs: [...o.sameAs],
    contactPoint: [
      ...(o.support
        ? [{ "@type": "ContactPoint", contactType: "customer support", ...o.support }]
        : []),
      {
        "@type": "ContactPoint",
        contactType: "grievance officer",
        name: o.grievance.name,
        email: o.grievance.email,
        ...(o.grievance.url ? { url: o.grievance.url } : {}),
      },
    ],
  };
}

export const webPageLd = (o: {
  url: string;
  name: string;
  description?: string;
  dateModified: string;
  inLanguage: string;
}) => ({
  "@context": "https://schema.org",
  "@type": "WebPage",
  url: o.url,
  name: o.name,
  ...(o.description ? { description: o.description } : {}),
  dateModified: o.dateModified,
  inLanguage: o.inLanguage,
});

export const articleLd = (o: {
  url: string;
  headline: string;
  datePublished: string;
  dateModified: string;
  authors: readonly string[];
  publisher: string;
}) => ({
  "@context": "https://schema.org",
  "@type": "Article",
  mainEntityOfPage: o.url,
  headline: o.headline.slice(0, 110),
  datePublished: o.datePublished,
  dateModified: o.dateModified,
  author: o.authors.map((name) => ({ "@type": "Person", name })),
  publisher: { "@type": "Organization", name: o.publisher },
});

/** FAQPage only when every item is eligible (IPB-04 block table). */
export function faqPageLd(
  items: readonly { question: string; answer: string; eligible: boolean }[],
) {
  if (!items.length || items.some((i) => !i.eligible)) return null;
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((i) => ({
      "@type": "Question",
      name: i.question,
      acceptedAnswer: { "@type": "Answer", text: i.answer },
    })),
  };
}

export const breadcrumbLd = (base: string, crumbs: readonly { name: string; path: string }[]) => ({
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: crumbs.map((c, i) => ({
    "@type": "ListItem",
    position: i + 1,
    name: c.name,
    item: new URL(c.path, base).toString(),
  })),
});

export const jobPostingLd = (o: {
  title: string;
  description: string;
  datePosted: string;
  validThrough: string;
  employmentType: string;
  hiringOrganization: string;
  location: string;
}) => ({
  "@context": "https://schema.org",
  "@type": "JobPosting",
  title: o.title,
  description: o.description,
  datePosted: o.datePosted,
  validThrough: o.validThrough,
  employmentType: o.employmentType.toUpperCase(),
  hiringOrganization: { "@type": "Organization", name: o.hiringOrganization },
  jobLocation: {
    "@type": "Place",
    address: { "@type": "PostalAddress", addressLocality: o.location, addressCountry: "IN" },
  },
});

export const videoObjectLd = (o: {
  name: string;
  description: string;
  thumbnailUrl: string;
  uploadDate: string;
  duration?: string;
}) => ({
  "@context": "https://schema.org",
  "@type": "VideoObject",
  ...o,
});

/** A JSON-LD object as a script element; `<` is escaped so the payload cannot close the tag. */
export const ldScript = (ld: unknown, nonce?: string) =>
  `<script type="application/ld+json"${nonce ? ` nonce="${escapeHtml(nonce)}"` : ""}>${JSON.stringify(ld).replace(/</g, "\\u003c")}</script>`;

// --- Generated files ----------------------------------------------------------------------

export interface SiteEntry {
  path: string;
  type: string;
  locale: string;
  title: string;
  /** One line for llms.txt. */
  summary: string;
  lastmod: string;
  /** Alternate locales of the same translation group: locale → path. */
  alternates?: Readonly<Record<string, string>>;
  noindex?: boolean;
}

const xml = (s: string) => escapeHtml(s);
const abs = (base: string, path: string) => new URL(path, base).toString();

/** `/sitemap.xml`: an index of one sitemap per content type (IPB-04-09). */
export function sitemapIndex(base: string, entries: readonly SiteEntry[]): string {
  const types = [...new Set(entries.filter((e) => !e.noindex).map((e) => e.type))].sort();
  const last = (t: string) =>
    entries.filter((e) => e.type === t).reduce((m, e) => (e.lastmod > m ? e.lastmod : m), "");
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    types
      .map(
        (t) =>
          `  <sitemap><loc>${xml(abs(base, `/sitemap-${t}.xml`))}</loc><lastmod>${xml(last(t))}</lastmod></sitemap>`,
      )
      .join("\n") +
    "\n</sitemapindex>\n"
  );
}

/** `/sitemap-{type}.xml` with `lastmod` from the published revision and hreflang alternates. */
export function sitemapFor(base: string, entries: readonly SiteEntry[], type: string): string {
  const rows = entries
    .filter((e) => e.type === type && !e.noindex)
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((e) => {
      const alt = Object.entries(e.alternates ?? {})
        .map(
          ([l, p]) =>
            `\n    <xhtml:link rel="alternate" hreflang="${xml(l)}" href="${xml(abs(base, p))}"/>`,
        )
        .join("");
      return `  <url><loc>${xml(abs(base, e.path))}</loc><lastmod>${xml(e.lastmod)}</lastmod>${alt}</url>`;
    });
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n' +
    rows.join("\n") +
    "\n</urlset>\n"
  );
}

/** `/robots.txt` per brand pack; an unknown host's default pack disallows everything (IPB-BRD-007). */
export function robotsTxt(o: { base: string; noindex?: boolean }): string {
  if (o.noindex) return "User-agent: *\nDisallow: /\n";
  return [
    "User-agent: *",
    "Disallow: /api/",
    "Disallow: /preview/",
    "Disallow: /studio/",
    "Allow: /",
    "",
    `Sitemap: ${abs(o.base, "/sitemap.xml")}`,
    "",
  ].join("\n");
}

/** `/llms.txt`: a curated list of public pages and resources with one-line summaries (IPB-04-09). */
export function llmsTxt(o: {
  siteName: string;
  base: string;
  summary: string;
  entries: readonly SiteEntry[];
}): string {
  const groups = new Map<string, SiteEntry[]>();
  for (const e of o.entries.filter((x) => !x.noindex))
    groups.set(e.type, [...(groups.get(e.type) ?? []), e]);
  const label = (t: string) => t.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()) + "s";
  const body = [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([t, es]) =>
        `## ${label(t)}\n\n` +
        es
          .sort((a, b) => a.path.localeCompare(b.path))
          .map((e) => `- [${e.title}](${abs(o.base, e.path)}): ${e.summary}`)
          .join("\n"),
    )
    .join("\n\n");
  return `# ${o.siteName}\n\n> ${o.summary}\n\n${body}\n`;
}

/** `/llms-full.txt`: the same list with the full plain text of each page. */
export function llmsFullTxt(
  o: { siteName: string; base: string; summary: string },
  pages: readonly { entry: SiteEntry; text: string }[],
): string {
  return (
    `# ${o.siteName}\n\n> ${o.summary}\n\n` +
    pages
      .filter((p) => !p.entry.noindex)
      .map((p) => `## ${p.entry.title}\n\nURL: ${abs(o.base, p.entry.path)}\n\n${p.text.trim()}\n`)
      .join("\n")
  );
}

/** RSS 2.0 for the blog when it is enabled (IPB-04-09). */
export function rssFeed(o: {
  title: string;
  base: string;
  description: string;
  items: readonly { title: string; path: string; summary: string; published: string }[];
}): string {
  const items = o.items
    .map(
      (i) =>
        `    <item><title>${xml(i.title)}</title><link>${xml(abs(o.base, i.path))}</link><guid>${xml(abs(o.base, i.path))}</guid><pubDate>${new Date(i.published).toUTCString()}</pubDate><description>${xml(i.summary)}</description></item>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0">\n  <channel>\n    <title>${xml(o.title)}</title>\n    <link>${xml(o.base)}</link>\n    <description>${xml(o.description)}</description>\n${items}\n  </channel>\n</rss>\n`;
}
