// The TallyPrime adapter on PostgreSQL 18 with every platform migration applied (PR-FBX-46,
// R1-D-137, R1-D-178; threat model §3.121; connectors/0007): the ACCOUNTING contract cases against
// `TallyAccountingSink` with the agent running in-process against the TallyPrime stub (both
// REMOTEID behaviours), enrolment under maker-checker and its one-time code, the agent API's
// refusals, one job in flight, expiry, RLS and the immutability triggers.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PortError } from "@infrabyx/contracts/errors";
import type { KernelContext } from "@infrabyx/contracts/kernel";
import { TALLY_AGENT_API, type JournalBatch } from "@infrabyx/contracts/ports";
import { importAgentPrivateKey, signAgentRequest } from "@infrabyx/crypto";
import { ApprovalsEngine, PgOutbox } from "@infrabyx/tenancy";
import {
  accountingContractCases,
  defineContractSuite,
  startPostgres,
  withTenant,
  type ScriptedPosting,
  type TestDatabase,
} from "@infrabyx/testing";
import {
  MemoryStateStore,
  TallyAgent,
  TallyClient,
  type AgentState,
  type PlatformFetch,
} from "@infrabyx/tally-agent";
import { TallyPrimeStub } from "@infrabyx/tally-agent/stub";
import {
  TallyAccountingSink,
  TallyAgentGateway,
  TallyAgentService,
} from "../accounting/tally/index.js";

let db: TestDatabase;
const TENANTS = ["tnt_t1", "tnt_t2", "tnt_t3", "tnt_t4"];
const COMPANY = "Acme Finance Pvt Ltd";
const LEDGERS = ["Loans and Advances", "Bank Current Account", "Interest Income"];
const disabled = new Set<string>();

beforeAll(async () => {
  db = await startPostgres();
  await db.admin.query(
    `insert into tenancy.tenant (id, product, name) values ${TENANTS.map((t) => `('${t}', 'FBX', '${t}')`).join(", ")} on conflict do nothing`,
  );
});
afterAll(async () => db?.end());

const maker = (t: string) => withTenant(t, ["ORG_ADMIN"], { principal: { id: "usr_maker" } });
const checker = (t: string) => withTenant(t, ["ORG_CHECKER"], { principal: { id: "usr_checker" } });
const admin = (t: string) => withTenant(t, ["ORG_ADMIN"], { principal: { id: "usr_admin" } });

function platform() {
  const approvals = new ApprovalsEngine({
    kernel: db.kernel,
    audit: db.audit,
    outbox: new PgOutbox(),
    product: "FBX",
  });
  const agents = new TallyAgentService({ kernel: db.kernel, audit: db.audit, approvals });
  const gateway = new TallyAgentGateway({
    kernel: db.kernel,
    audit: db.audit,
    pool: db.pool,
    enabled: (t) => !disabled.has(t),
    pollTimeoutSeconds: () => 1,
    pollIntervalMs: 20,
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
  return { approvals, agents, gateway, fetch };
}

/** Enrols an agent for `tenant` through maker-checker and the one-time code. */
async function enrol(
  p: ReturnType<typeof platform>,
  tenant: string,
  stub: TallyPrimeStub,
): Promise<{ agent: TallyAgent; state: MemoryStateStore; agentId: string }> {
  const { approvalId, agentId } = await p.agents.requestEnrolment(maker(tenant), {
    name: "Head office",
    company: COMPANY,
  });
  await p.approvals.decide(checker(tenant), approvalId, "approve");
  const { code } = await p.agents.issueCode(admin(tenant), agentId);
  const state = new MemoryStateStore();
  const agent = new TallyAgent({
    platformUrl: "https://api.example.in",
    tally: new TallyClient({ url: "http://127.0.0.1:9000", fetch: stub.fetch }),
    state,
    fetch: p.fetch,
  });
  await agent.enrol(code);
  return { agent, state, agentId };
}

class Pend extends Error {}

/** Drives the agent in the background; `script` and `settle` steer it per journal. */
class Harness {
  private stopped = false;
  private loop: Promise<void> | null = null;
  readonly scripts = new Map<string, ScriptedPosting[]>();
  readonly pended = new Set<string>();
  constructor(
    readonly agent: TallyAgent,
    readonly stub: TallyPrimeStub,
    readonly sink: TallyAccountingSink,
  ) {
    const run = agent.runJob.bind(agent);
    agent.runJob = async (job) => {
      if (job.kind === "post") {
        if (this.pended.has(job.jobId)) throw new Pend();
        const next = this.scripts.get(job.jobId)?.shift();
        if (next === "pend") {
          this.pended.add(job.jobId);
          throw new Pend();
        }
        if (next === "reject") stub.refuseNextImport("Ledger 'Suspense' does not exist!");
      }
      return run(job);
    };
  }
  start(): void {
    this.loop = (async () => {
      while (!this.stopped) {
        try {
          await this.agent.runOnce();
        } catch {
          await new Promise((r) => setTimeout(r, 20));
        }
      }
    })();
  }
  async stop(): Promise<void> {
    this.stopped = true;
    await this.loop;
  }
  script(journalId: string, ...outcomes: ScriptedPosting[]): void {
    this.scripts.set(journalId, outcomes);
  }
  async settle(journalId: string, outcome: "acknowledge" | "reject"): Promise<void> {
    if (outcome === "reject") this.stub.refuseNextImport("Ledger 'Suspense' does not exist!");
    this.pended.delete(journalId);
    for (let i = 0; i < 200; i++) {
      if ((await this.sink.status(journalId)).state !== "PENDING") return;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error(`journal ${journalId} did not settle`);
  }
}

for (const [tenant, collision] of [
  ["tnt_t1", "duplicate"],
  ["tnt_t2", "alter"],
] as const) {
  describe(`TallyAccountingSink with the agent in-process (REMOTEID collisions: ${collision})`, () => {
    const stub = new TallyPrimeStub(collision).company({ name: COMPANY, ledgers: LEDGERS });
    let ctx: KernelContext;
    let sink: TallyAccountingSink;
    let harness: Harness;
    beforeAll(async () => {
      const p = platform();
      ctx = withTenant(tenant, ["ORG_ADMIN"], {
        principal: { id: "svc_finance_posting", type: "service", roles: ["SVC_FINANCE"] },
      });
      sink = new TallyAccountingSink({
        kernel: db.kernel,
        audit: db.audit,
        enabled: () => true,
        awaitResultMs: 3_000,
        trialBalanceWaitMs: 10_000,
        pollIntervalMs: 25,
        context: () => ctx,
      });
      const { agent } = await enrol(p, tenant, stub);
      harness = new Harness(agent, stub, sink);
      harness.start();
    });
    afterAll(async () => harness?.stop());

    defineContractSuite(
      "ACCOUNTING",
      () => sink,
      accountingContractCases({
        script: (j, ...o) => harness.script(j, ...o),
        settle: (j, o) => harness.settle(j, o),
      }),
      { leg: "hermetic" },
    );
  });
}

const batch = (journalId: string, paise = 1_000_00): JournalBatch => ({
  journalId,
  initiatedBy: { type: "user", id: "usr_maker" },
  entries: [
    {
      voucherType: "Journal",
      date: "2026-11-02",
      reference: "JV-1",
      lines: [
        { ledger: "Loans and Advances", side: "debit", amountPaise: paise },
        { ledger: "Bank Current Account", side: "credit", amountPaise: paise },
      ],
    },
  ],
});
const code = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: { code?: string }) => e.code ?? String(e),
  );

describe("enrolment, the agent API and the tables (connectors/0007)", () => {
  const T = "tnt_t3";
  let p: ReturnType<typeof platform>;
  beforeAll(() => {
    p = platform();
  });
  const stub = new TallyPrimeStub().company({ name: COMPANY, ledgers: LEDGERS });
  const sinkFor = (t: string) =>
    new TallyAccountingSink({
      kernel: db.kernel,
      audit: db.audit,
      enabled: (x) => !disabled.has(x),
      context: () => maker(t),
    });

  let nextSeq = Date.now() + 100_000;
  /** A signed call as the agent in `state` would make it, with overrides to break it. */
  async function call(
    state: AgentState,
    o: { method?: string; path?: string; body?: string; seq?: number; now?: Date; kid?: string },
  ) {
    const method = o.method ?? "GET";
    const path = o.path ?? TALLY_AGENT_API.jobs;
    const body = new TextEncoder().encode(o.body ?? "");
    const seq = o.seq ?? ++nextSeq;
    const jws = signAgentRequest({
      privateKey: importAgentPrivateKey(state.privateKeyPem!),
      kid: o.kid ?? `${state.tenantId}/${state.agentId}`,
      request: { tenant: state.tenantId, agent: state.agentId, method, path, body },
      seq,
      ...(o.now ? { now: o.now } : {}),
    });
    return p.gateway.handle({
      method,
      path,
      headers: { authorization: `IPB-Agent ${jws}`, "ipb-agent-seq": String(seq) },
      body,
    });
  }

  it("enrols only through maker-checker; an agent principal cannot ask", async () => {
    const agentCtx = withTenant(T, ["AGT_VIDHI"], {
      principal: { id: "agt_vidhi", type: "agent" },
    });
    expect(await code(p.agents.requestEnrolment(agentCtx, { name: "x", company: COMPANY }))).toBe(
      "IPB-SEC-004",
    );
    const { approvalId, agentId } = await p.agents.requestEnrolment(maker(T), {
      name: "Branch",
      company: COMPANY,
    });
    expect(await p.agents.get(admin(T), agentId)).toBeNull();
    expect(await code(p.approvals.decide(maker(T), approvalId, "approve"))).toBe("IPB-SEC-007");
    await p.approvals.decide(checker(T), approvalId, "approve");
    expect(await p.agents.get(admin(T), agentId)).toMatchObject({
      state: "approved",
      company: COMPANY,
      codeOutstanding: false,
    });
    expect(await code(p.agents.issueCode(checker(T), agentId))).toBe("IPB-UX-011");
  });

  it("takes a one-time code once, within 30 minutes, five wrong tries at most", async () => {
    const { approvalId, agentId } = await p.agents.requestEnrolment(maker(T), {
      name: "Codes",
      company: COMPANY,
    });
    await p.approvals.decide(checker(T), approvalId, "approve");
    const enrolWith = (c: string) =>
      p.gateway.handle({
        method: "POST",
        path: TALLY_AGENT_API.enrol,
        headers: {},
        body: new TextEncoder().encode(
          JSON.stringify({
            code: c,
            jwk: { kty: "EC", crv: "P-256", x: "x".repeat(43), y: "y".repeat(43) },
            agentVersion: "1.0.0",
          }),
        ),
      });
    const first = await p.agents.issueCode(admin(T), agentId);
    const second = await p.agents.issueCode(admin(T), agentId);
    expect((await enrolWith(first.code)).status).toBe(401); // replaced
    const wrong = `${second.code.slice(0, -1)}${second.code.endsWith("A") ? "B" : "A"}`;
    for (let i = 0; i < 5; i++) expect((await enrolWith(wrong)).status).toBe(401);
    expect((await enrolWith(second.code)).status).toBe(401); // locked after five
    const third = await p.agents.issueCode(admin(T), agentId);
    await db.admin.query(
      "update connectors.tally_agent set code_expires_at = now() - interval '1 second' where id = $1",
      [agentId],
    );
    expect((await enrolWith(third.code)).status).toBe(401); // expired
    const fourth = await p.agents.issueCode(admin(T), agentId);
    expect((await enrolWith(fourth.code)).status).toBe(200);
    expect((await enrolWith(fourth.code)).status).toBe(401); // used
    const audit = await db.admin.query<{ n: number }>(
      "select count(*)::int as n from audit.ledger where resource_id = $1 and action = 'connectors.accounting.agent.enrol_refused'",
      [agentId],
    );
    expect(audit.rows[0]!.n).toBeGreaterThanOrEqual(8);
  });

  it("refuses unsigned, replayed, stale, altered, other-tenant, revoked and disabled calls", async () => {
    const { state, agentId } = await enrol(p, T, stub);
    const s = (await state.load())!;
    expect((await call(s, {})).status).toBe(200);
    expect(
      (
        await p.gateway.handle({
          method: "GET",
          path: TALLY_AGENT_API.jobs,
          headers: {},
          body: new Uint8Array(),
        })
      ).status,
    ).toBe(401);
    const seq = (nextSeq += 1_000);
    expect((await call(s, { seq })).status).toBe(200);
    expect((await call(s, { seq })).status).toBe(401); // replay
    expect((await call(s, { seq: seq - 1 })).status).toBe(401); // seq went back
    expect((await call(s, { now: new Date(Date.now() - 10 * 60_000) })).status).toBe(401);
    expect((await call(s, { kid: `tnt_t4/${agentId}` })).status).toBe(401);
    const forged = await call(s, {
      method: "POST",
      path: TALLY_AGENT_API.result.replace("{jobId}", "jrn-none-0001"),
      body: "{}",
    });
    expect(forged.status).toBe(400);
    disabled.add(T);
    expect((await call(s, {})).status).toBe(403);
    disabled.delete(T);
    // A new enrolment replaces this agent; then an explicit revoke of the new one.
    const next = await enrol(p, T, stub);
    expect((await call(s, {})).status).toBe(403);
    expect((await p.agents.get(admin(T), agentId))?.state).toBe("revoked");
    await p.agents.revoke(admin(T), next.agentId, "laptop lost");
    const ns = (await next.state.load())!;
    expect((await call(ns, {})).status).toBe(403);
    expect(await code(p.agents.revoke(admin(T), next.agentId, "again"))).toBe("IPB-UX-004");
  });

  it("holds one job in flight, accepts one result for it, and re-delivers it after a restart", async () => {
    const { state } = await enrol(p, T, stub);
    const s = (await state.load())!;
    const sink = sinkFor(T);
    await sink.post(batch("jrn-flight-0001"));
    await sink.post(batch("jrn-flight-0002"));
    const a = JSON.parse((await call(s, {})).body);
    expect(a.job).toMatchObject({ kind: "post", jobId: "jrn-flight-0001", attempt: 1 });
    const again = JSON.parse((await call(s, {})).body);
    expect(again.job.jobId).toBe("jrn-flight-0001"); // held, not the next one
    const path = (j: string) => TALLY_AGENT_API.result.replace("{jobId}", j);
    const ack = JSON.stringify({
      kind: "post",
      attempt: 1,
      outcome: "acknowledged",
      ledgerRefs: { "JV-1": "guid-1/1" },
    });
    expect(
      (await call(s, { method: "POST", path: path("jrn-flight-0002"), body: ack })).status,
    ).toBe(409);
    const partial = JSON.stringify({
      kind: "post",
      attempt: 1,
      outcome: "acknowledged",
      ledgerRefs: { "JV-9": "g" },
    });
    expect(
      (await call(s, { method: "POST", path: path("jrn-flight-0001"), body: partial })).status,
    ).toBe(400);
    expect(
      (await call(s, { method: "POST", path: path("jrn-flight-0001"), body: ack })).status,
    ).toBe(200);
    expect(
      (await call(s, { method: "POST", path: path("jrn-flight-0001"), body: ack })).status,
    ).toBe(409);
    expect(await sink.status("jrn-flight-0001")).toMatchObject({
      state: "ACKNOWLEDGED",
      ledgerRefs: { "JV-1": "guid-1/1" },
    });
    expect(JSON.parse((await call(s, {})).body).job.jobId).toBe("jrn-flight-0002");
    const ledger = await db.admin.query<{ action: string }>(
      "select action from audit.ledger where resource_id = 'jrn-flight-0001' order by seq",
    );
    expect(ledger.rows.map((r) => r.action)).toEqual([
      "connectors.accounting.post",
      "connectors.accounting.claim",
      "connectors.accounting.result_refused", // the batch's references incomplete
      "connectors.accounting.result",
      "connectors.accounting.result_refused", // the second result
    ]);
  });

  it("rejects agent_unreachable what no agent took in time, and refuses when off", async () => {
    const T4 = "tnt_t4";
    const sink = sinkFor(T4);
    await sink.post(batch("jrn-expire-0001"));
    await sink.post(batch("jrn-expire-0002"));
    await db.admin.query(
      "update connectors.tally_journal set queued_at = now() - interval '8 days' where tenant_id = $1",
      [T4],
    );
    expect(await sink.status("jrn-expire-0001")).toMatchObject({
      state: "REJECTED",
      reasonCode: "agent_unreachable",
    });
    expect(await sink.expireStale(maker(T4))).toBe(1);
    expect((await sink.status("jrn-expire-0002")).state).toBe("REJECTED");
    expect((await sink.replay("jrn-expire-0002")).attempts).toBe(2);
    expect(await sink.health()).toMatchObject({ status: "down", detail: { agent: "none" } });
    disabled.add(T4);
    const off = await code(sink.post(batch("jrn-expire-0003")));
    disabled.delete(T4);
    expect(off).toBe("IPB-PORT-001");
    expect(
      await code(
        new TallyAccountingSink({
          kernel: db.kernel,
          audit: db.audit,
          enabled: () => true,
          context: () => maker(T4),
        }).post({
          ...batch("jrn-big-00001"),
          entries: Array.from({ length: 1000 }, (_, i) => ({
            ...batch("x").entries[0]!,
            reference: `JV-${i}`,
            narration: "n".repeat(500),
            lines: Array.from({ length: 6 }, (_, k) => ({
              ledger: `L${"x".repeat(110)}${k}`,
              side: k % 2 ? ("credit" as const) : ("debit" as const),
              amountPaise: 1,
              narration: "m".repeat(400),
            })),
          })),
        }),
      ),
    ).toBe("IPB-UX-004");
  });

  it("keeps tenants apart and batches, acknowledgements and revocations immutable", async () => {
    const sink = sinkFor(T);
    await sink.post(batch("jrn-immut-0001"));
    expect(await code(sinkFor("tnt_t4").status("jrn-immut-0001"))).toBe("IPB-UX-004");
    const err = (sql: string) =>
      db.admin.query(sql).then(
        () => null,
        (e: Error) => e.message,
      );
    expect(
      await err(
        "update connectors.tally_journal set digest = repeat('0', 64) where journal_id = 'jrn-immut-0001'",
      ),
    ).toMatch(/never changes/);
    expect(
      await err(
        "update connectors.tally_journal set state = 'PENDING' where journal_id = 'jrn-flight-0001'",
      ),
    ).toMatch(/final/);
    expect(
      await err("update connectors.tally_agent set state = 'active' where state = 'revoked'"),
    ).toMatch(/final/);
    expect(
      await err("update connectors.tally_agent set jkt = repeat('A', 43) where state = 'active'"),
    ).toMatch(/set once/);
    // The poll role can move only last_seq and last_poll_at.
    const client = await db.pool.connect();
    try {
      await client.query("begin");
      await client.query("set local role svc_tally_poll");
      await client.query("select set_config('app.tenant_id', $1, true)", [T]);
      await expect(
        client.query("update connectors.tally_agent set state = 'revoked'"),
      ).rejects.toThrow(/permission denied/);
    } finally {
      await client.query("rollback");
      client.release();
    }
    expect(PortError).toBeDefined();
  });
});
