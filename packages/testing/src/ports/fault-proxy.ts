// Fault-injection HTTP proxy for breaker and failover tests (PL2 plan §7, @IPB-01-AT-08): sits in
// front of a stub or a vendor sandbox and returns N failures or adds delay before forwarding.
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";

export interface FaultPlan {
  /** Fail this many requests before forwarding the rest. */
  failFirst?: number;
  /** Status returned for injected failures (default 503). */
  status?: number;
  /** Delay before forwarding, to simulate a timeout. */
  delayMs?: number;
  /** Close the socket instead of answering (connection reset). */
  reset?: boolean;
}

export interface FaultProxy {
  url: string;
  /** Requests seen, injected ones included. */
  readonly requests: number;
  setPlan(plan: FaultPlan): void;
  close(): Promise<void>;
}

const body = (req: IncomingMessage): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });

export async function startFaultProxy(
  target: string,
  initial: FaultPlan = {},
): Promise<FaultProxy> {
  let plan = initial;
  let injected = 0;
  let requests = 0;
  const server = createServer(async (req, res) => {
    requests++;
    if (injected < (plan.failFirst ?? 0)) {
      injected++;
      if (plan.reset) return void req.socket.destroy();
      res.writeHead(plan.status ?? 503, { "content-type": "application/json" });
      return void res.end('{"error":"injected by fault proxy"}');
    }
    if (plan.delayMs) await new Promise((r) => setTimeout(r, plan.delayMs));
    const headers = Object.fromEntries(
      Object.entries(req.headers).filter(
        ([k, v]) => typeof v === "string" && !["host", "content-length", "connection"].includes(k),
      ),
    ) as Record<string, string>;
    const payload =
      req.method === "GET" || req.method === "HEAD" ? null : new Uint8Array(await body(req));
    try {
      const up = await fetch(new URL(req.url ?? "/", target), {
        method: req.method ?? "GET",
        headers,
        body: payload,
      });
      res.writeHead(
        up.status,
        Object.fromEntries(
          [...up.headers].filter(
            ([k]) => !["content-encoding", "content-length", "transfer-encoding"].includes(k),
          ),
        ),
      );
      res.end(Buffer.from(await up.arrayBuffer()));
    } catch {
      res.writeHead(502);
      res.end();
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    get requests() {
      return requests;
    },
    setPlan(p) {
      plan = p;
      injected = 0;
    },
    close: () => new Promise((r) => server.close(() => r())),
  };
}
