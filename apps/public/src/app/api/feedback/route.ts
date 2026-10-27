// `POST /api/feedback` (IPB-04-98, `@IPB-04-AT-90`, `-91`): the widget's fetch and the no-JavaScript
// forms. Minimisation is the service's: anything beyond the listed fields refuses the whole item.
import { PLATFORM_TENANT_ID } from "@infrabyx/contracts/ids";
import { randomBytes, toHex } from "@infrabyx/crypto";
import { CID_COOKIE } from "@infrabyx/consent";
import { handleFeedbackPost } from "@infrabyx/feedback";
import { getSite } from "../../../server/site.ts";
import {
  clientKey,
  cookieMap,
  formBody,
  refererPath,
  sameOrigin,
  seeOther,
  wantsJson,
} from "../../../server/http.ts";

export async function POST(req: Request) {
  const site = await getSite();
  const json = wantsJson(req);
  const body = await formBody(req);
  const stored = cookieMap(req)[CID_COOKIE];
  // A visitor without a consent id gets a one-off id for this item (no cookie is set).
  const cid = stored && /^[A-Za-z0-9_-]{16,64}$/.test(stored) ? stored : toHex(randomBytes(16));
  const r = await handleFeedbackPost(site.feedback, {
    body,
    csrfOk: sameOrigin(req),
    mode: json ? "json" : "form",
    submitter: {
      tenantId: PLATFORM_TENANT_ID,
      cid,
      clientKey: clientKey(req),
      ...(req.headers.get("user-agent") ? { userAgent: req.headers.get("user-agent")! } : {}),
    },
  });
  if (r.status === 303) return seeOther(r.location);
  if (json) return Response.json(r.body, { status: r.status });
  if (r.status === 201) return seeOther(r.body.status_url);
  const page = refererPath(req, "/feedback");
  return seeOther(
    `${page}?${new URLSearchParams({ form: "feedback", e: Buffer.from(JSON.stringify(r.errors)).toString("base64url") })}`,
  );
}

/** Rendered per request: the pack depends on the host and the content on the database. */
export const dynamic = "force-dynamic";
