// Owner answers #21 and #22 on PostgreSQL 18 (PL3-D-21): cross-tenant service readers with their own
// database roles and per-tenant ledger entries, and the 48-hour inbox escalation.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { KernelContext } from "@infrabyx/contracts/kernel";
import {
  PgKernel,
  ServiceReader,
  contextFromClaims,
  serviceReaderContext,
  type ServiceReadRecord,
} from "@infrabyx/tenancy";
import { startPostgres, withTenant, type TestDatabase } from "@infrabyx/testing";
import { createWorkflow } from "../setup.js";
import type { InboxService, WorkflowTimers } from "../index.js";

let db: TestDatabase;
let inbox: InboxService;
let timers: WorkflowTimers;
const reads: ServiceReadRecord[] = [];
const escalations: string[] = [];

const ctx = (id: string, roles: string[], tenantId = "tnt_a"): KernelContext =>
  withTenant(tenantId, roles, { principal: { id } });
const code = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: { code?: string; message?: string }) => e.code ?? e.message,
  );

beforeAll(async () => {
  db = await startPostgres();
  await db.admin.query(
    "insert into tenancy.tenant (id, product, name) values ('tnt_a', 'LD', 'A'), ('tnt_b', 'LD', 'B'), ('tnt_platform', 'LD', 'P') on conflict do nothing",
  );
  ({ inbox, timers } = createWorkflow({
    kernel: db.kernel,
    audit: db.audit,
    product: "LD",
    onServiceRead: (r) => void reads.push(r),
    notifier: {
      reminder: async () => undefined,
      escalated: async () => undefined,
      itemEscalated: async (_tx, item, role, ex) =>
        void escalations.push(`${item.id}:${role}:${ex ?? "-"}`),
    },
  }));
});

afterAll(async () => {
  await db?.end();
});

const raise = (tenant: string, escalate?: number) =>
  db.kernel.mutate(
    ctx("svc_rules", ["SVC_RULES"], tenant),
    (tx) =>
      inbox.raise(tx, {
        type: "task",
        productModule: "rules",
        recordRef: "dcs_01M5XQT0PRXMKBEGFFSHNHTA61",
        title: "Rule decision undetermined (test)",
        assignee: { kind: "role", id: "ORG_CHECKER" },
        severity: "warning",
        actionHint: "review_undetermined",
        deepLink: "/rules/decisions/dcs_01M5XQT0PRXMKBEGFFSHNHTA61",
        helpKey: "hlp.rules.undetermined",
        excludePrincipal: "usr_maker",
        ...(escalate ? { escalateAfterHours: escalate } : {}),
      }),
    { action: "inbox.item.create" },
  );

describe("@PL3-SVC-READER cross-tenant service readers (OWNER-QUESTIONS #22)", () => {
  it("a service reader context is single-purpose, never from a token, never with a PLT role, impersonation or break-glass", async () => {
    const base = serviceReaderContext("SVC_SCHEDULER", "svc_scheduler");
    for (const bad of [
      { ...base, principal: { ...base.principal, roles: ["SVC_SCHEDULER", "PLT_AUDITOR_RO"] } },
      {
        ...base,
        principal: { ...base.principal, roles: ["SVC_SCHEDULER", "SVC_NOTIFY_DISPATCH"] },
      },
      { ...base, principal: { ...base.principal, type: "user" as const } },
      { ...base, act: { sub: "usr_x", sessionId: "s" } },
      { ...base, breakGlassGrantId: "bgg_01M5XQT0PRXMKBEGFFSHNHTA61" },
    ])
      expect(await code(db.kernel.read(bad, async () => 1))).toBe("IPB-SEC-005");
    expect(() =>
      contextFromClaims({
        iss: "https://idp.test",
        sub: "svc_x",
        aud: "ld",
        exp: 2_000_000_000,
        iat: 1_700_000_000,
        tid: "tnt_platform",
        typ: "service",
        roles: ["SVC_SCHEDULER"],
      } as never),
    ).toThrow(/never come from a token|IPB-SEC-005/);
  });

  it("may not write in platform scope, nor approve, delete or write anything in a tenant", async () => {
    const base = serviceReaderContext("SVC_SCHEDULER", "svc_scheduler");
    const audit = (tx: Parameters<Parameters<PgKernel["mutate"]>[1]>[0]) =>
      db.audit.record(tx, { action: "x.y.z", resourceType: "t", resourceId: "r" });
    expect(await code(db.kernel.mutate(base, audit, { action: "platform.service_read" }))).toBe(
      "IPB-SEC-005",
    );
    const inTenant = { ...base, tenantId: "tnt_a", scope: "tenant" as const };
    for (const action of ["approvals.request.approve", "workflow.timer.fire", undefined])
      expect(await code(db.kernel.mutate(inTenant, audit, action ? { action } : {}))).toBe(
        "IPB-SEC-005",
      );
  });

  it("reads only its granted columns and tables, as its own database role", async () => {
    const base = serviceReaderContext("SVC_SCHEDULER", "svc_scheduler");
    const run = (sql: string) => code(db.kernel.read(base, (tx) => tx.query(sql)));
    expect(await run("select tenant_id, kind, ref, fire_at from workflow.timer")).toBeNull();
    expect(await run("select current_user as u")).toBeNull();
    const who = await db.kernel.read(base, (tx) =>
      tx.query<{ u: string }>("select current_user as u"),
    );
    expect(who.rows[0]?.u).toBe("svc_scheduler");
    expect(await run("select last_error from workflow.timer")).toBe("42501");
    expect(await run("select * from workflow.inbox_item")).toBe("42501");
    expect(await run("select * from notify.delivery")).toBe("42501");
    expect(await run("select * from tenancy.membership")).toBe("42501");
    const dispatch = serviceReaderContext("SVC_NOTIFY_DISPATCH", "svc_notify_dispatch");
    expect(
      await code(
        db.kernel.read(dispatch, (tx) => tx.query("select tenant_id, state from notify.delivery")),
      ),
    ).toBeNull();
    expect(
      await code(
        db.kernel.read(dispatch, (tx) => tx.query("select tenant_id from workflow.timer")),
      ),
    ).toBe("42501");
    const reader = new ServiceReader({
      kernel: db.kernel,
      audit: db.audit,
      role: "SVC_SCHEDULER",
      principalId: "svc_scheduler",
    });
    await expect(
      reader.read("notify.delivery", "select tenant_id from notify.delivery"),
    ).rejects.toThrow(/may not read/);
  });

  it("a non-superuser login holding app_rw can SET LOCAL ROLE to the reader roles", async () => {
    await db.admin.query(
      "do $$ begin if not exists (select 1 from pg_roles where rolname = 'ipb_login') then create role ipb_login login password 'pw' in role app_rw; end if; end $$",
    );
    await db.admin.query(`grant connect on database ${db.url.split("/").pop()} to ipb_login`);
    const u = new URL(db.url);
    u.username = "ipb_login";
    u.password = "pw";
    const Pool = db.pool.constructor as new (o: {
      connectionString: string;
      max: number;
    }) => TestDatabase["pool"];
    const pool = new Pool({ connectionString: u.toString(), max: 1 });
    try {
      const k = new PgKernel({ pool });
      const r = await k.read(serviceReaderContext("SVC_SCHEDULER", "svc_scheduler"), (tx) =>
        tx.query<{ u: string }>("select current_user as u"),
      );
      expect(r.rows[0]?.u).toBe("svc_scheduler");
    } finally {
      await pool.end();
    }
  });

  it("every poll that finds timers is ledgered in each tenant it read, with the tenant id", async () => {
    const a = await raise("tnt_a", 48);
    const b = await raise("tnt_b", 48);
    await db.admin.query(
      "update workflow.timer set fire_at = now() - interval '1 minute' where ref = any($1::text[])",
      [[a.id, b.id]],
    );
    reads.length = 0;
    expect(await timers.tick()).toBe(2);
    const entries = await db.admin.query<{ tenant_id: string; actor_id: string }>(
      `select tenant_id, actor_id from audit.ledger where action = 'platform.service_read'
        and resource_id = 'workflow.timer' order by tenant_id`,
    );
    expect(entries.rows.map((r) => [r.tenant_id, r.actor_id])).toEqual([
      ["tnt_a", "svc_scheduler"],
      ["tnt_b", "svc_scheduler"],
    ]);
    expect(reads[0]?.tenants.get("tnt_a")).toBe(1);
    expect(reads).toHaveLength(1);
    expect([...(reads[0]?.tenants.keys() ?? [])].sort()).toEqual(["tnt_a", "tnt_b"]);
    // An empty poll returned no tenant data and writes nothing.
    const before = entries.rows.length;
    await timers.tick();
    const after = await db.admin.query(
      "select count(*)::int as n from audit.ledger where action = 'platform.service_read'",
    );
    expect((after.rows[0] as { n: number }).n).toBe(before);
  });
});

describe("@PL3-RULES-ESCALATE inbox items escalate after their deadline (OWNER-QUESTIONS #21)", () => {
  it("an open item escalates once to ORG_ADMIN, still hidden from the maker", async () => {
    escalations.length = 0;
    const { id } = await raise("tnt_a", 48);
    const t = await db.admin.query<{ fire_at: Date; created_at: Date }>(
      "select t.fire_at, i.created_at from workflow.timer t join workflow.inbox_item i on i.id = t.ref where t.ref = $1 and t.kind = 'inbox.escalate'",
      [id],
    );
    const hours =
      ((t.rows[0]?.fire_at.getTime() ?? 0) - (t.rows[0]?.created_at.getTime() ?? 0)) / 3_600_000;
    expect(Math.round(hours)).toBe(48);
    await db.admin.query(
      "update workflow.timer set fire_at = now() - interval '1 minute' where ref = $1",
      [id],
    );
    await timers.fire("tnt_a", "inbox.escalate", id);
    expect(escalations).toEqual([`${id}:ORG_ADMIN:usr_maker`]);
    const admin = await inbox.list(ctx("usr_admin", ["ORG_ADMIN"]), { type: "due" });
    expect(admin.some((i) => i.title.startsWith("Escalated: Rule decision undetermined"))).toBe(
      true,
    );
    const makerView = await inbox.list(ctx("usr_maker", ["ORG_ADMIN", "ORG_CHECKER"]));
    expect(makerView.filter((i) => i.recordRef === "dcs_01M5XQT0PRXMKBEGFFSHNHTA61")).toEqual([]);
    // Firing again is stale: escalation happens once.
    expect(await inbox.escalate(ctx("svc_workflow_timers", ["SVC_WORKFLOW"]), id)).toBe("stale");
  });

  it("resolving the item first cancels the escalation", async () => {
    const { id } = await raise("tnt_a", 48);
    await inbox.resolve(ctx("usr_checker", ["ORG_CHECKER"]), id);
    const t = await db.admin.query<{ state: string }>(
      "select state from workflow.timer where ref = $1 and kind = 'inbox.escalate'",
      [id],
    );
    expect(t.rows[0]?.state).toBe("cancelled");
  });

  it("the maker cannot resolve an item that excludes them", async () => {
    const { id } = await raise("tnt_a");
    expect(await code(inbox.resolve(ctx("usr_maker", ["ORG_CHECKER"]), id))).toMatch(
      /not found|NOT_FOUND|IPB-/i,
    );
  });
});
