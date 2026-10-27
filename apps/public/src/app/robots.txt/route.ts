// `/robots.txt`: disallow everything for an unmapped host (the default pack is `noindex`).
import { robotsTxt } from "@infrabyx/cms";
import { generated, text } from "../../server/files.ts";

export async function GET(req: Request) {
  const g = await generated(req);
  return text(robotsTxt({ base: g.base, noindex: g.pack.noindex }), "text/plain");
}

/** Rendered per request: the pack depends on the host and the content on the database. */
export const dynamic = "force-dynamic";
