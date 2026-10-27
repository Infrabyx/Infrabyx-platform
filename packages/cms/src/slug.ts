// Slug rules (IPB-04-20; `IPB-CMS-002`): lower-kebab ASCII, transliterated where possible, never a
// reserved word. A slug token that is not in the title is a warning, not a refusal.
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  "api",
  "admin",
  "login",
  "m",
  "lp",
  "legal",
  "_next",
  "assets",
  "sitemap.xml",
  "robots.txt",
  "llms.txt",
  ".well-known",
  // Generated and system routes of the reference site (PL5 plan §9.2).
  "preview",
  "studio",
  "fonts",
  "llms-full.txt",
  "security.txt",
  "__gallery",
]);

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** A slug from free text: accents removed, lower-kebab ASCII, at most 80 characters. */
export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
}

export interface SlugCheck {
  ok: boolean;
  /** Why the slug is refused (`IPB-CMS-002`). */
  error?: "format" | "reserved";
  /** A compliant alternative to offer. */
  suggestion?: string;
  /** Slug tokens not found in the title (a spell-check warning). */
  warnings: string[];
}

export function checkSlug(slug: string, title = ""): SlugCheck {
  const titleWords = new Set(slugify(title).split("-"));
  const warnings = slug
    .split("-")
    .filter((t) => t && !/^\d+$/.test(t) && !titleWords.has(t))
    .map((t) => `slug word "${t}" is not in the title`);
  if (RESERVED_SLUGS.has(slug))
    return { ok: false, error: "reserved", suggestion: `${slug}-page`, warnings };
  if (!SLUG.test(slug)) {
    const s = slugify(slug);
    return { ok: false, error: "format", ...(s ? { suggestion: s } : {}), warnings };
  }
  return { ok: true, warnings };
}
