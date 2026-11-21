// The outbox relay keeps going past a row it cannot deliver, parks it after its attempts run out
// and hands it back on an operator's requeue (Finbyx PR-FBX-53; R1-D-266; tenancy/0027).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { IpbError } from "@infrabyx/contracts/errors";
import { eventJobName } from "@infrabyx/contracts/events";
import type { AuditEntryInput, AuditSink, KernelContext, Tx } from "@infrabyx/contracts/kernel";
import { assertQueueJob, assertQueueName, type QueueJob } from "@infrabyx/contracts/ports";
import { PgKernel } from "./kernel.js";
import {
  OUTBOX_REQUEUE_ACTION,
  OutboxParking,
  OutboxRelay,
  outboxEventJob,
  type OutboxDeliveryFailure,
} from "./outbox.js";
import { freshDb, type TestDb } from "./__tests__/pg.js";

class RecordingAudit implements AuditSink {
  readonly entries: Array<AuditEntryInput & { tenantId: string; actor: string }> = [];
  async record(tx: Tx, e: AuditEntryInput): Promise<{ id: string }> {
    this.entries.push({ ...e, tenantId: tx.ctx.tenantId, actor: tx.ctx.principal.id });
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
const user = (id: string, roles: string[], tenantId = "tnt_a"): KernelContext => ({
  tenantId,
  principal: { id, type: "user", roles },
});
const relayCtx = (tenantId: string): KernelContext => ({
  tenantId,
  principal: { id: "svc_outbox_relay", type: "service", roles: ["SVC_OUTBOX_RELAY"] },
});

/** A queue that checks names as every real adapter does, so a raw event type is refused. */
const jobs: QueueJob[] = [];
let down = false;
const queue = {
  async enqueue(q: string, job: QueueJob): Promise<void> {
    assertQueueName(q, "bullmq");
    assertQueueJob(job, "bullmq");
    if (down) throw Object.assign(new Error("unreachable"), { code: "IPB-PORT-002" });
    jobs.push(job);
  },
};

const TYPE = "in.ld.relay_p.ContentPublished.v1";
// A valid event type whose job name has more than 100 characters: the poison row.
const POISON_TYPE = `in.ld.relay_p.${"Ab".repeat(40)}.v1`;

const insert = (tenantId: string, id: string, type = TYPE) =>
  kernel.mutate(user("usr_w", ["ORG_MAKER"], tenantId), async (tx) => {
    await tx.query(
      `insert into relay_p.outbox (id, tenant_id, type, envelope, created_at)
       values ($1, $2, $3, $4::jsonb, now() + make_interval(secs => $5))`,
      [id, tenantId, type, JSON.stringify({ id, type }), Number(id.slice(-1))],
    );
    await audit.record(tx, { action: "relay_p.thing.create", resourceType: "x", resourceId: id });
  });
const row = async (id: string) =>
  (
    await db.admin.query<{ attempts: number; dispatched: boolean }>(
      `select attempts, dispatched_at is not null as dispatched from relay_p.outbox where id = $1`,
      [id],
    )
  ).rows[0];
const parks = async () =>
  (
    await db.admin.query(
      `select tenant_id, schema_name, event_id, event_type, reason, attempts, requeued_by
         from tenancy.outbox_parked order by parked_at`,
    )
  ).rows;

beforeAll(async () => {
  db = await freshDb();
  kernel = new PgKernel({ pool: db.pool });
  await db.admin.query(
    `insert into tenancy.tenant (id, product, name) values ('tnt_a', 'LD', 'Tenant A'), ('tnt_b', 'LD', 'Tenant B');
     create schema relay_p;
     create table relay_p.outbox (
       id text primary key, tenant_id text not null, type text not null, envelope jsonb not null,
       created_at timestamptz not null default now(), dispatched_at timestamptz,
       attempts integer not null default 0);
     alter table relay_p.outbox enable row level security;
     alter table relay_p.outbox force row level security;
     create policy outbox_tenant on relay_p.outbox for all
       using (tenant_id = current_setting('app.tenant_id', true))
       with check (tenant_id = current_setting('app.tenant_id', true));
     grant usage on schema relay_p to app_rw, app_ro;
     grant select, insert, update on relay_p.outbox to app_rw;
     select tenancy.register_outbox('relay_p');`,
  );
});
afterAll(async () => db?.end());

describe("@IPB-01-15 outbox relay: a poison row is parked, the rest are published (R1-D-266)", () => {
  const failures: OutboxDeliveryFailure[] = [];
  let poisonOn = true;
  let relay: OutboxRelay;
  let parking: OutboxParking;
  beforeAll(() => {
    relay = new OutboxRelay({
      kernel,
      audit,
      schemas: ["relay_p"],
      maxAttempts: 3,
      onFailure: (f) => void failures.push(f),
      deliver: async (_schema, e) => {
        // Once "fixed", the poison type is sent under a short name of the product's choosing.
        const job =
          !poisonOn && e.type === POISON_TYPE
            ? { name: "in.ld.relay_p.poison.v1", data: { type: e.type } }
            : outboxEventJob(e);
        await queue.enqueue("events", job);
      },
    });
    parking = new OutboxParking({ kernel, audit });
  });

  it("publishes every row around a failing one; the failing row's attempt is counted", async () => {
    await insert("tnt_a", "evt_p1");
    await insert("tnt_a", "evt_p2", POISON_TYPE);
    await insert("tnt_a", "evt_p3");
    await insert("tnt_b", "evt_p4");
    const before = audit.entries.length;
    expect(await relay.once()).toBe(3);
    expect(jobs.map((j) => j.name)).toEqual([
      eventJobName(TYPE),
      eventJobName(TYPE),
      eventJobName(TYPE),
    ]);
    expect(jobs.map((j) => j.data.type)).toEqual([TYPE, TYPE, TYPE]);
    expect(await row("evt_p1")).toEqual({ attempts: 1, dispatched: true });
    expect(await row("evt_p2")).toEqual({ attempts: 1, dispatched: false });
    expect(await row("evt_p3")).toEqual({ attempts: 1, dispatched: true });
    expect(await row("evt_p4")).toEqual({ attempts: 1, dispatched: true });
    const dispatch = audit.entries
      .slice(before)
      .filter((e) => e.action === "relay_p.outbox.dispatch")
      .map((e) => [e.tenantId, e.after]);
    expect(dispatch.sort()).toEqual([
      ["tnt_a", { dispatched: 2, failed: 1, parked: 0 }],
      ["tnt_b", { dispatched: 1 }],
    ]);
    expect(failures).toMatchObject([
      { tenantId: "tnt_a", eventId: "evt_p2", attempts: 1, reason: "queue_refused", parked: false },
    ]);
    expect(await parks()).toEqual([]);
  });

  it("parks the row after maxAttempts, ledgered, and then leaves it out of every pass", async () => {
    expect(await relay.once()).toBe(0);
    const before = audit.entries.length;
    expect(await relay.once()).toBe(0);
    expect(await row("evt_p2")).toEqual({ attempts: 3, dispatched: false });
    expect(failures.map((f) => [f.attempts, f.parked])).toEqual([
      [1, false],
      [2, false],
      [3, true],
    ]);
    expect(await parks()).toEqual([
      {
        tenant_id: "tnt_a",
        schema_name: "relay_p",
        event_id: "evt_p2",
        event_type: POISON_TYPE,
        reason: "queue_refused",
        attempts: 3,
        requeued_by: null,
      },
    ]);
    const mine = audit.entries.slice(before).map((e) => `${e.tenantId}:${e.action}`);
    expect(mine.sort()).toEqual([
      "tnt_a:platform.service_read",
      "tnt_a:relay_p.outbox.dispatch",
      "tnt_a:relay_p.outbox.park",
    ]);
    expect(audit.entries.find((e) => e.action === "relay_p.outbox.park")).toMatchObject({
      resourceId: "relay_p.outbox",
      after: { event_id: "evt_p2", type: POISON_TYPE, reason: "queue_refused", attempts: 3 },
      businessIds: ["evt_p2"],
    });
    // Parked: no discovery read, no transaction, no ledger entry on later passes.
    const n = audit.entries.length;
    expect(await relay.pending("relay_p")).toEqual(new Map());
    expect(await relay.once()).toBe(0);
    expect(audit.entries.length).toBe(n);
    expect(await row("evt_p2")).toEqual({ attempts: 3, dispatched: false });
  });

  it("lists parked rows in the caller's tenant only", async () => {
    const a = await parking.list(user("usr_ops", ["ORG_MEMBER"]));
    expect(a).toMatchObject([
      {
        tenantId: "tnt_a",
        schema: "relay_p",
        eventId: "evt_p2",
        type: POISON_TYPE,
        reason: "queue_refused",
        attempts: 3,
        requeuedAt: null,
        requeuedBy: null,
      },
    ]);
    expect(Number.isNaN(Date.parse(a[0]!.parkedAt))).toBe(false);
    expect(await parking.list(user("usr_b", ["ORG_ADMIN"], "tnt_b"))).toEqual([]);
    expect(await parking.list(user("usr_ops", ["ORG_MEMBER"]), { schema: "other" })).toEqual([]);
  });

  it("requeue is a ledgered operator action; the row then gets a fresh attempt budget", async () => {
    expect(await err(parking.requeue(user("usr_m", ["ORG_MAKER"]), "relay_p", "evt_p2"))).toBe(
      "IPB-SEC-005",
    );
    const agent: KernelContext = {
      tenantId: "tnt_a",
      principal: { id: "agt_1", type: "agent", roles: ["ORG_ADMIN"] },
    };
    expect(await err(parking.requeue(agent, "relay_p", "evt_p2"))).toBe("IPB-SEC-005");
    // Another tenant cannot see, so cannot requeue, tenant A's park.
    expect(
      await err(parking.requeue(user("usr_b", ["ORG_ADMIN"], "tnt_b"), "relay_p", "evt_p2")),
    ).toBe("NotFoundError");

    const before = audit.entries.length;
    const r = await parking.requeue(user("usr_admin", ["ORG_ADMIN"]), "relay_p", "evt_p2");
    expect(r).toMatchObject({ eventId: "evt_p2", requeuedBy: "usr_admin", attempts: 3 });
    expect(audit.entries.slice(before)).toMatchObject([
      {
        tenantId: "tnt_a",
        actor: "usr_admin",
        action: OUTBOX_REQUEUE_ACTION,
        resourceId: "relay_p.outbox",
        before: { event_id: "evt_p2", reason: "queue_refused", attempts: 3 },
        businessIds: ["evt_p2"],
      },
    ]);
    expect(await err(parking.requeue(user("usr_admin", ["ORG_ADMIN"]), "relay_p", "evt_p2"))).toBe(
      "NotFoundError",
    );
    expect(await parking.list(user("usr_ops", ["ORG_MEMBER"]))).toEqual([]);
    expect(
      await parking.list(user("usr_ops", ["ORG_MEMBER"]), { includeRequeued: true }),
    ).toMatchObject([{ eventId: "evt_p2", requeuedBy: "usr_admin" }]);

    // Back in the pass: it fails once more (attempt 4, 1 of a fresh 3) and is not parked yet.
    failures.length = 0;
    expect(await relay.once()).toBe(0);
    expect(failures).toMatchObject([{ eventId: "evt_p2", attempts: 4, parked: false }]);
    // Fixed (the product now maps the type), it is published and stays published.
    poisonOn = false;
    expect(await relay.once()).toBe(1);
    expect(await row("evt_p2")).toEqual({ attempts: 5, dispatched: true });
    expect(jobs.at(-1)).toMatchObject({
      name: "in.ld.relay_p.poison.v1",
      data: { type: POISON_TYPE },
    });
    expect(await relay.once()).toBe(0);
  });

  it("an unreachable queue is counted as queue_unavailable, and nothing is marked dispatched", async () => {
    await insert("tnt_b", "evt_p5");
    failures.length = 0;
    down = true;
    try {
      expect(await relay.once()).toBe(0);
    } finally {
      down = false;
    }
    expect(failures).toMatchObject([{ eventId: "evt_p5", reason: "queue_unavailable" }]);
    expect(await row("evt_p5")).toEqual({ attempts: 1, dispatched: false });
    expect(await relay.once()).toBe(1);
  });

  it("the relay role inserts parks in its own tenant only and never changes or deletes one", async () => {
    const write = (ctx: KernelContext, sql: string) =>
      err(
        kernel.mutate(
          ctx,
          async (tx) => {
            await tx.query(sql);
            await audit.record(tx, {
              action: "relay_p.outbox.dispatch",
              resourceType: "outbox",
              resourceId: "relay_p.outbox",
            });
          },
          { action: "relay_p.outbox.dispatch" },
        ),
      );
    expect(await write(relayCtx("tnt_a"), "update tenancy.outbox_parked set reason = 'x'")).toBe(
      "42501",
    );
    expect(await write(relayCtx("tnt_a"), "delete from tenancy.outbox_parked")).toBe("42501");
    expect(
      await write(
        relayCtx("tnt_a"),
        `insert into tenancy.outbox_parked (tenant_id, schema_name, event_id, event_type, reason, attempts)
         values ('tnt_b', 'relay_p', 'evt_x', 't', 'delivery_failed', 1)`,
      ),
    ).toBe("42501");
    expect(
      await write(
        relayCtx("tnt_a"),
        `insert into tenancy.outbox_parked (tenant_id, schema_name, event_id, event_type, reason, attempts)
         values ('tnt_a', 'relay_p', 'evt_x', 't', 'Free text: not a label', 1)`,
      ),
    ).toBe("23514");
    expect(await write(relayCtx("tnt_a"), "select requeued_by from tenancy.outbox_parked")).toBe(
      "42501",
    );
  });

  it("app_rw cannot delete a park, and a requeued park is never changed again", async () => {
    const asUser = (sql: string) =>
      kernel.mutate(user("usr_admin", ["ORG_ADMIN"]), async (tx) => {
        const r = await tx.query(sql);
        await audit.record(tx, { action: "x.y.z", resourceType: "x", resourceId: "x" });
        return r.rowCount;
      });
    expect(await err(asUser("delete from tenancy.outbox_parked"))).toBe("42501");
    expect(
      await asUser("update tenancy.outbox_parked set requeued_at = now(), requeued_by = 'usr_x'"),
    ).toBe(0);
    expect((await parks())[0]).toMatchObject({ event_id: "evt_p2", requeued_by: "usr_admin" });
  });
});
