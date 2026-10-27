// Runs before every route (Next 16 proxy, Node runtime; PL5 plan §9.1; IPB-02 CSP rows):
// - a per-request CSP nonce and the security headers; Next applies the nonce it finds in the
//   request's CSP to its own scripts;
// - CMS paths are resolved here first: redirects are answered at once, removed content is a 410
//   and unknown paths a 404, each rewritten to the server-rendered `/__not-found` page with that
//   status (Next's `notFound()` boundary would need JavaScript to show its content, IPB-04-12);
// - `/sitemap-{type}.xml` from the sitemap index is served by `/api/sitemap/{type}`.
import { NextResponse, type NextRequest } from "next/server";
import { randomBytes, toBase64Url } from "@infrabyx/crypto";
import { keyOf } from "./render/legal.tsx";
import { getSite, packFor } from "./server/site.ts";

/** Static assets and the health probes carry no page, so they skip the proxy. */
export const config = {
  matcher: ["/((?!_next/static|_next/image|health/).*)"],
};

/** The site's own routes: everything else is a CMS path. */
const SITE_ROUTES =
  /^\/(?:_next\/|api\/|assets\/|\.well-known\/|feedback(?:\/|$)|(?:accessibility|grievance|sitemap|glossary|security|cookie-settings|__gallery|__not-found|legal|sitemap\.xml|robots\.txt|llms\.txt|icon\.svg|site\.webmanifest|consent\.js|feedback\.js)$)/;
const LEGAL = /^\/legal\/([a-z0-9-]{1,60})(?:\/v\/(\d+\.\d+))?$/;

function securityHeaders(res: NextResponse, csp: string): NextResponse {
  res.headers.set("Content-Security-Policy", csp);
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  return res;
}

/** What a path resolves to before rendering: render it, redirect, or rewrite to the 404/410 page. */
async function route(
  request: NextRequest,
): Promise<
  | { kind: "render" }
  | { kind: "redirect"; to: string; status: 301 | 302 }
  | { kind: "missing"; status: 404 | 410 }
> {
  const path = request.nextUrl.pathname;
  const legal = LEGAL.exec(path);
  if (!legal && SITE_ROUTES.test(path)) return { kind: "render" };
  const site = await getSite();
  const { packId } = await packFor(site, request.headers.get("host"));
  if (legal) {
    const key = keyOf(legal[1]!);
    const found = legal[2]
      ? await site.policies.version(packId, key, legal[2])
      : await site.policies.current(packId, key);
    return found ? { kind: "render" } : { kind: "missing", status: 404 };
  }
  const r = await site.content.resolve(packId, "en-IN", path);
  if (r.kind === "content") return { kind: "render" };
  if (r.kind === "redirect") return { kind: "redirect", to: r.to, status: r.status };
  return { kind: "missing", status: r.kind === "gone" ? 410 : 404 };
}

export async function proxy(request: NextRequest) {
  const sm = /^\/sitemap-([a-z_]{1,40})\.xml$/.exec(request.nextUrl.pathname);
  if (sm) return NextResponse.rewrite(new URL(`/api/sitemap/${sm[1]}`, request.url));

  const nonce = toBase64Url(randomBytes(16));
  const csp = [
    "default-src 'self'",
    `script-src 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
  ].join("; ");
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("x-path", request.nextUrl.pathname);
  headers.set("Content-Security-Policy", csp);

  const r = await route(request);
  if (r.kind === "redirect")
    return securityHeaders(NextResponse.redirect(new URL(r.to, request.url), r.status), csp);
  if (r.kind === "missing") {
    const to = new URL("/__not-found", request.url);
    if (r.status === 410) to.searchParams.set("gone", "1");
    return securityHeaders(
      NextResponse.rewrite(to, { request: { headers }, status: r.status }),
      csp,
    );
  }
  return securityHeaders(NextResponse.next({ request: { headers } }), csp);
}
