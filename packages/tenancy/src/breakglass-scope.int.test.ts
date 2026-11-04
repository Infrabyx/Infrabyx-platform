// LawDocsComply PR-LDC-07 and PR-LDC-08 (c) (R1-plan M43; R1-D-75; tenancy/0016): the widened
// external grantee kinds, and a break-glass scope (tenant, modules, read or read-write) that only
// narrows the grant, enforced by the kernel with RLS on: another tenant, a write under `read` and a
// module outside the list are refused (IPB-SEC-005) and ledgered in the tenant touched; no scope is
// IPB-02-06 as before.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuditEntryInput, AuditSink, KernelContext, Tx } from "@infrabyx/contracts/kernel";
import { newId } from "@infrabyx/crypto";
import { BreakGlass, BreakGlassTenantNotices, type BreakGlassScope } from "./breakglass.js";
import { EXTERNAL_GRANTEE_KINDS, ExternalGrants } from "./external.js";
import { BREAKGLASS_SCOPE_REFUSED_ACTION, PgKernel } from "./kernel.js";
import { lintRls } from "./rls-lint/index.js";
import { freshDb, type TestDb } from "./__tests__/pg.js";

interface Entry extends AuditEntryInput {
  tenantId: string;
  actorId: string;
}
class RecordingAudit implements AuditSink {
  readonly entries: Entry[] = [];
  async record(tx: Tx, e: AuditEntryInput): Promise<{ id: string }> {
    this.entries.push({ ...e, tenantId: tx.ctx.tenantId, actorId: tx.ctx.principal.id });
    tx.markAudited();
    return { id: "led_x" };
  }
  refusals(grantId: string): Entry[] {
    return this.entries.filter(
      (e) => e.action === BREAKGLASS_SCOPE_REFUSED_ACTION && e.resourceId === grantId,
    );
  }
}

let db: TestDb;
let kernel: PgKernel;
const audit = new RecordingAudit();
const ENT = newId("ent");
const platform = (id: string, roles: string[]): KernelContext => ({
  tenantId: "tnt_platform",
  scope: "platform",
  principal: { id, type: "user", roles },
});
const owner = (tenantId: string, id = "usr_owner", roles = ["ORG_OWNER"]): KernelContext => ({
  tenantId,
  principal: { id, type: "user", roles },
});
const bgIn = (tenantId: string, grantId: string): KernelContext => ({
  tenantId,
  breakGlassGrantId: grantId,
  principal: { id: "usr_sa1", type: "breakglass", roles: ["PLT_SUPER_ADMIN"] },
});
const bg = () => new BreakGlass({ kernel, audit, product: "LDC" });

async function grant(scope?: BreakGlassScope): Promise<string> {
  const g = await bg().request(
    platform("usr_sa1", ["PLT_SUPER_ADMIN"]),
    "incident INC-9 on tenant A",
    60,
    scope,
  );
  await bg().approve(platform("usr_so", ["PLT_SECURITY_OFFICER"]), g.id);
  return g.id;
}

const insertDoc = (id: string) => async (tx: Tx) => {
  await tx.query("insert into docs.file (tenant_id, id, name) values ($1, $2, 'n')", [
    tx.ctx.tenantId,
    id,
  ]);
  await audit.record(tx, { action: "docs.file.create", resourceType: "file", resourceId: id });
};

beforeAll(async () => {
  db = await freshDb();
  kernel = new PgKernel({ pool: db.pool, audit });
  await db.admin.query(
    `insert into tenancy.tenant (id, product, name) values ('tnt_platform', 'PLATFORM', 'Infrabyx'),
       ('tnt_a', 'LDC', 'A'), ('tnt_b', 'LDC', 'B')`,
  );
  await db.admin.query(
    "insert into tenancy.legal_entity (id, tenant_id, name) values ($1, 'tnt_a', 'One')",
    [ENT],
  );
  // Two product modules (schemas), as a product sets them up.
  for (const s of ["docs", "billing"])
    await db.admin.query(`
      create schema ${s};
      grant usage on schema ${s} to app_rw, app_ro;
      create table ${s}.${s === "docs" ? "file" : "invoice"} (tenant_id text not null, id text primary key, name text);
      alter table ${s}.${s === "docs" ? "file" : "invoice"} enable row level security;
      alter table ${s}.${s === "docs" ? "file" : "invoice"} force row level security;
      create policy t on ${s}.${s === "docs" ? "file" : "invoice"} for all
        using (tenant_id = current_setting('app.tenant_id', true))
        with check (tenant_id = current_setting('app.tenant_id', true));
      grant select, insert, update on ${s}.${s === "docs" ? "file" : "invoice"} to app_rw;
    `);
  await db.admin.query(
    "insert into docs.file values ('tnt_a', 'f1', 'a'), ('tnt_b', 'f2', 'b'); insert into billing.invoice values ('tnt_a', 'i1', 'a')",
  );
});
afterAll(async () => db?.end());

describe("@IPB-02-12 external grantee kinds of PR-LDC-07 (R1-D-75)", () => {
  it("each new kind is accepted by the API and the widened check; others are still refused", async () => {
    const added = EXTERNAL_GRANTEE_KINDS.slice(6);
    expect(added).toEqual([
      "nhb",
      "nabard",
      "ifsca",
      "roc_inspector",
      "rcs_inspector",
      "crcs_inspector",
      "secretarial_auditor",
      "tax_auditor",
      "concurrent_auditor",
      "cooperative_auditor",
    ]);
    const grants = new ExternalGrants({ kernel, audit });
    for (const kind of added) {
      const g = await grants.request(owner("tnt_a"), {
        granteeId: `ext_${kind}`,
        granteeName: "An Inspector",
        organisation: "Regulator",
        kind,
        purpose: "statutory inspection of records",
        entityIds: [ENT],
        periodFrom: "2026-04-01",
        periodTo: "2027-03-31",
      });
      const a = await grants.approve(owner("tnt_a", "usr_admin", ["ORG_ADMIN"]), g.id);
      expect(a).toMatchObject({ kind, state: "active", durationDays: 30 });
    }
    await expect(
      db.admin.query(
        `insert into tenancy.external_grant (id, tenant_id, grantee_id, grantee_name, organisation, kind,
           purpose, entity_ids, period_from, period_to, duration_days, requested_by)
         values ($1, 'tnt_a', 'x', 'x', 'x', 'rera', 'purpose text', $2, '2026-01-01', '2026-02-01', 1, 'u')`,
        [newId("xgr"), [ENT]],
      ),
    ).rejects.toThrow(/external_grant_kind_check/);
  });
});

describe("@IPB-02-06 a scoped break-glass (PR-LDC-08 (c), R1-D-75)", () => {
  it("no scope keeps today's behaviour: any tenant, reads and writes, no scope recorded", async () => {
    const id = await grant();
    expect(await kernel.read(bgIn("tnt_b", id), async () => "read")).toBe("read");
    await kernel.mutate(bgIn("tnt_b", id), insertDoc("f3"), { action: "docs.file.create" });
    const uses = await new BreakGlassTenantNotices({ kernel, audit, product: "LDC" }).list(
      owner("tnt_b"),
    );
    expect(uses.find((u) => u.grantId === id)?.scope).toBeNull();
    expect(audit.refusals(id)).toEqual([]);
  });

  it("request validates the scope: a known tenant, valid modules, read by default", async () => {
    const sa = platform("usr_sa1", ["PLT_SUPER_ADMIN"]);
    await expect(
      bg().request(sa, "incident INC-9 on tenant A", 60, { tenantId: "tnt_nope" }),
    ).rejects.toThrow(/tenant not found/);
    await expect(
      bg().request(sa, "incident INC-9 on tenant A", 60, { tenantId: "tnt_a", modules: [] }),
    ).rejects.toThrow(RangeError);
    await expect(
      bg().request(sa, "incident INC-9 on tenant A", 60, {
        tenantId: "tnt_a",
        modules: ["Docs; drop"],
      }),
    ).rejects.toThrow(RangeError);
    const g = await bg().request(sa, "incident INC-9 on tenant A", 60, {
      tenantId: "tnt_a",
      modules: ["docs", "docs"],
    });
    expect(g.scope).toEqual({ tenantId: "tnt_a", modules: ["docs"], access: "read" });
  });

  it("read scope: its tenant and modules only; another tenant, a write or another module is refused and ledgered", async () => {
    const id = await grant({ tenantId: "tnt_a", modules: ["docs"] });
    const ctx = bgIn("tnt_a", id);
    expect(
      await kernel.read(ctx, async (tx) => (await tx.query("select id from docs.file")).rows),
    ).toEqual([{ id: "f1" }]);
    // Comments, string literals and aliases are not modules.
    expect(
      await kernel.read(ctx, async (tx) => {
        const r = await tx.query(
          `select f.id, 'billing.invoice' as label /* billing.invoice */ from docs.file f -- billing.x
            where f.name <> E'billing.\\'x'`,
        );
        return r.rows.length;
      }),
    ).toBe(1);

    // Another tenant: refused, ledgered there, and not recorded as a use.
    await expect(kernel.read(bgIn("tnt_b", id), async () => 1)).rejects.toMatchObject({
      code: "IPB-SEC-005",
      meta: { reason: "tenant" },
    });
    expect(
      (
        await db.admin.query(
          "select 1 from tenancy.breakglass_use where grant_id = $1 and tenant_id = 'tnt_b'",
          [id],
        )
      ).rows,
    ).toEqual([]);
    // A write under read.
    await expect(
      kernel.mutate(ctx, insertDoc("f4"), { action: "docs.file.create" }),
    ).rejects.toMatchObject({ code: "IPB-SEC-005", meta: { reason: "write" } });
    // Another module, plain, quoted or joined.
    for (const sql of [
      "select id from billing.invoice",
      'select id from "billing"."invoice"',
      "select f.id from docs.file f join billing . invoice i on i.tenant_id = f.tenant_id",
    ])
      await expect(kernel.read(ctx, (tx) => tx.query(sql))).rejects.toMatchObject({
        code: "IPB-SEC-005",
        meta: { reason: "module", module: "billing" },
      });
    // What could reach another module without naming it.
    for (const sql of [
      "set local search_path = billing",
      "select set_config('search_path', 'billing', true)",
      "select query_to_xml('select * from bil' || 'ling.invoice', true, false, '')",
      "do $$ begin perform 1; end $$",
      "select tenancy.breakglass_scope('x', 'y')",
    ])
      await expect(kernel.read(ctx, (tx) => tx.query(sql))).rejects.toMatchObject({
        code: "IPB-SEC-005",
        meta: { reason: "module" },
      });
    const refused = audit.refusals(id);
    expect(refused.map((e) => [e.tenantId, (e.after as { reason: string }).reason])).toEqual([
      ["tnt_b", "tenant"],
      ["tnt_a", "write"],
      ...Array.from({ length: 8 }, () => ["tnt_a", "module"]),
    ]);
    expect(refused[1]?.after).toMatchObject({
      action: "docs.file.create",
      scope: { tenant_id: "tnt_a", modules: ["docs"], access: "read" },
    });
    expect(refused[2]?.after).toMatchObject({ module: "billing" });
    expect(refused.every((e) => e.actorId === "usr_sa1")).toBe(true);
    // The tenant sees the grant and its scope.
    const uses = await new BreakGlassTenantNotices({ kernel, audit, product: "LDC" }).list(
      owner("tnt_a"),
    );
    expect(uses.find((u) => u.grantId === id)?.scope).toEqual({
      modules: ["docs"],
      access: "read",
    });
  });

  it("read-write scope writes in its modules; a refusal caught inside the transaction is still ledgered", async () => {
    const id = await grant({ tenantId: "tnt_a", modules: ["docs"], access: "read_write" });
    const ctx = bgIn("tnt_a", id);
    await kernel.mutate(ctx, insertDoc("f5"), { action: "docs.file.create" });
    expect((await db.admin.query("select 1 from docs.file where id = 'f5'")).rows).toHaveLength(1);
    await expect(
      kernel.mutate(
        ctx,
        async (tx) => {
          await tx.query("update billing.invoice set name = 'x'");
          await audit.record(tx, {
            action: "billing.invoice.edit",
            resourceType: "i",
            resourceId: "i1",
          });
        },
        { action: "billing.invoice.edit" },
      ),
    ).rejects.toMatchObject({ code: "IPB-SEC-005", meta: { module: "billing" } });
    // A unit swallows the refusal and the transaction commits; the refusal is ledgered all the same.
    await kernel.mutate(
      ctx,
      async (tx) => {
        const out = await tx.unit!((u) => u.query("update billing.invoice set name = 'y'"));
        expect(out.ok).toBe(false);
        await insertDoc("f6")(tx);
      },
      { action: "docs.file.create" },
    );
    expect((await db.admin.query("select name from billing.invoice")).rows).toEqual([
      { name: "a" },
    ]);
    expect(audit.refusals(id).map((e) => (e.after as { action?: string }).action)).toEqual([
      "billing.invoice.edit",
      "docs.file.create",
    ]);
  });

  it("a tenant-only scope (no module list) allows every module of that tenant only", async () => {
    const id = await grant({ tenantId: "tnt_a", access: "read" });
    expect(
      await kernel.read(
        bgIn("tnt_a", id),
        async (tx) => (await tx.query("select id from billing.invoice")).rows.length,
      ),
    ).toBe(1);
    await expect(kernel.read(bgIn("tnt_b", id), async () => 1)).rejects.toMatchObject({
      code: "IPB-SEC-005",
    });
  });

  it("a scoped grant is refused in a platform context, and by a kernel without an audit sink", async () => {
    const id = await grant({ tenantId: "tnt_a" });
    await expect(
      kernel.read(
        {
          tenantId: "tnt_platform",
          scope: "platform",
          breakGlassGrantId: id,
          principal: { id: "usr_sa1", type: "breakglass", roles: ["PLT_SUPER_ADMIN"] },
        },
        async () => 1,
      ),
    ).rejects.toMatchObject({ code: "IPB-SEC-005", meta: { reason: "tenant" } });
    const bare = new PgKernel({ pool: db.pool });
    await expect(bare.read(bgIn("tnt_a", id), async () => 1)).rejects.toThrow(/audit sink/);
    // The database refuses the grant outside its tenant on its own as well.
    const c = await db.pool.connect();
    try {
      await c.query("begin");
      await c.query("set local role app_rw");
      await c.query("select set_config('app.tenant_id', 'tnt_b', true)");
      const r = await c.query<{ ok: boolean; touched: boolean }>(
        "select tenancy.breakglass_active($1, 'usr_sa1') as ok, tenancy.breakglass_touch($1, 'usr_sa1') as touched",
        [id],
      );
      expect(r.rows[0]).toEqual({ ok: false, touched: false });
    } finally {
      await c.query("rollback");
      c.release();
    }
  });

  it("rls-lint passes with the new definer function", async () => {
    expect(await lintRls(db.admin, { schemas: ["tenancy"] })).toEqual([]);
  });
});
