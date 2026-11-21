// EGRESS reference adapter `governed` (IPB-01 EGRESS; IPB-04 §04.4.4 `EGRESS_PORT`; IPB-02-43 SSRF
// guard, @IPB-04-AT-94; LawDocsComply PR-LDC-40, R1-D-150, R1-D-176; threat model §3.125).
// The in-process form of IPB-01's "internal egress proxy with allow-list": every outbound fetch of a
// user-supplied URL goes through these checks, hop by hop. The deployment's network policy (or the
// IPB-01 alternative, cloud NAT with egress rules) still limits what the pod can reach.
//
//   * A hop is `https:` on port 443, with no user-info and a host name (never an IP literal: an
//     allow-list names hosts), on the allow-list (exact, or `*.suffix`).
//   * DNS: every address the name resolves to must be public. One refused address refuses the hop,
//     because a mixed answer is how DNS rebinding is staged. The refused ranges (IANA IPv4 and
//     IPv6 special-purpose registries, RFC 6890) live in `./guard.ts`, shared with
//     `PartnerMtlsClient` (R1-D-250).
//   * Pinning: the request's `lookup` returns only the address that was checked, so the socket goes
//     to it; TLS still verifies the certificate against the host name (SNI unchanged).
//   * Redirects (301, 302, 303, 307, 308) are followed by GET up to `maxRedirects` (5 at most), each
//     hop checked as the first; none is followed unless asked.
//   * One deadline for the whole chain; a `Content-Length` over the cap is refused before reading;
//     the body is read capped, and a gzip, deflate or br body is decoded with `maxOutputLength` at
//     the cap, so a decompression bomb stops there.
//   * Nothing identifies the tenant or the user: a fixed User-Agent, no cookies (none sent, none
//     kept), no Authorization, no Referer. `node:https` ignores proxy environment variables.
//   * Off behind `int.egress.governed.enabled` (PLATFORM, R4): every fetch is `IPB-PORT-001`.
import { request, type RequestOptions } from "node:https";
import type { IncomingMessage } from "node:http";
import { lookup as dnsLookup } from "node:dns/promises";
import { brotliDecompressSync, gunzipSync, inflateSync } from "node:zlib";
import { PortError } from "@infrabyx/contracts/errors";
import type {
  AdapterDescriptor,
  EgressFetchOptions,
  EgressFetchResult,
  EgressPort,
  PortHealth,
} from "@infrabyx/contracts/ports";
import { hostAllowed } from "../core/http.js";
import { allAddressesPublic, checkPublicHostName, pinOf, pinnedLookup } from "./guard.js";

/** The public-address check, shared with `PartnerMtlsClient` (`./guard.ts`). */
export { isPublicAddress } from "./guard.js";

const PORT = "EGRESS";
const ADAPTER = "governed";
/** The User-Agent of every governed fetch: names no tenant, user or deployment. */
export const GOVERNED_EGRESS_USER_AGENT = "InfrabyxWebSnapshot/1.0";
/** IPB-04 §04.4.4: 5 s and 2 MB unless the caller asks otherwise. */
export const GOVERNED_EGRESS_DEFAULTS = { timeoutMs: 5_000, maxBytes: 2 * 1024 * 1024 } as const;
/** The most redirects any call may follow. */
export const GOVERNED_EGRESS_MAX_REDIRECTS = 5;
type Encoding = NonNullable<EgressFetchResult["contentEncoding"]>;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);

export interface GovernedEgressOptions {
  /** `int.egress.governed.enabled` (off by default). */
  enabled: () => Promise<boolean> | boolean;
  /** Hosts any call may reach when the call names none (exact, or `*.suffix`); default none. */
  allowHosts?: readonly string[];
  /** Tests only: resolve names without DNS. */
  resolve?: (host: string) => Promise<ReadonlyArray<{ address: string; family: number }>>;
  /** Tests only: extra CA certificates to trust (a local TLS stub). */
  testCa?: string | readonly string[];
  /** Tests only: admit loopback addresses (a local TLS stub). Never set in a deployment. */
  testAllowLoopback?: boolean;
  /** Tests only: the port of the local TLS stub, used in place of 443 when connecting. */
  testConnectPort?: number;
}

type RefusalReason =
  | "scheme"
  | "port"
  | "userinfo"
  | "ip_literal"
  | "host"
  | "not_allowed"
  | "address"
  | "dns"
  | "redirect_scheme"
  | "too_many_redirects"
  | "redirect_location";

export class GovernedEgress implements EgressPort {
  readonly descriptor: AdapterDescriptor = {
    port: PORT,
    adapter: ADAPTER,
    residency: "IN",
    // A fetch carries only a public URL; nothing of the tenant's leaves (threat model §3.125).
    maxDataClass: "CONFIDENTIAL",
  };

  // The `test*` options exist for the local TLS stub only; a deployment builds the adapter with
  // `enabled` and (optionally) `allowHosts` and nothing else (as `allowLoopbackHttp` in core/http).
  constructor(private readonly o: GovernedEgressOptions) {}

  async health(): Promise<PortHealth> {
    const on = await this.o.enabled();
    return { status: on ? "up" : "down", latency_ms: 0, checked_at: new Date().toISOString() };
  }

  private refuse(reason: RefusalReason, detail: string): PortError {
    return new PortError("IPB-SEC-018", PORT, { adapter: ADAPTER, detail, meta: { reason } });
  }

  async fetch(url: string, o: EgressFetchOptions = {}): Promise<EgressFetchResult> {
    if (!(await this.o.enabled()))
      throw new PortError("IPB-PORT-001", PORT, {
        adapter: ADAPTER,
        detail: "governed egress is off",
      });
    const allow = o.allowHosts ?? this.o.allowHosts ?? [];
    const maxRedirects = Math.min(
      Math.max(0, Math.trunc(o.maxRedirects ?? 0)),
      GOVERNED_EGRESS_MAX_REDIRECTS,
    );
    const maxBytes = Math.max(1, Math.trunc(o.maxBytes ?? GOVERNED_EGRESS_DEFAULTS.maxBytes));
    const deadline = Date.now() + Math.max(1, o.timeoutMs ?? GOVERNED_EGRESS_DEFAULTS.timeoutMs);
    const redirects: string[] = [];
    let current = this.checkUrl(url, allow, "scheme");
    for (;;) {
      const address = await this.resolvePinned(current.hostname, deadline);
      const res = await this.get(current, address, o.accept, deadline);
      if (REDIRECTS.has(res.statusCode ?? 0)) {
        res.resume();
        const loc = res.headers.location;
        if (typeof loc !== "string" || loc.length === 0 || loc.length > 2048)
          throw this.refuse("redirect_location", "a redirect without a usable Location");
        if (redirects.length >= maxRedirects)
          throw this.refuse(
            "too_many_redirects",
            maxRedirects === 0
              ? "the server redirected (not followed)"
              : `more than ${maxRedirects} redirects`,
          );
        let next: URL;
        try {
          next = new URL(loc, current);
        } catch {
          throw this.refuse("redirect_location", "a redirect to an unparsable Location");
        }
        current = this.checkUrl(next.href, allow, "redirect_scheme");
        redirects.push(current.href);
        continue;
      }
      const status = res.statusCode ?? 0;
      const encoding = contentEncoding(res.headers["content-encoding"]);
      if (encoding === null) {
        res.destroy();
        throw new PortError("IPB-SEC-010", PORT, {
          adapter: ADAPTER,
          detail: "an unsupported Content-Encoding",
          meta: { reason: "content_encoding" },
        });
      }
      const declared = Number(res.headers["content-length"]);
      if (encoding === "identity" && Number.isFinite(declared) && declared > maxBytes) {
        res.destroy();
        throw tooLarge(maxBytes);
      }
      const raw = await readCapped(res, maxBytes, deadline);
      const body = decode(raw, encoding, maxBytes);
      return {
        status,
        contentType: String(res.headers["content-type"] ?? ""),
        body,
        finalUrl: current.href,
        redirects,
        contentEncoding: encoding,
      };
    }
  }

  /** The URL checks of one hop (no network). */
  checkUrl(raw: string, allow: readonly string[], schemeReason: "scheme" | "redirect_scheme"): URL {
    let u: URL;
    try {
      u = new URL(raw);
    } catch {
      throw this.refuse("scheme", "not an absolute URL");
    }
    if (u.protocol !== "https:")
      throw this.refuse(schemeReason, `refused ${u.protocol} (https only)`);
    if (u.username || u.password) throw this.refuse("userinfo", "user-info in the URL");
    if (u.port !== "" && u.port !== "443") throw this.refuse("port", "a non-default port");
    const name = checkPublicHostName(u.hostname);
    if (!name.ok)
      throw name.reason === "ip_literal"
        ? this.refuse("ip_literal", "an IP literal")
        : this.refuse("host", "not a public host name");
    if (!hostAllowed(name.host, allow))
      throw this.refuse("not_allowed", `${name.host} is not on the allow-list`);
    u.hash = "";
    return u;
  }

  private async resolvePinned(
    host: string,
    deadline: number,
  ): Promise<{ address: string; family: 4 | 6 }> {
    let answers: ReadonlyArray<{ address: string; family: number }>;
    try {
      answers = await withDeadline(
        this.o.resolve ? this.o.resolve(host) : dnsLookup(host, { all: true, verbatim: true }),
        deadline,
      );
    } catch (e) {
      if (e instanceof PortError) throw e;
      throw new PortError("IPB-PORT-002", PORT, {
        adapter: ADAPTER,
        detail: `${host} did not resolve`,
        meta: { reason: "dns" },
      });
    }
    if (answers.length === 0) throw this.refuse("dns", `${host} has no address`);
    if (!allAddressesPublic(answers, this.o.testAllowLoopback === true))
      throw this.refuse("address", `${host} resolves to a refused address range`);
    return pinOf(answers);
  }

  private get(
    u: URL,
    pinned: { address: string; family: 4 | 6 },
    accept: string | undefined,
    deadline: number,
  ): Promise<IncomingMessage> {
    const lookup = pinnedLookup(pinned);
    const ms = deadline - Date.now();
    if (ms <= 0) return Promise.reject(timedOut());
    const opts: RequestOptions = {
      method: "GET",
      protocol: "https:",
      hostname: u.hostname,
      port: this.o.testConnectPort ?? 443,
      path: `${u.pathname}${u.search}`,
      servername: u.hostname,
      lookup,
      agent: false,
      headers: {
        host: u.host,
        "user-agent": GOVERNED_EGRESS_USER_AGENT,
        accept: accept ?? "*/*",
        "accept-encoding": "gzip, deflate, br",
        connection: "close",
      },
      timeout: ms,
      ...(this.o.testCa ? { ca: this.o.testCa as string | string[] } : {}),
    };
    return new Promise((resolve, reject) => {
      const req = request(opts, resolve);
      const timer = setTimeout(() => req.destroy(timedOut()), ms);
      req.on("response", () => clearTimeout(timer));
      req.on("timeout", () => req.destroy(timedOut()));
      req.on("error", (e) => {
        clearTimeout(timer);
        reject(
          e instanceof PortError
            ? e
            : new PortError("IPB-PORT-002", PORT, {
                adapter: ADAPTER,
                detail: `${u.hostname} unreachable`,
                meta: { cause: (e as NodeJS.ErrnoException).code ?? e.name },
              }),
        );
      });
      req.end();
    });
  }
}

function timedOut(): PortError {
  return new PortError("IPB-PORT-002", PORT, {
    adapter: ADAPTER,
    detail: "the fetch timed out",
    meta: { reason: "timeout" },
  });
}

function tooLarge(max: number): PortError {
  return new PortError("IPB-SEC-013", PORT, {
    adapter: ADAPTER,
    detail: `the response is over ${max} bytes`,
    meta: { reason: "too_large", maxBytes: max },
  });
}

async function withDeadline<T>(p: Promise<T>, deadline: number): Promise<T> {
  const ms = deadline - Date.now();
  if (ms <= 0) throw timedOut();
  let t: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, reject) => {
        t = setTimeout(() => reject(timedOut()), ms);
      }),
    ]);
  } finally {
    clearTimeout(t);
  }
}

function contentEncoding(h: string | undefined): Encoding | null {
  const v = (h ?? "identity").trim().toLowerCase();
  if (v === "" || v === "identity") return "identity";
  if (v === "gzip" || v === "x-gzip") return "gzip";
  if (v === "deflate") return "deflate";
  if (v === "br") return "br";
  return null;
}

function readCapped(res: IncomingMessage, max: number, deadline: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let n = 0;
    const ms = deadline - Date.now();
    if (ms <= 0) {
      res.destroy();
      reject(timedOut());
      return;
    }
    const timer = setTimeout(() => {
      res.destroy();
      reject(timedOut());
    }, ms);
    res.on("data", (c: Buffer) => {
      n += c.byteLength;
      if (n > max) {
        clearTimeout(timer);
        res.destroy();
        reject(tooLarge(max));
        return;
      }
      chunks.push(c);
    });
    res.on("end", () => {
      clearTimeout(timer);
      resolve(new Uint8Array(Buffer.concat(chunks, n)));
    });
    res.on("error", (e) => {
      clearTimeout(timer);
      reject(
        new PortError("IPB-PORT-002", PORT, {
          adapter: ADAPTER,
          detail: "the response was cut off",
          meta: { cause: (e as NodeJS.ErrnoException).code ?? e.name },
        }),
      );
    });
  });
}

function decode(raw: Uint8Array, enc: Encoding, max: number): Uint8Array {
  if (enc === "identity") return raw;
  const opts = { maxOutputLength: max };
  try {
    const out =
      enc === "gzip"
        ? gunzipSync(raw, opts)
        : enc === "deflate"
          ? inflateSync(raw, opts)
          : brotliDecompressSync(raw, opts);
    return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ERR_BUFFER_TOO_LARGE" || e instanceof RangeError)
      throw tooLarge(max);
    throw new PortError("IPB-SEC-010", PORT, {
      adapter: ADAPTER,
      detail: `the ${enc} body does not decode`,
      meta: { reason: "content_encoding" },
    });
  }
}
