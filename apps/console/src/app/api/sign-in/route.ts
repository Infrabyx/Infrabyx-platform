// POST /api/sign-in: set the fixture persona cookie (fixture environments only).
import { isPersona } from "../../../server/authz.ts";
import { getConsole } from "../../../server/console.ts";
import { isHttps, sameOrigin, seeOther } from "../../../server/http.ts";
import { sessionCookie } from "../../../server/session.ts";

export async function POST(req: Request) {
  const c = await getConsole();
  if (!sameOrigin(req) || !c.env.APP_FIXTURE_ADAPTERS)
    return new Response("Forbidden", { status: 403 });
  const persona = (await req.formData()).get("persona");
  if (!isPersona(persona)) return seeOther("/sign-in");
  return seeOther("/studio/approvals", [sessionCookie(persona, isHttps(req))]);
}

export const dynamic = "force-dynamic";
