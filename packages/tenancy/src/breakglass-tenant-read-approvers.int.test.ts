// Owner addition (A) to answer #203 (24 Nov 2026; R1-D-286; tenancy/0032), from Udofin's owner
// answer #223, with RLS on: `PgKernelOptions.breakGlassTenantApproversForRead` is 1 (the default,
// one tenant manager approves a scoped `read` grant, as before) or 2 (a `read` grant, like a
// `read_write` one, needs two different ORG_OWNER/ORG_ADMIN approvers: never the grant's requester
// or its platform approver, the smaller of the two windows). One test per value, the move from 1
// to 2, the option's validation and tenancy/0032's guard.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuditEntryInput, AuditSink, KernelContext, Tx } from "@infrabyx/contracts/kernel";
import { BreakGlass, type BreakGlassScope } from "./breakglass.js";
import { BreakGlassTenantApproval } from "./breakglass-tenant.js";
import { BREAKGLASS_TENANT_APPROVAL_REFUSAL, PgKernel } from "./kernel.js";
import { PgOutbox } from "./outbox.js";
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
let one: PgKernel;
let two: PgKernel;
let oneStrict: PgKernel;
let twoStrict: PgKernel;
const audit = new RecordingAudit();
const outbox = new PgOutbox();
const platform = (id: string, roles: string[]): KernelContext => ({
  tenantId: "tnt_platform",
  scope: "platform",
  principal: { id, type: "user", roles },
});
const member = (id: string, roles = ["ORG_OWNER"]): KernelContext => ({
  tenantId: "tnt_a",
  principal: { id, type: "user", roles },
});
const ownerA = member("usr_owner_a");
const adminA = member("usr_admin_a", ["ORG_ADMIN"]);
const thirdA = member("usr_admin_a2", ["ORG_ADMIN"]);
const bgIn = (grantId: string): KernelContext => ({
  tenantId: "tnt_a",
  breakGlassGrantId: grantId,
  principal: { id: "usr_sa1", type: "breakglass", roles: ["PLT_SUPER_ADMIN"] },
});
const approvals = (kernel: PgKernel) =>
  new BreakGlassTenantApproval({ kernel, audit, outbox, product: "UDF" });
const readDocs = (k: PgKernel, ctx: KernelContext) =>
  k.read(ctx, async (tx) => (await tx.query<{ id: string }>("select id from docs.file")).rows);
const minutesOf = (from: Date | null, to: Date | null): number =>
  Math.round(((to?.getTime() ?? 0) - (from?.getTime() ?? 0)) / 60_000);

async function grant(scope: BreakGlassScope, minutes = 60): Promise<string> {
  const bg = new BreakGlass({ kernel: one, audit, product: "UDF" });
  const g = await bg.request(
    platform("usr_sa1", ["PLT_SUPER_ADMIN"]),
    "incident INC-223 on a lender tenant",
    minutes,
    scope,
  );
  await bg.approve(platform("usr_so", ["PLT_SECURITY_OFFICER"]), g.id);
  return g.id;
}
const raised = async (grantId: string): Promise<number> =>
  (
    await db.admin.query(
      `select 1 from tenancy.outbox
        where envelope->>'type' = 'in.udf.security.BreakGlassTenantApproved.v1'
          and envelope->'data'->>'grant_id' = $1`,
      [grantId],
    )
  ).rowCount ?? 0;
const refusedFor = (grantId: string, state: string) => ({
  code: "IPB-SEC-005",
  meta: {
    grant_id: grantId,
    reason: "tenant_approval",
    refusal: BREAKGLASS_TENANT_APPROVAL_REFUSAL,
    tenant_approval: state,
  },
});

/** Runs `sql` as app_rw with a tenant manager's settings; resolves to its rows or rejects. */
async function asManager(
  actor: string,
  sql: string,
  params: unknown[] = [],
  commit = false,
): Promise<unknown[]> {
  const c = await db.pool.connect();
  let done = false;
  try {
    await c.query("begin");
    await c.query("set local role app_rw");
    for (const [k, v] of Object.entries({
      "app.tenant_id": "tnt_a",
      "app.actor_id": actor,
      "app.roles": "ORG_ADMIN",
    }))
      await c.query("select set_config($1, $2, true)", [k, v]);
    const rows = (await c.query(sql, params)).rows;
    if (commit) {
      await c.query("commit");
      done = true;
    }
    return rows;
  } finally {
    if (!done) await c.query("rollback").catch(() => undefined);
    c.release();
  }
}

beforeAll(async () => {
  db = await freshDb();
  one = new PgKernel({ pool: db.pool, audit, breakGlassTenantApproversForRead: 1 });
  two = new PgKernel({ pool: db.pool, audit, breakGlassTenantApproversForRead: 2 });
  oneStrict = new PgKernel({
    pool: db.pool,
    audit,
    requireTenantApprovedBreakGlass: true,
    breakGlassTenantApproversForRead: 1,
  });
  twoStrict = new PgKernel({
    pool: db.pool,
    audit,
    requireTenantApprovedBreakGlass: true,
    breakGlassTenantApproversForRead: 2,
  });
  await db.admin.query(
    `insert into tenancy.tenant (id, product, name) values ('tnt_platform', 'PLATFORM', 'Infrabyx'),
       ('tnt_a', 'UDF', 'A')`,
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
    insert into docs.file values ('tnt_a', 'f1', 'a');
  `);
});
afterAll(async () => db?.end());

describe("@IPB-02-06 breakGlassTenantApproversForRead (owner addition (A) to #203, R1-D-286)", () => {
  it("defaults to 1 and refuses any other value", () => {
    expect(new PgKernel({ pool: db.pool, audit }).breakGlassTenantApproversForRead).toBe(1);
    expect(approvals(new PgKernel({ pool: db.pool, audit })).approversForRead).toBe(1);
    for (const bad of [0, 3, 1.5, "2"])
      expect(
        () =>
          new PgKernel({
            pool: db.pool,
            audit,
            breakGlassTenantApproversForRead: bad as unknown as 1,
          }),
      ).toThrow(RangeError);
    // The approvals take the kernel's value; a different one given beside it is refused.
    expect(approvals(two).approversForRead).toBe(2);
    expect(
      () =>
        new BreakGlassTenantApproval({ kernel: two, audit, product: "UDF", approversForRead: 1 }),
    ).toThrow(RangeError);
    expect(
      new BreakGlassTenantApproval({ kernel: two, audit, product: "UDF", approversForRead: 2 })
        .approversForRead,
    ).toBe(2);
  });

  it("with 1, one manager approves a read grant and the strict kernel admits it", async () => {
    const id = await grant({ tenantId: "tnt_a", modules: ["docs"] });
    const r = await approvals(oneStrict).approve(ownerA, id);
    expect(r).toMatchObject({ access: "read", state: "approved", secondApproverId: null });
    expect(await approvals(oneStrict).status(adminA, id)).toMatchObject({
      tenantApproved: true,
      state: "approved",
    });
    expect(await readDocs(oneStrict, bgIn(id))).toEqual([{ id: "f1" }]);
    expect(await raised(id)).toBe(1);
    // Approved once: a second manager's approval is a conflict under 1.
    await expect(approvals(oneStrict).approve(adminA, id)).rejects.toThrow(/is approved/);
  });

  it("with 2, a read grant needs two different managers, never the platform side; the smaller window", async () => {
    const id = await grant({ tenantId: "tnt_a", modules: ["docs"] }, 90);
    const first = await approvals(twoStrict).approve(ownerA, id, { minutes: 60 });
    expect(first).toMatchObject({
      access: "read",
      state: "awaiting_second_approval",
      windowMinutes: 60,
      firstApproverId: "usr_owner_a",
      secondApproverId: null,
      expiresAt: null,
    });
    expect(await approvals(twoStrict).status(adminA, id)).toEqual({
      tenantApproved: false,
      state: "awaiting_second_approval",
      expiresAt: null,
    });
    const listed = (await approvals(twoStrict).pending(adminA)).find((p) => p.grantId === id);
    expect(listed?.tenantState).toBe("awaiting_second_approval");
    await expect(readDocs(twoStrict, bgIn(id))).rejects.toMatchObject(
      refusedFor(id, "awaiting_second_approval"),
    );
    expect(await raised(id)).toBe(0);
    // Not the same manager twice, and never the grant's requester or its platform approver.
    await expect(approvals(twoStrict).approve(ownerA, id)).rejects.toMatchObject({
      code: "IPB-TRUST-005",
    });
    for (const p of ["usr_sa1", "usr_so"])
      await expect(approvals(twoStrict).approve(member(p), id)).rejects.toMatchObject({
        code: "IPB-TRUST-005",
      });
    const second = await approvals(twoStrict).approve(adminA, id, { minutes: 45 });
    expect(second).toMatchObject({
      access: "read",
      state: "approved",
      windowMinutes: 45,
      firstApproverId: "usr_owner_a",
      secondApproverId: "usr_admin_a",
    });
    expect(minutesOf(second.secondApprovedAt, second.expiresAt)).toBe(45);
    expect(await approvals(twoStrict).status(ownerA, id)).toMatchObject({
      tenantApproved: true,
      state: "approved",
    });
    expect(await readDocs(twoStrict, bgIn(id))).toEqual([{ id: "f1" }]);
    expect(await raised(id)).toBe(1);
    await expect(approvals(twoStrict).approve(thirdA, id)).rejects.toThrow(/is approved/);
  });

  it("with 2, a read grant awaiting its second approver may be refused, and read_write still needs two", async () => {
    const id = await grant({ tenantId: "tnt_a" });
    await approvals(two).approve(ownerA, id);
    const r = await approvals(two).refuse(adminA, id, "one approver is not enough for us");
    expect(r).toMatchObject({ state: "refused" });
    // Refused is enforced whatever the options.
    await expect(readDocs(two, bgIn(id))).rejects.toMatchObject(refusedFor(id, "refused"));

    const rw = await grant({ tenantId: "tnt_a", access: "read_write" });
    expect(await approvals(two).approve(ownerA, rw)).toMatchObject({
      access: "read_write",
      state: "awaiting_second_approval",
    });
    expect(await approvals(two).approve(adminA, rw)).toMatchObject({ state: "approved" });
  });

  it("moving from 1 to 2: a read approval by one manager is not live until a second completes it, never lengthened", async () => {
    const id = await grant({ tenantId: "tnt_a", modules: ["docs"] }, 60);
    const single = await approvals(oneStrict).approve(ownerA, id, { minutes: 30 });
    expect(single).toMatchObject({ state: "approved", windowMinutes: 30 });
    expect(await readDocs(oneStrict, bgIn(id))).toEqual([{ id: "f1" }]);
    // Under 2 the same row awaits its second approver: not admitted, reported as awaiting.
    await expect(readDocs(twoStrict, bgIn(id))).rejects.toMatchObject(
      refusedFor(id, "awaiting_second_approval"),
    );
    expect(await approvals(twoStrict).status(adminA, id)).toMatchObject({
      tenantApproved: false,
      state: "awaiting_second_approval",
    });
    await expect(approvals(twoStrict).approve(ownerA, id)).rejects.toMatchObject({
      code: "IPB-TRUST-005",
    });
    const done = await approvals(twoStrict).approve(adminA, id, { minutes: 60 });
    expect(done).toMatchObject({
      state: "approved",
      windowMinutes: 30,
      firstApproverId: "usr_owner_a",
      secondApproverId: "usr_admin_a",
    });
    // Never past the expiry the single approval had.
    expect(done.expiresAt?.getTime()).toBeLessThanOrEqual(single.expiresAt?.getTime() ?? 0);
    expect(await readDocs(twoStrict, bgIn(id))).toEqual([{ id: "f1" }]);
    expect(await approvals(twoStrict).status(adminA, id)).toMatchObject({ tenantApproved: true });
  });

  it("tenancy/0032's guard: a second approver on a read approval never lengthens it, and only once", async () => {
    const id = await grant({ tenantId: "tnt_a" }, 60);
    const single = await approvals(one).approve(ownerA, id, { minutes: 20 });
    // Lengthening the expiry or the window is refused at the table, whoever writes it.
    await expect(
      asManager(
        "usr_admin_a",
        `update tenancy.breakglass_tenant_approval
            set second_approver_id = 'usr_admin_a', second_approved_at = now(),
                expires_at = now() + interval '20 minutes'
          where grant_id = $1`,
        [id],
      ),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      asManager(
        "usr_admin_a",
        `update tenancy.breakglass_tenant_approval
            set second_approver_id = 'usr_admin_a', second_approved_at = now(), window_minutes = 40
          where grant_id = $1`,
        [id],
      ),
    ).rejects.toMatchObject({ code: "42501" });
    // Only in the actor's own name.
    await expect(
      asManager(
        "usr_admin_a",
        `update tenancy.breakglass_tenant_approval
            set second_approver_id = 'usr_admin_a2', second_approved_at = now()
          where grant_id = $1`,
        [id],
      ),
    ).rejects.toMatchObject({ code: "42501" });
    // A second, different manager's own step that keeps the expiry is admitted, once.
    expect(
      await asManager(
        "usr_admin_a",
        `update tenancy.breakglass_tenant_approval
            set second_approver_id = 'usr_admin_a', second_approved_at = now()
          where grant_id = $1 returning state`,
        [id],
        true,
      ),
    ).toEqual([{ state: "approved" }]);
    expect(single.expiresAt).not.toBeNull();
    await expect(
      asManager(
        "usr_admin_a2",
        `update tenancy.breakglass_tenant_approval
            set second_approver_id = 'usr_admin_a2', second_approved_at = now()
          where grant_id = $1`,
        [id],
      ),
    ).rejects.toMatchObject({ code: "42501" });
    // A read_write approval, already holding both, never takes another.
    const rw = await grant({ tenantId: "tnt_a", access: "read_write" });
    await approvals(one).approve(ownerA, rw);
    await approvals(one).approve(adminA, rw);
    await expect(
      asManager(
        "usr_admin_a2",
        `update tenancy.breakglass_tenant_approval
            set second_approver_id = 'usr_admin_a2', second_approved_at = now()
          where grant_id = $1`,
        [rw],
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });
  it("tenancy/0032's guard: a second approval is made now, never widens the window, and is never the platform side's", async () => {
    const id = await grant({ tenantId: "tnt_a" }, 60);
    await approvals(two).approve(ownerA, id, { minutes: 5 });
    const second = (set: string) =>
      asManager(
        "usr_admin_a",
        `update tenancy.breakglass_tenant_approval
            set state = 'approved', second_approver_id = 'usr_admin_a', ${set}
          where grant_id = $1`,
        [id],
      );
    for (const set of [
      "second_approved_at = now() + interval '10 years', expires_at = now() + interval '5 minutes'",
      "second_approved_at = now(), window_minutes = 240, expires_at = now() + interval '4 hours'",
      "second_approved_at = now(), expires_at = now() + interval '1 hour'",
      "second_approved_at = now(), expires_at = now() + interval '5 minutes', ended_by = 'usr_x'",
    ])
      await expect(second(set)).rejects.toMatchObject({ code: "42501" });
    // The grant's platform requester holding a tenant role is refused at the table too.
    await expect(
      asManager(
        "usr_sa1",
        `update tenancy.breakglass_tenant_approval
            set state = 'approved', second_approver_id = 'usr_sa1', second_approved_at = now(),
                expires_at = now() + interval '5 minutes'
          where grant_id = $1`,
        [id],
      ),
    ).rejects.toMatchObject({ code: "42501" });
    expect(
      await second("second_approved_at = now(), expires_at = now() + interval '5 minutes'"),
    ).toHaveLength(0);
    // A first approval is timed now, within the grant's duration, and never the platform side's.
    const other = await grant({ tenantId: "tnt_a" }, 30);
    const insert = (actor: string, window: number, at: string) =>
      asManager(
        actor,
        `insert into tenancy.breakglass_tenant_approval
           (tenant_id, grant_id, access, state, window_minutes, first_approver_id, first_approved_at)
         values ('tnt_a', $1, 'read', 'awaiting_second_approval', $2, $3, ${at})`,
        [other, window, actor],
      );
    await expect(insert("usr_admin_a", 30, "now() + interval '1 year'")).rejects.toMatchObject({
      code: "42501",
    });
    await expect(insert("usr_admin_a", 60, "now()")).rejects.toMatchObject({ code: "42501" });
    await expect(insert("usr_so", 30, "now()")).rejects.toMatchObject({ code: "42501" });
    expect(await insert("usr_admin_a", 30, "now()")).toHaveLength(0);
  });

  it("with 2, a single read approval given under 1 is revoked, not refused", async () => {
    const id = await grant({ tenantId: "tnt_a" }, 60);
    await approvals(one).approve(ownerA, id);
    await expect(approvals(two).refuse(adminA, id, "we want two")).rejects.toThrow(
      /revoked, not refused/,
    );
    const before = audit.actions.length;
    expect(await approvals(two).revoke(adminA, id)).toMatchObject({ state: "revoked" });
    expect(audit.actions.slice(before)).toEqual(["security.breakglass_tenant.revoke"]);
    await expect(readDocs(two, bgIn(id))).rejects.toMatchObject(refusedFor(id, "revoked"));
  });
});
