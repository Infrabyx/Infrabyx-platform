// The worker (IPB-01 §01.4.2 `apps/worker`: the same codebase, a worker entrypoint; PL6 plan §8.1).
// It builds the same services as the API, serves the health probes on its own port, and runs the
// QUEUE consumers: the hello example job, and the export runner (`export` queue, ids only), with
// the export sweep that re-enqueues approved jobs and deletes expired archives (IPB-07-27). A
// product adds its own queues, the Temporal worker and its sweeps here (PL6 session 4c adds the
// outbox relay and the Temporal worker).
import { createServer, type Server } from "node:http";
import { readiness } from "./http/health.controller.js";
import { buildServices, EXPORT_QUEUE, type BuildOptions, type Services } from "./services.js";

/** Queues the reference worker consumes. */
export const HELLO_QUEUE = "hello";
export { EXPORT_QUEUE };

export interface WorkerHandle {
  services: Services;
  server: Server;
  port: number;
  /** One pass of the export sweep (also run on an interval). */
  sweep(): Promise<{ enqueued: number; deleted: number }>;
  stop(): Promise<void>;
}

/** The hello queue's handler: the example of a job that reads nothing it was not given. */
export async function handleHelloJob(job: { name: string; data: unknown }): Promise<void> {
  if (job.name !== "greeting.created") throw new Error(`unknown hello job ${job.name}`);
  process.stdout.write(`${JSON.stringify({ msg: "hello job", name: job.name })}\n`);
}

/** The export queue's handler: `run` is idempotent, so a repeated job is harmless. */
export function exportJobHandler(services: Services) {
  return async (job: { name: string; data: unknown }): Promise<void> => {
    if (job.name !== "run") throw new Error(`unknown export job ${job.name}`);
    const { tenantId, jobId } = job.data as { tenantId?: unknown; jobId?: unknown };
    if (typeof tenantId !== "string" || typeof jobId !== "string")
      throw new Error("an export job carries tenantId and jobId only");
    const r = await services.exports.run(tenantId, jobId);
    process.stdout.write(
      `${JSON.stringify({ msg: "export job", job_id: jobId, state: r.state, error: r.errorCode })}\n`,
    );
  };
}

export async function runWorker(
  o: BuildOptions & { port?: number; sweepIntervalMs?: number } = {},
): Promise<WorkerHandle> {
  const services = await buildServices(o);
  const subs = await Promise.all([
    services.queue.consume(HELLO_QUEUE, handleHelloJob, 2),
    services.queue.consume(EXPORT_QUEUE, exportJobHandler(services), 1),
  ]);
  const sweep = () => services.exports.sweep({ limit: 100 });
  const timer = setInterval(() => {
    sweep().catch((e: Error) =>
      process.stderr.write(`${JSON.stringify({ msg: "export sweep failed", error: e.message })}\n`),
    );
  }, o.sweepIntervalMs ?? 60_000);
  timer.unref();
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
    sweep,
    stop: async () => {
      clearInterval(timer);
      for (const sub of subs) await sub.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await services.close();
    },
  };
}
