// How a TallyPrime agent keeps its key and how long it may use it (owner answer #136 (4);
// R1-D-184; `connectors/0008`): the enrolment record says `dpapi` or `file` (a warning), the
// agent's view warns from day 80, and from day 90 its requests are refused until it is enrolled
// again. The key's protection is set once with the key.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TALLY_AGENT_API } from "@infrabyx/contracts/ports";
import { importAgentPrivateKey, signAgentRequest } from "@infrabyx/crypto";
import { ApprovalsEngine, PgOutbox } from "@infrabyx/tenancy";
import { startPostgres, withTenant, type TestDatabase } from "@infrabyx/testing";
import {
  DpapiKeyGuard,
  MemoryStateStore,
  TallyAgent,
  TallyClient,
  type AgentState,
  type PlatformFetch,
  type Runner,
} from "@infrabyx/tally-agent";
import { TallyPrimeStub } from "@infrabyx/tally-agent/stub";
import { TallyAgentGateway, TallyAgentService } from "../accounting/index.js";

let db: TestDatabase;
const T = "tnt_k1";
const DAY = 86_400_000;
beforeAll(async () => {
  db = await startPostgres();
  await db.admin.query(
    `insert into tenancy.tenant (id, product, name) values ('${T}', 'FBX', '${T}') on conflict do nothing`,
  );
});
afterAll(async () => db?.end());

const maker = () => withTenant(T, ["ORG_ADMIN"], { principal: { id: "usr_maker" } });
const checker = () => withTenant(T, ["ORG_CHECKER"], { principal: { id: "usr_checker" } });
const admin = () => withTenant(T, ["ORG_ADMIN"], { principal: { id: "usr_admin" } });

function platform(now?: () => Date) {
  const approvals = new ApprovalsEngine({
    kernel: db.kernel,
    audit: db.audit,
    outbox: new PgOutbox(),
    product: "FBX",
  });
  const agents = new TallyAgentService({
    kernel: db.kernel,
    audit: db.audit,
    approvals,
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
  return { approvals, agents, gateway, fetch };
}

/** "Protects" by reversing the bytes: stands in for Windows PowerShell and DPAPI. */
const reversing: Runner = async (_exe, _args, stdin) => ({
  code: 0,
  stdout: Buffer.from(stdin.split(" ")[0]!, "base64").reverse().toString("base64"),
});

async function enrol(p: ReturnType<typeof platform>, keyGuard?: DpapiKeyGuard) {
  const { approvalId, agentId } = await p.agents.requestEnrolment(maker(), {
    name: "Head office",
    company: "Acme Finance Pvt Ltd",
  });
  await p.approvals.decide(checker(), approvalId, "approve");
  const { code } = await p.agents.issueCode(admin(), agentId);
  const state = new MemoryStateStore();
  await new TallyAgent({
    platformUrl: "https://api.example.in",
    tally: new TallyClient({ url: "http://127.0.0.1:9000", fetch: new TallyPrimeStub().fetch }),
    state,
    fetch: p.fetch,
    ...(keyGuard ? { keyGuard } : {}),
  }).enrol(code);
  return { agentId, state: (await state.load())! };
}

let seq = Date.now() + 1_000_000;
const signed = (p: ReturnType<typeof platform>, s: AgentState, pem: string, now: Date) => {
  const body = new Uint8Array();
  const n = ++seq;
  const jws = signAgentRequest({
    privateKey: importAgentPrivateKey(pem),
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

describe("the agent's key: its protection and its 90 days (#136 (4), connectors/0008)", () => {
  it("records dpapi for a key under DPAPI, with no warning", async () => {
    const p = platform();
    const { agentId } = await enrol(p, new DpapiKeyGuard({ run: reversing }));
    const v = await p.agents.get(admin(), agentId);
    expect(v).toMatchObject({ keyProtection: "dpapi", warnings: [], rotationDue: false });
    const row = await db.admin.query(
      "select key_protection from connectors.tally_agent where id = $1",
      [agentId],
    );
    expect(row.rows[0].key_protection).toBe("dpapi");
  });

  it("records a key kept in a file as a warning, on the view and the ledger digest", async () => {
    const p = platform();
    const { agentId } = await enrol(p);
    const v = (await p.agents.get(admin(), agentId))!;
    expect(v.keyProtection).toBe("file");
    expect(v.warnings).toEqual(["key_unencrypted"]);
    expect(new Date(v.keyExpiresAt!).getTime() - new Date(v.enrolledAt!).getTime()).toBe(90 * DAY);
    // The activation is ledgered (the entry keeps a digest of `key_protection` and the warning).
    const entry = await db.admin.query(
      `select after_digest from audit.ledger where tenant_id = $1 and resource_id = $2
          and action = 'connectors.accounting.agent.activate'`,
      [T, agentId],
    );
    expect(entry.rows[0]?.after_digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("warns from day 80 and refuses the key from day 90", async () => {
    const p = platform();
    const { agentId, state } = await enrol(p);
    const pem = state.privateKeyPem!;
    expect((await signed(p, state, pem, new Date())).status).toBe(200);
    const at = (days: number) => new Date(Date.now() + days * DAY);
    const day79 = platform(() => at(79));
    expect((await day79.agents.get(admin(), agentId))!.rotationDue).toBe(false);
    const day81 = platform(() => at(81));
    expect((await day81.agents.get(admin(), agentId))!.rotationDue).toBe(true);
    expect((await signed(day81, state, pem, at(81))).status).toBe(200);
    const day91 = platform(() => at(91));
    const v = (await day91.agents.get(admin(), agentId))!;
    expect(v.warnings).toContain("key_expired");
    const r = await signed(day91, state, pem, at(91));
    expect(r.status).toBe(403);
    expect(r.body).toMatch(/expired/);
  });

  it("keeps the key's protection set once, with the key", async () => {
    const p = platform();
    const { agentId } = await enrol(p);
    await expect(
      db.admin.query("update connectors.tally_agent set key_protection = 'dpapi' where id = $1", [
        agentId,
      ]),
    ).rejects.toThrow(/set once/);
  });
});
