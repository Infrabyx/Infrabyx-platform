// POST /api/sign-out: clear the session cookie.
import { isHttps, sameOrigin, seeOther } from "../../../server/http.ts";
import { sessionCookie } from "../../../server/session.ts";

export async function POST(req: Request) {
  if (!sameOrigin(req)) return new Response("Forbidden", { status: 403 });
  return seeOther("/sign-in", [sessionCookie(null, isHttps(req))]);
}

export const dynamic = "force-dynamic";
