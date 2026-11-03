// Chain lanes on PostgreSQL (Finbyx PR-FBX-32; ADR-0005; audit/0006 and 0007): a tenant's chains
// written the old way continue in lane 0 after the upgrade; concurrent writers of one tenant
// append in parallel and every lane still verifies; and many writers of one tenant are no longer
// serialised (the load case, measured against everything forced into one lane).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { KernelContext } from "@infrabyx/contracts/kernel";
import { LOCAL_KMS_KEYS, localDevKey } from "@infrabyx/crypto";
import { PgKernel } from "@infrabyx/tenancy";
import { StatutoryCapture } from "./capture.js";
import { lanePosition, verifyChain } from "./chain.js";
import { AuditService } from "./service.js";
import { PgAuditSink } from "./sink.js";
import { freshDb } from "./__tests__/db.js";

let db: Awaited<ReturnType<typeof freshDb>>;
let kernel: PgKernel;
const sink = new PgAuditSink({ pseudonymKey: localDevKey(LOCAL_KMS_KEYS.auditPseudonym) });
let svc: AuditService;
let capture: StatutoryCapture;
const ctx = (tenantId: string, user = "usr_cob"): KernelContext => ({
  tenantId,
  principal: { id: user, type: "service", roles: ["SVC_COB"] },
});

/** One close-of-business-like transaction: `rows` captured writes, one ledger entry, then `holdMs`. */
const loanTx = (c: KernelContext, id: string, rows = 2, holdMs = 0, oneLane = false) =>
  kernel.mutate(
    c,
    async (tx) => {
      // The pre-lanes behaviour, for comparison: every transaction on lane 0.
      if (oneLane)
        await tx.query(
          "select set_config('audit.ledger_lane', '0', true), set_config('audit.capture_lane', '0', true)",
        );
      for (let i = 0; i < rows; i++)
        await tx.query("insert into lms.accrual values ($1, $2, $3)", [
          `${id}-${i}`,
          c.tenantId,
          i + 1,
        ]);
      await sink.record(tx, {
        action: "cob.loan.accrue",
        resourceType: "loan",
        resourceId: id,
        after: { rows },
      });
      if (holdMs) await tx.query("select pg_sleep($1)", [holdMs / 1000]);
    },
    { action: "cob.loan.accrue" },
  );

/** `workers` concurrent writers of one tenant, each running `each` transactions in turn. */
async function run(
  tenant: string,
  workers: number,
  each: number,
  o: { rows?: number; holdMs?: number; oneLane?: boolean; tag: string },
) {
  const t0 = performance.now();
  await Promise.all(
    Array.from({ length: workers }, async (_, w) => {
      for (let i = 0; i < each; i++)
        await loanTx(ctx(tenant), `${o.tag}-${w}-${i}`, o.rows, o.holdMs, o.oneLane);
    }),
  );
  return (workers * each) / ((performance.now() - t0) / 1000);
}

const BOOKS = `
  create schema lms;
  grant usage on schema lms to app_rw, app_ro;
  create table lms.accrual (id text primary key, tenant_id text not null, amount numeric not null);
  alter table lms.accrual enable row level security;
  alter table lms.accrual force row level security;
  create policy accrual_tenant on lms.accrual for all
    using (tenant_id = current_setting('app.tenant_id', true))
    with check (tenant_id = current_setting('app.tenant_id', true));
  grant select, insert, update, delete on lms.accrual to app_rw;
  select audit.register_capture('lms.accrual');
`;

beforeAll(async () => {
  // Stop before audit/0006 so the first writes go the old way.
  db = await freshDb({ auditUpTo: "0005" });
  kernel = new PgKernel({ pool: db.pool });
  svc = new AuditService({ kernel, sink, product: "FBX" });
  capture = new StatutoryCapture({ kernel, batch: 50 });
  await db.admin.query(BOOKS);
  for (let i = 0; i < 4; i++) await loanTx(ctx("tnt_old"), `old-${i}`);
  before = await svc.query(ctx("tnt_old"));
  oldCapture = (
    await db.admin.query<{ seq: string; entry_hash: string }>(
      "select seq, entry_hash from audit.capture_head where tenant_id = 'tnt_old'",
    )
  ).rows;
  await db.migrateRest();
});
let before: Awaited<ReturnType<AuditService["query"]>>;
let oldCapture: { seq: string; entry_hash: string }[];
afterAll(async () => db?.end());

describe("@IPB-02-51 chain lanes (PR-FBX-32)", () => {
  it("continues each tenant's existing chains in lane 0 after the upgrade", async () => {
    expect(before.map((e) => e.seq)).toEqual([1, 2, 3, 4]);
    // No lane exists until the tenant's first append after the upgrade.
    const none = await db.admin.query(
      "select count(*)::int as n from audit.ledger_lane where tenant_id = 'tnt_old'",
    );
    expect(none.rows[0].n).toBe(0);
    // New writes, one pinned to lane 0 so it must link to the old head; then both chains verify.
    await loanTx(ctx("tnt_old"), "new-0", 2, 0, true);
    for (let i = 1; i < 6; i++) await loanTx(ctx("tnt_old"), `new-${i}`);
    const after = await svc.query(ctx("tnt_old"));
    const pinned = after.find((e) => e.resource_id === "new-0")!;
    expect(pinned).toMatchObject({ lane: 0, lane_seq: 5, prev_hash: before.at(-1)!.entry_hash });
    expect(pinned.seq).toBeGreaterThan(4);
    const capturedPinned = (await capture.query(ctx("tnt_old"), { limit: 100 })).filter(
      (r) => r.lane === 0,
    )[0]!;
    expect(capturedPinned).toMatchObject({
      lane_seq: Number(oldCapture[0]!.seq) + 1,
      prev_hash: oldCapture[0]!.entry_hash,
    });
    expect(after.slice(0, 4).every((e) => e.lane === null)).toBe(true);
    expect(await svc.verify(ctx("tnt_old"))).toMatchObject({ ok: true, checked: 10 });
    expect(await svc.verifyCapture(ctx("tnt_old"))).toMatchObject({
      ok: true,
      checked: 20,
      problems: [],
    });
  });

  it("lets many writers of one tenant append at once, and every lane still verifies", async () => {
    await run("tnt_par", 16, 10, { rows: 3, tag: "par" });
    const entries = await svc.query(ctx("tnt_par"));
    expect(entries).toHaveLength(160);
    expect(new Set(entries.map((e) => e.lane)).size).toBeGreaterThan(1);
    expect(verifyChain(entries).ok).toBe(true);
    expect(await svc.verify(ctx("tnt_par"))).toMatchObject({ ok: true, checked: 160 });
    const cap = await capture.verify(ctx("tnt_par"));
    expect(cap).toMatchObject({ ok: true, checked: 480, problems: [] });
    // A transaction's captured rows and its ledger entry each sit together in one lane.
    const rows = await capture.query(ctx("tnt_par"), { limit: 10_000 });
    const byTx = new Map<string, number[]>();
    for (const r of rows) byTx.set(r.txid, [...(byTx.get(r.txid) ?? []), r.lane!]);
    expect([...byTx.values()].every((lanes) => new Set(lanes).size === 1)).toBe(true);
    for (const r of rows.filter((x) => x.txid === rows[0]!.txid))
      expect(lanePosition(r).lane).toBe(rows[0]!.lane);
  });

  it("does not serialise a tenant's writers (load: 16 writers, each transaction held 20 ms)", async () => {
    const workers = 16;
    const each = 8;
    const holdMs = 20;
    const oneLane = await run("tnt_one", workers, each, { holdMs, oneLane: true, tag: "one" });
    const lanes = await run("tnt_many", workers, each, { holdMs, tag: "many" });
    console.log(
      `audit lanes load: ${workers} writers x ${each} tx, hold ${holdMs} ms: one lane ${oneLane.toFixed(0)} tx/s, lanes ${lanes.toFixed(0)} tx/s`,
    );
    // One lane is bounded by 1000 / holdMs transactions a second; lanes are not.
    expect(oneLane).toBeLessThan((1000 / holdMs) * 1.1);
    expect(lanes).toBeGreaterThan(oneLane * 3);
    for (const t of ["tnt_one", "tnt_many"]) {
      expect((await svc.verify(ctx(t))).ok).toBe(true);
      expect((await capture.verify(ctx(t))).ok).toBe(true);
    }
  });

  it("raises lanes but never lowers them", async () => {
    await db.admin.query("select audit.set_chain_lanes('ledger', 48)");
    await expect(db.admin.query("select audit.set_chain_lanes('ledger', 8)")).rejects.toThrow(
      /only ever raised/,
    );
    await expect(db.admin.query("delete from audit.lane_setting")).rejects.toThrow(
      /only ever raised/,
    );
    await loanTx(ctx("tnt_par"), "after-raise");
    expect(await svc.verify(ctx("tnt_par"))).toMatchObject({ ok: true, checked: 161 });
    const n = await db.admin.query(
      "select count(*)::int as n from audit.ledger_lane where tenant_id = 'tnt_par'",
    );
    expect(n.rows[0].n).toBe(48);
  });

  it("a deleted lane tail is reported against the lane heads", async () => {
    const last = (await svc.query(ctx("tnt_many"))).at(-1)!;
    await db.admin.query("alter table audit.ledger disable trigger ledger_no_update");
    try {
      await db.admin.query("delete from audit.ledger where id = $1", [last.id]);
    } finally {
      await db.admin.query("alter table audit.ledger enable trigger ledger_no_update");
    }
    expect((await svc.verify(ctx("tnt_many"))).break).toMatchObject({
      lane: last.lane,
      reason: "head-mismatch",
    });
  });
});
