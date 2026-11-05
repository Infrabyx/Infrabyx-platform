// Retiring a statutory-capture registration (Finbyx PR-FBX-39; OWNER-QUESTIONS #122, R1-D-102;
// audit/0008): only the migrating role, only inside a migration, only an empty table; the retirement
// is chained in the capture, every capture row is kept, and the drop of that one table is admitted
// in the same transaction only. Every other drop is still refused.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { KernelContext } from "@infrabyx/contracts/kernel";
import { LOCAL_KMS_KEYS, localDevKey } from "@infrabyx/crypto";
import { PgKernel } from "@infrabyx/tenancy";
import { migrate } from "@infrabyx/tenancy/migrate";
import { StatutoryCapture } from "./capture.js";
import { PgAuditSink } from "./sink.js";
import { freshDb } from "./__tests__/db.js";

let db: Awaited<ReturnType<typeof freshDb>>;
let kernel: PgKernel;
let capture: StatutoryCapture;
const sink = new PgAuditSink({ pseudonymKey: localDevKey(LOCAL_KMS_KEYS.auditPseudonym) });
const ctx = (tenantId: string): KernelContext => ({
  tenantId,
  principal: { id: "usr_ops", type: "user", roles: ["ORG_ADMIN"] },
  traceId: "trace-r",
});
const write = (tenantId: string, sql: string, params: unknown[] = []) =>
  kernel.mutate(
    ctx(tenantId),
    async (tx) => {
      await tx.query(sql, params);
      await sink.record(tx, { action: "cif.run.write", resourceType: "run", resourceId: "r1" });
    },
    { action: "cif.run.write" },
  );

let n = 0;
/** Apply one product migration file through the platform runner, as a product's migrate does. */
async function productMigration(sql: string): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "retire-mig-"));
  writeFileSync(join(dir, `${String(++n).padStart(4, "0")}_step.sql`), sql);
  await migrate({ client: db.admin, sources: [{ name: `product-${n}`, dir }] });
}
const registered = async (rel: string) =>
  (await db.admin.query("select 1 from audit.capture_table where rel_name = $1", [rel])).rowCount;
const exists = async (rel: string) =>
  (await db.admin.query("select to_regclass($1) is not null as e", [rel])).rows[0].e as boolean;
const captureRows = async (tenant: string, table: string) =>
  Number(
    (
      await db.admin.query(
        "select count(*) as n from audit.capture where tenant_id = $1 and table_name = $2",
        [tenant, table],
      )
    ).rows[0].n,
  );

beforeAll(async () => {
  db = await freshDb();
  kernel = new PgKernel({ pool: db.pool });
  capture = new StatutoryCapture({ kernel });
  const table = (name: string) => `
    create table cif.${name} (id text primary key, tenant_id text not null, note text);
    alter table cif.${name} enable row level security;
    alter table cif.${name} force row level security;
    create policy ${name}_tenant on cif.${name} for all
      using (tenant_id = current_setting('app.tenant_id', true))
      with check (tenant_id = current_setting('app.tenant_id', true));
    grant select, insert, update, delete on cif.${name} to app_rw;
    select audit.register_capture('cif.${name}');`;
  await productMigration(`
    create schema cif;
    grant usage on schema cif to app_rw, app_ro, app_migrate;
    ${table("old_run")}
    ${table("busy")}
    ${table("other")}`);
  // tnt_a used the old table and emptied it: its capture keeps both entries.
  await write("tnt_a", "insert into cif.old_run values ('o1', 'tnt_a', 'x')");
  await write("tnt_a", "delete from cif.old_run where id = 'o1'");
  // tnt_b's row stays in the busy table (another tenant's row, so behind row-level security).
  await write("tnt_b", "insert into cif.busy values ('b1', 'tnt_b', 'y')");
});
afterAll(async () => db?.end());

describe("@IPB-02-51 retiring a capture registration (audit/0008, #122)", () => {
  it("is refused outside a migration, even to the migrating role, and to any other role", async () => {
    const c = await db.pool.connect();
    try {
      await c.query("begin");
      await c.query("set local role app_migrate");
      await expect(c.query("select audit.retire_capture('cif.old_run')")).rejects.toThrow(
        /only inside a migration/,
      );
      await c.query("rollback");
      // The marker alone is not enough: the runner's lock is not held.
      await c.query("begin");
      await c.query("set local role app_migrate");
      await c.query("select set_config('ipb.migration', 'product/0099_forged.sql', true)");
      await expect(c.query("select audit.retire_capture('cif.old_run')")).rejects.toThrow(
        /only inside a migration/,
      );
      await c.query("rollback");
      for (const role of ["app_rw", "app_ro"]) {
        await c.query("begin");
        await c.query(`set local role ${role}`);
        await expect(c.query("select audit.retire_capture('cif.old_run')")).rejects.toMatchObject({
          code: "42501",
        });
        await c.query("rollback");
      }
    } finally {
      c.release();
    }
    expect(await registered("cif.old_run")).toBe(1);
  });

  it("refuses a table with rows, inside a migration; nothing changes", async () => {
    await expect(
      productMigration("select audit.retire_capture('cif.busy');\ndrop table cif.busy;"),
    ).rejects.toThrow(/cif\.busy has rows/);
    expect(await registered("cif.busy")).toBe(1);
    expect(await exists("cif.busy")).toBe(true);
    expect(
      (await db.admin.query("select count(*)::int as n from audit.capture_retirement")).rows[0].n,
    ).toBe(0);
  });

  it("undoes a retirement whose table is not dropped in the same transaction", async () => {
    await expect(productMigration("select audit.retire_capture('cif.old_run');")).rejects.toThrow(
      /retired but not dropped in the same transaction/,
    );
    expect(await registered("cif.old_run")).toBe(1);
    // Nor can the drop come in a later transaction: the table is still registered.
    await expect(db.admin.query("drop table cif.old_run")).rejects.toThrow(/cannot be disabled/);
  });

  it("refuses every other drop in the retiring transaction", async () => {
    await expect(
      productMigration(
        "select audit.retire_capture('cif.old_run');\ndrop table cif.old_run;\ndrop table cif.other;",
      ),
    ).rejects.toThrow(/cannot be disabled: table cif\.other/);
    await expect(
      productMigration(
        "select audit.retire_capture('cif.old_run');\ndrop trigger ipb_capture on cif.other;\ndrop table cif.old_run;",
      ),
    ).rejects.toThrow(/cannot be disabled/);
    expect(await registered("cif.old_run")).toBe(1);
    expect(await exists("cif.other")).toBe(true);
  });

  it("retires an empty table in a migration: chained in the capture, every capture row kept, the table dropped", async () => {
    const before = await captureRows("tnt_a", "cif.old_run");
    expect(before).toBe(2);
    await productMigration("select audit.retire_capture('cif.old_run');\ndrop table cif.old_run;");
    expect(await exists("cif.old_run")).toBe(false);
    expect(await registered("cif.old_run")).toBe(0);
    expect(await captureRows("tnt_a", "cif.old_run")).toBe(before);
    const ret = await db.admin.query(
      "select tenant_id, rel_name, table_rows, capture_rows::int, migration from audit.capture_retirement order by tenant_id",
    );
    expect(ret.rows).toEqual([
      {
        tenant_id: "tnt_a",
        rel_name: "cif.old_run",
        table_rows: "0",
        capture_rows: 2,
        migration: `product-${n}/${String(n).padStart(4, "0")}_step.sql`,
      },
      {
        tenant_id: "tnt_platform",
        rel_name: "cif.old_run",
        table_rows: "0",
        capture_rows: 0,
        migration: `product-${n}/${String(n).padStart(4, "0")}_step.sql`,
      },
    ]);
    // Each retirement row is an entry in its tenant's capture chain, and the chains verify.
    for (const t of ["tnt_a", "tnt_platform"]) {
      const last = (await capture.query(ctx(t), { limit: 100 })).at(-1)!;
      expect(last).toMatchObject({
        table_name: "audit.capture_retirement",
        op: "insert",
        action: "audit.capture.retire",
      });
      expect(JSON.parse(last.after_values!)).toMatchObject({
        rel_name: "cif.old_run",
        table_rows: 0,
      });
      expect(await capture.verify(ctx(t))).toMatchObject({ ok: true, problems: [] });
    }
    // The record cannot be changed, and the registrations are still never edited directly.
    await expect(db.admin.query("delete from audit.capture_retirement")).rejects.toThrow(
      /append-only/,
    );
    await expect(db.admin.query("delete from audit.capture_table")).rejects.toThrow(
      /only through audit\.retire_capture/,
    );
    // The guard still refuses every other drop, and the capture is whole.
    for (const sql of [
      "drop table cif.busy",
      "drop trigger ipb_capture on cif.other",
      "drop table audit.capture_retirement",
    ])
      await expect(db.admin.query(sql), sql).rejects.toThrow(/cannot be disabled/);
    expect((await db.admin.query("select * from audit.capture_problems(true)")).rows).toEqual([]);
    // The same name can be registered again, as a new registration.
    await productMigration(`
      create table cif.old_run (id text primary key, tenant_id text not null);
      alter table cif.old_run enable row level security;
      alter table cif.old_run force row level security;
      select audit.register_capture('cif.old_run');`);
    expect(await registered("cif.old_run")).toBe(1);
  });
});
