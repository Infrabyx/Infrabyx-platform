// Request helpers for the web app's POST routes: the same-origin check (the CSRF defence beside the
// session cookie's SameSite=Lax) and the 303 back to a page of this origin. As in `apps/console`.

/** True when the post came from this origin (Origin, or Sec-Fetch-Site for older browsers). */
export function sameOrigin(req: Request): boolean {
  const host = req.headers.get("host");
  const origin = req.headers.get("origin");
  if (origin && origin !== "null") {
    try {
      return new URL(origin).host === host;
    } catch {
      return false;
    }
  }
  return req.headers.get("sec-fetch-site") === "same-origin";
}

/** A 303 to a path of this origin (never another origin). */
export function seeOther(req: Request, path: string): Response {
  if (!path.startsWith("/") || path.startsWith("//")) throw new Error("same-origin paths only");
  const host = req.headers.get("host") ?? "localhost";
  const proto = req.headers.get("x-forwarded-proto") ?? new URL(req.url).protocol.replace(":", "");
  return new Response(null, {
    status: 303,
    headers: { location: `${proto}://${host}${path}`, "cache-control": "no-store" },
  });
}

export const forbidden = (): Response =>
  new Response("cross-origin post refused", {
    status: 403,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
