// LDC-68 / SEC-ZSTD-01 (R1-D-294): zstd request bodies refused before any parser reads them, and
// outbound fetches that never offer zstd and refuse a zstd answer unread.
import { createServer, request, type IncomingMessage, type Server } from "node:http";
import { brotliCompressSync, deflateSync, gzipSync, zstdCompressSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { PortError } from "@infrabyx/contracts/errors";
import { createEgress } from "../core/http.js";
import {
  OUTBOUND_ACCEPT_ENCODING,
  RefusedContentCodingError,
  contentCodings,
  namesRefusedCoding,
  refuseZstdBodies,
  refuseZstdBodiesWith,
  refuseZstdFetch,
  refuseZstdInNextProxy,
} from "./index.js";
import { nextProxyZstdContractCases } from "@infrabyx/testing";

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
});

async function listen(s: Server): Promise<string> {
  servers.push(s);
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  const a = s.address();
  if (!a || typeof a === "string") throw new Error("no address");
  return `http://127.0.0.1:${a.port}`;
}

interface Sent {
  status: number;
  headers: IncomingMessage["headers"];
  body: string;
}

/** A raw HTTP request, so the test controls every header (fetch would add its own). */
function send(
  url: string,
  headers: Record<string, string | string[]>,
  body: Buffer,
): Promise<Sent> {
  return new Promise((resolve, reject) => {
    const r = request(`${url}/v1/things?secret=1`, { method: "POST", headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () =>
        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers,
          body: Buffer.concat(chunks).toString(),
        }),
      );
    });
    r.on("error", reject);
    r.end(body);
  });
}

/** The guard in front of a handler that counts what it was handed. */
function guarded(mw = refuseZstdBodies) {
  const seen = { next: 0, bodyBytesRead: 0, untouched: false };
  const s = createServer((req, res) => {
    mw(req, res, () => {
      seen.next += 1;
      req.on("data", (c: Buffer) => (seen.bodyBytesRead += c.byteLength));
      req.on("end", () => res.end("ok"));
    });
    // Nothing paused, piped or read the stream: no reader, so nothing could decode it.
    if (seen.next === 0)
      seen.untouched = req.readableFlowing === null && req.listenerCount("data") === 0;
  });
  return { s, seen };
}

const JSON_BODY = Buffer.from(JSON.stringify({ a: 1 }));

describe("contentCodings and namesRefusedCoding", () => {
  it("splits, trims and lower-cases, across repeated headers", () => {
    expect(contentCodings(undefined)).toEqual([]);
    expect(contentCodings(" GZip , br ")).toEqual(["gzip", "br"]);
    expect(contentCodings(["gzip", "ZSTD"])).toEqual(["gzip", "zstd"]);
    expect(contentCodings(",,")).toEqual([]);
  });

  it("finds zstd (and x-zstd) in any position and any case; nothing else", () => {
    for (const v of ["zstd", "ZSTD", " zstd ", "gzip, zstd", "zstd,gzip", "x-zstd", ["br", "Zstd"]])
      expect(namesRefusedCoding(v), String(v)).toBe(true);
    for (const v of [undefined, null, "", "identity", "gzip", "deflate", "br", "gzip, br", "zstdx"])
      expect(namesRefusedCoding(v), String(v)).toBe(false);
  });
});

describe("refuseZstdBodies", () => {
  it("answers 415 with the problem and never reads the body", async () => {
    const { s, seen } = guarded();
    const url = await listen(s);
    const r = await send(
      url,
      {
        "content-type": "application/json",
        "content-encoding": "zstd",
        traceparent: "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01",
      },
      zstdCompressSync(JSON_BODY),
    );
    expect(r.status).toBe(415);
    expect(r.headers["content-type"]).toBe("application/problem+json");
    expect(r.headers["cache-control"]).toBe("no-store");
    expect(r.headers["accept-encoding"]).toBe("gzip, deflate, br");
    expect(r.headers["connection"]).toBe("close");
    expect(JSON.parse(r.body)).toEqual({
      type: "https://help.infrabyx.in/errors/IPB-SEC-010",
      title: "Upload rejected: type mismatch",
      status: 415,
      code: "IPB-SEC-010",
      detail: "The request body's Content-Encoding is not accepted; use gzip, deflate, br or none.",
      instance: "/v1/things",
      trace_id: "0af7651916cd43dd8448eb211c80319c",
      reason: "content_encoding",
    });
    expect(seen).toEqual({ next: 0, bodyBytesRead: 0, untouched: true });
  });

  it("refuses zstd in a list, in capitals and in a repeated header", async () => {
    for (const enc of ["gzip, zstd", "ZSTD", ["gzip", "zstd"], "x-zstd"]) {
      const { s, seen } = guarded();
      const url = await listen(s);
      const r = await send(url, { "content-encoding": enc }, Buffer.from("x"));
      expect(r.status, String(enc)).toBe(415);
      expect(seen.next).toBe(0);
    }
  });

  it("lets gzip, deflate, br and identity through to the next handler", async () => {
    const cases: [string | undefined, Buffer][] = [
      ["gzip", gzipSync(JSON_BODY)],
      ["deflate", deflateSync(JSON_BODY)],
      ["br", brotliCompressSync(JSON_BODY)],
      ["identity", JSON_BODY],
      [undefined, JSON_BODY],
    ];
    for (const [enc, body] of cases) {
      const { s, seen } = guarded();
      const url = await listen(s);
      const r = await send(url, enc ? { "content-encoding": enc } : {}, body);
      expect(r.status, String(enc)).toBe(200);
      expect(seen.next).toBe(1);
      expect(seen.bodyBytesRead).toBe(body.byteLength);
    }
  });

  it("takes a product's re-export prefix and help base", async () => {
    const { s } = guarded(
      refuseZstdBodiesWith({ productPrefix: "LDC", typeBase: "https://help.example/errors" }),
    );
    const url = await listen(s);
    const p = JSON.parse((await send(url, { "content-encoding": "zstd" }, Buffer.from("x"))).body);
    expect(p).toMatchObject({
      code: "LDC-SEC-010",
      type: "https://help.example/errors/IPB-SEC-010",
      reason: "content_encoding",
    });
  });
});

/** A server that answers with `encoding` and records the Accept-Encoding it was offered. */
async function upstream(encoding: "zstd" | "gzip" | "identity") {
  const seen = { acceptEncoding: [] as (string | undefined)[], hits: 0 };
  const url = await listen(
    createServer((req, res) => {
      seen.hits += 1;
      seen.acceptEncoding.push(req.headers["accept-encoding"]);
      const body = Buffer.from(JSON.stringify({ ok: true }));
      if (encoding !== "identity") res.setHeader("content-encoding", encoding);
      res.end(
        encoding === "zstd" ? zstdCompressSync(body) : encoding === "gzip" ? gzipSync(body) : body,
      );
    }),
  );
  return { url, seen };
}

describe("refuseZstdFetch", () => {
  it("never offers zstd, whatever the caller asked", async () => {
    const { url, seen } = await upstream("identity");
    const f = refuseZstdFetch();
    await (await f(url, { headers: { "accept-encoding": "zstd" } })).text();
    await (await f(new Request(url, { headers: { "x-keep": "1" } }))).text();
    await (await f(url)).text();
    expect(seen.acceptEncoding).toEqual([
      OUTBOUND_ACCEPT_ENCODING,
      OUTBOUND_ACCEPT_ENCODING,
      OUTBOUND_ACCEPT_ENCODING,
    ]);
  });

  it("keeps a Request's own headers", async () => {
    let keep: string | undefined;
    const url = await listen(
      createServer((req, res) => {
        keep = req.headers["x-keep"] as string | undefined;
        res.end();
      }),
    );
    await refuseZstdFetch()(new Request(url, { headers: { "x-keep": "1" } }));
    expect(keep).toBe("1");
  });

  it("refuses a zstd response before its body is read", async () => {
    const { url } = await upstream("zstd");
    const plain = await fetch(url);
    expect(await plain.json()).toEqual({ ok: true }); // Node's fetch alone would decode it
    await expect(refuseZstdFetch()(url)).rejects.toBeInstanceOf(RefusedContentCodingError);
  });

  it("still decodes gzip", async () => {
    const { url } = await upstream("gzip");
    expect(await (await refuseZstdFetch()(url)).json()).toEqual({ ok: true });
  });
});

describe("createEgress", () => {
  const egressFor = () =>
    createEgress({
      port: "TEST",
      adapter: "stub",
      allow: [],
      allowLoopbackHttp: true,
      retries: 2,
      sleep: async () => undefined,
    });

  it("refuses a zstd answer with IPB-SEC-010 and does not retry", async () => {
    const { url, seen } = await upstream("zstd");
    const e = await egressFor()(url).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(PortError);
    expect(e).toMatchObject({ code: "IPB-SEC-010", meta: { reason: "content_encoding" } });
    expect(seen.hits).toBe(1);
    expect(seen.acceptEncoding).toEqual([OUTBOUND_ACCEPT_ENCODING]);
  });

  it("an injected fetch is wrapped too", async () => {
    const { url } = await upstream("zstd");
    const e = await createEgress({
      port: "TEST",
      adapter: "stub",
      allow: [],
      allowLoopbackHttp: true,
      fetchImpl: (i, n) => fetch(i, n),
    })(url).catch((x: unknown) => x);
    expect(e).toMatchObject({ code: "IPB-SEC-010" });
  });

  it("gzip answers keep working", async () => {
    const { url } = await upstream("gzip");
    expect((await egressFor()(url)).json()).toEqual({ ok: true });
  });
});

describe("refuseZstdInNextProxy (PR-UDF-089; R1-D-320)", () => {
  // The contract cases a product runs against its own proxy, run here against a proxy that calls
  // the helper first, as guide §7fk shows, and against the helper alone.
  const proxy = (req: Request) => refuseZstdInNextProxy(req) ?? new Response(null, { status: 200 });
  for (const c of nextProxyZstdContractCases()) it(`proxy: ${c.name}`, () => c.run(proxy));
  for (const c of nextProxyZstdContractCases())
    it(`helper: ${c.name}`, () => c.run(refuseZstdInNextProxy));

  it("a product prefix and the trace id reach the problem; Accept-Encoding names the accepted codings", async () => {
    const req = new Request("https://app.example.test/v1/x?secret=1", {
      method: "POST",
      body: zstdCompressSync(Buffer.from("{}")),
      headers: {
        "content-encoding": "zstd",
        traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
      },
    });
    const res = refuseZstdInNextProxy(req, { productPrefix: "UDF" });
    expect(res?.status).toBe(415);
    // A non-Next handler keeps the header; Next 16 strips it from proxy responses (guide §7fk).
    expect(res?.headers.get("accept-encoding")).toBe("gzip, deflate, br");
    expect(res?.headers.get("connection")).toBeNull();
    expect(await res?.json()).toMatchObject({
      code: "UDF-SEC-010",
      reason: "content_encoding",
      instance: "/v1/x",
      trace_id: "4bf92f3577b34da6a3ce929d0e0e4736",
    });
    expect(req.bodyUsed).toBe(false);
  });

  it("the product-prefixed contract cases pass with the prefix", async () => {
    const p = (req: Request) => refuseZstdInNextProxy(req, { productPrefix: "UDF" });
    for (const c of nextProxyZstdContractCases({ code: "UDF-SEC-010" })) await c.run(p);
  });
});
