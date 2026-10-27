// Channel routing, quiet hours and digest time (IPB-07-25, PL3 plan §6.3, A-07). Pure functions:
// time is always passed in, and wall-clock times are computed with Intl in the recipient's zone,
// so DST edges in non-Indian zones behave (R3-02).
import { IpbError } from "@infrabyx/contracts/errors";
import {
  MARKETING_PURPOSE_CHANNEL,
  NOTIFY_CHANNELS,
  type ChannelMatrix,
  type NotificationClass,
  type NotifyChannel,
} from "@infrabyx/contracts/ports";

export const DEFAULT_TIMEZONE = "Asia/Kolkata";
export const DEFAULT_QUIET_HOURS = "21:00-08:00";
export const DEFAULT_DIGEST_TIME = "08:30";

const isChannel = (c: unknown): c is NotifyChannel =>
  (NOTIFY_CHANNELS as readonly unknown[]).includes(c);

/**
 * Catalogue defaults → `ntf.org.routing` (per class: a channel list) → `ntf.user.channels` (per
 * class: channel on/off). A user may only turn channels off; never-channels and a marketing
 * purpose's single channel always apply; a mandatory class keeps its routed channels if the user
 * turned them all off.
 */
export function effectiveChannels(
  cls: NotificationClass,
  orgRouting: Readonly<Record<string, unknown>> = {},
  userPrefs: ChannelMatrix = {},
): NotifyChannel[] {
  const routed = orgRouting[cls.id];
  let base = Array.isArray(routed) ? routed.filter(isChannel) : [...cls.default_channels];
  if (base.length === 0) base = [...cls.default_channels];
  base = base.filter((c) => !cls.never_channels.includes(c));
  if (cls.category === "marketing") {
    const only = cls.marketing_purpose
      ? MARKETING_PURPOSE_CHANNEL[cls.marketing_purpose]
      : undefined;
    base = base.filter((c) => c === only);
  }
  const prefs = userPrefs[cls.id] ?? {};
  const chosen = base.filter((c) => prefs[c] !== false);
  return chosen.length === 0 && cls.mandatory ? base : chosen;
}

/** IPB-NTF-001: a user may not turn off every channel of a mandatory class. */
export function assertPreferences(
  classes: ReadonlyArray<NotificationClass>,
  prefs: ChannelMatrix,
  orgRouting: Readonly<Record<string, unknown>> = {},
): void {
  for (const cls of classes) {
    const p = prefs[cls.id];
    if (!p || !cls.mandatory) continue;
    const routed = effectiveChannels(cls, orgRouting, {});
    if (routed.every((c) => p[c] === false))
      throw new IpbError("IPB-NTF-001", { meta: { class: cls.id } });
  }
}

interface Wall {
  y: number;
  m: number;
  d: number;
  hh: number;
  mm: number;
}

function wall(at: Date, tz: string): Wall {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { y: n("year"), m: n("month"), d: n("day"), hh: n("hour"), mm: n("minute") };
}

/** The instant at which the wall clock in `tz` reads the given date and time (DST-safe). */
export function instantOf(w: Wall, tz: string): Date {
  const target = Date.UTC(w.y, w.m - 1, w.d, w.hh, w.mm);
  let t = target;
  for (let i = 0; i < 3; i++) {
    const seen = wall(new Date(t), tz);
    const diff = target - Date.UTC(seen.y, seen.m - 1, seen.d, seen.hh, seen.mm);
    if (diff === 0) break;
    t += diff;
  }
  return new Date(t);
}

const minutes = (hhmm: string): number => {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) throw new Error(`invalid time ${hhmm}`);
  return Number(m[1]) * 60 + Number(m[2]);
};

/** Next instant (strictly after `at`) when the wall clock in `tz` reads `hhmm`. */
export function nextWallTime(at: Date, tz: string, hhmm: string): Date {
  const w = wall(at, tz);
  const mins = minutes(hhmm);
  const today = instantOf({ ...w, hh: Math.floor(mins / 60), mm: mins % 60 }, tz);
  if (today > at) return today;
  const next = new Date(Date.UTC(w.y, w.m - 1, w.d + 1));
  return instantOf(
    {
      y: next.getUTCFullYear(),
      m: next.getUTCMonth() + 1,
      d: next.getUTCDate(),
      hh: Math.floor(mins / 60),
      mm: mins % 60,
    },
    tz,
  );
}

/** Whether `at` falls in the quiet-hours range (`"21:00-08:00"`, may wrap midnight) in `tz`. */
export function inQuietHours(at: Date, tz: string, range = DEFAULT_QUIET_HOURS): boolean {
  const [from, to] = range.split("-") as [string, string];
  const w = wall(at, tz);
  const now = w.hh * 60 + w.mm;
  const a = minutes(from);
  const b = minutes(to);
  return a <= b ? now >= a && now < b : now >= a || now < b;
}

export type Timing =
  { mode: "now" } | { mode: "after_quiet"; at: Date } | { mode: "digest"; at: Date };

/**
 * When a delivery goes out (IPB-07-25, @IPB-07-AT-22): non-urgent classes are digest-first; inside
 * quiet hours an urgent class goes now only if it may bypass (class and tenant), else at the end.
 */
export function timing(
  cls: NotificationClass,
  at: Date,
  o: {
    tz?: string | undefined;
    quietHours?: string | undefined;
    digestTime?: string | undefined;
    orgAllowsBypass?: boolean;
  },
): Timing {
  const tz = o.tz ?? DEFAULT_TIMEZONE;
  if (!cls.urgent)
    return { mode: "digest", at: nextWallTime(at, tz, o.digestTime ?? DEFAULT_DIGEST_TIME) };
  const range = o.quietHours ?? DEFAULT_QUIET_HOURS;
  if (!inQuietHours(at, tz, range)) return { mode: "now" };
  if (cls.bypass_quiet_hours && o.orgAllowsBypass !== false) return { mode: "now" };
  return { mode: "after_quiet", at: nextWallTime(at, tz, range.split("-")[1] as string) };
}
