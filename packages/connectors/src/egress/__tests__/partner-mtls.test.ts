// `PartnerMtlsClient` (PR-UDF-069; R1-D-250; threat model §3.172) against a local HTTPS server that
// requires a client certificate. Every certificate and key is made in memory per run by
// `@infrabyx/crypto/mtls-test` (nothing is committed); names resolve through the test resolver, and
// the test-only loopback admission lets the stub answer on 127.0.0.1.
import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer, type Server } from "node:https";
import type { AddressInfo } from "node:net";
import type { TLSSocket } from "node:tls";
import type { SecretRef } from "@infrabyx/contracts/ports";
import { checkClientCredential, ulid } from "@infrabyx/crypto";
import { mtlsTestAuthority, type TestIssued } from "@infrabyx/crypto/mtls-test";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  PARTNER_MTLS_USER_AGENT,
  PartnerMtlsClient,
  type PartnerMtlsClientOptions,
  type PartnerMtlsRequest,
} from "../partner-mtls.js";

const HOST = "api.partner.test";
const serverRoot = mtlsTestAuthority({ CN: "Test Partner Server Root", O: "Test Partner" });
const clientRoot = mtlsTestAuthority({ CN: "Test Platform Client Root", O: "Test Platform" });
const otherRoot = mtlsTestAuthority({ CN: "Somebody Else Root" });
const serverLeaf = serverRoot.issue({ CN: HOST }, { extendedKeyUsage: ["serverAuth"] });
const clientLeaf = clientRoot.issue({ CN: "platform-client" });
const strangerLeaf = otherRoot.issue({ CN: "stranger" });
const checked = checkClientCredential(clientLeaf.certPem, clientLeaf.keyPem);
if (!checked.ok) throw new Error("the test client credential does not check");
const clientInfo = checked.credential;

let server: Server;
let port: number;
const seen: {
  method: string;
  url: string;
  headers: IncomingMessage["headers"];
  body: string;
  remote: string;
  peer: Buffer | undefined;
}[] = [];
let handler: (req: IncomingMessage, res: ServerResponse) => void;
const ok = (_q: IncomingMessage, s: ServerResponse) => {
  s.setHeader("content-type", "application/json");
  s.setHeader("set-cookie", "track=1");
  s.end(JSON.stringify({ accepted: true }));
};

beforeAll(async () => {
  server = createServer(
    {
      key: serverLeaf.keyPem,
      cert: serverLeaf.certPem,
      ca: clientRoot.certPem,
      requestCert: true,
      rejectUnauthorized: true,
      minVersion: "TLSv1.2",
    },
    (req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        const peer = (req.socket as TLSSocket).getPeerCertificate();
        seen.push({
          method: String(req.method),
          url: String(req.url),
          headers: req.headers,
          body: Buffer.concat(chunks).toString("utf8"),
          remote: String(req.socket.remoteAddress),
          peer: peer.raw,
        });
        handler(req, res);
      });
    },
  );
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
});
afterAll(async () => {
  server?.closeAllConnections();
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
});
beforeEach(() => {
  seen.length = 0;
  handler = ok;
});

const CERT_REF = "secret://vault/partners/lender-a/mtls#certificate";
const KEY_REF = "secret://vault/partners/lender-a/mtls#key";
const LOOP = [{ address: "127.0.0.1", family: 4 }];

function client(
  o: Partial<PartnerMtlsClientOptions> & {
    leaf?: TestIssued;
    keyPem?: string;
    answers?: { address: string; family: number }[];
    noPinnedCa?: boolean;
  } = {},
) {
  const resolved: string[] = [];
  const lookups: string[] = [];
  const leaf = o.leaf ?? clientLeaf;
  const c = new PartnerMtlsClient({
    hosts: [HOST],
    clientCertificateRef: CERT_REF,
    clientKeyRef: KEY_REF,
    resolveSecret: async (ref: SecretRef, name: string) => {
      resolved.push(`${ref.key}:${name}`);
      return ref.key === "certificate" ? leaf.certPem : (o.keyPem ?? leaf.keyPem);
    },
    ...(o.noPinnedCa ? {} : { serverCa: serverRoot.certPem }),
    resolve: async (h) => {
      lookups.push(h);
      return o.answers ?? LOOP;
    },
    testAllowLoopback: true,
    testConnectPort: port,
    ...o,
  });
  return { c, resolved, lookups };
}

// The idempotency key, made fresh for each run (no fixed value is committed).
const KEY = ulid();
const call = (r: Partial<PartnerMtlsRequest> = {}): PartnerMtlsRequest => ({
  method: "POST",
  url: `https://${HOST}/v1/disbursements?ref=secret-query-value`,
  body: JSON.stringify({ amount: "secret-body-value" }),
  idempotencyKey: KEY,
  ...r,
});
const reason = (code: string, r: string) => ({
  code,
  meta: expect.objectContaining({ reason: r }),
});
const sec = (r: string) => reason("IPB-SEC-018", r);

describe("PartnerMtlsClient: the happy path", () => {
  it("POSTs over mTLS to the checked address with the body, the Idempotency-Key and fixed headers", async () => {
    const { c, lookups } = client();
    const res = await c.request(
      call({ headers: { authorization: "DPoP token-value", "x-request-id": "r-1" } }),
    );
    expect(res.status).toBe(200);
    expect(res.json()).toEqual({ accepted: true });
    expect(res.headers["content-type"]).toBe("application/json");
    expect(res.headers["set-cookie"]).toBeUndefined();
    expect(lookups).toEqual([HOST]);
    expect(seen).toHaveLength(1);
    const s = seen[0]!;
    expect(s.method).toBe("POST");
    expect(s.url).toBe("/v1/disbursements?ref=secret-query-value");
    expect(s.body).toBe(JSON.stringify({ amount: "secret-body-value" }));
    expect(s.remote).toBe("127.0.0.1");
    expect(s.headers["idempotency-key"]).toBe(KEY);
    expect(s.headers["content-type"]).toBe("application/json");
    expect(s.headers["user-agent"]).toBe(PARTNER_MTLS_USER_AGENT);
    expect(s.headers["accept-encoding"]).toBe("identity");
    expect(s.headers.host).toBe(HOST);
    expect(s.headers.authorization).toBe("DPoP token-value");
    expect(s.headers.cookie).toBeUndefined();
    // The server saw the platform's client certificate.
    expect(s.peer?.equals(clientLeaf.der)).toBe(true);
  });

  it("PUTs too, with a byte body and its own content type; an explicit :443 is accepted", async () => {
    const { c } = client();
    const res = await c.request(
      call({
        method: "PUT",
        url: `https://${HOST}:443/v1/mandates/m-1`,
        body: new Uint8Array([1, 2, 3]),
        contentType: "application/octet-stream",
      }),
    );
    expect(res.status).toBe(200);
    expect(seen[0]!.method).toBe("PUT");
    expect(seen[0]!.headers["content-type"]).toBe("application/octet-stream");
    expect(seen[0]!.headers["content-length"]).toBe("3");
  });

  it("a non-2xx answer is returned to the caller, not thrown", async () => {
    handler = (_q, s) => {
      s.statusCode = 409;
      s.end('{"error":"duplicate"}');
    };
    const { c } = client();
    const res = await c.request(call());
    expect(res.status).toBe(409);
    expect(res.text()).toBe('{"error":"duplicate"}');
  });

  it("resolves the credentials once and keeps them for the TTL, then resolves them again", async () => {
    let now = Date.now();
    const { c, resolved } = client({ now: () => now, credentialTtlMs: 60_000 });
    await c.request(call());
    await c.request(call());
    expect(resolved).toEqual(["certificate:partner-mtls:certificate", "key:partner-mtls:key"]);
    now += 61_000;
    await c.request(call());
    expect(resolved).toHaveLength(4);
    c.forgetCredentials();
    await c.checkCredentials();
    expect(resolved).toHaveLength(6);
  });

  it("checkCredentials answers the dates and x5t#S256 without calling the partner", async () => {
    const { c, lookups } = client();
    const r = await c.checkCredentials();
    expect(r).toEqual(clientInfo);
    expect(JSON.stringify(r)).not.toContain("PRIVATE KEY");
    expect(lookups).toEqual([]);
    expect(seen).toEqual([]);
  });
});

describe("PartnerMtlsClient: refusals before anything leaves the process", () => {
  it.each(["GET", "DELETE", "PATCH", "HEAD"])("%s is refused (method)", async (m) => {
    const { c, lookups } = client();
    await expect(c.request(call({ method: m as "POST" }))).rejects.toMatchObject(sec("method"));
    expect(lookups).toEqual([]);
  });

  it.each([
    [`https://${HOST}:8443/v1/x`, "port"],
    [`https://${HOST}:80/v1/x`, "port"],
    [`http://${HOST}/v1/x`, "scheme"],
    ["not a url", "scheme"],
    [`https://user:pw@${HOST}/v1/x`, "userinfo"],
    ["https://10.0.0.1/v1/x", "ip_literal"],
    ["https://[::1]/v1/x", "ip_literal"],
    ["https://localhost/v1/x", "host"],
    ["https://other.partner.test/v1/x", "not_allowed"],
  ])("%s is refused (%s)", async (url, r) => {
    const { c, lookups } = client();
    await expect(c.request(call({ url }))).rejects.toMatchObject(sec(r));
    expect(lookups).toEqual([]);
    expect(seen).toEqual([]);
  });

  it.each([undefined, "", "short", "has space in it", 'quote"in"key', "x".repeat(256)])(
    "the Idempotency-Key %j is refused (IPB-API-010)",
    async (k) => {
      const { c } = client();
      await expect(
        c.request(call({ idempotencyKey: k as unknown as string })),
      ).rejects.toMatchObject(reason("IPB-API-010", "idempotency_key"));
      expect(seen).toEqual([]);
    },
  );

  it("a missing, empty or oversized body is refused", async () => {
    const { c } = client({ maxRequestBytes: 16 });
    await expect(c.request(call({ body: undefined as unknown as string }))).rejects.toMatchObject(
      sec("body"),
    );
    await expect(c.request(call({ body: "" }))).rejects.toMatchObject(sec("body"));
    await expect(c.request(call({ body: "x".repeat(17) }))).rejects.toMatchObject(sec("body"));
    expect(seen).toEqual([]);
  });

  it.each([
    { host: "evil.test" },
    { "idempotency-key": "another-key-123" },
    { "Content-Length": "1" },
    { "transfer-encoding": "chunked" },
    { cookie: "a=b" },
    { "x-bad": "line\r\nbreak" },
    { "bad name": "v" },
  ])("a reserved or malformed header %j is refused", async (headers) => {
    const { c } = client();
    await expect(c.request(call({ headers }))).rejects.toMatchObject(sec("header"));
    expect(seen).toEqual([]);
  });

  it("a caller's signal that is already aborted stops the call before DNS", async () => {
    const { c, lookups } = client();
    const ac = new AbortController();
    ac.abort();
    await expect(c.request(call({ signal: ac.signal }))).rejects.toMatchObject({
      code: "IPB-PORT-002",
      meta: { reason: "aborted", maybeSent: false },
    });
    expect(lookups).toEqual([]);
  });
});

describe("PartnerMtlsClient: DNS once, public addresses only", () => {
  it.each([
    [[{ address: "10.1.2.3", family: 4 }]],
    [[{ address: "169.254.169.254", family: 4 }]],
    [[{ address: "100.64.0.1", family: 4 }]],
    [[{ address: "fd00::1", family: 6 }]],
    [[{ address: "::ffff:127.0.0.1", family: 6 }]],
    [[{ address: "224.0.0.1", family: 4 }]],
    [
      [
        { address: "8.8.8.8", family: 4 },
        { address: "192.168.1.1", family: 4 },
      ],
    ],
  ])("%j is refused (address) and nothing connects", async (answers) => {
    const { c } = client({ answers, testAllowLoopback: false });
    await expect(c.request(call())).rejects.toMatchObject(sec("address"));
    expect(seen).toEqual([]);
  });

  it("loopback is refused without the test-only admission", async () => {
    const { c } = client({ testAllowLoopback: false });
    await expect(c.request(call())).rejects.toMatchObject(sec("address"));
  });

  it("no answer, or a failing resolver, is dns", async () => {
    const { c } = client({ answers: [] });
    await expect(c.request(call())).rejects.toMatchObject(reason("IPB-PORT-002", "dns"));
    const failing = client({
      resolve: async () => {
        throw new Error("ENOTFOUND");
      },
    });
    await expect(failing.c.request(call())).rejects.toMatchObject(reason("IPB-PORT-002", "dns"));
  });
});

describe("PartnerMtlsClient: the answer", () => {
  it.each([301, 302, 303, 307, 308, 300])(
    "a %d is refused (redirect), never followed",
    async (st) => {
      handler = (_q, s) => {
        s.statusCode = st;
        s.setHeader("location", "https://elsewhere.test/");
        s.end();
      };
      const { c, lookups } = client();
      await expect(c.request(call())).rejects.toMatchObject({
        code: "IPB-SEC-018",
        meta: { reason: "redirect", status: st },
      });
      expect(lookups).toEqual([HOST]);
      expect(seen).toHaveLength(1);
    },
  );

  it("an answer over the cap is refused by its Content-Length and when streamed", async () => {
    handler = (_q, s) => {
      s.setHeader("content-length", "2048");
      s.end("x".repeat(2048));
    };
    const { c } = client({ maxResponseBytes: 1024 });
    await expect(c.request(call())).rejects.toMatchObject({
      code: "IPB-SEC-013",
      meta: { reason: "too_large", maxBytes: 1024 },
    });
    handler = (_q, s) => {
      s.write("x".repeat(800));
      setTimeout(() => s.end("y".repeat(800)), 20);
    };
    await expect(c.request(call())).rejects.toMatchObject(reason("IPB-SEC-013", "too_large"));
    // A call may lower the cap, never raise it.
    handler = (_q, s) => s.end("x".repeat(600));
    await expect(c.request(call({ maxResponseBytes: 512 }))).rejects.toMatchObject(
      reason("IPB-SEC-013", "too_large"),
    );
    handler = (_q, s) => s.end("x".repeat(1500));
    await expect(c.request(call({ maxResponseBytes: 4096 }))).rejects.toMatchObject(
      reason("IPB-SEC-013", "too_large"),
    );
  });

  it("an encoded answer is refused (identity only)", async () => {
    handler = (_q, s) => {
      s.setHeader("content-encoding", "gzip");
      s.end("not really gzip");
    };
    const { c } = client();
    await expect(c.request(call())).rejects.toMatchObject(
      reason("IPB-SEC-010", "content_encoding"),
    );
  });

  it("a slow partner is timeout, after the request was sent", async () => {
    handler = (_q, s) => setTimeout(() => s.end("late"), 1_000);
    const { c } = client({ timeoutMs: 150 });
    const t0 = Date.now();
    await expect(c.request(call())).rejects.toMatchObject({
      code: "IPB-PORT-002",
      meta: { reason: "timeout", maybeSent: true },
    });
    expect(Date.now() - t0).toBeLessThan(900);
  });

  it("a call may shorten the deadline, never lengthen it", async () => {
    handler = (_q, s) => setTimeout(() => s.end("late"), 1_000);
    const { c } = client({ timeoutMs: 150 });
    const t0 = Date.now();
    await expect(c.request(call({ timeoutMs: 60_000 }))).rejects.toMatchObject(
      reason("IPB-PORT-002", "timeout"),
    );
    expect(Date.now() - t0).toBeLessThan(900);
  });

  it("the caller's signal aborts a call in flight (aborted, maybeSent)", async () => {
    handler = (_q, s) => setTimeout(() => s.end("late"), 1_000);
    const { c } = client({ timeoutMs: 5_000 });
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 100);
    const t0 = Date.now();
    await expect(c.request(call({ signal: ac.signal }))).rejects.toMatchObject({
      code: "IPB-PORT-002",
      meta: { reason: "aborted", maybeSent: true },
    });
    expect(Date.now() - t0).toBeLessThan(900);
  });

  it("the caller's signal aborts a body being read", async () => {
    handler = (_q, s) => {
      s.write("part");
      setTimeout(() => s.end("rest"), 1_000);
    };
    const { c } = client({ timeoutMs: 5_000 });
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 150);
    await expect(c.request(call({ signal: ac.signal }))).rejects.toMatchObject(
      reason("IPB-PORT-002", "aborted"),
    );
  });
});

describe("PartnerMtlsClient: TLS", () => {
  it("a server certificate that does not chain to the pinned CA is tls", async () => {
    const { c } = client({ serverCa: otherRoot.certPem });
    await expect(c.request(call())).rejects.toMatchObject(reason("IPB-PORT-002", "tls"));
    expect(seen).toEqual([]);
  });

  it("without a pinned CA, Node's roots are used and the test server is not trusted", async () => {
    const { c } = client({ noPinnedCa: true });
    await expect(c.request(call())).rejects.toMatchObject(reason("IPB-PORT-002", "tls"));
  });

  it("the host name is verified against the server certificate (SNI unchanged)", async () => {
    const wrong = "wrong.partner.test";
    const { c } = client({ hosts: [wrong] });
    await expect(c.request(call({ url: `https://${wrong}/v1/x` }))).rejects.toMatchObject(
      reason("IPB-PORT-002", "tls"),
    );
    expect(seen).toEqual([]);
  });

  it("a client certificate the partner does not trust is refused by the partner", async () => {
    const { c } = client({ leaf: strangerLeaf });
    await expect(c.request(call())).rejects.toMatchObject({ code: "IPB-PORT-002" });
    expect(seen).toEqual([]);
  });
});

describe("PartnerMtlsClient: credentials", () => {
  it("a key that does not match the certificate is key_mismatch, before DNS", async () => {
    const { c, lookups } = client({ keyPem: strangerLeaf.keyPem });
    await expect(c.request(call())).rejects.toMatchObject(reason("IPB-PORT-001", "key_mismatch"));
    expect(lookups).toEqual([]);
  });

  it("an unparsable certificate or key, an expired or future certificate are refused", async () => {
    const bad = {
      ...clientLeaf,
      certPem: "-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n",
    };
    await expect(client({ leaf: bad }).c.request(call())).rejects.toMatchObject(
      reason("IPB-PORT-001", "certificate_unparsable"),
    );
    await expect(client({ keyPem: "not a key" }).c.request(call())).rejects.toMatchObject(
      reason("IPB-PORT-001", "key_unparsable"),
    );
    const DAY = 86_400_000;
    const expired = clientRoot.issue(
      { CN: "old" },
      { notBefore: new Date(Date.now() - 10 * DAY), notAfter: new Date(Date.now() - DAY) },
    );
    await expect(client({ leaf: expired }).c.request(call())).rejects.toMatchObject(
      reason("IPB-PORT-001", "expired"),
    );
    const future = clientRoot.issue(
      { CN: "new" },
      { notBefore: new Date(Date.now() + DAY), notAfter: new Date(Date.now() + 10 * DAY) },
    );
    await expect(client({ leaf: future }).c.request(call())).rejects.toMatchObject(
      reason("IPB-PORT-001", "not_yet_valid"),
    );
  });

  it("a SECRETS failure is secret_unavailable, and the cache ends at the certificate's notAfter", async () => {
    const { c } = client({
      resolveSecret: async () => {
        throw new Error("vault sealed: secret://vault/partners/lender-a/mtls#key");
      },
    });
    await expect(c.request(call())).rejects.toMatchObject(
      reason("IPB-PORT-001", "secret_unavailable"),
    );
    const notAfter = Date.parse(clientInfo.notAfter);
    let now = notAfter - 1_000;
    const near = client({ now: () => now, credentialTtlMs: 3_600_000 });
    await near.c.checkCredentials();
    now = notAfter + 1;
    await expect(near.c.checkCredentials()).rejects.toMatchObject(
      reason("IPB-PORT-001", "expired"),
    );
    expect(near.resolved).toHaveLength(4);
  });

  it("bad configuration is IPB-PORT-005 at construction", () => {
    const base = {
      hosts: [HOST],
      clientCertificateRef: CERT_REF,
      clientKeyRef: KEY_REF,
      resolveSecret: async () => "",
    };
    expect(() => new PartnerMtlsClient({ ...base, hosts: [] })).toThrow(
      expect.objectContaining({ code: "IPB-PORT-005" }),
    );
    expect(() => new PartnerMtlsClient({ ...base, hosts: ["*.partner.test"] })).toThrow(
      expect.objectContaining({ code: "IPB-PORT-005" }),
    );
    expect(() => new PartnerMtlsClient({ ...base, hosts: ["10.0.0.1"] })).toThrow(
      expect.objectContaining({ code: "IPB-PORT-005" }),
    );
    expect(
      () => new PartnerMtlsClient({ ...base, clientKeyRef: "-----BEGIN PRIVATE KEY-----" }),
    ).toThrow(expect.objectContaining({ code: "IPB-PORT-005" }));
  });
});

describe("PartnerMtlsClient: nothing sensitive in an error", () => {
  it("no error names the query, the body, a header value, the reference or the key", async () => {
    const errors: unknown[] = [];
    const catchIt = async (p: Promise<unknown>) => {
      try {
        await p;
      } catch (e) {
        errors.push(e);
      }
    };
    await catchIt(client().c.request(call({ method: "GET" as "POST" })));
    await catchIt(
      client().c.request(call({ url: `https://${HOST}:8443/x?ref=secret-query-value` })),
    );
    await catchIt(client().c.request(call({ headers: { host: "secret-header-value" } })));
    await catchIt(client({ keyPem: strangerLeaf.keyPem }).c.request(call()));
    await catchIt(
      client({
        resolveSecret: async () => {
          throw new Error("secret-ref-value");
        },
      }).c.request(call()),
    );
    handler = (_q, s) => {
      s.statusCode = 302;
      s.setHeader("location", "https://elsewhere.test/?secret-location-value");
      s.end();
    };
    await catchIt(client().c.request(call()));
    expect(errors).toHaveLength(6);
    for (const e of errors) {
      const text = `${String(e)} ${JSON.stringify(e)} ${(e as Error).message}`;
      for (const s of [
        "secret-query-value",
        "secret-body-value",
        "secret-header-value",
        "secret-ref-value",
        "secret-location-value",
        "PRIVATE KEY",
        "lender-a",
      ])
        expect(text).not.toContain(s);
    }
  });
});
