// zstd refusal contract cases for a Next.js 16 proxy (PR-UDF-089; R1-D-320; CVE-2026-124851). A
// product runs them against its own `proxy` function, so the refusal is proved where it is wired,
// first, on every path the proxy matches, health probes included:
//   - a request whose Content-Encoding names zstd (any case, in a list, `x-zstd`) gets 415 with an
//     RFC 9457 problem (`<prefix>-SEC-010`, `reason: content_encoding`), and its body is unread;
//   - the problem's `instance` is the path only, never the query string;
//   - a health probe naming zstd is refused the same way;
//   - gzip, deflate, br, identity and no coding at all are never refused.
// Behind Next 16 the 415 carries no `Accept-Encoding` (Next strips it from proxy responses), so the
// cases do not require that header; a non-Next handler using `refuseZstdInNextProxy` still sends it.
import { expect } from "vitest";
import type { ContractCase } from "./contract.js";

/** A proxy as a product exports it: a Fetch `Request` (Next passes a `NextRequest`) in, a response or nothing out. */
export type NextProxyLike = (
  request: Request,
) => Response | undefined | null | void | Promise<Response | undefined | null | void>;

export interface NextProxyZstdFixtures {
  /** The origin the requests are built on; default `https://app.example.test`. */
  origin?: string;
  /** A path the proxy matches that is not a health probe; default `/v1/applications`. */
  path?: string;
  /** The health-probe paths the proxy matches; default `["/health/live", "/health/ready"]`. */
  healthPaths?: readonly string[];
  /** The problem code expected; default `IPB-SEC-010` (`UDF-SEC-010` with a product prefix). */
  code?: string;
  /** Build the request the proxy receives (e.g. wrap it in a `NextRequest`); default as is. */
  toRequest?(request: Request): Request;
}

const REFUSED = ["zstd", "ZSTD", "gzip, zstd", "x-zstd", " Zstd "] as const;
const ALLOWED = ["gzip", "deflate", "br", "identity", "gzip, br"] as const;

export function nextProxyZstdContractCases(
  fx: NextProxyZstdFixtures = {},
): Array<ContractCase<NextProxyLike>> {
  const origin = fx.origin ?? "https://app.example.test";
  const path = fx.path ?? "/v1/applications";
  const healthPaths = fx.healthPaths ?? ["/health/live", "/health/ready"];
  const code = fx.code ?? "IPB-SEC-010";
  const build = (p: string, encoding: string | undefined, method = "POST"): Request => {
    const headers = new Headers({ "content-type": "application/json" });
    if (encoding !== undefined) headers.set("content-encoding", encoding);
    const init: RequestInit = { method, headers };
    if (method !== "GET" && method !== "HEAD") init.body = "x".repeat(64);
    const req = new Request(new URL(p, origin), init);
    return fx.toRequest ? fx.toRequest(req) : req;
  };
  const expectRefused = async (res: unknown, req: Request, expectedPath: string) => {
    expect(res).toBeInstanceOf(Response);
    const r = res as Response;
    expect(r.status).toBe(415);
    expect(r.headers.get("content-type")).toBe("application/problem+json");
    expect(r.headers.get("cache-control")).toBe("no-store");
    const body = (await r.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ status: 415, code, reason: "content_encoding" });
    expect(body["instance"]).toBe(expectedPath);
    // The refusal never reads what the client sent.
    expect(req.bodyUsed).toBe(false);
  };
  const isRefusal = (res: unknown) => res instanceof Response && res.status === 415;
  return [
    {
      name: "a body naming zstd (any case, in a list, x-zstd) gets 415 with the problem, unread (PR-UDF-089)",
      async run(proxy) {
        for (const enc of REFUSED) {
          const req = build(path, enc);
          await expectRefused(await proxy(req), req, path);
        }
      },
    },
    {
      name: "the problem's instance is the path only, never the query string (PR-UDF-089)",
      async run(proxy) {
        const req = build(`${path}?pan=SYNTHETIC1234&token=t`, "zstd");
        const res = await proxy(req);
        await expectRefused(res, req, path);
      },
    },
    {
      name: "a health probe naming zstd is refused the same way: the refusal runs before any other handling (PR-UDF-089)",
      async run(proxy) {
        for (const p of healthPaths) {
          const req = build(p, "zstd", "GET");
          await expectRefused(await proxy(req), req, p);
        }
      },
    },
    {
      name: "gzip, deflate, br, identity and no coding are never refused (PR-UDF-089)",
      async run(proxy) {
        for (const enc of [...ALLOWED, undefined]) {
          expect(isRefusal(await proxy(build(path, enc)))).toBe(false);
        }
        for (const p of healthPaths)
          expect(isRefusal(await proxy(build(p, undefined, "GET")))).toBe(false);
      },
    },
  ];
}
