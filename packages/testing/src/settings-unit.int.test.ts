// Setting scopes below ENTITY on PostgreSQL (config/0005; PR-042, IPB-07-38 as amended; LawDocsComply
// PR-LDC-17; R1-D-95): UNIT rows (an organisation unit, department or function) are stored, resolved
// innermost first, kept in the change history and bounded to their tenant by RLS.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PgSettingsStore,
  SettingsRegistry,
  SettingsService,
  defaultRegistry,
  type SettingDef,
} from "@infrabyx/config/settings";
import { withTenant } from "./context.js";
import { startPostgres, type TestDatabase } from "./postgres.js";

let db: TestDatabase;
let svc: SettingsService;
const KEY = "ldc.review.reminder_days";
const def: SettingDef = {
  key: KEY,
  tier: "TENANT",
  type: "int",
  default: 14,
  min: 1,
  max: 30,
  tighten: "max",
  locked: false,
  userOverride: false,
  unitOverride: true,
  change: ["ORG_ADMIN"],
  mc: false,
  source: "test fixture",
};
const units = ["ou_north", "dep_legal"];
const adminA = withTenant("tnt_a", ["ORG_ADMIN"], {
  principal: { id: "usr_admin" },
  unitIds: units,
});
const adminB = withTenant("tnt_b", ["ORG_ADMIN"], {
  principal: { id: "usr_admin_b" },
  unitIds: units,
});

beforeAll(async () => {
  db = await startPostgres();
  await db.admin.query(
    "insert into tenancy.tenant (id, product, name) values ('tnt_a', 'LDC', 'A'), ('tnt_b', 'LDC', 'B')",
  );
  svc = new SettingsService({
    store: new PgSettingsStore(),
    kernel: db.kernel,
    audit: db.audit,
    product: "LDC",
    registry: new SettingsRegistry([...defaultRegistry.all(), def]),
  });
});
afterAll(async () => db?.end());

describe("UNIT setting scopes (PR-042, R1-D-95)", () => {
  it("stores and resolves unit values innermost first, with history, in the tenant only", async () => {
    await svc.set(adminA, KEY, { tier: "TENANT", scopeId: "tnt_a" }, 10);
    await svc.set(adminA, KEY, { tier: "UNIT", scopeId: "ou_north" }, 7);
    await svc.set(adminA, KEY, { tier: "UNIT", scopeId: "dep_legal" }, 5);
    expect(await svc.explain(adminA, KEY)).toMatchObject({ value: 5, from: "UNIT" });
    expect((await svc.explain(withTenant("tnt_a", [], { unitIds: ["ou_north"] }), KEY)).value).toBe(
      7,
    );
    const rows = await db.admin.query(
      "select tier, scope_id, tenant_id, value from config.setting_value where key = $1 order by tier, scope_id",
      [KEY],
    );
    expect(rows.rows).toEqual([
      { tier: "TENANT", scope_id: "tnt_a", tenant_id: "tnt_a", value: 10 },
      { tier: "UNIT", scope_id: "dep_legal", tenant_id: "tnt_a", value: 5 },
      { tier: "UNIT", scope_id: "ou_north", tenant_id: "tnt_a", value: 7 },
    ]);
    const h = await svc.history(adminA, KEY, { tier: "UNIT", scopeId: "dep_legal" });
    expect(h.items.map((c) => [c.tier, c.old, c.new])).toEqual([["UNIT", null, 5]]);
    // Tenant B with the same unit ids sees none of tenant A's values.
    expect((await svc.explain(adminB, KEY)).value).toBe(14);
    expect((await svc.history(adminB, KEY, { tier: "UNIT", scopeId: "dep_legal" })).items).toEqual(
      [],
    );
  });

  it("the database refuses a UNIT row without a tenant", async () => {
    await expect(
      db.admin.query(
        `insert into config.setting_value (id, key, tier, scope_id, tenant_id, value, updated_by)
         values ('set_01JD0000000000000000000000', $1, 'UNIT', 'ou_x', null, '3'::jsonb, 'usr_x')`,
        [KEY],
      ),
    ).rejects.toThrow(/setting_value_scope/);
  });
});
