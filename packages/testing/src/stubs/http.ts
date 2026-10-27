// Minimal HTTP server for vendor stubs (PL2 plan §7): records every request and lets a test inject
// failures. Stubs prove adapter logic only; the sandbox leg proves the vendor (plan §3.11).
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { generateWebhookSecret } from "@infrabyx/crypto";

/** A random credential for one stub run, so no credential-shaped literal is committed. */
export const stubCredential = (): string => generateWebhookSecret();

export interface StubRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: Record<string, string>;
  body: Buffer;
  json<T = unknown>(): T;
  form(): URLSearchParams;
}

export interface StubReply {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

export interface VendorStub {
  url: string;
  readonly requests: StubRequest[];
  /** Answer the next `n` requests with `status` (default 503) before handling normally. */
  failNext(n: number, status?: number): void;
  close(): Promise<void>;
}

const read = (req: IncomingMessage): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });

function send(res: ServerResponse, r: StubReply): void {
  const isText = typeof r.body === "string";
  res.writeHead(r.status, {
    "content-type": isText ? "text/plain" : "application/json",
    ...r.headers,
  });
  res.end(r.body === undefined ? "" : isText ? (r.body as string) : JSON.stringify(r.body));
}

export async function startStub(
  handle: (req: StubRequest) => StubReply | Promise<StubReply>,
): Promise<VendorStub> {
  const requests: StubRequest[] = [];
  let failing = 0;
  let failStatus = 503;
  const server = createServer(async (req, res) => {
    const u = new URL(req.url ?? "/", "http://stub");
    const body = await read(req);
    const headers = Object.fromEntries(
      Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(", ") : (v ?? "")]),
    );
    const r: StubRequest = {
      method: req.method ?? "GET",
      path: u.pathname,
      query: u.searchParams,
      headers,
      body,
      json: <T>() => JSON.parse(body.toString("utf8")) as T,
      form: () => new URLSearchParams(body.toString("utf8")),
    };
    requests.push(r);
    if (failing > 0) {
      failing--;
      return send(res, { status: failStatus, body: { error: "injected by stub" } });
    }
    try {
      send(res, await handle(r));
    } catch (e) {
      send(res, { status: 500, body: { error: (e as Error).message } });
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    failNext(n, status = 503) {
      failing = n;
      failStatus = status;
    },
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
