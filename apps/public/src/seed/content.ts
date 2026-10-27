// Seed content of the group site (PL5 plan §9.2, §9.5; owner rules O-1, O-5). Every text is plain
// and modest: no figures, logos, testimonials, client or customer names, and none of the claims
// lint's banned, category or certification phrases. Entity, officer and office details come from
// `SEED_GROUP_*` (reserved example values by default). Descriptions the owner has not supplied are
// marked as placeholders rather than invented.
import type { BrandPackBodyInput, LogoPngs, MediaRef } from "@infrabyx/brand";
import type { GroupSeedEnv } from "./env.ts";

/** A portable-text paragraph, heading or list (the CMS rich-text shape). */
const span = (text: string) => ({ _type: "span", text, marks: [] as string[] });
export const para = (text: string) => ({
  _type: "block",
  style: "normal",
  children: [span(text)],
  markDefs: [],
});
export const heading = (text: string, style: "h2" | "h3" = "h2") => ({
  _type: "block",
  style,
  children: [span(text)],
  markDefs: [],
});
export const bullet = (text: string) => ({
  _type: "block",
  style: "normal",
  listItem: "bullet",
  level: 1,
  children: [span(text)],
  markDefs: [],
});
const rich = (slot: string, ...content: Record<string, unknown>[]) => ({
  type: "rich_text",
  slot,
  content,
});

/** The group's products, by the names the owner uses (descriptions come from the owner in Studio). */
export const GROUP_COMPANIES = [
  { slug: "udofin", name: "Udofin" },
  { slug: "finbyx", name: "Finbyx" },
  { slug: "lawdocs", name: "LawDocs" },
  { slug: "lawdocscomply", name: "LawDocsComply" },
  { slug: "equator", name: "Equator" },
  { slug: "operations-hub", name: "Operations Hub" },
] as const;

export const PLACEHOLDER_DESCRIPTION =
  "Placeholder description for development and testing. The approved description is entered in Studio.";

/** The wordmark used as the group pack's logo (sanitised on upload like any other SVG). */
export const LOGO_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 48" role="img" aria-label="Infrabyx Group">' +
  '<rect width="48" height="48" rx="8" fill="#1F4E79"/>' +
  '<path d="M14 12h6v24h-6zM26 12h8a8 8 0 0 1 0 16h-2v8h-6z" fill="#FFFFFF"/>' +
  "</svg>";

export const contactForm = {
  fields: [
    {
      name: "full_name",
      label: "Your name",
      kind: "text",
      required: true,
      personal: true,
      autocomplete: "name",
    },
    {
      name: "email",
      label: "Email address",
      kind: "email",
      required: true,
      personal: true,
      autocomplete: "email",
    },
    {
      name: "organisation",
      label: "Organisation (optional)",
      kind: "text",
      autocomplete: "organization",
    },
    { name: "message", label: "How can we help?", kind: "textarea", required: true },
  ],
  consent_text_ref: "consent.contact_form",
  destination: "crm_lead",
};

export const careersForm = {
  fields: [
    {
      name: "full_name",
      label: "Your name",
      kind: "text",
      required: true,
      personal: true,
      autocomplete: "name",
    },
    {
      name: "email",
      label: "Email address",
      kind: "email",
      required: true,
      personal: true,
      autocomplete: "email",
    },
    {
      name: "message",
      label: "Tell us about the work you would like to do",
      kind: "textarea",
      required: true,
    },
  ],
  consent_text_ref: "consent.careers",
  destination: "hr_application",
};

export const homePage = {
  template: "home",
  blocks: [
    {
      type: "hero",
      slot: "hero",
      heading: "Software for legal, compliance and finance work",
      sub: "The Infrabyx Group builds products for organisations and professionals in India, on one shared platform.",
      primary_cta: { label: "Our group companies", href: "/group-companies" },
      secondary_cta: { label: "Contact us", href: "/contact" },
    },
    {
      type: "feature_grid",
      slot: "what",
      columns: 3,
      items: [
        {
          title: "Legal work",
          text: "Products that help people prepare, review and keep legal documents.",
        },
        {
          title: "Compliance",
          text: "Products that help organisations track filings, deadlines and records.",
        },
        {
          title: "Finance",
          text: "Products for lending and finance teams, built with the records regulators expect.",
        },
      ],
    },
    rich(
      "audience",
      heading("Who we work with"),
      para(
        "Businesses, professionals and teams in India who want clear, accessible software and plain answers about how their data is handled.",
      ),
    ),
    {
      type: "steps",
      slot: "how",
      items: [
        {
          title: "One shared platform",
          text: "Every group product uses the same foundations for sign-in, audit records, consent and help.",
        },
        {
          title: "Records you can check",
          text: "Changes are recorded in an audit ledger, and policies keep every earlier version readable.",
        },
        {
          title: "Accessible by default",
          text: "Pages are tested against WCAG 2.2 AA, and you can report any barrier you meet.",
        },
      ],
    },
    {
      type: "cta",
      slot: "trust",
      heading: "Trust and data protection",
      text: "Read how we protect data and the documents we publish.",
      button: { label: "Visit the Trust Centre", href: "/trust" },
      variant: "secondary",
    },
    {
      type: "cta",
      slot: "cta",
      heading: "Work with us",
      text: "See open roles, or send us a general application.",
      button: { label: "Careers", href: "/careers" },
    },
    {
      type: "faq_accordion",
      slot: "faq",
      items: [
        {
          question: "Which companies are part of the group?",
          answer: [
            para("The group companies page lists each one with its own site and legal entity."),
          ],
        },
        {
          question: "How do I raise a complaint?",
          answer: [
            para(
              "Write to the Grievance Officer named in the footer, or use the grievance page. We acknowledge every complaint.",
            ),
          ],
        },
      ],
    },
  ],
};

export const aboutPage = {
  template: "about",
  blocks: [
    {
      type: "timeline",
      slot: "story",
      items: [
        {
          date: "2026",
          title: "The group's products move to one shared platform",
          text: "Tenancy, audit, consent, help and accessibility are built once and shared.",
        },
      ],
    },
    rich(
      "mission",
      heading("What we do"),
      para(
        "We build software that makes legal, compliance and finance work clearer for the people who do it and the people it affects.",
      ),
    ),
    rich(
      "boundary",
      heading("What this site is not"),
      para(
        "The group's companies provide software and services. Nothing on this site is legal, financial or investment advice.",
      ),
    ),
    rich(
      "group",
      heading("Part of the Infrabyx Group"),
      para(
        "Each group company has its own site and legal entity. The group companies page lists them.",
      ),
    ),
    {
      type: "cta",
      slot: "contact",
      heading: "Questions about the group?",
      button: { label: "Contact us", href: "/contact" },
    },
  ],
};

export const groupCompaniesPage = {
  template: "group_companies",
  blocks: [
    rich(
      "intro",
      para("The companies and products of the Infrabyx Group, each with its own legal entity."),
    ),
  ],
};

export const careersPage = (formId: string) => ({
  template: "careers",
  blocks: [
    rich(
      "culture",
      heading("Working at the group"),
      para(
        "We build products that people rely on for important work, so we value care, clear writing and accessible design.",
      ),
    ),
    { type: "form", slot: "apply", form_id: formId },
  ],
});

export const trustPage = {
  template: "trust",
  blocks: [
    rich(
      "intro",
      para(
        "How we protect data, the documents we publish, and how to report a security issue. Each document shows the date it was published.",
      ),
    ),
  ],
};

export const contactPage = (formId: string) => ({
  template: "contact",
  blocks: [
    rich(
      "intro",
      para("Send us a message and we will reply by email. For complaints, use the grievance page."),
    ),
    { type: "form", slot: "form", form_id: formId },
  ],
});

/** Hidden by setting (O-1): drafts only, never published, so their routes return 404. */
export const investorsPage = {
  template: "investors",
  blocks: [
    rich("disclaimer", para("Placeholder. The Investors page is off for the group site.")),
    rich("body", para("Placeholder.")),
  ],
};
export const blogPost = {
  category: "general",
  excerpt: "Placeholder post; the blog is off for the group site.",
  body: [para("Placeholder.")],
};

const officeOf = (label: string, city: string, state: string, raw: string, registered: boolean) => {
  const parts = raw.split("|");
  const pin = parts.pop()!;
  return {
    label,
    lines: parts,
    city,
    state,
    pin,
    is_registered_office: registered,
  };
};

export const offices = (e: GroupSeedEnv) => [
  officeOf("Delhi office (registered office)", "Delhi", "Delhi", e.SEED_GROUP_OFFICE_DELHI, true),
  officeOf("Noida office", "Noida", "Uttar Pradesh", e.SEED_GROUP_OFFICE_NOIDA, false),
  officeOf("Jaipur office", "Jaipur", "Rajasthan", e.SEED_GROUP_OFFICE_JAIPUR, false),
];

export const footer = (e: GroupSeedEnv) => ({
  description: "Software for legal, compliance and finance work in India.",
  social: [{ network: "linkedin", url: e.SEED_GROUP_SOCIAL_URL, label: "The group on LinkedIn" }],
  contact: { phone: e.SEED_GROUP_PHONE, email: e.SEED_GROUP_EMAIL },
  disclaimer:
    "The group's companies provide software and services. Nothing on this site is legal, financial or investment advice.",
  status_url: e.SEED_GROUP_STATUS_URL,
});

const link = (label: string, href: string) => ({ label, href });

export const menus = [
  {
    title: "Header",
    body: {
      location: "header",
      items: [
        link("About", "/about"),
        link("Group companies", "/group-companies"),
        link("Careers", "/careers"),
        link("Trust", "/trust"),
        link("Contact", "/contact"),
        link("Policies", "/legal"),
      ],
    },
  },
  {
    title: "Footer — group companies",
    body: {
      location: "footer_col_product",
      items: GROUP_COMPANIES.map((c) => link(c.name, `/group-companies/${c.slug}`)),
    },
  },
  {
    title: "Footer — resources",
    body: {
      location: "footer_col_resources",
      items: [link("Glossary", "/glossary"), link("Accessibility", "/accessibility")],
    },
  },
  {
    title: "Footer — company",
    body: {
      location: "footer_col_company",
      items: [
        link("About", "/about"),
        link("Careers", "/careers"),
        link("Trust", "/trust"),
        link("Contact", "/contact"),
      ],
    },
  },
];

/** The brand pack body (Ecosystem `tenancy/brand_pack/1.0.0`), from configuration. */
export const brandBody = (
  e: GroupSeedEnv,
  logo: { svg: MediaRef; png: LogoPngs },
  policySetId: string,
): BrandPackBodyInput => ({
  app_name: "Infrabyx Group",
  legal_entity: {
    name: e.SEED_GROUP_ENTITY_NAME,
    cin: e.SEED_GROUP_CIN,
    gstin: e.SEED_GROUP_GSTIN,
    registered_office: e.SEED_GROUP_REGISTERED_OFFICE,
    entity_type: "PRIVATE_LIMITED",
  },
  tokens: {
    colour: { primary: "#1F2937", accent: "#2563EB" },
    font: { sans: "system-ui", mono: "ui-monospace" },
  },
  logo,
  policy_set_id: policySetId,
  consent_config: {
    region_default: "IN",
    regions: ["IN", "EU", "US-CA", "OTHER"],
    categories: ["necessary", "functional", "analytics", "marketing"],
    style: "bottom_sheet",
    cmp_notice_version: "1.0",
  },
  email_identity: { from_name: "Infrabyx Group", from_address: e.SEED_GROUP_EMAIL },
});
