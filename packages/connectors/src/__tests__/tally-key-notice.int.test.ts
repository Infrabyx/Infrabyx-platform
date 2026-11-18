// The key notices of a TallyPrime agent and how an expired agent is told to re-enrol (owner
// answer #139 (1); R1-D-186; `connectors/0009`): the tenant's active administrators are notified
// once on day 80 and once on day 85 of the key, in the transaction that records the notice; from
// day 90 the gateway's 403 says how to re-enrol, and the agent picks up a new code without a
// restart.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TALLY_AGENT_API, TALLY_AGENT_KEY_NOTICE_CLASS } from "@infrabyx/contracts/ports";
import { importAgentPrivateKey, signAgentRequest } from "@infrabyx/crypto";
import { ApprovalsEngine, PgOutbox, TenantSweep } from "@infrabyx/tenancy";
import { startPostgres, withTenant, type TestDatabase } from "@infrabyx/testing";
import {
  MemoryStateStore,
  TallyAgent,
  TallyClient,
  type AgentState,
  type PlatformFetch,
} from "@infrabyx/tally-agent";
import { TallyPrimeStub } from "@infrabyx/tally-agent/stub";
import {
  TallyAgentGateway,
  TallyAgentService,
  keyNoticeDue,
  type TallyKeyNotify,
} from "../accounting/index.js";

let db: TestDatabase;
const T = "tnt_kn1";
const DAY = 86_400_000;
const U = (n: number) => `usr_01JD0000000000000000000KN${n}`;
beforeAll(async () => {
  db = await startPostgres();
  await db.admin.query(
    `insert into tenancy.tenant (id, product, name) values ('${T}', 'FBX', '${T}') on conflict do nothing`,
  );
  // Two active administrators, a disabled one and a checker: only the first two are told.
  for (const [n, status, roles] of [
    [1, "active", ["ORG_ADMIN"]],
    [2, "active", ["ORG_OWNER", "ORG_CHECKER"]],
    [3, "disabled", ["ORG_ADMIN"]],
    [4, "active", ["ORG_CHECKER"]],
  ] as const) {
    await db.admin.query(
      "insert into tenancy.user (id, idp_subject, status) values ($1, $2, $3) on conflict do nothing",
      [U(n), `kn-${n}`, status],
    );
    await db.admin.query(
      `insert into tenancy.membership (tenant_id, user_id, roles) values ($1, $2, $3)
       on conflict do nothing`,
      [T, U(n), [...roles]],
    );
  }
});
afterAll(async () => db?.end());

const maker = () => withTenant(T, ["ORG_ADMIN"], { principal: { id: "usr_maker" } });
const checker = () => withTenant(T, ["ORG_CHECKER"], { principal: { id: "usr_checker" } });
const admin = () => withTenant(T, ["ORG_ADMIN"], { principal: { id: "usr_admin" } });
const job = () =>
  withTenant(T, ["SVC_TENANT_JOB"], { principal: { id: "svc_tenant_job", type: "service" } });

type Sent = Parameters<TallyKeyNotify["enqueue"]>[1];

function platform(now?: () => Date, sent: Sent[] = []) {
  const approvals = new ApprovalsEngine({
    kernel: db.kernel,
    audit: db.audit,
    outbox: new PgOutbox(),
    product: "FBX",
  });
  const notify: TallyKeyNotify = {
    enqueue: async (_tx, n) => {
      sent.push(n);
      return {};
    },
  };
  const agents = new TallyAgentService({
    kernel: db.kernel,
    audit: db.audit,
    approvals,
    notify,
    ...(now ? { now } : {}),
  });
  const gateway = new TallyAgentGateway({
    kernel: db.kernel,
    audit: db.audit,
    pool: db.pool,
    enabled: () => true,
    pollTimeoutSeconds: () => 1,
    pollIntervalMs: 20,
    ...(now ? { now } : {}),
  });
  const fetch: PlatformFetch = async (url, init) => {
    const res = await gateway.handle({
      method: init.method,
      path: new URL(url).pathname,
      headers: Object.fromEntries(
        Object.entries(init.headers).map(([k, v]) => [k.toLowerCase(), v]),
      ),
      body: init.body ?? new Uint8Array(),
    });
    return { status: res.status, text: async () => res.body };
  };
  return { approvals, agents, gateway, fetch, sent };
}

async function newCode(p: ReturnType<typeof platform>) {
  const { approvalId, agentId } = await p.agents.requestEnrolment(maker(), {
    name: "Head office",
    company: "Acme Finance Pvt Ltd",
  });
  await p.approvals.decide(checker(), approvalId, "approve");
  const { code } = await p.agents.issueCode(admin(), agentId);
  return { agentId, code };
}

function agentFor(p: ReturnType<typeof platform>, state: MemoryStateStore, now?: () => Date) {
  const log: string[] = [];
  const agent = new TallyAgent({
    platformUrl: "https://api.example.in",
    tally: new TallyClient({ url: "http://127.0.0.1:9000", fetch: new TallyPrimeStub().fetch }),
    state,
    fetch: p.fetch,
    ...(now ? { now } : {}),
    log: (l) => log.push(l),
  });
  return { agent, log };
}

async function enrol(p: ReturnType<typeof platform>) {
  const { agentId, code } = await newCode(p);
  const state = new MemoryStateStore();
  await agentFor(p, state).agent.enrol(code);
  return { agentId, state, s: (await state.load())! };
}

let seq = Date.now() + 2_000_000;
const poll = (p: ReturnType<typeof platform>, s: AgentState, now: Date) => {
  const body = new Uint8Array();
  const n = ++seq;
  const jws = signAgentRequest({
    privateKey: importAgentPrivateKey(s.privateKeyPem!),
    kid: `${s.tenantId}/${s.agentId}`,
    request: {
      tenant: s.tenantId,
      agent: s.agentId,
      method: "GET",
      path: TALLY_AGENT_API.jobs,
      body,
    },
    seq: n,
    now,
  });
  return p.gateway.handle({
    method: "GET",
    path: TALLY_AGENT_API.jobs,
    headers: { authorization: `IPB-Agent ${jws}`, "ipb-agent-seq": String(n) },
    body,
  });
};

const at = (days: number) => new Date(Date.now() + days * DAY);
const ledger = async (agentId: string) =>
  (
    await db.admin.query(
      `select count(*)::int as n from audit.ledger
        where tenant_id = $1 and resource_id = $2 and action = 'connectors.accounting.agent.key_notice'`,
      [T, agentId],
    )
  ).rows[0].n as number;

describe("keyNoticeDue", () => {
  const e = new Date("2026-01-01T00:00:00Z");
  const d = (n: number) => new Date(e.getTime() + n * DAY);
  it("is the latest notice day reached and not yet sent, and none from day 90", () => {
    expect(keyNoticeDue(e, 0, d(79.9))).toBeNull();
    expect(keyNoticeDue(e, 0, d(80))).toBe(80);
    expect(keyNoticeDue(e, 80, d(84))).toBeNull();
    expect(keyNoticeDue(e, 80, d(85))).toBe(85);
    expect(keyNoticeDue(e, 0, d(86))).toBe(85);
    expect(keyNoticeDue(e, 85, d(89))).toBeNull();
    expect(keyNoticeDue(e, 0, d(90))).toBeNull();
  });
});

describe("the key notices on day 80 and day 85 (#139 (1), connectors/0009)", () => {
  it("tells the tenant's active administrators once on day 80 and once on day 85", async () => {
    const { agentId } = await enrol(platform());
    const sent: Sent[] = [];
    expect(await platform(() => at(79), sent).agents.sendKeyNotices(job())).toEqual({
      notified: 0,
    });
    expect(sent).toEqual([]);
    const day81 = platform(() => at(81), sent);
    expect(await day81.agents.sendKeyNotices(job())).toEqual({ notified: 1 });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      class: TALLY_AGENT_KEY_NOTICE_CLASS,
      to: [{ ref: U(1) }, { ref: U(2) }],
      vars: { id: agentId, name: "Head office", day: "80" },
      deepLink: `/settings/accounting/agents/${agentId}`,
      idempotencyKey: `${TALLY_AGENT_KEY_NOTICE_CLASS}:${agentId}:80`,
    });
    expect(sent[0]!.vars.expires_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // Once only: the same day again, and day 84, send nothing.
    expect(await day81.agents.sendKeyNotices(job())).toEqual({ notified: 0 });
    expect(await platform(() => at(84), sent).agents.sendKeyNotices(job())).toEqual({
      notified: 0,
    });
    const day86 = platform(() => at(86), sent);
    expect(await day86.agents.sendKeyNotices(job())).toEqual({ notified: 1 });
    expect(sent[1]).toMatchObject({
      vars: { day: "85" },
      idempotencyKey: expect.stringMatching(/:85$/),
    });
    expect(await platform(() => at(88), sent).agents.sendKeyNotices(job())).toEqual({
      notified: 0,
    });
    expect(sent).toHaveLength(2);
    expect(await ledger(agentId)).toBe(2);
    expect((await day86.agents.get(admin(), agentId))!.keyNoticeDay).toBe(85);
  });

  it("sends only the latest notice due, and none once the key has expired", async () => {
    const late = await enrol(platform());
    const sent: Sent[] = [];
    expect(await platform(() => at(87), sent).agents.sendKeyNotices(job())).toEqual({
      notified: 1,
    });
    expect(sent.map((n) => n.vars.day)).toEqual(["85"]);
    const expired = await enrol(platform());
    const none: Sent[] = [];
    expect(await platform(() => at(91), none).agents.sendKeyNotices(job())).toEqual({
      notified: 0,
    });
    expect(none).toEqual([]);
    expect(await ledger(expired.agentId)).toBe(0);
    expect(late.agentId).not.toBe(expired.agentId);
  });

  it("runs per tenant through TenantSweep, as the job's service principal", async () => {
    await enrol(platform());
    const sent: Sent[] = [];
    const p = platform(() => at(82), sent);
    const results = await new TenantSweep({ kernel: db.kernel, audit: db.audit }).run((ctx) =>
      p.agents.sendKeyNotices(ctx),
    );
    expect(results.find((r) => r.tenantId === T)).toMatchObject({
      ok: true,
      value: { notified: 1 },
    });
    expect(sent).toHaveLength(1);
  });

  it("refuses without NOTIFY, and refuses an agent principal", async () => {
    const approvals = new ApprovalsEngine({
      kernel: db.kernel,
      audit: db.audit,
      outbox: new PgOutbox(),
      product: "FBX",
    });
    const bare = new TallyAgentService({ kernel: db.kernel, audit: db.audit, approvals });
    await expect(bare.sendKeyNotices(job())).rejects.toMatchObject({ code: "IPB-UX-004" });
    await expect(
      platform().agents.sendKeyNotices(
        withTenant(T, ["AGT_VIDHI"], { principal: { id: "agt_x", type: "agent" } }),
      ),
    ).rejects.toMatchObject({ code: "IPB-SEC-004" });
  });

  it("never takes a notice back (database guard)", async () => {
    const { agentId } = await enrol(platform());
    await platform(() => at(81)).agents.sendKeyNotices(job());
    await expect(
      db.admin.query("update connectors.tally_agent set key_notice_day = 0 where id = $1", [
        agentId,
      ]),
    ).rejects.toThrow(/never taken back/);
  });
});

describe("an expired agent is told how to re-enrol, and re-enrols without a restart", () => {
  it("answers 403 with the steps, which the agent logs, and takes a new code in place", async () => {
    const p = platform();
    const { agentId, state, s } = await enrol(p);
    const day91 = platform(() => at(91));
    const r = await poll(day91, s, at(91));
    expect(r.status).toBe(403);
    const body = JSON.parse(r.body) as { title: string; detail: string };
    expect(body.title).toMatch(/expired/);
    expect(body.detail).toMatch(/one-time enrolment code/);
    expect(body.detail).toMatch(/enrol-code/);
    expect(body.detail).toMatch(/without a restart/);

    // The agent logs the platform's words.
    const { agent, log } = agentFor(day91, state, () => at(91));
    const stop = new AbortController();
    const running = agent.run(stop.signal);
    await new Promise((res) => setTimeout(res, 200));
    stop.abort();
    await running;
    expect(log.some((l) => l.includes("HTTP 403") && l.includes("enrol-code"))).toBe(true);

    // A new code in the state directory: the agent enrols again in place; the old one is revoked.
    const { code } = await newCode(day91);
    state.code = code;
    expect(await agent.reenrolIfCode()).toBe(true);
    expect(state.code).toBeNull();
    const fresh = (await state.load())!;
    expect(fresh.agentId).not.toBe(agentId);
    expect((await day91.agents.get(admin(), agentId))!.state).toBe("revoked");
    // The new key's 90 days start at its own enrolment.
    expect((await poll(p, fresh, new Date())).status).toBe(200);
    expect(await agent.reenrolIfCode()).toBe(false);
  });

  it.each([
    ["malformed (400)", "tac1.not-a-code"],
    ["unknown (401)", `tac1.${T}.tga_0${"0".repeat(25)}.${"A".repeat(43)}`],
  ])("drops a code the platform refuses: %s", async (_label, code) => {
    const p = platform();
    const { state, s } = await enrol(p);
    state.code = code;
    const { agent, log } = agentFor(p, state);
    expect(await agent.reenrolIfCode()).toBe(false);
    expect(state.code).toBeNull();
    expect(log.some((l) => l.includes("refused the enrolment code"))).toBe(true);
    expect((await state.load())!.agentId).toBe(s.agentId);
  });
});
