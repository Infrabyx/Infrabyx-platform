// The in-process QUEUE fixture refuses the same names as bullmq and pg-boss (Finbyx PR-FBX-53;
// R1-D-266): the shared name cases from `@infrabyx/testing`, which the adapters' hermetic legs run.
import { describe, expect, it } from "vitest";
import { defineContractSuite, queueNameCases } from "@infrabyx/testing";
import { MemoryQueue } from "./fixtures.js";

describe("MemoryQueue", () => {
  defineContractSuite("QUEUE", () => new MemoryQueue(), queueNameCases(), { leg: "unit" });

  it("refuses a raw CloudEvents type as a job name, as the real queues do", async () => {
    const q = new MemoryQueue();
    await expect(
      q.enqueue("events", { name: "in.fbx.cms.ContentPublished.v1", data: {} }),
    ).rejects.toMatchObject({ code: "IPB-PORT-003", meta: { reason: "job_name" } });
    expect(q.jobs).toHaveLength(0);
    await q.enqueue("events", { name: "in.fbx.cms.content-published.v1", data: {} });
    expect(q.jobs).toHaveLength(1);
  });
});
