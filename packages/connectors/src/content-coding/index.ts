// Content codings the platform will not decode (LDC-68, SEC-ZSTD-01; R1-D-294).
//
// CVE-2026-124851: zstd 1.5.1 to 1.5.7 can leave part of its output buffer uninitialised, so a
// sender who can read back what it sent may recover process memory. Node.js 24.22.1 and 24.22.3
// bundle zstd 1.5.7 for `node:zlib`, and two things decode with it on their own:
//
//   * inbound: body-parser 2.x (Express 5, under @nestjs/platform-express) inflates any request
//     whose `Content-Encoding` is `zstd` before a guard or a handler runs;
//   * outbound: Node's `fetch` (undici) offers `zstd` in `Accept-Encoding` over https and decodes a
//     zstd response whatever was offered.
//
// `refuseZstdBodies` answers 415 (an RFC 9457 problem, `IPB-SEC-010`, `reason: content_encoding`)
// before any body parser reads a byte; gzip, deflate, br and identity pass. `refuseZstdFetch`
// offers only gzip, deflate and br and refuses a zstd response before its body is read. Products
// use these instead of their own copies. Both stay until the runtime's zstd is fixed (R1-D-294).
import type { IncomingMessage, ServerResponse } from "node:http";
import { IpbError, toProblem, type Problem } from "@infrabyx/contracts/errors";

/** Content codings refused in either direction (`x-zstd` too, though nothing here decodes it). */
export const REFUSED_CONTENT_CODINGS: readonly string[] = Object.freeze(["zstd", "x-zstd"]);

/** The codings a request body may use (besides identity); sent back in `Accept-Encoding` on a 415. */
export const ACCEPTED_REQUEST_CODINGS: readonly string[] = Object.freeze(["gzip", "deflate", "br"]);

/** The `Accept-Encoding` every outbound request sends: never zstd. */
export const OUTBOUND_ACCEPT_ENCODING = "gzip, deflate, br";

/** Where the problem's `type` points, as the reference API's (`https://help.infrabyx.in/errors`). */
export const CONTENT_CODING_PROBLEM_TYPE_BASE = "https://help.infrabyx.in/errors";

/** A `Content-Encoding` value (or a repeated header) as its lower-case codings, in order. */
export function contentCodings(value: string | readonly string[] | null | undefined): string[] {
  if (value === undefined || value === null) return [];
  const parts = typeof value === "string" ? [value] : value;
  return parts
    .flatMap((p) => p.split(","))
    .map((c) => c.trim().toLowerCase())
    .filter((c) => c !== "");
}

/** True when any coding of the value is one the platform refuses. */
export function namesRefusedCoding(value: string | readonly string[] | null | undefined): boolean {
  return contentCodings(value).some((c) => REFUSED_CONTENT_CODINGS.includes(c));
}

export interface RefusedCodingProblemOptions {
  /** Help-page base for the problem's `type`; default `CONTENT_CODING_PROBLEM_TYPE_BASE`. */
  typeBase?: string;
  /** A product's re-export prefix (IPB-01 §01.6.3): "LDC" turns `IPB-SEC-010` into `LDC-SEC-010`. */
  productPrefix?: string;
}

/** The 415 problem for a refused request coding. The detail names no coding the client did not send. */
export function refusedCodingProblem(
  o: RefusedCodingProblemOptions & { instance?: string; traceId?: string } = {},
): Problem {
  return toProblem(
    new IpbError("IPB-SEC-010", {
      detail: "The request body's Content-Encoding is not accepted; use gzip, deflate, br or none.",
      meta: { reason: "content_encoding" },
    }),
    {
      typeBase: o.typeBase ?? CONTENT_CODING_PROBLEM_TYPE_BASE,
      ...(o.productPrefix !== undefined ? { productPrefix: o.productPrefix } : {}),
      ...(o.instance !== undefined ? { instance: o.instance } : {}),
      ...(o.traceId !== undefined ? { traceId: o.traceId } : {}),
    },
  );
}

const TRACE = /^[0-9a-f]{2}-([0-9a-f]{32})-[0-9a-f]{16}-[0-9a-f]{2}$/;

function traceIdOf(req: IncomingMessage): string | undefined {
  const tp = req.headers["traceparent"];
  const v = Array.isArray(tp) ? tp[0] : tp;
  return v ? TRACE.exec(v.trim())?.[1] : undefined;
}

export type ConnectMiddleware = (
  req: IncomingMessage,
  res: ServerResponse,
  next: (err?: unknown) => void,
) => void;

/**
 * Connect/Express middleware: a request whose `Content-Encoding` names zstd is answered 415 at once
 * and its body is never read or decoded. Register it before every body parser and every guard:
 * in NestJS, `app.use(refuseZstdBodies)` straight after `NestFactory.create` (Nest registers its
 * parsers at `init`, after it); in Express, as the first `app.use`.
 */
export function refuseZstdBodiesWith(o: RefusedCodingProblemOptions = {}): ConnectMiddleware {
  return (req, res, next) => {
    if (!namesRefusedCoding(req.headers["content-encoding"])) {
      next();
      return;
    }
    refuse(req, res, o);
  };
}

/** `refuseZstdBodiesWith()` with the platform's codes and help base. */
export const refuseZstdBodies: ConnectMiddleware = refuseZstdBodiesWith();

function refuse(req: IncomingMessage, res: ServerResponse, o: RefusedCodingProblemOptions): void {
  const traceId = traceIdOf(req);
  const p = refusedCodingProblem({
    ...o,
    // The path only: the query string can carry what a log or a problem should not.
    ...(req.url ? { instance: req.url.split("?")[0] } : {}),
    ...(traceId ? { traceId } : {}),
  });
  const body = JSON.stringify(p);
  res.statusCode = 415;
  res.setHeader("content-type", "application/problem+json");
  res.setHeader("cache-control", "no-store");
  // RFC 9110 §15.5.16: a 415 for a content coding says which codings are accepted.
  res.setHeader("accept-encoding", ACCEPTED_REQUEST_CODINGS.join(", "));
  res.setHeader("content-length", Buffer.byteLength(body));
  // The body is not read: close the connection rather than drain what the client sent.
  res.setHeader("connection", "close");
  res.end(body);
}

/** Thrown by `refuseZstdFetch` when a response is zstd-coded; adapters map it to their port error. */
export class RefusedContentCodingError extends Error {
  readonly code = "IPB-SEC-010";
  readonly reason = "content_encoding";
  constructor(readonly url: string) {
    super("the response used a refused Content-Encoding (zstd)");
    this.name = "RefusedContentCodingError";
  }
}

/**
 * A `fetch` that never offers zstd (`Accept-Encoding: gzip, deflate, br`, replacing any caller's
 * value) and refuses a zstd response before its body is read: the body is cancelled and
 * `RefusedContentCodingError` thrown. A sender that ignores `Accept-Encoding` can still make
 * undici's decoder start on the first bytes, but its output is cancelled unread, so nothing of
 * it reaches a caller, a store, a log or the sender.
 */
export function refuseZstdFetch(fetchImpl?: typeof fetch): typeof fetch {
  // The global is read at each call, so a test that replaces it is still wrapped.
  const doFetch = fetchImpl ?? ((i: Parameters<typeof fetch>[0], n?: RequestInit) => fetch(i, n));
  const wrapped = async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const headers = withOutboundAcceptEncoding(
      init?.headers ?? (input instanceof Request ? new Headers(input.headers) : undefined),
    );
    const res = await doFetch(input, { ...init, headers });
    if (namesRefusedCoding(res.headers.get("content-encoding"))) {
      await res.body?.cancel().catch(() => undefined);
      const url = input instanceof Request ? input.url : String(input);
      throw new RefusedContentCodingError(new URL(url).origin);
    }
    return res;
  };
  return wrapped as typeof fetch;
}

/**
 * The caller's headers with `accept-encoding` replaced, in the shape they came in (a `Headers`,
 * an array of pairs or a plain record), so an injected fetch that reads them is not surprised.
 */
function withOutboundAcceptEncoding(h: HeadersInit | undefined): HeadersInit {
  const isAe = (k: string) => k.toLowerCase() === "accept-encoding";
  if (h === undefined) return { "accept-encoding": OUTBOUND_ACCEPT_ENCODING };
  if (h instanceof Headers) {
    const out = new Headers(h);
    out.set("accept-encoding", OUTBOUND_ACCEPT_ENCODING);
    return out;
  }
  if (Array.isArray(h))
    return [
      ...(h as [string, string][]).filter(([k]) => !isAe(k)),
      ["accept-encoding", OUTBOUND_ACCEPT_ENCODING],
    ];
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(h)) if (!isAe(k)) out[k] = v;
  out["accept-encoding"] = OUTBOUND_ACCEPT_ENCODING;
  return out;
}
