// POST /export/run: request the full-tenant export through the API, then back to the export page
// with the job (an owner) or the approval (an admin).
import { api } from "../../../server/api.ts";
import { forbidden, sameOrigin, seeOther } from "../../../server/http.ts";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  if (!sameOrigin(req)) return forbidden();
  const r = await api<{ id?: string; approvalId?: string }>("/export", {
    method: "POST",
    body: { scope: { type: "FULL_TENANT" } },
  });
  if (!r.ok)
    return seeOther(req, `/export?error=${encodeURIComponent(r.problem.code ?? r.problem.title)}`);
  if (r.body.id) return seeOther(req, `/export?job=${encodeURIComponent(r.body.id)}`);
  return seeOther(req, `/export?approval=${encodeURIComponent(r.body.approvalId ?? "")}`);
}
