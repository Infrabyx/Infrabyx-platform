// A narrower read grant on an inbox's JWS (Udofin PR-UDF-084; R1-D-280; tenancy/0028): a product's
// migration names the roles that may read `<schema>.eco_inbox.jws`; app_rw and app_ro then select
// every other column only, and the JWS is read through `tenancy.eco_inbox_jws`, which checks the
// kernel-set `app.roles` and the row's tenant. The rest of the row keeps its forced RLS.
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
import { EcosystemInbox, INBOX_JWS_REFUSED, type InboxEvent } from "./eco-inbox.js";
import { KernelGuardError } from "./errors.js";
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

const SOURCE = "urn:infrabyx:finbyx:tnt_producer";
/** The connector service, the lender's controllers and auditors, the product's security role. */
const READERS = ["SVC_ECO_CONSUMER", "UDF_LENDER_CONTROLLER", "UDF_LENDER_AUDITOR", "UDF_SECURITY"];
const event = (subject: string, seq: number) => ({
  specversion: "1.0",
  id: uuidv7(),
  source: SOURCE,
  type: "in.infrabyx.servicing.LoanStatusChanged.v1",
  subject,
  time: "2026-11-23T12:00:00+05:30",
  datacontenttype: "application/json",
  dataschema: "https://registry.infrabyx.example/schemas/servicing/LoanStatusChanged/1.0.0.json",
  tenantid: "tnt_producer",
  reid: "re_01J8Y2M0PQ",
  productfamily: "PL",
  dataclass: "INTERNAL",
  schemaver: "1.0.0",
  seq,
  data: { status: `S${seq}` },
});

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
const connector = (tenantId = "tnt_g") => as(tenantId, ["SVC_ECO_CONSUMER"], "service");
const maker = (tenantId = "tnt_g") => as(tenantId, ["UDF_LENDER_MAKER", "ORG_MEMBER"]);
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
      await audit.record(tx, { action: "test.read", resourceType: "t", resourceId: "x" });
      return rows;
    },
    { action: "test.read" },
  );
const viaDefiner = "select tenancy.eco_inbox_jws('guarded', $1, $2) as jws";

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "eco-inbox-readers-"));
  writeFileSync(
    join(dir, "0001_inboxes.sql"),
    `create schema plain;
grant usage on schema plain to app_rw, app_ro;
select tenancy.create_ecosystem_inbox('plain');
create schema guarded;
grant usage on schema guarded to app_rw, app_ro;
select tenancy.create_ecosystem_inbox('guarded');
select tenancy.restrict_ecosystem_inbox_jws('guarded', array[${READERS.map((r) => `'${r}'`).join(", ")}]);
`,
  );
  db = await freshDb([TENANCY_SOURCE, { name: "product", dir }]);
  kernel = new PgKernel({ pool: db.pool });
  await db.admin.query(
    `insert into tenancy.tenant (id, product, name)
     select t, 'UDF', t from unnest(array['tnt_g', 'tnt_gb', 'tnt_gf']) as t`,
  );
});
afterAll(async () => db?.end());

describe("R1-D-280 a narrower read grant on an inbox's JWS (PR-UDF-084)", () => {
  it("an inbox not restricted is unchanged: select * and jws for app_ro and app_rw, any role", async () => {
    const i = inbox("plain");
    const e = event("open_jws", 1);
    const jws = await sign(e);
    await i.receive(connector(), e, { jws });
    const sql = "select * from plain.eco_inbox where event_id = $1";
    expect((await asRo(maker(), sql, [e.id]))[0]).toMatchObject({ jws });
    expect((await asRw(maker(), sql, [e.id]))[0]).toMatchObject({ jws });
    expect(await i.jwsOf(maker(), SOURCE, e.id)).toBe(jws);
    expect(await i.jwsOf(as("tnt_g", []), SOURCE, e.id)).toBe(jws);
    expect((await i.list(maker(), SOURCE, "open_jws"))[0]).toMatchObject({ jws });
    const got: InboxEvent[] = [];
    await i.drain(maker(), async (_tx, ev) => void got.push(ev));
    expect(got.map((g) => g.jws)).toEqual([jws]);
  });

  it("@IPB-02-12 restricted: jws and select * are refused to app_ro and app_rw; the other columns read under RLS", async () => {
    const i = inbox("guarded");
    const e = event("g_cols", 1);
    const jws = await sign(e);
    expect(await i.receive(connector(), e, { jws })).toEqual({
      outcome: "accepted",
      eventId: e.id,
      jws,
      original: null,
    });
    // Column privileges bind every principal, readers too: they read through the definer.
    for (const c of [maker(), connector(), as("tnt_g", ["UDF_SECURITY"])]) {
      for (const sql of [
        "select jws from guarded.eco_inbox where event_id = $1",
        "select * from guarded.eco_inbox where event_id = $1",
      ]) {
        expect(await code(asRo(c, sql, [e.id])), sql).toBe("42501");
        expect(await code(asRw(c, sql, [e.id])), sql).toBe("42501");
      }
    }
    const cols = `select tenant_id, source, event_id, type, subject, seq, business_key, envelope, state,
                         attempts, last_error, received_at, parked_at, processed_at
                    from guarded.eco_inbox where event_id = $1`;
    expect(await asRo(maker(), cols, [e.id])).toHaveLength(1);
    expect(await asRw(maker(), cols, [e.id])).toHaveLength(1);
    expect(await asRo(maker("tnt_gb"), cols, [e.id])).toHaveLength(0);
    // The definer refuses a non-reader without the value; the API maps it to the role refusal.
    expect(await code(asRo(maker(), viaDefiner, [SOURCE, e.id]))).toBe("42501");
    expect(await code(asRw(maker(), viaDefiner, [SOURCE, e.id]))).toBe("42501");
    const refusal = await i.jwsOf(maker(), SOURCE, e.id).then(
      () => null,
      (x: { code?: string; httpStatus?: number; meta?: unknown }) => x,
    );
    expect(refusal).toMatchObject({ code: INBOX_JWS_REFUSED, meta: { reason: "jws_reader" } });
    expect(refusal?.httpStatus).toBe(403);
    expect(INBOX_JWS_REFUSED).toBe("IPB-UX-011");
  });

  it("@IPB-02-12 returns the JWS to each registered role in the row's tenant, never another tenant's", async () => {
    const i = inbox("guarded");
    const e = event("g_read", 1);
    const jws = await sign(e);
    await i.receive(connector(), e, { jws });
    for (const role of READERS) {
      expect(await i.jwsOf(as("tnt_g", ["ORG_MEMBER", role]), SOURCE, e.id), role).toBe(jws);
      expect(await asRo(as("tnt_g", [role]), viaDefiner, [SOURCE, e.id]), role).toEqual([{ jws }]);
    }
    // The same roles in another tenant: the explicit tenant filter and RLS find no row there.
    expect(await i.jwsOf(as("tnt_gb", ["UDF_LENDER_CONTROLLER"]), SOURCE, e.id)).toBeNull();
    expect(await asRo(as("tnt_gb", ["UDF_SECURITY"]), viaDefiner, [SOURCE, e.id])).toEqual([
      { jws: null },
    ]);
    expect(await asRw(as("tnt_gb", ["UDF_SECURITY"]), viaDefiner, [SOURCE, e.id])).toEqual([
      { jws: null },
    ]);
    // A role of another form never reaches app.roles, so it reads nothing.
    expect(await code(i.jwsOf(as("tnt_g", ["udf_security", "UDF_SECURITY,"]), SOURCE, e.id))).toBe(
      INBOX_JWS_REFUSED,
    );
    expect(await i.jwsOf(as("tnt_g", ["UDF_LENDER_AUDITOR"]), SOURCE, uuidv7())).toBeNull();
    // A read, so nothing is ledgered.
    expect(audit.entries.filter((a) => a.resourceId === e.id).map((a) => a.action)).toEqual([
      "guarded.eco_inbox.receive",
    ]);
  });

  it("receive then drain still hands the handler its JWS; list shows it to readers only", async () => {
    // A tenant of its own, so the drains below see only this subject.
    const t = "tnt_gf";
    const i = inbox("guarded");
    const e = event("g_flow", 1);
    const u = event("g_flow", 2);
    const jws = await sign(e);
    await i.receive(connector(t), e, { jws });
    await i.receive(connector(t), u);
    // A redelivery re-reads the stored JWS through the definer.
    expect(await i.receive(connector(t), e, { jws: await sign(e) })).toEqual({
      outcome: "duplicate",
      eventId: e.id,
      jws,
      original: null,
    });
    // A connector without a reader role fails closed on the re-read and on the handler's event.
    expect(await code(i.receive(maker(t), e, { jws: await sign(e) }))).toBe("42501");
    const none: InboxEvent[] = [];
    expect(await i.drain(maker(t), async (_tx, ev) => void none.push(ev))).toMatchObject({
      processed: 0,
      failed: 1,
    });
    expect(none).toEqual([]);
    const got: InboxEvent[] = [];
    expect(await i.drain(connector(t), async (_tx, ev) => void got.push(ev))).toMatchObject({
      processed: 2,
      failed: 0,
    });
    expect(got.map((g) => [g.seq, g.jws])).toEqual([
      [1, jws],
      [2, null],
    ]);
    const forReader = await i.list(as(t, ["UDF_LENDER_AUDITOR"]), SOURCE, "g_flow");
    expect(forReader.map((x) => [x.state, x.attempts, x.jws])).toEqual([
      ["processed", 1, jws],
      ["processed", 0, null],
    ]);
    const forOthers = await i.list(maker(t), SOURCE, "g_flow");
    expect(forOthers.map((x) => x.state)).toEqual(["processed", "processed"]);
    expect(forOthers.every((x) => !("jws" in x))).toBe(true);
  });

  it("the JWS stays written once in a restricted inbox", async () => {
    const i = inbox("guarded");
    const e = event("g_once", 1);
    const jws = await sign(e);
    await i.receive(connector(), e, { jws });
    for (const c of [connector(), as("tnt_g", ["UDF_SECURITY"])])
      expect(
        await code(
          asRw(
            c,
            "update guarded.eco_inbox set jws = null where event_id = $1 returning event_id",
            [e.id],
          ),
        ),
      ).toBe("42501");
    await expect(
      db.admin.query("update guarded.eco_inbox set jws = null where event_id = $1", [e.id]),
    ).rejects.toMatchObject({ code: "42501" });
    expect(await i.jwsOf(connector(), SOURCE, e.id)).toBe(jws);
  });

  it("@IPB-02-AT-04 app.roles comes from the verified context only; callback SQL cannot set it", async () => {
    for (const sql of [
      "select set_config('app.roles', 'UDF_SECURITY', true)",
      "set local app.roles = 'UDF_SECURITY'",
    ]) {
      await expect(asRo(maker(), sql)).rejects.toBeInstanceOf(KernelGuardError);
      expect(await code(asRw(maker(), sql))).toBe("KernelGuardError");
    }
    const c = as("tnt_g", [
      "UDF_SECURITY",
      "FN:CRO",
      "UDF_SECURITY",
      "not a role",
      "UDF_A,UDF_SECURITY",
      `UDF_${"X".repeat(130)}`,
    ]);
    const sql = "select current_setting('app.roles', true) as roles";
    expect(await asRo(c, sql)).toEqual([{ roles: "UDF_SECURITY,FN:CRO" }]);
    expect(await asRw(c, sql)).toEqual([{ roles: "UDF_SECURITY,FN:CRO" }]);
    expect(await asRo(as("tnt_g", []), sql)).toEqual([{ roles: "" }]);
  });

  it("restrict_ecosystem_inbox_jws is idempotent, replaces the readers and refreshes the grants", async () => {
    await db.admin.query("create schema guarded2");
    await db.admin.query("grant usage on schema guarded2 to app_rw, app_ro");
    await db.admin.query("select tenancy.create_ecosystem_inbox('guarded2')");
    const restrict = (roles: string[]) =>
      db.admin.query("select tenancy.restrict_ecosystem_inbox_jws('guarded2', $1::text[])", [
        roles,
      ]);
    await restrict(["UDF_SECURITY", "UDF_SECURITY"]);
    await restrict(["UDF_SECURITY"]);
    await restrict(["UDF_LENDER_AUDITOR", "FN:CRO"]);
    const readers = await db.admin.query(
      "select role from tenancy.eco_inbox_jws_reader where schema_name = 'guarded2' order by role",
    );
    expect(readers.rows.map((r) => r.role)).toEqual(["FN:CRO", "UDF_LENDER_AUDITOR"]);
    const i = inbox("guarded2");
    const e = event("g2", 1);
    const jws = await sign(e);
    await i.receive(as("tnt_g", ["UDF_LENDER_AUDITOR"], "service"), e, { jws });
    expect(await code(i.jwsOf(as("tnt_g", ["UDF_SECURITY"]), SOURCE, e.id))).toBe(
      INBOX_JWS_REFUSED,
    );
    expect(await i.jwsOf(as("tnt_g", ["FN:CRO"]), SOURCE, e.id)).toBe(jws);
    // No table-level SELECT is left on a restricted inbox.
    const tableSelect = async () =>
      (
        await db.admin.query(
          `select grantee from information_schema.role_table_grants
            where table_schema = 'guarded2' and table_name = 'eco_inbox' and privilege_type = 'SELECT'
              and grantee in ('app_rw', 'app_ro')`,
        )
      ).rows;
    expect(await tableSelect()).toEqual([]);
    // A column added later is granted once the grants are refreshed; jws still is not.
    await db.admin.query("alter table guarded2.eco_inbox add column note text");
    const note = "select note from guarded2.eco_inbox where event_id = $1";
    expect(await code(asRo(maker(), note, [e.id]))).toBe("42501");
    await db.admin.query("select tenancy.refresh_ecosystem_inbox_jws_grants()");
    expect(await asRo(maker(), note, [e.id])).toEqual([{ note: null }]);
    expect(
      await code(asRo(maker(), "select jws from guarded2.eco_inbox where event_id = $1", [e.id])),
    ).toBe("42501");
    expect(await tableSelect()).toEqual([]);
    // Refusals: a bad schema or role, no role, a table that is not an inbox.
    const refused = (sql: string, params: unknown[] = []) =>
      db.admin.query(sql, params).then(
        () => null,
        (x: { code?: string }) => x.code,
      );
    const call = "select tenancy.restrict_ecosystem_inbox_jws($1, $2::text[])";
    expect(await refused(call, ["Guarded2", ["UDF_SECURITY"]])).toBe("22023");
    expect(await refused(call, ["guarded2", []])).toBe("22023");
    expect(await refused(call, ["guarded2", ["udf_security"]])).toBe("22023");
    expect(await refused(call, ["guarded2", ["UDF_SECURITY", null]])).toBe("22023");
    expect(await refused(call, ["guarded2", ["UDF_A,UDF_B"]])).toBe("22023");
    expect(await refused(call, ["missing_schema", ["UDF_SECURITY"]])).toBe("42P01");
    await db.admin.query("create schema notinbox");
    await db.admin.query("create table notinbox.eco_inbox (tenant_id text, jws text)");
    expect(await refused(call, ["notinbox", ["UDF_SECURITY"]])).toBe("22023");
    expect(await refused("select tenancy.eco_inbox_jws('notinbox', 'a', 'b')")).toBe("42P01");
    await db.admin.query("drop schema notinbox cascade");
    // The registry and its writers are the migration identity's: app_rw and app_ro get neither.
    for (const sql of [
      "select * from tenancy.eco_inbox_jws_reader",
      "select tenancy.restrict_ecosystem_inbox_jws('guarded2', array['UDF_X'])",
      "select tenancy.refresh_ecosystem_inbox_jws_grants()",
      "select tenancy.eco_inbox_jws_column_grants('guarded2')",
    ]) {
      expect(await code(asRo(maker(), sql)), sql).toBe("42501");
      expect(await code(asRw(maker(), sql)), sql).toBe("42501");
    }
    await db.admin.query("delete from tenancy.eco_inbox_jws_reader where schema_name = 'guarded2'");
    await db.admin.query("drop schema guarded2 cascade");
  });

  it("@IPB-02-12 the RLS lint passes with the two definers allow-listed", async () => {
    expect(await lintRls(db.admin, { schemas: ["tenancy", "plain", "guarded"] })).toEqual([]);
  });
});
