// CALENDAR fake and contract cases (LawDocsComply PR-LDC-53; R1-D-126). The fake plays the provider
// in memory: `authorize` stands for the person's consent page and returns the code (or none when
// they deny), `providerView` shows exactly what the provider holds for an entry, and
// `revokeAtProvider` stands for the person removing the app from their account. No token is ever
// returned. The cases hold every adapter to the port's rules: a person connects their own calendar
// with PKCE and a matching state, entries are idempotent by external id and minimised by detail
// level, only the adapter's own entries are touched, agents never write, and a disconnected
// calendar takes nothing.
// CALENDAR fake and contract cases (LawDocsComply PR-LDC-53; R1-D-126). The fake plays the provider
// in memory: `authorize` stands for the person's consent page and returns the code (or none when
// they deny), `providerView` shows exactly what the provider holds for an entry, and
// `revokeAtProvider` stands for the person removing the app from their account. No token is ever
// returned. The cases hold every adapter to the port's rules: a person connects their own calendar
// with PKCE and a matching state, entries are idempotent by external id and minimised by detail
// level, only the adapter's own entries are touched, agents never write, and a disconnected
// calendar takes nothing.
import { expect } from "vitest";
import { CalendarEntry, type CalendarPayload, type CalendarPort } from "@infrabyx/contracts/ports";
import { randomBytes, sha256, toBase64Url } from "@infrabyx/crypto";
import type { ContractCase } from "../contract.js";
export { FakeCalendar } from "@infrabyx/fakes";

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
