// `POST /api/consent` (IPB-04-75…84, `@IPB-04-AT-80`…`-82`): records the choice in the consent ledger
// with the exact banner text and version, sets the first-party cookies, and answers the controller
// with JSON or a form post with a redirect back. Refused when it does not come from this site.
import { handleConsentPost, type CmpAction } from "@infrabyx/consent";
import { getSite, packFor } from "../../../server/site.ts";
import {
  cookieMap,
  formBody,
  headerMap,
  isHttps,
  refererPath,
  sameOrigin,
  seeOther,
  wantsJson,
} from "../../../server/http.ts";

const ACTIONS = new Set(["accept_all", "reject_all", "save", "manage"]);

export async function POST(req: Request) {
  if (!sameOrigin(req)) return new Response("Forbidden", { status: 403 });
  const site = await getSite();
  const { packId, rev } = await packFor(site, req.headers.get("host"));
  const body = await formBody(req);
  const action = ACTIONS.has(body.action ?? "")
    ? (body.action as CmpAction | "manage")
    : "reject_all";
  const region = (rev.body.consent_config?.region_default ?? "IN") as
    "IN" | "EU" | "US-CA" | "OTHER";
  const banner = await site.texts.current("consent.cookie.banner", { region });
  const back = refererPath(req, "/");
  const r = await handleConsentPost(
    site.consent,
    {
      action,
      categories: Object.fromEntries(
        (["functional", "analytics", "marketing"] as const).flatMap((k) =>
          body[k] ? [[k, body[k]]] : [],
        ),
      ),
      cookies: cookieMap(req),
      headers: headerMap(req),
      region,
      brandPackId: packId,
      bannerTextKey: "consent.cookie.banner",
      bannerTextVersion: banner?.version ?? "1.0",
      fromPreferenceCentre: back === "/cookie-settings",
    },
    { ttlDays: 365, secure: isHttps(req) },
  );
  if (r.status === 303) return seeOther(r.location ?? "/cookie-settings", r.setCookies);
  if (wantsJson(req)) {
    const h = new Headers({ "Content-Type": "application/json", "Cache-Control": "no-store" });
    for (const c of r.setCookies) h.append("Set-Cookie", c);
    return new Response(JSON.stringify({ receipt_id: r.receiptId, choice: r.choice }), {
      status: 200,
      headers: h,
    });
  }
  return seeOther(back, r.setCookies);
}

/** Rendered per request: the pack depends on the host and the content on the database. */
export const dynamic = "force-dynamic";
