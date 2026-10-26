// QUEUE alternative `pg-boss` (PL2 plan §6.8, D-05): pg-boss on the platform PostgreSQL in schema
// `pgboss`, created by connectors migration 0003 (generated from pg-boss's construction plan,
// PL2-D-58). Application roles have no DDL rights, so pg-boss runs with migrate and createSchema
// off and queue stats are not persisted (that would create daily partitions). Queues share
// pg-boss's common job table; each has a native dead-letter queue `<queue>.dlq`, and `replay`
// uses pg-boss's redrive. Our job name travels in the payload (`n`), the data in `d`.
import { PgBoss, type Job } from "pg-boss";
import type {
  AdapterDescriptor,
  ConsumedJob,
  EnqueueOptions,
  PortHealth,
  QueueJob,
  QueuePort,
  QueueStats,
  QueueSubscription,
} from "@infrabyx/contracts/ports";
import { PortError } from "@infrabyx/contracts/errors";
import {
  checkJob,
  checkQueue,
  DEFAULT_ATTEMPTS,
  DEFAULT_BACKOFF_MS,
  dlqName,
  idempotentUuid,
  unavailable,
} from "./common.js";

export const PGBOSS_SCHEMA = "pgboss";

export interface PgBossQueueOptions {
  /** Platform PostgreSQL for a role with DML on `pgboss` (PgBouncer in transaction mode works). */
  connectionString: string;
  attempts?: number;
  backoffMs?: number;
  /** Pool size (default 4). */
  max?: number;
  /** Run maintenance and cron on this instance (default true; one per deployment is enough). */
  supervise?: boolean;
}

interface Envelope {
  n: string;
  d: QueueJob["data"];
  reason?: string;
}

export class PgBossQueue implements QueuePort {
  readonly descriptor: AdapterDescriptor = {
    port: "QUEUE",
    adapter: "pg-boss",
    residency: "IN",
    maxDataClass: "INTERNAL",
  };
  private readonly boss: PgBoss;
  private started: Promise<unknown> | null = null;
  private readonly ensured = new Map<string, Promise<void>>();

  constructor(private readonly o: PgBossQueueOptions) {
    this.boss = new PgBoss({
      connectionString: o.connectionString,
      schema: PGBOSS_SCHEMA,
      application_name: "infrabyx-queue",
      max: o.max ?? 4,
      migrate: false,
      createSchema: false,
      persistQueueStats: false,
      supervise: o.supervise ?? true,
      schedule: o.supervise ?? true,
    });
    this.boss.on("error", () => {
      // Surfaced through health(); pg-boss retries its own maintenance.
    });
  }

  private async ready(): Promise<PgBoss> {
    this.started ??= this.boss.start().catch((e: unknown) => {
      this.started = null;
      throw unavailable("pg-boss", "start", e);
    });
    await this.started;
    return this.boss;
  }

  /** Create the queue and its dead-letter queue once (insert-only; no DDL). */
  private ensure(queue: string): Promise<void> {
    let p = this.ensured.get(queue);
    if (!p) {
      p = (async () => {
        const boss = await this.ready();
        const dlq = dlqName(queue);
        if (!(await boss.getQueue(dlq)))
          await boss.createQueue(dlq, { retryLimit: 0, retentionSeconds: 14 * 86_400 });
        if (!(await boss.getQueue(queue)))
          await boss.createQueue(queue, {
            retryLimit: (this.o.attempts ?? DEFAULT_ATTEMPTS) - 1,
            retryDelay: Math.max(1, Math.round((this.o.backoffMs ?? DEFAULT_BACKOFF_MS) / 1000)),
            retryBackoff: true,
            deadLetter: dlq,
          });
      })().catch((e: unknown) => {
        this.ensured.delete(queue);
        throw e instanceof PortError ? e : unavailable("pg-boss", "create queue", e);
      });
      this.ensured.set(queue, p);
    }
    return p;
  }

  async enqueue(queue: string, job: QueueJob, opts: EnqueueOptions = {}): Promise<{ id: string }> {
    checkQueue("pg-boss", queue);
    checkJob("pg-boss", job);
    await this.ensure(queue);
    const id = opts.idempotencyKey ? idempotentUuid(queue, opts.idempotencyKey) : undefined;
    try {
      const sent = await this.boss.send(queue, { n: job.name, d: job.data } satisfies Envelope, {
        ...(id ? { id } : {}),
        ...(opts.delayMs ? { startAfter: new Date(Date.now() + opts.delayMs) } : {}),
        ...(opts.priority !== undefined ? { priority: opts.priority } : {}),
        ...(opts.attempts !== undefined ? { retryLimit: opts.attempts - 1 } : {}),
      });
      // A duplicate id inserts nothing and returns null: the earlier job stands.
      return { id: sent ?? id! };
    } catch (e) {
      throw unavailable("pg-boss", "enqueue", e);
    }
  }

  async schedule(queue: string, cron: string, job: QueueJob): Promise<{ id: string }> {
    checkQueue("pg-boss", queue);
    checkJob("pg-boss", job);
    await this.ensure(queue);
    try {
      await this.boss.schedule(queue, cron, { n: job.name, d: job.data } satisfies Envelope, {
        tz: "UTC",
        key: job.name,
      });
      return { id: `${queue}:${job.name}` };
    } catch (e) {
      throw unavailable("pg-boss", "schedule", e);
    }
  }

  async consume(
    queue: string,
    handler: (job: ConsumedJob) => Promise<void>,
    concurrency = 1,
  ): Promise<QueueSubscription> {
    checkQueue("pg-boss", queue);
    await this.ensure(queue);
    const workId = await this.boss.work<Envelope>(
      queue,
      { batchSize: 1, localConcurrency: concurrency, pollingIntervalSeconds: 0.5 },
      async ([j]: Job<Envelope>[]) => {
        await handler({
          id: j!.id,
          name: j!.data.n,
          data: j!.data.d,
          attempt: (j!.retryCount ?? 0) + 1,
        });
      },
    );
    return {
      close: async () => {
        await this.boss.offWork(queue, { id: workId, wait: true });
      },
    };
  }

  async moveToDLQ(queue: string, jobId: string, reason: string): Promise<void> {
    checkQueue("pg-boss", queue);
    await this.ensure(queue);
    const [j] = await this.boss.findJobs<Envelope>(queue, { id: jobId });
    if (!j)
      throw new PortError("IPB-PORT-001", "QUEUE", {
        adapter: "pg-boss",
        detail: "no such job",
        meta: { reason: "not_found" },
      });
    await this.boss.send(dlqName(queue), { ...j.data, reason } satisfies Envelope);
    await this.boss.deleteJob(queue, jobId);
  }

  async replay(
    queue: string,
    filter: { name?: string; since?: string } = {},
  ): Promise<{ replayed: number }> {
    checkQueue("pg-boss", queue);
    await this.ensure(queue);
    const dlq = dlqName(queue);
    const since = filter.since ? Date.parse(filter.since) : 0;
    const jobs = (await this.boss.findJobs<Envelope>(dlq, { queued: true, limit: 1000 })).filter(
      (j) =>
        (!filter.name || j.data.n === filter.name) && (!since || j.createdOn.getTime() >= since),
    );
    let replayed = 0;
    for (const j of jobs) {
      await this.enqueue(queue, { name: j.data.n, data: j.data.d });
      await this.boss.deleteJob(dlq, j.id);
      replayed++;
    }
    return { replayed };
  }

  async stats(queue: string): Promise<QueueStats> {
    checkQueue("pg-boss", queue);
    await this.ensure(queue);
    // pg-boss caches its queue counts (up to a minute even when forced); count the job table.
    const { rows } = await this.boss
      .getDb()
      .executeSql(
        `select name,
                count(*) filter (where state in ('created', 'retry') and start_after <= now()) as waiting,
                count(*) filter (where state in ('created', 'retry') and start_after > now()) as delayed,
                count(*) filter (where state = 'active') as active,
                count(*) filter (where state = 'failed') as failed,
                count(*) filter (where state in ('created', 'retry', 'active')) as queued
           from ${PGBOSS_SCHEMA}.job where name = any($1) group by name`,
        [[queue, dlqName(queue)]],
      )
      .catch((e: unknown) => {
        throw unavailable("pg-boss", "stats", e);
      });
    const row = (n: string) => rows.find((r: { name: string }) => r.name === n) ?? {};
    const q = row(queue) as Record<string, string | undefined>;
    const d = row(dlqName(queue)) as Record<string, string | undefined>;
    return {
      waiting: Number(q.waiting ?? 0),
      active: Number(q.active ?? 0),
      delayed: Number(q.delayed ?? 0),
      failed: Number(q.failed ?? 0),
      dlq: Number(d.queued ?? 0),
    };
  }

  async health(): Promise<PortHealth> {
    const t0 = Date.now();
    let status: PortHealth["status"] = "up";
    try {
      const boss = await this.ready();
      if (!(await boss.isInstalled())) status = "down";
    } catch {
      status = "down";
    }
    return { status, latency_ms: Date.now() - t0, checked_at: new Date().toISOString() };
  }

  async close(): Promise<void> {
    if (this.started) await this.boss.stop({ graceful: true, timeout: 10_000 });
    this.started = null;
  }
}
