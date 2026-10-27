// Content types, id prefixes, routes and page templates (IPB-04 §04.3.1, IPB-04-13; PL5 plan §5.3).
// Each content type has a registered body schema (`bodies.ts`); routable types have a route pattern.
// vlog_item, case_study, testimonial and landing_page are registered but refuse publish until their
// gates exist (OWNER-QUESTIONS #42).
export const CONTENT_TYPES = [
  "page",
  "landing_page",
  "section",
  "nav_menu",
  "footer",
  "office",
  "blog_post",
  "vlog_item",
  "resource",
  "faq",
  "glossary_term",
  "job",
  "team_member",
  "press_item",
  "case_study",
  "testimonial",
  "legal_page",
  "changelog_entry",
  "pricing_copy",
  "form",
  "group_company",
] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];

/** Typed id prefixes (`@infrabyx/contracts` ids). */
export const CONTENT_PREFIX: Readonly<Record<ContentType, string>> = {
  page: "pg",
  landing_page: "lp",
  section: "sec",
  nav_menu: "nav",
  footer: "ftr",
  office: "ofc",
  blog_post: "pst",
  vlog_item: "vlg",
  resource: "res",
  faq: "faq",
  glossary_term: "gls",
  job: "job",
  team_member: "tm",
  press_item: "prs",
  case_study: "cs",
  testimonial: "tst",
  legal_page: "lgl",
  changelog_entry: "chg",
  pricing_copy: "prc",
  form: "frm",
  group_company: "gco",
};

/** Deferred types: saved as drafts, never published (OWNER-QUESTIONS #42). */
export const PUBLISH_DEFERRED: ReadonlySet<ContentType> = new Set([
  "vlog_item",
  "case_study",
  "testimonial",
  "landing_page",
]);

/**
 * The default `cms.publish.legal_review_types` (IPB-04-06): these need PLT_LEGAL_REVIEWER
 * approval before publish. The setting may only add types.
 */
export const LEGAL_REVIEW_TYPES = [
  "legal_page",
  "pricing_copy",
  "footer",
  "redirect",
  "brand_pack",
  "investors",
  "trust",
] as const;

/** Route of a published item, or null for embedded types (IPB-04 §04.3.1 route patterns). */
export function routeFor(
  type: ContentType,
  slug: string | null,
  o: { parentPath?: string | null; category?: string | null; artefactType?: string | null } = {},
): string | null {
  if (!slug) return null;
  switch (type) {
    case "page":
      return slug === "home"
        ? "/"
        : `${o.parentPath && o.parentPath !== "/" ? o.parentPath : ""}/${slug}`;
    case "landing_page":
      return `/lp/${slug}`;
    case "blog_post":
      return `/blog/${o.category ?? "general"}/${slug}`;
    case "vlog_item":
      return `/vlog/${slug}`;
    case "resource":
      return `/resources/${o.artefactType ?? "other"}/${slug}`;
    case "glossary_term":
      return `/glossary/${slug}`;
    case "job":
      return `/careers/${slug}`;
    case "press_item":
      return `/press/${slug}`;
    case "case_study":
      return `/case-studies/${slug}`;
    case "legal_page":
      return `/legal/${slug}`;
    case "group_company":
      return `/group-companies/${slug}`;
    default:
      return null;
  }
}

export const isRoutable = (type: ContentType) => routeFor(type, "x") !== null;

/** A template slot: the block types it accepts and whether publish needs it filled. */
export interface TemplateSlot {
  name: string;
  accepts: readonly string[];
  required: boolean;
}

const slot = (name: string, accepts: readonly string[], required = true): TemplateSlot => ({
  name,
  accepts,
  required,
});

/**
 * Page templates and their slots (IPB-04-13, §04.3.7). The home page's proof slot is optional:
 * the owner's rule O-5 keeps stats, logo walls and testimonials off the group site until claims
 * exist, and IPB-04-07 refuses them without a claim anyway (PL5-D-06).
 */
export const TEMPLATES: Readonly<Record<string, readonly TemplateSlot[]>> = {
  home: [
    slot("hero", ["hero"]),
    slot("what", ["feature_grid"]),
    slot("audience", ["feature_grid", "rich_text"]),
    slot("proof", ["logo_wall", "stats"], false),
    slot("how", ["steps"]),
    slot("trust", ["cta", "rich_text"]),
    slot("pricing", ["pricing_table", "cta"], false),
    slot("resources", ["resources_list", "cta"], false),
    slot("cta", ["cta"]),
    slot("faq", ["faq_accordion"]),
  ],
  about: [
    slot("story", ["timeline"]),
    slot("mission", ["rich_text"]),
    slot("boundary", ["rich_text"]),
    slot("group", ["rich_text"]),
    slot("leadership", ["team_grid", "cta"], false),
    slot("contact", ["cta"]),
  ],
  product: [
    slot("hero", ["hero"]),
    slot("features", ["feature_grid"]),
    slot("how", ["steps"], false),
    slot("cta", ["cta"]),
    slot("faq", ["faq_accordion"], false),
  ],
  solution: [
    slot("hero", ["hero"]),
    slot("body", ["rich_text", "feature_grid"]),
    slot("cta", ["cta"]),
  ],
  article: [slot("body", ["rich_text"])],
  legal: [slot("body", ["rich_text"])],
  landing: [
    slot("hero", ["hero"]),
    slot("body", ["rich_text", "feature_grid"], false),
    slot("cta", ["cta"]),
  ],
  people: [slot("team", ["team_grid"])],
  resource_index: [slot("list", ["resources_list"])],
  pricing: [
    slot("table", ["pricing_table"]),
    slot("comparison", ["comparison_table"], false),
    slot("faq", ["faq_accordion"]),
  ],
  contact: [slot("intro", ["rich_text"], false), slot("form", ["form"])],
  trust: [slot("intro", ["rich_text"], false)],
  investors: [slot("disclaimer", ["rich_text"]), slot("body", ["rich_text", "timeline"])],
  careers: [
    slot("culture", ["rich_text"]),
    slot("benefits", ["rich_text"], false),
    slot("apply", ["form"]),
  ],
  press: [slot("contact", ["rich_text"])],
  changelog: [],
  group_companies: [slot("intro", ["rich_text"])],
  blank: [],
};
export type TemplateName = keyof typeof TEMPLATES;

/** Required slots not filled by a block of an accepted type (`IPB-CMS-003`). */
export function missingSlots(
  template: string,
  blocks: readonly { type: string; slot?: string | undefined }[],
): string[] {
  const slots = TEMPLATES[template];
  if (!slots) return [`template:${template}`];
  return slots
    .filter((s) => s.required)
    .filter((s) => !blocks.some((b) => b.slot === s.name && s.accepts.includes(b.type)))
    .map((s) => s.name);
}
