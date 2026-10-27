// Request helpers for the console's POST routes: the same-origin check (the CSRF defence), the
// redirect back to the page the form was on, and the session cookie. As in `apps/public`.

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

/** The path and query of the page the post came from, or `fallback` (never another origin). */
export function refererUrl(req: Request, fallback: string): URL {
  const host = req.headers.get("host");
  const base = `http://${host ?? "localhost"}`;
  const r = req.headers.get("referer");
  try {
    if (r) {
      const u = new URL(r);
      if (u.host === host) return new URL(u.pathname + u.search, base);
    }
  } catch {
    /* fall through */
  }
  return new URL(fallback, base);
}

export function cookieMap(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (req.headers.get("cookie") ?? "").split(/;\s*/)) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i)] = decodeURIComponent(part.slice(i + 1));
  }
  return out;
}

export const isHttps = (req: Request) =>
  new URL(req.url).protocol === "https:" || req.headers.get("x-forwarded-proto") === "https";

/** 303 See Other to a path on this origin. */
export function seeOther(location: string, cookies: readonly string[] = []): Response {
  const h = new Headers({ Location: location, "Cache-Control": "no-store" });
  for (const c of cookies) h.append("Set-Cookie", c);
  return new Response(null, { status: 303, headers: h });
}
