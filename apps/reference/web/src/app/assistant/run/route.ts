// POST /assistant/run: start the hello skill through the API, then back to the assistant page with
// the approval it raised.
import { api } from "../../../server/api.ts";
import { forbidden, sameOrigin, seeOther } from "../../../server/http.ts";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  if (!sameOrigin(req)) return forbidden();
  const r = await api<{ taskId: string; approvalId: string }>("/vidhi/hello/summarise", {
    method: "POST",
  });
  if (!r.ok)
    return seeOther(
      req,
      `/assistant?error=${encodeURIComponent(r.problem.code ?? r.problem.title)}`,
    );
  return seeOther(req, `/assistant?approval=${encodeURIComponent(r.body.approvalId)}`);
}
