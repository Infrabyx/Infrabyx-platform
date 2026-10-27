import { describe, expect, it } from "vitest";
import { parseTimerId, timerId } from "./timers.js";

describe("timer ids", () => {
  it("round-trip and refuse anything else", () => {
    const id = timerId("tnt_a", "approval.remind", "apr_01M5XQT0PRXMKBEGFFSHNHTA61");
    expect(id).toBe("ipb-timer.tnt_a.approval.remind.apr_01M5XQT0PRXMKBEGFFSHNHTA61");
    expect(parseTimerId(id)).toEqual({
      tenantId: "tnt_a",
      kind: "approval.remind",
      ref: "apr_01M5XQT0PRXMKBEGFFSHNHTA61",
    });
    for (const bad of [
      "ipb-timer.tnt_a.approval.drop.apr_01M5XQT0PRXMKBEGFFSHNHTA61",
      "ipb-timer.tnt_a.approval.remind.usr_01M5XQT0PRXMKBEGFFSHNHTA61",
      "other",
    ])
      expect(() => parseTimerId(bad), bad).toThrow();
  });
});
