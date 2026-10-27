// `/sitemap.xml`: the index of the per-type sitemaps (IPB-04-09).
import { sitemapIndex } from "@infrabyx/cms";
import { generated, text } from "../../server/files.ts";

export async function GET(req: Request) {
  const g = await generated(req);
  return text(sitemapIndex(g.base, g.pack.noindex ? [] : g.entries), "application/xml");
}

/** Rendered per request: the pack depends on the host and the content on the database. */
export const dynamic = "force-dynamic";
