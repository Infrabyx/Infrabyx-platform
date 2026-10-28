// The worker (IPB-01 §01.4.2 `apps/worker`: the same codebase, a worker entrypoint; PL6 plan §8.1).
// It builds the same services as the API, serves the health probes on its own port, and runs the
// QUEUE consumers. The hello consumer is the example: a product replaces the handler and adds its
// own queues, the Temporal worker and the sweeps (PL6 session 4b adds the outbox dispatcher and the
// export runner).
import { createServer, type Server } from "node:http";
import { readiness } from "./http/health.controller.js";
import { buildServices, type BuildOptions, type Services } from "./services.js";

/** Queues the reference worker consumes. */
export const HELLO_QUEUE = "hello";

export interface WorkerHandle {
  services: Services;
  server: Server;
  port: number;
  stop(): Promise<void>;
}

/** The hello queue's handler: the example of a job that reads nothing it was not given. */
export async function handleHelloJob(job: { name: string; data: unknown }): Promise<void> {
  if (job.name !== "greeting.created") throw new Error(`unknown hello job ${job.name}`);
  process.stdout.write(`${JSON.stringify({ msg: "hello job", name: job.name })}\n`);
}

export async function runWorker(o: BuildOptions & { port?: number } = {}): Promise<WorkerHandle> {
  const services = await buildServices(o);
  const sub = await services.queue.consume(HELLO_QUEUE, handleHelloJob, 2);
  const server = createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0];
    const send = (body: unknown, status: number) => {
      res.writeHead(status, {
        "content-type": "application/json",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      });
      res.end(JSON.stringify(body));
    };
    if (path === "/health/live") return send({ status: "up" }, 200);
    if (path === "/health/ready" || path === "/health/startup")
      return void readiness(services).then(
        (b) => send(b, b.status === "down" ? 503 : 200),
        () => send({ status: "down", checks: [] }, 503),
      );
    send({ status: 404 }, 404);
  });
  const port = o.port ?? services.env.APP_PORT;
  await new Promise<void>((resolve) => server.listen(port, "0.0.0.0", resolve));
  const actual = (server.address() as { port: number }).port;
  return {
    services,
    server,
    port: actual,
    stop: async () => {
      await sub.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await services.close();
    },
  };
}
