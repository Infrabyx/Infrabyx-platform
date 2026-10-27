// Request helpers for the POST endpoints: a same-origin check (the CSRF defence for form posts and
// the controllers' fetches), the parsed form body, the cookies, and the client key the rate limits
// use (a hash of the address, never stored).
import { sha256Hex } from "@infrabyx/crypto";

/** True when the post came from this site (Origin, or Sec-Fetch-Site for older browsers). */
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

export async function formBody(req: Request): Promise<Record<string, string>> {
  const type = req.headers.get("content-type") ?? "";
  if (type.includes("application/x-www-form-urlencoded") || type.includes("multipart/form-data")) {
    const f = await req.formData();
    const out: Record<string, string> = {};
    for (const [k, v] of f.entries()) if (typeof v === "string") out[k] = v.slice(0, 10_000);
    return out;
  }
  if (type.includes("application/json")) {
    const j = (await req.json()) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(j)
        .filter(([, v]) => typeof v === "string" || typeof v === "number" || typeof v === "boolean")
        .map(([k, v]) => [k, String(v).slice(0, 10_000)]),
    );
  }
  return {};
}

export function cookieMap(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (req.headers.get("cookie") ?? "").split(/;\s*/)) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i)] = decodeURIComponent(part.slice(i + 1));
  }
  return out;
}

export const headerMap = (req: Request): Record<string, string> =>
  Object.fromEntries([...req.headers.entries()].map(([k, v]) => [k.toLowerCase(), v]));

export const clientKey = (req: Request) =>
  sha256Hex(
    `${req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local"}|${req.headers.get("user-agent") ?? ""}`,
  );

/** The path of the page the post came from, or a fallback (never another origin). */
export function refererPath(req: Request, fallback: string): string {
  const r = req.headers.get("referer");
  if (!r) return fallback;
  try {
    const u = new URL(r);
    return u.host === req.headers.get("host") ? u.pathname : fallback;
  } catch {
    return fallback;
  }
}

export const seeOther = (location: string, cookies: readonly string[] = []) => {
  const h = new Headers({ Location: location, "Cache-Control": "no-store" });
  for (const c of cookies) h.append("Set-Cookie", c);
  return new Response(null, { status: 303, headers: h });
};

export const wantsJson = (req: Request) =>
  (req.headers.get("accept") ?? "").includes("application/json");

/** Cookies are `Secure` whenever the visitor reached the site over HTTPS (directly or via the edge). */
export const isHttps = (req: Request) =>
  new URL(req.url).protocol === "https:" || req.headers.get("x-forwarded-proto") === "https";
