// Runs before every route (Next 16 proxy, Node runtime): a per-request CSP nonce, the security
// headers and `noindex` (a signed-in app is never indexed), as in `apps/console`. The pages decide
// what a signed-out visitor sees; the API checks every call.
import { NextResponse, type NextRequest } from "next/server";
import { randomBytes, toBase64Url } from "@infrabyx/crypto";

export const config = {
  matcher: ["/((?!_next/static|_next/image|health/).*)"],
};

export function proxy(request: NextRequest) {
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
  headers.set("Content-Security-Policy", csp);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set("Content-Security-Policy", csp);
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Referrer-Policy", "same-origin");
  res.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.headers.set("X-Robots-Tag", "noindex, nofollow");
  if (!res.headers.has("Cache-Control")) res.headers.set("Cache-Control", "no-store");
  return res;
}
