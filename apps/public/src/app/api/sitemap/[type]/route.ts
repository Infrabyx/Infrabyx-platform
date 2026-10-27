// `/sitemap-{type}.xml` (the proxy rewrites it here).
import { sitemapFor } from "@infrabyx/cms";
import { generated, text } from "../../../../server/files.ts";

export async function GET(req: Request, { params }: { params: Promise<{ type: string }> }) {
  const { type } = await params;
  if (!/^[a-z_]{1,40}$/.test(type)) return new Response("Not found", { status: 404 });
  const g = await generated(req);
  return text(sitemapFor(g.base, g.pack.noindex ? [] : g.entries, type), "application/xml");
}

/** Rendered per request: the pack depends on the host and the content on the database. */
export const dynamic = "force-dynamic";
