// Health registry (IPB-01-17, plan §3.6): probes every adapter every 30 s, caches results for 10 s,
// and aggregates the `/health/ready` body. A critical port down makes the service `down`; any other
// port down makes it `degraded` (IPB-01-AT-13).
import type { Port, PortHealth } from "@infrabyx/contracts/ports";

export const CRITICAL_PORTS: readonly string[] = Object.freeze(["IDENTITY", "KMS", "SECRETS"]);

export interface HealthEntry extends PortHealth {
  port: string;
  adapter: string;
  role: "primary" | "secondary";
}

export interface ReadyBody {
  status: "up" | "degraded" | "down";
  checks: HealthEntry[];
}

export interface HealthRegistryOptions {
  intervalMs?: number;
  cacheMs?: number;
  now?: () => number;
  /** Extra probes outside the port catalogue, e.g. the database; `critical` makes a failure `down`. */
  extra?: Array<{ name: string; critical: boolean; probe: () => Promise<PortHealth> }>;
  /** Gauge per adapter for OBSERVABILITY (1 up, 0.5 degraded, 0 down). */
  gauge?: (port: string, adapter: string, value: number) => void;
}

const DOWN = (now: number, latency = 0): PortHealth => ({
  status: "down",
  latency_ms: latency,
  checked_at: new Date(now).toISOString(),
});

export class HealthRegistry {
  private readonly items: Array<{ port: string; role: "primary" | "secondary"; adapter: Port }> =
    [];
  private cache?: { at: number; body: ReadyBody };
  private timer: NodeJS.Timeout | undefined;
  constructor(private readonly o: HealthRegistryOptions = {}) {}

  register(port: string, role: "primary" | "secondary", adapter: Port): void {
    this.items.push({ port, role, adapter });
  }

  /** Start periodic probing (unref'd, so it never keeps a process alive). */
  start(): void {
    this.timer ??= setInterval(() => void this.ready(true), this.o.intervalMs ?? 30_000);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async ready(force = false): Promise<ReadyBody> {
    const now = (this.o.now ?? Date.now)();
    if (!force && this.cache && now - this.cache.at < (this.o.cacheMs ?? 10_000))
      return this.cache.body;
    const checks = await Promise.all(
      this.items.map(async ({ port, role, adapter }): Promise<HealthEntry> => {
        const t0 = (this.o.now ?? Date.now)();
        const h = await adapter.health().catch(() => DOWN(now, (this.o.now ?? Date.now)() - t0));
        this.o.gauge?.(
          port,
          adapter.descriptor.adapter,
          h.status === "up" ? 1 : h.status === "degraded" ? 0.5 : 0,
        );
        return { ...h, port, adapter: adapter.descriptor.adapter, role };
      }),
    );
    const extra = await Promise.all(
      (this.o.extra ?? []).map(async (e) => ({
        critical: e.critical,
        entry: {
          ...(await e.probe().catch(() => DOWN(now))),
          port: e.name,
          adapter: e.name,
          role: "primary" as const,
        },
      })),
    );
    const all = [...checks, ...extra.map((x) => x.entry)];
    const criticalDown =
      checks.some(
        (c) => c.role === "primary" && c.status === "down" && CRITICAL_PORTS.includes(c.port),
      ) || extra.some((x) => x.critical && x.entry.status === "down");
    const anyBad = all.some((c) => c.status !== "up");
    const body: ReadyBody = {
      status: criticalDown ? "down" : anyBad ? "degraded" : "up",
      checks: all,
    };
    this.cache = { at: now, body };
    return body;
  }
}
