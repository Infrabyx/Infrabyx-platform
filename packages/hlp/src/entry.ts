// Glossary entry schema (IPB-07 §07.4.3, IPB-07-41). Keys are `hlp.<module>.<term>` and never
// change (IPB-07-50); a key is retired by `status: deprecated` with `superseded_by`.
import { z } from "zod";

export const HELP_KEY = /^hlp\.[a-z0-9_]+\.[a-z0-9_.]+$/;
export const HELP_STATUSES = ["draft", "in_review", "published", "deprecated"] as const;
export type HelpStatus = (typeof HELP_STATUSES)[number];
export const CITATION_TAGS = ["LAW", "INTERP", "REC"] as const;
/** IPB-07 §07.4.3: the plain definition is at most 40 words. */
export const PLAIN_MAX_WORDS = 40;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "a date as YYYY-MM-DD");

export const CitationSchema = z
  .object({
    instrument: z.string().min(1),
    provision: z.string().min(1),
    summary: z.string().min(1),
    effective_date: isoDate,
    url: z.url().optional(),
    tag: z.enum(CITATION_TAGS),
  })
  .strict();
export type Citation = z.infer<typeof CitationSchema>;

const LocaleVariant = z
  .object({
    term: z.string().min(1),
    plain: z.string().min(1),
    explanation: z.string().optional(),
  })
  .strict();

export const HelpEntrySchema = z
  .object({
    key: z.string().regex(HELP_KEY, "a help key is hlp.<module>.<term>"),
    term: z.string().min(1),
    plain: z.string().min(1),
    explanation: z.string().optional(),
    regulatory_reference: z.array(CitationSchema).default([]),
    links: z
      .array(
        z.union([
          z.object({ help_article_key: z.string().min(1) }).strict(),
          z.object({ route: z.string().regex(/^\//) }).strict(),
          z.object({ url: z.url() }).strict(),
        ]),
      )
      .default([]),
    /** Locale variants keyed by language (`hi`, `ta`, …); a missing locale falls back to hi, then en. */
    locales: z.record(z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/), LocaleVariant).default({}),
    reviewer_of_record: z
      .object({
        role: z.string().regex(/^PLT_[A-Z_]+$/),
        user_id: z.string().min(1),
        reviewed_at: isoDate,
        /** Shown in the popover footer (IPB-07 §07.4.4); no full names in the registry. */
        initials: z
          .string()
          .regex(/^[A-Z]{1,4}$/)
          .optional(),
      })
      .strict()
      .optional(),
    effective_date: isoDate,
    status: z.enum(HELP_STATUSES),
    superseded_by: z.string().regex(HELP_KEY).nullable().default(null),
    visibility: z.enum(["public", "internal"]).default("public"),
    /** The date the entry is due for review (IPB-07-60: 12 months, or 6 for regulatory content). */
    review_by: isoDate.optional(),
  })
  .strict();
export type HelpEntry = z.infer<typeof HelpEntrySchema>;
export type HelpEntryInput = z.input<typeof HelpEntrySchema>;

/** Words in a definition: whitespace-separated runs that contain a letter or digit. */
export function wordCount(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

/** `hlp.<module>.<term>` → module. */
export const moduleOf = (key: string) => key.split(".")[1] ?? "";
/** `hlp.<module>.<term>` → the term path after the module (`compliance_calendar`). */
export const termOf = (key: string) => key.split(".").slice(2).join(".");

export const hasLawCitation = (e: Pick<HelpEntry, "regulatory_reference">) =>
  e.regulatory_reference.some((c) => c.tag === "LAW");
