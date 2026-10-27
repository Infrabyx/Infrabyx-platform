import { describe, expect, it } from "vitest";
import { NotificationClass } from "@infrabyx/contracts/ports";
import {
  assertPreferences,
  effectiveChannels,
  inQuietHours,
  nextWallTime,
  timing,
} from "./routing.js";

const cls = (over: Record<string, unknown> = {}) =>
  NotificationClass.parse({
    id: "inbox.mention",
    category: "transactional",
    resend: "safe",
    default_channels: ["inapp", "email"],
    help_key: "ntf.inbox.mention",
    deep_link: "/inbox",
    ...over,
  });

describe("channel routing (IPB-07-25)", () => {
  it("applies org routing, then user opt-outs; never-channels and marketing purpose always win", () => {
    expect(effectiveChannels(cls(), {}, {})).toEqual(["inapp", "email"]);
    expect(effectiveChannels(cls(), { "inbox.mention": ["email", "sms"] }, {})).toEqual([
      "email",
      "sms",
    ]);
    expect(effectiveChannels(cls(), {}, { "inbox.mention": { email: false } })).toEqual(["inapp"]);
    expect(
      effectiveChannels(cls({ never_channels: ["sms"] }), { "inbox.mention": ["sms", "inapp"] }),
    ).toEqual(["inapp"]);
    const m = cls({
      id: "mkt.offers",
      category: "marketing",
      marketing_purpose: "MARKETING_EMAIL",
      default_channels: ["email"],
    });
    expect(effectiveChannels(m, { "mkt.offers": ["email", "sms"] })).toEqual(["email"]);
  });
  it("a mandatory class keeps its channels; turning them all off is IPB-NTF-001", () => {
    const a = cls({ id: "approval.requested", category: "maker_checker", mandatory: true });
    expect(
      effectiveChannels(a, {}, { "approval.requested": { inapp: false, email: false } }),
    ).toEqual(["inapp", "email"]);
    expect(() =>
      assertPreferences([a], { "approval.requested": { inapp: false, email: false } }),
    ).toThrow(expect.objectContaining({ code: "IPB-NTF-001" }));
    expect(() => assertPreferences([a], { "approval.requested": { email: false } })).not.toThrow();
  });
});

describe("quiet hours and digest (A-07, R3-02)", () => {
  const ist = "Asia/Kolkata";
  it("@IPB-07-AT-22 a mention at 22:15 IST waits for the 08:30 digest; an approval request goes at once", () => {
    const at = new Date("2026-10-27T16:45:00Z"); // 22:15 IST
    expect(inQuietHours(at, ist)).toBe(true);
    expect(timing(cls(), at, { tz: ist })).toEqual({
      mode: "digest",
      at: new Date("2026-10-28T03:00:00Z"),
    });
    const approval = cls({
      id: "approval.requested",
      category: "maker_checker",
      mandatory: true,
      urgent: true,
      bypass_quiet_hours: true,
    });
    expect(timing(approval, at, { tz: ist })).toEqual({ mode: "now" });
    expect(timing(approval, at, { tz: ist, orgAllowsBypass: false })).toEqual({
      mode: "after_quiet",
      at: new Date("2026-10-28T02:30:00Z"),
    });
  });
  it("handles DST in non-Indian zones", () => {
    // Europe/London leaves summer time on 25 Oct 2026: 08:30 local is 07:30Z before and 08:30Z after.
    expect(nextWallTime(new Date("2026-10-24T20:00:00Z"), "Europe/London", "08:30")).toEqual(
      new Date("2026-10-25T08:30:00Z"),
    );
    expect(nextWallTime(new Date("2026-10-23T20:00:00Z"), "Europe/London", "08:30")).toEqual(
      new Date("2026-10-24T07:30:00Z"),
    );
    // America/New_York enters DST on 8 Mar 2026.
    expect(nextWallTime(new Date("2026-03-08T01:00:00Z"), "America/New_York", "08:30")).toEqual(
      new Date("2026-03-08T12:30:00Z"),
    );
    expect(inQuietHours(new Date("2026-07-01T02:00:00Z"), "America/New_York")).toBe(true); // 22:00 EDT
  });
});
