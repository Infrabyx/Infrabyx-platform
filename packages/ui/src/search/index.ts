// Global search and the command palette's logic (IPB-07-17, @IPB-07-AT-03; Finbyx PR-FBX-09,
// R1-D-32). No React here, so the browser can import it (`@infrabyx/ui/search`) and repeat the
// refusal before anything is sent. The server runs `globalSearch`, which refuses first: a refused
// query reaches no provider, and nothing it returns, nor `paletteEvent`, carries the query text.
// What is searched, and the permission trim, are the product's: each `SearchProvider` returns only
// what the caller may already open (an unauthorised match is neither returned nor counted).
import { searchRefusal, type SearchPatternClass } from "@infrabyx/contracts/search-refusal";

/** The shortest query searched. */
export const MIN_QUERY_LENGTH = 3;
/** The longest query read; longer input is refused as `too_long`, not cut. */
export const MAX_QUERY_LENGTH = 200;

export type QueryCheck =
  | { ok: true; query: string }
  | { ok: false; code: "IPB-UX-003"; patternClass: SearchPatternClass; messageKey: string }
  | { ok: false; code: "too_short" | "too_long"; messageKey: string };

/** Whether a query may be searched; the refusal names the pattern class only. */
export function checkQuery(raw: string): QueryCheck {
  const query = raw.trim();
  const refused = searchRefusal(query);
  if (refused)
    return {
      ok: false,
      code: refused.code,
      patternClass: refused.patternClass,
      messageKey: refused.messageKey,
    };
  if (query.length < MIN_QUERY_LENGTH)
    return { ok: false, code: "too_short", messageKey: "ui.search.too_short" };
  if (query.length > MAX_QUERY_LENGTH)
    return { ok: false, code: "too_long", messageKey: "ui.search.too_long" };
  return { ok: true, query };
}

export interface SearchHit {
  /** INTERNAL text the caller may see: a record's name or reference, a page or setting title. */
  label: string;
  href: string;
  /** A short second line (a status, a module). */
  detail?: string;
}

export interface SearchProvider<C> {
  /** Stable id, e.g. "nav", "settings", "loans". */
  id: string;
  /** Group heading, e.g. "Pages", "Settings", "Loans". */
  label: string;
  /**
   * Hits for `query` the caller in `ctx` may open, best first. Trim at query time (IPB-07-17,
   * Cerbos or the product's policy); never return or count anything else.
   */
  search(query: string, ctx: C, limit: number): Promise<readonly SearchHit[]>;
}

export interface SearchGroup {
  id: string;
  label: string;
  hits: readonly SearchHit[];
}

export type SearchResult =
  | { status: "ok"; groups: readonly SearchGroup[]; failed: readonly string[] }
  | (Exclude<QueryCheck, { ok: true }> & { status: "refused" });

export interface GlobalSearchOptions {
  /** Hits per group (default 5). */
  perGroup?: number;
  /** Hits in all (default 20). */
  total?: number;
  /** A provider slower than this is reported in `failed` (default 2000 ms). */
  timeoutMs?: number;
}

/**
 * Check, then ask every provider in parallel. A provider that throws or times out is listed in
 * `failed` by id (the others still answer); its error is not returned, as it may echo the query.
 */
export async function globalSearch<C>(
  raw: string,
  ctx: C,
  providers: readonly SearchProvider<C>[],
  o: GlobalSearchOptions = {},
): Promise<SearchResult> {
  const check = checkQuery(raw);
  if (!check.ok) return { ...check, status: "refused" };
  const perGroup = o.perGroup ?? 5;
  let left = o.total ?? 20;
  const timeoutMs = o.timeoutMs ?? 2000;
  const answers = await Promise.all(
    providers.map(async (p) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const hits = await Promise.race([
          p.search(check.query, ctx, perGroup),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
          }),
        ]);
        return { p, hits };
      } catch {
        return { p, hits: null };
      } finally {
        clearTimeout(timer);
      }
    }),
  );
  const groups: SearchGroup[] = [];
  const failed: string[] = [];
  for (const { p, hits } of answers) {
    if (!hits) {
      failed.push(p.id);
      continue;
    }
    const seen = new Set<string>();
    const kept = hits
      .filter((h) => (seen.has(h.href) ? false : (seen.add(h.href), true)))
      .slice(0, Math.min(perGroup, left));
    left -= kept.length;
    if (kept.length) groups.push({ id: p.id, label: p.label, hits: kept });
  }
  return { status: "ok", groups, failed };
}

/** A search provider over a fixed list (pages, settings, shortcuts), matched on the label. */
export function staticProvider<C>(
  id: string,
  label: string,
  entries: (ctx: C) => readonly SearchHit[],
): SearchProvider<C> {
  return {
    id,
    label,
    async search(query, ctx, limit) {
      const q = query.toLowerCase();
      return entries(ctx)
        .filter((e) => e.label.toLowerCase().includes(q))
        .slice(0, limit);
    },
  };
}

/** The analytics event for one search (IPB-07-17): the outcome and counts, never the query. */
export function paletteEvent(r: SearchResult): {
  event: "palette.search";
  outcome: "ok" | "refused" | "too_short" | "too_long";
  pattern_class?: SearchPatternClass;
  result_count?: number;
  failed_providers?: number;
} {
  if (r.status === "ok")
    return {
      event: "palette.search",
      outcome: "ok",
      result_count: r.groups.reduce((n, g) => n + g.hits.length, 0),
      failed_providers: r.failed.length,
    };
  if (r.code === "IPB-UX-003")
    return { event: "palette.search", outcome: "refused", pattern_class: r.patternClass };
  return { event: "palette.search", outcome: r.code };
}
