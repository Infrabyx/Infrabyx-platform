// Shared QUEUE behaviour (PL2 plan §6.8). Payloads are IDs and INTERNAL scalars only
// (QueueJobData; the router refuses anything above INTERNAL); queue and job names are
// identifiers, never personal data. Retries: `int.queue.default_attempts` (5) with exponential
// backoff from 2 s (`int.queue.backoff` = exponential:2000). After the last attempt a job goes to
// the queue's dead-letter queue `<queue>.dlq`, from which `replay` re-enqueues it. An
// idempotency key maps to a deterministic job id, so the same key never enqueues twice.
import { PortError } from "@infrabyx/contracts/errors";
import { QueueJobData, type QueueJob } from "@infrabyx/contracts/ports";
import { sha256Hex } from "@infrabyx/crypto";

export const DEFAULT_ATTEMPTS = 5;
export const DEFAULT_BACKOFF_MS = 2000;
export const dlqName = (queue: string) => `${queue}.dlq`;

const QUEUE_NAME = /^[a-z][a-z0-9_-]{0,62}$/;
const JOB_NAME = /^[a-z][a-z0-9_.-]{0,99}$/;

export function checkQueue(adapter: string, queue: string): void {
  if (!QUEUE_NAME.test(queue))
    throw new PortError("IPB-PORT-003", "QUEUE", {
      adapter,
      detail: "queue names are lower-case identifiers (no dots; `.dlq` is reserved)",
    });
}

/** Validate the job before any I/O: identifier name, flat INTERNAL payload. */
export function checkJob(adapter: string, job: QueueJob): void {
  if (!JOB_NAME.test(job.name))
    throw new PortError("IPB-PORT-003", "QUEUE", {
      adapter,
      detail: "job names are lower-case identifiers",
    });
  const r = QueueJobData.safeParse(job.data);
  if (!r.success)
    throw new PortError("IPB-PORT-003", "QUEUE", {
      adapter,
      detail: "job data must be a flat map of IDs and INTERNAL scalars",
    });
}

/** Deterministic job id for an idempotency key, scoped to the queue. */
export const idempotentJobId = (queue: string, key: string) =>
  `idk${sha256Hex(`${queue}\u0000${key}`).slice(0, 40)}`;

/** The same id as an RFC 4122-shaped UUID (pg-boss job ids are uuid). */
export function idempotentUuid(queue: string, key: string): string {
  const h = sha256Hex(`${queue}\u0000${key}`);
  const v = ((parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${v}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export const unavailable = (adapter: string, what: string, cause: unknown) =>
  new PortError("IPB-PORT-002", "QUEUE", { adapter, detail: `${adapter} ${what} failed`, cause });
