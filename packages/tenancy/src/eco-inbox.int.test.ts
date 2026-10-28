// The Ecosystem inbox on PostgreSQL (Ecosystem Spec §3.4, §3.5; R1 plan M10, G2): de-duplication by
// (source, id) and business key, processing in `seq` order per subject, gaps parked, replayed after
// the parking time, else a reconciliation break; tenant isolation under forced RLS; no delete.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuditEntryInput, AuditSink, KernelContext, Tx } from "@infrabyx/contracts/kernel";
import { randomBytes, toHex } from "@infrabyx/crypto";
import { EcosystemInbox, type InboxEvent, type ReconciliationBreak } from "./eco-inbox.js";
import { PgKernel } from "./kernel.js";
import { TENANCY_SOURCE, freshDb, type TestDb } from "./__tests__/pg.js";

class RecordingAudit implements AuditSink {
  readonly entries: Array<AuditEntryInput & { tenantId: string }> = [];
  async record(tx: Tx, e: AuditEntryInput): Promise<{ id: string }> {
    this.entries.push({ ...e, tenantId: tx.ctx.tenantId });
    tx.markAudited();
    return { id: `led_${this.entries.length}` };
  }
}

/** A UUIDv7 for `id` (RFC 9562): 48-bit milliseconds, version 7, variant 10. */
function uuidv7(ms = Date.now()): string {
  const b = randomBytes(16);
  const t = BigInt(ms);
  for (let i = 0; i < 6; i++) b[i] = Number((t >> BigInt(8 * (5 - i))) & 0xffn);
  b[6] = (b[6]! & 0x0f) | 0x70;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = toHex(b);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const SOURCE = "urn:infrabyx:finbyx:tnt_producer";
const event = (subject: string, seq: number, over: Record<string, unknown> = {}) => ({
  specversion: "1.0",
  id: uuidv7(),
  source: SOURCE,
  type: "in.infrabyx.servicing.LoanStatusChanged.v1",
  subject,
  time: "2026-10-28T12:00:00+05:30",
  datacontenttype: "application/json",
  dataschema: "https://registry.infrabyx.example/schemas/servicing/LoanStatusChanged/1.0.0.json",
  tenantid: "tnt_producer",
  reid: "re_01J8Y2M0PQ",
  productfamily: "PL",
  dataclass: "INTERNAL",
  schemaver: "1.0.0",
  seq,
  data: { status: `S${seq}` },
  ...over,
});

let db: TestDb;
let kernel: PgKernel;
const audit = new RecordingAudit();
let clock = new Date("2026-10-28T06:30:00Z");
const ctx = (tenantId = "tnt_a"): KernelContext => ({
  tenantId,
  principal: { id: "svc_consumer", type: "service", roles: ["SVC_ECO_CONSUMER"] },
});
const inbox = (o: Partial<ConstructorParameters<typeof EcosystemInbox>[0]> = {}) =>
  new EcosystemInbox({
    kernel,
    audit,
    schema: "consumer",
    environment: "live",
    now: () => clock,
    ...o,
  });

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "eco-inbox-"));
  writeFileSync(
    join(dir, "0001_consumer.sql"),
    `create schema consumer;\ngrant usage on schema consumer to app_rw, app_ro;\nselect tenancy.create_ecosystem_inbox('consumer');\n`,
  );
  db = await freshDb([TENANCY_SOURCE, { name: "consumer", dir }]);
  kernel = new PgKernel({ pool: db.pool });
  await db.admin.query(
    `insert into tenancy.tenant (id, product, name)
     select t, 'UDF', t from unnest(array['tnt_a', 'tnt_b', 'tnt_order', 'tnt_late', 'tnt_fail', 'tnt_gap', 'tnt_replay']) as t`,
  );
});
afterAll(async () => db?.end());

describe("G2 Ecosystem inbox (Spec §3.5)", () => {
  it("stores an event once by (source, id) and once by business key", async () => {
    const i = inbox();
    const e = event("loan_dedup", 1);
    expect((await i.receive(ctx(), e, { businessKey: "loan_dedup:1" })).outcome).toBe("accepted");
    expect((await i.receive(ctx(), e, { businessKey: "loan_dedup:1" })).outcome).toBe("duplicate");
    const again = { ...e, id: uuidv7() };
    expect((await i.receive(ctx(), again, { businessKey: "loan_dedup:1" })).outcome).toBe(
      "business_duplicate",
    );
    expect(await i.list(ctx(), SOURCE, "loan_dedup")).toHaveLength(1);
    expect(audit.entries.filter((a) => a.action === "consumer.eco_inbox.receive")).toHaveLength(3);
  });

  it("refuses an invalid envelope and an event of the other environment", async () => {
    const i = inbox();
    await expect(i.receive(ctx(), { ...event("loan_bad", 1), id: "not-a-uuid" })).rejects.toThrow();
    await expect(
      i.receive(ctx(), event("loan_bad", 1, { environment: "test" })),
    ).rejects.toMatchObject({ code: "IPB-API-005" });
    await expect(
      inbox({ environment: "test" }).receive(ctx(), event("loan_bad", 1)),
    ).rejects.toMatchObject({ code: "IPB-API-005" });
  });

  it("processes a subject in seq order, parks a gap and resumes when it fills", async () => {
    const i = inbox();
    const seen: number[] = [];
    const handle = async (_tx: Tx, e: InboxEvent) => void seen.push(e.seq);
    for (const s of [2, 1, 4]) await i.receive(ctx("tnt_order"), event("loan_order", s));
    expect(await i.drain(ctx("tnt_order"), handle)).toMatchObject({ processed: 2, parked: 1 });
    expect(seen).toEqual([1, 2]);
    expect((await i.list(ctx("tnt_order"), SOURCE, "loan_order")).map((e) => e.state)).toEqual([
      "processed",
      "processed",
      "parked",
    ]);
    await i.receive(ctx("tnt_order"), event("loan_order", 3));
    await i.drain(ctx("tnt_order"), handle);
    expect(seen).toEqual([1, 2, 3, 4]);
  });

  it("skips an event at or below the position (a late redelivery under a new id)", async () => {
    const i = inbox();
    const seen: number[] = [];
    await i.receive(ctx("tnt_late"), event("loan_late", 1));
    await i.drain(ctx("tnt_late"), async (_tx, e) => void seen.push(e.seq));
    await i.receive(ctx("tnt_late"), event("loan_late", 1));
    expect(await i.drain(ctx("tnt_late"), async (_tx, e) => void seen.push(e.seq))).toMatchObject({
      skipped: 1,
    });
    expect(seen).toEqual([1]);
  });

  it("a failing handler rolls its event back, counts the attempt and stops at maxAttempts", async () => {
    const i = inbox({ maxAttempts: 2 });
    await i.receive(ctx("tnt_fail"), event("loan_fail", 1));
    const boom = async () => {
      throw Object.assign(new Error("x"), { code: "IPB-PORT-002" });
    };
    expect(await i.drain(ctx("tnt_fail"), boom)).toMatchObject({ failed: 1 });
    expect(await i.drain(ctx("tnt_fail"), boom)).toMatchObject({ failed: 1 });
    const [e] = await i.list(ctx("tnt_fail"), SOURCE, "loan_fail");
    expect(e).toMatchObject({ state: "failed", attempts: 2 });
    const pos = await db.admin.query(
      `select count(*)::int as n from consumer.eco_position where subject = 'loan_fail'`,
    );
    expect(pos.rows[0].n).toBe(0);
  });

  it("after the parking time asks for a replay, and a gap still open becomes a break", async () => {
    const i = inbox();
    const breaks: ReconciliationBreak[] = [];
    const replays: unknown[] = [];
    const handle = async () => {};
    for (const s of [1, 3]) await i.receive(ctx("tnt_gap"), event("loan_gap", s));
    await i.drain(ctx("tnt_gap"), handle);
    const ops = {
      handle,
      replay: async (g: unknown) => void replays.push(g),
      raiseBreak: async (_tx: Tx, b: ReconciliationBreak) => void breaks.push(b),
    };
    expect(await i.sweep(ctx("tnt_gap"), ops)).toEqual({ replayed: 0, breaks: 0 });
    clock = new Date(clock.getTime() + 16 * 60_000);
    expect(await i.sweep(ctx("tnt_gap"), ops)).toEqual({ replayed: 1, breaks: 1 });
    expect(replays).toEqual([{ source: SOURCE, subject: "loan_gap", afterSeq: 1 }]);
    expect(breaks[0]).toMatchObject({ subject: "loan_gap", expectedSeq: 2, parkedSeqs: [3] });
    expect((await i.list(ctx("tnt_gap"), SOURCE, "loan_gap")).map((e) => e.state)).toEqual([
      "processed",
      "break",
    ]);
    // An operator reconciles from the owner's snapshot (last seq 3): the parked event is skipped.
    await i.setPosition(ctx("tnt_gap"), SOURCE, "loan_gap", 3);
    expect(await i.drain(ctx("tnt_gap"), handle)).toMatchObject({ skipped: 1 });
  });

  it("a replay that fills the gap clears it without a break", async () => {
    const i = inbox();
    const seen: number[] = [];
    const handle = async (_tx: Tx, e: InboxEvent) => void seen.push(e.seq);
    for (const s of [1, 3]) await i.receive(ctx("tnt_replay"), event("loan_replay", s));
    await i.drain(ctx("tnt_replay"), handle);
    clock = new Date(clock.getTime() + 16 * 60_000);
    const r = await i.sweep(ctx("tnt_replay"), {
      handle,
      replay: async () => void (await i.receive(ctx("tnt_replay"), event("loan_replay", 2))),
      raiseBreak: async () => {
        throw new Error("no break expected");
      },
    });
    expect(r).toEqual({ replayed: 1, breaks: 0 });
    expect(seen).toEqual([1, 2, 3]);
  });

  it("@IPB-02-12 another tenant sees none of it; the inbox has no delete grant", async () => {
    expect(await inbox().list(ctx("tnt_b"), SOURCE, "loan_order")).toEqual([]);
    expect(await inbox().list(ctx("tnt_order"), SOURCE, "loan_order")).toHaveLength(4);
    const grants = await db.admin.query(
      `select privilege_type from information_schema.role_table_grants
        where grantee = 'app_rw' and table_schema = 'consumer' order by 1`,
    );
    expect(grants.rows.map((r) => r.privilege_type)).not.toContain("DELETE");
    const rls = await db.admin.query(
      `select relname from pg_class where relnamespace = 'consumer'::regnamespace
          and relkind = 'r' and relrowsecurity and relforcerowsecurity order by 1`,
    );
    expect(rls.rows.map((r) => r.relname)).toEqual(["eco_inbox", "eco_position"]);
  });
});
