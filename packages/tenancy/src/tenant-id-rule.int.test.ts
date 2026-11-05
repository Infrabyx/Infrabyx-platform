// One tenant-id rule, platform-wide (Finbyx PR-FBX-40; R1-D-103; tenancy/0019): `tnt_` then
// letters and digits only. The migration first checks that no existing tenant breaks it, and stops,
// naming the ids, if one does; then the database refuses such an id at creation.
import { copyFileSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "./migrate/index.js";
import { TENANCY_SOURCE, freshDb, type TestDb } from "./__tests__/pg.js";

let db: TestDb;
const ULID = "01J9ZC9Q2K7M8N3P4R5S6T7V8W";
const hasRule = async () =>
  (
    await db.admin.query(
      "select 1 from pg_constraint where conrelid = 'tenancy.tenant'::regclass and conname = 'tenant_id_rule'",
    )
  ).rowCount === 1;

beforeAll(async () => {
  // The database as it was before tenancy/0019.
  const before = mkdtempSync(join(tmpdir(), "tenancy-0018-"));
  for (const f of readdirSync(TENANCY_SOURCE.dir))
    if (f === "checksums.json" || f.slice(0, 4) <= "0018")
      copyFileSync(join(TENANCY_SOURCE.dir, f), join(before, f));
  db = await freshDb([{ name: TENANCY_SOURCE.name, dir: before }]);
  await db.admin.query(
    `insert into tenancy.tenant (id, product, name) values
       ('tnt_platform', 'PLATFORM', 'Infrabyx'), ('tnt_bcl_enterprises', 'FBX', 'B'),
       ('tnt_a', 'FBX', 'A'), ('tnt_${ULID}', 'FBX', 'U')`,
  );
});
afterAll(async () => db?.end());

describe("@IPB-02 the tenant-id rule (tenancy/0019, PR-FBX-40)", () => {
  it("stops the migration, naming the ids, while an existing tenant breaks the rule", async () => {
    await expect(migrate({ client: db.admin, sources: [TENANCY_SOURCE] })).rejects.toThrow(
      /0019_tenant_id_rule\.sql failed: tenancy\/0019: 1 tenant id\(s\) break the tenant-id rule .*: tnt_bcl_enterprises;/,
    );
    expect(await hasRule()).toBe(false);
  });

  it("applies once the tenant is renamed, and refuses such an id at creation from then on", async () => {
    await db.admin.query(
      "update tenancy.tenant set id = 'tnt_bclenterprises' where id = 'tnt_bcl_enterprises'",
    );
    const r = await migrate({ client: db.admin, sources: [TENANCY_SOURCE] });
    expect(r.applied).toEqual(["@infrabyx/tenancy/0019_tenant_id_rule.sql"]);
    expect(await hasRule()).toBe(true);
    for (const id of ["tnt_other_pay", "tnt_Upper", `tnt_${"a".repeat(61)}`, "tnt_a-b"])
      await expect(
        db.admin.query("insert into tenancy.tenant (id, product, name) values ($1, 'FBX', 'x')", [
          id,
        ]),
        id,
      ).rejects.toMatchObject({ code: "23514" });
    for (const id of ["tnt_bcl2026", `tnt_${"b".repeat(60)}`, "tnt_01JA0000000000000000000000"])
      await db.admin.query(
        "insert into tenancy.tenant (id, product, name) values ($1, 'FBX', 'x')",
        [id],
      );
  });
});
