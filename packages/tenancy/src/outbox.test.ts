// The relay's job mapping and failure labels (Finbyx PR-FBX-53; R1-D-266), without a database.
import { describe, expect, it } from "vitest";
import { IpbError, PortError } from "@infrabyx/contracts/errors";
import { eventTypeOfJobName } from "@infrabyx/contracts/events";
import type { AuditSink, MutationKernel } from "@infrabyx/contracts/kernel";
import { isQueueJobName } from "@infrabyx/contracts/ports";
import {
  DEFAULT_OUTBOX_MAX_ATTEMPTS,
  OUTBOX_PARK_REASONS,
  OutboxParking,
  OutboxRelay,
  outboxEventJob,
  outboxFailureReason,
} from "./outbox.js";

const kernel = {} as MutationKernel;
const audit = {} as AuditSink;

describe("outboxEventJob", () => {
  it("names the job by eventJobName and keeps the full type and envelope in the data", () => {
    const job = outboxEventJob({
      id: "01JA0000000000000000000000",
      tenant_id: "tnt_a",
      type: "in.fbx.cms.ContentPublished.v1",
      envelope: { id: "01JA0000000000000000000000", data: { a: 1 } },
    });
    expect(job).toEqual({
      name: "in.fbx.cms.content-published.v1",
      data: {
        event_id: "01JA0000000000000000000000",
        tenant_id: "tnt_a",
        type: "in.fbx.cms.ContentPublished.v1",
        envelope: '{"id":"01JA0000000000000000000000","data":{"a":1}}',
      },
    });
    expect(isQueueJobName(job.name)).toBe(true);
    expect(eventTypeOfJobName(job.name)).toBe(job.data.type);
  });

  it("refuses a type with no job name (IPB-PORT-003), which the relay parks as queue_refused", () => {
    let thrown: unknown;
    try {
      outboxEventJob({ id: "e", tenant_id: "t", type: "Not.A.Type", envelope: {} });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toMatchObject({ code: "IPB-PORT-003", meta: { reason: "not_event_type" } });
    expect(outboxFailureReason(thrown)).toBe("queue_refused");
  });
});

describe("outboxFailureReason", () => {
  it("maps every failure to one of the fixed labels", () => {
    expect(outboxFailureReason(new PortError("IPB-PORT-003", "QUEUE"))).toBe("queue_refused");
    expect(outboxFailureReason(new PortError("IPB-PORT-002", "QUEUE"))).toBe("queue_unavailable");
    expect(outboxFailureReason(new IpbError("IPB-SEC-005"))).toBe("delivery_failed");
    expect(outboxFailureReason(new Error("boom: user@example.com"))).toBe("delivery_failed");
    expect(outboxFailureReason(null)).toBe("delivery_failed");
    expect(outboxFailureReason("text")).toBe("delivery_failed");
    expect([...OUTBOX_PARK_REASONS]).toEqual([
      "queue_refused",
      "queue_unavailable",
      "delivery_failed",
    ]);
  });
});

describe("OutboxRelay and OutboxParking options", () => {
  it("bounds maxAttempts (default 5) and checks schema names", async () => {
    const deliver = async () => {};
    expect(DEFAULT_OUTBOX_MAX_ATTEMPTS).toBe(5);
    expect(() => new OutboxRelay({ kernel, audit, deliver })).not.toThrow();
    for (const maxAttempts of [0, -1, 1.5, 101, Number.NaN])
      expect(() => new OutboxRelay({ kernel, audit, deliver, maxAttempts })).toThrow(RangeError);
    expect(() => new OutboxRelay({ kernel, audit, deliver, schemas: ["Bad;"] })).toThrow();
    const parking = new OutboxParking({ kernel, audit });
    const ctx = { tenantId: "tnt_a", principal: { id: "u", type: "user" as const, roles: [] } };
    await expect(parking.list(ctx, { limit: 0 })).rejects.toThrow(RangeError);
    await expect(parking.list(ctx, { schema: "x;y" })).rejects.toThrow();
    await expect(parking.requeue(ctx, "relay_p", "e")).rejects.toMatchObject({
      code: "IPB-SEC-005",
    });
  });
});
