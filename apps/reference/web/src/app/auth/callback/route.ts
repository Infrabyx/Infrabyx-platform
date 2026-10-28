// `/auth/callback` on this origin, proxied to the API (the sign-in runs through the web app; PL6-D-12).
import { proxyAuth } from "../../../server/api.ts";

export const dynamic = "force-dynamic";
export const GET = (req: Request): Promise<Response> => proxyAuth(req, "callback");
