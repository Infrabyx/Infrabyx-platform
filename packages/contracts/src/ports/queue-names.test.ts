// The platform's queue and job name rule (Finbyx PR-FBX-53; R1-D-266) is inside what both queue
// libraries accept, so a name a fixture accepts is never refused by bullmq or pg-boss. The library
// rules are restated from their sources (bullmq 6 `QueueBase` and `Job` id checks; pg-boss 12
// `assertObjectName`); the QUEUE contract legs prove them live.
import { describe, expect, it } from "vitest";
import {
  assertQueueJob,
  assertQueueName,
  isQueueJobName,
  isQueueName,
  QUEUE_JOB_NAME_MAX,
  QUEUE_NAME_MAX,
} from "./queue.js";

const bullmqQueue = (n: string) => n.length > 0 && !n.includes(":");
const bullmqSchedulerId = (job: string) => !`cron-${job}`.includes(":");
const pgBossName = (n: string) => /^[\w.\-/]+$/.test(n);

const BAD_QUEUE_NAMES = [
  "",
  "Events",
  "has space",
  "a:b",
  "events.dlq",
  "a.b",
  "a/b",
  "1events",
  "-events",
  "évents",
  "q".repeat(QUEUE_NAME_MAX + 1),
];
const BAD_JOB_NAMES = [
  "",
  "in.fbx.cms.ContentPublished.v1",
  "Canary",
  "a:b",
  "a/b",
  "has space",
  "user@example.com",
  "1job",
  ".job",
  "j".repeat(QUEUE_JOB_NAME_MAX + 1),
];

describe("the QUEUE name rule (R1-D-266)", () => {
  it("every name the platform accepts, bullmq and pg-boss accept", () => {
    let seed = 11;
    const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2 ** 31), seed % n);
    const ALPHABET = "abz09_.-/:@ Zé";
    let accepted = 0;
    for (let i = 0; i < 20_000; i++) {
      let s = "abz"[rnd(3)]!;
      for (let j = rnd(110); j > 0; j--) s += ALPHABET[rnd(ALPHABET.length)];
      if (isQueueName(s)) {
        accepted++;
        expect(bullmqQueue(s) && pgBossName(s) && pgBossName(`${s}.dlq`), s).toBe(true);
      }
      if (isQueueJobName(s)) {
        accepted++;
        expect(bullmqSchedulerId(s) && pgBossName(s), s).toBe(true);
      }
    }
    expect(accepted).toBeGreaterThan(100);
    expect(isQueueName("q".repeat(QUEUE_NAME_MAX))).toBe(true);
    expect(isQueueJobName("j".repeat(QUEUE_JOB_NAME_MAX))).toBe(true);
  });

  it("refuses bad queue and job names with IPB-PORT-003 and a fixed reason", () => {
    for (const q of BAD_QUEUE_NAMES)
      expect(() => assertQueueName(q)).toThrowError(
        expect.objectContaining({ code: "IPB-PORT-003", meta: { reason: "queue_name" } }),
      );
    for (const name of BAD_JOB_NAMES)
      expect(() => assertQueueJob({ name, data: {} }, "bullmq")).toThrowError(
        expect.objectContaining({
          code: "IPB-PORT-003",
          adapter: "bullmq",
          meta: { reason: "job_name" },
        }),
      );
    expect(() => assertQueueJob({ name: "ok", data: { nested: { a: 1 } } as never })).toThrowError(
      expect.objectContaining({ meta: { reason: "job_data" } }),
    );
    expect(() =>
      assertQueueJob({ name: "in.fbx.cms.content-published.v1", data: {} }),
    ).not.toThrow();
    expect(() => assertQueueName("events")).not.toThrow();
  });
});
