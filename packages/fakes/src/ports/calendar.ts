// CALENDAR fake and contract cases (LawDocsComply PR-LDC-53; R1-D-126). The fake plays the provider
// in memory: `authorize` stands for the person's consent page and returns the code (or none when
// they deny), `providerView` shows exactly what the provider holds for an entry, and
// `revokeAtProvider` stands for the person removing the app from their account. No token is ever
// returned. The cases hold every adapter to the port's rules: a person connects their own calendar
// with PKCE and a matching state, entries are idempotent by external id and minimised by detail
// level, only the adapter's own entries are touched, agents never write, and a disconnected
// calendar takes nothing.
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
