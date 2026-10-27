// `/.well-known/security.txt` (RFC 9116): regenerated on each request, so `Expires` never lapses.
import { securityTxt } from "@infrabyx/trust";
import { generated, text } from "../../../server/files.ts";

export async function GET(req: Request) {
  const g = await generated(req);
  const o = await g.site.policies.officers(g.pack.packId);
  const base = g.base.replace(/\/$/, "");
  return text(
    securityTxt({
      contacts: [o.dpo.email ?? `security@${new URL(base).hostname}`],
      canonical: `${base}/.well-known/security.txt`,
      policy: `${base}/security`,
    }),
    "text/plain",
    3600,
  );
}

/** Rendered per request: the pack depends on the host and the content on the database. */
export const dynamic = "force-dynamic";
