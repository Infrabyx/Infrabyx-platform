// The Ecosystem inbox on PostgreSQL (Ecosystem Spec §3.4, §3.5; R1 plan M10, G2): de-duplication by
// (source, id) and business key, processing in `seq` order per subject, gaps parked, replayed after
// the parking time, else a reconciliation break; tenant isolation under forced RLS; no delete.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuditEntryInput, AuditSink, KernelContext, Tx } from "@infrabyx/contracts/kernel";
import {
  MemoryReplayStore,
  RegulatedKeyRing,
  localRegulatedSigner,
  randomBytes,
  signRegulatedMessage,
  toHex,
} from "@infrabyx/crypto";
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
     select t, 'UDF', t from unnest(array['tnt_a', 'tnt_b', 'tnt_order', 'tnt_late', 'tnt_fail', 'tnt_gap', 'tnt_replay', 'tnt_jws', 'tnt_jwsb']) as t`,
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

  it("R1-D-70 exclusiveWith: only the first of two types under one business key is stored", async () => {
    const i = inbox();
    const a = event("excl", 1);
    const b = { ...event("excl", 2), type: "in.infrabyx.ops.ProvisioningFailed.v1" };
    const types = [a.type, b.type];
    const key = "provisioning:excl";
    expect((await i.receive(ctx(), a, { businessKey: key, exclusiveWith: types })).outcome).toBe(
      "accepted",
    );
    expect((await i.receive(ctx(), b, { businessKey: key, exclusiveWith: types })).outcome).toBe(
      "business_duplicate",
    );
    expect(await i.list(ctx(), SOURCE, "excl")).toHaveLength(1);
    // Another tenant's event under the same key is its own.
    expect(
      (await i.receive(ctx("tnt_b"), b, { businessKey: key, exclusiveWith: types })).outcome,
    ).toBe("accepted");
    await expect(i.receive(ctx(), a, { exclusiveWith: types })).rejects.toThrow(/businessKey/);
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

describe("R1-D-257 the verified detached JWS beside the event (PR-UDF-073, Spec §3.6)", () => {
  // Keys are made in memory at run time; no key or JWS literal is checked in.
  const signer = localRegulatedSigner("lender-2026-11");
  const keys = new RegulatedKeyRing([{ kid: signer.kid, key: signer.publicKey }]);
  const replay = new MemoryReplayStore(() => clock);
  const signed = () => inbox({ regulated: { keys, replay } });
  const sign = (e: Record<string, unknown>) =>
    signRegulatedMessage({ event: e, kid: signer.kid, sign: signer.sign, now: clock });
  const stored = async (eventId: string) =>
    (await db.admin.query(`select jws from consumer.eco_inbox where event_id = $1`, [eventId]))
      .rows[0]?.jws as string | null | undefined;

  it("stores the verified JWS on the first receipt and hands it to the handler", async () => {
    const i = signed();
    const e = event("jws_first", 1);
    const jws = await sign(e);
    const r = await i.receive(ctx("tnt_jws"), e, { jws });
    expect(r).toEqual({
      outcome: "accepted",
      eventId: e.id,
      jws,
      original: null,
      originalSigned: null,
    });
    expect(await stored(e.id)).toBe(jws);
    const got: InboxEvent[] = [];
    await i.drain(ctx("tnt_jws"), async (_tx, ev) => void got.push(ev));
    expect(got.map((g) => g.jws)).toEqual([jws]);
    expect((await i.list(ctx("tnt_jws"), SOURCE, "jws_first"))[0]).toMatchObject({ jws });
    const led = audit.entries.filter((a) => a.resourceId === e.id && a.action.endsWith("receive"));
    expect(led.at(-1)?.after).toMatchObject({ outcome: "accepted", signed: true, kid: signer.kid });
  });

  it("an unsigned event is stored with a null JWS, and its handler gets null", async () => {
    const i = signed();
    const e = event("jws_unsigned", 1);
    expect(await i.receive(ctx("tnt_jws"), e)).toEqual({
      outcome: "accepted",
      eventId: e.id,
      jws: null,
      original: null,
      originalSigned: null,
    });
    expect(await stored(e.id)).toBeNull();
    const got: InboxEvent[] = [];
    await i.drain(ctx("tnt_jws"), async (_tx, ev) => void got.push(ev));
    expect(got).toHaveLength(1);
    expect(got[0]!.jws).toBeNull();
  });

  it("a redelivery returns the JWS stored first, with a fresh JWS or the very same one", async () => {
    const i = signed();
    const e = event("jws_replay", 1);
    const first = await sign(e);
    await i.receive(ctx("tnt_jws"), e, { jws: first });
    const fresh = await sign(e);
    expect(fresh).not.toBe(first);
    expect(await i.receive(ctx("tnt_jws"), e, { jws: fresh })).toEqual({
      outcome: "duplicate",
      eventId: e.id,
      jws: first,
      original: null,
      originalSigned: null,
    });
    // The same bytes again: the `jti` is claimed, but this event holds that JWS.
    expect(await i.receive(ctx("tnt_jws"), e, { jws: first })).toEqual({
      outcome: "duplicate",
      eventId: e.id,
      jws: first,
      original: null,
      originalSigned: null,
    });
    expect(await stored(e.id)).toBe(first);
    // A JWS over this event offered for another one does not verify.
    const other = event("jws_replay", 2);
    await expect(i.receive(ctx("tnt_jws"), other, { jws: first })).rejects.toMatchObject({
      code: "IPB-API-018",
    });
    expect(await stored(other.id)).toBeUndefined();
  });

  it("refuses an unverified, malformed or over-long JWS before storing anything", async () => {
    const i = signed();
    const e = event("jws_refused", 1);
    const good = await sign(e);
    const tampered = { ...e, data: { status: "TAMPERED" } };
    await expect(i.receive(ctx("tnt_jws"), tampered, { jws: good })).rejects.toMatchObject({
      code: "IPB-API-018",
      meta: { reason: "signature-invalid", jws: "signature" },
    });
    const long = `${good.slice(0, good.indexOf("."))}..${"A".repeat(1100)}`;
    await expect(i.receive(ctx("tnt_jws"), e, { jws: long })).rejects.toMatchObject({
      code: "IPB-API-018",
      meta: { jws: "too_long" },
    });
    await expect(i.receive(ctx("tnt_jws"), e, { jws: `${good} ` })).rejects.toMatchObject({
      code: "IPB-API-018",
      meta: { jws: "malformed" },
    });
    // Without a key ring the inbox cannot verify, so it never stores a JWS.
    await expect(inbox().receive(ctx("tnt_jws"), e, { jws: good })).rejects.toThrow(/regulated/);
    expect(await stored(e.id)).toBeUndefined();
  });

  it("the database refuses any change of the JWS and a JWS over 1,024 octets", async () => {
    const i = signed();
    const e = event("jws_once", 1);
    const jws = await sign(e);
    await i.receive(ctx("tnt_jws"), e, { jws });
    const u = event("jws_once", 2);
    await i.receive(ctx("tnt_jws"), u);
    // As the application role, through the kernel: clearing it, changing it, or setting it later.
    const changes: Array<[string, string | null]> = [
      [e.id, null],
      [e.id, `${jws.slice(0, 10)}..AAAA`],
      [u.id, jws],
    ];
    for (const [id, value] of changes)
      await expect(
        kernel.mutate(
          ctx("tnt_jws"),
          async (tx) => {
            await tx.query(`update consumer.eco_inbox set jws = $2 where event_id = $1`, [
              id,
              value,
            ]);
            await audit.record(tx, { action: "test.jws", resourceType: "t", resourceId: id });
          },
          { action: "test.jws" },
        ),
      ).rejects.toMatchObject({ code: "42501" });
    // Not even the table's owner.
    await expect(
      db.admin.query(`update consumer.eco_inbox set jws = null where event_id = $1`, [e.id]),
    ).rejects.toMatchObject({ code: "42501" });
    expect(await stored(e.id)).toBe(jws);
    expect(await stored(u.id)).toBeNull();
    // Other columns still move (processing updates the state).
    await i.drain(ctx("tnt_jws"), async () => {});
    expect((await i.list(ctx("tnt_jws"), SOURCE, "jws_once")).map((x) => [x.state, x.jws])).toEqual(
      [
        ["processed", jws],
        ["processed", null],
      ],
    );
    // The length and form checks, below the application.
    const insert = (value: string) =>
      db.admin.query(
        `insert into consumer.eco_inbox (tenant_id, source, event_id, type, subject, seq, envelope, jws)
         values ('tnt_jws', $1, $2, 'in.infrabyx.servicing.LoanStatusChanged.v1', 'jws_check', 1, '{}', $3)`,
        [SOURCE, uuidv7(), value],
      );
    await expect(insert(`AAAA..${"A".repeat(1019)}`)).rejects.toMatchObject({ code: "23514" });
    await expect(insert("not a jws")).rejects.toMatchObject({ code: "23514" });
    await expect(insert(`AAAA..${"A".repeat(1018)}`)).resolves.toBeDefined();
  });

  it("@IPB-02-12 another tenant neither sees the JWS nor can redeliver it as its own", async () => {
    const i = signed();
    const e = event("jws_rls", 1);
    const jws = await sign(e);
    await i.receive(ctx("tnt_jws"), e, { jws });
    expect(await i.list(ctx("tnt_jwsb"), SOURCE, "jws_rls")).toEqual([]);
    // The same bytes in another tenant: the redelivery check cannot see the first tenant's row.
    await expect(i.receive(ctx("tnt_jwsb"), e, { jws })).rejects.toMatchObject({
      code: "IPB-API-018",
      meta: { jws: "replay" },
    });
    const seen = await kernel.read(
      ctx("tnt_jwsb"),
      async (tx) =>
        (await tx.query(`select count(*)::int as n from consumer.eco_inbox where jws is not null`))
          .rows[0],
    );
    expect(seen).toEqual({ n: 0 });
  });

  it("tenancy 0026 adds the column to an inbox made before it, once (idempotent)", async () => {
    await db.admin.query(`create schema legacy`);
    await db.admin.query(`select tenancy.create_ecosystem_inbox('legacy')`);
    // An inbox as tenancy 0006 made it.
    await db.admin.query(`drop trigger eco_inbox_jws_once on legacy.eco_inbox`);
    await db.admin.query(`alter table legacy.eco_inbox drop column jws`);
    await db.admin.query(`select tenancy.add_ecosystem_inbox_jws('legacy')`);
    await db.admin.query(`select tenancy.add_ecosystem_inbox_jws('legacy')`);
    const t = `'legacy.eco_inbox'::regclass`;
    const r = await db.admin.query(
      `select (select count(*)::int from pg_attribute where attrelid = ${t} and attname = 'jws' and not attisdropped) as cols,
              (select count(*)::int from pg_constraint where conrelid = ${t} and conname = 'eco_inbox_jws_compact') as checks,
              (select count(*)::int from pg_trigger where tgrelid = ${t} and tgname = 'eco_inbox_jws_once') as triggers,
              col_description(${t}, (select attnum from pg_attribute where attrelid = ${t} and attname = 'jws' and not attisdropped)::int) as tag`,
    );
    expect(r.rows[0]).toEqual({ cols: 1, checks: 1, triggers: 1, tag: "dataclass:INTERNAL" });
    await expect(
      db.admin.query(`select tenancy.add_ecosystem_inbox_jws('missing_schema')`),
    ).rejects.toMatchObject({ code: "42P01" });
    await db.admin.query(`drop schema legacy cascade`);
  });
});
