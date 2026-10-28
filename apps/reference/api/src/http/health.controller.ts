// Health probes for the container and the chart (IPB-01 §01.4.8.2; PL6 plan §3.2). `live` answers
// while the process serves requests; `ready` and `startup` need one database round trip and the
// critical adapters within two seconds. The body has the `ReadyBody` shape of
// `@infrabyx/connectors` health; it names no host, version or error text.
import { Controller, Get, Inject, Res } from "@nestjs/common";
import type { Response } from "express";
import type { HealthEntry, ReadyBody } from "@infrabyx/connectors";
import { SERVICES, type ServicesLike } from "./tokens.js";

const TIMEOUT_MS = 2_000;
const CRITICAL = new Set(["DATABASE", "IDENTITY"]);

const withTimeout = <T>(p: Promise<T>): Promise<T> =>
  Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error("timeout")), TIMEOUT_MS).unref(),
    ),
  ]);

export async function readiness(s: ServicesLike): Promise<ReadyBody> {
  const probes: Array<{ port: string; adapter: string; probe: () => Promise<unknown> }> = [
    { port: "DATABASE", adapter: "postgres", probe: () => s.ping() },
    { port: "IDENTITY", adapter: s.identity.descriptor.adapter, probe: () => s.identity.health() },
    { port: "AUTHZ", adapter: s.authz.descriptor.adapter, probe: () => s.authz.health() },
    { port: "STORAGE", adapter: s.storage.descriptor.adapter, probe: () => s.storage.health() },
    { port: "QUEUE", adapter: s.queue.descriptor.adapter, probe: () => s.queue.health() },
  ];
  const checks: HealthEntry[] = await Promise.all(
    probes.map(async (p) => {
      const t0 = Date.now();
      const r = await withTimeout(p.probe()).then(
        (v) =>
          v && typeof v === "object" && (v as { status?: string }).status
            ? ((v as { status: string }).status as "up" | "degraded" | "down")
            : ("up" as const),
        () => "down" as const,
      );
      return {
        port: p.port,
        adapter: p.adapter,
        role: "primary" as const,
        status: r,
        latency_ms: Date.now() - t0,
        checked_at: new Date().toISOString(),
      };
    }),
  );
  const notUp = checks.filter((c) => c.status !== "up");
  const status = notUp.some((c) => CRITICAL.has(c.port))
    ? "down"
    : notUp.length
      ? "degraded"
      : "up";
  return { status, checks };
}

@Controller("health")
export class HealthController {
  constructor(@Inject(SERVICES) private readonly s: ServicesLike) {}

  private send(res: Response, body: unknown, status: number): void {
    res
      .status(status)
      .setHeader("content-type", "application/json")
      .setHeader("cache-control", "no-store")
      .setHeader("x-content-type-options", "nosniff")
      .send(JSON.stringify(body));
  }

  @Get("live")
  live(@Res() res: Response): void {
    this.send(res, { status: "up" }, 200);
  }

  @Get("ready")
  async ready(@Res() res: Response): Promise<void> {
    const body = await readiness(this.s);
    this.send(res, body, body.status === "down" ? 503 : 200);
  }

  @Get("startup")
  async startup(@Res() res: Response): Promise<void> {
    return this.ready(res);
  }
}
