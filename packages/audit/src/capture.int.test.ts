// Statutory audit capture on PostgreSQL (PR-FBX-10 item 2; R1-D-25; audit/0003): every insert,
// update and delete on a registered table is captured with its values and context, chained per
// tenant and verified in TypeScript; nobody but the capture function can write it; the guard
// refuses every way of switching it off; and the daily anchor signs its head.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { KernelContext } from "@infrabyx/contracts/kernel";
import type { ObjectMeta, StoragePort } from "@infrabyx/contracts/ports";
import { LOCAL_KMS_KEYS, LocalKms, localDevKey } from "@infrabyx/crypto";
import { PgKernel } from "@infrabyx/tenancy";
import { lintRls } from "@infrabyx/tenancy/rls-lint";
import { StatutoryCapture, verifyCaptureChain } from "./capture.js";
import { AuditService, verifyCaptureAgainstAnchor, type AnchorFile } from "./service.js";
import { PgAuditSink } from "./sink.js";
import { freshDb } from "./__tests__/db.js";

class MemoryStorage {
  readonly objects = new Map<string, { body: Uint8Array }>();
  async putWithRetention(key: string, body: Uint8Array, _r: Date, _m: ObjectMeta): Promise<void> {
    this.objects.set(key, { body });
  }
}

let db: Awaited<ReturnType<typeof freshDb>>;
let kernel: PgKernel;
const sink = new PgAuditSink({ pseudonymKey: localDevKey(LOCAL_KMS_KEYS.auditPseudonym) });
const kms = new LocalKms();
let svc: AuditService;
let capture: StatutoryCapture;
const ctx = (tenantId: string, over: Partial<KernelContext> = {}): KernelContext => ({
  tenantId,
  principal: { id: "usr_acct", type: "user", roles: ["ORG_ADMIN"] },
  traceId: "trace-1",
  entityId: "ent_books",
  ...over,
});

beforeAll(async () => {
  db = await freshDb();
  kernel = new PgKernel({ pool: db.pool });
  svc = new AuditService({
    kernel,
    sink,
    product: "FBX",
    storage: new MemoryStorage() as unknown as StoragePort,
    kms,
    anchorKeyId: LOCAL_KMS_KEYS.anchorSigning,
  });
  capture = new StatutoryCapture({ kernel, batch: 7 });
  // A product's books-of-account table, registered as its migration would.
  await db.admin.query(`
    create schema books;
    grant usage on schema books to app_rw, app_ro;
    create table books.journal_line (
      id text primary key, tenant_id text not null, account text not null, amount numeric not null
    );
    alter table books.journal_line enable row level security;
    alter table books.journal_line force row level security;
    create policy journal_line_tenant on books.journal_line for all
      using (tenant_id = current_setting('app.tenant_id', true))
      with check (tenant_id = current_setting('app.tenant_id', true));
    grant select, insert, update, delete on books.journal_line to app_rw;
    select audit.register_capture('books.journal_line');
  `);
});
afterAll(async () => db?.end());

const post = (c: KernelContext, sql: string, params: unknown[], reason?: string) =>
  kernel.mutate(
    c,
    async (tx) => {
      await tx.query(sql, params);
      await sink.record(tx, {
        action: "books.journal.post",
        resourceType: "journal",
        resourceId: "j1",
      });
    },
    { action: "books.journal.post", ...(reason !== undefined ? { reason } : {}) },
  );

describe("@IPB-02-51 statutory audit capture (audit/0003, R1-D-25)", () => {
  it("captures insert, update and delete with before and after values, the actor, the database login and role, the transaction and the reason", async () => {
    const c = ctx("tnt_books");
    await post(c, "insert into books.journal_line values ('l1', 'tnt_books', '1001', 100)", []);
    await post(c, "update books.journal_line set amount = 120 where id = 'l1'", [], "rounding fix");
    await post(c, "delete from books.journal_line where id = 'l1'", []);
    const rows = await capture.query(c);
    expect(rows.map((r) => r.op)).toEqual(["insert", "update", "delete"]);
    const [ins, upd, del] = rows;
    expect(JSON.parse(ins!.after_values!)).toMatchObject({ id: "l1", amount: 100 });
    expect(ins!.before_values).toBeNull();
    expect(JSON.parse(upd!.before_values!).amount).toBe(100);
    expect(JSON.parse(upd!.after_values!).amount).toBe(120);
    expect(del!.after_values).toBeNull();
    expect(JSON.parse(ins!.row_key)).toEqual({ id: "l1" });
    expect(upd).toMatchObject({
      table_name: "books.journal_line",
      actor_id: "usr_acct",
      entity_id: "ent_books",
      trace_id: "trace-1",
      action: "books.journal.post",
      reason: "rounding fix",
      db_role: "app_rw",
    });
    expect(upd!.db_user.length).toBeGreaterThan(0);
    expect(Number(upd!.txid)).toBeGreaterThan(0);
    expect(new Set(rows.map((r) => r.txid)).size).toBe(3);
    expect(await svc.verifyCapture(c)).toMatchObject({ ok: true, checked: 3, problems: [] });
    // A reason is 1 to 500 characters, checked before the transaction starts.
    await expect(post(c, "select 1", [], "")).rejects.toThrow(RangeError);
    await expect(post(c, "select 1", [], "x".repeat(501))).rejects.toThrow(RangeError);
  });

  it("chains per tenant and verifies in batches; another tenant sees none of it", async () => {
    for (let i = 0; i < 20; i++)
      await post(
        ctx("tnt_two"),
        "insert into books.journal_line values ($1, 'tnt_two', '2001', $2)",
        [`m${i}`, i],
      );
    const r = await capture.verify(ctx("tnt_two"));
    expect(r).toMatchObject({ ok: true, checked: 20, head: { seq: 20 } });
    expect((await capture.query(ctx("tnt_books"))).every((x) => x.tenant_id === "tnt_books")).toBe(
      true,
    );
    expect(verifyCaptureChain(await capture.query(ctx("tnt_two"), { limit: 50 })).ok).toBe(true);
  });

  it("is append-only for everyone: the application cannot write, change or delete it, nor become its owner", async () => {
    const c = ctx("tnt_books");
    for (const sql of [
      "insert into audit.capture (tenant_id) values ('tnt_books')",
      "update audit.capture set reason = 'x'",
      "delete from audit.capture",
      "update audit.capture_head set seq = 0",
      "set local role capture_writer",
    ])
      await expect(
        kernel.mutate(c, async (tx) => {
          await tx.query(sql, []);
          await sink.record(tx, { action: "test.tamper.try", resourceType: "x", resourceId: "x" });
        }),
      ).rejects.toThrow();
    for (const sql of [
      "update audit.capture set reason = 'x'",
      "delete from audit.capture",
      "truncate audit.capture",
    ])
      await expect(db.admin.query(sql)).rejects.toThrow(/append-only/);
    await expect(
      post(c, "truncate books.journal_line", []).catch(async () => {
        throw new Error("refused");
      }),
    ).rejects.toThrow();
    await expect(db.admin.query("truncate books.journal_line")).rejects.toThrow(/TRUNCATE/);
  });

  it("cannot be disabled: the guard refuses dropping or disabling triggers, replacing the owner and dropping the table", async () => {
    for (const sql of [
      "drop trigger ipb_capture on books.journal_line",
      "alter table books.journal_line disable trigger ipb_capture",
      "alter table books.journal_line enable trigger ipb_capture",
      "alter table books.journal_line disable trigger all",
      "alter table audit.capture disable trigger capture_no_update",
      "drop trigger capture_no_update on audit.capture",
      "alter function audit.capture_row() owner to app_migrate",
      "drop function audit.capture_row() cascade",
      "drop table books.journal_line",
      "drop table audit.capture",
      "drop schema books cascade",
    ])
      await expect(db.admin.query(sql), sql).rejects.toThrow(/cannot be disabled/);
    // Ordinary schema changes still work, and the capture follows them.
    await db.admin.query("alter table books.journal_line add column memo text");
    await post(
      ctx("tnt_books"),
      "insert into books.journal_line values ('l2', 'tnt_books', '1002', 5, 'm')",
      [],
    );
    expect(JSON.parse((await capture.query(ctx("tnt_books"))).at(-1)!.after_values!).memo).toBe(
      "m",
    );
    expect(await svc.verifyCapture(ctx("tnt_books"))).toMatchObject({ ok: true, problems: [] });
  });

  it("registration needs tenant_id and forced RLS; a registered table is registered once", async () => {
    await db.admin.query("create table books.no_tenant (id text primary key)");
    await expect(
      db.admin.query("select audit.register_capture('books.no_tenant')"),
    ).rejects.toThrow(/tenant_id/);
    await db.admin.query("create table books.no_rls (id text primary key, tenant_id text)");
    await expect(db.admin.query("select audit.register_capture('books.no_rls')")).rejects.toThrow(
      /row-level security/,
    );
    await db.admin.query("select audit.register_capture('books.journal_line')");
    const n = await db.admin.query("select count(*)::int as n from audit.capture_table");
    expect(n.rows[0].n).toBe(1);
    await db.admin.query("drop table books.no_tenant, books.no_rls");
  });

  it("the gap detector reports a changed row, and a disabled guard", async () => {
    const c = ctx("tnt_tamper");
    for (let i = 0; i < 5; i++)
      await post(c, "insert into books.journal_line values ($1, 'tnt_tamper', '3001', 1)", [
        `t${i}`,
      ]);
    expect((await svc.verifyCapture(c)).ok).toBe(true);
    // Replica mode does not help: the refusal fires always.
    await db.admin.query("set session_replication_role = replica");
    await expect(
      db.admin.query("update audit.capture set reason = 'x' where tenant_id = 'tnt_tamper'"),
    ).rejects.toThrow(/append-only/);
    await db.admin.query("set session_replication_role = origin");
    // Only a superuser who first switches the guard off can touch a row; the chain still shows it.
    await db.admin.query("alter event trigger ipb_capture_guard_ddl disable");
    try {
      await db.admin.query("alter table audit.capture disable trigger capture_no_update");
      await db.admin.query(
        "update audit.capture set after_values = jsonb_set(after_values, '{amount}', '9') where tenant_id = 'tnt_tamper' and seq = 3",
      );
      await db.admin.query("alter table audit.capture enable always trigger capture_no_update");
    } finally {
      await db.admin.query("alter event trigger ipb_capture_guard_ddl enable");
    }
    expect((await svc.verifyCapture(c)).break).toEqual({ seq: 3, reason: "hash-mismatch" });
    const ledger = await db.admin.query(
      "select count(*)::int as n from audit.ledger where tenant_id = 'tnt_tamper' and action = 'audit.capture.break_detected'",
    );
    expect(ledger.rows[0].n).toBe(1);
    await db.admin.query("alter event trigger ipb_capture_guard_ddl disable");
    try {
      const r = await capture.verify(ctx("tnt_two"));
      expect(r.ok).toBe(false);
      expect(r.problems).toEqual(["event trigger ipb_capture_guard_ddl is missing or disabled"]);
    } finally {
      await db.admin.query("alter event trigger ipb_capture_guard_ddl enable");
    }
  });

  it("the daily anchor signs the capture head of the day (format 2), and an auditor verifies against it", async () => {
    const c = ctx("tnt_two");
    const day = new Date().toISOString().slice(0, 10);
    const file: AnchorFile = await svc.writeAnchor(c, day);
    expect(file).toMatchObject({ format: "infrabyx-audit-anchor/2", capture_seq: 20 });
    const pub = await kms.getPublicKey(LOCAL_KMS_KEYS.anchorSigning);
    const entries = await capture.query(c, { limit: 100 });
    expect(verifyCaptureAgainstAnchor(entries, file, pub)).toMatchObject({
      ok: true,
      signatureValid: true,
    });
    const forged = entries.map((e) => (e.seq === 4 ? { ...e, reason: "edited" } : e));
    expect(verifyCaptureAgainstAnchor(forged, file, pub).ok).toBe(false);
    // A tenant with nothing captured keeps format 1.
    expect((await svc.writeAnchor(ctx("tnt_empty"), day)).format).toBe("infrabyx-audit-anchor/1");
  });

  it("rls-lint passes with the capture tables", async () => {
    expect(await lintRls(db.admin, { schemas: ["audit", "books"] })).toEqual([]);
  });
});
