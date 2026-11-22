// QUEUE name contract cases (IPB-01-15; Finbyx PR-FBX-53, R1-D-266). The platform's one queue and
// job name rule (`QUEUE_NAME_REGEX`, `QUEUE_JOB_NAME_REGEX` in `@infrabyx/contracts/ports`) is
// enforced before any I/O by both QUEUE adapters (bullmq, pg-boss) and must be by every in-memory
// fixture, so a fixture never accepts a name a real queue refuses. Run these cases on a product's
// own fixture with `defineContractSuite("QUEUE", () => fixture, queueNameCases())`.
import { expect } from "vitest";
import { QUEUE_JOB_NAME_MAX, QUEUE_NAME_MAX, type QueuePort } from "@infrabyx/contracts/ports";
import type { ContractCase } from "../contract.js";

/** Queue names every adapter and fixture refuses (`IPB-PORT-003`). */
export const QUEUE_BAD_QUEUE_NAMES: readonly string[] = Object.freeze([
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
]);

/** Job names every adapter and fixture refuses, among them a raw CloudEvents type. */
export const QUEUE_BAD_JOB_NAMES: readonly string[] = Object.freeze([
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
]);

/** A good queue name the cases enqueue to. */
const GOOD_QUEUE = "ipb-names_q";

async function refused(f: () => Promise<unknown>): Promise<void> {
  await expect(f()).rejects.toMatchObject({ code: "IPB-PORT-003" });
}

/** The name cases: every bad queue and job name refused by each method that takes one. */
export function queueNameCases<P extends QueuePort = QueuePort>(): Array<ContractCase<P>> {
  return [
    {
      name: "a bad queue name is refused by every method with IPB-PORT-003 (R1-D-266)",
      async run(p: P) {
        for (const q of QUEUE_BAD_QUEUE_NAMES) {
          await refused(() => p.enqueue(q, { name: "ok", data: {} }));
          await refused(() => p.schedule(q, "0 3 * * *", { name: "ok", data: {} }));
          await refused(() => p.consume(q, async () => {}));
          await refused(() => p.moveToDLQ(q, "job-1", "operator"));
          await refused(() => p.replay(q));
          await refused(() => p.stats(q));
        }
      },
    },
    {
      name: "a bad job name is refused on enqueue and schedule with IPB-PORT-003 (R1-D-266)",
      async run(p: P) {
        for (const name of QUEUE_BAD_JOB_NAMES) {
          await refused(() => p.enqueue(GOOD_QUEUE, { name, data: {} }));
          await refused(() => p.schedule(GOOD_QUEUE, "0 3 * * *", { name, data: {} }));
        }
        await refused(() =>
          p.enqueue(GOOD_QUEUE, { name: "ok", data: { nested: { a: 1 } } as never }),
        );
        expect((await p.stats(GOOD_QUEUE)).waiting).toBe(0);
      },
    },
  ];
}
