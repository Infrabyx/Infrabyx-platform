import { describe, expect, it } from "vitest";
import { NotificationClass } from "@infrabyx/contracts/ports";
import {
  assertContactWindow,
  assertPreferences,
  effectiveChannels,
  inQuietHours,
  isCollectionClass,
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

describe("@PL3-NTF-CONTACT-WINDOW collection messages inside the contact window (OWNER-QUESTIONS #23)", () => {
  const collection = (over: Record<string, unknown> = {}) =>
    cls({
      id: "loan.collection_reminder",
      category: "regulatory",
      resend: "hold",
      default_channels: ["sms", "email"],
      never_channels: ["whatsapp"],
      urgent: true,
      bypass_quiet_hours: true,
      ...over,
    });
  // 2026-10-27 in Asia/Kolkata (UTC+05:30).
  const ist = (hhmm: string) => new Date(`2026-10-27T${hhmm}:00+05:30`);

  it("recognises collection and recovery classes by id", () => {
    expect(isCollectionClass({ id: "loan.collection_reminder" })).toBe(true);
    expect(isCollectionClass({ id: "lending.recovery.notice" })).toBe(true);
    expect(isCollectionClass({ id: "inbox.mention" })).toBe(false);
  });

  it("never bypasses quiet hours: 22:15 waits for 08:00 even when the class and tenant allow bypass", () => {
    expect(timing(collection(), ist("22:15"), { orgAllowsBypass: true })).toEqual({
      mode: "after_quiet",
      at: new Date("2026-10-28T08:00:00+05:30"),
    });
    expect(timing(collection(), ist("14:00"), {})).toEqual({ mode: "now" });
  });

  it("applies a narrower product window, and waits for its start", () => {
    expect(timing(collection(), ist("08:30"), { contactWindow: "10:00-18:00" })).toEqual({
      mode: "after_quiet",
      at: ist("10:00"),
    });
    expect(timing(collection(), ist("18:30"), { contactWindow: "10:00-18:00" })).toEqual({
      mode: "after_quiet",
      at: new Date("2026-10-28T10:00:00+05:30"),
    });
  });

  it("refuses a window wider than 08:00-21:00 or one that wraps midnight", () => {
    for (const w of ["07:00-21:00", "08:00-22:00", "20:00-09:00", "8-21"])
      expect(() => assertContactWindow(w)).toThrow(/platform window/);
    expect(() => timing(collection(), ist("12:00"), { contactWindow: "07:30-20:00" })).toThrow();
    expect(() => assertContactWindow("09:00-19:00")).not.toThrow();
  });

  it("uses the recipient's time zone and a user's longer quiet hours", () => {
    // 03:00 UTC is 08:30 in Kolkata (inside) but 23:00 in New York (outside).
    const at = new Date("2026-10-27T03:00:00Z");
    expect(timing(collection(), at, { tz: "America/New_York" })).toEqual({
      mode: "after_quiet",
      at: new Date("2026-10-27T08:00:00-04:00"),
    });
    expect(timing(collection(), ist("08:30"), { quietHours: "20:00-09:00" })).toEqual({
      mode: "after_quiet",
      at: ist("09:00"),
    });
  });

  it("a non-urgent collection class keeps digest-first, moved into the window", () => {
    expect(
      timing(collection({ urgent: false }), ist("12:00"), { contactWindow: "10:00-18:00" }),
    ).toEqual({ mode: "digest", at: new Date("2026-10-28T10:00:00+05:30") });
  });
});
