// Schedule recurrence (IPB-03-64, 03-66; PL4 plan §8.6, A-18). A small in-house RFC 5545 expander
// for the subset scheduled tasks need, evaluated in the schedule's IANA zone:
//   DTSTART;TZID=<zone>:YYYYMMDDTHHMMSS
//   RRULE:FREQ=DAILY|WEEKLY|MONTHLY;INTERVAL;BYDAY;BYHOUR;BYMINUTE;BYMONTHDAY;COUNT;UNTIL
//   EXDATE;TZID=<zone>:YYYYMMDDTHHMMSS[,…]
// Anything else (YEARLY, HOURLY, BYSETPOS, ordinal BYDAY, RDATE, …) is refused when the schedule is
// saved, as is a DTSTART that is not itself an occurrence and a rule that fires more than 24 times
// a day. DST follows RFC 5545 §3.3.5: a local time in a spring-forward gap moves forward by the
// gap; an ambiguous fall-back time is the first (earlier) instant.

export const WEEKDAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export interface LocalDateTime {
  y: number;
  m: number;
  d: number;
  h: number;
  mi: number;
  s: number;
}

export interface Recurrence {
  tzid: string;
  dtstart: LocalDateTime;
  freq: "DAILY" | "WEEKLY" | "MONTHLY";
  interval: number;
  byDay: Weekday[] | null;
  byHour: number[] | null;
  byMinute: number[] | null;
  byMonthDay: number[] | null;
  count: number | null;
  until: Date | null;
  exdates: ReadonlySet<number>;
}

export class RecurrenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecurrenceError";
  }
}

const MAX_PER_DAY = 24;
/** Periods scanned before giving up (about 27 years of days). */
const MAX_PERIODS = 10_000;
const DAY_MS = 86_400_000;

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    fmtCache.set(tz, f);
  }
  return f;
}

export function isValidZone(tz: string): boolean {
  try {
    formatter(tz);
    return true;
  } catch {
    return false;
  }
}

/** The zone's offset from UTC at instant `utcMs`, in milliseconds. */
function offsetAt(tz: string, utcMs: number): number {
  const p: Record<string, number> = {};
  for (const x of formatter(tz).formatToParts(new Date(utcMs)))
    if (x.type !== "literal") p[x.type] = Number(x.value);
  const local = Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!, p.second!);
  return local - Math.floor(utcMs / 1000) * 1000;
}

/** A wall-clock time in `tz` as a UTC instant (RFC 5545 §3.3.5 for gaps and overlaps). */
export function localToUtc(tz: string, l: LocalDateTime): Date {
  const wall = Date.UTC(l.y, l.m - 1, l.d, l.h, l.mi, l.s);
  const before = offsetAt(tz, wall - DAY_MS);
  const after = offsetAt(tz, wall + DAY_MS);
  const valid = [...new Set([before, after])]
    .map((o) => wall - o)
    .filter((u) => offsetAt(tz, u) === wall - u)
    .sort((a, b) => a - b);
  // Gap: the time does not exist; use the offset before the gap, which moves it forward.
  return new Date(valid[0] ?? wall - before);
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

function parseLocal(v: string, what: string): LocalDateTime {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/.exec(v);
  if (!m) throw new RecurrenceError(`${what} must be a local date-time YYYYMMDDTHHMMSS`);
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const t = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  if (
    t.getUTCFullYear() !== y ||
    t.getUTCMonth() !== mo - 1 ||
    t.getUTCDate() !== d ||
    h > 23 ||
    mi > 59 ||
    s > 59
  )
    throw new RecurrenceError(`${what} ${v} is not a valid date-time`);
  return { y, m: mo, d, h, mi, s };
}

function intList(v: string, what: string, lo: number, hi: number, allowNeg = false): number[] {
  const out = v.split(",").map((x) => {
    if (!/^-?\d{1,2}$/.test(x)) throw new RecurrenceError(`${what} has an invalid value ${x}`);
    const n = Number(x);
    const ok = (n >= lo && n <= hi) || (allowNeg && n <= -1 && n >= -hi);
    if (!ok) throw new RecurrenceError(`${what} value ${x} is out of range`);
    return n;
  });
  return [...new Set(out)].sort((a, b) => a - b);
}

/** Parse and validate a schedule's recurrence text. Throws `RecurrenceError` for anything else. */
export function parseRecurrence(text: string): Recurrence {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  let tzid: string | null = null;
  let dtstart: LocalDateTime | null = null;
  let rule: string | null = null;
  const exLocal: LocalDateTime[] = [];
  for (const line of lines) {
    const ds = /^DTSTART;TZID=([A-Za-z0-9_+\-/]+):(\S+)$/.exec(line);
    const ex = /^EXDATE;TZID=([A-Za-z0-9_+\-/]+):(\S+)$/.exec(line);
    if (ds) {
      if (dtstart) throw new RecurrenceError("DTSTART is given twice");
      tzid = ds[1]!;
      dtstart = parseLocal(ds[2]!, "DTSTART");
    } else if (line.startsWith("RRULE:")) {
      if (rule) throw new RecurrenceError("only one RRULE is supported");
      rule = line.slice(6);
    } else if (ex) {
      if (tzid && ex[1] !== tzid) throw new RecurrenceError("EXDATE must use the DTSTART zone");
      for (const v of ex[2]!.split(",")) exLocal.push(parseLocal(v, "EXDATE"));
    } else {
      throw new RecurrenceError(
        `unsupported line "${line.split(/[:;]/)[0]}" (DTSTART;TZID, RRULE and EXDATE;TZID only)`,
      );
    }
  }
  if (!dtstart || !tzid) throw new RecurrenceError("DTSTART;TZID=<zone>:… is required");
  if (!isValidZone(tzid)) throw new RecurrenceError(`unknown time zone ${tzid}`);
  if (!rule) throw new RecurrenceError("RRULE is required");

  const parts = new Map<string, string>();
  for (const p of rule.split(";")) {
    const [k, v] = p.split("=");
    if (!k || v === undefined || v === "") throw new RecurrenceError(`malformed RRULE part ${p}`);
    if (parts.has(k)) throw new RecurrenceError(`${k} is given twice`);
    parts.set(k, v);
  }
  const allowed = new Set([
    "FREQ",
    "INTERVAL",
    "BYDAY",
    "BYHOUR",
    "BYMINUTE",
    "BYMONTHDAY",
    "COUNT",
    "UNTIL",
    "WKST",
  ]);
  for (const k of parts.keys())
    if (!allowed.has(k)) throw new RecurrenceError(`RRULE part ${k} is not supported`);
  const freq = parts.get("FREQ");
  if (freq !== "DAILY" && freq !== "WEEKLY" && freq !== "MONTHLY")
    throw new RecurrenceError(`FREQ=${freq ?? "?"} is not supported (DAILY, WEEKLY or MONTHLY)`);
  if (parts.has("WKST") && parts.get("WKST") !== "MO")
    throw new RecurrenceError("only WKST=MO is supported");
  const interval = parts.has("INTERVAL") ? Number(parts.get("INTERVAL")) : 1;
  if (!Number.isInteger(interval) || interval < 1 || interval > 366)
    throw new RecurrenceError("INTERVAL must be 1 to 366");
  let byDay: Weekday[] | null = null;
  if (parts.has("BYDAY")) {
    byDay = parts
      .get("BYDAY")!
      .split(",")
      .map((x) => {
        if (!(WEEKDAYS as readonly string[]).includes(x))
          throw new RecurrenceError(`BYDAY ${x} is not supported (plain weekdays only)`);
        return x as Weekday;
      });
    byDay = [...new Set(byDay)];
  }
  const byHour = parts.has("BYHOUR") ? intList(parts.get("BYHOUR")!, "BYHOUR", 0, 23) : null;
  const byMinute = parts.has("BYMINUTE")
    ? intList(parts.get("BYMINUTE")!, "BYMINUTE", 0, 59)
    : null;
  const byMonthDay = parts.has("BYMONTHDAY")
    ? intList(parts.get("BYMONTHDAY")!, "BYMONTHDAY", 1, 31, true)
    : null;
  if (byMonthDay && freq === "WEEKLY")
    throw new RecurrenceError("BYMONTHDAY is not supported with FREQ=WEEKLY");
  if ((byHour?.length ?? 1) * (byMinute?.length ?? 1) > MAX_PER_DAY)
    throw new RecurrenceError(`a schedule may run at most ${MAX_PER_DAY} times a day`);
  if (parts.has("COUNT") && parts.has("UNTIL"))
    throw new RecurrenceError("COUNT and UNTIL cannot both be given");
  let count: number | null = null;
  if (parts.has("COUNT")) {
    count = Number(parts.get("COUNT"));
    if (!Number.isInteger(count) || count < 1 || count > 10_000)
      throw new RecurrenceError("COUNT must be 1 to 10000");
  }
  let until: Date | null = null;
  if (parts.has("UNTIL")) {
    const u = parts.get("UNTIL")!;
    const z = /^(\d{8}T\d{6})Z$/.exec(u);
    const day = /^(\d{8})$/.exec(u);
    if (z) {
      const l = parseLocal(z[1]!, "UNTIL");
      until = new Date(Date.UTC(l.y, l.m - 1, l.d, l.h, l.mi, l.s));
    } else if (day) {
      until = localToUtc(tzid, { ...parseLocal(`${day[1]}T235959`, "UNTIL") });
    } else throw new RecurrenceError("UNTIL must be YYYYMMDDTHHMMSSZ (UTC) or YYYYMMDD");
  }
  const rec: Recurrence = {
    tzid,
    dtstart,
    freq,
    interval,
    byDay,
    byHour,
    byMinute,
    byMonthDay,
    count,
    until,
    exdates: new Set(exLocal.map((l) => localToUtc(tzid, l).getTime())),
  };
  const first = occurrences(rec).next();
  const start = localToUtc(tzid, dtstart).getTime();
  if (first.done || first.value.getTime() !== start)
    throw new RecurrenceError("DTSTART must itself be an occurrence of the rule");
  return rec;
}

const weekday = (y: number, m: number, d: number): Weekday =>
  WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]!;
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const addDays = (y: number, m: number, d: number, n: number) => {
  const t = new Date(Date.UTC(y, m - 1, d) + n * DAY_MS);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
};

/** Candidate local dates of the period starting at period index `p`, in order. */
function periodDays(r: Recurrence, p: number): { y: number; m: number; d: number }[] {
  const s = r.dtstart;
  const keep = (x: { y: number; m: number; d: number }) =>
    (!r.byDay || r.byDay.includes(weekday(x.y, x.m, x.d))) &&
    (!r.byMonthDay ||
      r.byMonthDay.some((n) => (n > 0 ? n : daysInMonth(x.y, x.m) + n + 1) === x.d));
  if (r.freq === "DAILY") {
    const x = addDays(s.y, s.m, s.d, p * r.interval);
    return keep(x) ? [x] : [];
  }
  if (r.freq === "WEEKLY") {
    // Weeks start on Monday (WKST=MO).
    const back = (new Date(Date.UTC(s.y, s.m - 1, s.d)).getUTCDay() + 6) % 7;
    const out = [];
    for (let i = 0; i < 7; i++) {
      const x = addDays(s.y, s.m, s.d, p * r.interval * 7 - back + i);
      const days = r.byDay ?? [weekday(s.y, s.m, s.d)];
      if (days.includes(weekday(x.y, x.m, x.d))) out.push(x);
    }
    return out;
  }
  const mIndex = s.m - 1 + p * r.interval;
  const y = s.y + Math.floor(mIndex / 12);
  const m = (mIndex % 12) + 1;
  const out = [];
  for (let d = 1; d <= daysInMonth(y, m); d++) {
    const x = { y, m, d };
    if (r.byMonthDay || r.byDay ? keep(x) : d === s.d) out.push(x);
  }
  return out;
}

/** Every occurrence from DTSTART, in order, before EXDATE removal (COUNT counts these). */
function* occurrences(r: Recurrence, fromMs?: number): Generator<Date> {
  const start = localToUtc(r.tzid, r.dtstart).getTime();
  const hours = r.byHour ?? [r.dtstart.h];
  const minutes = r.byMinute ?? [r.dtstart.mi];
  let n = 0;
  // Without COUNT nothing before `fromMs` matters, so skip whole periods (one period of slack for
  // DST and month lengths).
  let p0 = 0;
  if (r.count === null && fromMs !== undefined && fromMs > start) {
    const days = (fromMs - start) / DAY_MS;
    // A month is counted as 31 days, so the estimate never passes the period holding `fromMs`.
    const per = (r.freq === "DAILY" ? 1 : r.freq === "WEEKLY" ? 7 : 31) * r.interval;
    p0 = Math.max(0, Math.floor(days / per) - 1);
  }
  for (let p = p0; p < p0 + MAX_PERIODS; p++) {
    for (const day of periodDays(r, p))
      for (const h of hours)
        for (const mi of minutes) {
          const t = localToUtc(r.tzid, { ...day, h, mi, s: r.dtstart.s });
          if (t.getTime() < start) continue;
          if (r.until && t.getTime() > r.until.getTime()) return;
          if (r.count !== null && n >= r.count) return;
          n++;
          yield t;
        }
  }
}

/** The first occurrence strictly after `after`, or null when the recurrence has ended. */
export function nextOccurrence(r: Recurrence, after: Date): Date | null {
  for (const t of occurrences(r, after.getTime()))
    if (t.getTime() > after.getTime() && !r.exdates.has(t.getTime())) return t;
  return null;
}

/** The next `n` occurrences after `after` (for previews in the schedule editor). */
export function nextOccurrences(r: Recurrence, after: Date, n: number): Date[] {
  const out: Date[] = [];
  let t: Date | null = after;
  while (out.length < n && (t = nextOccurrence(r, t))) out.push(t);
  return out;
}

/** Format a UTC instant as the zone's wall clock, `YYYY-MM-DD HH:MM` (for notices and tests). */
export function wallClock(tz: string, t: Date): string {
  const l = new Date(t.getTime() + offsetAt(tz, t.getTime()));
  return `${l.getUTCFullYear()}-${pad(l.getUTCMonth() + 1)}-${pad(l.getUTCDate())} ${pad(
    l.getUTCHours(),
  )}:${pad(l.getUTCMinutes())}`;
}
