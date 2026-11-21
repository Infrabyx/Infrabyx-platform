// QUEUE port (IPB-01 §01.4.4.2). Payloads carry IDs and INTERNAL data only; anything larger is
// referenced by ID, never embedded.
import { z } from "zod";
import { PortError } from "../errors.js";
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

// The platform's one queue and job name rule (Finbyx PR-FBX-53; R1-D-266). It is checked before
// any I/O by every QUEUE adapter and by a product's in-memory fixture, so a fixture never accepts
// a name a real queue refuses. The libraries' own rules, and the platform rule inside them:
//  - bullmq 6: a queue name is non-empty and has no `:`; a custom job id (the job scheduler id
//    `cron-<job name>`) has no `:`; a job name is otherwise free text;
//  - pg-boss 12: a queue name, its dead-letter queue name and a schedule key (the job name) match
//    `^[\w.\-/]+$`;
//  - so both accept `[A-Za-z0-9_.\-/]+` for a queue and a job name. The platform rule is a subset:
//    lower case, starting with a letter, no `/`; a queue name has no `.` (the adapters reserve
//    `<queue>.dlq`) and at most 63 characters, a job name at most 100.
// A CloudEvents type has capitals, so it is never a job name: map it with `eventJobName`
// (`@infrabyx/contracts/events`) and keep the full type in the job data.

/** A queue name: lower case, a letter first, then letters, digits, `_` or `-`; 1 to 63 characters. */
export const QUEUE_NAME_REGEX = /^[a-z][a-z0-9_-]{0,62}$/;
/** A job name: lower case, a letter first, then letters, digits, `_`, `.` or `-`; 1 to 100 characters. */
export const QUEUE_JOB_NAME_REGEX = /^[a-z][a-z0-9_.-]{0,99}$/;
/** The longest job name the platform accepts. */
export const QUEUE_JOB_NAME_MAX = 100;
/** The longest queue name the platform accepts. */
export const QUEUE_NAME_MAX = 63;

export const isQueueName = (name: unknown): name is string =>
  typeof name === "string" && QUEUE_NAME_REGEX.test(name);
export const isQueueJobName = (name: unknown): name is string =>
  typeof name === "string" && QUEUE_JOB_NAME_REGEX.test(name);

/** Refuse a queue name outside the platform rule: `IPB-PORT-003`, before any I/O. */
export function assertQueueName(queue: unknown, adapter = "memory"): asserts queue is string {
  if (!isQueueName(queue))
    throw new PortError("IPB-PORT-003", "QUEUE", {
      adapter,
      detail: "queue names are lower-case identifiers (no dots; `.dlq` is reserved)",
      meta: { reason: "queue_name" },
    });
}

/** Refuse a job outside the platform rule (name, or a payload that is not flat INTERNAL data). */
export function assertQueueJob(job: QueueJob, adapter = "memory"): void {
  if (!isQueueJobName(job?.name))
    throw new PortError("IPB-PORT-003", "QUEUE", {
      adapter,
      detail: "job names are lower-case identifiers",
      meta: { reason: "job_name" },
    });
  if (!QueueJobData.safeParse(job.data).success)
    throw new PortError("IPB-PORT-003", "QUEUE", {
      adapter,
      detail: "job data must be a flat map of IDs and INTERNAL scalars",
      meta: { reason: "job_data" },
    });
}
