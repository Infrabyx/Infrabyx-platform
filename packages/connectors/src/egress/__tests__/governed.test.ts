// The governed EGRESS adapter (@IPB-04-AT-94 SSRF guard; IPB-02-43; PR-LDC-40, R1-D-176; threat
// model §3.125) against a local TLS stub. A throwaway CA and leaf certificate are made per run with
// the openssl CLI (nothing is committed); names resolve through the test resolver, and the
// test-only loopback admission lets the stub answer on 127.0.0.1.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:https";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import type { IncomingMessage, ServerResponse } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GOVERNED_EGRESS_USER_AGENT, GovernedEgress, isPublicAddress } from "../governed.js";

let dir: string;
let ca: string;
let server: Server;
let port: number;
const seen: { host: string; headers: IncomingMessage["headers"]; remote: string }[] = [];
let handler: (req: IncomingMessage, res: ServerResponse) => void = (_q, s) => s.end("ok");

function openssl(args: string[]): void {
  execFileSync("openssl", args, { cwd: dir, stdio: "ignore" });
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "ibx-egress-"));
  openssl([
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    "ca.key",
    "-out",
    "ca.pem",
    "-days",
    "1",
    "-subj",
    "/CN=ibx test ca",
  ]);
  openssl([
    "req",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    "leaf.key",
    "-out",
    "leaf.csr",
    "-subj",
    "/CN=snap.test",
  ]);
  writeFileSync(
    join(dir, "ext.cnf"),
    "subjectAltName=DNS:snap.test,DNS:other.test,DNS:a.example.test,DNS:evil.test\nbasicConstraints=CA:FALSE\n",
  );
  openssl([
    "x509",
    "-req",
    "-in",
    "leaf.csr",
    "-CA",
    "ca.pem",
    "-CAkey",
    "ca.key",
    "-CAcreateserial",
    "-out",
    "leaf.pem",
    "-days",
    "1",
    "-extfile",
    "ext.cnf",
  ]);
  ca = readFileSync(join(dir, "ca.pem"), "utf8");
  server = createServer(
    { key: readFileSync(join(dir, "leaf.key")), cert: readFileSync(join(dir, "leaf.pem")) },
    (req, res) => {
      seen.push({
        host: String(req.headers.host),
        headers: req.headers,
        remote: String(req.socket.remoteAddress),
      });
      handler(req, res);
    },
  );
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
});
afterAll(async () => {
  server?.closeAllConnections();
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const LOOP = [{ address: "127.0.0.1", family: 4 }];
function egress(
  o: {
    resolve?: (h: string) => Promise<{ address: string; family: number }[]>;
    enabled?: boolean;
  } = {},
) {
  const lookups: string[] = [];
  const e = new GovernedEgress({
    enabled: () => o.enabled ?? true,
    allowHosts: ["snap.test", "other.test", "*.example.test"],
    resolve: async (h) => {
      lookups.push(h);
      return o.resolve ? o.resolve(h) : LOOP;
    },
    testCa: ca,
    testAllowLoopback: true,
    testConnectPort: port,
  });
  return { e, lookups };
}
const reason = (r: string) => ({ code: "IPB-SEC-018", meta: { reason: r } });

describe("refused address ranges (IANA special-purpose registries, RFC 6890)", () => {
  it.each([
    "0.1.2.3",
    "10.0.0.1",
    "100.64.0.1",
    "100.127.255.254",
    "127.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "172.31.255.255",
    "192.0.0.9",
    "192.0.2.1",
    "192.88.99.1",
    "192.168.1.1",
    "198.18.0.1",
    "198.19.255.1",
    "198.51.100.7",
    "203.0.113.9",
    "224.0.0.1",
    "239.255.255.255",
    "240.0.0.1",
    "255.255.255.255",
    "::",
    "::1",
    "::ffff:10.0.0.1",
    "::ffff:8.8.8.8",
    "::10.0.0.1",
    "64:ff9b::a00:1",
    "64:ff9b:1::1",
    "100::1",
    "2001::1",
    "2001:0:4136:e378::1",
    "2001:2::1",
    "2001:db8::1",
    "2002:a00:1::1",
    "3fff::1",
    "5f00::1",
    "fc00::1",
    "fd00:ec2::254",
    "fe80::1",
    "fec0::1",
    "ff02::1",
    "fe80::1%eth0",
  ])("%s is refused", (a) => expect(isPublicAddress(a)).toBe(false));
  it.each([
    "8.8.8.8",
    "1.1.1.1",
    "100.63.255.255",
    "100.128.0.1",
    "172.32.0.1",
    "192.169.0.1",
    "2001:4860:4860::8888",
    "2400:cb00::1",
    "2a00:1450::1",
  ])("%s is public", (a) => expect(isPublicAddress(a)).toBe(true));
  it("a non-address is refused", () => expect(isPublicAddress("snap.test")).toBe(false));
});

describe("GovernedEgress URL checks", () => {
  it.each([
    ["http://snap.test/", "scheme"],
    ["ftp://snap.test/", "scheme"],
    ["https://user:pw@snap.test/", "userinfo"],
    ["https://snap.test:8443/", "port"],
    ["https://127.0.0.1/", "ip_literal"],
    ["https://[::1]/", "ip_literal"],
    ["https://localhost/", "host"],
    ["https://not-listed.test/", "not_allowed"],
    ["https://example.test/", "not_allowed"],
    ["not a url", "scheme"],
  ])("%s is refused (%s) before any lookup", async (url, why) => {
    const { e, lookups } = egress();
    await expect(e.fetch(url)).rejects.toMatchObject(reason(why));
    expect(lookups).toEqual([]);
  });

  it("a name resolving to a private address is refused, and so is a mixed answer", async () => {
    const priv = egress({ resolve: async () => [{ address: "10.0.0.5", family: 4 }] });
    await expect(priv.e.fetch("https://snap.test/")).rejects.toMatchObject(reason("address"));
    const meta = egress({ resolve: async () => [{ address: "169.254.169.254", family: 4 }] });
    await expect(meta.e.fetch("https://snap.test/")).rejects.toMatchObject(reason("address"));
    const mixed = egress({
      resolve: async () => [
        { address: "127.0.0.1", family: 4 },
        { address: "fd00::1", family: 6 },
      ],
    });
    await expect(mixed.e.fetch("https://snap.test/")).rejects.toMatchObject(reason("address"));
    const none = egress({ resolve: async () => [] });
    await expect(none.e.fetch("https://snap.test/")).rejects.toMatchObject(reason("dns"));
  });

  it("off is IPB-PORT-001 and health is down", async () => {
    const { e } = egress({ enabled: false });
    await expect(e.fetch("https://snap.test/")).rejects.toMatchObject({ code: "IPB-PORT-001" });
    expect((await e.health()).status).toBe("down");
  });
});

describe("GovernedEgress fetch", () => {
  it("connects to the checked address with the host's certificate and the fixed headers", async () => {
    handler = (_q, s) => {
      s.setHeader("content-type", "text/html; charset=utf-8");
      s.setHeader("set-cookie", "sid=abc");
      s.end("<p>circular</p>");
    };
    seen.length = 0;
    const { e, lookups } = egress();
    const r = await e.fetch("https://snap.test/page?x=1#frag", { accept: "text/html" });
    expect(r).toMatchObject({
      status: 200,
      contentType: "text/html; charset=utf-8",
      finalUrl: "https://snap.test/page?x=1",
      redirects: [],
      contentEncoding: "identity",
    });
    expect(new TextDecoder().decode(r.body)).toBe("<p>circular</p>");
    expect(lookups).toEqual(["snap.test"]);
    expect(seen[0]).toMatchObject({ host: "snap.test", remote: "127.0.0.1" });
    const h = seen[0]!.headers;
    expect(h["user-agent"]).toBe(GOVERNED_EGRESS_USER_AGENT);
    expect(h.accept).toBe("text/html");
    for (const k of ["cookie", "authorization", "referer", "x-tenant-id", "x-forwarded-for"])
      expect(h[k]).toBeUndefined();
  });

  it("a certificate that does not name the host is refused (TLS still verifies the name)", async () => {
    const e = new GovernedEgress({
      enabled: () => true,
      allowHosts: ["unnamed.test"],
      resolve: async () => LOOP,
      testCa: ca,
      testAllowLoopback: true,
      testConnectPort: port,
    });
    await expect(e.fetch("https://unnamed.test/")).rejects.toMatchObject({ code: "IPB-PORT-002" });
  });

  it("a redirect is refused unless asked; each followed hop is checked and looked up again", async () => {
    handler = (q, s) => {
      if (q.url === "/a") {
        s.setHeader("set-cookie", "sid=1");
        s.writeHead(302, { location: "https://other.test/b" }).end();
      } else if (q.url === "/b") s.writeHead(301, { location: "/c" }).end();
      else s.end("done");
    };
    const zero = egress();
    await expect(zero.e.fetch("https://snap.test/a")).rejects.toMatchObject(
      reason("too_many_redirects"),
    );
    seen.length = 0;
    const { e, lookups } = egress();
    const r = await e.fetch("https://snap.test/a", { maxRedirects: 5 });
    expect(r.finalUrl).toBe("https://other.test/c");
    expect(r.redirects).toEqual(["https://other.test/b", "https://other.test/c"]);
    expect(lookups).toEqual(["snap.test", "other.test", "other.test"]);
    expect(seen.map((x) => x.host)).toEqual(["snap.test", "other.test", "other.test"]);
    expect(seen.every((x) => x.headers.cookie === undefined)).toBe(true);
  });

  it("a redirect to http, to a host off the list, to a private address or past five hops is refused", async () => {
    handler = (q, s) => {
      const loc: Record<string, string> = {
        "/http": "http://snap.test/x",
        "/off": "https://evil.test/x",
        "/priv": "https://a.example.test/x",
        "/port": "https://snap.test:444/x",
      };
      if (q.url && loc[q.url]) s.writeHead(307, { location: loc[q.url]! }).end();
      else if (q.url?.startsWith("/loop"))
        s.writeHead(308, { location: `/loop${Number(q.url.slice(5) || 0) + 1}` }).end();
      else s.end("x");
    };
    const { e } = egress({
      resolve: async (h) =>
        h === "a.example.test" ? [{ address: "192.168.0.10", family: 4 }] : LOOP,
    });
    await expect(e.fetch("https://snap.test/http", { maxRedirects: 5 })).rejects.toMatchObject(
      reason("redirect_scheme"),
    );
    await expect(e.fetch("https://snap.test/off", { maxRedirects: 5 })).rejects.toMatchObject(
      reason("not_allowed"),
    );
    await expect(e.fetch("https://snap.test/priv", { maxRedirects: 5 })).rejects.toMatchObject(
      reason("address"),
    );
    await expect(e.fetch("https://snap.test/port", { maxRedirects: 5 })).rejects.toMatchObject(
      reason("port"),
    );
    await expect(e.fetch("https://snap.test/loop", { maxRedirects: 9 })).rejects.toMatchObject(
      reason("too_many_redirects"),
    );
  });

  it("a body over the cap is refused by its Content-Length and when streamed; a gzip bomb stops at the cap", async () => {
    handler = (q, s) => {
      if (q.url === "/declared") {
        s.setHeader("content-length", "5000");
        s.end("x".repeat(5000));
      } else if (q.url === "/stream") {
        s.write("y".repeat(3000));
        s.end("y".repeat(3000));
      } else if (q.url === "/bomb") {
        s.setHeader("content-encoding", "gzip");
        s.end(gzipSync(Buffer.alloc(10 * 1024 * 1024)));
      } else if (q.url === "/gzip") {
        s.setHeader("content-encoding", "gzip");
        s.end(gzipSync(Buffer.from("small page")));
      } else if (q.url === "/weird") {
        s.setHeader("content-encoding", "compress");
        s.end("z");
      } else s.end();
    };
    const { e } = egress();
    const big = { code: "IPB-SEC-013", meta: { reason: "too_large" } };
    await expect(e.fetch("https://snap.test/declared", { maxBytes: 4096 })).rejects.toMatchObject(
      big,
    );
    await expect(e.fetch("https://snap.test/stream", { maxBytes: 4096 })).rejects.toMatchObject(
      big,
    );
    await expect(e.fetch("https://snap.test/bomb", { maxBytes: 64 * 1024 })).rejects.toMatchObject(
      big,
    );
    const g = await e.fetch("https://snap.test/gzip", { maxBytes: 4096 });
    expect(g).toMatchObject({ contentEncoding: "gzip" });
    expect(new TextDecoder().decode(g.body)).toBe("small page");
    await expect(e.fetch("https://snap.test/weird")).rejects.toMatchObject({ code: "IPB-SEC-010" });
  });

  it("one deadline covers the whole fetch", async () => {
    handler = (_q, s) => {
      s.write("partial");
      setTimeout(() => s.end(), 3000).unref();
    };
    const { e } = egress();
    const t0 = Date.now();
    await expect(e.fetch("https://snap.test/slow", { timeoutMs: 300 })).rejects.toMatchObject({
      code: "IPB-PORT-002",
      meta: { reason: "timeout" },
    });
    expect(Date.now() - t0).toBeLessThan(2000);
    const slowDns = egress({ resolve: () => new Promise((r) => setTimeout(() => r(LOOP), 2000)) });
    await expect(slowDns.e.fetch("https://snap.test/", { timeoutMs: 200 })).rejects.toMatchObject({
      meta: { reason: "timeout" },
    });
  });
});
