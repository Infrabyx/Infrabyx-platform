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
      "QUEUE",
      "STORAGE",
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
