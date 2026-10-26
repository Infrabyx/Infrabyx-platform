import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { IpbError } from "@infrabyx/contracts/errors";
import { AuditService, PgAuditSink } from "@infrabyx/audit";
import { defaultFlagRegistry } from "@infrabyx/config/flags";
import { MemorySettingsStore, SettingsService, defaultRegistry } from "@infrabyx/config/settings";
import { PgKernel, PgOutbox } from "@infrabyx/tenancy";
import { SEED_TENANT_IDS, defineSeedModule, runSeed, type RunSeedOptions } from "./framework.js";
import { SUPER_ADMIN_EMAIL } from "./personas/index.js";
import { personaUserId, platformSeedModule } from "./platform.js";
import { purgeSeed } from "./purge.js";
import { synthetic } from "./synthetic.js";
import { freshDb } from "./__tests__/db.js";

type Db = Awaited<ReturnType<typeof freshDb>>;
const env = { APP_ENV: "test" as const, SEED_ENABLED: true };

// A product-style module: legal entities in the demo tenant, all synthetic.
const entities = defineSeedModule({
  module: "entities",
  profiles: ["dev", "demo", "test"],
  dependsOn: ["platform"],
  async run(ctx) {
    await ctx.write("demo", async (w) => {
      for (let i = 0; i < 5; i++) {
        await w.upsert({
          table: "tenancy.legal_entity",
          key: { tenant_id: ctx.tenantIds.demo, name: `Demo Co Unit ${i + 1}` },
          id: { prefix: "ent" },
          values: { cin: synthetic.cin(ctx.faker), gstin: synthetic.gstin(ctx.faker) },
        });
      }
    });
  },
});

const opts = (db: Db, over: Partial<RunSeedOptions> = {}): RunSeedOptions => ({
  kernel: new PgKernel({ pool: db.pool }),
  audit: new PgAuditSink(),
  outbox: new PgOutbox(),
  env,
  product: "FBX",
  profile: "test",
  modules: [entities, platformSeedModule],
  randomSeed: 20261025,
  ...over,
});

async function dump(db: Db): Promise<string> {
  const q = async (sql: string) => JSON.stringify((await db.admin.query(sql)).rows);
  return [
    await q(
      "select id, org_id, product, name, status, residency, brand_id, plan_ref from tenancy.tenant order by id",
    ),
    await q("select id, idp_subject, type, status from tenancy.user order by id"),
    await q(
      "select tenant_id, user_id, roles, entity_ids, product_scope from tenancy.membership order by tenant_id, user_id",
    ),
    await q("select id, tenant_id, name, cin, gstin from tenancy.legal_entity order by id"),
    await q("select flag_key, value from config.flag_value order by flag_key"),
  ].join("\n");
}

let a: Db;
let b: Db;
beforeAll(async () => {
  [a, b] = await Promise.all([freshDb(), freshDb()]);
});
afterAll(async () => Promise.all([a?.end(), b?.end()]));

describe("@IPB-11-AT-02 @IPB-11-AT-03 platform seed", () => {
  it("creates the three tenants and the super admin as PLT_SUPER_ADMIN in tnt_platform", async () => {
    const r = await runSeed(opts(a));
    expect(r.totals.inserted).toBeGreaterThan(0);
    expect(
      (await a.admin.query("select id from tenancy.tenant order by id")).rows.map((x) => x.id),
    ).toEqual(["tnt_demo", "tnt_platform", "tnt_sandbox"]);
    const m = await a.admin.query(
      "select roles from tenancy.membership where tenant_id = 'tnt_platform' and user_id = $1",
      [personaUserId(SUPER_ADMIN_EMAIL)],
    );
    expect(m.rows[0]?.roles).toEqual(["PLT_SUPER_ADMIN"]);
    const sandbox = await a.admin.query(
      "select count(*)::int as n from tenancy.membership where tenant_id = 'tnt_sandbox'",
    );
    expect(sandbox.rows[0].n).toBe(1);
  });
  it("is idempotent: a second run reports 0 inserted / 0 updated", async () => {
    const before = await dump(a);
    const r = await runSeed(opts(a));
    expect(r.totals).toMatchObject({ inserted: 0, updated: 0 });
    expect(r.totals.unchanged).toBeGreaterThan(0);
    expect(await dump(a)).toBe(before);
  });
  it("is deterministic: two databases seeded from the same seed are byte-identical (IPB-11-23)", async () => {
    await runSeed(opts(b));
    expect(await dump(b)).toBe(await dump(a));
  });
  it("registers every switchable fut.* flag OFF and leaves settings at registry defaults (IPB-11-29)", async () => {
    const flags = await a.admin.query<{ flag_key: string; value: boolean }>(
      "select flag_key, value from config.flag_value",
    );
    const fut = defaultFlagRegistry.all().filter((f) => f.kind === "fut");
    expect(flags.rows.length).toBe(fut.filter((f) => !f.locked).length);
    expect(flags.rows.every((f) => f.value === false)).toBe(true);
    expect(
      (await a.admin.query("select count(*)::int as n from config.setting_value")).rows[0].n,
    ).toBe(0);
    const svc = new SettingsService({
      store: new MemorySettingsStore(),
      kernel: new PgKernel({ pool: a.pool }),
      audit: new PgAuditSink(),
      product: "FBX",
    });
    const ctx = {
      tenantId: "tnt_demo",
      principal: { id: "usr_x", type: "user" as const, roles: [] },
    };
    for (const def of defaultRegistry
      .all()
      .filter((d) => !d.pattern)
      .slice(0, 25)) {
      expect((await svc.explain(ctx, def.key)).from).toBe("default");
    }
  });
  it("writes the ledger for every seed transaction and the chain verifies", async () => {
    const audit = new AuditService({
      kernel: new PgKernel({ pool: a.pool }),
      sink: new PgAuditSink(),
      product: "FBX",
    });
    const actor = { id: "svc_verify", type: "service" as const, roles: [] };
    for (const t of Object.values(SEED_TENANT_IDS)) {
      const entries = await audit.query({ tenantId: t, principal: actor });
      expect(entries.some((e) => e.action === "seed.module.apply")).toBe(true);
      expect((await audit.verify({ tenantId: t, principal: actor })).ok).toBe(true);
    }
  });
});

describe("IPB-11-25 synthetic only", () => {
  it("a module writing a real-looking PAN fails with IPB-SEED-004 and writes nothing", async () => {
    const bad = defineSeedModule({
      module: "bad",
      profiles: ["test"],
      async run(ctx) {
        await ctx.write("demo", (w) =>
          w
            .upsert({
              table: "tenancy.legal_entity",
              key: { tenant_id: "tnt_demo", name: "Real Co" },
              id: { prefix: "ent" },
              values: { cin: "ABCDE1234F" },
            })
            .then(() => undefined),
        );
      },
    });
    const e = await runSeed(opts(a, { modules: [platformSeedModule, bad] })).then(
      () => null,
      (x: IpbError) => x.code,
    );
    expect(e).toBe("IPB-SEED-004");
    expect(
      (await a.admin.query("select 1 from tenancy.legal_entity where name = 'Real Co'")).rowCount,
    ).toBe(0);
  });
  it("refuses to run in production (IPB-SEED-001) and emits SeedRefused", async () => {
    const events: Array<Record<string, unknown>> = [];
    const e = await runSeed(
      opts(a, { env: { APP_ENV: "prod", SEED_ENABLED: true }, onRefused: (ev) => events.push(ev) }),
    ).then(
      () => null,
      (x: IpbError) => x.code,
    );
    expect(e).toBe("IPB-SEED-001");
    expect(events[0]?.type).toBe("in.fbx.seed.SeedRefused.v1");
  });
});

describe("IPB-11-31 purge", () => {
  it("removes exactly what the profile created, keeps other rows, and refuses in prod", async () => {
    await a.admin.query(
      "insert into tenancy.tenant (id, product, name) values ('tnt_customer', 'FBX', 'Real customer')",
    );
    expect(
      await purgeSeed(a.admin, { APP_ENV: "prod", SEED_ENABLED: true }, "test").then(
        () => null,
        (x: IpbError) => x.code,
      ),
    ).toBe("IPB-SEED-001");
    const r = await purgeSeed(a.admin, env, "test");
    expect(r.deleted).toBeGreaterThan(0);
    expect((await a.admin.query("select id from tenancy.tenant")).rows.map((x) => x.id)).toEqual([
      "tnt_customer",
    ]);
    expect(
      (await a.admin.query("select count(*)::int as n from tenancy.membership")).rows[0].n,
    ).toBe(0);
    expect(
      (await a.admin.query("select count(*)::int as n from seed.seed_row where profile = 'test'"))
        .rows[0].n,
    ).toBe(0);
    expect(
      (
        await a.admin.query(
          "select count(*)::int as n from audit.ledger where action = 'seed.profile.purge'",
        )
      ).rows[0].n,
    ).toBe(1);
  });
});
