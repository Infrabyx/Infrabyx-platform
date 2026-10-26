import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { KernelContext } from "@infrabyx/contracts/kernel";
import type { ObjectMeta, StoragePort } from "@infrabyx/contracts/ports";
import { LOCAL_KMS_KEYS, LocalKms, localDevKey } from "@infrabyx/crypto";
import { PgKernel, PgOutbox } from "@infrabyx/tenancy";
import { lintRls } from "@infrabyx/tenancy/rls-lint";
import { verifyChain } from "./chain.js";
import { AuditService, verifyAgainstAnchor, verifyAnchorFile, type AnchorFile } from "./service.js";
import { PgAuditSink } from "./sink.js";
import { freshDb } from "./__tests__/db.js";

class MemoryStorage {
  readonly objects = new Map<string, { body: Uint8Array; retainUntil: Date; meta: ObjectMeta }>();
  async putWithRetention(
    key: string,
    body: Uint8Array,
    retainUntil: Date,
    meta: ObjectMeta,
  ): Promise<void> {
    if (this.objects.has(key)) throw new Error("write-once");
    this.objects.set(key, { body, retainUntil, meta });
  }
}

let db: Awaited<ReturnType<typeof freshDb>>;
let kernel: PgKernel;
const sink = new PgAuditSink({ pseudonymKey: localDevKey(LOCAL_KMS_KEYS.auditPseudonym) });
const kms = new LocalKms();
const storage = new MemoryStorage();
let svc: AuditService;
const ctx = (tenantId: string, id = "usr_a"): KernelContext => ({
  tenantId,
  principal: { id, type: "user", roles: ["ORG_ADMIN"] },
  ip: "203.0.113.7",
  userAgent: "vitest",
});

beforeAll(async () => {
  db = await freshDb();
  kernel = new PgKernel({ pool: db.pool });
  svc = new AuditService({
    kernel,
    sink,
    product: "LD",
    outbox: new PgOutbox(),
    storage: storage as unknown as StoragePort,
    kms,
    anchorKeyId: LOCAL_KMS_KEYS.anchorSigning,
  });
});
afterAll(async () => db?.end());

const write = (c: KernelContext, n: number, prefix = "r") =>
  kernel.mutate(c, async (tx) => {
    for (let i = 0; i < n; i++)
      await sink.record(tx, {
        action: "cases.case.update",
        resourceType: "case",
        resourceId: `${prefix}${i}`,
        before: { v: i },
        after: { v: i + 1 },
      });
  });

describe("@IPB-02-AT-15 @NN-02 ledger tamper detection", () => {
  it("a 1,000-entry chain built by the trigger verifies in TypeScript; an altered after_digest is reported at that entry", async () => {
    await write(ctx("tnt_t"), 1000);
    expect(await svc.verify(ctx("tnt_t"))).toMatchObject({ ok: true, checked: 1000 });
    const victim = (
      await db.admin.query("select id from audit.ledger where tenant_id = 'tnt_t' and seq = 500")
    ).rows[0].id as string;
    // Tamper as the database owner with the protecting triggers bypassed.
    await db.admin.query("alter table audit.ledger disable trigger ledger_no_update");
    await db.admin.query("update audit.ledger set after_digest = repeat('f', 64) where id = $1", [
      victim,
    ]);
    await db.admin.query("alter table audit.ledger enable trigger ledger_no_update");
    const r = await svc.verify(ctx("tnt_t"));
    expect(r.ok).toBe(false);
    expect(r.break).toMatchObject({ seq: 500, id: victim, reason: "hash-mismatch" });
    const ev = await db.admin.query(
      "select type, envelope->'data' as data from audit.outbox where tenant_id = 'tnt_t'",
    );
    expect(ev.rows.map((x) => x.type)).toContain("in.ld.security.LedgerChainBroken.v1");
  });
});

describe("append-only, for every role (NN-02)", () => {
  it("refuses UPDATE, DELETE and TRUNCATE for app_rw, app_migrate and the owner", async () => {
    await write(ctx("tnt_u"), 1);
    for (const role of ["app_rw", "app_migrate"]) {
      for (const sql of [
        "update audit.ledger set resource_id = 'x'",
        "delete from audit.ledger",
        "truncate audit.ledger",
      ]) {
        await db.admin.query("begin");
        await db.admin.query(`set local role ${role}`);
        await db.admin.query("select set_config('app.tenant_id', 'tnt_u', true)");
        await expect(db.admin.query(sql), `${role}: ${sql}`).rejects.toThrow();
        await db.admin.query("rollback");
      }
    }
    await expect(db.admin.query("update audit.ledger set resource_id = 'x'")).rejects.toThrow(
      /append-only/,
    );
    await expect(db.admin.query("delete from audit.ledger")).rejects.toThrow(/append-only/);
    await expect(db.admin.query("truncate audit.ledger")).rejects.toThrow(/append-only/);
  });
  it("refuses an entry whose actor differs from the verified context", async () => {
    await expect(
      kernel.mutate(ctx("tnt_u"), async (tx) => {
        await tx.query(
          `insert into audit.ledger (id, tenant_id, seq, actor_id, actor_type, action, resource_type, resource_id, occurred_at, prev_hash, entry_hash)
           values ('led_01J0000000000000000000FAKE', 'tnt_u', 0, 'usr_someone_else', 'user', 'x.y.z', 'x', 'x', now(), repeat('0', 64), repeat('0', 64))`,
        );
        tx.markAudited();
      }),
    ).rejects.toThrow(/row-level security/);
  });
});

describe("@NN-45 concurrency and corrections", () => {
  it("20 concurrent transactions keep one gap-free chain per tenant", async () => {
    await Promise.all(
      Array.from({ length: 20 }, (_, i) => write(ctx("tnt_c", `usr_${i}`), 5, `t${i}-`)),
    );
    const rows = await svc.query(ctx("tnt_c"));
    expect(rows.map((r) => r.seq)).toEqual(Array.from({ length: 100 }, (_, i) => i + 1));
    expect(verifyChain(rows).ok).toBe(true);
  });
  it("corrections are new entries referencing the original and the chain still verifies", async () => {
    const c = ctx("tnt_k");
    const { id } = await kernel.mutate(c, (tx) =>
      sink.record(tx, {
        action: "billing.invoice.issue",
        resourceType: "invoice",
        resourceId: "inv_1",
        after: { amount: 100 },
      }),
    );
    await kernel.mutate(c, (tx) =>
      svc.correct(tx, id, {
        action: "billing.invoice.correct",
        resourceType: "invoice",
        resourceId: "inv_1",
        after: { amount: 110 },
      }),
    );
    const rows = await svc.query(c);
    expect(rows[1]).toMatchObject({ corrects_id: id, seq: 2 });
    expect(rows[0]?.ip_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyChain(rows).ok).toBe(true);
    await expect(
      kernel.mutate(c, (tx) =>
        svc.correct(tx, "led_01J000000000000000000NONE", {
          action: "a.b.c",
          resourceType: "x",
          resourceId: "y",
        }),
      ),
    ).rejects.toThrow(/not found/);
  });
});

describe("signed anchors (IPB-02-51)", () => {
  it("are written with retention, verify with the public key alone, and let a tenant verify its chain", async () => {
    const c = ctx("tnt_n");
    await write(c, 25);
    const today = new Date().toISOString().slice(0, 10);
    const file = await svc.writeAnchor(
      { ...c, principal: { id: "svc_audit", type: "service", roles: ["SVC_AUDIT"] } },
      today,
    );
    expect(file).toMatchObject({
      tenant_id: "tnt_n",
      seq: 25,
      signature: { alg: "ecdsa-p256-sha256" },
    });
    const stored = [...storage.objects.values()].at(-1);
    expect(stored?.meta.bucketClass).toBe("AUDIT");
    expect(stored && stored.retainUntil.getTime() - Date.now()).toBeGreaterThan(2900 * 86_400_000);
    const parsed = JSON.parse(new TextDecoder().decode(stored?.body)) as AnchorFile;
    const pub = await kms.getPublicKey(LOCAL_KMS_KEYS.anchorSigning);
    expect(verifyAnchorFile(parsed, pub)).toBe(true);
    expect(verifyAnchorFile({ ...parsed, head_hash: "0".repeat(64) }, pub)).toBe(false);
    const slice = await svc.query(c);
    expect(verifyAgainstAnchor(slice, parsed, pub)).toMatchObject({
      ok: true,
      signatureValid: true,
      checked: 25,
    });
    const forged = slice.map((e) => (e.seq === 3 ? { ...e, resource_id: "other" } : e));
    expect(verifyAgainstAnchor(forged, parsed, pub)).toMatchObject({
      ok: false,
      break: { seq: 3 },
    });
    await expect(db.admin.query("delete from audit.anchor")).rejects.toThrow(/append-only/);
  });
});

describe("rls-lint", () => {
  it("is clean on the audit schema", async () => {
    expect(await lintRls(db.admin, { schemas: ["audit"] })).toEqual([]);
  });
});
