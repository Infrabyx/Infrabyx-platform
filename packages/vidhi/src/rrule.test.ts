// The in-house RRULE subset (PL4 plan §8.6, A-18), including DST behaviour in zones that have it.
import { describe, expect, it } from "vitest";
import { nextOccurrence, nextOccurrences, parseRecurrence, wallClock } from "./rrule.js";

const rec = (dtstart: string, rule: string, tz = "Asia/Kolkata", extra: string[] = []) =>
  parseRecurrence([`DTSTART;TZID=${tz}:${dtstart}`, `RRULE:${rule}`, ...extra].join("\n"));
const iso = (ds: Date[]) => ds.map((d) => d.toISOString().slice(0, 16));
const justBefore = (r: ReturnType<typeof parseRecurrence>) =>
  new Date(
    Date.UTC(r.dtstart.y, r.dtstart.m - 1, r.dtstart.d, r.dtstart.h, r.dtstart.mi) - 86_400_000,
  );

describe("RRULE subset", () => {
  it("weekly on chosen days in India Standard Time", () => {
    const r = rec("20261102T090000", "FREQ=WEEKLY;BYDAY=MO,WE");
    expect(iso(nextOccurrences(r, justBefore(r), 4))).toEqual([
      "2026-11-02T03:30",
      "2026-11-04T03:30",
      "2026-11-09T03:30",
      "2026-11-11T03:30",
    ]);
  });

  it("moves a time in the spring-forward gap forward by the gap (New York, 8 Mar 2026)", () => {
    const r = rec("20260306T023000", "FREQ=DAILY", "America/New_York");
    expect(iso(nextOccurrences(r, justBefore(r), 4))).toEqual([
      "2026-03-06T07:30",
      "2026-03-07T07:30",
      "2026-03-08T07:30", // 02:30 does not exist; 03:30 EDT
      "2026-03-09T06:30",
    ]);
  });

  it("takes the first instant of an ambiguous fall-back time (New York, 1 Nov 2026)", () => {
    const r = rec("20261031T013000", "FREQ=DAILY;COUNT=3", "America/New_York");
    expect(iso(nextOccurrences(r, justBefore(r), 5))).toEqual([
      "2026-10-31T05:30",
      "2026-11-01T05:30", // 01:30 EDT, not 01:30 EST
      "2026-11-02T06:30",
    ]);
  });

  it("keeps the wall-clock time across DST in London", () => {
    const r = rec("20260323T090000", "FREQ=WEEKLY", "Europe/London");
    const ds = nextOccurrences(r, justBefore(r), 3);
    expect(ds.map((d) => wallClock("Europe/London", d))).toEqual([
      "2026-03-23 09:00",
      "2026-03-30 09:00",
      "2026-04-06 09:00",
    ]);
    expect(iso(ds)).toEqual(["2026-03-23T09:00", "2026-03-30T08:00", "2026-04-06T08:00"]);
  });

  it("monthly on the last day, and skips months without the start day", () => {
    const last = rec("20260131T180000", "FREQ=MONTHLY;BYMONTHDAY=-1");
    expect(
      nextOccurrences(last, justBefore(last), 4).map((d) => wallClock("Asia/Kolkata", d)),
    ).toEqual(["2026-01-31 18:00", "2026-02-28 18:00", "2026-03-31 18:00", "2026-04-30 18:00"]);
    const d31 = rec("20260131T180000", "FREQ=MONTHLY");
    expect(
      nextOccurrences(d31, justBefore(d31), 3).map((d) => wallClock("Asia/Kolkata", d)),
    ).toEqual(["2026-01-31 18:00", "2026-03-31 18:00", "2026-05-31 18:00"]);
  });

  it("BYHOUR and BYMINUTE expand within the day; INTERVAL skips periods", () => {
    const r = rec("20261102T090000", "FREQ=DAILY;INTERVAL=2;BYHOUR=9,17;BYMINUTE=0,30");
    expect(nextOccurrences(r, justBefore(r), 6).map((d) => wallClock("Asia/Kolkata", d))).toEqual([
      "2026-11-02 09:00",
      "2026-11-02 09:30",
      "2026-11-02 17:00",
      "2026-11-02 17:30",
      "2026-11-04 09:00",
      "2026-11-04 09:30",
    ]);
  });

  it("COUNT counts before EXDATE removes an occurrence; UNTIL is inclusive", () => {
    const r = rec("20261102T090000", "FREQ=DAILY;COUNT=3", "Asia/Kolkata", [
      "EXDATE;TZID=Asia/Kolkata:20261103T090000",
    ]);
    expect(nextOccurrences(r, justBefore(r), 5).map((d) => wallClock("Asia/Kolkata", d))).toEqual([
      "2026-11-02 09:00",
      "2026-11-04 09:00",
    ]);
    const u = rec("20261102T090000", "FREQ=DAILY;UNTIL=20261104");
    expect(nextOccurrences(u, justBefore(u), 5)).toHaveLength(3);
    expect(nextOccurrence(u, new Date("2026-11-04T04:00:00Z"))).toBeNull();
  });

  it("finds the next run years later without walking from DTSTART", () => {
    const r = rec("20260115T100000", "FREQ=MONTHLY;BYMONTHDAY=15");
    expect(wallClock("Asia/Kolkata", nextOccurrence(r, new Date("2045-06-20T00:00:00Z"))!)).toBe(
      "2045-07-15 10:00",
    );
    const w = rec("20261102T090000", "FREQ=WEEKLY;INTERVAL=3;BYDAY=MO");
    // 2036-01-07 is 479 weeks after 2026-11-02, not a multiple of three; 2036-01-14 is 480.
    expect(wallClock("Asia/Kolkata", nextOccurrence(w, new Date("2036-01-01T00:00:00Z"))!)).toBe(
      "2036-01-14 09:00",
    );
  });

  it.each([
    ["FREQ=HOURLY", "FREQ=HOURLY"],
    ["FREQ=DAILY;BYSETPOS=1", "BYSETPOS"],
    ["FREQ=MONTHLY;BYDAY=1MO", "BYDAY 1MO"],
    ["FREQ=WEEKLY;BYDAY=TU", "DTSTART must itself be an occurrence"],
    ["FREQ=DAILY;BYHOUR=0,1,2,3,4,5,6,7,8,9,10,11,12,13;BYMINUTE=0,30", "at most 24"],
    ["FREQ=DAILY;COUNT=2;UNTIL=20261231", "COUNT and UNTIL"],
    ["FREQ=DAILY;WKST=SU", "WKST=MO"],
    ["FREQ=WEEKLY;BYMONTHDAY=1", "BYMONTHDAY"],
  ])("refuses %s", (rule, msg) => {
    expect(() => rec("20261102T090000", rule)).toThrow(msg);
  });

  it("refuses missing zones, unknown zones and other properties", () => {
    expect(() => parseRecurrence("DTSTART:20261102T090000\nRRULE:FREQ=DAILY")).toThrow(
      "unsupported line",
    );
    expect(() => rec("20261102T090000", "FREQ=DAILY", "Mars/Olympus")).toThrow("unknown time zone");
    expect(() =>
      parseRecurrence(
        "DTSTART;TZID=Asia/Kolkata:20261102T090000\nRRULE:FREQ=DAILY\nRDATE:20261110T090000",
      ),
    ).toThrow("unsupported line");
    expect(() => rec("20261302T090000", "FREQ=DAILY")).toThrow("not a valid date-time");
  });
});
