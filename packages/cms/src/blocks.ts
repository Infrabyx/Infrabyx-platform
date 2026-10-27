// The PL5 block library (IPB-04 §04.3.1 block table; PL5 plan §5.3). Each block has a schema; a
// body that does not match is `IPB-CMS-001` with the field path. Guard rails that need the
// Claims Register or the media library run in `lint.ts` at submit.
import { z } from "zod";
import { PortableTextSchema, safeHref } from "./sanitise.js";

const text = (max: number) => z.string().trim().min(1).max(max);
const href = z.string().refine((h) => safeHref(h) !== null, "a site path, #anchor or https: URL");
const mediaId = z.string().regex(/^med_[0-7][0-9A-HJKMNP-TV-Z]{25}$/, "a media library id");
const claimRef = z.string().regex(/^clm_[0-7][0-9A-HJKMNP-TV-Z]{25}$/, "a Claims Register id");
const cta = z.object({ label: text(60), href }).strict();
const common = {
  slot: z
    .string()
    .regex(/^[a-z_]+$/)
    .optional(),
  key: z.string().max(40).optional(),
};

/** Embed providers allowed in `embed` (fetched server-side only, through EGRESS). */
export const EMBED_PROVIDERS = ["youtube", "vimeo"] as const;

export const BLOCK_SCHEMAS = {
  hero: z
    .object({
      type: z.literal("hero"),
      ...common,
      eyebrow: text(60).optional(),
      heading: text(120),
      sub: text(300).optional(),
      primary_cta: cta.optional(),
      secondary_cta: cta.optional(),
      media_id: mediaId.optional(),
    })
    .strict(),
  feature_grid: z
    .object({
      type: z.literal("feature_grid"),
      ...common,
      columns: z.number().int().min(2).max(4).default(3),
      items: z
        .array(
          z
            .object({
              icon: z
                .string()
                .regex(/^[a-z0-9-]+$/)
                .optional(),
              title: text(80),
              text: text(400),
              link: href.optional(),
            })
            .strict(),
        )
        .min(1)
        .max(12),
    })
    .strict(),
  steps: z
    .object({
      type: z.literal("steps"),
      ...common,
      items: z
        .array(z.object({ title: text(80), text: text(400) }).strict())
        .min(2)
        .max(10),
    })
    .strict(),
  rich_text: z
    .object({ type: z.literal("rich_text"), ...common, content: PortableTextSchema })
    .strict(),
  media: z
    .object({
      type: z.literal("media"),
      ...common,
      media_id: mediaId,
      caption: text(200).optional(),
    })
    .strict(),
  cta: z
    .object({
      type: z.literal("cta"),
      ...common,
      heading: text(120),
      text: text(300).optional(),
      button: cta,
      variant: z.enum(["primary", "secondary"]).default("primary"),
    })
    .strict(),
  faq_accordion: z
    .object({
      type: z.literal("faq_accordion"),
      ...common,
      faq_ids: z.array(z.string().regex(/^faq_/)).max(50).default([]),
      items: z
        .array(z.object({ question: text(200), answer: PortableTextSchema }).strict())
        .max(50)
        .default([]),
    })
    .strict()
    .refine((b) => b.faq_ids.length + b.items.length > 0, "at least one question"),
  resources_list: z
    .object({
      type: z.literal("resources_list"),
      ...common,
      filters: z
        .object({ artefact_type: z.string().optional(), topic: z.string().optional() })
        .strict()
        .default({}),
      limit: z.number().int().min(1).max(50).default(6),
    })
    .strict(),
  team_grid: z
    .object({
      type: z.literal("team_grid"),
      ...common,
      group: z.enum(["leadership", "team", "advisory", "board"]),
      layout: z.enum(["grid", "list"]).default("grid"),
    })
    .strict(),
  timeline: z
    .object({
      type: z.literal("timeline"),
      ...common,
      items: z
        .array(
          z
            .object({
              date: z.string().regex(/^\d{4}(-\d{2}(-\d{2})?)?$/, "YYYY, YYYY-MM or YYYY-MM-DD"),
              title: text(120),
              text: text(400).optional(),
              claims_ref: claimRef.optional(),
            })
            .strict(),
        )
        .min(1),
    })
    .strict(),
  stats: z
    .object({
      type: z.literal("stats"),
      ...common,
      items: z
        .array(
          z.object({ value: text(40), label: text(80), claims_ref: claimRef.optional() }).strict(),
        )
        .min(1)
        .max(8),
    })
    .strict(),
  logo_wall: z
    .object({
      type: z.literal("logo_wall"),
      ...common,
      logos: z
        .array(
          z.object({ media_id: mediaId, org: text(120), claims_ref: claimRef.optional() }).strict(),
        )
        .min(1),
    })
    .strict(),
  testimonial: z
    .object({
      type: z.literal("testimonial"),
      ...common,
      testimonial_ids: z.array(z.string().regex(/^tst_/)).min(1),
    })
    .strict(),
  form: z
    .object({ type: z.literal("form"), ...common, form_id: z.string().regex(/^frm_/) })
    .strict(),
  pricing_table: z
    .object({
      type: z.literal("pricing_table"),
      ...common,
      plan_refs: z.array(z.string().min(1)).min(1),
      copy_id: z.string().regex(/^prc_/).optional(),
    })
    .strict(),
  comparison_table: z
    .object({
      type: z.literal("comparison_table"),
      ...common,
      columns: z.array(text(80)).min(2),
      rows: z.array(z.array(z.string().max(200))).min(1),
      footnotes: z.array(text(300)).default([]),
      as_of: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      names_competitor: z.boolean().default(false),
    })
    .strict(),
  embed: z
    .object({
      type: z.literal("embed"),
      ...common,
      provider: z.string(),
      url: z.string().url(),
      consent_category: z.enum(["functional", "analytics", "marketing"]).default("functional"),
      title: text(120),
    })
    .strict(),
  mermaid: z
    .object({
      type: z.literal("mermaid"),
      ...common,
      source: z.string().min(1).max(20_000),
      caption: text(200),
      fallback_text: text(2000),
    })
    .strict(),
} as const;

export type BlockType = keyof typeof BLOCK_SCHEMAS;
export const BLOCK_TYPES = Object.keys(BLOCK_SCHEMAS) as BlockType[];

const tabs = z
  .object({
    type: z.literal("tabs"),
    ...common,
    tabs: z
      .array(
        z
          .object({ label: text(40), blocks: z.array(z.record(z.string(), z.unknown())).min(1) })
          .strict(),
      )
      .min(2)
      .max(8),
  })
  .strict();

export type Block = z.infer<(typeof BLOCK_SCHEMAS)[BlockType]> | z.infer<typeof tabs>;

export interface BlockIssue {
  path: string;
  message: string;
}

/**
 * Parse a block list. Unknown types, schema errors, nested tabs, more than one hero, and blocks
 * that are switched off (`mermaid` while `cms.blocks.mermaid.enabled` is false) are issues.
 */
export function parseBlocks(
  input: unknown,
  o: { mermaid?: boolean; path?: string } = {},
): { blocks: Block[]; issues: BlockIssue[] } {
  const base = o.path ?? "blocks";
  const issues: BlockIssue[] = [];
  const blocks: Block[] = [];
  if (!Array.isArray(input))
    return { blocks, issues: [{ path: base, message: "a list of blocks" }] };
  input.forEach((raw, i) => {
    const path = `${base}[${i}]`;
    const type = (raw as { type?: unknown })?.type;
    if (type === "tabs") {
      const r = tabs.safeParse(raw);
      if (!r.success) {
        for (const e of r.error.issues)
          issues.push({ path: `${path}.${e.path.join(".")}`, message: e.message });
        return;
      }
      const parsed = r.data.tabs.map((t, j) => {
        if (t.blocks.some((b) => (b as { type?: unknown }).type === "tabs"))
          issues.push({ path: `${path}.tabs[${j}]`, message: "tabs cannot contain tabs" });
        const inner = parseBlocks(
          t.blocks.filter((b) => (b as { type?: unknown }).type !== "tabs"),
          { ...o, path: `${path}.tabs[${j}].blocks` },
        );
        issues.push(...inner.issues);
        return { label: t.label, blocks: inner.blocks as unknown as Record<string, unknown>[] };
      });
      blocks.push({ ...r.data, tabs: parsed });
      return;
    }
    if (typeof type !== "string" || !(type in BLOCK_SCHEMAS)) {
      issues.push({ path: `${path}.type`, message: `unknown block type ${String(type)}` });
      return;
    }
    if (type === "mermaid" && !o.mermaid) {
      issues.push({ path, message: "the mermaid block is off (cms.blocks.mermaid.enabled)" });
      return;
    }
    const r = BLOCK_SCHEMAS[type as BlockType].safeParse(raw);
    if (!r.success) {
      for (const e of r.error.issues)
        issues.push({ path: `${path}.${e.path.join(".")}`, message: e.message });
      return;
    }
    if (
      type === "embed" &&
      !(EMBED_PROVIDERS as readonly string[]).includes((r.data as { provider: string }).provider)
    )
      issues.push({ path: `${path}.provider`, message: "provider not on the embed allow-list" });
    blocks.push(r.data as Block);
  });
  if (blocks.filter((b) => b.type === "hero").length > 1)
    issues.push({ path: base, message: "one hero per page" });
  return { blocks, issues };
}

/** Every block, including those inside tabs. */
export function flattenBlocks(blocks: readonly Block[]): Block[] {
  const out: Block[] = [];
  for (const b of blocks) {
    out.push(b);
    if (b.type === "tabs") for (const t of b.tabs) out.push(...flattenBlocks(t.blocks as Block[]));
  }
  return out;
}
