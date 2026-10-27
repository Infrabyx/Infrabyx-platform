// @infrabyx/workflow on PostgreSQL 18 with every platform migration applied (PL3 plan §5, §12).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { KernelContext } from "@infrabyx/contracts/kernel";
import { PgSettingsStore, SETTING_CHANGE_ACTION, SettingsService } from "@infrabyx/config/settings";
import { canonicalDigest, localTenantKeyId, newId } from "@infrabyx/crypto";
import { FieldCrypto, PgOutbox, type ApprovalsEngine } from "@infrabyx/tenancy";
import {
  agentContext,
  fakeKms,
  startPostgres,
  withTenant,
  type TestDatabase,
} from "@infrabyx/testing";
import { engineRefundApprovals } from "../approvals.js";
import { createWorkflow } from "../setup.js";
import type { ApprovalWorkflow, InboxService, WorkflowTimers } from "../index.js";

let db: TestDatabase;
let approvals: ApprovalsEngine;
let inbox: InboxService;
let timers: WorkflowTimers;
let workflow: ApprovalWorkflow;
let settings: SettingsService;
const notified: string[] = [];

const ctx = (id: string, roles: string[], tenantId = "tnt_a"): KernelContext =>
  withTenant(tenantId, roles, { principal: { id } });
const maker = ctx("usr_maker", ["ORG_ADMIN"]);
const owner = ctx("usr_owner", ["ORG_OWNER"]);
const checker = ctx("usr_checker", ["ORG_CHECKER"]);
const code = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: { code?: string; name?: string }) => e.code ?? e.name,
  );
const make = (input: Parameters<ApprovalsEngine["request"]>[1], c = maker) =>
  db.kernel.mutate(c, (tx) => approvals.request(tx, input));
/** Move a request's clock back by `hours` so its timers come due. */
const age = async (id: string, hours: number) => {
  await db.admin.query(
    `update tenancy.approval_request set created_at = created_at - make_interval(hours => $2),
       expires_at = expires_at - make_interval(hours => $2) where id = $1`,
    [id, hours],
  );
  await db.admin.query(
    "update workflow.timer set fire_at = fire_at - make_interval(hours => $2) where ref = $1",
    [id, hours],
  );
};
const timersOf = async (ref: string) =>
  (
    await db.admin.query<{ kind: string; state: string }>(
      "select kind, state from workflow.timer where ref = $1 order by kind",
      [ref],
    )
  ).rows.map((r) => `${r.kind}:${r.state}`);

beforeAll(async () => {
  db = await startPostgres();
  await db.admin.query(
    "insert into tenancy.tenant (id, product, name) values ('tnt_a', 'LD', 'A'), ('tnt_b', 'LD', 'B'), ('tnt_platform', 'LD', 'P') on conflict do nothing",
  );
  const outbox = new PgOutbox();
  settings = new SettingsService({
    store: new PgSettingsStore(),
    kernel: db.kernel,
    audit: db.audit,
    product: "LD",
    outbox,
  });
  const wired = createWorkflow({
    kernel: db.kernel,
    audit: db.audit,
    product: "LD",
    outbox,
    fieldCrypto: new FieldCrypto({ kms: fakeKms(), keyIdFor: localTenantKeyId }),
    settings,
    notifier: {
      reminder: async (_tx, r, roles) => void notified.push(`reminder:${r.id}:${roles.join("|")}`),
      escalated: async (_tx, r, role) => void notified.push(`escalated:${r.id}:${role}`),
    },
  });
  ({ approvals, inbox, timers, workflow } = wired);
  // Settings and the engine are wired both ways, as a product does it.
  (settings as unknown as { o: { approvals: ApprovalsEngine } }).o.approvals = approvals;
  approvals.register(SETTING_CHANGE_ACTION, {
    execute: (tx, p, req) => settings.applyApproved(tx, p as never, req.id).then(() => undefined),
  });
  approvals.register("org.entity.delete", {
    delayMinutes: 24 * 60,
    execute: async () => undefined,
  });
  approvals.register("payments.refund", { financial: true, execute: async () => undefined });
  approvals.register("loans.sanction", { execute: async () => undefined });
});
afterAll(async () => db?.end());

describe("@IPB-07-AT-10 Work Inbox (backend)", () => {
  it("aggregates five sources, labels the AI suggestion, and counts the badge", async () => {
    const u = ctx("usr_u", ["ORG_MEMBER"]);
    await db.kernel.mutate(maker, async (tx) => {
      const base = { productModule: "los", deepLink: "/x", helpKey: "hlp.los.item" };
      const to = { kind: "user" as const, id: "usr_u" };
      await inbox.raise(tx, {
        ...base,
        type: "task",
        recordRef: "ln_1",
        title: "Review file",
        assignee: to,
      });
      await inbox.raise(tx, {
        ...base,
        type: "mention",
        recordRef: "nt_1",
        title: "Mentioned in a note",
        assignee: to,
      });
      await inbox.raise(
        tx,
        {
          ...base,
          type: "suggestion",
          recordRef: "ln_2",
          title: "Draft reminder",
          assignee: to,
          fromAgent: true,
        },
        { fromId: "agt_vidhi" },
      );
      await inbox.raise(tx, {
        ...base,
        type: "job_failed",
        productModule: "export",
        recordRef: "exj_1",
        title: "Export failed",
        assignee: to,
      });
      await inbox.raise(tx, {
        ...base,
        type: "approval",
        recordRef: "apr_x",
        title: "Approve limit",
        assignee: { kind: "role", id: "ORG_MEMBER" },
      });
    });
    const items = await inbox.list(u);
    expect(items.map((i) => i.type).sort()).toEqual([
      "approval",
      "job_failed",
      "mention",
      "suggestion",
      "task",
    ]);
    expect(items.find((i) => i.type === "suggestion")?.fromAgent).toBe(true);
    expect(await inbox.badgeCount(u)).toBe(5);
    expect(await inbox.badgeCount(ctx("usr_u", ["ORG_MEMBER"], "tnt_b"))).toBe(0);
    await inbox.resolve(u, items[0]?.id as string, "dismissed");
    expect(await inbox.badgeCount(u)).toBe(4);
  });
});

describe("approvals through the workflow (@IPB-02-AT-11, @IPB-02-AT-12)", () => {
  it("checkers get an approval item, the maker does not; deciding resolves it", async () => {
    const { id } = await make({
      action: "loans.sanction",
      riskClass: "R2",
      payload: { loan: "ln_9" },
    });
    const forChecker = (await inbox.list(checker)).filter((i) => i.recordRef === id);
    expect(forChecker.map((i) => i.type)).toEqual(["approval"]);
    expect((await inbox.list(maker)).filter((i) => i.recordRef === id)).toEqual([]);
    expect(await timersOf(id)).toEqual([
      "approval.escalate:scheduled",
      "approval.expire:scheduled",
      "approval.remind:scheduled",
    ]);
    // Agents never check (IPB-02-10).
    expect(
      await code(
        approvals.decide(agentContext("tnt_a", ["AGT_VIDHI", "ORG_CHECKER"]), id, "approve"),
      ),
    ).toBe("IPB-SEC-004");
    expect((await approvals.decide(checker, id, "approve")).state).toBe("executed");
    expect((await inbox.list(checker)).filter((i) => i.recordRef === id)).toEqual([]);
    expect(await timersOf(id)).toEqual([
      "approval.escalate:cancelled",
      "approval.expire:cancelled",
      "approval.remind:cancelled",
    ]);
  });

  it("reminds at 24 h and escalates at 48 h to ORG_ADMIN by timer; expiry at 72 h for financial R3", async () => {
    notified.length = 0;
    const { id } = await make({
      action: "payments.refund",
      riskClass: "R3",
      payload: { paymentId: "pay_1" },
    });
    await age(id, 25);
    expect(await timers.tick()).toBe(1);
    expect(notified).toEqual([`reminder:${id}:ORG_CHECKER|ORG_ADMIN|ORG_OWNER`]);
    await age(id, 24);
    await timers.tick();
    expect(notified.at(-1)).toBe(`escalated:${id}:ORG_ADMIN`);
    const admin = ctx("usr_admin2", ["ORG_ADMIN"]);
    expect(
      (await inbox.list(admin)).filter((i) => i.recordRef === id).map((i) => i.title),
    ).toContainEqual(expect.stringMatching(/^Escalated/));
    expect((await approvals.get(maker, id)).state).toBe("pending");
    await age(id, 24);
    await timers.tick();
    expect((await approvals.get(maker, id)).state).toBe("expired");
    expect(await code(approvals.decide(checker, id, "approve"))).toBe("IPB-UX-012");
    expect((await inbox.list(checker)).filter((i) => i.recordRef === id)).toEqual([]);
  });

  it("mc.reminder_hours shortens the reminder (PL3-D-08)", async () => {
    await db.admin.query(
      `insert into config.setting_value (id, key, tier, scope_id, tenant_id, value, updated_by)
       values ($1, 'mc.reminder_hours', 'TENANT', 'tnt_a', 'tnt_a', '4'::jsonb, 'usr_owner')`,
      [newId("set")],
    );
    const { id } = await make({
      action: "loans.sanction",
      riskClass: "R2",
      payload: { loan: "ln_10" },
    });
    const r = await db.admin.query<{ h: number }>(
      `select round(extract(epoch from t.fire_at - a.created_at) / 3600)::int as h
         from workflow.timer t join tenancy.approval_request a on a.id = t.ref
        where t.ref = $1 and t.kind = 'approval.remind'`,
      [id],
    );
    expect(r.rows[0]?.h).toBe(4);
  });
});

describe("@IPB-07-AT-07 typed confirmation and delay window (backend)", () => {
  it("a delayed approval becomes a scheduled action: early execution is IPB-UX-005, the owner can cancel", async () => {
    const { id } = await make(
      { action: "org.entity.delete", riskClass: "R4", payload: { entity: "ent_1" } },
      owner,
    );
    await approvals.decide(checker, id, "approve");
    const [sca] = await workflow.listScheduled(owner, "scheduled");
    expect(sca).toMatchObject({ approvalId: id, action: "org.entity.delete", state: "scheduled" });
    const hours = ((sca?.executeAt.getTime() ?? 0) - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(23.9);
    expect(
      (await inbox.list(checker)).filter((i) => i.recordRef === id).map((i) => i.type),
    ).toEqual(["due"]);
    expect(await code(workflow.executeScheduled(owner, sca?.id as string))).toBe("IPB-UX-005");
    expect((await workflow.cancelScheduled(owner, sca?.id as string)).state).toBe("cancelled");
    expect((await workflow.listScheduled(owner))[0]?.state).toBe("cancelled");
    expect(await timersOf(sca?.id as string)).toEqual(["approval.execute:cancelled"]);
    expect((await inbox.list(checker)).filter((i) => i.recordRef === id)).toEqual([]);
    const ev = await db.admin.query<{ type: string }>(
      "select type from workflow.outbox where envelope->'data'->>'request_id' = $1 order by created_at",
      [id],
    );
    expect(ev.rows.map((e) => e.type)).toEqual([
      "in.ld.settings.ScheduledActionCreated.v1",
      "in.ld.settings.ScheduledActionCancelled.v1",
    ]);
  });

  it("the timer executes the scheduled action once its window has passed", async () => {
    const { id } = await make(
      { action: "org.entity.delete", riskClass: "R4", payload: { entity: "ent_2" } },
      owner,
    );
    await approvals.decide(checker, id, "approve");
    const sca = (await workflow.listScheduled(owner, "scheduled")).find((s) => s.approvalId === id);
    await db.admin.query(
      "update tenancy.approval_request set delay_until = now() - interval '1 second' where id = $1",
      [id],
    );
    await db.admin.query(
      "update workflow.timer set fire_at = now() - interval '1 second' where ref = $1",
      [sca?.id],
    );
    await timers.tick();
    expect((await approvals.get(owner, id)).state).toBe("executed");
    expect((await workflow.listScheduled(owner)).find((s) => s.id === sca?.id)?.state).toBe(
      "executed",
    );
    // A second fire is harmless: the timer is settled and the request is final.
    expect(await timers.fire("tnt_a", "approval.execute", sca?.id as string)).toBe(false);
  });
});

describe("@IPB-07-AT-09 bulk decide (backend)", () => {
  it("over the threshold a typed confirmation is required (IPB-UX-006); each request has its own ledger entry", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 25; i++)
      ids.push(
        (await make({ action: "loans.sanction", riskClass: "R2", payload: { loan: `ln_b${i}` } }))
          .id,
      );
    expect(await code(workflow.decideMany(checker, ids, "approve"))).toBe("IPB-UX-006");
    expect(
      await code(workflow.decideMany(checker, ids, "approve", { confirmation: "approve 24" })),
    ).toBe("IPB-UX-006");
    const r = await workflow.decideMany(checker, ids, "approve", { confirmation: "approve 25" });
    expect(r.filter((x) => x.ok)).toHaveLength(25);
    const n = await db.admin.query<{ n: number }>(
      "select count(*)::int as n from audit.ledger where action = 'approvals.request.approve' and resource_id = any($1::text[])",
      [ids],
    );
    expect(n.rows[0]?.n).toBe(25);
    const own = await workflow.decideMany(
      maker,
      [(await make({ action: "loans.sanction", riskClass: "R2", payload: {} })).id],
      "approve",
    );
    expect(own[0]).toMatchObject({ ok: false, code: "IPB-SEC-007" });
  });
});

describe("@IPB-07-AT-06 maker-checker on organisation settings", () => {
  it("stores the diff; the value is unchanged until a checker who is not the maker approves", async () => {
    const r = await settings.set(
      owner,
      "mc.reminder_hours",
      { tier: "TENANT", scopeId: "tnt_a" },
      6,
    );
    expect(r.status).toBe("pending");
    const id = (r as { requestId: string }).requestId;
    const req = await approvals.get(owner, id);
    expect(req.diff).toMatchObject({ after: { "mc.reminder_hours": 6 } });
    expect(await settings.get(owner, "mc.reminder_hours")).not.toBe(6);
    expect(await code(approvals.decide(owner, id, "approve"))).toBe("IPB-SEC-007");
    await approvals.decide(checker, id, "approve");
    // R4: inside the 1 h window the value is still unchanged.
    expect(await settings.get(owner, "mc.reminder_hours")).not.toBe(6);
    const sca = (await workflow.listScheduled(owner, "scheduled")).find((s) => s.approvalId === id);
    await db.admin.query(
      "update tenancy.approval_request set delay_until = now() - interval '1 second' where id = $1",
      [id],
    );
    await db.admin.query(
      "update workflow.timer set fire_at = now() - interval '1 second' where ref = $1",
      [sca?.id],
    );
    await timers.tick();
    expect(await settings.get(owner, "mc.reminder_hours")).toBe(6);
    const ledger = (
      await db.admin.query<{ action: string }>(
        "select action from audit.ledger where resource_id = $1 order by seq",
        [id],
      )
    ).rows.map((x) => x.action);
    expect(ledger).toEqual([
      "approvals.request.create",
      "approvals.request.approve",
      "approvals.request.execute",
    ]);
  });
});

describe("RefundApprovals (gate A product ask, PL3 plan §5.5)", () => {
  it("reads the engine's request for the PAYMENTS adapters", async () => {
    const payload = { paymentId: "pay_7", amountMinor: 500, reason: "duplicate" };
    const { id } = await make({ action: "payments.refund", riskClass: "R3", payload });
    const ra = engineRefundApprovals(approvals, () => maker);
    expect(await ra.get(id)).toMatchObject({
      action: "payments.refund",
      state: "pending",
      payloadDigest: canonicalDigest(payload),
    });
    await approvals.decide(checker, id, "approve");
    expect((await ra.get(id)).state).toBe("executed");
  });
});

describe("@NN-45 workflow writes are ledgered", () => {
  it("inbox items, scheduled actions and timer fires each carry a ledger entry", async () => {
    const actions = new Set(
      (
        await db.admin.query<{ action: string }>("select distinct action from audit.ledger")
      ).rows.map((r) => r.action),
    );
    for (const a of [
      "inbox.item.create",
      "inbox.item.resolve",
      "workflow.scheduled_action.create",
      "workflow.scheduled_action.cancelled",
      "workflow.scheduled_action.executed",
      "workflow.timer.fire",
      "approvals.request.remind",
      "approvals.request.escalate",
      "approvals.request.expire",
    ])
      expect(actions.has(a), a).toBe(true);
  });
});
