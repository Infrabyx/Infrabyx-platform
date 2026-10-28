import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { IpbError } from "@infrabyx/contracts/errors";
import type { AuditEntryInput, AuditSink, KernelContext, Tx } from "@infrabyx/contracts/kernel";
import { defineModule } from "@infrabyx/contracts/modules";
import { LocalKms, localTenantKeyId, newId } from "@infrabyx/crypto";
import { ApprovalsEngine } from "./approvals/index.js";
import { BreakGlass } from "./breakglass.js";
import { FieldCrypto } from "./field-crypto.js";
import { Impersonation } from "./impersonation.js";
import { PgKernel } from "./kernel.js";
import { migrate } from "./migrate/index.js";
import { OutboxRelay, PgInbox, PgOutbox, type RelayedEvent } from "./outbox.js";
import { assertManifestsRls, lintRls } from "./rls-lint/index.js";
import { internalEvent } from "@infrabyx/config/events";
import { TENANCY_SOURCE, freshDb, type TestDb } from "./__tests__/pg.js";

class RecordingAudit implements AuditSink {
  readonly entries: Array<AuditEntryInput & { tenantId: string }> = [];
  async record(tx: Tx, e: AuditEntryInput): Promise<{ id: string }> {
    this.entries.push({ ...e, tenantId: tx.ctx.tenantId });
    tx.markAudited();
    return { id: `led_${this.entries.length}` };
  }
}

const err = async (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: IpbError & { status?: number }) => e.code ?? e.name,
  );

let db: TestDb;
let kernel: PgKernel;
const audit = new RecordingAudit();
const outbox = new PgOutbox();
const user = (id: string, roles: string[], over: Partial<KernelContext> = {}): KernelContext => ({
  tenantId: "tnt_a",
  principal: { id, type: "user", roles },
  ...over,
});
const platform = (id: string, roles: string[], tenantId = "tnt_platform"): KernelContext => ({
  tenantId,
  scope: "platform",
  principal: { id, type: "user", roles },
});

beforeAll(async () => {
  db = await freshDb();
  kernel = new PgKernel({ pool: db.pool });
  await db.admin.query(
    `insert into tenancy.tenant (id, product, name) values ('tnt_platform', 'PLATFORM', 'Infrabyx'), ('tnt_a', 'LD', 'Tenant A'), ('tnt_b', 'LD', 'Tenant B')`,
  );
});
afterAll(async () => db?.end());

describe("@NN-01 @IPB-02-12 tenant isolation", () => {
  it("tenant A cannot read or write tenant B rows, even with a crafted ID", async () => {
    const bId = newId("ent");
    await kernel.mutate(user("usr_b", ["ORG_ADMIN"], { tenantId: "tnt_b" }), async (tx) => {
      await tx.query(
        "insert into tenancy.legal_entity (id, tenant_id, name) values ($1, 'tnt_b', 'B Ltd')",
        [bId],
      );
      await audit.record(tx, {
        action: "tenancy.entity.create",
        resourceType: "legal_entity",
        resourceId: bId,
      });
    });
    const a = user("usr_a", ["ORG_ADMIN"]);
    const rows = await kernel.read(
      a,
      async (tx) =>
        (await tx.query("select * from tenancy.legal_entity where id = $1", [bId])).rows,
    );
    expect(rows).toEqual([]);
    const tenants = await kernel.read(a, async (tx) =>
      (await tx.query<{ id: string }>("select id from tenancy.tenant")).rows.map((r) => r.id),
    );
    expect(tenants).toEqual(["tnt_a"]);
    const updated = await kernel.mutate(a, async (tx) => {
      await audit.record(tx, {
        action: "tenancy.entity.update",
        resourceType: "legal_entity",
        resourceId: bId,
      });
      return (
        await tx.query("update tenancy.legal_entity set name = 'hijack' where id = $1", [bId])
      ).rowCount;
    });
    expect(updated).toBe(0);
    expect(
      await err(
        kernel.mutate(a, async (tx) => {
          await audit.record(tx, {
            action: "tenancy.entity.create",
            resourceType: "legal_entity",
            resourceId: "x",
          });
          await tx.query(
            "insert into tenancy.legal_entity (id, tenant_id, name) values ($1, 'tnt_b', 'x')",
            [newId("ent")],
          );
        }),
      ),
    ).not.toBeNull();
  });
  it("@IPB-02-AT-04 a crafted set_config cannot switch tenants", async () => {
    expect(
      await err(
        kernel.read(user("usr_a", []), (tx) =>
          tx.query("select set_config('app.tenant_id', 'tnt_b', true)"),
        ),
      ),
    ).toBe("KernelGuardError");
  });
  it("the kernel runs as app_rw with SET LOCAL only", async () => {
    const r = await kernel.read(
      user("usr_a", []),
      async (tx) =>
        (
          await tx.query<{ role: string; tid: string }>(
            "select current_user as role, current_setting('app.tenant_id') as tid",
          )
        ).rows[0],
    );
    expect(r).toEqual({ role: "app_rw", tid: "tnt_a" });
    const c = await db.pool.connect();
    expect(
      (await c.query("select current_setting('app.tenant_id', true) as t")).rows[0].t ?? "",
    ).toBe("");
    c.release();
  });
});

describe("@NN-45 every mutation writes the ledger in the same transaction", () => {
  it("a mutation without an audit entry fails with IPB-MOD-003 and rolls back", async () => {
    const id = newId("ent");
    expect(
      await err(
        kernel.mutate(user("usr_a", ["ORG_ADMIN"]), async (tx) => {
          await tx.query(
            "insert into tenancy.legal_entity (id, tenant_id, name) values ($1, 'tnt_a', 'A')",
            [id],
          );
        }),
      ),
    ).toBe("IPB-MOD-003");
    expect(
      (await db.admin.query("select 1 from tenancy.legal_entity where id = $1", [id])).rowCount,
    ).toBe(0);
  });
});

describe("outbox and inbox (IPB-01 §01.4.3.3)", () => {
  it("writes events in the mutation's transaction and de-duplicates consumers", async () => {
    const env = internalEvent({
      product: "LD",
      event: "SettingChanged",
      tenantId: "tnt_a",
      data: { key: "x" },
    });
    await expect(
      kernel.mutate(user("usr_a", []), async (tx) => {
        await outbox.publish(tx, "tenancy", { envelope: env });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(
      (await db.admin.query("select 1 from tenancy.outbox where id = $1", [env.id])).rowCount,
    ).toBe(0);
    await kernel.mutate(user("usr_a", []), async (tx) => {
      await outbox.publish(tx, "tenancy", { envelope: env });
      await audit.record(tx, { action: "t.t.t", resourceType: "t", resourceId: "t" });
    });
    expect(
      (await db.admin.query("select type from tenancy.outbox where id = $1", [env.id])).rows[0]
        .type,
    ).toBe("in.ld.settings.SettingChanged.v1");
    const other = internalEvent({
      product: "LD",
      event: "SettingChanged",
      tenantId: "tnt_b",
      data: {},
    });
    expect(
      await err(
        kernel.mutate(user("usr_a", []), (tx) =>
          outbox.publish(tx, "tenancy", { envelope: other }),
        ),
      ),
    ).toBe("Error");
    const inbox = new PgInbox();
    const seen = await kernel.mutate(user("usr_a", []), async (tx) => {
      await audit.record(tx, { action: "t.t.t", resourceType: "t", resourceId: "t" });
      return [
        await inbox.firstSeen(tx, "tenancy", "c1", env.id),
        await inbox.firstSeen(tx, "tenancy", "c1", env.id),
      ];
    });
    expect(seen).toEqual([true, false]);
  });
});

describe("@NN-18 @IPB-02-AT-11 @IPB-02-AT-12 approvals engine", () => {
  const fieldCrypto = new FieldCrypto({ kms: new LocalKms(), keyIdFor: localTenantKeyId });
  let engine: ApprovalsEngine;
  const executed: unknown[] = [];
  beforeAll(() => {
    engine = new ApprovalsEngine({ kernel, audit, outbox, product: "LD", fieldCrypto });
    engine.register("settings.setting.change", {
      execute: async (_tx, p) => void executed.push(p),
    });
  });
  const maker = user("usr_maker", ["ORG_ADMIN"]);
  const make = (input: Parameters<ApprovalsEngine["request"]>[1], ctx = maker) =>
    kernel.mutate(ctx, (tx) => engine.request(tx, input));

  it("checker ≠ maker, agents never check, the approved action executes", async () => {
    const { id } = await make({
      action: "settings.setting.change",
      riskClass: "R2",
      payload: { key: "k", value: 1 },
    });
    expect(await err(engine.decide(maker, id, "approve"))).toBe("IPB-SEC-007");
    const agent = user("agt_vidhi", ["AGT_VIDHI", "ORG_CHECKER"], {
      principal: { id: "agt_vidhi", type: "agent", roles: ["AGT_VIDHI", "ORG_CHECKER"] },
    });
    expect(await err(engine.decide(agent, id, "approve"))).toBe("IPB-SEC-004");
    expect(await err(engine.decide(user("usr_m", ["ORG_MEMBER"]), id, "approve"))).toBe(
      "IPB-UX-011",
    );
    const r = await engine.decide(user("usr_checker", ["ORG_CHECKER"]), id, "approve");
    expect(r.state).toBe("executed");
    expect(executed).toEqual([{ key: "k", value: 1 }]);
    const events = await db.admin.query<{ type: string }>(
      "select type from tenancy.outbox where envelope->'data'->>'request_id' = $1 order by created_at",
      [id],
    );
    expect(events.rows.map((e) => e.type)).toEqual([
      "in.ld.security.ApprovalRequested.v1",
      "in.ld.security.ApprovalDecided.v1",
      "in.ld.security.ApprovalExecuted.v1",
    ]);
  });
  it("the database refuses a decision by the maker even without the engine", async () => {
    const { id } = await make({ action: "settings.setting.change", riskClass: "R2", payload: {} });
    await expect(
      db.admin.query(
        "insert into tenancy.approval_decision (request_id, tenant_id, maker_id, checker_id, decision) values ($1, 'tnt_a', 'usr_maker', 'usr_maker', 'approve')",
        [id],
      ),
    ).rejects.toThrow(/check constraint/);
    await expect(
      db.admin.query(
        "insert into tenancy.approval_decision (request_id, tenant_id, maker_id, checker_id, decision) values ($1, 'tnt_a', 'usr_other', 'usr_maker', 'approve')",
        [id],
      ),
    ).rejects.toThrow(/foreign key/);
  });
  it("agents may not make R4/R5 requests", async () => {
    const agent = user("agt_x", ["AGT_X"], {
      principal: { id: "agt_x", type: "agent", roles: ["AGT_X"] },
    });
    expect(
      await err(make({ action: "access.role.grant_request", riskClass: "R4", payload: {} }, agent)),
    ).toBe("IPB-SEC-004");
  });
  it("tenant delete needs two checkers and waits 7 days; ORG_OWNER can cancel", async () => {
    const { id } = await make({
      action: "tenancy.tenant.delete",
      riskClass: "R5",
      payload: { tenant_id: "tnt_a" },
    });
    await engine.decide(user("usr_c1", ["ORG_CHECKER"]), id, "approve");
    expect((await engine.get(maker, id)).state).toBe("pending");
    const approved = await engine.decide(user("usr_c2", ["ORG_OWNER"]), id, "approve");
    expect(approved.state).toBe("approved");
    expect(approved.delayMinutes).toBe(7 * 24 * 60);
    await db.admin.query(
      "update tenancy.approval_request set approved_at = now() - interval '6 days', delay_until = now() + interval '1 day' where id = $1",
      [id],
    );
    expect(await err(engine.execute(user("usr_job", ["ORG_ADMIN"]), id))).toBe("IPB-SEC-008");
    expect(await err(engine.cancel(user("usr_x", ["ORG_ADMIN"]), id))).toBe("IPB-UX-011");
    expect((await engine.cancel(user("usr_owner", ["ORG_OWNER"]), id)).state).toBe("cancelled");
  });
  it("R4 waits at least 60 minutes, then executes", async () => {
    const { id } = await make({
      action: "access.ip_allowlist.change",
      riskClass: "R4",
      payload: {},
    });
    const a = await engine.decide(user("usr_c1", ["ORG_CHECKER"]), id, "approve");
    expect(a.state).toBe("approved");
    expect(await err(engine.execute(maker, id))).toBe("IPB-SEC-008");
    await db.admin.query(
      "update tenancy.approval_request set delay_until = now() - interval '1 second' where id = $1",
      [id],
    );
    expect((await engine.execute(maker, id)).state).toBe("executed");
  });
  it("REGULATED payloads are stored as ciphertext (IPB-02-20)", async () => {
    const { id } = await make({
      action: "settings.setting.change",
      riskClass: "R2",
      payload: { pan: "ZZZZA1234Z" },
      payloadDataClass: "REGULATED",
    });
    const raw = await db.admin.query(
      "select payload, payload_enc::text as enc from tenancy.approval_request where id = $1",
      [id],
    );
    expect(raw.rows[0].payload).toBeNull();
    expect(raw.rows[0].enc).not.toContain(Buffer.from("ZZZZA1234Z").toString("hex"));
    await engine.decide(user("usr_c1", ["ORG_CHECKER"]), id, "approve");
    expect(executed.at(-1)).toEqual({ pan: "ZZZZA1234Z" });
  });
});

describe("@IPB-02-AT-10 break-glass dual approval", () => {
  let bg: BreakGlass;
  beforeAll(() => void (bg = new BreakGlass({ kernel, audit, outbox, product: "LD" })));
  it("refuses self-approval, issues a review ticket, and the bg token stops working at expiry", async () => {
    const a = platform("usr_sa1", ["PLT_SUPER_ADMIN"]);
    const g = await bg.request(a, "production incident INC-42", 240);
    expect(await err(bg.approve(a, g.id))).toBe("IPB-SEC-009");
    const active = await bg.approve(platform("usr_so", ["PLT_SECURITY_OFFICER"]), g.id);
    expect(active.state).toBe("active");
    expect(active.reviewTicketRef).toMatch(/^rvw_/);
    const bgCtx = user("usr_sa1", ["PLT_SUPER_ADMIN"], {
      tenantId: "tnt_b",
      breakGlassGrantId: g.id,
      principal: { id: "usr_sa1", type: "breakglass", roles: ["PLT_SUPER_ADMIN"] },
    });
    expect(await kernel.read(bgCtx, async () => "ok")).toBe("ok");
    await db.admin.query(
      "update tenancy.breakglass_grant set expires_at = now() - interval '1 second' where id = $1",
      [g.id],
    );
    expect(await err(kernel.read(bgCtx, async () => "ok"))).toBe("IPB-SEC-009");
    expect(await err(bg.request(a, "too long for a grant", 241))).toBe("RangeError");
  });
});

describe("@IPB-02-AT-08 impersonation is read-only and visible to the tenant", () => {
  let imp: Impersonation;
  beforeAll(() => void (imp = new Impersonation({ kernel, audit, outbox, product: "LD" })));
  it("mutations are refused with IPB-SEC-003 and ORG_OWNER sees actor, ticket and duration", async () => {
    const s = await imp.start(
      platform("usr_staff", ["PLT_SUPER_ADMIN"], "tnt_a"),
      "usr_target",
      "SUP-1234",
      30,
    );
    const viewAs = user("usr_target", ["ORG_MEMBER"], {
      act: { sub: "usr_staff", sessionId: s.id },
    });
    expect(
      await err(
        kernel.mutate(viewAs, async () => undefined, { action: "documents.document.create" }),
      ),
    ).toBe("IPB-SEC-003");
    expect(await kernel.read(viewAs, async () => "read ok")).toBe("read ok");
    const ended = await imp.end(platform("usr_staff", ["PLT_SUPER_ADMIN"], "tnt_a"), s.id);
    const seen = await imp.list(user("usr_owner", ["ORG_OWNER"]));
    expect(seen.find((x) => x.id === s.id)).toMatchObject({
      actorId: "usr_staff",
      ticketRef: "SUP-1234",
    });
    expect(ended.endedAt).not.toBeNull();
    expect(
      audit.entries.filter((e) => e.resourceId === s.id).map((e) => [e.action, e.tenantId]),
    ).toEqual([
      ["security.impersonation.start", "tnt_a"],
      ["security.impersonation.end", "tnt_a"],
    ]);
    expect(await imp.list(user("usr_owner_b", ["ORG_OWNER"], { tenantId: "tnt_b" }))).toEqual([]);
  });
});

describe("rls-lint and manifests", () => {
  it("is clean on the tenancy schema", async () => {
    expect(await lintRls(db.admin, { schemas: ["tenancy", "meta"] })).toEqual([]);
  });
  it("@IPB-01-AT-16 boot fails with IPB-MOD-001 naming a table without RLS", async () => {
    await db.admin.query(
      "create schema cases; create table cases.note (id text primary key, tenant_id text not null, body text)",
    );
    const manifest = defineModule({
      name: "cases",
      schema: "cases",
      boundedContext: "Case management",
      owner: "LD lead",
      settingsPrefix: "cases.",
      dataClasses: ["CONFIDENTIAL"],
      extractionReadiness: 1,
      rlsTables: ["cases.note"],
    });
    const e = await assertManifestsRls(db.admin, [manifest]).then(
      () => null,
      (x: IpbError) => x,
    );
    expect(e?.code).toBe("IPB-MOD-001");
    expect(e?.message).toContain("cases.note");
    const findings = await lintRls(db.admin, { schemas: ["cases"] });
    expect(findings.map((f) => f.rule).sort()).toEqual([
      "rls-enabled",
      "rls-forced",
      "tenant-policy",
    ]);
  });
});

describe("infrabyx-migrate", () => {
  it("is idempotent and refuses an edited released migration", async () => {
    const again = await migrate({ client: db.admin, sources: [TENANCY_SOURCE] });
    expect(again.applied).toEqual([]);
    expect(again.skipped).toEqual([
      "@infrabyx/tenancy/0001_init.sql",
      "@infrabyx/tenancy/0002_approvals_pl3.sql",
      "@infrabyx/tenancy/0003_outbox_relay.sql",
    ]);
    await db.admin.query("update meta.migration_checksums set sha256 = repeat('0', 64)");
    expect(await err(migrate({ client: db.admin, sources: [TENANCY_SOURCE] }))).toBe("IPB-ENG-005");
  });
});

describe("approvals PL3: expiry, reminder, escalation, diff, mc.* and observers (PL3-D-07, PL3-D-08)", () => {
  const fieldCrypto = new FieldCrypto({ kms: new LocalKms(), keyIdFor: localTenantKeyId });
  const seen: string[] = [];
  const policy: Record<string, { checkerRoles?: string[]; dualCheckerAbove?: number }> = {};
  let engine: ApprovalsEngine;
  beforeAll(() => {
    engine = new ApprovalsEngine({
      kernel,
      audit,
      outbox,
      product: "LD",
      fieldCrypto,
      tenantPolicy: async (_ctx, action) => policy[action] ?? {},
      observers: [
        {
          onRequested: async (_tx, r) => void seen.push(`requested:${r.state}`),
          onDecided: async (_tx, r, d) => void seen.push(`${d}:${r.state}`),
          onExecuted: async (_tx, r) => void seen.push(`executed:${r.state}`),
          onCancelled: async (_tx, r) => void seen.push(`cancelled:${r.state}`),
          onExpired: async (_tx, r) => void seen.push(`expired:${r.state}`),
          onReminded: async () => void seen.push("reminded"),
          onEscalated: async (_tx, _r, role) => void seen.push(`escalated:${role}`),
        },
      ],
    });
    engine.register("payments.refund", {
      financial: true,
      amountOf: (p) => Number(p.amountMinor),
      execute: async () => undefined,
    });
    engine.register("org.setting.change", { execute: async () => undefined });
  });
  const maker = user("usr_maker", ["ORG_ADMIN"]);
  const make = (input: Parameters<ApprovalsEngine["request"]>[1], ctx = maker) =>
    kernel.mutate(ctx, (tx) => engine.request(tx, input));
  const hoursLeft = async (id: string) =>
    (
      await db.admin.query<{ h: number }>(
        "select round(extract(epoch from expires_at - created_at) / 3600)::int as h from tenancy.approval_request where id = $1",
        [id],
      )
    ).rows[0]?.h;

  it("expires after 7 days, or 72 hours for R4/R5 and financial R3; an expired request is terminal", async () => {
    const a = await make({ action: "org.setting.change", riskClass: "R2", payload: {} });
    const b = await make({
      action: "payments.refund",
      riskClass: "R3",
      payload: { amountMinor: 10 },
    });
    const c = await make({ action: "access.ip_allowlist.change", riskClass: "R4", payload: {} });
    expect([await hoursLeft(a.id), await hoursLeft(b.id), await hoursLeft(c.id)]).toEqual([
      168, 72, 72,
    ]);
    expect(await err(engine.expire(maker, a.id))).toBe("ConflictError");
    await db.admin.query(
      "update tenancy.approval_request set expires_at = now() - interval '1 second' where id = $1",
      [a.id],
    );
    // Overdue but not yet expired by the timer: still refused.
    expect(await err(engine.decide(user("usr_c", ["ORG_CHECKER"]), a.id, "approve"))).toBe(
      "IPB-UX-012",
    );
    const e = await engine.expire(user("svc_timer", []), a.id);
    expect(e.state).toBe("expired");
    expect(await err(engine.cancel(maker, a.id))).toBe("IPB-UX-012");
    await expect(
      db.admin.query("update tenancy.approval_request set state = 'approved' where id = $1", [
        a.id,
      ]),
    ).rejects.toThrow(/expired/);
    const ev = await db.admin.query<{ type: string }>(
      "select type from tenancy.outbox where envelope->'data'->>'request_id' = $1 order by created_at",
      [a.id],
    );
    expect(ev.rows.map((r) => r.type)).toContain("in.ld.security.ApprovalExpired.v1");
    expect(audit.entries.map((x) => x.action)).toContain("approvals.request.expire");
  });

  it("reminds once, escalates once to ORG_ADMIN, and never decides", async () => {
    const { id } = await make({ action: "org.setting.change", riskClass: "R2", payload: {} });
    seen.length = 0;
    expect((await engine.remind(user("svc_timer", []), id)).remindedAt).not.toBeNull();
    expect(await err(engine.remind(user("svc_timer", []), id))).toBe("ConflictError");
    const r = await engine.escalate(user("svc_timer", []), id);
    expect(r.state).toBe("pending");
    expect(seen).toEqual(["reminded", "escalated:ORG_ADMIN"]);
    const ev = await db.admin.query<{ envelope: { data: Record<string, unknown> } }>(
      "select envelope from tenancy.outbox where type = 'in.ld.security.ApprovalEscalated.v1' and envelope->'data'->>'request_id' = $1",
      [id],
    );
    expect(ev.rows[0]?.envelope.data).toMatchObject({ escalated_to_role: "ORG_ADMIN" });
  });

  it("stores the checker diff, with field names only above INTERNAL", async () => {
    const plain = await make({
      action: "org.setting.change",
      riskClass: "R2",
      payload: { key: "k" },
      diff: { before: { limit: 5 }, after: { limit: 10 } },
    });
    const sealed = await make({
      action: "org.setting.change",
      riskClass: "R2",
      payload: { pan: "ZZZZA1234Z" },
      payloadDataClass: "REGULATED",
      diff: { before: null, after: { pan: "ZZZZA1234Z" } },
    });
    expect((await engine.get(maker, plain.id)).diff).toEqual({
      before: { limit: 5 },
      after: { limit: 10 },
    });
    expect((await engine.get(maker, sealed.id)).diff).toEqual({ fields: ["pan"] });
  });

  it("mc.* only tightens: narrower checker roles and a second checker above the amount", async () => {
    policy["payments.refund"] = {
      checkerRoles: ["ORG_OWNER", "NOT_A_CHECKER"],
      dualCheckerAbove: 1000,
    };
    const big = await make({
      action: "payments.refund",
      riskClass: "R3",
      payload: { amountMinor: 5000 },
    });
    const small = await make({
      action: "payments.refund",
      riskClass: "R3",
      payload: { amountMinor: 500 },
    });
    expect((await engine.get(maker, big.id)).requiredCheckers).toBe(2);
    expect((await engine.get(maker, small.id)).requiredCheckers).toBe(1);
    expect(await engine.checkerRolesFor(maker, "payments.refund")).toEqual(["ORG_OWNER"]);
    expect(await err(engine.decide(user("usr_c", ["ORG_CHECKER"]), small.id, "approve"))).toBe(
      "IPB-UX-011",
    );
    await engine.decide(user("usr_o1", ["ORG_OWNER"]), big.id, "approve");
    expect((await engine.get(maker, big.id)).state).toBe("pending");
    expect((await engine.decide(user("usr_o2", ["ORG_OWNER"]), big.id, "approve")).state).toBe(
      "executed",
    );
    // A tenant list with no allowed role never widens or locks out: the platform roles apply.
    policy["payments.refund"] = { checkerRoles: ["NOT_A_CHECKER"] };
    expect(await engine.checkerRolesFor(maker, "payments.refund")).toEqual([
      "ORG_CHECKER",
      "ORG_ADMIN",
      "ORG_OWNER",
    ]);
  });

  it("PLT_SECURITY_OFFICER may cancel (IPB-02-80); observers see every transition", async () => {
    seen.length = 0;
    const { id } = await make({
      action: "access.ip_allowlist.change",
      riskClass: "R4",
      payload: {},
    });
    await engine.decide(user("usr_c", ["ORG_CHECKER"]), id, "approve");
    const officer = user("usr_so", ["PLT_SECURITY_OFFICER"]);
    expect((await engine.cancel(officer, id)).state).toBe("cancelled");
    expect(seen).toEqual(["requested:pending", "approve:approved", "cancelled:cancelled"]);
  });
});

describe("outbox relay as SVC_OUTBOX_RELAY (owner answer #74(e), R1-D-01)", () => {
  const relayCtx = (tenantId: string): KernelContext => ({
    tenantId,
    principal: { id: "svc_outbox_relay", type: "service", roles: ["SVC_OUTBOX_RELAY"] },
  });
  const outboxDdl = (schema: string) => `
    create schema ${schema};
    create table ${schema}.outbox (
      id text primary key, tenant_id text not null, type text not null, envelope jsonb not null,
      created_at timestamptz not null default now(), dispatched_at timestamptz,
      attempts integer not null default 0);
    alter table ${schema}.outbox enable row level security;
    alter table ${schema}.outbox force row level security;
    create policy outbox_tenant on ${schema}.outbox for all
      using (tenant_id = current_setting('app.tenant_id', true))
      with check (tenant_id = current_setting('app.tenant_id', true));
    grant usage on schema ${schema} to app_rw, app_ro;
    grant select, insert, update on ${schema}.outbox to app_rw;`;
  const enqueue = (tenantId: string, id: string) =>
    kernel.mutate(user("usr_w", ["ORG_MAKER"], { tenantId }), async (tx) => {
      await tx.query(
        `insert into relay_a.outbox (id, tenant_id, type, envelope) values ($1, $2, 'in.ld.relay_a.Done.v1', '{}')`,
        [id, tenantId],
      );
      await audit.record(tx, { action: "relay_a.done.create", resourceType: "x", resourceId: id });
    });

  beforeAll(async () => {
    await db.admin.query(outboxDdl("relay_a"));
    await db.admin.query(outboxDdl("relay_b"));
    await db.admin.query(
      `create table relay_a.secret (tenant_id text not null, v text);
       alter table relay_a.secret enable row level security;
       alter table relay_a.secret force row level security;
       create policy secret_tenant on relay_a.secret for all
         using (tenant_id = current_setting('app.tenant_id', true));
       grant select, insert, update on relay_a.secret to app_rw;
       insert into relay_a.secret values ('tnt_a', 'x');
       select tenancy.register_outbox('relay_a');`,
    );
  });

  it("registers only a well-formed outbox under forced RLS", async () => {
    await db.admin
      .query(`create schema relay_bad; create table relay_bad.outbox (id text, tenant_id text);
      alter table relay_bad.outbox enable row level security;`);
    await expect(db.admin.query(`select tenancy.register_outbox('relay_bad')`)).rejects.toThrow(
      /relay_bad\.outbox lacks/,
    );
    await expect(db.admin.query(`select tenancy.register_outbox('Relay;drop')`)).rejects.toThrow(
      /invalid schema name/,
    );
    await expect(db.admin.query(`select tenancy.register_outbox('relay_none')`)).rejects.toThrow(
      /does not exist/,
    );
  });

  it("relays every tenant's pending rows of the registered outbox only, each batch ledgered in its tenant", async () => {
    await enqueue("tnt_a", "evt_relay_a1");
    await enqueue("tnt_a", "evt_relay_a2");
    await enqueue("tnt_b", "evt_relay_b1");
    await db.admin.query(
      `insert into relay_b.outbox (id, tenant_id, type, envelope) values ('evt_relay_x', 'tnt_a', 't', '{}')`,
    );
    const delivered: Array<[string, RelayedEvent]> = [];
    const relay = new OutboxRelay({
      kernel,
      audit,
      deliver: async (schema, e) => void delivered.push([schema, e]),
    });
    expect(await relay.registered()).toEqual(["relay_a"]);
    const before = audit.entries.length;
    expect(await relay.once()).toBe(3);
    expect(delivered.map(([s, e]) => `${s}:${e.tenant_id}:${e.id}`).sort()).toEqual([
      "relay_a:tnt_a:evt_relay_a1",
      "relay_a:tnt_a:evt_relay_a2",
      "relay_a:tnt_b:evt_relay_b1",
    ]);
    const entries = audit.entries.slice(before).map((e) => `${e.tenantId}:${e.action}`);
    expect(entries.sort()).toEqual([
      "tnt_a:platform.service_read",
      "tnt_a:relay_a.outbox.dispatch",
      "tnt_b:platform.service_read",
      "tnt_b:relay_a.outbox.dispatch",
    ]);
    const left = await db.admin.query(
      `select id from relay_a.outbox where dispatched_at is null union all
       select id from relay_b.outbox where dispatched_at is null`,
    );
    expect(left.rows.map((r) => r.id)).toEqual(["evt_relay_x"]);
    const n = audit.entries.length;
    expect(await relay.once()).toBe(0);
    expect(audit.entries.length).toBe(n);
  });

  it("the relay role touches nothing but its registered outbox, and only in a tenant context", async () => {
    const write = (ctx: KernelContext, sql: string, action = "relay_a.outbox.dispatch") =>
      err(
        kernel.mutate(
          ctx,
          async (tx) => {
            await tx.query(sql);
            await audit.record(tx, {
              action,
              resourceType: "outbox",
              resourceId: "relay_a.outbox",
            });
          },
          { action },
        ),
      );
    expect(await write(relayCtx("tnt_a"), "update relay_a.secret set v = 'y'")).toBe("42501");
    expect(await write(relayCtx("tnt_a"), "select v from relay_a.secret")).toBe("42501");
    expect(await write(relayCtx("tnt_a"), "update relay_b.outbox set attempts = 9")).toBe("42501");
    expect(await write(relayCtx("tnt_a"), "update relay_a.outbox set type = 'forged'")).toBe(
      "42501",
    );
    expect(await write(relayCtx("tnt_a"), "select 1", "relay_a.greeting.delete")).toBe(
      "IPB-SEC-005",
    );
    expect(
      await write(
        { ...relayCtx("tnt_platform"), scope: "platform" },
        "update relay_a.outbox set attempts = 9",
      ),
    ).toBe("IPB-SEC-005");
    // In tnt_a's context the relay sees only tnt_a's rows: tnt_b's row is not updated.
    await kernel.mutate(
      relayCtx("tnt_a"),
      async (tx) => {
        await tx.query(`update relay_a.outbox set attempts = attempts + 0`);
        await audit.record(tx, {
          action: "relay_a.outbox.dispatch",
          resourceType: "outbox",
          resourceId: "relay_a.outbox",
        });
      },
      { action: "relay_a.outbox.dispatch" },
    );
    const b = await db.admin.query(`select attempts from relay_a.outbox where tenant_id = 'tnt_b'`);
    expect(b.rows).toEqual([{ attempts: 1 }]);
  });
});
