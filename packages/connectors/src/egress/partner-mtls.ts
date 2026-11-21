// `PartnerMtlsClient`: one outbound call to a partner over mutual TLS (Udofin PR-UDF-069; R1-D-250;
// threat model §3.172; IPB-02-21 TLS in transit, IPB-02-43 SSRF guard, IPB-10-07 idempotency keys).
// The outbound side of partner mTLS; the inbound side is `readClientCertificate` in
// `@infrabyx/crypto` (PR-UDF-064, R1-D-238).
//
//   * Configured, not user-supplied: the client is built with the partner's exact host names, two
//     SECRETS references (the client certificate and its key) and, optionally, the CA certificates
//     the partner's server certificate must chain to (otherwise Node's bundled roots).
//   * A call is `POST` or `PUT` to `https://<one of the hosts>[:443]/<path>`, with a body, a
//     content type and a required `Idempotency-Key`. Any other method, scheme or port, user-info,
//     an IP literal or a host off the list is refused before anything leaves the process.
//   * DNS once per call: every answer must be public (`./guard.ts`, shared with `governed`), and
//     the socket is pinned to the checked address; TLS sends SNI and verifies the server's
//     certificate against the host name (no rebinding, no `rejectUnauthorized: false`). TLS 1.2 at
//     least (IPB-02-21); Node's default cipher list.
//   * The client certificate and key are resolved from SECRETS by reference on first use and kept
//     only inside a TLS secure context for `credentialTtlMs` (5 minutes by default, never past the
//     certificate's notAfter), then resolved again, so a rotation in SECRETS is picked up. The key
//     is never logged, never put in an error and never returned. KMS-held keys are not supported:
//     Node's TLS signs the handshake with an in-memory key only (owner question #180).
//   * A 3xx answer is refused (`redirect`); redirects are never followed. The answer is read
//     capped (`maxResponseBytes`, 1 MiB by default) and aborted at the cap; only an identity
//     encoding is asked for and accepted.
//   * One deadline (`timeoutMs`, 15 s by default) covers DNS, the handshake, the request and the
//     answer; the caller's `AbortSignal` stops it as well. Either is `IPB-PORT-002` with the reason
//     `timeout` or `aborted` and `meta.maybeSent`: true once the connection was open, when the
//     partner may have received the request (retry with the same Idempotency-Key).
//   * Errors carry fixed labels (`meta.reason`) and never the URL's path or query, a header value
//     or the body. Recording the call in the audit ledger is the caller's (the product's module
//     that owns the partner call), in its own transaction, as for every adapter call.
import { lookup as dnsLookup } from "node:dns/promises";
import type { IncomingMessage } from "node:http";
import { request, type RequestOptions } from "node:https";
import { createSecureContext, type SecureContext } from "node:tls";
import { PortError } from "@infrabyx/contracts/errors";
import {
  checkClientCredential,
  type ClientCredentialInfo,
  type ClientCredentialRefusal,
} from "@infrabyx/crypto";
import { parseSecretRef, type SecretRef } from "@infrabyx/contracts/ports";
import {
  allAddressesPublic,
  checkPublicHostName,
  pinOf,
  pinnedLookup,
  type ResolvedAddress,
} from "./guard.js";

const PORT = "EGRESS";
const ADAPTER = "partner-mtls";
/** The User-Agent of every partner call: names no tenant, user or deployment. */
export const PARTNER_MTLS_USER_AGENT = "InfrabyxPartnerClient/1.0";
/** The defaults and the ceilings of the client's limits. */
export const PARTNER_MTLS_LIMITS = {
  timeoutMs: 15_000,
  maxTimeoutMs: 120_000,
  maxResponseBytes: 1024 * 1024,
  maxResponseBytesCeiling: 16 * 1024 * 1024,
  maxRequestBytes: 1024 * 1024,
  maxRequestBytesCeiling: 16 * 1024 * 1024,
  credentialTtlMs: 5 * 60_000,
  minCredentialTtlMs: 1_000,
  maxCredentialTtlMs: 60 * 60_000,
} as const;
/** The methods a partner call may use: a body, and an Idempotency-Key the partner de-duplicates on. */
export const PARTNER_MTLS_METHODS = ["POST", "PUT"] as const;
export type PartnerMtlsMethod = (typeof PARTNER_MTLS_METHODS)[number];

/** Visible ASCII without quotes, backslash or spaces; 8 to 255 characters (a UUID or ULID fits). */
const IDEMPOTENCY_KEY = /^[A-Za-z0-9._~:+/=-]{8,255}$/;
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,64}$/;
const HEADER_VALUE = /^[\t\x20-\x7e]{0,4096}$/;
/** Headers the client sets itself, or that change the connection or the framing. */
const RESERVED_HEADERS = new Set([
  "host",
  "content-length",
  "content-type",
  "content-encoding",
  "transfer-encoding",
  "connection",
  "keep-alive",
  "upgrade",
  "te",
  "trailer",
  "expect",
  "accept-encoding",
  "idempotency-key",
  "user-agent",
  "cookie",
  "proxy-authorization",
  "proxy-connection",
  "forwarded",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
]);

/** Resolves a SECRETS reference (`secretsResolver` from `@infrabyx/config` fits). */
export type PartnerSecretResolver = (ref: SecretRef, name: string) => Promise<string>;

export interface PartnerMtlsClientOptions {
  /** The partner's host names, exact (no wildcard, no IP literal). */
  hosts: readonly string[];
  /** `secret://<adapter>/<path>#<key>`: the client certificate in PEM (leaf first, then any intermediates). */
  clientCertificateRef: string;
  /** `secret://<adapter>/<path>#<key>`: its private key, unencrypted PKCS #8 (or SEC 1 / PKCS #1) PEM. */
  clientKeyRef: string;
  resolveSecret: PartnerSecretResolver;
  /** The CA certificates (PEM) the partner's server certificate must chain to; default Node's bundled roots. */
  serverCa?: string | readonly string[];
  /** How long resolved credentials are kept (default 5 minutes; 1 s to 1 hour). */
  credentialTtlMs?: number;
  /** Default and ceiling of a call's deadline (default 15 s; at most 120 s). */
  timeoutMs?: number;
  /** Default and ceiling of the answer's size (default 1 MiB; at most 16 MiB). */
  maxResponseBytes?: number;
  /** The largest request body (default 1 MiB; at most 16 MiB). */
  maxRequestBytes?: number;
  /** The clock, for the credential cache. */
  now?: () => number;
  /** Tests only: resolve names without DNS. */
  resolve?: (host: string) => Promise<readonly ResolvedAddress[]>;
  /** Tests only: admit loopback addresses (a local TLS stub). Never set in a deployment. */
  testAllowLoopback?: boolean;
  /** Tests only: the port of the local TLS stub, used in place of 443 when connecting. */
  testConnectPort?: number;
}

export interface PartnerMtlsRequest {
  method: PartnerMtlsMethod;
  /** `https://<host>[:443]/<path>[?<query>]`, the host one of the client's. */
  url: string;
  body: Uint8Array | string;
  /** Default `application/json`. */
  contentType?: string;
  /** Sent as `Idempotency-Key`; required (8 to 255 of `A-Z a-z 0-9 . _ ~ : + / = -`). */
  idempotencyKey: string;
  /** Default `application/json`. */
  accept?: string;
  /** Further request headers (an `Authorization` for an RFC 8705 token, say); never logged. */
  headers?: Readonly<Record<string, string>>;
  signal?: AbortSignal;
  /** At most the client's `timeoutMs`. */
  timeoutMs?: number;
  /** At most the client's `maxResponseBytes`. */
  maxResponseBytes?: number;
}

export interface PartnerMtlsResponse {
  status: number;
  /** Lower-case names; repeated headers joined with `, `; `set-cookie` dropped (no cookies are kept). */
  headers: Readonly<Record<string, string>>;
  body: Uint8Array;
  text(): string;
  json<T = unknown>(): T;
}

/** The fixed refusal labels (`meta.reason`) of a partner call. */
export type PartnerMtlsRefusal =
  | "method"
  | "scheme"
  | "port"
  | "userinfo"
  | "ip_literal"
  | "host"
  | "not_allowed"
  | "idempotency_key"
  | "body"
  | "header"
  | "dns"
  | "address"
  | "redirect"
  | "content_encoding"
  | "too_large"
  | "timeout"
  | "aborted"
  | "tls"
  | "unreachable"
  | "secret_unavailable"
  | ClientCredentialRefusal;

const DETAIL: Record<PartnerMtlsRefusal, string> = {
  method: "only POST and PUT are allowed",
  scheme: "the URL is not an absolute https URL",
  port: "only port 443 is allowed",
  userinfo: "user-info in the URL",
  ip_literal: "an IP literal in the URL",
  host: "not a public host name",
  not_allowed: "the host is not one of the partner's",
  idempotency_key: "an Idempotency-Key is required",
  body: "a non-empty body within the limit is required",
  header: "a request header is reserved or malformed",
  dns: "the partner's host did not resolve",
  address: "the partner's host resolves to a refused address range",
  redirect: "the partner answered a redirect (not followed)",
  content_encoding: "the partner answered an encoded body",
  too_large: "the partner's answer is over the limit",
  timeout: "the partner call timed out",
  aborted: "the partner call was aborted by the caller",
  tls: "the TLS handshake with the partner failed",
  unreachable: "the partner is unreachable",
  secret_unavailable: "the client certificate or key could not be read from SECRETS",
  certificate_unparsable: "the client certificate does not parse",
  key_unparsable: "the client key does not parse (an encrypted key is not supported)",
  key_type: "the client key is not ECDSA P-256",
  key_mismatch: "the client key does not match the certificate",
  not_client_certificate: "the client certificate is not a TLS client certificate",
  not_yet_valid: "the client certificate is not valid yet",
  expired: "the client certificate has expired",
};

const CODE: Partial<Record<PartnerMtlsRefusal, "IPB-API-010" | "IPB-SEC-013" | "IPB-SEC-010">> = {
  idempotency_key: "IPB-API-010",
  too_large: "IPB-SEC-013",
  content_encoding: "IPB-SEC-010",
};
const TRANSPORT = new Set<PartnerMtlsRefusal>(["dns", "timeout", "aborted", "tls", "unreachable"]);
const CREDENTIAL = new Set<PartnerMtlsRefusal>([
  "secret_unavailable",
  "certificate_unparsable",
  "key_unparsable",
  "key_type",
  "key_mismatch",
  "not_client_certificate",
  "not_yet_valid",
  "expired",
]);

/** A refusal of a partner call: a fixed detail and label, never the URL, a header or the body. */
function refusal(reason: PartnerMtlsRefusal, meta: Record<string, unknown> = {}): PortError {
  const code =
    CODE[reason] ??
    (TRANSPORT.has(reason)
      ? "IPB-PORT-002"
      : CREDENTIAL.has(reason)
        ? "IPB-PORT-001"
        : "IPB-SEC-018");
  return new PortError(code, PORT, {
    adapter: ADAPTER,
    detail: DETAIL[reason],
    meta: { reason, ...meta },
  });
}

const clamp = (v: number | undefined, dflt: number, min: number, max: number): number =>
  Math.min(Math.max(min, Math.trunc(v ?? dflt)), max);

function badConfig(detail: string): PortError {
  return new PortError("IPB-PORT-005", PORT, {
    adapter: ADAPTER,
    detail,
    meta: { reason: "config" },
  });
}

interface Credentials {
  context: SecureContext;
  /** When the cache entry ends: the TTL, or the certificate's notAfter if sooner. */
  until: number;
  info: ClientCredentialInfo;
}

export class PartnerMtlsClient {
  private readonly hosts: ReadonlySet<string>;
  private readonly certRef: SecretRef;
  private readonly keyRef: SecretRef;
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;
  private readonly maxRequestBytes: number;
  private readonly ttlMs: number;
  private readonly now: () => number;
  private cached: Credentials | undefined;
  private loading: Promise<Credentials> | undefined;

  // The `test*` options exist for the local TLS stub only; a deployment builds the client with the
  // hosts, the two references, the resolver and (optionally) the server CAs and limits.
  constructor(private readonly o: PartnerMtlsClientOptions) {
    if (o.hosts.length === 0) throw badConfig("a partner client needs at least one host");
    const hosts = new Set<string>();
    for (const h of o.hosts) {
      const name = checkPublicHostName(h);
      if (!name.ok || h.includes("*")) throw badConfig("a partner host must be an exact host name");
      hosts.add(name.host);
    }
    this.hosts = hosts;
    const cert = parseSecretRef(o.clientCertificateRef);
    const key = parseSecretRef(o.clientKeyRef);
    if (!cert || !key)
      throw badConfig("the client certificate and key must be SECRETS references (secret://…)");
    this.certRef = cert;
    this.keyRef = key;
    const L = PARTNER_MTLS_LIMITS;
    this.timeoutMs = clamp(o.timeoutMs, L.timeoutMs, 1, L.maxTimeoutMs);
    this.maxResponseBytes = clamp(
      o.maxResponseBytes,
      L.maxResponseBytes,
      1,
      L.maxResponseBytesCeiling,
    );
    this.maxRequestBytes = clamp(o.maxRequestBytes, L.maxRequestBytes, 1, L.maxRequestBytesCeiling);
    this.ttlMs = clamp(
      o.credentialTtlMs,
      L.credentialTtlMs,
      L.minCredentialTtlMs,
      L.maxCredentialTtlMs,
    );
    this.now = o.now ?? Date.now;
  }

  /** Drop the cached credentials, so the next call resolves them again (after a rotation, say). */
  forgetCredentials(): void {
    this.cached = undefined;
  }

  /**
   * Resolve and check the credentials now (start-up or a health check), without calling the
   * partner; answers the client certificate's dates and `x5tS256` (what the partner registers the
   * platform by), or the credential refusal. Never the key.
   */
  async checkCredentials(): Promise<ClientCredentialInfo> {
    const c = await this.credentials();
    return { ...c.info };
  }

  async request(r: PartnerMtlsRequest): Promise<PartnerMtlsResponse> {
    // 1. The shape of the call: nothing leaves the process if any of it is wrong.
    const method = String(r.method ?? "").toUpperCase();
    if (!(PARTNER_MTLS_METHODS as readonly string[]).includes(method)) throw refusal("method");
    const u = this.checkUrl(r.url);
    if (typeof r.idempotencyKey !== "string" || !IDEMPOTENCY_KEY.test(r.idempotencyKey))
      throw refusal("idempotency_key");
    const body =
      typeof r.body === "string"
        ? Buffer.from(r.body, "utf8")
        : r.body instanceof Uint8Array
          ? Buffer.from(r.body.buffer, r.body.byteOffset, r.body.byteLength)
          : undefined;
    if (!body || body.byteLength === 0 || body.byteLength > this.maxRequestBytes)
      throw refusal("body");
    const contentType = r.contentType ?? "application/json";
    const accept = r.accept ?? "application/json";
    if (!HEADER_VALUE.test(contentType) || !HEADER_VALUE.test(accept)) throw refusal("header");
    const extra: Record<string, string> = {};
    for (const [k, v] of Object.entries(r.headers ?? {})) {
      const name = k.toLowerCase();
      if (
        !HEADER_NAME.test(k) ||
        RESERVED_HEADERS.has(name) ||
        typeof v !== "string" ||
        !HEADER_VALUE.test(v)
      )
        throw refusal("header");
      extra[name] = v;
    }
    const maxBytes = clamp(r.maxResponseBytes, this.maxResponseBytes, 1, this.maxResponseBytes);
    const ms = clamp(r.timeoutMs, this.timeoutMs, 1, this.timeoutMs);

    // 2. One deadline and the caller's signal, over everything that follows.
    const stop = new Stopper(ms, r.signal);
    try {
      if (stop.stopped) throw stop.error();
      const creds = await stop.race(this.credentials());
      const pinned = await stop.race(this.resolvePublic(u.hostname));
      const headers: Record<string, string> = {
        ...extra,
        host: u.hostname,
        "user-agent": PARTNER_MTLS_USER_AGENT,
        accept,
        "accept-encoding": "identity",
        "content-type": contentType,
        "content-length": String(body.byteLength),
        "idempotency-key": r.idempotencyKey,
        connection: "close",
      };
      const res = await this.send(u, method, body, headers, creds, pinned, stop);
      return await this.read(res, maxBytes, stop);
    } finally {
      stop.done();
    }
  }

  /** The URL checks (no network). */
  private checkUrl(raw: string): URL {
    let u: URL;
    try {
      u = new URL(raw);
    } catch {
      throw refusal("scheme");
    }
    if (u.protocol !== "https:") throw refusal("scheme");
    if (u.username || u.password) throw refusal("userinfo");
    if (u.port !== "" && u.port !== "443") throw refusal("port");
    const name = checkPublicHostName(u.hostname);
    if (!name.ok) throw refusal(name.reason);
    if (!this.hosts.has(name.host)) throw refusal("not_allowed");
    u.hash = "";
    return u;
  }

  private async resolvePublic(host: string): Promise<{ address: string; family: 4 | 6 }> {
    let answers: readonly ResolvedAddress[];
    try {
      answers = await (this.o.resolve
        ? this.o.resolve(host)
        : dnsLookup(host, { all: true, verbatim: true }));
    } catch {
      throw refusal("dns");
    }
    if (answers.length === 0) throw refusal("dns");
    if (!allAddressesPublic(answers, this.o.testAllowLoopback === true)) throw refusal("address");
    return pinOf(answers);
  }

  private credentials(): Promise<Credentials> {
    const c = this.cached;
    if (c && c.until > this.now()) return Promise.resolve(c);
    this.cached = undefined;
    this.loading ??= this.load().finally(() => {
      this.loading = undefined;
    });
    return this.loading;
  }

  private async load(): Promise<Credentials> {
    let certPem: string;
    let keyPem: string;
    try {
      [certPem, keyPem] = await Promise.all([
        this.o.resolveSecret(this.certRef, "partner-mtls:certificate"),
        this.o.resolveSecret(this.keyRef, "partner-mtls:key"),
      ]);
    } catch {
      throw refusal("secret_unavailable");
    }
    if (typeof certPem !== "string" || typeof keyPem !== "string")
      throw refusal("secret_unavailable");
    // The parse and the key check are in the crypto call-site (IPB-12-05).
    const now = this.now();
    const checked = checkClientCredential(certPem, keyPem, { now });
    if (!checked.ok) throw refusal(checked.reason);
    const notAfter = Date.parse(checked.credential.notAfter);
    let context: SecureContext;
    try {
      context = createSecureContext({
        cert: certPem,
        key: keyPem,
        minVersion: "TLSv1.2",
        ...(this.o.serverCa ? { ca: this.o.serverCa as string | string[] } : {}),
      });
    } catch {
      // The credential passed the check, so what TLS could not load is the configured server CA.
      throw badConfig("the server CA certificates could not be loaded");
    }
    const creds = {
      context,
      until: Math.min(now + this.ttlMs, notAfter),
      info: checked.credential,
    };
    this.cached = creds;
    return creds;
  }

  private send(
    u: URL,
    method: string,
    body: Buffer,
    headers: Record<string, string>,
    creds: Credentials,
    pinned: { address: string; family: 4 | 6 },
    stop: Stopper,
  ): Promise<IncomingMessage> {
    // `secureContext` reaches `tls.connect` through the request's agent (`node:https` passes the
    // options on), so the credentials in it are the only ones used; `ca`, `cert` and `key` are not.
    const opts: RequestOptions & { secureContext: SecureContext } = {
      method,
      protocol: "https:",
      hostname: u.hostname,
      port: this.o.testConnectPort ?? 443,
      path: `${u.pathname}${u.search}`,
      servername: u.hostname,
      lookup: pinnedLookup(pinned),
      agent: false,
      secureContext: creds.context,
      rejectUnauthorized: true,
      minVersion: "TLSv1.2",
      headers,
      signal: stop.signal,
    };
    return new Promise((resolve, reject) => {
      const req = request(opts, resolve);
      req.on("socket", (s) => {
        s.once("secureConnect", () => stop.markSent());
      });
      req.on("error", (e) => {
        if (stop.stopped) {
          reject(stop.error());
          return;
        }
        const code = (e as NodeJS.ErrnoException).code ?? e.name;
        reject(
          refusal(isTlsError(code) ? "tls" : "unreachable", {
            cause: code,
            maybeSent: stop.sent,
          }),
        );
      });
      req.end(body);
    });
  }

  private read(res: IncomingMessage, max: number, stop: Stopper): Promise<PartnerMtlsResponse> {
    const status = res.statusCode ?? 0;
    if (status >= 300 && status < 400) {
      res.destroy();
      return Promise.reject(refusal("redirect", { status }));
    }
    const enc = String(res.headers["content-encoding"] ?? "identity")
      .trim()
      .toLowerCase();
    if (enc !== "" && enc !== "identity") {
      res.destroy();
      return Promise.reject(refusal("content_encoding"));
    }
    const declared = Number(res.headers["content-length"]);
    if (Number.isFinite(declared) && declared > max) {
      res.destroy();
      return Promise.reject(refusal("too_large", { maxBytes: max }));
    }
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let n = 0;
      let settled = false;
      const fail = (e: PortError) => {
        if (settled) return;
        settled = true;
        stop.signal.removeEventListener("abort", onStop);
        res.destroy();
        reject(e);
      };
      const onStop = () => fail(stop.error());
      if (stop.stopped) {
        onStop();
        return;
      }
      stop.signal.addEventListener("abort", onStop, { once: true });
      res.on("data", (c: Buffer) => {
        n += c.byteLength;
        if (n > max) {
          fail(refusal("too_large", { maxBytes: max }));
          return;
        }
        chunks.push(c);
      });
      res.on("end", () => {
        if (settled) return;
        settled = true;
        stop.signal.removeEventListener("abort", onStop);
        const bytes = new Uint8Array(Buffer.concat(chunks, n));
        resolve(answer(status, res.headers, bytes));
      });
      res.on("error", () =>
        fail(stop.stopped ? stop.error() : refusal("unreachable", { maybeSent: true })),
      );
    });
  }
}

function answer(
  status: number,
  raw: IncomingMessage["headers"],
  body: Uint8Array,
): PartnerMtlsResponse {
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (k === "set-cookie" || v === undefined) continue;
    headers[k] = Array.isArray(v) ? v.join(", ") : String(v);
  }
  return {
    status,
    headers,
    body,
    text: () => new TextDecoder().decode(body),
    json: <T>() => JSON.parse(new TextDecoder().decode(body)) as T,
  };
}

function isTlsError(code: string): boolean {
  return (
    code.startsWith("ERR_TLS") ||
    code.startsWith("ERR_SSL") ||
    code.includes("CERT") ||
    code.includes("SELF_SIGNED") ||
    code.includes("UNABLE_TO") ||
    code === "ECONNRESET_TLS"
  );
}

/** The call's deadline and the caller's signal as one signal, with the reason that stopped it. */
class Stopper {
  private readonly ac = new AbortController();
  private readonly timer: NodeJS.Timeout;
  private reason: "timeout" | "aborted" | undefined;
  sent = false;
  private readonly onCaller = () => this.stop("aborted");

  constructor(
    ms: number,
    private readonly caller: AbortSignal | undefined,
  ) {
    this.timer = setTimeout(() => this.stop("timeout"), ms);
    if (caller?.aborted) this.stop("aborted");
    else caller?.addEventListener("abort", this.onCaller, { once: true });
  }

  get signal(): AbortSignal {
    return this.ac.signal;
  }
  get stopped(): boolean {
    return this.reason !== undefined;
  }
  markSent(): void {
    this.sent = true;
  }
  error(): PortError {
    return refusal(this.reason ?? "aborted", { maybeSent: this.sent });
  }
  private stop(reason: "timeout" | "aborted"): void {
    if (this.reason) return;
    this.reason = reason;
    this.ac.abort();
  }
  /** Settle with `p`, or with the stop's error if the call is stopped first. */
  race<T>(p: Promise<T>): Promise<T> {
    if (this.stopped) return Promise.reject(this.error());
    return new Promise<T>((resolve, reject) => {
      const onStop = () => reject(this.error());
      this.ac.signal.addEventListener("abort", onStop, { once: true });
      p.then(
        (v) => {
          this.ac.signal.removeEventListener("abort", onStop);
          resolve(v);
        },
        (e: unknown) => {
          this.ac.signal.removeEventListener("abort", onStop);
          reject(e);
        },
      );
    });
  }
  done(): void {
    clearTimeout(this.timer);
    this.caller?.removeEventListener("abort", this.onCaller);
  }
}
