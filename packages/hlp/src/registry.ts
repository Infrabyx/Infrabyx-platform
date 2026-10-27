// The help registry: entries loaded from `registry/<module>.yaml` files (IPB-07-41), looked up by
// key for the "i" popover (§07.4.4) and listed for the public glossary (IPB-07-46).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { HelpEntrySchema, moduleOf, termOf, type HelpEntry } from "./entry.js";

export const RegistryFileSchema = z
  .object({ module: z.string().regex(/^[a-z0-9_]+$/), entries: z.array(z.unknown()) })
  .strict();

export interface RegistryLoadIssue {
  file: string;
  key: string;
  message: string;
}

export interface LoadedRegistry {
  entries: HelpEntry[];
  issues: RegistryLoadIssue[];
  /** Which file each key came from. */
  sources: Map<string, string>;
}

/** Parse one registry file; entries that fail the schema become issues, the rest load. */
export function parseRegistryFile(text: string, file: string): LoadedRegistry {
  const out: LoadedRegistry = { entries: [], issues: [], sources: new Map() };
  let doc: z.infer<typeof RegistryFileSchema>;
  try {
    doc = RegistryFileSchema.parse(parseYaml(text));
  } catch (e) {
    out.issues.push({
      file,
      key: "?",
      message: e instanceof z.ZodError ? z.prettifyError(e) : String(e),
    });
    return out;
  }
  for (const raw of doc.entries) {
    const r = HelpEntrySchema.safeParse(raw);
    const key = (raw as { key?: unknown })?.key;
    const k = typeof key === "string" ? key : "?";
    if (!r.success) {
      out.issues.push({ file, key: k, message: z.prettifyError(r.error) });
      continue;
    }
    if (moduleOf(r.data.key) !== doc.module) {
      out.issues.push({ file, key: k, message: `key is not in module ${doc.module}` });
      continue;
    }
    out.entries.push(r.data);
    out.sources.set(r.data.key, file);
  }
  return out;
}

/** Every `*.yaml` under the given directories (or files). */
export function loadRegistry(paths: readonly string[]): LoadedRegistry {
  const all: LoadedRegistry = { entries: [], issues: [], sources: new Map() };
  const walk = (p: string) => {
    if (statSync(p).isDirectory()) {
      for (const f of readdirSync(p).sort()) walk(join(p, f));
    } else if ([".yaml", ".yml"].includes(extname(p))) {
      const r = parseRegistryFile(readFileSync(p, "utf8"), p);
      for (const e of r.entries) {
        const prev = all.sources.get(e.key);
        if (prev) {
          all.issues.push({ file: p, key: e.key, message: `duplicate key (also in ${prev})` });
          continue;
        }
        all.entries.push(e);
        all.sources.set(e.key, p);
      }
      all.issues.push(...r.issues);
    }
  };
  for (const p of paths) walk(p);
  return all;
}

/** What the popover shows (the `HelpEntry` shape of `@infrabyx/ui`'s `HelpButton`). */
export interface ResolvedHelp {
  key: string;
  term: string;
  plain: string;
  explanation?: string;
  learnMoreHref?: string;
  regulatoryReference?: {
    instrument: string;
    provision: string;
    summary: string;
    effectiveDate: string;
    url?: string;
  };
  reviewerInitials?: string;
  effectiveDate: string;
  /** The locale the text came from, and whether the requested one was missing (IPB-07-45). */
  locale: string;
  translationPending: boolean;
}

const lang = (locale: string) => locale.split("-")[0]!;

export class HelpRegistry {
  private readonly byKey: Map<string, HelpEntry>;

  constructor(entries: readonly HelpEntry[]) {
    this.byKey = new Map(entries.map((e) => [e.key, e]));
  }

  get(key: string): HelpEntry | undefined {
    return this.byKey.get(key);
  }

  entries(): HelpEntry[] {
    return [...this.byKey.values()];
  }

  /**
   * The popover content for `key` in `locale`, falling back to hi, then en (the entry's base text)
   * with `translationPending` set. Only published entries resolve unless `includeDraft`.
   */
  resolve(
    key: string,
    locale = "en-IN",
    o: { includeDraft?: boolean } = {},
  ): ResolvedHelp | undefined {
    const e = this.byKey.get(key);
    if (!e) return undefined;
    if (e.status !== "published" && !(o.includeDraft && e.status !== "deprecated"))
      return undefined;
    const want = lang(locale);
    const chain = [...new Set([want, "hi", "en"])];
    let used = "en";
    let text: { term: string; plain: string; explanation?: string | undefined } = e;
    for (const l of chain) {
      if (l === "en") break;
      const v = e.locales[l];
      if (v) {
        text = v;
        used = l;
        break;
      }
    }
    const cite = e.regulatory_reference[0];
    const article = e.links.find((l): l is { help_article_key: string } => "help_article_key" in l);
    const out: ResolvedHelp = {
      key: e.key,
      term: text.term,
      plain: text.plain,
      effectiveDate: e.effective_date,
      locale: used,
      translationPending: used !== want,
    };
    if (text.explanation) out.explanation = text.explanation;
    if (article)
      out.learnMoreHref = `/help/${article.help_article_key.split(".").slice(1).join("/")}`;
    if (cite)
      out.regulatoryReference = {
        instrument: cite.instrument,
        provision: cite.provision,
        summary: cite.summary,
        effectiveDate: cite.effective_date,
        ...(cite.url ? { url: cite.url } : {}),
      };
    if (e.reviewer_of_record?.initials) out.reviewerInitials = e.reviewer_of_record.initials;
    return out;
  }
}

export interface GlossaryItem {
  key: string;
  module: string;
  term: string;
  plain: string;
  href: string;
  translationPending: boolean;
}

/**
 * Published public entries for `/glossary`, grouped by first letter of the term in the locale
 * (IPB-07-46, `@IPB-07-AT-17`). Internal and unpublished entries never appear.
 */
export function publicGlossary(
  entries: readonly HelpEntry[],
  locale = "en-IN",
): { letter: string; items: GlossaryItem[] }[] {
  const reg = new HelpRegistry(entries);
  const items: GlossaryItem[] = [];
  for (const e of entries) {
    if (e.visibility !== "public" || e.status !== "published") continue;
    const r = reg.resolve(e.key, locale)!;
    items.push({
      key: e.key,
      module: moduleOf(e.key),
      term: r.term,
      plain: r.plain,
      href: `/glossary/${moduleOf(e.key)}/${termOf(e.key)}`,
      translationPending: r.translationPending,
    });
  }
  const collator = new Intl.Collator(locale);
  items.sort((a, b) => collator.compare(a.term, b.term));
  const groups = new Map<string, GlossaryItem[]>();
  for (const i of items) {
    const first = [...i.term.trim()][0] ?? "#";
    const letter = /\p{L}/u.test(first) ? first.toLocaleUpperCase(locale) : "#";
    (groups.get(letter) ?? groups.set(letter, []).get(letter)!).push(i);
  }
  return [...groups].map(([letter, list]) => ({ letter, items: list }));
}
