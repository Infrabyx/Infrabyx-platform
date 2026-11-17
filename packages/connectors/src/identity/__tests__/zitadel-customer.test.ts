// The Zitadel customer adapter against a Zitadel whose user search lags behind its writes
// (R1-D-166). Zitadel's `POST /v2/users` reads the user projection as it is, while
// `GET /v2/users/{id}` brings the projection up to date first (zitadel v4.19.5,
// internal/api/grpc/user/v2/user_query.go). The fake below keeps the two apart: the search answers
// from a snapshot taken by `index()`, every other route from the live accounts, so a stale search
// is a fixed state of the test, not a race.
import { describe, expect, it } from "vitest";
import type { CustomerOtpChannel } from "@infrabyx/contracts";
import { MemoryReplayStore } from "@infrabyx/crypto";
import { MemoryRevocationStore } from "../common.js";
import { MemoryCustomerAuthStore } from "../customer.js";
import { ZitadelCustomerIdentity, zitadelCustomerUserId } from "../zitadel-customer.js";
import { capturingSender, testDevice } from "./dpop-device.js";
import { recordedFetch, type RecordedRequest, type RecordedReply } from "./recorded-idp.js";

const Z = "https://zitadel.example.test";
const ORG = "org_customers";
const T = "tnt_a";

interface Account {
  userId: string;
  username: string;
  state: "USER_STATE_ACTIVE" | "USER_STATE_INACTIVE";
}

function laggingZitadel() {
  const live = new Map<string, Account>();
  let indexed: Account[] = [];
  const sessions: string[] = [];
  let getStatus: number | undefined;
  const body = (r: RecordedRequest) => r.json as Record<string, unknown>;
  const id = (r: RecordedRequest, at: number) => decodeURIComponent(r.path.split("/")[at]!);
  const { fetch } = recordedFetch([
    [
      "POST",
      "/v2/users",
      (r): RecordedReply => {
        const q = (body(r).queries as Array<{ userNameQuery?: { userName: string } }>)[0]!;
        const name = q.userNameQuery!.userName;
        return {
          status: 200,
          body: {
            result: indexed
              .filter((u) => u.username === name)
              .map((u) => ({ userId: u.userId, username: u.username, state: u.state })),
          },
        };
      },
    ],
    [
      "POST",
      "/v2/users/human",
      (r): RecordedReply => {
        const b = body(r) as { userId: string; username: string };
        // Zitadel's unique constraints are written with the event, so they are never stale.
        if (live.has(b.userId) || [...live.values()].some((u) => u.username === b.username))
          return { status: 409, body: { code: 6, message: "User already exists" } };
        live.set(b.userId, { userId: b.userId, username: b.username, state: "USER_STATE_ACTIVE" });
        return { status: 201, body: { userId: b.userId } };
      },
    ],
    [
      "PUT",
      /^\/v2\/users\/human\/[^/]+$/,
      (r): RecordedReply => {
        const u = live.get(id(r, 4));
        if (!u) return { status: 404, body: {} };
        u.username = (body(r) as { username: string }).username;
        return { status: 200, body: {} };
      },
    ],
    [
      "POST",
      /^\/v2\/users\/[^/]+\/deactivate$/,
      (r): RecordedReply => {
        const u = live.get(id(r, 3));
        if (!u) return { status: 404, body: {} };
        u.state = "USER_STATE_INACTIVE";
        return { status: 200, body: {} };
      },
    ],
    ["POST", /^\/v2\/users\/[^/]+\/otp_(sms|email)$/, { status: 200, body: {} }],
    ["POST", /^\/management\/v1\/users\/[^/]+\/grants$/, { status: 200, body: {} }],
    [
      "GET",
      /^\/v2\/users\/[^/]+$/,
      (r): RecordedReply => {
        if (getStatus !== undefined) return { status: getStatus, body: {} };
        const u = live.get(id(r, 3));
        return u
          ? { status: 200, body: { user: { ...u, human: {} } } }
          : { status: 404, body: { code: 5, message: "User could not be found" } };
      },
    ],
    [
      "POST",
      "/v2/sessions",
      (r): RecordedReply => {
        const userId = (body(r) as { checks: { user: { userId: string } } }).checks.user.userId;
        sessions.push(userId);
        return {
          status: 201,
          body: {
            sessionId: `s${sessions.length}`,
            sessionToken: "st",
            challenges: { otpSms: "123456" },
          },
        };
      },
    ],
  ]);
  return {
    fetch,
    live,
    sessions,
    /** The search catches up with every write so far. */
    index: () => {
      indexed = [...live.values()].map((u) => ({ ...u }));
    },
    failGets: (status: number) => {
      getStatus = status;
    },
  };
}

class Probe extends ZitadelCustomerIdentity {
  resolve(login: string, channel: CustomerOtpChannel = "sms") {
    return this.resolveUser(T, channel, login);
  }
  find(login: string) {
    return this.idpFindUser(T, "sms", login);
  }
  changeLogin(userId: string, from: string, to: string) {
    return this.idpChangeLogin({ tenantId: T, userId, channel: "sms", from, to });
  }
}

function adapter(z: ReturnType<typeof laggingZitadel>) {
  const mail = capturingSender();
  const p = new Probe({
    baseUrl: Z,
    orgId: ORG,
    projectId: "proj_1",
    clientId: "client_1",
    clientSecret: "secret_1",
    redirectUri: "http://localhost/ipb-customer-callback",
    loginClient: { userId: "login_client", token: "pat" },
    store: new MemoryCustomerAuthStore(),
    replay: new MemoryReplayStore(),
    revocations: new MemoryRevocationStore(),
    sender: mail.sender,
    customerRoles: ["UDF_BORROWER"],
    fetchImpl: z.fetch,
  });
  return { p, mail };
}

const LOGIN = "+919812345678";
const firstId = (login: string) => zitadelCustomerUserId(ORG, T, login);

describe("R1-D-166 a lagging user search never resolves a login to an account that no longer holds it", () => {
  it("a just-retired login gets a new account, and its code is issued for the new one", async () => {
    const z = laggingZitadel();
    const { p } = adapter(z);
    const retired = await p.resolve(LOGIN);
    expect(retired).toBe(firstId(LOGIN));
    z.index();
    await p.retireLogin({ tenantId: T, userId: retired, channel: "sms", login: LOGIN });
    // Zitadel has the account retired; its search still lists it under the login's username.
    expect(z.live.get(retired)).toMatchObject({ state: "USER_STATE_INACTIVE" });

    const device = testDevice();
    const t = p.signInProofTarget;
    await p.startChallenge({
      tenantId: T,
      channel: "sms",
      login: LOGIN,
      dpopProof: device.proof(t.htm, t.htu),
    });
    expect(z.sessions).toHaveLength(1);
    expect(z.sessions[0]).not.toBe(retired);
    expect(z.live.get(z.sessions[0]!)).toMatchObject({
      username: firstId(LOGIN),
      state: "USER_STATE_ACTIVE",
    });
    expect(await p.find(LOGIN)).toBe(z.sessions[0]);
  });

  it("a login that just moved to another number is not found on the old number", async () => {
    const z = laggingZitadel();
    const { p } = adapter(z);
    const to = "+919887654321";
    const moved = await p.resolve(LOGIN);
    z.index();
    await p.changeLogin(moved, LOGIN, to);
    expect(await p.find(LOGIN)).toBeUndefined();
    const fresh = await p.resolve(LOGIN);
    expect(fresh).not.toBe(moved);
    // The moved account keeps its id and is found under the new login once the search knows it.
    z.index();
    expect(await p.find(to)).toBe(moved);
  });

  it("an account the search has not indexed yet is found by its id, not created twice", async () => {
    const z = laggingZitadel();
    const { p } = adapter(z);
    const a = await p.resolve(LOGIN);
    expect(await p.resolve(LOGIN)).toBe(a);
    expect(z.live.size).toBe(1);
  });

  it("refuses rather than guesses when Zitadel cannot confirm a search hit", async () => {
    const z = laggingZitadel();
    const { p } = adapter(z);
    await p.resolve(LOGIN);
    z.index();
    z.failGets(500);
    // A 5xx is Zitadel unavailable for new sessions; nothing is created on a guess.
    await expect(p.resolve(LOGIN)).rejects.toMatchObject({ code: "IPB-IDN-002" });
    expect(z.live.size).toBe(1);
  });
});
