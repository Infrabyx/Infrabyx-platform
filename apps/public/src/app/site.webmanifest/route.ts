// `/site.webmanifest` (IPB-04-22).
import { getSite, packFor } from "../../server/site.ts";

export async function GET(req: Request) {
  const site = await getSite();
  const { rev } = await packFor(site, req.headers.get("host"));
  const set = await site.brand.favicons(
    { tenantId: "tnt_platform", principal: { id: "svc_site_public", type: "service", roles: [] } },
    rev,
  );
  const m = set.files.find((f) => f.path === "/site.webmanifest")?.body ?? "{}";
  return new Response(m, {
    headers: {
      "Content-Type": "application/manifest+json",
      "Cache-Control": "public, max-age=3600",
    },
  });
}

/** Rendered per request: the pack depends on the host and the content on the database. */
export const dynamic = "force-dynamic";
