// ACCOUNTING (PR-FBX-46, R1-D-122) and CALENDAR (PR-LDC-53, R1-D-126): the checks every adapter
// runs before a call.
import { describe, expect, it } from "vitest";
import { assertBalancedBatch, type JournalBatch } from "./accounting.js";
import {
  CALENDAR_OAUTH_CALLBACK_PATH,
  CalendarEntry,
  calendarPayload,
  isCalendarRedirectUri,
} from "./calendar.js";
import { PORT_CATALOGUE } from "./catalogue.js";

const batch = (): JournalBatch => ({
  journalId: "jrn-0000001",
  initiatedBy: { type: "service", id: "svc_posting" },
  entries: [
    {
      voucherType: "Journal",
      date: "2026-11-02",
      reference: "JV-1",
      lines: [
        { ledger: "Loans", side: "debit", amountPaise: 100 },
        { ledger: "Fees", side: "debit", amountPaise: 50 },
        { ledger: "Bank", side: "credit", amountPaise: 150 },
      ],
    },
  ],
});
const code = (f: () => unknown) => {
  try {
    f();
    return null;
  } catch (e) {
    return (e as { code?: string }).code ?? "error";
  }
};

describe("ACCOUNTING: assertBalancedBatch", () => {
  it("passes a balanced batch and refuses everything else before a call", () => {
    expect(assertBalancedBatch("ACCOUNTING", batch()).entries[0]!.lines).toHaveLength(3);
    const off = batch();
    off.entries[0]!.lines[2]!.amountPaise = 149;
    expect(code(() => assertBalancedBatch("ACCOUNTING", off))).toBe("IPB-UX-004");
    const date = batch();
    date.entries[0]!.date = "2026-02-30";
    expect(code(() => assertBalancedBatch("ACCOUNTING", date))).toBe("IPB-UX-004");
    const neg = batch();
    neg.entries[0]!.lines[0]!.amountPaise = -100;
    expect(code(() => assertBalancedBatch("ACCOUNTING", neg))).toBe("IPB-UX-004");
    const ctl = batch();
    ctl.entries[0]!.lines[0]!.ledger = "Loans\nx";
    expect(code(() => assertBalancedBatch("ACCOUNTING", ctl))).toBe("IPB-UX-004");
    const extra = { ...batch(), approve: true };
    expect(code(() => assertBalancedBatch("ACCOUNTING", extra))).toBe("IPB-UX-004");
    const agent = { ...batch(), initiatedBy: { type: "agent", id: "agt_vidhi" } };
    expect(code(() => assertBalancedBatch("ACCOUNTING", agent))).toBe("IPB-SEC-004");
    expect(PORT_CATALOGUE.ACCOUNTING.interfaceDefined).toBe(true);
  });
});

describe("CALENDAR: redirect URIs and detail levels", () => {
  it("accepts only the fixed callback path on https (or http on localhost)", () => {
    const path = CALENDAR_OAUTH_CALLBACK_PATH.replace("{provider}", "google");
    expect(isCalendarRedirectUri(`https://console.example.test${path}`, "google")).toBe(true);
    expect(isCalendarRedirectUri(`http://localhost:3000${path}`, "google")).toBe(true);
    for (const u of [
      `http://console.example.test${path}`,
      `https://console.example.test${path}?a=1`,
      `https://console.example.test${path}#x`,
      `https://user:pw@console.example.test${path}`,
      `https://console.example.test${path}/`,
      "not a url",
    ])
      expect(isCalendarRedirectUri(u, "google"), u).toBe(false);
    expect(isCalendarRedirectUri(`https://console.example.test${path}`, "microsoft365")).toBe(
      false,
    );
    expect(PORT_CATALOGUE.CALENDAR.interfaceDefined).toBe(true);
  });

  it("sends the title only at title or full, and the description and location only at full", () => {
    const e = CalendarEntry.parse({
      externalId: "hearing-00000001",
      detail: "busy",
      title: "Matter 1",
      startDate: "2026-12-01",
      endDate: "2026-12-02",
      timeZone: "Asia/Kolkata",
      description: "secret",
      location: "Room 4",
      writtenBy: { type: "user", id: "usr_one" },
    });
    expect(calendarPayload(e)).toEqual({
      title: "Busy",
      startDate: "2026-12-01",
      endDate: "2026-12-02",
      timeZone: "Asia/Kolkata",
    });
    expect(calendarPayload({ ...e, detail: "title" })).not.toHaveProperty("description");
    expect(calendarPayload({ ...e, detail: "full" })).toMatchObject({
      title: "Matter 1",
      description: "secret",
      location: "Room 4",
    });
  });
});
