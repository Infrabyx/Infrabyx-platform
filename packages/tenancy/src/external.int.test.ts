// External read access (Finbyx PR-FBX-10 item 5; R1-D-29; tenancy/0010): a grant needs a second
// approver; the grantee reads only the entities, branches and period it covers, only the columns
// the product granted, only through ExternalReads (each read ledgered), and never writes; a
// revoked, expired, foreign or other tenant's grant is refused; rls-lint holds products to the
// restrictive policy.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuditEntryInput, AuditSink, KernelContext, Tx } from "@infrabyx/contracts/kernel";
import { newId } from "@infrabyx/crypto";
import { externalContext } from "./context.js";
import { ExternalGrants, ExternalReads, type ExternalGrant } from "./external.js";
import { PgKernel } from "./kernel.js";
import { lintRls } from "./rls-lint/index.js";
import { freshDb, type TestDb } from "./__tests__/pg.js";

class RecordingAudit implements AuditSink {
  readonly entries: AuditEntryInput[] = [];
  async record(tx: Tx, e: AuditEntryInput): Promise<{ id: string }> {
    this.entries.push(e);
    tx.markAudited();
    return { id: "led_x" };
  }
}

let db: TestDb;
let kernel: PgKernel;
const audit = new RecordingAudit();
const ENT_1 = newId("ent");
const ENT_2 = newId("ent");
const user = (id: string, roles = ["ORG_OWNER"], tenantId = "tnt_a"): KernelContext => ({
  tenantId,
  principal: { id, type: "user", roles },
});

beforeAll(async () => {
  db = await freshDb();
  kernel = new PgKernel({ pool: db.pool });
  await db.admin.query(
    "insert into tenancy.tenant (id, product, name) values ('tnt_a', 'FBX', 'A'), ('tnt_b', 'FBX', 'B')",
  );
  await db.admin.query(
    "insert into tenancy.legal_entity (id, tenant_id, name) values ($1, 'tnt_a', 'One'), ($2, 'tnt_a', 'Two')",
    [ENT_1, ENT_2],
  );
  // A product table as a product would set it up for external reads.
  await db.admin.query(`
    create schema fbx;
    grant usage on schema fbx to app_rw, app_ro, app_external;
    create table fbx.journal (
      tenant_id text not null, id text primary key, entity_id text not null, branch_id text not null,
      booked_on date not null, amount numeric not null, note text);
    alter table fbx.journal enable row level security;
    alter table fbx.journal force row level security;
    create policy journal_tenant on fbx.journal for all
      using (tenant_id = current_setting('app.tenant_id', true));
    create policy journal_external on fbx.journal as restrictive for select to app_external
      using (tenancy.external_allows(entity_id, branch_id, booked_on));
    grant select, insert on fbx.journal to app_rw;
    grant select (tenant_id, id, entity_id, branch_id, booked_on, amount) on fbx.journal to app_external;
    create table fbx.ledger_book (
      tenant_id text not null, id text primary key, entity_id text not null, booked_on date not null);
    alter table fbx.ledger_book enable row level security;
    alter table fbx.ledger_book force row level security;
    create policy book_tenant on fbx.ledger_book for all
      using (tenant_id = current_setting('app.tenant_id', true));
    create policy book_external on fbx.ledger_book as restrictive for select to app_external
      using (tenancy.external_allows(entity_id, booked_on));
    grant select on fbx.ledger_book to app_external;
  `);
  await db.admin.query(
    `insert into fbx.journal values
       ('tnt_a', 'j1', $1, 'br_1', '2026-04-10', 100, 'n'),
       ('tnt_a', 'j2', $1, 'br_2', '2026-04-11', 200, 'n'),
       ('tnt_a', 'j3', $1, 'br_1', '2025-12-31', 300, 'n'),
       ('tnt_a', 'j4', $2, 'br_1', '2026-04-12', 400, 'n'),
       ('tnt_b', 'j5', $1, 'br_1', '2026-04-13', 500, 'n')`,
    [ENT_1, ENT_2],
  );
  await db.admin.query(
    "insert into fbx.ledger_book values ('tnt_a', 'b1', $1, '2026-05-01'), ('tnt_a', 'b2', $2, '2026-05-01')",
    [ENT_1, ENT_2],
  );
});
afterAll(async () => db?.end());

const grants = () => new ExternalGrants({ kernel, audit });
const reads = () => new ExternalReads({ kernel, audit });
async function activeGrant(branchIds?: string[]): Promise<ExternalGrant> {
  const g = await grants().request(user("usr_owner"), {
    granteeId: "ext_auditor_1",
    granteeName: "A. Auditor",
    organisation: "Audit firm",
    kind: "statutory_auditor",
    purpose: "statutory audit FY 2026-27",
    entityIds: [ENT_1],
    ...(branchIds ? { branchIds } : {}),
    periodFrom: "2026-04-01",
    periodTo: "2027-03-31",
  });
  return grants().approve(user("usr_admin", ["ORG_ADMIN"]), g.id);
}

describe("@IPB-02-12 external read access (R1-D-29)", () => {
  it("a grant needs a second ORG_OWNER or ORG_ADMIN and lasts 30 days by default", async () => {
    const g = await grants().request(user("usr_owner"), {
      granteeId: "ext_auditor_1",
      granteeName: "A. Auditor",
      organisation: "Audit firm",
      kind: "statutory_auditor",
      purpose: "statutory audit FY 2026-27",
      entityIds: [ENT_1],
      periodFrom: "2026-04-01",
      periodTo: "2027-03-31",
    });
    expect(g).toMatchObject({ state: "requested", durationDays: 30, branchIds: null });
    await expect(grants().approve(user("usr_owner"), g.id)).rejects.toMatchObject({
      code: "IPB-TRUST-005",
    });
    await expect(grants().approve(user("usr_staff", ["ORG_USER"]), g.id)).rejects.toMatchObject({
      code: "IPB-UX-011",
    });
    // Inactive until approved.
    await expect(
      reads().read(
        externalContext("tnt_a", "ext_auditor_1", g.id),
        "fbx.journal",
        "select id from fbx.journal",
      ),
    ).rejects.toMatchObject({ code: "IPB-TRUST-003" });
    const a = await grants().approve(user("usr_admin", ["ORG_ADMIN"]), g.id);
    expect(a.state).toBe("active");
    const days = ((a.expiresAt as Date).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThanOrEqual(30);
    await expect(
      grants().request(user("usr_owner"), {
        granteeId: "x",
        granteeName: "x",
        organisation: "x",
        kind: "sebi",
        purpose: "inspection of records",
        entityIds: [ENT_1],
        periodFrom: "2026-01-01",
        periodTo: "2026-12-31",
        days: 91,
      }),
    ).rejects.toThrow(RangeError);
    await expect(
      grants().request(user("usr_owner"), {
        granteeId: "x",
        granteeName: "x",
        organisation: "x",
        kind: "sebi",
        purpose: "inspection of records",
        entityIds: [newId("ent")],
        periodFrom: "2026-01-01",
        periodTo: "2026-12-31",
      }),
    ).rejects.toThrow(/legal entity not found/);
  });

  it("reads only the grant's entities, branches and period, and each read is ledgered", async () => {
    const g = await activeGrant(["br_1"]);
    const ctx = externalContext("tnt_a", "ext_auditor_1", g.id);
    const before = audit.entries.length;
    const rows = await reads().read<{ id: string }>(
      ctx,
      "fbx.journal",
      "select id from fbx.journal order by id",
    );
    // j2 is another branch, j3 before the period, j4 another entity, j5 another tenant.
    expect(rows.map((r) => r.id)).toEqual(["j1"]);
    expect(audit.entries.slice(before)).toEqual([
      {
        action: "platform.external_read",
        resourceType: "external_read",
        resourceId: `${g.id}/fbx.journal`,
        after: { grant_id: g.id, table: "fbx.journal", rows: 1 },
      },
    ]);
    // A read that finds nothing is ledgered too.
    await reads().read(ctx, "fbx.journal", "select id from fbx.journal where id = 'none'");
    expect(audit.entries.at(-1)?.after).toMatchObject({ rows: 0 });
    // A grant listing branches covers no table without branches.
    expect(await reads().read(ctx, "fbx.ledger_book", "select id from fbx.ledger_book")).toEqual(
      [],
    );
  });

  it("a grant without branches covers every branch, and tables without branches", async () => {
    const g = await activeGrant();
    const ctx = externalContext("tnt_a", "ext_auditor_1", g.id);
    const j = await reads().read<{ id: string }>(
      ctx,
      "fbx.journal",
      "select id from fbx.journal order by id",
    );
    expect(j.map((r) => r.id)).toEqual(["j1", "j2"]);
    const b = await reads().read<{ id: string }>(
      ctx,
      "fbx.ledger_book",
      "select id from fbx.ledger_book",
    );
    expect(b.map((r) => r.id)).toEqual(["b1"]);
  });

  it("reads only the granted columns, never writes, and never reads outside ExternalReads", async () => {
    const g = await activeGrant();
    const ctx = externalContext("tnt_a", "ext_auditor_1", g.id);
    await expect(reads().read(ctx, "fbx.journal", "select note from fbx.journal")).rejects.toThrow(
      /permission denied/,
    );
    await expect(
      reads().read(ctx, "fbx.journal", "delete from fbx.journal returning id"),
    ).rejects.toThrow(/read-only transaction|permission denied/);
    await expect(
      reads().read(ctx, "tenancy.external_grant", "select * from tenancy.external_grant"),
    ).rejects.toThrow(/permission denied/);
    await expect(
      kernel.read(ctx, async (tx) => (await tx.query("select id from fbx.journal")).rows),
    ).rejects.toMatchObject({ code: "IPB-SEC-005" });
    await expect(
      kernel.mutate(ctx, async (tx) => {
        await audit.record(tx, { action: "test.write", resourceType: "x", resourceId: "x" });
      }),
    ).rejects.toMatchObject({ code: "IPB-SEC-005" });
    await expect(
      kernel.mutate(
        ctx,
        async (tx) => {
          await audit.record(tx, {
            action: "platform.external_read",
            resourceType: "x",
            resourceId: "x",
          });
        },
        { action: "platform.external_read" },
      ),
    ).rejects.toMatchObject({ code: "IPB-SEC-005" });
  });

  it("a revoked, expired, foreign or other tenant's grant is refused", async () => {
    const g = await activeGrant();
    const q = (ctx: KernelContext) =>
      reads().read(ctx, "fbx.journal", "select id from fbx.journal");
    await expect(q(externalContext("tnt_a", "ext_other", g.id))).rejects.toMatchObject({
      code: "IPB-TRUST-003",
    });
    await expect(q(externalContext("tnt_b", "ext_auditor_1", g.id))).rejects.toMatchObject({
      code: "IPB-TRUST-003",
    });
    const e = await activeGrant();
    await db.admin.query(
      "update tenancy.external_grant set approved_at = now() - interval '31 days', expires_at = now() - interval '1 day' where id = $1",
      [e.id],
    );
    await expect(q(externalContext("tnt_a", "ext_auditor_1", e.id))).rejects.toMatchObject({
      code: "IPB-TRUST-003",
    });
    expect((await grants().revoke(user("usr_owner"), g.id)).state).toBe("revoked");
    await expect(q(externalContext("tnt_a", "ext_auditor_1", g.id))).rejects.toMatchObject({
      code: "IPB-TRUST-003",
    });
    // The tenant lists its grants; another tenant sees none of them.
    expect((await grants().list(user("usr_owner"))).length).toBeGreaterThan(0);
    expect(await grants().list(user("usr_owner", ["ORG_OWNER"], "tnt_b"))).toEqual([]);
  });

  it("an external context carries one grant and nothing that widens it", async () => {
    const id = newId("xgr");
    expect(() => externalContext("tnt_platform", "ext_auditor_1", id)).toThrow(
      expect.objectContaining({ code: "IPB-SEC-005" }),
    );
    expect(() => externalContext("tnt_a", "ext_auditor_1", "bgr_x")).toThrow(
      expect.objectContaining({ code: "IPB-SEC-005" }),
    );
    await expect(
      kernel.read(
        {
          tenantId: "tnt_a",
          externalGrantId: id,
          principal: { id: "usr_owner", type: "user", roles: ["ORG_OWNER"] },
        },
        async () => 1,
      ),
    ).rejects.toMatchObject({ code: "IPB-SEC-005" });
    await expect(
      kernel.read(
        {
          tenantId: "tnt_a",
          externalGrantId: id,
          principal: { id: "ext_auditor_1", type: "external", roles: ["PLT_AUDITOR_RO"] },
        },
        async () => 1,
      ),
    ).rejects.toMatchObject({ code: "IPB-SEC-005" });
  });

  it("rls-lint holds a product to the restrictive policy and to SELECT only", async () => {
    expect(await lintRls(db.admin, { schemas: ["tenancy", "fbx"] })).toEqual([]);
    await db.admin.query(`
      create table fbx.open_book (tenant_id text not null, id text primary key);
      alter table fbx.open_book enable row level security;
      alter table fbx.open_book force row level security;
      create policy open_tenant on fbx.open_book for all
        using (tenant_id = current_setting('app.tenant_id', true));
      grant select, insert on fbx.open_book to app_external;
    `);
    const f = (await lintRls(db.admin, { schemas: ["tenancy", "fbx"] })).filter(
      (x) => x.rule === "external-read",
    );
    expect(f.map((x) => [x.object, x.message])).toEqual([
      ["fbx.open_book", "app_external may only SELECT"],
      [
        "fbx.open_book",
        "a table app_external reads needs a RESTRICTIVE select policy calling tenancy.external_allows()",
      ],
    ]);
    await db.admin.query("drop table fbx.open_book");
  });
});
