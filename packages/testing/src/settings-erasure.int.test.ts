// DPDP erasure of a person's USER settings on PostgreSQL (config/0004; OWNER-QUESTIONS #110,
// R1-D-95): the person's USER values and USER change history go, in one ledgered transaction; other
// people, other tiers and other tenants keep theirs; the history accepts no other delete.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PgSettingsStore, SettingsService } from "@infrabyx/config/settings";
import { newId } from "@infrabyx/crypto";
import { agentContext, platformContext, withTenant } from "./context.js";
import { startPostgres, type TestDatabase } from "./postgres.js";

let db: TestDatabase;
let svc: SettingsService;
const DENSITY = "ux.density";
const SESSION = "trust.auth.session_idle_minutes";
const user = (tenant: string, id: string) =>
  withTenant(tenant, ["ORG_MEMBER"], { principal: { id } });
const me = user("tnt_a", "usr_gone");
const other = user("tnt_a", "usr_stays");
const adminA = withTenant("tnt_a", ["ORG_ADMIN"], { principal: { id: "usr_admin" } });
const request = { requestRef: "dpr_0001", reason: "DPDP erasure request from the data principal" };
const code = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: { code?: string; message?: string }) => e.code ?? e.message,
  );
const count = async (sql: string, params: unknown[]) =>
  (await db.admin.query<{ n: number }>(`select count(*)::int as n from ${sql}`, params)).rows[0]!.n;

beforeAll(async () => {
  db = await startPostgres();
  await db.admin.query(
    "insert into tenancy.tenant (id, product, name) values ('tnt_platform', 'PLATFORM', 'Infrabyx'), ('tnt_a', 'LDC', 'A'), ('tnt_b', 'LDC', 'B')",
  );
  svc = new SettingsService({
    store: new PgSettingsStore(),
    kernel: db.kernel,
    audit: db.audit,
    product: "LDC",
  });
  await svc.set(me, DENSITY, { tier: "USER", scopeId: "usr_gone" }, "compact");
  await svc.set(me, DENSITY, { tier: "USER", scopeId: "usr_gone" }, "comfortable");
  await svc.set(other, DENSITY, { tier: "USER", scopeId: "usr_stays" }, "compact");
  await svc.set(adminA, SESSION, { tier: "TENANT", scopeId: "tnt_a" }, 20);
  // A history row under the same person id in another tenant (a fixture as the database owner):
  // the erasure is bounded to the caller's tenant.
  await db.admin.query(
    `insert into config.setting_change (id, ledger_id, key, tier, scope_id, tenant_id, new_value,
       version, actor_id)
     values ($1, $2, $3, 'USER', 'usr_gone', 'tnt_b', '"compact"'::jsonb, 1, 'usr_gone')`,
    [newId("sch"), newId("led"), DENSITY],
  );
});
afterAll(async () => db?.end());

describe("erasing a person's USER settings (#110, R1-D-95)", () => {
  it("deletes their USER values and history in the tenant, ledgered with the counts only", async () => {
    const r = await svc.eraseUser(adminA, "usr_gone", request);
    expect(r).toMatchObject({ values: 1, changes: 2 });
    expect(r.erasureId).toMatch(/^ser_/);
    const user = "tier = 'USER' and scope_id = $1 and tenant_id = $2";
    expect(await count(`config.setting_value where ${user}`, ["usr_gone", "tnt_a"])).toBe(0);
    expect(await count(`config.setting_change where ${user}`, ["usr_gone", "tnt_a"])).toBe(0);
    // Everyone and everything else stays.
    expect(await count(`config.setting_change where ${user}`, ["usr_stays", "tnt_a"])).toBe(1);
    expect(await count(`config.setting_change where ${user}`, ["usr_gone", "tnt_b"])).toBe(1);
    expect(
      await count("config.setting_change where tier = 'TENANT' and tenant_id = $1", ["tnt_a"]),
    ).toBe(1);
    const led = await db.admin.query<{ action: string; actor_id: string; resource_id: string }>(
      "select action, actor_id, resource_id from audit.ledger where action = 'settings.user.erase'",
    );
    expect(led.rows).toEqual([
      { action: "settings.user.erase", actor_id: "usr_admin", resource_id: "usr_gone" },
    ]);
    const rec = await db.admin.query(
      "select tenant_id, user_id, request_ref, value_rows, change_rows, erased_by from config.setting_erasure",
    );
    expect(rec.rows).toEqual([
      {
        tenant_id: "tnt_a",
        user_id: "usr_gone",
        request_ref: "dpr_0001",
        value_rows: 1,
        change_rows: 2,
        erased_by: "usr_admin",
      },
    ]);
    // A second request finds nothing left and is still recorded.
    expect(
      await svc.eraseUser(adminA, "usr_gone", { ...request, requestRef: "dpr_0002" }),
    ).toMatchObject({
      values: 0,
      changes: 0,
    });
  });

  it("refuses agents, members, platform contexts and bad requests", async () => {
    expect(await code(svc.eraseUser(agentContext("tnt_a"), "usr_stays", request))).toBe(
      "IPB-SEC-004",
    );
    expect(await code(svc.eraseUser(other, "usr_stays", request))).toBe("IPB-UX-011");
    expect(await code(svc.eraseUser(platformContext(["PLT_DPO"]), "usr_stays", request))).toBe(
      "IPB-UX-011",
    );
    expect(
      await code(svc.eraseUser(adminA, "usr_stays", { ...request, requestRef: "bad ref" })),
    ).toMatch(/erasure request reference/);
    expect(await code(svc.eraseUser(adminA, "usr_stays", { ...request, reason: "short" }))).toMatch(
      /reason/,
    );
    // The product's erasure workflow runs as a service principal.
    const workflow = withTenant("tnt_a", [], {
      principal: { id: "svc_ldc_dpdp", type: "service" },
    });
    expect(await svc.eraseUser(workflow, "usr_stays", request)).toMatchObject({ changes: 1 });
  });

  it("keeps the history insert-only for every other row", async () => {
    // As the application role, in tenant A: a TENANT row and a USER row of a person not erased.
    await svc.set(
      user("tnt_a", "usr_new"),
      DENSITY,
      { tier: "USER", scopeId: "usr_new" },
      "compact",
    );
    const deleted = await db.kernel.mutate(
      adminA,
      async (tx) => {
        await db.audit.record(tx, { action: "x.y.z", resourceType: "x", resourceId: "x" });
        const t = await tx.query("delete from config.setting_change where tier = 'TENANT'");
        const u = await tx.query("delete from config.setting_change where scope_id = 'usr_new'");
        const e = await tx.query("delete from config.setting_change where scope_id = 'usr_gone'");
        return [t.rowCount, u.rowCount, e.rowCount];
      },
      { action: "x.y.z" },
    );
    // Tenant B's row for usr_gone is out of reach as well (RLS).
    expect(deleted).toEqual([0, 0, 0]);
    expect(
      await code(
        db.kernel.mutate(
          adminA,
          async (tx) => {
            await db.audit.record(tx, { action: "x.y.z", resourceType: "x", resourceId: "x" });
            await tx.query("update config.setting_change set new_value = 'null'::jsonb");
          },
          { action: "x.y.z" },
        ),
      ),
    ).toBe("42501");
  });
});
