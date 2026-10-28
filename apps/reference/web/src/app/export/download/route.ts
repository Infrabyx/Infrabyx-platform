// GET /export/download?archive=: a fresh signed link from the API (ledgered as a download, C-22), and
// a redirect to it. `X-Content-SHA256` carries the archive's digest so a client can check the file.
import { api } from "../../../server/api.ts";

export const dynamic = "force-dynamic";

const ID = /^[a-z]{2,6}_[0-9A-HJKMNP-TV-Z]{26}$/;

export async function GET(req: Request): Promise<Response> {
  const archive = new URL(req.url).searchParams.get("archive") ?? "";
  if (!ID.test(archive)) return new Response("no such archive", { status: 404 });
  const r = await api<{ url: string; sha256: string }>(
    `/export/archives/${encodeURIComponent(archive)}/download`,
  );
  if (!r.ok) return new Response(r.problem.title, { status: r.problem.status });
  return new Response(null, {
    status: 303,
    headers: {
      location: r.body.url,
      "x-content-sha256": r.body.sha256,
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
    },
  });
}
