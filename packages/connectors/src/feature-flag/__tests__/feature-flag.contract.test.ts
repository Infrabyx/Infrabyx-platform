// FEATURE_FLAG contract legs (PL2 plan §6.4). Hermetic: Unleash OSS 8.2.0 on PostgreSQL 18 for the
// reference adapter, and the platform database for `config-db`. Tokens are generated per run.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  FlagService,
  MemorySnapshotStore,
  defaultFlagRegistry,
  type FlagDef,
} from "@infrabyx/config/flags";
import {
  defineContractSuite,
  startPostgres,
  startService,
  type StartedService,
  type TestDatabase,
} from "@infrabyx/testing";
import { randomBytes, toHex } from "@infrabyx/crypto";
import { ConfigDbFlags } from "../config-db.js";
import { UnleashFlags, type UnleashOptions } from "../unleash.js";

const ENV = "development";
const ADMIN = `*:*.${toHex(randomBytes(16))}`;
const CLIENT = `default:${ENV}.${toHex(randomBytes(16))}`;
const HASH_A = "a".repeat(32);
const HASH_B = "b".repeat(32);

let db: TestDatabase;
let unleash: StartedService;
let url: string;
const started: UnleashFlags[] = [];

beforeAll(async () => {
  db = await startPostgres();
  const dbName = `unleash_${toHex(randomBytes(4))}`;
  await db.admin.query(`create database ${dbName}`);
  const pg = new URL(db.url);
  pg.hostname = "host.docker.internal";
  pg.pathname = `/${dbName}`;
  unleash = await startService("unleash", {
    ports: [4242],
    env: {
      DATABASE_URL: pg.toString(),
      DATABASE_SSL: "false",
      INIT_ADMIN_API_TOKENS: ADMIN,
      INIT_CLIENT_API_TOKENS: CLIENT,
    },
    configure: (c) =>
      c.withExtraHosts([{ host: "host.docker.internal", ipAddress: "host-gateway" }]),
  });
  url = `http://${unleash.host}:${unleash.ports[4242]}`;
  for (let i = 0; i < 90; i++) {
    if (
      await fetch(`${url}/health`).then(
        (r) => r.ok,
        () => false,
      )
    )
      break;
    await new Promise((r) => setTimeout(r, 1000));
  }
});
afterAll(async () => {
  for (const a of started) a.stop();
  await unleash?.stop();
  await db?.end();
});

const opts = (over: Partial<UnleashOptions> = {}): UnleashOptions => ({
  url,
  appName: "contract",
  environment: ENV,
  clientToken: CLIENT,
  adminToken: ADMIN,
  refreshIntervalMs: 500,
  allowLoopbackHttp: true,
  ...over,
});
async function adapter(over: Partial<UnleashOptions> = {}) {
  const a = await UnleashFlags.start(opts(over));
  started.push(a);
  return a;
}
async function admin(path: string, method = "GET", body?: unknown) {
  const r = await fetch(`${url}/api/admin/projects/default${path}`, {
    method,
    headers: { authorization: ADMIN, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${await r.text()}`);
  return r;
}
/** Wait until the adapter's next poll shows `check` true. */
async function eventually(check: () => Promise<boolean>) {
  for (let i = 0; i < 40; i++) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("condition not reached");
}

describe("@IPB-01-15 FEATURE_FLAG hermetic leg: unleash", () => {
  defineContractSuite("FEATURE_FLAG", () => adapter(), [], { leg: "hermetic" });

  it("@IPB-09-24 registry sync creates every exact flag once and is idempotent", async () => {
    const a = await adapter();
    const defs = defaultFlagRegistry.all();
    const synced = defs.filter((d) => !d.pattern && !d.locked && d.state !== "removed");
    const first = await a.syncRegistry(defs);
    expect(first.created.sort()).toEqual(synced.map((d) => d.key).sort());
    const second = await a.syncRegistry(defs);
    expect(second).toMatchObject({ created: [], updated: [] });
    expect(second.unchanged).toHaveLength(synced.length);
    const kill = await (await admin("/features/kill.payments")).json();
    expect(kill).toMatchObject({ type: "kill-switch" });
    expect(kill.description).toContain("owner PLT_SECURITY_OFFICER");
    const changed: FlagDef[] = synced.map((d) =>
      d.key === "kill.payments" ? { ...d, description: "Stop payments" } : d,
    );
    expect((await a.syncRegistry(changed)).updated).toEqual(["kill.payments"]);
    // Default-on fut.* flags start enabled; kill switches start off.
    const on = synced.find((d) => d.kind === "fut" && d.default);
    if (on) await eventually(() => a.getBooleanValue(on.key, false));
    expect(await a.getBooleanValue("kill.payments", true)).toBe(false);
  });

  it("evaluates typed values from variants", async () => {
    await admin("/features", "POST", { name: "ops.contract-typed", type: "operational" });
    const env = `/features/ops.contract-typed/environments/${ENV}`;
    await admin(`${env}/strategies`, "POST", {
      name: "flexibleRollout",
      parameters: { rollout: "100", stickiness: "default", groupId: "t" },
      variants: [
        {
          name: "v",
          weight: 1000,
          weightType: "variable",
          stickiness: "default",
          payload: { type: "json", value: '{"limit":5}' },
        },
      ],
    });
    await admin(`${env}/on`, "POST");
    const a = await adapter();
    await eventually(
      async () =>
        (await a.getObjectValue<{ limit?: number }>("ops.contract-typed", {})).limit === 5,
    );
    expect(await a.getStringValue("ops.contract-typed", "d")).toBe('{"limit":5}');
    expect(await a.getNumberValue("ops.contract-typed", 7)).toBe(7);
    expect(await a.getStringValue("ops.contract-missing", "d")).toBe("d");
  });

  it("targets by hashed tenant and refuses raw identifiers (C-21)", async () => {
    await admin("/features", "POST", { name: "exp.contract-tenant", type: "experiment" });
    const env = `/features/exp.contract-tenant/environments/${ENV}`;
    await admin(`${env}/strategies`, "POST", {
      name: "flexibleRollout",
      parameters: { rollout: "100", stickiness: "default", groupId: "t" },
      constraints: [{ contextName: "tenantKey", operator: "IN", values: [HASH_A] }],
    });
    await admin(`${env}/on`, "POST");
    const a = await adapter();
    await eventually(() => a.getBooleanValue("exp.contract-tenant", false, { tenantKey: HASH_A }));
    expect(await a.getBooleanValue("exp.contract-tenant", false, { tenantKey: HASH_B })).toBe(
      false,
    );
    await expect(
      a.getBooleanValue("exp.contract-tenant", false, { tenantKey: "tnt_a" }),
    ).rejects.toMatchObject({
      code: "IPB-PORT-003",
    });
  });

  it("governed write switches a kill switch on, and the client sees it", async () => {
    const a = await adapter();
    await a.setValue("kill.payments", true, "usr_release_manager");
    await eventually(() => a.getBooleanValue("kill.payments", false));
    await a.setValue("kill.payments", false, "usr_release_manager");
    await eventually(async () => !(await a.getBooleanValue("kill.payments", true)));
    await expect(a.setValue("kill.payments", "x", "u")).rejects.toMatchObject({
      code: "IPB-PORT-001",
    });
    expect(await a.listFlags("kill.")).toContain("kill.payments");
  });

  it("@IPB-02-AT-20 snapshot fallback, then kill.payments on when the snapshot is stale", async () => {
    let t = Date.now();
    const a = await adapter({ now: () => t, maxStalenessMs: 2000 });
    const snapshots = new MemorySnapshotStore();
    const flags = new FlagService({ provider: a, snapshots, now: () => t });
    await a.setValue("kill.payments", false, "u");
    await flags.refreshSnapshot();
    expect(await flags.evaluate("kill.payments")).toMatchObject({
      value: false,
      source: "provider",
    });
    a.stop(); // provider down: no more polls
    t += 60_000;
    expect(await flags.evaluate("kill.payments")).toMatchObject({
      value: false,
      source: "snapshot",
    });
    t += 25 * 3_600_000;
    expect(await flags.evaluate("kill.payments")).toMatchObject({
      value: true,
      source: "safe-state",
    });
    expect((await a.health()).status).toBe("down");
  });

  it("an unreachable Unleash never serves values: FlagService falls to the safe state", async () => {
    const a = await UnleashFlags.start(opts({ url: "http://127.0.0.1:9" }), 1500);
    started.push(a);
    const flags = new FlagService({ provider: a, snapshots: new MemorySnapshotStore() });
    expect(await flags.evaluate("kill.payments")).toMatchObject({
      value: true,
      source: "safe-state",
    });
  });
});

describe("@IPB-01-15 FEATURE_FLAG hermetic leg: config-db", () => {
  defineContractSuite(
    "FEATURE_FLAG",
    () => new ConfigDbFlags(db.pool),
    [
      {
        name: "typed values round-trip through config.flag_value",
        async run(p) {
          await p.setValue("ops.contract-typed", { limit: 5 }, "usr_test");
          await p.setValue("ops.contract-name", "blue", "usr_test");
          expect(await p.getObjectValue("ops.contract-typed", {})).toEqual({ limit: 5 });
          expect(await p.getStringValue("ops.contract-name", "d")).toBe("blue");
          expect(await p.getNumberValue("ops.contract-name", 3)).toBe(3);
        },
      },
      {
        name: "targeting is unsupported; raw identifiers are still refused",
        method: "targeting",
        async run() {},
      },
    ],
    { leg: "hermetic" },
  );

  it("refuses a raw tenant identifier in the context (C-21)", async () => {
    await expect(
      new ConfigDbFlags(db.pool).getBooleanValue("kill.payments", false, { tenantKey: "tnt_a" }),
    ).rejects.toMatchObject({
      code: "IPB-PORT-003",
    });
  });
});
