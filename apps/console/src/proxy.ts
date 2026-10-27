// Runs before every route (Next 16 proxy, Node runtime; PL5 plan §9.6):
// - a per-request CSP nonce, the security headers and `noindex` (Studio is never indexed);
// - the Studio gate: no session → the sign-in page; an unknown section → 404; a section the
//   AUTHZ port does not open for the person → 403. Both are server-rendered pages with that
//   status (no JavaScript needed). Routes and actions check again; the services check every move.
import { NextResponse, type NextRequest } from "next/server";
import { randomBytes, toBase64Url } from "@infrabyx/crypto";
import { isSection } from "./server/screens.tsx";
import { mayOpen, SESSION_COOKIE, sessionFrom } from "./server/session.ts";

const STUDIO = /^\/studio(?:-actions)?\/([a-z_]+)(?:\/|$)/;

async function gate(request: NextRequest): Promise<"ok" | "sign-in" | 403 | 404> {
  const m = STUDIO.exec(request.nextUrl.pathname);
  if (!m) return "ok";
  if (!isSection(m[1]!)) return 404;
  const s = await sessionFrom(request.cookies.get(SESSION_COOKIE)?.value);
  if (!s) return "sign-in";
  return (await mayOpen(s, m[1]!)) ? "ok" : 403;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|health/).*)"],
};

export async function proxy(request: NextRequest) {
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
  const g = await gate(request);
  const res =
    g === "sign-in"
      ? NextResponse.redirect(new URL("/sign-in", request.url), 303)
      : g === "ok"
        ? NextResponse.next({ request: { headers } })
        : NextResponse.rewrite(new URL(g === 403 ? "/denied" : "/missing", request.url), {
            request: { headers },
            status: g,
          });
  res.headers.set("Content-Security-Policy", csp);
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Referrer-Policy", "same-origin");
  res.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.headers.set("X-Robots-Tag", "noindex, nofollow");
  res.headers.set("Cache-Control", "no-store");
  return res;
}
