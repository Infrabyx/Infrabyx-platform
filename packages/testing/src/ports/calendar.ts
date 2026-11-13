// CALENDAR fake and contract cases (LawDocsComply PR-LDC-53; R1-D-126). The fake plays the provider
// in memory: `authorize` stands for the person's consent page and returns the code (or none when
// they deny), `providerView` shows exactly what the provider holds for an entry, and
// `revokeAtProvider` stands for the person removing the app from their account. No token is ever
// returned. The cases hold every adapter to the port's rules: a person connects their own calendar
// with PKCE and a matching state, entries are idempotent by external id and minimised by detail
// level, only the adapter's own entries are touched, agents never write, and a disconnected
// calendar takes nothing.
import { expect } from "vitest";
import { PortError } from "@infrabyx/contracts/errors";
import {
  CalendarCallback,
  CalendarConnectRequest,
  CalendarEntry,
  calendarPayload,
  type AdapterDescriptor,
  type CalendarConnectStart,
  type CalendarConnection,
  type CalendarEntryResult,
  type CalendarPayload,
  type CalendarPort,
  type PortHealth,
} from "@infrabyx/contracts/ports";
import { canonicalDigest, newId, randomBytes, sha256, toBase64Url } from "@infrabyx/crypto";
import type { ContractCase } from "../contract.js";

interface FakeConnection {
  c: CalendarConnection;
  state: string;
  challenge: string;
  code: string | null;
  /** The fake's stand-in for the refresh token; never leaves the fake. */
  token: string | null;
  entries: Map<string, { providerEventId: string; payload: CalendarPayload; digest: string }>;
}

const refuse = (
  code: "IPB-UX-004" | "IPB-PORT-003" | "IPB-SEC-004" | "IPB-SEC-017",
  detail: string,
) => new PortError(code, "CALENDAR", { detail });

export class FakeCalendar implements CalendarPort {
  readonly descriptor: AdapterDescriptor = {
    port: "CALENDAR",
    adapter: "fake-calendar",
    residency: "IN",
    maxDataClass: "CONFIDENTIAL",
  };
  private readonly connections = new Map<string, FakeConnection>();
  private event = 0;

  async health(): Promise<PortHealth> {
    return { status: "up", latency_ms: 0, checked_at: new Date().toISOString() };
  }

  async beginConnect(raw: CalendarConnectRequest): Promise<CalendarConnectStart> {
    if ((raw as { principal?: { type?: unknown } })?.principal?.type !== "user")
      throw refuse("IPB-SEC-004", "only a person connects their own calendar");
    const r = CalendarConnectRequest.safeParse(raw);
    if (!r.success)
      throw refuse("IPB-UX-004", `bad connect request: ${r.error.issues[0]?.message}`);
    const req = r.data;
    const connectionId = newId("cal");
    this.connections.set(connectionId, {
      c: {
        connectionId,
        provider: req.provider,
        principalId: req.principal.id,
        state: "pending",
        accountEmail: null,
        connectedAt: null,
        error: null,
      },
      state: req.state,
      challenge: req.codeChallenge,
      code: null,
      token: null,
      entries: new Map(),
    });
    const q = new URLSearchParams({
      response_type: "code",
      client_id: "fake-client",
      redirect_uri: req.redirectUri,
      scope: "calendar.events offline_access",
      state: req.state,
      code_challenge: req.codeChallenge,
      code_challenge_method: "S256",
    });
    return { connectionId, authorizationUrl: `https://calendar.fake.invalid/authorize?${q}` };
  }

  /** Test control: the person's answer on the consent page; the code, or null when denied. */
  authorize(connectionId: string, outcome: "grant" | "deny"): string | null {
    const f = this.must(connectionId);
    if (outcome === "deny") {
      f.c.state = "error";
      f.c.error = "consent_denied";
      return null;
    }
    f.code = toBase64Url(randomBytes(24));
    return f.code;
  }

  async completeConnect(raw: CalendarCallback): Promise<CalendarConnection> {
    const r = CalendarCallback.safeParse(raw);
    if (!r.success) throw refuse("IPB-UX-004", "bad callback");
    const cb = r.data;
    const f = this.must(cb.connectionId);
    if (f.c.state !== "pending") throw refuse("IPB-PORT-003", `the connection is ${f.c.state}`);
    if (cb.state !== f.state) throw refuse("IPB-SEC-017", "the OAuth state does not match");
    if (
      toBase64Url(sha256(cb.codeVerifier)) !== f.challenge ||
      f.code === null ||
      cb.code !== f.code
    )
      throw refuse("IPB-SEC-017", "the code or its PKCE verifier does not match");
    f.code = null;
    f.token = toBase64Url(randomBytes(32));
    f.c.state = "connected";
    f.c.accountEmail = `${f.c.principalId}@calendar.fake.invalid`;
    f.c.connectedAt = new Date().toISOString();
    return structuredClone(f.c);
  }

  async connection(connectionId: string): Promise<CalendarConnection> {
    return structuredClone(this.must(connectionId).c);
  }

  async disconnect(
    connectionId: string,
    by: { type: "user"; id: string },
  ): Promise<CalendarConnection> {
    const f = this.must(connectionId);
    if (by?.type !== "user" || by.id !== f.c.principalId)
      throw refuse("IPB-SEC-004", "only the person who connected a calendar disconnects it");
    f.token = null;
    f.code = null;
    f.c.state = "revoked";
    return structuredClone(f.c);
  }

  /** Test control: the person removed the app at the provider; the next write finds out. */
  revokeAtProvider(connectionId: string): void {
    this.must(connectionId).token = null;
  }

  /** Test control: exactly what the provider holds for an entry. */
  providerView(connectionId: string, externalId: string): CalendarPayload | undefined {
    return structuredClone(this.must(connectionId).entries.get(externalId)?.payload);
  }

  async upsertEntry(connectionId: string, raw: CalendarEntry): Promise<CalendarEntryResult> {
    if ((raw as { writtenBy?: { type?: unknown } })?.writtenBy?.type === "agent")
      throw refuse("IPB-SEC-004", "an agent never writes to a person's calendar");
    const r = CalendarEntry.safeParse(raw);
    if (!r.success) throw refuse("IPB-UX-004", `bad entry: ${r.error.issues[0]?.message}`);
    const f = this.writable(connectionId);
    const payload = calendarPayload(r.data);
    const digest = canonicalDigest(payload);
    const have = f.entries.get(r.data.externalId);
    if (have) {
      have.payload = payload;
      have.digest = digest;
      return {
        externalId: r.data.externalId,
        providerEventId: have.providerEventId,
        created: false,
        digest,
      };
    }
    const providerEventId = `evt_${String(++this.event).padStart(8, "0")}`;
    f.entries.set(r.data.externalId, { providerEventId, payload, digest });
    return { externalId: r.data.externalId, providerEventId, created: true, digest };
  }

  async deleteEntry(
    connectionId: string,
    externalId: string,
    by: { type: "user" | "service"; id: string },
  ): Promise<{ externalId: string; deleted: boolean }> {
    if (by?.type !== "user" && by?.type !== "service")
      throw refuse("IPB-SEC-004", "an agent never deletes a calendar entry");
    const f = this.writable(connectionId);
    return { externalId, deleted: f.entries.delete(externalId) };
  }

  private writable(connectionId: string): FakeConnection {
    const f = this.must(connectionId);
    if (f.c.state === "connected" && f.token === null) {
      f.c.state = "error";
      f.c.error = "token_revoked";
    }
    if (f.c.state !== "connected")
      throw refuse("IPB-PORT-003", `the calendar connection is ${f.c.state}`);
    return f;
  }

  private must(connectionId: string): FakeConnection {
    const f = this.connections.get(connectionId);
    if (!f) throw refuse("IPB-UX-004", `no calendar connection ${connectionId}`);
    return f;
  }
}

/** Drives the provider side of the adapter under test (the fake's controls, or a sandbox's). */
export interface CalendarScript {
  authorize(connectionId: string, outcome: "grant" | "deny"): string | null;
  providerView(connectionId: string, externalId: string): CalendarPayload | undefined;
  revokeAtProvider(connectionId: string): void;
}

const pkce = () => {
  const verifier = toBase64Url(randomBytes(48));
  return { verifier, challenge: toBase64Url(sha256(verifier)) };
};
const connectReq = (challenge: string, state = toBase64Url(randomBytes(24))) => ({
  principal: { type: "user" as const, id: "usr_advocate_1" },
  provider: "microsoft365" as const,
  redirectUri: "https://console.example.test/oauth/calendar/microsoft365/callback",
  state,
  codeChallenge: challenge,
});
let n = 0;
const entry = (
  detail: CalendarEntry["detail"],
  over: Partial<CalendarEntry> = {},
): CalendarEntry => ({
  externalId: `hearing-${Date.now()}-${++n}`,
  detail,
  title: "Hearing: matter 0001 before the tribunal",
  start: "2026-12-01T10:30:00+05:30",
  end: "2026-12-01T11:30:00+05:30",
  timeZone: "Asia/Kolkata",
  description: "Bring the filed reply and the vakalatnama.",
  location: "Court room 4",
  reminderMinutes: 60,
  writtenBy: { type: "service", id: "svc_matters" },
  ...over,
});
const code = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: { code?: string }) => e.code ?? "error",
  );

async function connected(p: CalendarPort, s: CalendarScript): Promise<string> {
  const k = pkce();
  const req = connectReq(k.challenge);
  const start = await p.beginConnect(req);
  const c = s.authorize(start.connectionId, "grant")!;
  await p.completeConnect({
    connectionId: start.connectionId,
    code: c,
    state: req.state,
    codeVerifier: k.verifier,
  });
  return start.connectionId;
}

export function calendarContractCases(s: CalendarScript): ContractCase<CalendarPort>[] {
  return [
    {
      name: "a person connects with PKCE and a matching state; no token is ever returned",
      async run(p) {
        const k = pkce();
        const req = connectReq(k.challenge);
        const start = await p.beginConnect(req);
        const url = new URL(start.authorizationUrl);
        expect(url.protocol).toBe("https:");
        expect(url.searchParams.get("code_challenge_method")).toBe("S256");
        expect(url.searchParams.get("code_challenge")).toBe(k.challenge);
        expect(url.searchParams.get("state")).toBe(req.state);
        expect(url.searchParams.get("redirect_uri")).toBe(req.redirectUri);
        expect((await p.connection(start.connectionId)).state).toBe("pending");
        const c = s.authorize(start.connectionId, "grant")!;
        const cb = {
          connectionId: start.connectionId,
          code: c,
          state: req.state,
          codeVerifier: k.verifier,
        };
        expect(await code(p.completeConnect({ ...cb, state: `${req.state}x` }))).toBe(
          "IPB-SEC-017",
        );
        expect(await code(p.completeConnect({ ...cb, codeVerifier: pkce().verifier }))).toBe(
          "IPB-SEC-017",
        );
        const done = await p.completeConnect(cb);
        expect(done).toMatchObject({
          state: "connected",
          principalId: "usr_advocate_1",
          error: null,
        });
        expect(JSON.stringify(done)).not.toMatch(/token|secret|code_verifier/i);
        expect(await code(p.completeConnect(cb))).toBe("IPB-PORT-003");
      },
    },
    {
      name: "a denied consent, a service, an agent or a foreign redirect URI never connects",
      async run(p) {
        const k = pkce();
        const start = await p.beginConnect(connectReq(k.challenge));
        expect(s.authorize(start.connectionId, "deny")).toBeNull();
        expect(await p.connection(start.connectionId)).toMatchObject({
          state: "error",
          error: "consent_denied",
        });
        for (const type of ["service", "agent"])
          expect(
            await code(
              p.beginConnect({
                ...connectReq(k.challenge),
                principal: { type, id: "svc_x" },
              } as never),
            ),
          ).toBe("IPB-SEC-004");
        for (const redirectUri of [
          "http://console.example.test/oauth/calendar/microsoft365/callback",
          "https://console.example.test/oauth/calendar/google/callback",
          "https://console.example.test/oauth/calendar/microsoft365/callback?next=/x",
          "https://evil.example.test/other",
        ])
          expect(await code(p.beginConnect({ ...connectReq(k.challenge), redirectUri }))).toBe(
            "IPB-UX-004",
          );
        expect(await code(p.beginConnect({ ...connectReq(k.challenge), state: "short" }))).toBe(
          "IPB-UX-004",
        );
      },
    },
    {
      name: "entries are idempotent by external id, and the provider gets only what the detail level allows",
      async run(p) {
        const id = await connected(p, s);
        const busy = entry("busy");
        const a = await p.upsertEntry(id, busy);
        expect(a.created).toBe(true);
        expect(s.providerView(id, busy.externalId)).toEqual({
          title: "Busy",
          start: busy.start,
          end: busy.end,
          timeZone: "Asia/Kolkata",
          reminderMinutes: 60,
        });
        const b = await p.upsertEntry(id, busy);
        expect(b).toEqual({ ...a, created: false });
        const titled = await p.upsertEntry(id, { ...busy, detail: "title" });
        expect(titled.providerEventId).toBe(a.providerEventId);
        const view = s.providerView(id, busy.externalId)!;
        expect(view.title).toBe(busy.title);
        expect(view.description).toBeUndefined();
        expect(view.location).toBeUndefined();
        const full = entry("full", {
          start: undefined,
          end: undefined,
          startDate: "2026-12-02",
          endDate: "2026-12-03",
        });
        await p.upsertEntry(id, full);
        expect(s.providerView(id, full.externalId)).toMatchObject({
          startDate: "2026-12-02",
          endDate: "2026-12-03",
          description: full.description,
          location: full.location,
        });
        expect(
          await p.deleteEntry(id, full.externalId, { type: "service", id: "svc_matters" }),
        ).toEqual({
          externalId: full.externalId,
          deleted: true,
        });
        expect(s.providerView(id, full.externalId)).toBeUndefined();
        expect(
          (await p.deleteEntry(id, full.externalId, { type: "service", id: "svc_matters" }))
            .deleted,
        ).toBe(false);
      },
    },
    {
      name: "malformed entries and agents are refused before anything reaches the provider",
      async run(p) {
        const id = await connected(p, s);
        const e = entry("full");
        for (const bad of [
          { ...e, end: e.start },
          { ...e, startDate: "2026-12-02", endDate: "2026-12-03" },
          { ...e, externalId: "short" },
          { ...e, timeZone: "not a zone" },
          { ...e, title: "line\u0007bell" },
        ])
          expect(await code(p.upsertEntry(id, bad as CalendarEntry))).toBe("IPB-UX-004");
        expect(
          await code(
            p.upsertEntry(id, { ...e, writtenBy: { type: "agent", id: "agt_vidhi" } } as never),
          ),
        ).toBe("IPB-SEC-004");
        expect(
          await code(p.deleteEntry(id, e.externalId, { type: "agent", id: "agt_vidhi" } as never)),
        ).toBe("IPB-SEC-004");
        expect(s.providerView(id, e.externalId)).toBeUndefined();
      },
    },
    {
      name: "only the person disconnects; a disconnected or revoked calendar takes nothing",
      async run(p) {
        const id = await connected(p, s);
        await p.upsertEntry(id, entry("title"));
        expect(await code(p.disconnect(id, { type: "user", id: "usr_someone_else" }))).toBe(
          "IPB-SEC-004",
        );
        expect((await p.disconnect(id, { type: "user", id: "usr_advocate_1" })).state).toBe(
          "revoked",
        );
        expect((await p.disconnect(id, { type: "user", id: "usr_advocate_1" })).state).toBe(
          "revoked",
        );
        expect(await code(p.upsertEntry(id, entry("busy")))).toBe("IPB-PORT-003");
        const other = await connected(p, s);
        s.revokeAtProvider(other);
        expect(await code(p.upsertEntry(other, entry("busy")))).toBe("IPB-PORT-003");
        expect(await p.connection(other)).toMatchObject({ state: "error", error: "token_revoked" });
      },
    },
  ];
}
