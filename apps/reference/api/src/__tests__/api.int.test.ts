// The reference API on PostgreSQL (PL6 plan §8.1, §8.2 steps 1 and 3 without Vidhi): the hello
// module's migration under forced RLS, the NN pattern suites against it (IPB-14 §14.5 item 4), and
// the HTTP journey with the fixture adapters: sign in with PKCE, create, list, retract through
// maker-checker, delete as an owner, agents refused.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import { validateEnv } from "@infrabyx/config/env";
import { newId } from "@infrabyx/crypto";
import { main as seedMain } from "@infrabyx/seed/cli";
import {
  agentContext,
  describeAuditChain,
  describeLockedActions,
  describeMakerChecker,
  describeSeedRefusal,
  describeTenantIsolation,
  startPostgres,
  withTenant,
  type TestDatabase,
} from "@infrabyx/testing";
import { BrandStudio } from "@infrabyx/brand";
import { CmsStudio } from "@infrabyx/cms";
import { PLATFORM_TENANT_ID } from "@infrabyx/contracts/ids";
import type { KernelContext } from "@infrabyx/contracts/kernel";
import type { VadDocument } from "@infrabyx/contracts/ports";
import { fixtureTrustDocuments } from "@infrabyx/testing";
import { createApp } from "../app.js";
import { apiEnvSchema, checkApiEnv } from "../env.js";
import { SESSION_COOKIE } from "../identity.js";
import { HELLO_ACTIONS } from "../modules/hello/index.js";
import { buildServices, type Services } from "../services.js";

const API_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const DEMO = "tnt_demo";
const SANDBOX = "tnt_sandbox";

let db: TestDatabase;
let services: Services;
let app: INestApplication;
let base: string;

beforeAll(async () => {
  db = await startPostgres({
    migrations: [{ name: "reference", dir: join(API_ROOT, "migrations") }],
  });
  for (const [id, name] of [
    [DEMO, "Demo Co"],
    [SANDBOX, "Sandbox"],
  ])
    await db.admin.query(
      `insert into tenancy.tenant (id, product, name) values ($1, 'LD', $2) on conflict (id) do nothing`,
      [id, name],
    );
  const r = await validateEnv(apiEnvSchema, {
    guards: [],
    source: {
      APP_ENV: "test",
      APP_BASE_URL: "http://127.0.0.1:0",
      DB_URL: db.url,
      APP_FIXTURE_ADAPTERS: "true",
    },
  });
  if (!r.ok) throw new Error(JSON.stringify(r.failures));
  services = await buildServices({ env: checkApiEnv(r.values), pool: db.pool });
  app = await createApp(services);
  await app.listen(0, "127.0.0.1");
  const addr = app.getHttpServer().address() as { port: number };
  base = `http://127.0.0.1:${addr.port}`;
});
afterAll(async () => {
  await app?.close();
  await services?.close();
  await db?.end();
});

/** Sign in as a fixture persona through the real redirects; returns the session cookie. */
async function signIn(persona: string): Promise<string> {
  const login = await fetch(`${base}/auth/login?persona=${persona}`, { redirect: "manual" });
  expect(login.status).toBe(302);
  const pkce = login.headers.get("set-cookie")!;
  const to = new URL(login.headers.get("location")!);
  const cb = await fetch(`${base}${to.pathname}${to.search}`, {
    redirect: "manual",
    headers: { cookie: pkce.split(";")[0]! },
  });
  expect(cb.status).toBe(303);
  const session = cb.headers.getSetCookie().find((c) => c.startsWith(`${SESSION_COOKIE}=`))!;
  return session.split(";")[0]!;
}

const api = (cookie: string, path: string, init: RequestInit = {}) =>
  fetch(`${base}${path}`, {
    ...init,
    headers: { cookie, "content-type": "application/json", ...(init.headers ?? {}) },
  });
const post = (cookie: string, path: string, body: unknown) =>
  api(cookie, path, { method: "POST", body: JSON.stringify(body) });
const json = async <T = Record<string, unknown>>(r: Response): Promise<T> => (await r.json()) as T;

describe("@IPB-01-AT-13 health", () => {
  it("live answers, ready reports the database and the adapters", async () => {
    expect(await json(await fetch(`${base}/health/live`))).toEqual({ status: "up" });
    const r = await fetch(`${base}/health/ready`);
    const body = await json<{ status: string; checks: Array<{ port: string }> }>(r);
    expect(r.status).toBe(200);
    expect(body.status).toBe("up");
    expect(body.checks.map((c) => c.port).sort()).toEqual([
      "AUTHZ",
      "DATABASE",
      "IDENTITY",
      "KMS",
      "LLM",
      "QUEUE",
      "STORAGE",
      "TRUST",
    ]);
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
  });
});

describe("sign-in with PKCE (IPB-02-01)", () => {
  it("rejects a callback whose state does not match, then signs a maker in", async () => {
    const bad = await fetch(`${base}/auth/callback?code=fixture:maker&state=x`, {
      redirect: "manual",
    });
    expect(bad.status).toBe(400);
    expect(bad.headers.get("content-type")).toMatch(/^application\/problem\+json/);
    expect((await json(bad)).code).toBe("IPB-API-400");
    const cookie = await signIn("maker");
    expect(await json(await api(cookie, "/auth/me"))).toMatchObject({
      tenantId: DEMO,
      roles: ["ORG_MAKER"],
      mfa: true,
    });
    const anon = await fetch(`${base}/auth/me`);
    expect(anon.status).toBe(401);
    expect((await json(anon)).code).toBe("IPB-API-401");
  });
});

describe("the hello module over HTTP", () => {
  it("a maker creates and lists, a member reads but cannot create, the setting bounds the length", async () => {
    const maker = await signIn("maker");
    const created = await post(maker, "/hello/greetings", { message: "  Hello, tenant  " });
    expect(created.status).toBe(201);
    const g = await json<{ id: string; message: string }>(created);
    expect(g.message).toBe("Hello, tenant");
    expect(g.id).toMatch(/^grt_/);
    const list = await json<{ greetings: Array<{ id: string }> }>(
      await api(maker, "/hello/greetings"),
    );
    expect(list.greetings.map((x) => x.id)).toContain(g.id);
    const member = await signIn("member");
    expect((await api(member, `/hello/greetings/${g.id}`)).status).toBe(200);
    expect((await post(member, "/hello/greetings", { message: "no" })).status).toBe(403);
    const long = await post(maker, "/hello/greetings", { message: "x".repeat(281) });
    expect(long.status).toBe(400);
    expect((await json(long)).code).toBe("IPB-UX-003");
    const other = await signIn("sandbox_owner");
    expect((await api(other, `/hello/greetings/${g.id}`)).status).toBe(404);
  });

  it("retracting is maker-checker: the maker asks, the checker approves, the greeting is retracted", async () => {
    const maker = await signIn("maker");
    const g = await json<{ id: string }>(
      await post(maker, "/hello/greetings", { message: "Retract me" }),
    );
    const req = await post(maker, `/hello/greetings/${g.id}/retract`, { reason: "typo" });
    expect(req.status).toBe(202);
    const { approvalId } = await json<{ approvalId: string }>(req);
    const self = await post(maker, `/approvals/${approvalId}/decide`, { decision: "approve" });
    expect((await json(self)).code).toBe("IPB-SEC-007");
    const checker = await signIn("checker");
    const decided = await post(checker, `/approvals/${approvalId}/decide`, { decision: "approve" });
    expect(decided.status).toBe(201);
    expect((await json(decided)).state).toBe("executed");
    const after = await json<{ retractedAt: string | null; retractReason: string | null }>(
      await api(maker, `/hello/greetings/${g.id}`),
    );
    expect(after.retractReason).toBe("typo");
    expect(after.retractedAt).not.toBeNull();
  });

  it("only an owner deletes, and the ledger and outbox record every write", async () => {
    const maker = await signIn("maker");
    const g = await json<{ id: string }>(
      await post(maker, "/hello/greetings", { message: "Delete me" }),
    );
    expect((await api(maker, `/hello/greetings/${g.id}`, { method: "DELETE" })).status).toBe(403);
    const owner = await signIn("owner");
    expect((await api(owner, `/hello/greetings/${g.id}`, { method: "DELETE" })).status).toBe(204);
    expect((await api(owner, `/hello/greetings/${g.id}`)).status).toBe(404);
    const ledger = await db.admin.query<{ action: string }>(
      `select action from audit.ledger where resource_id = $1 order by seq`,
      [g.id],
    );
    expect(ledger.rows.map((r) => r.action)).toEqual([HELLO_ACTIONS.create, HELLO_ACTIONS.delete]);
    const outbox = await db.admin.query<{ type: string }>(
      `select type from hello.outbox where envelope->'data'->>'greeting_id' = $1 order by created_at`,
      [g.id],
    );
    expect(outbox.rows.map((r) => r.type)).toEqual([
      "in.ld.hello.GreetingCreated.v1",
      "in.ld.hello.GreetingDeleted.v1",
    ]);
  });
});

describe("the gate endpoints (PL6 plan §8.2)", () => {
  const staff = (id: string, roles: string[]): KernelContext => ({
    tenantId: PLATFORM_TENANT_ID,
    scope: "platform",
    principal: { id, type: "service", roles },
  });
  const editor = staff("svc_test_editor", ["PLT_CONTENT_EDITOR"]);
  const checker = staff("svc_test_checker", ["PLT_SUPER_ADMIN"]);
  let packId = "";

  beforeAll(async () => {
    // A brand pack with one published page, as the Studio (and the public-site seed) make them.
    const base = { kernel: db.kernel, audit: db.audit, product: "LD" };
    const brand = new BrandStudio({
      ...base,
      storage: services.storage,
      hooks: {
        emailIdentityVerified: async () => false,
        policySetPublished: async () => true,
      },
    });
    packId = (await brand.createPack(checker, { product: "LD", label: "Reference" })).id;
    const cms = new CmsStudio(base);
    const { item } = await cms.createItem(editor, {
      type: "page",
      packId,
      source: "seed",
      title: "Welcome",
      slug: "welcome",
      body: {
        template: "article",
        blocks: [
          {
            type: "rich_text",
            slot: "body",
            content: [
              {
                _type: "block",
                style: "normal",
                children: [{ _type: "span", text: "The reference application's welcome page." }],
                markDefs: [],
              },
            ],
          },
        ],
      },
    });
    await cms.submit(editor, item.id);
    await cms.approve(checker, item.id);
    await cms.publishNow(checker, item.id);
    // The trust mirror from the fixture feed, as the public-site seed fills it.
    const announced = (d: VadDocument) =>
      Object.fromEntries(
        Object.entries(d).filter(([k]) => !["type_key", "state", "issuer_name"].includes(k)),
      );
    // OH publishes to the products it names; the fixture names OH only, so the test adds ours.
    for (const d of fixtureTrustDocuments())
      await services.mirror.onPublished({
        eventId: `evt_test_${d.vad_id}_${d.version}`,
        data: announced({
          ...d,
          publication_targets: [...d.publication_targets, services.product],
        }),
      });
  });

  it("serves published content by pack, locale and path, and 404 for the rest", async () => {
    const r = await fetch(`${base}/content/${packId}/en-IN/welcome`);
    expect(r.status).toBe(200);
    const page = await json<{ title: string; path: string; lang: string }>(r);
    expect(page.title).toBe("Welcome");
    expect(page.lang).toBe("en-IN");
    expect((await fetch(`${base}/content/${packId}/en-IN/nowhere`)).status).toBe(404);
    expect((await fetch(`${base}/content/brd_nope/en-IN/welcome`)).status).toBe(400);
  });

  it("the Trust Centre shows the mirrored public documents and counts the gated ones", async () => {
    const r = await fetch(`${base}/trust`);
    expect(r.status).toBe(200);
    const centre = await json<{
      documents: Array<{ title: string }>;
      gatedAvailable: number;
      stale: boolean;
    }>(r);
    expect(centre.documents.map((d) => d.title)).toContain("Sub-processor list");
    expect(centre.gatedAvailable).toBeGreaterThanOrEqual(1);
    expect(centre.stale).toBe(false);
  });

  it("the hello skill: the agent summarises at L1 and proposes; a checker approves the post", async () => {
    const maker = await signIn("maker");
    await post(maker, "/hello/greetings", { message: "Vidhi summarises this one" });
    const r = await post(maker, "/vidhi/hello/summarise", {});
    expect(r.status, await r.clone().text()).toBe(202);
    const t = await json<{ taskId: string; approvalId: string; summary: string; count: number }>(r);
    expect(t.summary).toMatch(/greetings?; the latest says/);
    expect(t.count).toBeGreaterThanOrEqual(1);
    const task = await json<{ state: string }>(await api(maker, `/vidhi/tasks/${t.taskId}`));
    expect(task.state).toBe("DONE");
    // A member holds no checker role; the proposal waits for a checker.
    const member = await signIn("member");
    const notChecker = await post(member, `/approvals/${t.approvalId}/decide`, {
      decision: "approve",
    });
    expect(notChecker.status).toBeGreaterThanOrEqual(400);
    const checkerCookie = await signIn("checker");
    const decided = await post(checkerCookie, `/approvals/${t.approvalId}/decide`, {
      decision: "approve",
    });
    expect(decided.status, await decided.clone().text()).toBe(201);
    expect((await json<{ state: string }>(decided)).state).toBe("executed");
    const list = await json<{ greetings: Array<{ message: string; createdBy: string }> }>(
      await api(maker, "/hello/greetings"),
    );
    const posted = list.greetings.find((g) => g.message.startsWith("Summary: "));
    expect(posted?.message).toBe(`Summary: ${t.summary}`);
    // Posted under the checker's identity, as every approved action is; never by the agent.
    expect(posted?.createdBy).not.toBe("agt_vidhi");
  });

  it("the export: an owner requests, the worker's handler runs it, the download is a signed link", async () => {
    const { exportJobHandler } = await import("../worker.js");
    const owner = await signIn("owner");
    const r = await post(owner, "/export", { scope: { type: "FULL_TENANT" } });
    expect(r.status, await r.clone().text()).toBe(202);
    const job = await json<{ id: string; state: string }>(r);
    expect(job.state).toBe("requested");
    await exportJobHandler(services)({ name: "run", data: { tenantId: DEMO, jobId: job.id } });
    const done = await json<{ state: string; archiveId: string | null; fileCount: number | null }>(
      await api(owner, `/export/${job.id}`),
    );
    expect(done.state).toBe("completed");
    expect(done.archiveId).toMatch(/^arc_/);
    expect(done.fileCount).toBeGreaterThan(0);
    const link = await json<{ url: string; sha256: string }>(
      await api(owner, `/export/archives/${done.archiveId}/download`),
    );
    expect(link.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(link.url).toBeTruthy();
    // A member may not export, and an admin's request waits for the owner.
    const member = await signIn("member");
    expect((await post(member, "/export", { scope: { type: "FULL_TENANT" } })).status).toBe(403);
    const admin = await signIn("admin");
    const sub = await post(admin, "/export", { scope: { type: "FULL_TENANT" } });
    expect(sub.status).toBe(202);
    expect((await json<{ approvalId: string }>(sub)).approvalId).toMatch(/^apr_/);
  });
});

describe("the outbox relay (IPB-01 §01.4.3.3)", () => {
  it("hands each committed event to the events queue once and marks it dispatched", async () => {
    const { OutboxRelay, EVENTS_QUEUE } = await import("../relay.js");
    const { MemoryQueue } = await import("../fixtures.js");
    const queue = new MemoryQueue();
    const relay = new OutboxRelay({
      kernel: db.kernel,
      audit: db.audit,
      queue,
      schemas: ["hello"],
    });
    const g = await services.hello.create(withTenant(DEMO, ["ORG_MAKER"]), { message: "relayed" });
    const first = await relay.once();
    expect(first).toBeGreaterThanOrEqual(1);
    const mine = queue.jobs.filter(
      (j) =>
        j.queue === EVENTS_QUEUE &&
        (JSON.parse(String(j.job.data.envelope)) as { data?: { greeting_id?: string } }).data
          ?.greeting_id === g.id,
    );
    expect(mine.map((j) => j.job.name)).toEqual(["in.ld.hello.GreetingCreated.v1"]);
    expect(await relay.once()).toBe(0);
    const left = await db.admin.query(
      "select count(*)::int as n from hello.outbox where dispatched_at is null",
    );
    expect(left.rows[0]?.n).toBe(0);
    const ledger = await db.admin.query(
      "select count(*)::int as n from audit.ledger where action = 'hello.outbox.dispatch'",
    );
    expect(ledger.rows[0]?.n).toBeGreaterThanOrEqual(1);
  });
});

describe("NN pattern suites on hello.greeting", () => {
  describeTenantIsolation({
    db: () => db,
    table: "hello.greeting",
    tenantA: DEMO,
    tenantB: SANDBOX,
    insert: async (tx) => {
      const id = newId("grt");
      await tx.query(
        `insert into hello.greeting (id, tenant_id, message, created_by) values ($1, $2, 'nn', 'usr_nn01')`,
        [id, tx.ctx.tenantId],
      );
      await db.audit.record(tx, {
        action: HELLO_ACTIONS.create,
        resourceType: "hello_greeting",
        resourceId: id,
      });
      return id;
    },
    select: async (tx, id) =>
      (await tx.query(`select id from hello.greeting where id = $1`, [id])).rows,
  });
  describeAuditChain({
    db: () => db,
    tenantId: DEMO,
    mutate: async () => {
      await services.hello.create(withTenant(DEMO, ["ORG_MAKER"]), { message: "chain" });
    },
  });
  describeMakerChecker({
    db: () => db,
    engine: () => services.approvals,
    request: {
      action: HELLO_ACTIONS.retract,
      riskClass: "R2",
      payload: { greeting_id: newId("grt"), reason: "nn" },
    },
    maker: withTenant(DEMO, ["ORG_MAKER"], { principal: { id: "usr_nn_maker" } }),
    checker: withTenant(DEMO, ["ORG_CHECKER"], { principal: { id: "usr_nn_checker" } }),
    agent: agentContext(DEMO),
  });
  describeLockedActions({
    db: () => db,
    actions: [HELLO_ACTIONS.delete],
    agent: agentContext(DEMO),
  });
  describeSeedRefusal({
    entrypoint: (env) =>
      seedMain(["run", "--profile", "dev"], {
        APP_ENV: env.APP_ENV,
        SEED_ENABLED: String(env.SEED_ENABLED),
        APP_PRODUCT: "LD",
        DB_URL: db.url,
      }),
  });
});
