// Tenant-consented support access (LawDocsComply PR-LDC-08 (a), (b), PR-LDC-20; owner answer #104;
// R1-plan M50; R1-D-76; tenancy/0017), with RLS on: request → consent → use → expiry; revocation
// at once; read-write needs a second, different tenant approver; no grant, nothing visible; every
// read ledgered and listed to the tenant; tenants isolated; no product-defined platform role.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuditEntryInput, AuditSink, KernelContext, Tx } from "@infrabyx/contracts/kernel";
import { PgKernel } from "./kernel.js";
import { PgOutbox } from "./outbox.js";
import { lintRls } from "./rls-lint/index.js";
import {
  SUPPORT_READ_ACTION,
  SupportAccess,
  SupportReads,
  supportContext,
  type SupportGrant,
} from "./support.js";
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
  of(action: string, tenantId?: string): Entry[] {
    return this.entries.filter(
      (e) => e.action === action && (tenantId === undefined || e.tenantId === tenantId),
    );
  }
}

let db: TestDb;
let kernel: PgKernel;
const audit = new RecordingAudit();
const outbox = new PgOutbox();
const member = (tenantId: string, id: string, roles = ["ORG_OWNER"]): KernelContext => ({
  tenantId,
  principal: { id, type: "user", roles },
});
const ownerA = member("tnt_a", "usr_owner_a");
const adminA = member("tnt_a", "usr_admin_a", ["ORG_ADMIN"]);
const sup = (tenantId = "tnt_a", id = "usr_sup1") => supportContext(tenantId, id);
const access = () => new SupportAccess({ kernel, audit, outbox, product: "LDC" });
const reads = () => new SupportReads({ kernel, audit });
const readFiles = (ctx: KernelContext) =>
  reads().read<{ id: string }>(ctx, "docs.file", "select id from docs.file order by id");

beforeAll(async () => {
  db = await freshDb();
  kernel = new PgKernel({ pool: db.pool, audit });
  await db.admin.query(
    "insert into tenancy.tenant (id, product, name) values ('tnt_a', 'LDC', 'A'), ('tnt_b', 'LDC', 'B')",
  );
  for (const [s, t] of [
    ["docs", "file"],
    ["billing", "invoice"],
  ])
    await db.admin.query(`
      create schema ${s};
      grant usage on schema ${s} to app_rw, app_ro;
      create table ${s}.${t} (tenant_id text not null, id text primary key, name text);
      alter table ${s}.${t} enable row level security;
      alter table ${s}.${t} force row level security;
      create policy t on ${s}.${t} for all
        using (tenant_id = current_setting('app.tenant_id', true))
        with check (tenant_id = current_setting('app.tenant_id', true));
      grant select, insert, update on ${s}.${t} to app_rw;
    `);
  await db.admin.query(
    "insert into docs.file values ('tnt_a', 'f1', 'a'), ('tnt_b', 'f2', 'b'); insert into billing.invoice values ('tnt_a', 'i1', 'a')",
  );
});
afterAll(async () => db?.end());

async function expire(id: string): Promise<void> {
  await db.admin.query(
    "update tenancy.support_grant set activated_at = now() - interval '3 hours', expires_at = now() - interval '1 minute' where id = $1",
    [id],
  );
}

describe("@IPB-02-06 tenant-consented support access (R1-D-76)", () => {
  it("only PLT_SUPPORT alone, in a tenant; no platform context, no product-defined platform role", async () => {
    const bad: KernelContext[] = [
      { ...sup(), scope: "platform" },
      {
        tenantId: "tnt_platform",
        principal: { id: "usr_sup1", type: "user", roles: ["PLT_SUPPORT"] },
      },
      {
        tenantId: "tnt_a",
        principal: { id: "usr_sup1", type: "user", roles: ["PLT_SUPPORT", "ORG_ADMIN"] },
      },
      {
        tenantId: "tnt_a",
        principal: { id: "usr_sup1", type: "user", roles: ["PLT_SUPPORT", "PLT_SUPER_ADMIN"] },
      },
      { tenantId: "tnt_a", principal: { id: "usr_sup1", type: "service", roles: ["PLT_SUPPORT"] } },
      {
        tenantId: "tnt_a",
        principal: { id: "usr_sup1", type: "user", roles: ["PLT_SUPPORT", "AGT_HELPER"] },
      },
      // A product's own "platform" support role is not a platform role and gets no platform scope.
      {
        tenantId: "tnt_platform",
        scope: "platform",
        principal: { id: "usr_sup1", type: "user", roles: ["PLT_LDC_SUPPORT"] },
      },
    ];
    for (const ctx of bad)
      await expect(kernel.read(ctx, async () => 1)).rejects.toMatchObject({ code: "IPB-SEC-005" });
  });

  it("no grant: nothing visible, nothing written", async () => {
    await expect(readFiles(sup())).rejects.toMatchObject({ code: "IPB-TRUST-003" });
    await expect(
      kernel.read(sup(), async (tx) => (await tx.query("select id from docs.file")).rows),
    ).rejects.toMatchObject({ code: "IPB-SEC-005" });
    await expect(
      kernel.mutate(sup(), async (tx) => {
        await tx.query("insert into docs.file values ('tnt_a', 'x', 'x')");
        await audit.record(tx, { action: "docs.file.create", resourceType: "f", resourceId: "x" });
      }),
    ).rejects.toMatchObject({ code: "IPB-TRUST-003" });
    expect(audit.of(SUPPORT_READ_ACTION)).toEqual([]);
  });

  let readGrant: SupportGrant;
  it("request → consent → use → expiry", async () => {
    const g = await access().request(sup(), {
      reason: "customer ticket: documents fail to load",
      modules: ["docs"],
      hours: 2,
      ticketRef: "SUP-1042",
    });
    expect(g).toMatchObject({ state: "awaiting_tenant_consent", access: "read", durationHours: 2 });
    await expect(
      access().request(sup(), { reason: "a second request text", modules: ["docs"] }),
    ).rejects.toThrow(/already open/);
    // Waiting for consent: still nothing visible.
    await expect(readFiles(sup())).rejects.toMatchObject({ code: "IPB-TRUST-003" });
    expect((await access().list(sup())).map((x) => x.id)).toEqual([g.id]);
    expect((await access().list(ownerA)).map((x) => x.id)).toEqual([g.id]);
    // Only the tenant's ORG_OWNER or ORG_ADMIN consents; not support, not other members.
    await expect(access().consent(sup(), g.id)).rejects.toMatchObject({ code: "IPB-SEC-005" });
    await expect(
      access().consent(member("tnt_a", "usr_m", ["ORG_MEMBER"]), g.id),
    ).rejects.toMatchObject({ code: "IPB-UX-011" });
    await expect(
      access().consent(
        { ...ownerA, principal: { ...ownerA.principal, roles: ["ORG_OWNER", "AGT_X"] } },
        g.id,
      ),
    ).rejects.toMatchObject({ code: "IPB-SEC-004" });
    readGrant = await access().consent(adminA, g.id);
    expect(readGrant).toMatchObject({ state: "active", consentedBy: "usr_admin_a" });
    const hours = ((readGrant.expiresAt as Date).getTime() - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(1.99);
    expect(hours).toBeLessThanOrEqual(2);

    // Use: its tenant's rows only, each read ledgered and recorded for the tenant.
    expect(await readFiles(sup())).toEqual([{ id: "f1" }]);
    expect(audit.of(SUPPORT_READ_ACTION, "tnt_a")).toEqual([
      expect.objectContaining({
        resourceId: `${g.id}/docs.file`,
        actorId: "usr_sup1",
        after: { grant_id: g.id, table: "docs.file", rows: 1 },
      }),
    ]);
    const seen = await access().reads(ownerA);
    expect(seen).toEqual([
      expect.objectContaining({
        grantId: g.id,
        principalId: "usr_sup1",
        table: "docs.file",
        rows: 1,
      }),
    ]);
    // Another module, and a write under read, are refused and ledgered.
    await expect(
      reads().read(sup(), "billing.invoice", "select id from billing.invoice"),
    ).rejects.toMatchObject({ code: "IPB-SEC-005", meta: { reason: "module", module: "billing" } });
    await expect(
      kernel.mutate(
        sup(),
        async (tx) => {
          await tx.query("update docs.file set name = 'z'");
          await audit.record(tx, { action: "docs.file.edit", resourceType: "f", resourceId: "f1" });
        },
        { action: "docs.file.edit" },
      ),
    ).rejects.toMatchObject({ code: "IPB-SEC-005", meta: { reason: "write" } });
    expect(
      audit
        .of("security.support_access.scope_refused", "tnt_a")
        .map((e) => [e.resourceId, (e.after as { reason: string }).reason]),
    ).toEqual([
      [g.id, "module"],
      [g.id, "write"],
    ]);
    expect((await db.admin.query("select name from docs.file where id = 'f1'")).rows).toEqual([
      { name: "a" },
    ]);
    // Expiry: nothing visible again, and a new request may be made.
    await expire(g.id);
    await expect(readFiles(sup())).rejects.toMatchObject({ code: "IPB-TRUST-003" });
  });

  it("revocation by the tenant is immediate", async () => {
    const g = await access().request(sup(), {
      reason: "customer ticket: re-check the documents",
      modules: ["docs"],
    });
    expect(g.durationHours).toBe(4);
    await access().consent(ownerA, g.id);
    expect(await readFiles(sup())).toHaveLength(1);
    await expect(access().revoke(sup(), g.id)).rejects.toMatchObject({ code: "IPB-SEC-005" });
    const r = await access().revoke(adminA, g.id);
    expect(r).toMatchObject({ state: "revoked", endedBy: "usr_admin_a" });
    await expect(readFiles(sup())).rejects.toMatchObject({ code: "IPB-TRUST-003" });
    await expect(access().revoke(adminA, g.id)).rejects.toThrow(/revoked/);
    expect(audit.of("security.support_access.revoke", "tnt_a")).toHaveLength(1);
    const ev = await db.admin.query<{ type: string }>(
      "select envelope->>'type' as type from tenancy.outbox where tenant_id = 'tnt_a' order by 1",
    );
    expect(new Set(ev.rows.map((x) => x.type))).toEqual(
      new Set([
        "in.ldc.security.SupportAccessRequested.v1",
        "in.ldc.security.SupportAccessGranted.v1",
        "in.ldc.security.SupportAccessRevoked.v1",
      ]),
    );
  });

  it("the tenant may refuse a request", async () => {
    const g = await access().request(sup(), {
      reason: "customer ticket: refused one",
      modules: ["docs"],
    });
    expect(await access().refuse(ownerA, g.id)).toMatchObject({ state: "refused" });
    await expect(access().consent(ownerA, g.id)).rejects.toThrow(/refused/);
    await expect(readFiles(sup())).rejects.toMatchObject({ code: "IPB-TRUST-003" });
  });

  it("read-write needs a second, different tenant approver (maker ≠ checker)", async () => {
    await expect(
      access().request(sup(), {
        reason: "customer ticket: fix a record",
        modules: ["docs", "tenancy"],
        access: "read_write",
      }),
    ).rejects.toThrow(RangeError);
    await expect(
      access().request(sup(), { reason: "too long", modules: ["docs"], hours: 25 }),
    ).rejects.toThrow(RangeError);
    const g = await access().request(sup(), {
      reason: "customer ticket: fix a record",
      modules: ["docs"],
      access: "read_write",
    });
    const c = await access().consent(ownerA, g.id);
    expect(c).toMatchObject({ state: "awaiting_second_approval", expiresAt: null });
    await expect(readFiles(sup())).rejects.toMatchObject({ code: "IPB-TRUST-003" });
    await expect(access().approve(ownerA, g.id)).rejects.toMatchObject({ code: "IPB-TRUST-005" });
    // The database holds the rule too.
    await expect(
      db.admin.query(
        "update tenancy.support_grant set second_approver_id = consented_by where id = $1",
        [g.id],
      ),
    ).rejects.toThrow(/check constraint/);
    const a = await access().approve(adminA, g.id);
    expect(a).toMatchObject({
      state: "active",
      consentedBy: "usr_owner_a",
      secondApproverId: "usr_admin_a",
    });
    await kernel.mutate(
      sup(),
      async (tx) => {
        await tx.query("update docs.file set name = 'fixed' where id = 'f1'");
        await audit.record(tx, { action: "docs.file.edit", resourceType: "f", resourceId: "f1" });
      },
      { action: "docs.file.edit" },
    );
    expect((await db.admin.query("select name from docs.file where id = 'f1'")).rows).toEqual([
      { name: "fixed" },
    ]);
    await expect(
      kernel.mutate(
        sup(),
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
    // Support reads still go through SupportReads, even under read-write.
    await expect(
      kernel.read(sup(), async (tx) => (await tx.query("select id from docs.file")).rows),
    ).rejects.toMatchObject({ code: "IPB-SEC-005" });
    await access().revoke(ownerA, g.id);
  });

  it("cross-tenant isolation: a grant in one tenant shows nothing in another", async () => {
    const g = await access().request(sup(), {
      reason: "customer ticket: isolation",
      modules: ["docs"],
    });
    await access().consent(ownerA, g.id);
    expect(await readFiles(sup())).toEqual([{ id: "f1" }]);
    await expect(readFiles(sup("tnt_b"))).rejects.toMatchObject({ code: "IPB-TRUST-003" });
    const ownerB = member("tnt_b", "usr_owner_b");
    expect(await access().list(ownerB)).toEqual([]);
    expect(await access().reads(ownerB)).toEqual([]);
    await expect(access().revoke(ownerB, g.id)).rejects.toThrow(/not found/);
    // Another support principal has nothing in tnt_a either.
    await expect(readFiles(sup("tnt_a", "usr_sup2"))).rejects.toMatchObject({
      code: "IPB-TRUST-003",
    });
    expect((await access().reads(ownerA, { grantId: g.id })).map((r) => r.grantId)).toEqual([g.id]);
  });

  it("a kernel without an audit sink refuses support use; nobody forges or hides a read", async () => {
    const bare = new PgKernel({ pool: db.pool });
    await expect(
      new SupportReads({ kernel: bare, audit }).read(
        sup(),
        "docs.file",
        "select id from docs.file",
      ),
    ).rejects.toThrow(/audit sink/);
    for (const sql of [
      "insert into tenancy.support_read (id, tenant_id, grant_id, principal_id, table_name, row_count) values ('srd_01J00000000000000000000000', 'tnt_a', 'sgr_01J00000000000000000000000', 'x', 'docs.file', 0)",
      "update tenancy.support_read set row_count = 0",
      "delete from tenancy.support_read",
    ])
      await expect(
        kernel.mutate(ownerA, async (tx) => {
          await tx.query(sql);
          await audit.record(tx, { action: "test.tamper.try", resourceType: "x", resourceId: "x" });
        }),
      ).rejects.toThrow(/permission denied/);
    await expect(
      kernel.mutate(ownerA, async (tx) => {
        await tx.query(
          "select tenancy.support_read_record('srd_01J00000000000000000000000', $1, 'docs.file', 0)",
          ["sgr_01J00000000000000000000000"],
        );
        await audit.record(tx, { action: "test.tamper.try", resourceType: "x", resourceId: "x" });
      }),
    ).rejects.toThrow(/not this principal/);
  });

  it("rls-lint passes with the new tables and definer function", async () => {
    expect(await lintRls(db.admin, { schemas: ["tenancy"] })).toEqual([]);
  });
});
