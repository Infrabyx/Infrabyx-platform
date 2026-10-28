// POST `/studio-actions/<section>/<action>`: run one Studio form handler, then post-redirect-get
// back to the page the form was on (or the handler's next page) with the encoded result.
// Same-origin only; the session must open the section; the services check everything else.
import { encodeResult, type StudioSection } from "@infrabyx/ui/studio";
import { actionMap } from "../../../../server/actions.ts";
import { getConsole } from "../../../../server/console.ts";
import { cookieMap, refererUrl, sameOrigin, seeOther } from "../../../../server/http.ts";
import { isSection } from "../../../../server/screens.tsx";
import { mayOpen, SESSION_COOKIE, sessionFrom } from "../../../../server/session.ts";

type Params = { params: Promise<{ section: string; action: string }> };

export async function POST(req: Request, { params }: Params) {
  if (!sameOrigin(req)) return new Response("Forbidden", { status: 403 });
  const { section, action } = await params;
  if (!isSection(section)) return new Response("Not found", { status: 404 });
  const session = await sessionFrom(cookieMap(req)[SESSION_COOKIE]);
  if (!session) return seeOther("/sign-in");
  if (!(await mayOpen(session, section as StudioSection)))
    return new Response("Forbidden", { status: 403 });
  const c = await getConsole();
  // Own keys only: `constructor`, `toString` and the rest of Object.prototype are not actions
  // (PR-FBX-08).
  const handlers = actionMap(c)[section];
  const handler = handlers && Object.hasOwn(handlers, action) ? handlers[action] : undefined;
  if (!handler) return new Response("Not found", { status: 404 });
  const result = await handler(session.ctx, await req.formData());
  const back = result.redirectTo
    ? new URL(result.redirectTo, "http://x")
    : refererUrl(req, `/studio/${section}`);
  back.searchParams.set("r", encodeResult(result));
  return seeOther(`${back.pathname}${back.search}`);
}

export const dynamic = "force-dynamic";
