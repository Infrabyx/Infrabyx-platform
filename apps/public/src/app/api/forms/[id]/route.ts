// `POST /api/forms/<id>` (IPB-04 §04.3.1 form block, `@IPB-04-AT-47`): consent first, then the
// hand-off to CRM or HR; field values are never stored. A refused post goes back to the page with
// the errors next to their fields; a sent one shows the reference.
import { isIpbError } from "@infrabyx/contracts/errors";
import { CID_COOKIE } from "@infrabyx/consent";
import { HONEYPOT_FIELD } from "@infrabyx/cms";
import { getSite, packFor } from "../../../../server/site.ts";
import {
  clientKey,
  cookieMap,
  formBody,
  refererPath,
  sameOrigin,
  seeOther,
} from "../../../../server/http.ts";

const back = (path: string, q: Record<string, string>) =>
  `${path}?${new URLSearchParams(q).toString()}`;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(req)) return new Response("Forbidden", { status: 403 });
  const { id } = await params;
  if (!/^frm_[0-7][0-9A-HJKMNP-TV-Z]{25}$/.test(id))
    return new Response("Not found", { status: 404 });
  const site = await getSite();
  const { packId } = await packFor(site, req.headers.get("host"));
  const body = await formBody(req);
  const page = refererPath(req, "/contact");
  const { consent, [HONEYPOT_FIELD]: honeypot, ...fields } = body;
  const cid = cookieMap(req)[CID_COOKIE];
  try {
    const r = await site.forms.submit({
      packId,
      formId: id,
      fields,
      consent: consent === "yes" || consent === "on",
      ...(honeypot ? { honeypot } : {}),
      clientKey: clientKey(req),
      ...(cid && /^[A-Za-z0-9_-]{16,64}$/.test(cid) ? { cid } : {}),
      region: "IN",
      gpc: req.headers.get("sec-gpc") === "1",
      pageUrl: page,
    });
    return seeOther(back(page, { sent: r.reference }));
  } catch (e) {
    if (!isIpbError(e)) throw e;
    const list = e.errors ?? [];
    const errors = list.length
      ? list.map((x) => ({ fieldId: `f-${x.path}`, message: x.message }))
      : [
          {
            fieldId: e.code === "IPB-WEB-002" ? "f-consent" : "f-message",
            message:
              e.code === "IPB-WEB-002"
                ? "Tick the box to let us use your details for this message"
                : e.code === "IPB-PORT-001" || e.code === "IPB-PORT-002"
                  ? "We could not send your message; please try again later"
                  : (e.detail ?? e.def.title),
          },
        ];
    return seeOther(
      back(page, { form: id, e: Buffer.from(JSON.stringify(errors)).toString("base64url") }) +
        `#form-${id}-title`,
    );
  }
}

/** Rendered per request: the pack depends on the host and the content on the database. */
export const dynamic = "force-dynamic";
