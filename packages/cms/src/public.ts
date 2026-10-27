// The public read side (IPB-04-14, 04-16, 04-19; `@IPB-04-AT-11`, `@IPB-04-AT-14`; PL5 plan §5.5).
// `PublicContent` serves published revisions only, resolves a path to content, a redirect or 410,
// falls back to en-IN when a translation is missing, and lists entries for the generated files.
// `handlePublicApi` is the read-only `/api/public/v1/...` API: GET and HEAD only (any write method
// is 405 and changes nothing), ETag with 304, rate limited, problem+json errors.
import { IpbError } from "@infrabyx/contracts/errors";
import { PLATFORM_TENANT_ID } from "@infrabyx/contracts/ids";
import type { KernelContext, MutationKernel, Tx } from "@infrabyx/contracts/kernel";
import { sha256Hex } from "@infrabyx/crypto";
import type { ItemRow, RedirectRow, RevisionRow } from "./repo.js";
import { plainText } from "./sanitise.js";
import type { SiteEntry } from "./seo.js";
import type { ContentType } from "./types.js";

export const DEFAULT_LOCALE = "en-IN";

/** The public reader's context: a service principal with no write path. */
export const publicReadContext: KernelContext = {
  tenantId: PLATFORM_TENANT_ID,
  principal: { id: "svc_cms_public", type: "service", roles: [] },
};

export interface PublishedContent {
  id: string;
  type: ContentType;
  packId: string;
  translationGroupId: string;
  path: string;
  title: string;
  revisionId: string;
  body: Record<string, unknown>;
  seo: Record<string, unknown>;
  publishedAt: string;
  lastReviewedAt: string;
  /** The locale the content is in; the page sets `lang` to this on the content region. */
  lang: string;
  /** True when the requested locale had no published translation. */
  fallback: boolean;
  /** Locales of the translation group with a published revision. */
  availableLocales: string[];
}

export type Resolution =
  | { kind: "content"; content: PublishedContent }
  | { kind: "redirect"; status: 301 | 302; to: string; redirectId: string }
  | { kind: "gone"; redirectId: string }
  | { kind: "not_found" };

export interface PreviewPage {
  itemId: string;
  type: ContentType;
  packId: string;
  /** Shown on the page with the banner (IPB-04-05). */
  revisionId: string;
  title: string;
  body: Record<string, unknown>;
  seo: Record<string, unknown>;
  banner: "Preview — not published";
  /** The page also renders `<meta name="robots" content="noindex">`. */
  headers: { "X-Robots-Tag": "noindex"; "Cache-Control": "no-store" };
}

type PublishedRow = ItemRow & Pick<RevisionRow, "body"> & { rev_seo: Record<string, unknown> };

async function publishedAt(
  tx: Tx,
  packId: string,
  locale: string,
  path: string,
): Promise<PublishedRow | null> {
  const r = await tx.query<PublishedRow>(
    `select i.*, r.body, r.seo as rev_seo from cms.content_item i join cms.revision r on r.id = i.published_revision_id
      where i.brand_pack_id = $1 and i.locale = $2 and i.published_path = $3 and i.deleted_at is null
        and i.status <> 'archived'`,
    [packId, locale, path],
  );
  return r.rows[0] ?? null;
}

export class PublicContent {
  constructor(private readonly o: { kernel: MutationKernel }) {}

  private toContent(
    row: PublishedRow,
    lang: string,
    fallback: boolean,
    locales: string[],
  ): PublishedContent {
    return {
      id: row.id,
      type: row.content_type,
      packId: row.brand_pack_id,
      translationGroupId: row.translation_group_id,
      path: row.published_path!,
      title: row.title,
      revisionId: row.published_revision_id!,
      body: row.body,
      seo: row.rev_seo,
      publishedAt: (row.published_at ?? row.updated_at).toISOString(),
      lastReviewedAt: row.last_reviewed_at.toISOString(),
      lang,
      fallback,
      availableLocales: locales,
    };
  }

  /** Resolve a request path for a pack and locale (published content, then redirects). */
  async resolve(packId: string, locale: string, rawPath: string): Promise<Resolution> {
    const path = rawPath.length > 1 ? rawPath.replace(/\/+$/, "") : rawPath;
    return this.o.kernel.read(publicReadContext, async (tx) => {
      let row = await publishedAt(tx, packId, locale, path);
      let fallback = false;
      if (!row && locale !== DEFAULT_LOCALE) {
        row = await publishedAt(tx, packId, DEFAULT_LOCALE, path);
        fallback = Boolean(row);
      }
      if (row) {
        const locales = await tx.query<{ locale: string }>(
          `select distinct locale from cms.content_item where translation_group_id = $1 and published_revision_id is not null
             and deleted_at is null and status <> 'archived' order by locale`,
          [row.translation_group_id],
        );
        return {
          kind: "content",
          content: this.toContent(
            row,
            row.locale,
            fallback,
            locales.rows.map((l) => l.locale),
          ),
        };
      }
      const r = await tx.query<RedirectRow>(
        `select * from cms.redirect where brand_pack_id = $1 and from_path = $2 and state = 'active' and deleted_at is null`,
        [packId, path],
      );
      const x = r.rows[0];
      if (!x) return { kind: "not_found" };
      if (x.status_code === 410) return { kind: "gone", redirectId: x.id };
      return { kind: "redirect", status: x.status_code, to: x.to_path!, redirectId: x.id };
    });
  }

  /**
   * Resolve a preview token (`@IPB-04-AT-05`): the exact revision, with the banner and the
   * no-index, no-store headers. An unknown, revoked or expired token is `IPB-CMS-006` (410).
   */
  async preview(token: string, now: Date = new Date()): Promise<PreviewPage> {
    return this.o.kernel.read(publicReadContext, async (tx) => {
      const r = await tx.query<
        RevisionRow & { item_type: ContentType; pack_id: string; expires_at: Date }
      >(
        `select r.*, i.content_type as item_type, i.brand_pack_id as pack_id, t.expires_at
           from cms.preview_token t join cms.revision r on r.id = t.revision_id
           join cms.content_item i on i.id = t.content_item_id
          where t.token_sha256 = $1 and t.revoked_at is null and i.deleted_at is null`,
        [sha256Hex(token)],
      );
      const row = r.rows[0];
      if (!row || row.expires_at.getTime() <= now.getTime())
        throw new IpbError("IPB-CMS-006", { detail: "ask for a new preview link" });
      return {
        itemId: row.content_item_id,
        type: row.item_type,
        packId: row.pack_id,
        revisionId: row.id,
        title: row.title,
        body: row.body,
        seo: row.seo,
        banner: "Preview — not published",
        headers: { "X-Robots-Tag": "noindex", "Cache-Control": "no-store" },
      };
    });
  }

  /** A published item by id (the API's content endpoint). */
  async byId(id: string): Promise<PublishedContent | null> {
    return this.o.kernel.read(publicReadContext, async (tx) => {
      const r = await tx.query<PublishedRow>(
        `select i.*, r.body, r.seo as rev_seo from cms.content_item i join cms.revision r on r.id = i.published_revision_id
          where i.id = $1 and i.deleted_at is null and i.status <> 'archived'`,
        [id],
      );
      return r.rows[0]
        ? this.toContent(r.rows[0], r.rows[0].locale, false, [r.rows[0].locale])
        : null;
    });
  }

  /** Published items of a pack, optionally of one type and locale. */
  async list(
    packId: string,
    f: { type?: ContentType; locale?: string } = {},
  ): Promise<PublishedContent[]> {
    return this.o.kernel.read(publicReadContext, async (tx) => {
      const args: unknown[] = [packId];
      let where =
        "i.brand_pack_id = $1 and i.deleted_at is null and i.status <> 'archived' and i.published_revision_id is not null";
      if (f.type) {
        args.push(f.type);
        where += ` and i.content_type = $${args.length}`;
      }
      if (f.locale) {
        args.push(f.locale);
        where += ` and i.locale = $${args.length}`;
      }
      const r = await tx.query<PublishedRow>(
        `select i.*, r.body, r.seo as rev_seo from cms.content_item i join cms.revision r on r.id = i.published_revision_id
          where ${where} order by i.published_path nulls last, i.id limit 2000`,
        args,
      );
      return r.rows.map((row) => this.toContent(row, row.locale, false, [row.locale]));
    });
  }

  /** Entries for the sitemap, `llms.txt` and the HTML sitemap: routable, indexable, published. */
  async siteEntries(packId: string): Promise<SiteEntry[]> {
    const all = (await this.list(packId)).filter((c) => c.path);
    const groups = new Map<string, Record<string, string>>();
    for (const c of all)
      groups.set(c.translationGroupId, { ...groups.get(c.translationGroupId), [c.lang]: c.path });
    return all.map((c) => {
      const robots = (c.seo.robots ?? {}) as { index?: boolean };
      const alternates = groups.get(c.translationGroupId) ?? {};
      return {
        path: c.path,
        type: c.type,
        locale: c.lang,
        title: c.title,
        summary: (c.seo.description as string | undefined) ?? c.title,
        lastmod: c.publishedAt,
        alternates,
        noindex: robots.index === false,
      };
    });
  }

  /** Plain text of a published item, for `llms-full.txt` and search. */
  static text(c: PublishedContent): string {
    const parts: string[] = [];
    const walk = (v: unknown) => {
      if (
        Array.isArray(v) &&
        v.every((x) => x && typeof x === "object" && "_type" in (x as object))
      ) {
        parts.push(plainText(v));
        return;
      }
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object")
        for (const [k, x] of Object.entries(v)) {
          if (
            ["type", "slot", "key", "href", "url", "media_id", "claims_ref", "template"].includes(k)
          )
            continue;
          walk(x);
        }
      else if (typeof v === "string") parts.push(v);
    };
    walk(c.body);
    return parts.filter((p) => p.trim()).join("\n");
  }
}

// --- The read-only HTTP API ---------------------------------------------------------------

export interface ApiRequest {
  method: string;
  /** Path and query, e.g. `/api/public/v1/route?pack=brd_…&path=/about`. */
  url: string;
  headers: Readonly<Record<string, string | undefined>>;
  /** The client key for rate limiting (an IP class or token), set by the server. */
  clientKey?: string;
}

export interface ApiResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

const READ_METHODS = new Set(["GET", "HEAD"]);

const problem = (status: number, code: string | null, title: string): ApiResponse => ({
  status,
  headers: { "content-type": "application/problem+json", "cache-control": "no-store" },
  body: JSON.stringify(
    code
      ? { type: `https://developers.infrabyx.in/errors/${code}`, title, status, code }
      : { type: "about:blank", title, status },
  ),
});

export async function handlePublicApi(
  reader: PublicContent,
  req: ApiRequest,
  o: { allow?: (clientKey: string) => boolean | Promise<boolean>; maxAgeSeconds?: number } = {},
): Promise<ApiResponse> {
  const method = req.method.toUpperCase();
  if (!READ_METHODS.has(method)) {
    const r = problem(405, "IPB-API-006", "The public API is read-only");
    r.headers.allow = "GET, HEAD";
    return r;
  }
  if (o.allow && !(await o.allow(req.clientKey ?? "anonymous")))
    return problem(429, "IPB-SEC-019", "Rate limit exceeded");
  const u = new URL(req.url, "http://public.invalid");
  const m =
    /^\/api\/public\/v1\/(route|content)(?:\/([a-z]{2,3}_[0-7][0-9A-HJKMNP-TV-Z]{25}))?$/.exec(
      u.pathname,
    );
  if (!m)
    return problem(
      404,
      u.pathname.startsWith("/api/public/v1/") ? null : "IPB-API-001",
      "Not found",
    );
  const pack = u.searchParams.get("pack") ?? "";
  let payload: unknown;
  try {
    if (m[1] === "route") {
      if (!/^brd_/.test(pack)) return problem(400, "IPB-API-015", "pack is required");
      payload = await reader.resolve(
        pack,
        u.searchParams.get("locale") ?? DEFAULT_LOCALE,
        u.searchParams.get("path") ?? "/",
      );
    } else if (m[2]) {
      payload = await reader.byId(m[2]);
      if (!payload) return problem(404, null, "Not found");
    } else {
      if (!/^brd_/.test(pack)) return problem(400, "IPB-API-015", "pack is required");
      const type = u.searchParams.get("type") ?? undefined;
      const locale = u.searchParams.get("locale") ?? undefined;
      payload = await reader.list(pack, {
        ...(type ? { type: type as ContentType } : {}),
        ...(locale ? { locale } : {}),
      });
    }
  } catch (e) {
    if (e instanceof IpbError)
      return problem(
        e.def.status === "ci" ? 500 : Number(e.def.status) || 500,
        e.code,
        e.def.title,
      );
    throw e;
  }
  const body = JSON.stringify(payload);
  const etag = `"${sha256Hex(body).slice(0, 32)}"`;
  const headers = {
    "content-type": "application/json",
    etag,
    "cache-control": `public, max-age=${o.maxAgeSeconds ?? 60}`,
  };
  if (req.headers["if-none-match"] === etag) return { status: 304, headers, body: "" };
  return { status: 200, headers, body: method === "HEAD" ? "" : body };
}
