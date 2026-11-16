// CALENDAR port (LawDocsComply PR-LDC-53; OWNER-QUESTIONS #126, R1-D-126): a person connects their
// own calendar with delegated OAuth, and the product keeps entries it owns (hearings, deadlines,
// filings) in that calendar, by its own external id. Interfaces, the in-memory fake and the contract
// cases only; the Microsoft 365 and Google adapters stay off and unproven until the owner registers
// their OAuth applications (runbook `docs/runbooks/calendar-oauth-apps.md`). The rules every
// adapter keeps:
//   * only a person connects or disconnects their own calendar (never a service or an agent); the
//     product's service may write entries to a connected calendar, an agent never;
//   * the code flow uses PKCE (S256) and a `state` bound to the person's session, and a callback
//     whose state does not match is refused (`IPB-SEC-017`); the redirect URI is the fixed callback
//     path on the product's console host, compared exactly;
//   * tokens never leave the adapter: they are stored encrypted per tenant, never logged or
//     returned, and revoked at the provider on disconnect;
//   * entries are upserted and deleted by the product's external id (idempotent), and the adapter
//     only ever touches entries it wrote;
//   * what reaches the provider is what the entry's detail level allows (`calendarPayload`): `busy`
//     sends only the time, `title` the time and title, `full` the description and location too;
//   * a disconnected or failed connection writes nothing (`IPB-PORT-003`).
import { z } from "zod";
import type { Port, PortCall } from "./common.js";
import { classed } from "./payload-class.js";

const internal = <T extends z.ZodType>(s: T): T => classed(s, "INTERNAL");
const confidential = <T extends z.ZodType>(s: T): T => classed(s, "CONFIDENTIAL");

export const CALENDAR_PROVIDERS = ["microsoft365", "google"] as const;
export type CalendarProvider = (typeof CALENDAR_PROVIDERS)[number];

/** The OAuth callback path on the product's console host; `{provider}` is a `CalendarProvider`. */
export const CALENDAR_OAUTH_CALLBACK_PATH = "/oauth/calendar/{provider}/callback";

export const CALENDAR_CONNECTION_STATES = ["pending", "connected", "revoked", "error"] as const;
export type CalendarConnectionState = (typeof CALENDAR_CONNECTION_STATES)[number];

/** How much of an entry reaches the provider (and anyone the person shares the calendar with). */
export const CALENDAR_DETAIL_LEVELS = ["busy", "title", "full"] as const;
export type CalendarDetailLevel = (typeof CALENDAR_DETAIL_LEVELS)[number];

const opaque = (min: number, max: number) =>
  z.string().regex(new RegExp(`^[A-Za-z0-9_.~-]{${min},${max}}$`));
const text = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    // eslint-disable-next-line no-control-regex
    .regex(/^[^\u0000-\u001f\u007f]+$/, "no control characters");
const instant = z.iso.datetime({ offset: true });
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Callback URIs: https on a host (or http on localhost for development), the fixed path only. */
export function isCalendarRedirectUri(uri: string, provider: CalendarProvider): boolean {
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return false;
  }
  const local =
    u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1");
  return (
    (u.protocol === "https:" || local) &&
    u.username === "" &&
    u.password === "" &&
    u.search === "" &&
    u.hash === "" &&
    u.pathname === CALENDAR_OAUTH_CALLBACK_PATH.replace("{provider}", provider)
  );
}

export const CalendarConnectRequest = z
  .object({
    /** The person connecting their own calendar. */
    principal: internal(
      z.object({ type: z.literal("user"), id: z.string().min(3).max(120) }).strict(),
    ),
    provider: internal(z.enum(CALENDAR_PROVIDERS)),
    redirectUri: internal(z.string().max(2048)),
    /** At least 128 bits of the product's session-bound random value. */
    state: internal(opaque(22, 256)),
    /** PKCE S256 challenge (RFC 7636): base64url of the verifier's SHA-256. */
    codeChallenge: internal(z.string().regex(/^[A-Za-z0-9_-]{43}$/)),
  })
  .strict()
  .refine((r) => isCalendarRedirectUri(r.redirectUri, r.provider), {
    message: "the redirect URI must be the calendar callback path on https",
    path: ["redirectUri"],
  });
export type CalendarConnectRequest = z.infer<typeof CalendarConnectRequest>;

export const CalendarCallback = z
  .object({
    connectionId: internal(z.string().min(3).max(120)),
    code: confidential(z.string().min(1).max(4096)),
    state: internal(opaque(22, 256)),
    /** The PKCE verifier (RFC 7636: 43 to 128 unreserved characters). */
    codeVerifier: confidential(opaque(43, 128)),
  })
  .strict();
export type CalendarCallback = z.infer<typeof CalendarCallback>;

export interface CalendarConnectStart {
  connectionId: string;
  /** Where to send the person's browser: the provider's consent page, scopes limited to events. */
  authorizationUrl: string;
}

export interface CalendarConnection {
  connectionId: string;
  provider: CalendarProvider;
  /** The person who connected it. */
  principalId: string;
  state: CalendarConnectionState;
  /** The connected account's address, to show the person; null until connected. */
  accountEmail: string | null;
  connectedAt: string | null;
  /** Why it failed (`consent_denied`, `token_revoked`, `invalid_grant`, …). */
  error: string | null;
}

export const CalendarEntry = z
  .object({
    /** The product's id of the record; with the connection, the entry's identity. */
    externalId: internal(z.string().regex(/^[A-Za-z0-9_.:-]{8,128}$/)),
    detail: internal(z.enum(CALENDAR_DETAIL_LEVELS)),
    title: confidential(text(255)),
    /** Timed (`start`, `end`, with offsets) or all-day (`startDate`, `endDate` exclusive). */
    start: internal(instant).optional(),
    end: internal(instant).optional(),
    startDate: internal(day).optional(),
    endDate: internal(day).optional(),
    /** IANA time zone the provider shows the entry in. */
    timeZone: internal(z.string().regex(/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+){0,2}$|^UTC$/)),
    description: confidential(z.string().max(8000)).optional(),
    location: confidential(text(255)).optional(),
    /** Minutes before the start for a reminder (at most four weeks). */
    reminderMinutes: internal(z.number().int().min(0).max(40_320)).optional(),
    /** Who writes it: the person, or the product's service on their behalf (never an agent). */
    writtenBy: internal(
      z.object({ type: z.enum(["user", "service"]), id: z.string().min(3).max(120) }).strict(),
    ),
  })
  .strict()
  .refine(
    (e) =>
      (e.start !== undefined &&
        e.end !== undefined &&
        e.startDate === undefined &&
        e.endDate === undefined &&
        Date.parse(e.end) > Date.parse(e.start)) ||
      (e.startDate !== undefined &&
        e.endDate !== undefined &&
        e.start === undefined &&
        e.end === undefined &&
        e.endDate > e.startDate),
    { message: "an entry is timed (start < end) or all-day (startDate < endDate), not both" },
  );
export type CalendarEntry = z.infer<typeof CalendarEntry>;

/** What may reach the provider for an entry, by its detail level. */
export interface CalendarPayload {
  title: string;
  start?: string;
  end?: string;
  startDate?: string;
  endDate?: string;
  timeZone: string;
  description?: string;
  location?: string;
  reminderMinutes?: number;
}

/** The provider-bound view of an entry: `busy` hides the title, only `full` carries the rest. */
export function calendarPayload(e: CalendarEntry): CalendarPayload {
  const when = {
    ...(e.start !== undefined ? { start: e.start, end: e.end! } : {}),
    ...(e.startDate !== undefined ? { startDate: e.startDate, endDate: e.endDate! } : {}),
    timeZone: e.timeZone,
    ...(e.reminderMinutes !== undefined ? { reminderMinutes: e.reminderMinutes } : {}),
  };
  if (e.detail === "busy") return { title: "Busy", ...when };
  if (e.detail === "title") return { title: e.title, ...when };
  return {
    title: e.title,
    ...when,
    ...(e.description !== undefined ? { description: e.description } : {}),
    ...(e.location !== undefined ? { location: e.location } : {}),
  };
}

export interface CalendarEntryResult {
  externalId: string;
  /** The provider's event id. */
  providerEventId: string;
  /** True when this call created it, false when it updated (or matched) an existing entry. */
  created: boolean;
  /** The canonical SHA-256 of the payload sent. */
  digest: string;
}

export interface CalendarPort extends Port {
  /** Start connecting a person's calendar: returns the provider's consent URL. */
  beginConnect(req: CalendarConnectRequest, call?: PortCall): Promise<CalendarConnectStart>;
  /** Finish the code flow from the callback; a state that does not match is `IPB-SEC-017`. */
  completeConnect(cb: CalendarCallback, call?: PortCall): Promise<CalendarConnection>;
  connection(connectionId: string, call?: PortCall): Promise<CalendarConnection>;
  /** Revoke at the provider and drop the tokens; idempotent. Only the person who connected it. */
  disconnect(
    connectionId: string,
    by: { type: "user"; id: string },
    call?: PortCall,
  ): Promise<CalendarConnection>;
  /** Create or update the entry for `externalId`; idempotent. */
  upsertEntry(
    connectionId: string,
    entry: CalendarEntry,
    call?: PortCall,
  ): Promise<CalendarEntryResult>;
  /** Delete the entry for `externalId` if the adapter wrote it; `deleted: false` when there was none. */
  deleteEntry(
    connectionId: string,
    externalId: string,
    by: { type: "user" | "service"; id: string },
    call?: PortCall,
  ): Promise<{ externalId: string; deleted: boolean }>;
}
