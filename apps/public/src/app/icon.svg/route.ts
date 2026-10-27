// `/icon.svg`: the pack's sanitised logo (IPB-04-21, 22).
import { getSite, packFor } from "../../server/site.ts";

export async function GET(req: Request) {
  const site = await getSite();
  const { rev } = await packFor(site, req.headers.get("host"));
  const set = await site.brand.favicons(
    { tenantId: "tnt_platform", principal: { id: "svc_site_public", type: "service", roles: [] } },
    rev,
  );
  const svg = set.files.find((f) => f.path === "/icon.svg")?.body;
  if (!svg) return new Response("Not found", { status: 404 });
  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "public, max-age=3600",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    },
  });
}

/** Rendered per request: the pack depends on the host and the content on the database. */
export const dynamic = "force-dynamic";
