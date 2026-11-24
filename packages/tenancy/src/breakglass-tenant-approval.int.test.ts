// Finbyx PR-FBX-55 (owner order of 24 Nov 2026; R1-D-284; tenancy/0031), with RLS on: a scoped
// break-glass grant decided on by the tenant it is scoped to, as a maker-checker in the tenant
// (one manager for `read`, two different ones for `read_write`), time-boxed at most to the grant's
// duration, ledgered in the tenant and revocable at once; the kernel always enforces a refusal or
// revocation and, with `requireTenantApprovedBreakGlass`, admits a scoped grant only while its
// approval is live; unscoped break-glass unchanged; support grants carry `tenantApproved`.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuditEntryInput, AuditSink, KernelContext, Tx } from "@infrabyx/contracts/kernel";
import { BreakGlass, type BreakGlassScope } from "./breakglass.js";
import { BREAKGLASS_TENANT_ACTIONS, BreakGlassTenantApproval } from "./breakglass-tenant.js";
import {
  BREAKGLASS_SCOPE_REFUSED_ACTION,
  BREAKGLASS_TENANT_APPROVAL_REFUSAL,
  PgKernel,
} from "./kernel.js";
import { PgOutbox } from "./outbox.js";
import { lintRls } from "./rls-lint/index.js";
import { SupportAccess, supportContext } from "./support.js";
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
  of(action: string, grantId: string): Entry[] {
    return this.entries.filter((e) => e.action === action && e.resourceId === grantId);
  }
}

let db: TestDb;
let kernel: PgKernel;
let strict: PgKernel;
const audit = new RecordingAudit();
const outbox = new PgOutbox();
const platform = (id: string, roles: string[]): KernelContext => ({
  tenantId: "tnt_platform",
  scope: "platform",
  principal: { id, type: "user", roles },
});
const member = (tenantId: string, id: string, roles = ["ORG_OWNER"]): KernelContext => ({
  tenantId,
  principal: { id, type: "user", roles },
});
const ownerA = member("tnt_a", "usr_owner_a");
const adminA = member("tnt_a", "usr_admin_a", ["ORG_ADMIN"]);
const ownerB = member("tnt_b", "usr_owner_b");
const bgIn = (tenantId: string, grantId: string): KernelContext => ({
  tenantId,
  breakGlassGrantId: grantId,
  principal: { id: "usr_sa1", type: "breakglass", roles: ["PLT_SUPER_ADMIN"] },
});
const bg = () => new BreakGlass({ kernel, audit, product: "FBX" });
const tenant = () => new BreakGlassTenantApproval({ kernel, audit, outbox, product: "FBX" });
const readDocs = (k: PgKernel, ctx: KernelContext) =>
  k.read(ctx, async (tx) => (await tx.query<{ id: string }>("select id from docs.file")).rows);

async function request(scope?: BreakGlassScope, minutes = 60): Promise<string> {
  const g = await bg().request(
    platform("usr_sa1", ["PLT_SUPER_ADMIN"]),
    "incident INC-55 on a lender tenant",
    minutes,
    scope,
  );
  return g.id;
}
async function grant(scope?: BreakGlassScope, minutes = 60): Promise<string> {
  const id = await request(scope, minutes);
  await bg().approve(platform("usr_so", ["PLT_SECURITY_OFFICER"]), id);
  return id;
}
const uses = async (grantId: string, tenantId = "tnt_a"): Promise<number> =>
  (
    await db.admin.query<{ uses: number }>(
      "select uses from tenancy.breakglass_use where grant_id = $1 and tenant_id = $2",
      [grantId, tenantId],
    )
  ).rows[0]?.uses ?? 0;
const minutesOf = (from: Date | null, to: Date | null): number =>
  Math.round(((to?.getTime() ?? 0) - (from?.getTime() ?? 0)) / 60_000);

/** Runs `sql` as `role` with the given settings; resolves to its rows or rejects with its error. */
async function asRole<R extends Record<string, unknown>>(
  role: string,
  settings: Record<string, string>,
  sql: string,
  params: unknown[] = [],
): Promise<R[]> {
  const c = await db.pool.connect();
  try {
    await c.query("begin");
    await c.query(`set local role ${role}`);
    for (const [k, v] of Object.entries(settings))
      await c.query("select set_config($1, $2, true)", [k, v]);
    return (await c.query<R>(sql, params)).rows;
  } finally {
    await c.query("rollback").catch(() => undefined);
    c.release();
  }
}

beforeAll(async () => {
  db = await freshDb();
  kernel = new PgKernel({ pool: db.pool, audit });
  strict = new PgKernel({ pool: db.pool, audit, requireTenantApprovedBreakGlass: true });
  await db.admin.query(
    `insert into tenancy.tenant (id, product, name) values ('tnt_platform', 'PLATFORM', 'Infrabyx'),
       ('tnt_a', 'FBX', 'A'), ('tnt_b', 'FBX', 'B')`,
  );
  await db.admin.query(`
    create schema docs;
    grant usage on schema docs to app_rw, app_ro;
    create table docs.file (tenant_id text not null, id text primary key, name text);
    alter table docs.file enable row level security;
    alter table docs.file force row level security;
    create policy t on docs.file for all
      using (tenant_id = current_setting('app.tenant_id', true))
      with check (tenant_id = current_setting('app.tenant_id', true));
    grant select, insert, update on docs.file to app_rw, app_ro;
    insert into docs.file values ('tnt_a', 'f1', 'a'), ('tnt_b', 'f2', 'b');
  `);
});
afterAll(async () => db?.end());

describe("@IPB-02-06 a scoped break-glass grant approved by its tenant (PR-FBX-55, R1-D-284)", () => {
  it("pending lists only this tenant's scoped grants that are requested or active", async () => {
    const requested = await request({ tenantId: "tnt_a", modules: ["docs"] });
    const active = await grant({ tenantId: "tnt_a", access: "read_write" });
    const revoked = await grant({ tenantId: "tnt_a" });
    await bg().revoke(platform("usr_so", ["PLT_SECURITY_OFFICER"]), revoked);
    const expired = await grant({ tenantId: "tnt_a" });
    await db.admin.query(
      "update tenancy.breakglass_grant set expires_at = now() - interval '1 minute' where id = $1",
      [expired],
    );
    const other = await grant({ tenantId: "tnt_b" });
    const unscoped = await grant();

    const a = await tenant().pending(ownerA);
    const ids = a.map((p) => p.grantId);
    expect(ids).toContain(requested);
    expect(ids).toContain(active);
    for (const id of [revoked, expired, other, unscoped]) expect(ids).not.toContain(id);
    expect(a.find((p) => p.grantId === requested)).toMatchObject({
      requesterId: "usr_sa1",
      approverId: null,
      reason: "incident INC-55 on a lender tenant",
      durationMinutes: 60,
      modules: ["docs"],
      access: "read",
      grantState: "requested",
      grantExpiresAt: null,
      approval: null,
      tenantState: "none",
    });
    expect(a.find((p) => p.grantId === active)).toMatchObject({
      approverId: "usr_so",
      modules: null,
      access: "read_write",
      grantState: "active",
    });
    // Another tenant sees only its own.
    const b = (await tenant().pending(ownerB)).map((p) => p.grantId);
    expect(b).toContain(other);
    for (const id of [requested, active, unscoped]) expect(b).not.toContain(id);
  });

  it("a read grant is approved by one manager, ledgered and raised in the tenant", async () => {
    const id = await grant({ tenantId: "tnt_a", modules: ["docs"] }, 90);
    expect(await tenant().status(ownerA, id)).toEqual({
      tenantApproved: false,
      state: "none",
      expiresAt: null,
    });
    const r = await tenant().approve(ownerA, id);
    expect(r).toMatchObject({
      grantId: id,
      tenantId: "tnt_a",
      access: "read",
      state: "approved",
      windowMinutes: 90,
      firstApproverId: "usr_owner_a",
      secondApproverId: null,
    });
    expect(minutesOf(r.firstApprovedAt, r.expiresAt)).toBe(90);
    const s = await tenant().status(adminA, id);
    expect(s).toMatchObject({ tenantApproved: true, state: "approved" });
    expect(s.expiresAt?.getTime()).toBe(r.expiresAt?.getTime());
    const led = audit.of(BREAKGLASS_TENANT_ACTIONS.approve, id);
    expect(led).toHaveLength(1);
    expect(led[0]).toMatchObject({
      tenantId: "tnt_a",
      actorId: "usr_owner_a",
      resourceType: "breakglass_grant",
      before: { state: "none" },
      after: { state: "approved", access: "read", window_minutes: 90 },
    });
    const ev = await db.admin.query(
      "select envelope->>'type' as type, tenant_id, envelope->'data'->>'grant_id' as grant_id from tenancy.outbox where envelope->'data'->>'grant_id' = $1",
      [id],
    );
    expect(ev.rows).toEqual([
      { type: "in.fbx.security.BreakGlassTenantApproved.v1", tenant_id: "tnt_a", grant_id: id },
    ]);
    // Approved once: a second approval of the same grant is a conflict.
    await expect(tenant().approve(adminA, id)).rejects.toThrow(/is approved/);
  });

  it("a read_write grant needs a second, different manager; the same one twice is refused", async () => {
    const id = await grant({ tenantId: "tnt_a", access: "read_write" });
    const first = await tenant().approve(adminA, id, { minutes: 30 });
    expect(first).toMatchObject({
      state: "awaiting_second_approval",
      firstApproverId: "usr_admin_a",
      expiresAt: null,
    });
    expect(await tenant().status(ownerA, id)).toEqual({
      tenantApproved: false,
      state: "awaiting_second_approval",
      expiresAt: null,
    });
    await expect(tenant().approve(adminA, id)).rejects.toMatchObject({ code: "IPB-TRUST-005" });
    // Nothing is raised before the final approval.
    expect(
      (
        await db.admin.query(
          "select 1 from tenancy.outbox where envelope->'data'->>'grant_id' = $1",
          [id],
        )
      ).rows,
    ).toEqual([]);
    const second = await tenant().approve(ownerA, id);
    expect(second).toMatchObject({
      state: "approved",
      firstApproverId: "usr_admin_a",
      secondApproverId: "usr_owner_a",
      // The smaller of the two windows.
      windowMinutes: 30,
    });
    expect(minutesOf(second.secondApprovedAt, second.expiresAt)).toBe(30);
    expect(await tenant().status(ownerA, id)).toMatchObject({ tenantApproved: true });
    expect(audit.of(BREAKGLASS_TENANT_ACTIONS.approve, id).map((e) => e.after)).toMatchObject([
      { state: "awaiting_second_approval" },
      { state: "approved" },
    ]);
  });

  it("the window is capped at the grant's duration; out-of-range minutes are refused", async () => {
    const id = await grant({ tenantId: "tnt_a" }, 45);
    await expect(tenant().approve(ownerA, id, { minutes: 0 })).rejects.toThrow(RangeError);
    await expect(tenant().approve(ownerA, id, { minutes: 241 })).rejects.toThrow(RangeError);
    await expect(tenant().approve(ownerA, id, { minutes: 1.5 })).rejects.toThrow(RangeError);
    const r = await tenant().approve(ownerA, id, { minutes: 240 });
    expect(r.windowMinutes).toBe(45);
    expect(minutesOf(r.firstApprovedAt, r.expiresAt)).toBe(45);
    const short = await grant({ tenantId: "tnt_a" }, 45);
    const s = await tenant().approve(ownerA, short, { minutes: 10 });
    expect(minutesOf(s.firstApprovedAt, s.expiresAt)).toBe(10);
  });

  it("only the tenant's own named managers decide: agents, support, other roles and the platform side are refused", async () => {
    const id = await grant({ tenantId: "tnt_a" });
    const refused: Array<[KernelContext, string]> = [
      [member("tnt_a", "usr_m", ["ORG_MEMBER"]), "IPB-UX-011"],
      [member("tnt_a", "usr_c", ["ORG_CHECKER"]), "IPB-UX-011"],
      [member("tnt_a", "usr_ag", ["ORG_ADMIN", "AGT_HELPER"]), "IPB-SEC-004"],
      [
        { tenantId: "tnt_a", principal: { id: "agt_1", type: "agent", roles: ["ORG_ADMIN"] } },
        "IPB-SEC-005",
      ],
      [
        { tenantId: "tnt_a", principal: { id: "svc_1", type: "service", roles: ["ORG_ADMIN"] } },
        "IPB-SEC-005",
      ],
      [supportContext("tnt_a", "usr_sup1"), "IPB-SEC-005"],
      [{ ...ownerA, scope: "platform" }, "IPB-SEC-005"],
      [member("tnt_platform", "usr_owner_p"), "IPB-SEC-005"],
      [platform("usr_so", ["PLT_SECURITY_OFFICER"]), "IPB-SEC-005"],
      [member("tnt_a", "usr_mixed", ["ORG_ADMIN", "PLT_SUPER_ADMIN"]), "IPB-SEC-005"],
      [{ ...ownerA, breakGlassGrantId: id }, "IPB-SEC-005"],
      [{ ...ownerA, act: { sub: "usr_x", sessionId: "s1" } }, "IPB-SEC-005"],
    ];
    for (const [ctx, code] of refused) {
      await expect(tenant().approve(ctx, id)).rejects.toMatchObject({ code });
      await expect(tenant().pending(ctx)).rejects.toMatchObject({ code });
      await expect(tenant().status(ctx, id)).rejects.toMatchObject({ code });
      await expect(tenant().revoke(ctx, id)).rejects.toMatchObject({ code });
    }
    // The grant's own requester holding a tenant role in the tenant is still the platform side.
    await expect(tenant().approve(member("tnt_a", "usr_sa1"), id)).rejects.toMatchObject({
      code: "IPB-TRUST-005",
    });
    await expect(tenant().approve(member("tnt_a", "usr_so"), id)).rejects.toMatchObject({
      code: "IPB-TRUST-005",
    });
    expect(await tenant().status(ownerA, id)).toMatchObject({ state: "none" });
  });

  it("an unscoped grant, another tenant's grant and a revoked or expired grant cannot be approved", async () => {
    const unscoped = await grant();
    const other = await grant({ tenantId: "tnt_b" });
    const revoked = await grant({ tenantId: "tnt_a" });
    await bg().revoke(platform("usr_so", ["PLT_SECURITY_OFFICER"]), revoked);
    const expired = await grant({ tenantId: "tnt_a" });
    await db.admin.query(
      "update tenancy.breakglass_grant set expires_at = now() - interval '1 second' where id = $1",
      [expired],
    );
    for (const id of [unscoped, other, revoked, expired]) {
      await expect(tenant().approve(ownerA, id)).rejects.toThrow(/not found/);
      await expect(tenant().refuse(ownerA, id, "not ours")).rejects.toThrow(/not found/);
      await expect(tenant().revoke(ownerA, id)).rejects.toThrow(/not found/);
    }
    await expect(tenant().approve(ownerA, "bgr_nope")).rejects.toThrow(RangeError);
    // Tenant B decides on its own grant only, and tenant A sees nothing of it.
    await tenant().approve(ownerB, other);
    expect(await tenant().status(ownerA, other)).toMatchObject({
      tenantApproved: false,
      state: "none",
    });
    expect(await tenant().status(ownerB, other)).toMatchObject({ tenantApproved: true });
  });

  it("kernel option off: an unapproved scoped grant still works; on: refused IPB-SEC-005, ledgered in the tenant, no use", async () => {
    const id = await grant({ tenantId: "tnt_a", modules: ["docs"] });
    expect(await readDocs(kernel, bgIn("tnt_a", id))).toEqual([{ id: "f1" }]);
    expect(await uses(id)).toBe(1);
    await expect(readDocs(strict, bgIn("tnt_a", id))).rejects.toMatchObject({
      code: "IPB-SEC-005",
      meta: {
        grant_id: id,
        reason: "tenant_approval",
        refusal: BREAKGLASS_TENANT_APPROVAL_REFUSAL,
        tenant_approval: "none",
      },
    });
    expect(await uses(id)).toBe(1);
    const refusals = audit.of(BREAKGLASS_SCOPE_REFUSED_ACTION, id);
    expect(refusals).toHaveLength(1);
    expect(refusals[0]).toMatchObject({
      tenantId: "tnt_a",
      actorId: "usr_sa1",
      resourceType: "breakglass_grant",
      after: {
        reason: "tenant_approval",
        tenant_approval: "none",
        tenant_id: "tnt_a",
        scope: { tenant_id: "tnt_a", modules: ["docs"], access: "read" },
      },
    });
    // Awaiting a second approval is not approved either.
    const rw = await grant({ tenantId: "tnt_a", access: "read_write" });
    await tenant().approve(ownerA, rw);
    await expect(readDocs(strict, bgIn("tnt_a", rw))).rejects.toMatchObject({
      meta: { refusal: "tenant_approval", tenant_approval: "awaiting_second_approval" },
    });
    expect(await uses(rw)).toBe(0);
  });

  it("approved: the scoped grant works with the option on, its use recorded; a write needs read_write", async () => {
    const id = await grant({ tenantId: "tnt_a", modules: ["docs"] });
    await tenant().approve(adminA, id);
    expect(await readDocs(strict, bgIn("tnt_a", id))).toEqual([{ id: "f1" }]);
    expect(await uses(id)).toBe(1);
    // The scope still holds: a write under `read` is refused as before.
    await expect(
      strict.mutate(
        bgIn("tnt_a", id),
        async (tx) => {
          await tx.query("update docs.file set name = 'x'");
          await audit.record(tx, { action: "docs.file.edit", resourceType: "f", resourceId: "f1" });
        },
        { action: "docs.file.edit" },
      ),
    ).rejects.toMatchObject({ code: "IPB-SEC-005", meta: { reason: "write" } });
    // Its approval in tenant A means nothing in tenant B.
    await expect(readDocs(strict, bgIn("tnt_b", id))).rejects.toMatchObject({
      meta: { reason: "tenant" },
    });
  });

  it("revoked or refused: refused at once, even with the option off; final", async () => {
    const id = await grant({ tenantId: "tnt_a", modules: ["docs"] });
    await tenant().approve(ownerA, id);
    expect(await readDocs(kernel, bgIn("tnt_a", id))).toHaveLength(1);
    const r = await tenant().revoke(adminA, id);
    expect(r).toMatchObject({ state: "revoked", endedBy: "usr_admin_a", reason: null });
    for (const k of [kernel, strict])
      await expect(readDocs(k, bgIn("tnt_a", id))).rejects.toMatchObject({
        code: "IPB-SEC-005",
        meta: { refusal: "tenant_approval", tenant_approval: "revoked" },
      });
    expect(await uses(id)).toBe(1);
    expect(await tenant().status(ownerA, id)).toEqual({
      tenantApproved: false,
      state: "revoked",
      expiresAt: r.expiresAt,
    });
    await expect(tenant().approve(ownerA, id)).rejects.toThrow(/is revoked/);
    await expect(tenant().revoke(ownerA, id)).rejects.toThrow(/is revoked/);
    expect(audit.of(BREAKGLASS_TENANT_ACTIONS.revoke, id)).toMatchObject([
      { tenantId: "tnt_a", before: { state: "approved" }, after: { state: "revoked" } },
    ]);

    // A grant the tenant never approved can be refused (with a reason) or revoked outright.
    const refusedId = await grant({ tenantId: "tnt_a" });
    await expect(tenant().refuse(ownerA, refusedId, "")).rejects.toThrow(RangeError);
    await expect(tenant().refuse(ownerA, refusedId, "no\nthanks")).rejects.toThrow(RangeError);
    const f = await tenant().refuse(ownerA, refusedId, "no incident on our side");
    expect(f).toMatchObject({ state: "refused", reason: "no incident on our side" });
    await expect(readDocs(kernel, bgIn("tnt_a", refusedId))).rejects.toMatchObject({
      meta: { tenant_approval: "refused" },
    });
    expect(await uses(refusedId)).toBe(0);
    await expect(tenant().approve(adminA, refusedId)).rejects.toThrow(/is refused/);
    const blocked = await grant({ tenantId: "tnt_a" });
    await tenant().revoke(ownerA, blocked);
    await expect(readDocs(kernel, bgIn("tnt_a", blocked))).rejects.toMatchObject({
      meta: { tenant_approval: "revoked" },
    });
    // A read-write grant awaiting its second approval may be refused.
    const rw = await grant({ tenantId: "tnt_a", access: "read_write" });
    await tenant().approve(ownerA, rw);
    expect(await tenant().refuse(adminA, rw, "one approver is enough")).toMatchObject({
      state: "refused",
      firstApproverId: "usr_owner_a",
    });
    const ev = await db.admin.query<{ type: string; state: string }>(
      `select envelope->>'type' as type, envelope->'data'->>'state' as state from tenancy.outbox
        where envelope->'data'->>'grant_id' = any($1::text[]) and envelope->>'type' like '%Revoked%'
        order by envelope->'data'->>'grant_id'`,
      [[id, refusedId, blocked, rw]],
    );
    expect(ev.rows.map((e) => e.type)).toEqual(
      Array(4).fill("in.fbx.security.BreakGlassTenantRevoked.v1"),
    );
    expect(ev.rows.map((e) => e.state).sort()).toEqual([
      "refused",
      "refused",
      "revoked",
      "revoked",
    ]);
  });

  it("an expired approval is refused with the option on", async () => {
    const id = await grant({ tenantId: "tnt_a", modules: ["docs"] });
    await tenant().approve(ownerA, id, { minutes: 5 });
    expect(await readDocs(strict, bgIn("tnt_a", id))).toHaveLength(1);
    // Age the approval (the fixture bypasses the table's trigger, as only a manager writes it).
    await db.admin.query("begin");
    await db.admin.query("set local session_replication_role = replica");
    await db.admin.query(
      `update tenancy.breakglass_tenant_approval
          set first_approved_at = now() - interval '10 minutes', expires_at = now() - interval '5 minutes'
        where grant_id = $1`,
      [id],
    );
    await db.admin.query("commit");
    expect(await tenant().status(ownerA, id)).toMatchObject({
      tenantApproved: false,
      state: "expired",
    });
    expect((await tenant().pending(ownerA)).find((p) => p.grantId === id)?.tenantState).toBe(
      "expired",
    );
    await expect(readDocs(strict, bgIn("tnt_a", id))).rejects.toMatchObject({
      meta: { refusal: "tenant_approval", tenant_approval: "expired" },
    });
    // Without the option an expired approval is no refusal; the tenant may still revoke it.
    expect(await readDocs(kernel, bgIn("tnt_a", id))).toHaveLength(1);
    await tenant().revoke(ownerA, id);
    await expect(readDocs(kernel, bgIn("tnt_a", id))).rejects.toMatchObject({
      meta: { tenant_approval: "revoked" },
    });
  });

  it("a revocation landing between the kernel's preflight and the transaction still stops it", async () => {
    const id = await grant({ tenantId: "tnt_a", modules: ["docs"] });
    await tenant().approve(ownerA, id);
    // The second connection is the transaction's (the first is the preflight's): revoke before it.
    let connects = 0;
    const racing = new PgKernel({
      pool: {
        async connect() {
          if (++connects === 2) await tenant().revoke(adminA, id);
          return db.pool.connect();
        },
      },
      audit,
      requireTenantApprovedBreakGlass: true,
    });
    await expect(readDocs(racing, bgIn("tnt_a", id))).rejects.toMatchObject({
      code: "IPB-SEC-005",
      meta: { refusal: "tenant_approval", tenant_approval: "revoked" },
    });
    expect(audit.of(BREAKGLASS_SCOPE_REFUSED_ACTION, id).map((e) => e.after)).toMatchObject([
      { reason: "tenant_approval", tenant_approval: "revoked" },
    ]);
  });

  it("unscoped break-glass is unchanged with the option on", async () => {
    const id = await grant();
    expect(await readDocs(strict, bgIn("tnt_b", id))).toEqual([{ id: "f2" }]);
    await strict.mutate(
      bgIn("tnt_a", id),
      async (tx) => {
        await tx.query("insert into docs.file values ('tnt_a', 'f9', 'n')");
        await audit.record(tx, { action: "docs.file.create", resourceType: "f", resourceId: "f9" });
      },
      { action: "docs.file.create" },
    );
    expect(audit.of(BREAKGLASS_SCOPE_REFUSED_ACTION, id)).toEqual([]);
  });

  it("RLS and the trigger: another tenant sees no rows; nobody writes a decision but the acting manager", async () => {
    const id = await grant({ tenantId: "tnt_a", access: "read_write" });
    await tenant().approve(ownerA, id);
    for (const role of ["app_ro", "app_rw"]) {
      const seen = await asRole<{ tenant_id: string; grant_id: string }>(
        role,
        { "app.tenant_id": "tnt_b" },
        "select tenant_id, grant_id from tenancy.breakglass_tenant_approval",
      );
      expect(seen.map((r) => r.grant_id)).not.toContain(id);
      expect(seen.every((r) => r.tenant_id === "tnt_b")).toBe(true);
      expect(
        await asRole(role, {}, "select grant_id from tenancy.breakglass_tenant_approval"),
      ).toEqual([]);
      expect(
        await asRole(
          role,
          { "app.tenant_id": "tnt_b" },
          "select tenancy.breakglass_tenant_approval_state($1) as s",
          [id],
        ),
      ).toEqual([{ s: "none" }]);
      expect(
        (
          await asRole<{ id: string }>(
            role,
            { "app.tenant_id": "tnt_b" },
            "select id from tenancy.breakglass_tenant_pending()",
          )
        ).map((r) => r.id),
      ).not.toContain(id);
      expect(
        await asRole(
          role,
          { "app.tenant_id": "tnt_a", "app.scope": "platform" },
          "select id from tenancy.breakglass_tenant_pending()",
        ),
      ).toEqual([]);
      expect(
        await asRole(
          role,
          { "app.tenant_id": "tnt_a" },
          "select tenancy.breakglass_tenant_approval_state($1) as s",
          [id],
        ),
      ).toEqual([{ s: "awaiting_second_approval" }]);
    }
    await expect(
      asRole(
        "app_ro",
        { "app.tenant_id": "tnt_a" },
        "delete from tenancy.breakglass_tenant_approval",
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asRole(
        "app_rw",
        { "app.tenant_id": "tnt_a" },
        "delete from tenancy.breakglass_tenant_approval",
      ),
    ).rejects.toThrow(/permission denied/);
    const manager = {
      "app.tenant_id": "tnt_a",
      "app.actor_id": "usr_admin_a",
      "app.roles": "ORG_ADMIN",
    };
    const second =
      "update tenancy.breakglass_tenant_approval set state = 'approved', second_approver_id = $2, second_approved_at = now(), expires_at = now() + interval '1 minute' where grant_id = $1";
    // Someone else's name, a break-glass or platform context, a platform or agent role, no roles.
    for (const [settings, approver] of [
      [manager, "usr_other"],
      [{ ...manager, "app.breakglass": id }, "usr_admin_a"],
      [{ ...manager, "app.scope": "platform" }, "usr_admin_a"],
      [{ ...manager, "app.roles": "ORG_ADMIN,PLT_SUPER_ADMIN" }, "usr_admin_a"],
      [{ ...manager, "app.roles": "ORG_ADMIN,AGT_HELPER" }, "usr_admin_a"],
      [{ ...manager, "app.roles": "ORG_MEMBER" }, "usr_admin_a"],
    ] as Array<[Record<string, string>, string]>)
      await expect(asRole("app_rw", settings, second, [id, approver])).rejects.toThrow(
        /breakglass_tenant_approval: /,
      );
    // The first approval is never rewritten, and a final decision never reopens.
    await expect(
      asRole(
        "app_rw",
        manager,
        "update tenancy.breakglass_tenant_approval set first_approver_id = 'usr_admin_a' where grant_id = $1",
        [id],
      ),
    ).rejects.toThrow(/never rewritten/);
    await expect(
      asRole(
        "app_rw",
        manager,
        `insert into tenancy.breakglass_tenant_approval (tenant_id, grant_id, access, state, window_minutes,
           first_approver_id, first_approved_at, expires_at)
         values ('tnt_a', $1, 'read', 'approved', 5, 'usr_owner_a', now(), now() + interval '5 minutes')`,
        [await grant({ tenantId: "tnt_a" })],
      ),
    ).rejects.toThrow(/actor's own/);
    // The checks: the second approver differs from the first.
    await expect(
      asRole("app_rw", { ...manager, "app.actor_id": "usr_owner_a" }, second, [id, "usr_owner_a"]),
    ).rejects.toThrow(/check/);
    // A scoped read-write break-glass context cannot approve itself in its tenant.
    const self = await grant({ tenantId: "tnt_a", access: "read_write" });
    await expect(
      kernel.mutate(
        bgIn("tnt_a", self),
        async (tx) => {
          await tx.query(
            `insert into tenancy.breakglass_tenant_approval (tenant_id, grant_id, access, state, window_minutes,
               first_approver_id, first_approved_at, second_approver_id, second_approved_at, expires_at)
             values ('tnt_a', $1, 'read_write', 'approved', 5, 'usr_sa1', now(), 'usr_x', now(), now() + interval '5 minutes')`,
            [self],
          );
          await audit.record(tx, { action: "x.y.z", resourceType: "x", resourceId: "x" });
        },
        { action: "x.y.z" },
      ),
    ).rejects.toThrow(/breakglass_tenant_approval: /);
    expect(await tenant().status(ownerA, self)).toMatchObject({ state: "none" });
  });

  it("rls-lint passes with the new definer function", async () => {
    expect(await lintRls(db.admin, { schemas: ["tenancy"] })).toEqual([]);
  });
});

describe("@IPB-02-06 support access carries tenantApproved (PR-FBX-55, R1-D-284)", () => {
  const access = () => new SupportAccess({ kernel, audit, product: "FBX" });
  const req = { reason: "ticket SUP-55 needs a look", modules: ["docs"] };

  it("read: false before consent, true after; false once revoked", async () => {
    const g = await access().request(supportContext("tnt_a", "usr_sup_r"), req);
    expect(g.tenantApproved).toBe(false);
    const c = await access().consent(ownerA, g.id);
    expect(c).toMatchObject({ state: "active", tenantApproved: true });
    expect((await access().list(ownerA)).find((x) => x.id === g.id)?.tenantApproved).toBe(true);
    expect((await access().revoke(adminA, g.id)).tenantApproved).toBe(false);
  });

  it("read_write: true only after the second, different approval", async () => {
    const g = await access().request(supportContext("tnt_a", "usr_sup_w"), {
      ...req,
      access: "read_write",
    });
    const c = await access().consent(ownerA, g.id);
    expect(c).toMatchObject({ state: "awaiting_second_approval", tenantApproved: false });
    const a = await access().approve(adminA, g.id);
    expect(a).toMatchObject({ state: "active", tenantApproved: true });
    await db.admin.query(
      "update tenancy.support_grant set expires_at = now() - interval '1 minute' where id = $1",
      [g.id],
    );
    expect((await access().list(ownerA)).find((x) => x.id === g.id)?.tenantApproved).toBe(false);
  });
});
