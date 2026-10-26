// QUEUE port (IPB-01 §01.4.4.2). Payloads carry IDs and INTERNAL data only; anything larger is
// referenced by ID, never embedded.
import { z } from "zod";
import type { Port, PortCall } from "./common.js";
import { classed } from "./payload-class.js";

/** Job payload: a flat map of IDs and INTERNAL scalars. */
export const QueueJobData = classed(
  z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
  "INTERNAL",
);
export type QueueJobData = z.infer<typeof QueueJobData>;

export interface QueueJob {
  name: string;
  data: QueueJobData;
}

export interface EnqueueOptions extends PortCall {
  delayMs?: number;
  priority?: number;
  /** Defaults to `int.queue.default_attempts`. */
  attempts?: number;
}

export interface ConsumedJob extends QueueJob {
  id: string;
  attempt: number;
}

export interface QueueSubscription {
  close(): Promise<void>;
}

export interface QueueStats {
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
  dlq: number;
}

export interface QueuePort extends Port {
  /** Returns the job id; the same `idempotencyKey` returns the same id and enqueues nothing new. */
  enqueue(queue: string, job: QueueJob, opts?: EnqueueOptions): Promise<{ id: string }>;
  schedule(queue: string, cron: string, job: QueueJob): Promise<{ id: string }>;
  consume(
    queue: string,
    handler: (job: ConsumedJob) => Promise<void>,
    concurrency?: number,
  ): Promise<QueueSubscription>;
  moveToDLQ(queue: string, jobId: string, reason: string): Promise<void>;
  replay(queue: string, filter?: { name?: string; since?: string }): Promise<{ replayed: number }>;
  stats(queue: string): Promise<QueueStats>;
}
