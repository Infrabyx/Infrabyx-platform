// Registered body schemas per content type (IPB-04 §04.3.1 "key fields"). A body is parsed, every
// portable-text value in it is sanitised (`IPB-CMS-008` report), and page-like bodies have their
// blocks checked against the block library and the template's required slots.
import { z } from "zod";
import { parseBlocks, type Block, type BlockIssue } from "./blocks.js";
import { PortableTextSchema, safeHref, sanitisePortableText } from "./sanitise.js";
import { missingSlots, TEMPLATES, type ContentType } from "./types.js";

const text = (max: number) => z.string().trim().min(1).max(max);
const href = z.string().refine((h) => safeHref(h) !== null, "a site path, #anchor or https: URL");
const httpsUrl = z
  .string()
  .refine((h) => h.startsWith("https://") && safeHref(h) !== null, "an https: URL");
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");
const mediaId = z.string().regex(/^med_[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
const blocksField = z.array(z.record(z.string(), z.unknown()));

export const NAV_LOCATIONS = [
  "header",
  "mobile",
  "legal",
  "footer_col_product",
  "footer_col_solutions",
  "footer_col_resources",
  "footer_col_company",
] as const;

interface NavItemShape {
  label: string;
  target_item_id?: string | undefined;
  href?: string | undefined;
  new_tab: boolean;
  children: NavItemShape[];
}
const NavItem: z.ZodType<NavItemShape> = z.lazy(() =>
  z
    .object({
      label: text(60),
      target_item_id: z
        .string()
        .regex(/^[a-z]{2,3}_/)
        .optional(),
      href: href.optional(),
      new_tab: z.boolean().default(false),
      children: z.array(NavItem).max(20).default([]),
    })
    .strict()
    .refine(
      (i) => Boolean(i.target_item_id) !== Boolean(i.href),
      "a target item or a link, not both",
    ),
) as z.ZodType<NavItemShape>;

export const SOCIAL_NETWORKS = [
  "linkedin",
  "x",
  "youtube",
  "instagram",
  "facebook",
  "whatsapp_channel",
] as const;

export const BODY_SCHEMAS = {
  page: z.object({ template: z.string(), blocks: blocksField }).strict(),
  landing_page: z.object({ blocks: blocksField, campaign_ref: z.string().optional() }).strict(),
  section: z.object({ blocks: blocksField }).strict(),
  nav_menu: z
    .object({ location: z.enum(NAV_LOCATIONS), items: z.array(NavItem).max(40) })
    .strict()
    .refine(
      (m) => m.location !== "header" || m.items.length <= 7,
      "at most 7 header items (IPB-06-02)",
    ),
  footer: z
    .object({
      description: text(200),
      social: z
        .array(
          z.object({ network: z.enum(SOCIAL_NETWORKS), url: httpsUrl, label: text(80) }).strict(),
        )
        .default([]),
      contact: z
        .object({
          phone: z
            .string()
            .regex(/^\+?[0-9 -]{6,20}$/)
            .optional(),
          email: z.email().optional(),
          support_email: z.email().optional(),
          sales_email: z.email().optional(),
          whatsapp: z
            .string()
            .regex(/^\+?[0-9]{8,15}$/)
            .optional(),
        })
        .strict()
        .default({}),
      disclaimer: text(600).optional(),
      status_url: httpsUrl.optional(),
    })
    .strict(),
  office: z
    .object({
      label: text(60),
      lines: z.array(text(120)).min(1).max(4),
      city: text(60),
      state: text(60),
      pin: z.string().regex(/^[1-9][0-9]{5}$/, "a 6-digit PIN"),
      country: text(60).default("India"),
      phone: z
        .string()
        .regex(/^\+?[0-9 -]{6,20}$/)
        .optional(),
      hours: text(120).optional(),
      map_url: httpsUrl.optional(),
      is_registered_office: z.boolean().default(false),
    })
    .strict(),
  faq: z
    .object({
      question: text(200),
      answer: PortableTextSchema,
      group: z.string().max(60).optional(),
      order: z.number().int().default(0),
      json_ld_eligible: z.boolean().default(true),
    })
    .strict(),
  glossary_term: z
    .object({
      term: text(80),
      definition: PortableTextSchema,
      aliases: z.array(text(80)).default([]),
      hlp_key: z
        .string()
        .regex(/^hlp\./)
        .optional(),
    })
    .strict(),
  job: z
    .object({
      department: text(80),
      location: text(80),
      type: z.enum(["full_time", "part_time", "contract", "internship"]),
      description: PortableTextSchema,
      apply_mode: z.enum(["form", "url", "email"]),
      apply_url: httpsUrl.optional(),
      closes_at: z.iso.datetime({ offset: true }),
      salary_disclosed: z.boolean().default(false),
    })
    .strict(),
  team_member: z
    .object({
      name: text(120),
      role: text(120),
      group: z.enum(["leadership", "team", "advisory", "board"]),
      bio: PortableTextSchema.default([]),
      photo_media_id: mediaId.optional(),
      photo_consent: z.boolean().default(false),
      linkedin_url: httpsUrl.optional(),
      din: z
        .string()
        .regex(/^[0-9]{8}$/)
        .optional(),
      order: z.number().int().default(0),
    })
    .strict(),
  press_item: z
    .object({
      kind: z.enum(["release", "coverage"]),
      outlet: text(120).optional(),
      published_on: date,
      url: httpsUrl.optional(),
      body: PortableTextSchema.default([]),
    })
    .strict()
    .refine(
      (p) => p.kind !== "coverage" || (p.url && p.outlet),
      "coverage needs the outlet and the article URL",
    ),
  legal_page: z
    .object({
      policy_key: z.string().min(1),
      version_label: z.string().regex(/^\d+\.\d+$/),
      effective_at: z.iso.datetime({ offset: true }),
      summary_of_changes: text(1000),
      reconsent_required: z.boolean().default(false),
      body: PortableTextSchema,
    })
    .strict(),
  resource: z
    .object({
      artefact_type: z.string().regex(/^[a-z_]+$/),
      abstract: PortableTextSchema,
      version: z.string().min(1),
      gating: z.enum(["public", "email_gate", "login", "plan"]),
      cite_as: text(400).optional(),
      topics: z.array(z.string()).default([]),
      language: z.string().default("en-IN"),
      file_media_id: mediaId.optional(),
      review_due: date.optional(),
      expires_at: date.optional(),
    })
    .strict(),
  blog_post: z
    .object({
      category: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
      excerpt: text(300),
      body: PortableTextSchema,
      author_ids: z.array(z.string()).default([]),
      hero_media_id: mediaId.optional(),
    })
    .strict(),
  form: z
    .object({
      fields: z
        .array(
          z
            .object({
              name: z.string().regex(/^[a-z_]+$/),
              label: text(80),
              kind: z.enum(["text", "email", "tel", "textarea", "select", "checkbox"]),
              required: z.boolean().default(false),
              personal: z.boolean().default(false),
              autocomplete: z.string().optional(),
              options: z.array(text(80)).optional(),
            })
            .strict(),
        )
        .min(1),
      consent_text_ref: z.string().optional(),
      destination: z.enum([
        "crm_lead",
        "hr_application",
        "support_ticket",
        "dpa_request",
        "grievance",
      ]),
      success_action: z.string().default("message"),
    })
    .strict(),
  pricing_copy: z.record(z.string(), z.unknown()),
  changelog_entry: z
    .object({
      version: z.string().min(1),
      released_on: date,
      audience: z.enum(["public", "tenant"]),
      items: z
        .array(
          z
            .object({ type: z.enum(["added", "changed", "fixed", "removed"]), text: text(300) })
            .strict(),
        )
        .min(1),
    })
    .strict(),
  group_company: z
    .object({
      name: text(120),
      description: PortableTextSchema,
      site_url: httpsUrl.optional(),
      legal_entity_name: text(200),
    })
    .strict(),
  vlog_item: z.record(z.string(), z.unknown()),
  case_study: z.record(z.string(), z.unknown()),
  testimonial: z.record(z.string(), z.unknown()),
} as const satisfies Record<ContentType, z.ZodType>;

export interface ParsedBody {
  body: Record<string, unknown>;
  blocks: Block[];
  issues: BlockIssue[];
  /** Sanitiser removals, saved with the revision (`IPB-CMS-008`). */
  removed: string[];
}

/** Sanitise every portable-text array inside a value, in place of the original. */
function sanitiseDeep(v: unknown, removed: string[]): unknown {
  if (Array.isArray(v)) {
    const looksPt =
      v.length > 0 &&
      v.every(
        (x) => x && typeof x === "object" && typeof (x as { _type?: unknown })._type === "string",
      );
    if (looksPt) {
      const r = sanitisePortableText(v);
      removed.push(...r.removed);
      return r.value;
    }
    return v.map((x) => sanitiseDeep(x, removed));
  }
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) out[k] = sanitiseDeep(x, removed);
    return out;
  }
  return v;
}

/** Parse and sanitise a body for its content type. */
export function parseBody(
  type: ContentType,
  raw: unknown,
  o: { mermaid?: boolean } = {},
): ParsedBody {
  const removed: string[] = [];
  const r = (BODY_SCHEMAS[type] as z.ZodType).safeParse(raw);
  if (!r.success)
    return {
      body: {},
      blocks: [],
      issues: r.error.issues.map((e) => ({ path: `body.${e.path.join(".")}`, message: e.message })),
      removed,
    };
  const body = sanitiseDeep(r.data, removed) as Record<string, unknown>;
  let blocks: Block[] = [];
  const issues: BlockIssue[] = [];
  if (Array.isArray(body.blocks)) {
    const p = parseBlocks(body.blocks, o.mermaid === undefined ? {} : { mermaid: o.mermaid });
    blocks = p.blocks;
    issues.push(...p.issues);
    body.blocks = p.blocks;
  }
  if (type === "page" && !(String(body.template) in TEMPLATES))
    issues.push({ path: "body.template", message: `unknown template ${String(body.template)}` });
  return { body, blocks, issues, removed };
}

/** Required template slots left empty (publish blocks with `IPB-CMS-003`). */
export function emptySlots(
  type: ContentType,
  body: Record<string, unknown>,
  blocks: Block[],
): string[] {
  if (type !== "page") return [];
  return missingSlots(String(body.template), blocks as { type: string; slot?: string }[]);
}
