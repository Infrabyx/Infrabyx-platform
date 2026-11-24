// A partner's original signed body beside the mapped event (Udofin PR-UDF-083; R1-D-281;
// tenancy/0029): a product maps a partner's message from the partner's own data format and stores
// the mapped event; the partner's JWS signs the original, so `receive({ jws, original })` verifies
// the JWS over the original and keeps it, written once, with the JWS. On an inbox restricted by
// `restrict_ecosystem_inbox_jws` the original has the JWS's reader roles.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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
import {
  EcosystemInbox,
  INBOX_JWS_REFUSED,
  INBOX_ORIGINAL_MAX_OCTETS,
  jsonbTextOctets,
  type InboxEvent,
} from "./eco-inbox.js";
import { PgKernel } from "./kernel.js";
import { lintRls } from "./rls-lint/index.js";
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

const SOURCE = "urn:ext:generic-lender:tnt_lender";
const READERS = ["SVC_ECO_CONSUMER", "UDF_LENDER_CONTROLLER", "UDF_LENDER_AUDITOR", "UDF_SECURITY"];
type Envelope = Record<string, unknown> & { id: string; data: Record<string, unknown> };
/** The partner's envelope, `data` in its own format. */
const original = (subject: string, seq: number, data?: Record<string, unknown>): Envelope => ({
  specversion: "1.0",
  id: uuidv7(),
  source: SOURCE,
  type: "in.infrabyx.servicing.LoanStatusChanged.v1",
  subject,
  time: "2026-11-23T12:00:00+05:30",
  datacontenttype: "application/json",
  dataschema: "https://registry.infrabyx.example/schemas/servicing/LoanStatusChanged/1.0.0.json",
  tenantid: "tnt_lender",
  reid: "re_01J8Y2M0PQ",
  productfamily: "PL",
  dataclass: "INTERNAL",
  schemaver: "1.0.0",
  seq,
  data: data ?? { LN_STAT: "DISB", LN_REF: `L-${seq}`, AMT_PAISE: 1_250_000 },
});
/** The product's mapping of it: the same attributes, `data` in the shared schema. */
const mapped = (o: Envelope): Envelope => ({ ...o, data: { status: `S${String(o.seq)}` } });

let db: TestDb;
let kernel: PgKernel;
const audit = new RecordingAudit();
const clock = new Date("2026-11-23T06:30:00Z");
const signer = localRegulatedSigner("lender-2026-11");
const keys = new RegulatedKeyRing([{ kid: signer.kid, key: signer.publicKey }]);
const replay = new MemoryReplayStore(() => clock);
const inbox = (schema: string) =>
  new EcosystemInbox({
    kernel,
    audit,
    schema,
    environment: "live",
    regulated: { keys, replay },
    now: () => clock,
  });
const sign = (e: Record<string, unknown>) =>
  signRegulatedMessage({ event: e, kid: signer.kid, sign: signer.sign, now: clock });
const as = (
  tenantId: string,
  roles: string[],
  type: "user" | "service" = "user",
): KernelContext => ({
  tenantId,
  principal: { id: type === "service" ? "svc_connector" : "usr_reader", type, roles },
});
const connector = (tenantId = "tnt_o") => as(tenantId, ["SVC_ECO_CONSUMER"], "service");
const maker = (tenantId = "tnt_o") => as(tenantId, ["UDF_LENDER_MAKER", "ORG_MEMBER"]);
const code = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: { code?: string; name?: string }) => e.code ?? e.name,
  );
const asRo = (c: KernelContext, sql: string, params: unknown[] = []) =>
  kernel.read(c, async (tx) => (await tx.query(sql, params)).rows);
const asRw = (c: KernelContext, sql: string, params: unknown[] = []) =>
  kernel.mutate(
    c,
    async (tx) => {
      const rows = (await tx.query(sql, params)).rows;
      await audit.record(tx, { action: "test.write", resourceType: "t", resourceId: "x" });
      return rows;
    },
    { action: "test.write" },
  );
const row = async (schema: string, eventId: string) =>
  (
    await db.admin.query<{ jws: string | null; original: Record<string, unknown> | null }>(
      `select jws, original from ${schema}.eco_inbox where event_id = $1`,
      [eventId],
    )
  ).rows[0];

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "eco-inbox-original-"));
  writeFileSync(
    join(dir, "0001_inboxes.sql"),
    `create schema mapped;
grant usage on schema mapped to app_rw, app_ro;
select tenancy.create_ecosystem_inbox('mapped');
create schema guardedo;
grant usage on schema guardedo to app_rw, app_ro;
select tenancy.create_ecosystem_inbox('guardedo');
select tenancy.restrict_ecosystem_inbox_jws('guardedo', array[${READERS.map((r) => `'${r}'`).join(", ")}]);
`,
  );
  db = await freshDb([TENANCY_SOURCE, { name: "product", dir }]);
  kernel = new PgKernel({ pool: db.pool });
  await db.admin.query(
    `insert into tenancy.tenant (id, product, name)
     select t, 'UDF', t from unnest(array['tnt_o', 'tnt_ob', 'tnt_of', 'tnt_od']) as t`,
  );
});
afterAll(async () => db?.end());

describe("R1-D-281 the partner's original signed body beside the mapped event (PR-UDF-083)", () => {
  it("keeps the original with the JWS that verified over it and hands both to the handler", async () => {
    const i = inbox("mapped");
    const o = original("o_first", 1);
    const m = mapped(o);
    const jws = await sign(o);
    // Over the mapped event alone the partner's JWS cannot verify: that is why the original is kept.
    await expect(i.receive(connector("tnt_of"), m, { jws })).rejects.toMatchObject({
      code: "IPB-API-018",
      meta: { reason: "signature-invalid", jws: "signature" },
    });
    expect(await i.receive(connector("tnt_of"), m, { jws, original: o })).toEqual({
      outcome: "accepted",
      eventId: o.id,
      jws,
      original: o,
      originalSigned: true,
    });
    expect(await row("mapped", o.id)).toEqual({ jws, original: o });
    const env = await db.admin.query(`select envelope from mapped.eco_inbox where event_id = $1`, [
      o.id,
    ]);
    expect(env.rows[0]?.envelope).toEqual(m);
    const got: InboxEvent[] = [];
    await i.drain(connector("tnt_of"), async (_tx, ev) => void got.push(ev));
    expect(got.map((g) => [g.envelope, g.jws, g.original])).toEqual([[m, jws, o]]);
    expect((await i.list(maker("tnt_of"), SOURCE, "o_first"))[0]).toMatchObject({
      jws,
      original: o,
    });
    // The ledger says an original was kept, never what it holds.
    const led = audit.entries.filter((a) => a.resourceId === o.id && a.action.endsWith("receive"));
    expect(led.at(-1)?.after).toMatchObject({
      outcome: "accepted",
      signed: true,
      kid: signer.kid,
      original: true,
    });
    expect(JSON.stringify(led)).not.toContain("LN_STAT");
    // An event received without an original keeps none, and its handler gets null.
    const plain = original("o_first_plain", 1, { status: "S1" });
    expect(await i.receive(connector("tnt_of"), plain, { jws: await sign(plain) })).toMatchObject({
      outcome: "accepted",
      original: null,
    });
    const later: InboxEvent[] = [];
    await i.drain(connector("tnt_of"), async (_tx, ev) => void later.push(ev));
    expect(later.map((g) => g.original)).toEqual([null]);
  });

  it("refuses a JWS over the mapped event when an original is given, before storing anything", async () => {
    const i = inbox("mapped");
    const o = original("o_wrong_jws", 1);
    const m = mapped(o);
    await expect(
      i.receive(connector(), m, { jws: await sign(m), original: o }),
    ).rejects.toMatchObject({
      code: "IPB-API-018",
      meta: { reason: "signature-invalid", jws: "signature" },
    });
    expect(await row("mapped", o.id)).toBeUndefined();
  });

  it("refuses an original that differs outside `data`, is not an envelope or is too long", async () => {
    const i = inbox("mapped");
    const o = original("o_refused", 1);
    const m = mapped(o);
    const jws = await sign(o);
    const refusal = (raw: unknown, orig: unknown) =>
      i.receive(connector(), raw, { jws, original: orig }).then(
        () => null,
        (x: { code?: string; httpStatus?: number; meta?: { reason?: string } }) => [
          x.code,
          x.httpStatus,
          x.meta?.reason,
        ],
      );
    const mismatch = ["IPB-API-018", 401, "original-mismatch"];
    // Any other attribute changed, added or left out.
    expect(await refusal(m, { ...o, seq: 2 })).toEqual(mismatch);
    expect(await refusal(m, { ...o, subject: "o_other" })).toEqual(mismatch);
    expect(await refusal(m, { ...o, id: uuidv7() })).toEqual(mismatch);
    expect(await refusal(m, { ...o, correlationid: "corr_1" })).toEqual(mismatch);
    expect(await refusal({ ...m, correlationid: "corr_1" }, o)).toEqual(mismatch);
    expect(await refusal(m, { ...o, reid: "re_other" })).toEqual(mismatch);
    expect(
      await refusal(m, { ...o, dataschema: "https://lender.example/schemas/status.json" }),
    ).toEqual(mismatch);
    // Not an Ecosystem envelope.
    const malformed = ["IPB-API-018", 401, "original-malformed"];
    expect(await refusal(m, { ...o, specversion: "0.3" })).toEqual(malformed);
    expect(await refusal(m, { ...o, extra: 1 })).toEqual(malformed);
    expect(await refusal(m, [o])).toEqual(malformed);
    expect(await refusal(m, "not json")).toEqual(malformed);
    expect(await refusal(m, null)).toEqual(malformed);
    expect(await refusal(m, { ...o, data: { n: 1n } })).toEqual(malformed);
    // Longer than the column's bound.
    const big = { ...o, data: { pad: "x".repeat(INBOX_ORIGINAL_MAX_OCTETS) } };
    expect(await refusal(mapped(big), big)).toEqual(["IPB-API-018", 401, "original-too-long"]);
    expect(await row("mapped", o.id)).toBeUndefined();
    // Every refusal came before the JWS was checked, so its `jti` is still unclaimed.
    expect((await i.receive(connector(), m, { jws, original: o })).outcome).toBe("accepted");
  });

  it("bounds the original at 262,144 octets of its jsonb text, as the column does", async () => {
    const i = inbox("mapped");
    const at = (subject: string, extra: number) => {
      const base = original(subject, 1, { pad: "", name: "é😀\n\u0001", n: [1e21, 1.5e-7, -0] });
      const pad = INBOX_ORIGINAL_MAX_OCTETS + extra - jsonbTextOctets(base);
      return { ...base, data: { ...base.data, pad: "x".repeat(pad) } };
    };
    const fits = at("o_bound", 0);
    expect(jsonbTextOctets(fits)).toBe(262_144);
    const r = await i.receive(connector(), mapped(fits), {
      jws: await sign(fits),
      original: fits,
    });
    expect(r.outcome).toBe("accepted");
    const len = await db.admin.query<{ n: number }>(
      `select octet_length(original::text)::int as n from mapped.eco_inbox where event_id = $1`,
      [fits.id],
    );
    expect(len.rows[0]?.n).toBe(262_144);
    const over = at("o_bound_over", 1);
    await expect(
      i.receive(connector(), mapped(over), { jws: await sign(over), original: over }),
    ).rejects.toMatchObject({ code: "IPB-API-018", meta: { reason: "original-too-long" } });
  });

  it("jsonbTextOctets counts what PostgreSQL prints for a jsonb", async () => {
    const values: unknown[] = [
      null,
      true,
      false,
      0,
      -0,
      12.5,
      -3,
      1e21,
      -1.5e21,
      1e300,
      1.5e-7,
      -1e-7,
      5e-324,
      123456789.125,
      "",
      "plain",
      'quote " and \\ backslash / slash',
      "\b\f\n\r\t\u0001\u001f\u007f",
      "é😀 नमस्ते",
      [],
      {},
      [1, "a", [null, {}], { k: [] }],
      { b: 1, a: { "": 2, "ü key": [true, false] }, c: [] },
    ];
    for (const v of values) {
      const json = JSON.stringify(v);
      const r = await db.admin.query<{ n: number }>(
        "select octet_length($1::jsonb::text)::int as n",
        [json],
      );
      expect(jsonbTextOctets(JSON.parse(json)), json).toBe(r.rows[0]?.n);
    }
  });

  it("the database checks the original: a JSON object of bounded size, with or without a JWS (R1-D-288)", async () => {
    const o = original("o_nojws", 1);
    // Without the `regulated` option the inbox cannot verify, so it keeps no original either.
    const bare = new EcosystemInbox({ kernel, audit, schema: "mapped", environment: "live" });
    await expect(
      bare.receive(connector(), mapped(o), { jws: await sign(o), original: o }),
    ).rejects.toThrow(/regulated/);
    const insert = (orig: string, jws: string | null) =>
      db.admin.query(
        `insert into mapped.eco_inbox (tenant_id, source, event_id, type, subject, seq, envelope, jws, original)
         values ('tnt_o', $1, $2, 'in.infrabyx.servicing.LoanStatusChanged.v1', 'o_check', 1, '{}', $3, $4::jsonb)`,
        [SOURCE, uuidv7(), jws, orig],
      );
    const jws = "aaaa..bbbb";
    // tenancy 0033: an original without a JWS is kept (unsigned).
    expect((await insert("{}", null)).rowCount).toBe(1);
    await expect(insert("[]", null)).rejects.toMatchObject({ code: "23514" });
    await expect(insert("[]", jws)).rejects.toMatchObject({ code: "23514" });
    await expect(insert('"text"', jws)).rejects.toMatchObject({ code: "23514" });
    await expect(
      insert(JSON.stringify({ pad: "x".repeat(INBOX_ORIGINAL_MAX_OCTETS) }), jws),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("the original is written once: no principal and no migration identity may change it", async () => {
    const i = inbox("mapped");
    const o = original("o_once", 1);
    await i.receive(connector(), mapped(o), { jws: await sign(o), original: o });
    const p = original("o_once", 2);
    // Received signed over itself, with no original.
    await i.receive(connector(), mapped(p), { jws: await sign(mapped(p)) });
    for (const [id, value] of [
      [o.id, null],
      [o.id, { ...o, data: {} }],
      [p.id, p],
    ] as const) {
      expect(
        await code(
          asRw(
            connector(),
            "update mapped.eco_inbox set original = $2::jsonb where event_id = $1 returning event_id",
            [id, value === null ? null : JSON.stringify(value)],
          ),
        ),
      ).toBe("42501");
    }
    await expect(
      db.admin.query("update mapped.eco_inbox set original = null where event_id = $1", [o.id]),
    ).rejects.toMatchObject({ code: "42501" });
    expect((await row("mapped", o.id))?.original).toEqual(o);
    expect((await row("mapped", p.id))?.original).toBeNull();
    // The inbox's own updates (state, attempts) still work on a row with an original.
    await i.drain(connector(), async () => {});
    expect((await i.list(connector(), SOURCE, "o_once")).map((x) => x.state)).toEqual([
      "processed",
      "processed",
    ]);
  });

  it("a redelivery answers duplicate with the original stored first", async () => {
    const i = inbox("mapped");
    const o = original("o_redeliver", 1);
    const m = mapped(o);
    const first = await sign(o);
    await i.receive(connector("tnt_od"), m, { jws: first, original: o });
    // A fresh JWS over the same original.
    expect(await i.receive(connector("tnt_od"), m, { jws: await sign(o), original: o })).toEqual({
      outcome: "duplicate",
      eventId: o.id,
      jws: first,
      original: o,
      originalSigned: true,
    });
    // The very same JWS again: its `jti` is claimed, but this event holds it.
    expect(await i.receive(connector("tnt_od"), m, { jws: first, original: o })).toEqual({
      outcome: "duplicate",
      eventId: o.id,
      jws: first,
      original: o,
      originalSigned: true,
    });
    // A redelivery mapped again with other `data` keeps what was stored first.
    const remapped = { ...o, data: { status: "S9" } };
    expect(
      await i.receive(connector("tnt_od"), remapped, { jws: await sign(o), original: o }),
    ).toMatchObject({ outcome: "duplicate", original: o });
    expect(await row("mapped", o.id)).toEqual({ jws: first, original: o });
  });

  it("an inbox that is not restricted reads `original` like any other column", async () => {
    const i = inbox("mapped");
    const o = original("o_open", 1);
    const jws = await sign(o);
    await i.receive(connector(), mapped(o), { jws, original: o });
    const sql = "select original from mapped.eco_inbox where event_id = $1";
    expect(await asRo(maker(), sql, [o.id])).toEqual([{ original: o }]);
    expect(await asRw(maker(), sql, [o.id])).toEqual([{ original: o }]);
    expect(await i.originalOf(maker(), SOURCE, o.id)).toEqual(o);
    expect(await i.originalOf(as("tnt_o", []), SOURCE, o.id)).toEqual(o);
    expect(await i.originalOf(maker("tnt_ob"), SOURCE, o.id)).toBeNull();
    expect(await asRo(maker("tnt_ob"), sql, [o.id])).toEqual([]);
  });

  it("@IPB-02-12 restricted: original and select * are refused to app_ro and app_rw; readers use the definer", async () => {
    const i = inbox("guardedo");
    const o = original("go_cols", 1);
    const jws = await sign(o);
    expect(await i.receive(connector(), mapped(o), { jws, original: o })).toEqual({
      outcome: "accepted",
      eventId: o.id,
      jws,
      original: o,
      originalSigned: true,
    });
    for (const c of [maker(), connector(), as("tnt_o", ["UDF_SECURITY"])]) {
      for (const sql of [
        "select original from guardedo.eco_inbox where event_id = $1",
        "select * from guardedo.eco_inbox where event_id = $1",
      ]) {
        expect(await code(asRo(c, sql, [o.id])), sql).toBe("42501");
        expect(await code(asRw(c, sql, [o.id])), sql).toBe("42501");
      }
    }
    const viaDefiner = "select tenancy.eco_inbox_original('guardedo', $1, $2) as original";
    expect(await code(asRo(maker(), viaDefiner, [SOURCE, o.id]))).toBe("42501");
    expect(await code(asRw(maker(), viaDefiner, [SOURCE, o.id]))).toBe("42501");
    const refusal = await i.originalOf(maker(), SOURCE, o.id).then(
      () => null,
      (x: { code?: string; httpStatus?: number; meta?: unknown }) => x,
    );
    expect(refusal).toMatchObject({ code: INBOX_JWS_REFUSED, meta: { reason: "jws_reader" } });
    expect(refusal?.httpStatus).toBe(403);
    for (const role of READERS) {
      expect(await i.originalOf(as("tnt_o", ["ORG_MEMBER", role]), SOURCE, o.id), role).toEqual(o);
      expect(await asRo(as("tnt_o", [role]), viaDefiner, [SOURCE, o.id]), role).toEqual([
        { original: o },
      ]);
    }
    // The same roles in another tenant find nothing.
    expect(await i.originalOf(as("tnt_ob", ["UDF_LENDER_CONTROLLER"]), SOURCE, o.id)).toBeNull();
    expect(await asRo(as("tnt_ob", ["UDF_SECURITY"]), viaDefiner, [SOURCE, o.id])).toEqual([
      { original: null },
    ]);
    expect(await i.originalOf(as("tnt_o", ["UDF_LENDER_AUDITOR"]), SOURCE, uuidv7())).toBeNull();
    // list leaves it out for a non-reader, as it does the JWS; the drain hands it to the connector.
    const forOthers = await i.list(maker(), SOURCE, "go_cols");
    expect(forOthers.every((x) => !("original" in x) && !("jws" in x))).toBe(true);
    expect((await i.list(as("tnt_o", ["UDF_SECURITY"]), SOURCE, "go_cols"))[0]).toMatchObject({
      original: o,
    });
    const got: InboxEvent[] = [];
    await i.drain(connector(), async (_tx, ev) => void got.push(ev));
    expect(got.filter((g) => g.eventId === o.id).map((g) => g.original)).toEqual([o]);
    // A connector without a reader role fails closed on a redelivery's re-read.
    expect(await code(i.receive(maker(), mapped(o), { jws: await sign(o), original: o }))).toBe(
      "42501",
    );
    // Reads are not ledgered.
    expect(audit.entries.filter((a) => a.resourceId === o.id).map((a) => a.action)).toEqual([
      "guardedo.eco_inbox.receive",
      "guardedo.eco_inbox.process",
    ]);
  });

  it("tenancy 0029 adds the column once, and a restricted inbox never grants it", async () => {
    await db.admin.query("create schema legacyo");
    await db.admin.query("grant usage on schema legacyo to app_rw, app_ro");
    await db.admin.query("select tenancy.create_ecosystem_inbox('legacyo')");
    await db.admin.query(
      "select tenancy.restrict_ecosystem_inbox_jws('legacyo', array['UDF_SECURITY'])",
    );
    // An inbox as tenancy 0028 left it: restricted, without the column.
    await db.admin.query("drop trigger eco_inbox_original_once on legacyo.eco_inbox");
    await db.admin.query("alter table legacyo.eco_inbox drop column original");
    await db.admin.query("select tenancy.add_ecosystem_inbox_original('legacyo')");
    await db.admin.query("select tenancy.add_ecosystem_inbox_original('legacyo')");
    const t = `'legacyo.eco_inbox'::regclass`;
    const r = await db.admin.query(
      `select (select count(*)::int from pg_attribute where attrelid = ${t} and attname = 'original' and not attisdropped) as cols,
              (select count(*)::int from pg_constraint where conrelid = ${t} and conname like 'eco_inbox_original_%') as checks,
              (select count(*)::int from pg_trigger where tgrelid = ${t} and tgname = 'eco_inbox_original_once') as triggers,
              col_description(${t}, (select attnum from pg_attribute where attrelid = ${t} and attname = 'original' and not attisdropped)::int) as tag`,
    );
    expect(r.rows[0]).toEqual({ cols: 1, checks: 2, triggers: 1, tag: "dataclass:REGULATED" });
    const sql = "select original from legacyo.eco_inbox";
    // Before and after the grants are refreshed, app_rw and app_ro cannot select the new column.
    expect(await code(asRo(maker(), sql))).toBe("42501");
    await db.admin.query("select tenancy.refresh_ecosystem_inbox_jws_grants()");
    expect(await code(asRo(maker(), sql))).toBe("42501");
    expect(await code(asRw(maker(), sql))).toBe("42501");
    expect(await asRo(maker(), "select event_id from legacyo.eco_inbox")).toEqual([]);
    const granted = await db.admin.query(
      `select distinct column_name from information_schema.column_privileges
        where table_schema = 'legacyo' and table_name = 'eco_inbox' and privilege_type = 'SELECT'
          and grantee in ('app_rw', 'app_ro') and column_name in ('jws', 'original')`,
    );
    expect(granted.rows).toEqual([]);
    const refused = (q: string) =>
      db.admin.query(q).then(
        () => null,
        (x: { code?: string }) => x.code,
      );
    expect(await refused("select tenancy.add_ecosystem_inbox_original('missing_schema')")).toBe(
      "42P01",
    );
    expect(await refused("select tenancy.add_ecosystem_inbox_original('Legacyo')")).toBe("22023");
    expect(await refused("select tenancy.eco_inbox_original('missing_schema', 'a', 'b')")).toBe(
      "42P01",
    );
    // The migration functions are the migration identity's only.
    for (const q of [
      "select tenancy.add_ecosystem_inbox_original('legacyo')",
      "select tenancy.eco_inbox_jws_column_grants('legacyo')",
    ]) {
      expect(await code(asRo(maker(), q)), q).toBe("42501");
      expect(await code(asRw(maker(), q)), q).toBe("42501");
    }
    await db.admin.query("delete from tenancy.eco_inbox_jws_reader where schema_name = 'legacyo'");
    await db.admin.query("drop schema legacyo cascade");
  });

  it("R1-D-283 tenancy 0030 retags the original REGULATED, on new inboxes and on those 0029 tagged INTERNAL", async () => {
    const tagOf = async (schema: string): Promise<unknown> => {
      const r = await db.admin.query(
        `select col_description(c.oid, a.attnum::int) as tag
           from pg_attribute a join pg_class c on c.oid = a.attrelid
          where c.oid = '${schema}.eco_inbox'::regclass and a.attname = 'original'`,
      );
      return r.rows[0]?.tag;
    };
    await db.admin.query("create schema retagnew");
    await db.admin.query("select tenancy.create_ecosystem_inbox('retagnew')");
    expect(await tagOf("retagnew")).toBe("dataclass:REGULATED");
    // Two inboxes as tenancy 0029 left them, one restricted; and one a product retagged itself.
    for (const s of ["retaga", "retagb", "retagc"]) {
      await db.admin.query(`create schema ${s}`);
      await db.admin.query(`select tenancy.create_ecosystem_inbox('${s}')`);
    }
    await db.admin.query(
      "select tenancy.restrict_ecosystem_inbox_jws('retagb', array['UDF_SECURITY'])",
    );
    for (const s of ["retaga", "retagb"])
      await db.admin.query(`comment on column ${s}.eco_inbox.original is 'dataclass:INTERNAL'`);
    await db.admin.query("comment on column retagc.eco_inbox.original is 'dataclass:RESTRICTED'");
    const sql = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        "../migrations/0030_ecosystem_inbox_original_regulated.sql",
      ),
      "utf8",
    );
    const loop = sql.slice(sql.indexOf("do $$"));
    await db.admin.query(loop);
    expect(await tagOf("retaga")).toBe("dataclass:REGULATED");
    expect(await tagOf("retagb")).toBe("dataclass:REGULATED");
    // Only INTERNAL is corrected: a stricter class a product chose stays.
    expect(await tagOf("retagc")).toBe("dataclass:RESTRICTED");
    // The restricted inbox's grants are untouched: app_ro still cannot select the column.
    expect(await code(asRo(maker(), "select original from retagb.eco_inbox"))).toBe("42501");
    await db.admin.query("delete from tenancy.eco_inbox_jws_reader where schema_name = 'retagb'");
    await db.admin.query("drop schema retagnew, retaga, retagb, retagc cascade");
  });

  it("@IPB-02-12 the RLS lint passes with the original's definer allow-listed", async () => {
    expect(await lintRls(db.admin, { schemas: ["tenancy", "mapped", "guardedo"] })).toEqual([]);
  });
});

describe("@IPB-02-19 an unsigned partner original in the inbox (Udofin PR-UDF-085, R1-D-288, tenancy/0033)", () => {
  it("keeps an unsigned original, REGULATED and written once, and every reader says it is unsigned", async () => {
    const i = inbox("mapped");
    const o = original("u_first", 1, { status: "APPROVED" });
    const m = mapped(o);
    expect(await i.receive(connector("tnt_un"), m, { original: o })).toEqual({
      outcome: "accepted",
      eventId: o.id,
      jws: null,
      original: o,
      originalSigned: false,
    });
    expect(await row("mapped", o.id)).toEqual({ jws: null, original: o });
    // The ledger says an unsigned original was kept, never what it holds, and claims no signature.
    const led = audit.entries.filter((a) => a.resourceId === o.id && a.action.endsWith("receive"));
    expect(led.at(-1)?.after).toMatchObject({
      outcome: "accepted",
      original: true,
      original_signed: false,
    });
    expect(led.at(-1)?.after).not.toHaveProperty("signed");
    expect(led.at(-1)?.after).not.toHaveProperty("kid");
    expect(JSON.stringify(led)).not.toContain("APPROVED");
    const got: InboxEvent[] = [];
    await i.drain(connector("tnt_un"), async (_tx, ev) => void got.push(ev));
    expect(got.map((g) => [g.jws, g.original, g.originalSigned])).toEqual([[null, o, false]]);
    expect((await i.list(maker("tnt_un"), SOURCE, "u_first"))[0]).toMatchObject({
      jws: null,
      original: o,
      originalSigned: false,
    });
    expect(await i.originalOf(maker("tnt_un"), SOURCE, o.id)).toEqual(o);
    expect(await i.originalRecordOf(maker("tnt_un"), SOURCE, o.id)).toEqual({
      original: o,
      signed: false,
    });
    expect(await i.originalRecordOf(maker("tnt_un"), SOURCE, uuidv7())).toBeNull();
    // A signed one says so.
    const s = original("u_signed", 1);
    await i.receive(connector("tnt_un"), mapped(s), { jws: await sign(s), original: s });
    expect(await i.originalRecordOf(maker("tnt_un"), SOURCE, s.id)).toEqual({
      original: s,
      signed: true,
    });
    // Written once, and an unsigned original never later looks signed: neither column changes.
    for (const set of [`original = '{"x":1}'::jsonb`, "jws = 'aaaa..bbbb'"])
      await expect(
        db.admin.query(`update mapped.eco_inbox set ${set} where event_id = $1`, [o.id]),
      ).rejects.toMatchObject({ code: "42501" });
  });

  it("checks an unsigned original against the mapped event before storing anything", async () => {
    const i = inbox("mapped");
    const o = original("u_check", 1);
    const refused = async (orig: unknown, reason: string) => {
      await expect(
        i.receive(connector("tnt_un"), mapped(o), { original: orig }),
      ).rejects.toMatchObject({
        code: "IPB-API-018",
        meta: { reason },
      });
      expect(await row("mapped", o.id)).toBeUndefined();
    };
    await refused({ ...o, subject: "u_other" }, "original-mismatch");
    await refused({ nope: true }, "original-malformed");
    await refused(
      { ...o, data: { pad: "x".repeat(INBOX_ORIGINAL_MAX_OCTETS) } },
      "original-too-long",
    );
  });

  it("a redelivery answers duplicate with the original stored first, never upgraded to signed", async () => {
    const i = inbox("mapped");
    const o = original("u_dup", 1);
    await i.receive(connector("tnt_ud"), mapped(o), { original: o });
    expect(await i.receive(connector("tnt_ud"), mapped(o), { original: o })).toEqual({
      outcome: "duplicate",
      eventId: o.id,
      jws: null,
      original: o,
      originalSigned: false,
    });
    expect(
      await i.receive(connector("tnt_ud"), mapped(o), { jws: await sign(o), original: o }),
    ).toMatchObject({ outcome: "duplicate", jws: null, original: o, originalSigned: false });
    expect(await row("mapped", o.id)).toEqual({ jws: null, original: o });
  });

  it("@IPB-02-12 on a restricted inbox an unsigned original has the JWS's reader roles", async () => {
    const i = inbox("guardedo");
    const o = original("u_guard", 1);
    await i.receive(connector(), mapped(o), { original: o });
    expect(await code(asRo(maker(), "select original from guardedo.eco_inbox"))).toBe("42501");
    await expect(i.originalRecordOf(maker(), SOURCE, o.id)).rejects.toMatchObject({
      code: INBOX_JWS_REFUSED,
      meta: { reason: "jws_reader" },
    });
    for (const role of READERS)
      expect(
        await i.originalRecordOf(as("tnt_o", ["ORG_MEMBER", role]), SOURCE, o.id),
        role,
      ).toEqual({
        original: o,
        signed: false,
      });
  });

  it("tenancy 0033 drops 0029's original-with-JWS check from existing inboxes, and new ones never get it", async () => {
    const checks = async (schema: string): Promise<string[]> =>
      (
        await db.admin.query<{ conname: string }>(
          `select conname from pg_constraint
            where conrelid = '${schema}.eco_inbox'::regclass and conname like 'eco_inbox_original_%'
            order by conname`,
        )
      ).rows.map((r) => r.conname);
    await db.admin.query("create schema unsnew");
    await db.admin.query("select tenancy.create_ecosystem_inbox('unsnew')");
    expect(await checks("unsnew")).toEqual([
      "eco_inbox_original_object",
      "eco_inbox_original_size",
    ]);
    // An inbox as tenancy 0029 left it, holding a signed row: the check goes, the row stays.
    await db.admin.query("create schema unsold");
    await db.admin.query("select tenancy.create_ecosystem_inbox('unsold')");
    await db.admin.query(
      "alter table unsold.eco_inbox add constraint eco_inbox_original_with_jws check (original is null or jws is not null)",
    );
    await db.admin.query(
      `insert into unsold.eco_inbox (tenant_id, source, event_id, type, subject, seq, envelope, jws, original)
       values ('tnt_o', $1, $2, 'in.infrabyx.servicing.LoanStatusChanged.v1', 'u_old', 1, '{}', 'aaaa..bbbb', '{"a":1}')`,
      [SOURCE, uuidv7()],
    );
    const sql = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        "../migrations/0033_ecosystem_inbox_unsigned_original.sql",
      ),
      "utf8",
    );
    await db.admin.query(sql.slice(sql.lastIndexOf("do $$")));
    expect(await checks("unsold")).toEqual([
      "eco_inbox_original_object",
      "eco_inbox_original_size",
    ]);
    const kept = await db.admin.query("select jws, original from unsold.eco_inbox");
    expect(kept.rows).toEqual([{ jws: "aaaa..bbbb", original: { a: 1 } }]);
    await db.admin.query("drop schema unsnew, unsold cascade");
  });
});
