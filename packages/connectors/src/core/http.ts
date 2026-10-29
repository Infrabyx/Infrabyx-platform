// Outbound HTTP for REST adapters (plan §3.7; IPB-02-43 SSRF guard). HTTPS only, hosts on the
// adapter's allow-list, redirects never followed (refused unless read), response size capped, timeouts and Retry-After honoured.
// A host outside the list is IPB-SEC-018; transport failures and 5xx are IPB-PORT-002.
import { PortError } from "@infrabyx/contracts/errors";

export interface EgressOptions {
  port: string;
  adapter: string;
  /** Exact hosts, or `*.example.com` for subdomains. */
  allow: readonly string[];
  timeoutMs?: number;
  /** Retries for idempotent requests (GET/HEAD/PUT/DELETE, or `retryUnsafe`). */
  retries?: number;
  backoffMs?: number;
  retryUnsafe?: boolean;
  maxBytes?: number;
  /** Tests only: allow http:// to 127.0.0.1 and localhost (stubs). */
  allowLoopbackHttp?: boolean;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export interface EgressResponse {
  status: number;
  headers: Headers;
  body: Uint8Array;
  json<T = unknown>(): T;
  text(): string;
}

const SAFE = new Set(["GET", "HEAD", "PUT", "DELETE", "OPTIONS"]);
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

export function hostAllowed(host: string, allow: readonly string[]): boolean {
  const h = host.toLowerCase();
  return allow.some((a) => {
    const x = a.toLowerCase();
    return x.startsWith("*.") ? h.endsWith(x.slice(1)) && h.length > x.length - 1 : h === x;
  });
}

export function createEgress(o: EgressOptions) {
  const doFetch = o.fetchImpl ?? fetch;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const err = (
    code: "IPB-PORT-002" | "IPB-SEC-018" | "IPB-PORT-001",
    detail: string,
    meta?: Record<string, unknown>,
  ) => new PortError(code, o.port, { adapter: o.adapter, detail, ...(meta ? { meta } : {}) });

  return async function egress(url: string | URL, init: RequestInit = {}): Promise<EgressResponse> {
    const u = new URL(url);
    const loopback = LOOPBACK.has(u.hostname) && o.allowLoopbackHttp === true;
    if (u.protocol !== "https:" && !(loopback && u.protocol === "http:"))
      throw err("IPB-SEC-018", `refused non-HTTPS URL for ${u.hostname}`);
    if (!loopback && !hostAllowed(u.hostname, o.allow))
      throw err("IPB-SEC-018", `host ${u.hostname} is not on the ${o.adapter} allow-list`);
    const method = (init.method ?? "GET").toUpperCase();
    const attempts = 1 + (SAFE.has(method) || o.retryUnsafe ? (o.retries ?? 2) : 0);
    let last: unknown;
    for (let i = 0; i < attempts; i++) {
      let res: Response;
      try {
        res = await doFetch(u, {
          ...init,
          method,
          redirect: "manual",
          signal: AbortSignal.timeout(o.timeoutMs ?? 8000),
        });
      } catch (e) {
        last = err("IPB-PORT-002", `${o.adapter} unreachable or timed out`, {
          cause: (e as Error).name,
        });
        if (i + 1 < attempts) await sleep((o.backoffMs ?? 400) * 2 ** i);
        continue;
      }
      // A redirect is never followed. A caller that reads one (an OIDC authorisation request's
      // `Location`) asks with `redirect: "manual"` and gets the 3xx response; anyone else is refused.
      if (res.status >= 300 && res.status < 400 && init.redirect !== "manual")
        throw err("IPB-SEC-018", `${o.adapter} answered with a redirect (refused)`);
      const body = await readCapped(res, o.maxBytes ?? 5 * 1024 * 1024).catch(() => {
        throw err("IPB-PORT-002", `${o.adapter} response exceeded the size cap`);
      });
      if (res.status === 429 || res.status >= 500) {
        last = err("IPB-PORT-002", `${o.adapter} answered ${res.status}`, {
          vendorStatus: res.status,
        });
        if (i + 1 < attempts) {
          const ra = Number(res.headers.get("retry-after"));
          await sleep(
            Number.isFinite(ra) && ra > 0
              ? Math.min(ra * 1000, 60_000)
              : (o.backoffMs ?? 400) * 2 ** i,
          );
          continue;
        }
        throw last;
      }
      return wrap(res, body);
    }
    throw last;
  };
}

async function readCapped(res: Response, max: number): Promise<Uint8Array> {
  if (!res.body) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let n = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.byteLength;
    if (n > max) {
      await reader.cancel();
      throw new Error("too large");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(n);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

function wrap(res: Response, body: Uint8Array): EgressResponse {
  const text = () => new TextDecoder().decode(body);
  return {
    status: res.status,
    headers: res.headers,
    body,
    text,
    json: <T>() => JSON.parse(text()) as T,
  };
}
