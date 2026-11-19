// The inbox snooze bound and list options, checked before any database call (PR-LDC-46, R1-D-206).
import { describe, expect, it } from "vitest";
import type { AuditSink, KernelContext, MutationKernel } from "@infrabyx/contracts/kernel";
import { assertSnoozeUntil, InboxService, INBOX_ORDERS, INBOX_SNOOZE_MAX_DAYS } from "./inbox.js";

const DAY = 86_400_000;
const now = Date.UTC(2026, 10, 19, 10);
let calls = 0;
const kernel = {
  mutate: async () => {
    calls += 1;
    throw new Error("no database in a unit test");
  },
  read: async () => {
    calls += 1;
    throw new Error("no database in a unit test");
  },
} as unknown as MutationKernel;
const inbox = new InboxService({ kernel, audit: {} as AuditSink, product: "LDC" });
const ctx = {
  tenantId: "tnt_a",
  principal: { id: "usr_a", roles: [] },
} as unknown as KernelContext;

describe("assertSnoozeUntil (PR-LDC-46)", () => {
  it("takes a valid Date ahead, at most 30 days", () => {
    expect(INBOX_SNOOZE_MAX_DAYS).toBe(30);
    expect(() => assertSnoozeUntil(new Date(now + 60_000), now)).not.toThrow();
    expect(() => assertSnoozeUntil(new Date(now + 30 * DAY), now)).not.toThrow();
    for (const bad of [
      new Date(now),
      new Date(now - 1),
      new Date(now + 30 * DAY + 1),
      new Date(Number.NaN),
      "2026-11-20T00:00:00Z",
      now + DAY,
      null,
    ])
      expect(() => assertSnoozeUntil(bad, now)).toThrow(RangeError);
  });

  it("refuses before the kernel is called", async () => {
    calls = 0;
    await expect(inbox.snooze(ctx, "ibx_x", new Date(Date.now() - 1))).rejects.toThrow(RangeError);
    await expect(inbox.list(ctx, { orderBy: "oldest" as never })).rejects.toThrow(RangeError);
    await expect(inbox.list(ctx, { snoozed: "hidden" as never })).rejects.toThrow(RangeError);
    expect(calls).toBe(0);
    expect(INBOX_ORDERS).toEqual(["newest", "due", "severity"]);
  });
});
