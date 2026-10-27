// Shared bits of the generated files: the request's pack and the site's entries (CMS pages plus
// the site's own routes), and a response helper with the cache policy.
import type { SiteEntry } from "@infrabyx/cms";
import { STATIC_ROUTES } from "./routes.ts";
import { getSite, packFor } from "./site.ts";

export async function generated(req: Request) {
  const site = await getSite();
  const pack = await packFor(site, req.headers.get("host"));
  const now = new Date().toISOString();
  const entries: SiteEntry[] = [
    ...(await site.content.siteEntries(pack.packId)),
    ...STATIC_ROUTES.filter((r) => r.inSitemap).map((r) => ({
      path: r.path,
      type: "site",
      locale: "en-IN",
      title: r.title,
      summary: r.title,
      lastmod: now,
    })),
  ];
  return { site, pack, entries, base: site.env.APP_BASE_URL };
}

export const text = (body: string, type: string, maxAge = 300) =>
  new Response(body, {
    headers: {
      "Content-Type": `${type}; charset=utf-8`,
      "Cache-Control": `public, max-age=${maxAge}`,
    },
  });
