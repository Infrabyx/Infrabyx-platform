// The web app's only way to the API (the backend-for-frontend of PL6 plan §8.1): server-side calls
// to APP_API_URL that forward the browser's session cookie and nothing else, and the proxy of the
// sign-in routes, so the browser never talks to the API and the session cookie stays HttpOnly on
// this origin. Problems (RFC 9457) come back as values for the pages to show.
import { cookies } from "next/headers";
import { webEnv } from "./env.ts";

/** The API's session cookie (`ibx_session`, set by `/auth/callback` through the proxy below). */
export const SESSION_COOKIE = "ibx_session";
const TIMEOUT_MS = 10_000;

export interface Problem {
  status: number;
  title: string;
  detail?: string;
  code?: string;
}

export type ApiResult<T> = { ok: true; status: number; body: T } | { ok: false; problem: Problem };

async function sessionHeader(): Promise<string | undefined> {
  const v = (await cookies()).get(SESSION_COOKIE)?.value;
  return v ? `${SESSION_COOKIE}=${encodeURIComponent(v)}` : undefined;
}

/** Whether the browser holds a session cookie (not whether it is still valid). */
export async function hasSession(): Promise<boolean> {
  return (await sessionHeader()) !== undefined;
}

/** Call the API as the signed-in person (or anonymously for the public routes). */
export async function api<T>(
  path: string,
  o: { method?: "GET" | "POST"; body?: unknown } = {},
): Promise<ApiResult<T>> {
  const env = await webEnv();
  const cookie = await sessionHeader();
  let r: Response;
  try {
    r = await fetch(`${env.APP_API_URL.replace(/\/$/, "")}${path}`, {
      method: o.method ?? "GET",
      headers: {
        accept: "application/json",
        ...(cookie ? { cookie } : {}),
        ...(o.body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(o.body === undefined ? {} : { body: JSON.stringify(o.body) }),
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return { ok: false, problem: { status: 503, title: "The service is not reachable" } };
  }
  const text = await r.text();
  const json = (() => {
    try {
      return text ? (JSON.parse(text) as unknown) : null;
    } catch {
      return null;
    }
  })();
  if (r.ok) return { ok: true, status: r.status, body: json as T };
  const p = (json ?? {}) as Partial<Problem>;
  return {
    ok: false,
    problem: {
      status: r.status,
      title: typeof p.title === "string" ? p.title : `Request failed (${r.status})`,
      ...(typeof p.detail === "string" ? { detail: p.detail } : {}),
      ...(typeof p.code === "string" ? { code: p.code } : {}),
    },
  };
}

/**
 * Proxy one sign-in route (`/auth/login`, `/auth/callback`, `/auth/logout`) to the API: the query
 * and cookies go through, and the redirect, its `Location` and the `Set-Cookie` headers come back.
 */
export async function proxyAuth(req: Request, route: "login" | "callback" | "logout") {
  const env = await webEnv();
  const url = new URL(req.url);
  const r = await fetch(`${env.APP_API_URL.replace(/\/$/, "")}/auth/${route}${url.search}`, {
    method: req.method,
    headers: {
      ...(req.headers.get("cookie") ? { cookie: req.headers.get("cookie")! } : {}),
    },
    redirect: "manual",
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const headers = new Headers({ "cache-control": "no-store" });
  const location = r.headers.get("location");
  if (location) headers.set("location", location);
  for (const c of r.headers.getSetCookie()) headers.append("set-cookie", c);
  // No body with a redirect, 204 or 304 (the Fetch `Response` refuses one, even an empty string).
  const bodyless = r.status === 204 || r.status === 304 || (r.status >= 300 && r.status < 400);
  return new Response(bodyless ? null : await r.text(), { status: r.status, headers });
}
