// `/legal/index.json` (IPB-05-09): keys, versions, effective dates and URLs.
import { getSite, packFor } from "../../../server/site.ts";

export async function GET(req: Request) {
  const site = await getSite();
  const { packId } = await packFor(site, req.headers.get("host"));
  const idx = await site.policies.index(packId, site.env.APP_BASE_URL);
  return Response.json(idx, { headers: { "Cache-Control": "public, max-age=300" } });
}

/** Rendered per request: the pack depends on the host and the content on the database. */
export const dynamic = "force-dynamic";
