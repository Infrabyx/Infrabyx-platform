// Break-glass visible to the tenant (Finbyx PR-FBX-10 item 3; OUT 24, 70; R1-D-28; tenancy/0009):
// a grant used in a tenant, by a read or a write, is recorded there; the tenant sees its own uses
// only; nobody can write or hide one; the notice job raises BreakGlassUsed once per grant.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuditEntryInput, AuditSink, KernelContext, Tx } from "@infrabyx/contracts/kernel";
import { BreakGlass, BreakGlassTenantNotices } from "./breakglass.js";
import { PgKernel } from "./kernel.js";
import { PgOutbox } from "./outbox.js";
import { lintRls } from "./rls-lint/index.js";
import { freshDb, type TestDb } from "./__tests__/pg.js";

class RecordingAudit implements AuditSink {
  readonly actions: string[] = [];
  async record(tx: Tx, e: AuditEntryInput): Promise<{ id: string }> {
    this.actions.push(e.action);
    tx.markAudited();
    return { id: "led_x" };
  }
}

let db: TestDb;
let kernel: PgKernel;
const audit = new RecordingAudit();
const outbox = new PgOutbox();
const platform = (id: string, roles: string[]): KernelContext => ({
  tenantId: "tnt_platform",
  scope: "platform",
  principal: { id, type: "user", roles },
});
const tenantUser = (tenantId: string): KernelContext => ({
  tenantId,
  principal: { id: "usr_owner", type: "user", roles: ["ORG_OWNER"] },
});
const bgIn = (tenantId: string, grantId: string): KernelContext => ({
  tenantId,
  breakGlassGrantId: grantId,
  principal: { id: "usr_sa1", type: "breakglass", roles: ["PLT_SUPER_ADMIN"] },
});

beforeAll(async () => {
  db = await freshDb();
  kernel = new PgKernel({ pool: db.pool });
  await db.admin.query(
    `insert into tenancy.tenant (id, product, name) values ('tnt_platform', 'PLATFORM', 'Infrabyx'),
       ('tnt_a', 'FBX', 'A'), ('tnt_b', 'FBX', 'B')`,
  );
});
afterAll(async () => db?.end());

describe("@IPB-02-06 break-glass visible to the tenant (R1-D-28)", () => {
  it("records every use in the tenant it touches; each tenant sees only its own", async () => {
    const bg = new BreakGlass({ kernel, audit, outbox, product: "FBX" });
    const g = await bg.request(
      platform("usr_sa1", ["PLT_SUPER_ADMIN"]),
      "incident INC-7 on tenant A",
      60,
    );
    await bg.approve(platform("usr_so", ["PLT_SECURITY_OFFICER"]), g.id);
    expect(await kernel.read(bgIn("tnt_a", g.id), async () => "read")).toBe("read");
    expect(await kernel.read(bgIn("tnt_a", g.id), async () => "again")).toBe("again");
    const notices = new BreakGlassTenantNotices({ kernel, audit, outbox, product: "FBX" });
    const seen = await notices.list(tenantUser("tnt_a"));
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      grantId: g.id,
      requesterId: "usr_sa1",
      approverId: "usr_so",
      reason: "incident INC-7 on tenant A",
      uses: 2,
      notifiedAt: null,
    });
    expect(await notices.list(tenantUser("tnt_b"))).toEqual([]);
  });

  it("raises BreakGlassUsed once per grant in the tenant, and nothing when there is nothing new", async () => {
    const notices = new BreakGlassTenantNotices({ kernel, audit, outbox, product: "FBX" });
    expect(await notices.notify(tenantUser("tnt_a"))).toBe(1);
    expect(await notices.notify(tenantUser("tnt_a"))).toBe(0);
    const ev = await db.admin.query<{ type: string; tenant_id: string }>(
      "select envelope->>'type' as type, tenant_id from tenancy.outbox where envelope->>'type' like '%BreakGlassUsed%'",
    );
    expect(ev.rows).toEqual([{ type: "in.fbx.security.BreakGlassUsed.v1", tenant_id: "tnt_a" }]);
    expect(audit.actions.filter((a) => a === "security.breakglass.use_notified")).toHaveLength(1);
  });

  it("an inactive grant records nothing and is refused; the application cannot write or hide a use", async () => {
    await expect(
      kernel.read(bgIn("tnt_b", "bgr_01J00000000000000000000000"), async () => 1),
    ).rejects.toMatchObject({
      code: "IPB-SEC-009",
    });
    expect(
      (await db.admin.query("select 1 from tenancy.breakglass_use where tenant_id = 'tnt_b'")).rows,
    ).toEqual([]);
    for (const sql of [
      "insert into tenancy.breakglass_use (tenant_id, grant_id, requester_id, reason) values ('tnt_a', 'bgr_01J00000000000000000000001', 'x', 'y')",
      "update tenancy.breakglass_use set notified_at = now()",
      "delete from tenancy.breakglass_use",
    ])
      await expect(
        kernel.mutate(tenantUser("tnt_a"), async (tx) => {
          await tx.query(sql);
          await audit.record(tx, { action: "test.tamper.try", resourceType: "x", resourceId: "x" });
        }),
      ).rejects.toThrow(/permission denied/);
  });

  it("rls-lint passes with the new table and definer functions", async () => {
    expect(await lintRls(db.admin, { schemas: ["tenancy"] })).toEqual([]);
  });
});
