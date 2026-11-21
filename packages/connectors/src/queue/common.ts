// Shared QUEUE behaviour (PL2 plan §6.8). Payloads are IDs and INTERNAL scalars only
// (QueueJobData; the router refuses anything above INTERNAL); queue and job names are
// identifiers, never personal data. Retries: `int.queue.default_attempts` (5) with exponential
// backoff from 2 s (`int.queue.backoff` = exponential:2000). After the last attempt a job goes to
// the queue's dead-letter queue `<queue>.dlq`, from which `replay` re-enqueues it. An
// idempotency key maps to a deterministic job id, so the same key never enqueues twice.
import { PortError } from "@infrabyx/contracts/errors";
import { assertQueueJob, assertQueueName, type QueueJob } from "@infrabyx/contracts/ports";
import { sha256Hex } from "@infrabyx/crypto";

export const DEFAULT_ATTEMPTS = 5;
export const DEFAULT_BACKOFF_MS = 2000;
export const dlqName = (queue: string) => `${queue}.dlq`;

// The name rule is the platform's one rule in `@infrabyx/contracts/ports` (`QUEUE_NAME_REGEX`,
// `QUEUE_JOB_NAME_REGEX`; Finbyx PR-FBX-53, R1-D-266), a subset of what bullmq and pg-boss both
// accept, so the in-memory fixtures refuse exactly what these adapters refuse.

/** Refuse a queue name outside the platform rule (`IPB-PORT-003`, before any I/O). */
export function checkQueue(adapter: string, queue: string): void {
  assertQueueName(queue, adapter);
}

/** Validate the job before any I/O: identifier name, flat INTERNAL payload. */
export function checkJob(adapter: string, job: QueueJob): void {
  assertQueueJob(job, adapter);
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
