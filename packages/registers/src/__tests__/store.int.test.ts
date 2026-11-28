// The register row store on PostgreSQL with every platform migration applied (templates item (a),
// part 2; ADR-0016, R1-D-323). Synthetic rows on CA-A01's filed Calendar layout.
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { KernelContext } from "@infrabyx/contracts/kernel";
import {
  RegisterDefinition,
  RegisterError,
  definitionFromIndex,
  type SheetLayout,
} from "@infrabyx/contracts/registers";
import { AuditService } from "@infrabyx/audit";
import { localTenantKeyId } from "@infrabyx/crypto";
import { ApprovalsEngine, FieldCrypto } from "@infrabyx/tenancy";
import { fakeKms, startPostgres, withTenant, type TestDatabase } from "@infrabyx/testing";
import { REGISTER_ROW_ACTION, RegisterStore } from "../store.js";

let db: TestDatabase;
let approvals: ApprovalsEngine;
let store: RegisterStore;

const ctx = (id: string, roles: string[], tenantId = "tnt_a"): KernelContext =>
  withTenant(tenantId, roles, { principal: { id } });
const maker = ctx("usr_maker", ["ORG_ADMIN"]);
const checker = ctx("usr_checker", ["ORG_CHECKER"]);
const other = ctx("usr_other", ["ORG_ADMIN"], "tnt_b");

const INDEX = JSON.parse(
  readFileSync(
    new URL("../../../../docs/regulatory-templates/template index.json", import.meta.url),
    "utf8",
  ),
) as Array<{ code: string; title: string; sheets: SheetLayout[] }>;
const CALENDAR = (() => {
  const d = definitionFromIndex(
    INDEX.find((r) => r.code === "CA-A01")!,
    { version: "1.0.0" },
  );
  for (const c of d.sheets[0]!.columns) {
    if (c.key === "compliance") c.required = true;
    if (c.key === "done_on") c.type = "date";
    if (c.key === "status") Object.assign(c, { type: "enum", enum: ["Open", "Done"] });
  }
  return RegisterDefinition.parse(d);
})();
const row = (i: number, status = "Open") => ({
  frequency: i % 2 ? "Annual" : "Quarterly",
  compliance: `Synthetic filing ${i}`,
  status,
});
const code = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: { reason?: string; code?: string; name?: string; message?: string }) =>
      e.reason ?? e.code ?? e.name,
  );

beforeAll(async () => {
  db = await startPostgres();
  await db.admin.query(
    "insert into tenancy.tenant (id, product, name) values ('tnt_a', 'LD', 'A'), ('tnt_b', 'LD', 'B') on conflict do nothing",
  );
  approvals = new ApprovalsEngine({
    kernel: db.kernel,
    audit: db.audit,
    product: "LD",
    fieldCrypto: new FieldCrypto({ kms: fakeKms(), keyIdFor: localTenantKeyId }),
  });
  store = new RegisterStore({
    kernel: db.kernel,
    audit: db.audit,
    approvals,
    ledger: new AuditService({ kernel: db.kernel, sink: db.audit, product: "LD" }),
  }).define(CALENDAR);
  approvals.register(REGISTER_ROW_ACTION, store.approvalPolicy({ checkerRoles: ["ORG_CHECKER"] }));
});
afterAll(async () => db?.end());

describe("@infrabyx/registers: the row store (item (a), part 2)", () => {
  it("row history after an edit and an approval: versions and the ledger", async () => {
    const v1 = await store.create(maker, "CA-A01", "Calendar", { data: row(1) });
    expect(v1).toMatchObject({ version: 1, state: "current", definitionVersion: "1.0.0" });
    const v2 = await store.correct(maker, v1.rowId, { data: { ...row(1), done_on: "2026-11-27" } });
    expect(v2).toMatchObject({ version: 2, state: "current" });
    expect(v2.retainUntil).toEqual(v1.retainUntil);
    // A maker-checker correction waits as pending; the maker cannot approve it.
    const v3 = await store.correct(maker, v1.rowId, {
      data: { ...row(1, "Done"), done_on: "2026-11-27" },
      approval: { riskClass: "R2" },
    });
    expect(v3).toMatchObject({ version: 3, state: "pending" });
    expect((await store.get(maker, v1.rowId)).version).toBe(2);
    expect(await code(approvals.decide(maker, v3.approvalId!, "approve"))).toBe("IPB-SEC-007");
    expect(await code(store.correct(maker, v1.rowId, { data: row(1) }))).toBe("ConflictError");
    await approvals.decide(checker, v3.approvalId!, "approve");
    expect(await store.get(maker, v1.rowId)).toMatchObject({ version: 3, state: "current" });

    const h = await store.history(maker, v1.rowId);
    expect(h.versions.map((v) => `${v.version}:${v.state}`)).toEqual([
      "3:current",
      "2:superseded",
      "1:superseded",
    ]);
    expect((h.ledger as Array<{ action: string }>).map((e) => e.action)).toEqual([
      "registers.row.create",
      "registers.row.correct",
      "registers.row.request",
      "registers.row.correct",
    ]);
  });

  it("a rejected change never becomes current", async () => {
    const v1 = await store.create(maker, "CA-A01", "Calendar", { data: row(2) });
    const v2 = await store.correct(maker, v1.rowId, {
      data: row(2, "Done"),
      approval: { riskClass: "R2" },
    });
    await approvals.decide(checker, v2.approvalId!, "reject", "synthetic: not yet filed");
    expect(await store.refreshApproval(maker, v1.rowId)).toMatchObject({
      version: 2,
      state: "rejected",
    });
    expect((await store.get(maker, v1.rowId)).version).toBe(1);
  });

  it("the database refuses a delete before the retention date, a changed version, and a truncate", async () => {
    const v1 = await store.create(maker, "CA-A01", "Calendar", { data: row(3) });
    await expect(
      db.admin.query("delete from registers.row_version where row_id = $1", [v1.rowId]),
    ).rejects.toThrow(/retained until/);
    await expect(
      db.admin.query(
        `update registers.row_version set data = '{"compliance":"x"}'::jsonb where row_id = $1`,
        [v1.rowId],
      ),
    ).rejects.toThrow(/immutable/);
    await expect(
      db.admin.query("update registers.row_version set state = 'pending' where row_id = $1", [
        v1.rowId,
      ]),
    ).rejects.toThrow(/cannot become/);
    await expect(db.admin.query("truncate registers.row_version")).rejects.toThrow(
      /never truncated/,
    );
    // The application role has no delete grant at all.
    const g = await db.admin.query<{ ok: boolean }>(
      "select has_table_privilege('app_rw', 'registers.row_version', 'DELETE') as ok",
    );
    expect(g.rows[0]!.ok).toBe(false);
  });

  it("every value is checked against the definition before it is written", async () => {
    expect(
      await code(store.create(maker, "CA-A01", "Calendar", { data: { status: "Closed" } })),
    ).toBe("row_invalid");
    expect(await code(store.create(maker, "CA-A01", "Nope", { data: row(4) }))).toBe(
      "definition_invalid",
    );
    expect(await code(store.create(maker, "XX-A01", "Calendar", { data: row(4) }))).toBe(
      "definition_invalid",
    );
    const regulated = structuredClone(CALENDAR);
    regulated.code = "CA-A02";
    regulated.sheets[0]!.columns[0]!.dataClass = "REGULATED";
    expect(() => store.define(regulated)).toThrow(RegisterError);
  });

  it("lists current rows by filter with a keyset cursor, and RLS keeps them to the tenant", async () => {
    const tenant = ctx("usr_lister", ["ORG_ADMIN"], "tnt_b");
    const made = [];
    for (let i = 0; i < 5; i++)
      made.push(
        await store.create(tenant, "CA-A01", "Calendar", {
          data: row(100 + i, i % 2 ? "Done" : "Open"),
        }),
      );
    const p1 = await store.list(tenant, { code: "CA-A01", sheet: "Calendar", limit: 2 });
    expect(p1.items.length).toBe(2);
    const p2 = await store.list(tenant, {
      code: "CA-A01",
      sheet: "Calendar",
      limit: 2,
      cursor: p1.nextCursor!,
    });
    const p3 = await store.list(tenant, {
      code: "CA-A01",
      sheet: "Calendar",
      limit: 2,
      cursor: p2.nextCursor!,
    });
    expect(p3.nextCursor).toBeNull();
    expect([...p1.items, ...p2.items, ...p3.items].map((r) => r.rowId)).toEqual(
      made.map((m) => m.rowId).sort(),
    );
    const done = await store.list(tenant, {
      code: "CA-A01",
      sheet: "Calendar",
      where: { status: "Done" },
    });
    expect(done.items.map((r) => r.data["status"])).toEqual(["Done", "Done"]);
    expect(
      await code(store.list(tenant, { code: "CA-A01", sheet: "Calendar", where: { pan: "x" } })),
    ).toBe("row_invalid");
    expect(
      await code(
        store.list(tenant, { code: "CA-A01", sheet: "Calendar", cursor: "bm90LWEtY3Vyc29y" }),
      ),
    ).toBe("RangeError");
    // Tenant A sees none of tenant B's rows, and cannot read one.
    const a = await store.list(maker, {
      code: "CA-A01",
      sheet: "Calendar",
      where: { compliance: "Synthetic filing 100" },
    });
    expect(a.items).toEqual([]);
    expect(await code(store.get(maker, made[0]!.rowId))).toBe("NotFoundError");
    expect(await code(store.get(other, made[0]!.rowId))).toBeNull();
  });
});
