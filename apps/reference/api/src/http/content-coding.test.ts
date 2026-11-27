// LDC-68 / SEC-ZSTD-01 (R1-D-294): the reference API refuses a zstd request body with 415 before
// Nest's body parser (body-parser 2.x, which would decode it with the runtime's zstd) or any guard.
// gzip, deflate and br keep working. These tests fail without `app.use(refuseZstdBodies)`.
import { request } from "node:http";
import zlib, { brotliCompressSync, deflateSync, gzipSync, zstdCompressSync } from "node:zlib";
import type { AddressInfo } from "node:net";
import type { INestApplication } from "@nestjs/common";
import express from "express";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { refuseZstdBodies } from "@infrabyx/connectors/content-coding";
import { createApp } from "../app.js";
import type { Services } from "../services.js";

interface Sent {
  status: number;
  body: string;
}

function post(base: string, path: string, headers: Record<string, string>, body: Buffer) {
  return new Promise<Sent>((resolve, reject) => {
    const r = request(`${base}${path}`, { method: "POST", headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () =>
        resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString() }),
      );
    });
    r.on("error", reject);
    r.end(body);
  });
}

const JSON_BODY = Buffer.from(JSON.stringify({ hello: "world" }));
const json = { "content-type": "application/json" };

// body-parser calls `zlib.createZstdDecompress()` on the shared module object; count the calls.
const zstdDecoders = vi.spyOn(zlib, "createZstdDecompress");
afterEach(() => zstdDecoders.mockClear());

describe("createApp", () => {
  let app: INestApplication;
  let base: string;
  beforeAll(async () => {
    // No route is reached: the refusal comes before routing, so no service is needed.
    app = await createApp({} as Services);
    await app.listen(0, "127.0.0.1");
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await app.close();
  });

  it("refuses a zstd JSON body with 415 IPB-SEC-010 and never builds a zstd decoder", async () => {
    const r = await post(
      base,
      "/hello",
      { ...json, "content-encoding": "zstd" },
      zstdCompressSync(JSON_BODY),
    );
    expect(r.status).toBe(415);
    expect(JSON.parse(r.body)).toMatchObject({
      status: 415,
      code: "IPB-SEC-010",
      reason: "content_encoding",
      instance: "/hello",
    });
    expect(zstdDecoders).not.toHaveBeenCalled();
  });

  it("refuses before the body parser: a broken zstd body is 415, not body-parser's 400", async () => {
    const r = await post(
      base,
      "/auth/session",
      { ...json, "content-encoding": "ZSTD" },
      Buffer.from("not zstd"),
    );
    expect(r.status).toBe(415);
    expect(zstdDecoders).not.toHaveBeenCalled();
  });

  it("does not refuse gzip, deflate or br bodies", async () => {
    for (const [enc, body] of [
      ["gzip", gzipSync(JSON_BODY)],
      ["deflate", deflateSync(JSON_BODY)],
      ["br", brotliCompressSync(JSON_BODY)],
    ] as const) {
      const r = await post(base, "/hello", { ...json, "content-encoding": enc }, body);
      expect(r.status, enc).not.toBe(415);
    }
  });
});

describe("the pattern on Express 5 with body-parser", () => {
  let base: string;
  let close: () => Promise<void>;
  beforeAll(async () => {
    const app = express();
    app.use(refuseZstdBodies);
    app.use(express.json());
    app.post("/echo", (req, res) => {
      res.json(req.body);
    });
    const server = app.listen(0, "127.0.0.1");
    await new Promise((r) => server.once("listening", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    close = () => new Promise((r) => server.close(() => r()));
  });
  afterAll(async () => {
    await close();
  });

  it("decodes gzip, deflate, br and identity bodies as before", async () => {
    for (const [enc, body] of [
      ["gzip", gzipSync(JSON_BODY)],
      ["deflate", deflateSync(JSON_BODY)],
      ["br", brotliCompressSync(JSON_BODY)],
      ["identity", JSON_BODY],
    ] as const) {
      const r = await post(base, "/echo", { ...json, "content-encoding": enc }, body);
      expect(r.status, enc).toBe(200);
      expect(JSON.parse(r.body), enc).toEqual({ hello: "world" });
    }
  });

  it("refuses zstd, which body-parser alone decodes", async () => {
    const bare = express();
    bare.use(express.json());
    bare.post("/echo", (req, res) => {
      res.json(req.body);
    });
    const server = bare.listen(0, "127.0.0.1");
    await new Promise((r) => server.once("listening", r));
    const bareBase = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const unguarded = await post(
        bareBase,
        "/echo",
        { ...json, "content-encoding": "zstd" },
        zstdCompressSync(JSON_BODY),
      );
      expect(unguarded.status).toBe(200); // the exposure CVE-2026-124851 rides on
      expect(zstdDecoders).toHaveBeenCalledTimes(1);
    } finally {
      await new Promise((r) => server.close(() => r(undefined)));
    }
    zstdDecoders.mockClear();
    const r = await post(
      base,
      "/echo",
      { ...json, "content-encoding": "zstd" },
      zstdCompressSync(JSON_BODY),
    );
    expect(r.status).toBe(415);
    expect(zstdDecoders).not.toHaveBeenCalled();
  });
});
