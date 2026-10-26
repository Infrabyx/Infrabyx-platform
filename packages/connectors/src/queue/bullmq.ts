// QUEUE reference `bullmq` (PL2 plan §6.8): BullMQ on Redis 7 or Valkey 8 (ElastiCache with TLS
// and AUTH in production, `QUEUE_REDIS_URL` locally). BullMQ has no dead-letter queue, so the
// adapter's processor moves a job to `<queue>.dlq` when its last attempt fails; `replay` moves
// dead-lettered jobs back. Cron schedules are BullMQ job schedulers (idempotent by id).
import { Queue, Worker, type Job, type ConnectionOptions } from "bullmq";
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
  idempotentJobId,
  unavailable,
} from "./common.js";

export interface BullmqQueueOptions {
  /** `QUEUE_REDIS_URL` (rediss:// in production; the AUTH token comes from SECRETS). */
  url: string;
  /** `int.queue.default_attempts` (5). */
  attempts?: number;
  /** First backoff delay of `int.queue.backoff` exponential:<ms> (2000). */
  backoffMs?: number;
  /** Key prefix, so several products can share one cluster. */
  prefix?: string;
}

interface DlqData {
  job: string;
  data: QueueJob["data"];
  reason: string;
  failedAt: string;
}

export class BullmqQueue implements QueuePort {
  readonly descriptor: AdapterDescriptor = {
    port: "QUEUE",
    adapter: "bullmq",
    residency: "IN",
    maxDataClass: "INTERNAL",
  };
  private readonly connection: ConnectionOptions;
  private readonly queues = new Map<string, Queue>();
  private readonly workers = new Set<Worker>();

  constructor(private readonly o: BullmqQueueOptions) {
    const u = new URL(o.url);
    if (u.protocol !== "redis:" && u.protocol !== "rediss:")
      throw new PortError("IPB-PORT-005", "QUEUE", {
        adapter: "bullmq",
        detail: "QUEUE_REDIS_URL must be redis:// or rediss://",
      });
    this.connection = {
      url: o.url,
      maxRetriesPerRequest: null,
      ...(u.protocol === "rediss:" ? { tls: {} } : {}),
    } as ConnectionOptions;
  }

  private get attempts(): number {
    return this.o.attempts ?? DEFAULT_ATTEMPTS;
  }

  private queue(name: string): Queue {
    let q = this.queues.get(name);
    if (!q) {
      q = new Queue(name, {
        connection: this.connection,
        ...(this.o.prefix ? { prefix: this.o.prefix } : {}),
      });
      this.queues.set(name, q);
    }
    return q;
  }

  async enqueue(queue: string, job: QueueJob, opts: EnqueueOptions = {}): Promise<{ id: string }> {
    checkQueue("bullmq", queue);
    checkJob("bullmq", job);
    const jobId = opts.idempotencyKey ? idempotentJobId(queue, opts.idempotencyKey) : undefined;
    try {
      const j = await this.queue(queue).add(job.name, job.data, {
        ...(jobId ? { jobId } : {}),
        ...(opts.delayMs ? { delay: opts.delayMs } : {}),
        ...(opts.priority !== undefined ? { priority: opts.priority } : {}),
        attempts: opts.attempts ?? this.attempts,
        backoff: { type: "exponential", delay: this.o.backoffMs ?? DEFAULT_BACKOFF_MS },
        removeOnComplete: { age: 86_400, count: 10_000 },
        removeOnFail: { age: 7 * 86_400 },
      });
      return { id: j.id! };
    } catch (e) {
      throw unavailable("bullmq", "enqueue", e);
    }
  }

  async schedule(queue: string, cron: string, job: QueueJob): Promise<{ id: string }> {
    checkQueue("bullmq", queue);
    checkJob("bullmq", job);
    const id = `cron-${job.name}`;
    try {
      await this.queue(queue).upsertJobScheduler(
        id,
        { pattern: cron, tz: "UTC" },
        { name: job.name, data: job.data, opts: { attempts: this.attempts } },
      );
      return { id };
    } catch (e) {
      throw unavailable("bullmq", "schedule", e);
    }
  }

  async consume(
    queue: string,
    handler: (job: ConsumedJob) => Promise<void>,
    concurrency = 1,
  ): Promise<QueueSubscription> {
    checkQueue("bullmq", queue);
    const dlq = this.queue(dlqName(queue));
    const worker = new Worker(
      queue,
      async (j: Job) => {
        try {
          await handler({
            id: j.id!,
            name: j.name,
            data: j.data as QueueJob["data"],
            attempt: j.attemptsMade + 1,
          });
        } catch (e) {
          // The last attempt: keep the job in the dead-letter queue for replay.
          if (j.attemptsMade + 1 >= (j.opts.attempts ?? 1))
            await dlq.add(
              "dead",
              {
                job: j.name,
                data: j.data,
                reason: (e as Error).name || "Error",
                failedAt: new Date().toISOString(),
              } satisfies DlqData,
              { removeOnComplete: true },
            );
          throw e;
        }
      },
      {
        connection: this.connection,
        concurrency,
        ...(this.o.prefix ? { prefix: this.o.prefix } : {}),
      },
    );
    this.workers.add(worker);
    await worker.waitUntilReady();
    return {
      close: async () => {
        this.workers.delete(worker);
        await worker.close();
      },
    };
  }

  async moveToDLQ(queue: string, jobId: string, reason: string): Promise<void> {
    checkQueue("bullmq", queue);
    const q = this.queue(queue);
    const j = await q.getJob(jobId);
    if (!j)
      throw new PortError("IPB-PORT-001", "QUEUE", {
        adapter: "bullmq",
        detail: "no such job",
        meta: { reason: "not_found" },
      });
    await this.queue(dlqName(queue)).add(
      "dead",
      { job: j.name, data: j.data, reason, failedAt: new Date().toISOString() } satisfies DlqData,
      { removeOnComplete: true },
    );
    await j.remove();
  }

  async replay(
    queue: string,
    filter: { name?: string; since?: string } = {},
  ): Promise<{ replayed: number }> {
    checkQueue("bullmq", queue);
    const dlq = this.queue(dlqName(queue));
    const since = filter.since ? Date.parse(filter.since) : 0;
    let replayed = 0;
    for (const j of await dlq.getJobs(["waiting", "delayed", "prioritized"], 0, 999, true)) {
      const d = j.data as DlqData;
      if (filter.name && d.job !== filter.name) continue;
      if (since && Date.parse(d.failedAt) < since) continue;
      await this.enqueue(queue, { name: d.job, data: d.data });
      await j.remove();
      replayed++;
    }
    return { replayed };
  }

  async stats(queue: string): Promise<QueueStats> {
    checkQueue("bullmq", queue);
    const [c, d] = await Promise.all([
      this.queue(queue).getJobCounts("waiting", "prioritized", "active", "delayed", "failed"),
      this.queue(dlqName(queue)).getJobCounts("waiting", "prioritized", "delayed"),
    ]);
    return {
      waiting: (c.waiting ?? 0) + (c.prioritized ?? 0),
      active: c.active ?? 0,
      delayed: c.delayed ?? 0,
      failed: c.failed ?? 0,
      dlq: (d.waiting ?? 0) + (d.prioritized ?? 0) + (d.delayed ?? 0),
    };
  }

  async health(): Promise<PortHealth> {
    const t0 = Date.now();
    let status: PortHealth["status"] = "up";
    try {
      // A round trip to Redis through BullMQ's own scripts, bounded at 3 s.
      await Promise.race([
        this.queue("ipb-health").getJobCounts("waiting"),
        new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 3000)),
      ]);
    } catch {
      status = "down";
    }
    return { status, latency_ms: Date.now() - t0, checked_at: new Date().toISOString() };
  }

  /** Close workers and connections (shutdown hook). */
  async close(): Promise<void> {
    await Promise.all([...this.workers].map((w) => w.close()));
    await Promise.all([...this.queues.values()].map((q) => q.close()));
    this.workers.clear();
    this.queues.clear();
  }
}
