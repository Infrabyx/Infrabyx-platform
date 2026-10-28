// Sign-out on this origin: the API clears the session cookie (through the proxy), then home.
import { proxyAuth } from "../../../server/api.ts";
import { forbidden, sameOrigin, seeOther } from "../../../server/http.ts";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  if (!sameOrigin(req)) return forbidden();
  const r = await proxyAuth(req, "logout");
  const out = seeOther(req, "/");
  for (const c of r.headers.getSetCookie()) out.headers.append("set-cookie", c);
  return out;
}
