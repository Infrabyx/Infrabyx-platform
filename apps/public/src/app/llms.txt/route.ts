// `/llms.txt` (IPB-04-09): public pages with one-line summaries.
import { llmsTxt } from "@infrabyx/cms";
import { generated, text } from "../../server/files.ts";

export async function GET(req: Request) {
  const g = await generated(req);
  return text(
    llmsTxt({
      siteName: g.pack.rev.body.app_name,
      base: g.base,
      summary:
        "The website of the Infrabyx Group: its companies, careers, trust documents and policies.",
      entries: g.pack.noindex ? [] : g.entries,
    }),
    "text/plain",
  );
}

/** Rendered per request: the pack depends on the host and the content on the database. */
export const dynamic = "force-dynamic";
