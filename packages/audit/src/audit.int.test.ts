import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { KernelContext } from "@infrabyx/contracts/kernel";
import type { ObjectMeta, StoragePort } from "@infrabyx/contracts/ports";
import { LOCAL_KMS_KEYS, LocalKms, localDevKey, newId } from "@infrabyx/crypto";
import {
  EXTERNAL_READ_ACTION,
  ExternalReads,
  PgKernel,
  PgOutbox,
  externalContext,
} from "@infrabyx/tenancy";
import { lintRls } from "@infrabyx/tenancy/rls-lint";
import { laneHeadMismatch, lanePosition, verifyChain } from "./chain.js";
import {
  AuditService,
  EXTERNAL_READ_LEDGER_ACTION,
  verifyAgainstAnchor,
  verifyAnchorFile,
  type AnchorFile,
} from "./service.js";
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
  it("20 concurrent transactions keep gap-free lanes, one transaction's entries together (PR-FBX-32)", async () => {
    await Promise.all(
      Array.from({ length: 20 }, (_, i) => write(ctx("tnt_c", `usr_${i}`), 5, `t${i}-`)),
    );
    const rows = await svc.query(ctx("tnt_c"));
    expect(rows).toHaveLength(100);
    expect(new Set(rows.map((r) => r.seq)).size).toBe(100);
    // Each lane runs 1, 2, 3, … without a gap, and a transaction's five entries sit together in one lane.
    const byLane = new Map<number, typeof rows>();
    for (const r of rows) byLane.set(r.lane!, [...(byLane.get(r.lane!) ?? []), r]);
    for (const lane of byLane.values())
      expect(lane.map((r) => lanePosition(r).pos)).toEqual(lane.map((_, i) => i + 1));
    for (const actor of new Set(rows.map((r) => r.actor_id))) {
      const mine = rows.filter((r) => r.actor_id === actor);
      expect(new Set(mine.map((r) => r.lane)).size).toBe(1);
      const pos = mine.map((r) => lanePosition(r).pos);
      expect(pos).toEqual(pos.map((_, i) => pos[0]! + i));
    }
    const result = verifyChain(rows);
    expect(result.ok).toBe(true);
    expect(await svc.verify(ctx("tnt_c"))).toMatchObject({ ok: true, checked: 100 });
    const stored = await db.admin.query<{ lane: number; lane_seq: string; entry_hash: string }>(
      "select lane, lane_seq, entry_hash from audit.ledger_lane where tenant_id = 'tnt_c'",
    );
    expect(stored.rows).toHaveLength(32);
    expect(
      laneHeadMismatch(
        result.lanes,
        stored.rows.map((h) => ({ lane: h.lane, seq: Number(h.lane_seq), hash: h.entry_hash })),
      ),
    ).toBeUndefined();
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
    expect(rows[1]).toMatchObject({ corrects_id: id });
    expect(rows[1]!.seq).toBeGreaterThan(rows[0]!.seq);
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
    const written = await svc.query(c);
    const today = new Date().toISOString().slice(0, 10);
    const file = await svc.writeAnchor(
      { ...c, principal: { id: "svc_audit", type: "service", roles: ["SVC_AUDIT"] } },
      today,
    );
    expect(file).toMatchObject({
      format: "infrabyx-audit-anchor/3",
      tenant_id: "tnt_n",
      seq: written.at(-1)!.seq,
      lanes: [{ lane: written[0]!.lane, seq: 25, hash: written.at(-1)!.entry_hash }],
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
    const third = slice[2]!;
    const forged = slice.map((e) => (e.seq === third.seq ? { ...e, resource_id: "other" } : e));
    expect(verifyAgainstAnchor(forged, parsed, pub)).toMatchObject({
      ok: false,
      break: { seq: third.seq, laneSeq: 3, reason: "hash-mismatch" },
    });
    // A dropped tail is caught against the anchor's lane heads.
    expect(verifyAgainstAnchor(slice.slice(0, 24), parsed, pub)).toMatchObject({
      ok: false,
      break: { reason: "head-mismatch" },
    });
    await expect(db.admin.query("delete from audit.anchor")).rejects.toThrow(/append-only/);
  });
});

describe("rls-lint", () => {
  it("is clean on the audit schema", async () => {
    expect(await lintRls(db.admin, { schemas: ["audit"] })).toEqual([]);
  });
});

describe("external reads in the ledger (R1-D-29)", () => {
  it("chains each external read as a user actor naming the grant", async () => {
    const ent = newId("ent");
    const grant = newId("xgr");
    await db.admin.query(
      "insert into tenancy.tenant (id, product, name) values ('tnt_x', 'FBX', 'X')",
    );
    await db.admin.query(
      "insert into tenancy.legal_entity (id, tenant_id, name) values ($1, 'tnt_x', 'X Ltd')",
      [ent],
    );
    await db.admin.query(
      `insert into tenancy.external_grant (id, tenant_id, grantee_id, grantee_name, organisation, kind,
         purpose, entity_ids, period_from, period_to, duration_days, state, requested_by, approved_by,
         approved_at, expires_at)
       values ($1, 'tnt_x', 'ext_aud', 'A. Auditor', 'Audit firm', 'statutory_auditor', 'statutory audit',
         array[$2], '2026-04-01', '2027-03-31', 30, 'active', 'usr_a', 'usr_b', now(), now() + interval '30 days')`,
      [grant, ent],
    );
    const rows = await new ExternalReads({ kernel, audit: sink }).read(
      externalContext("tnt_x", "ext_aud", grant),
      "tenancy.external_grant",
      "select id from tenancy.external_grant",
    );
    expect(rows).toEqual([{ id: grant }]);
    const led = await db.admin.query(
      "select actor_id, actor_type, action, resource_type, resource_id from audit.ledger where tenant_id = 'tnt_x'",
    );
    expect(led.rows).toEqual([
      {
        actor_id: "ext_aud",
        actor_type: "user",
        action: "platform.external_read",
        resource_type: "external_read",
        resource_id: `${grant}/tenancy.external_grant`,
      },
    ]);
    expect(verifyChain(await svc.query(ctx("tnt_x"))).ok).toBe(true);
  });
});

describe("external-read summary (PR-LDC-10, R1-D-81)", () => {
  const grantFixture = async (tenant: string, grantee: string, name: string) => {
    const ent = newId("ent");
    const grant = newId("xgr");
    await db.admin.query(
      "insert into tenancy.legal_entity (id, tenant_id, name) values ($1, $2, 'S Ltd')",
      [ent, tenant],
    );
    await db.admin.query(
      `insert into tenancy.external_grant (id, tenant_id, grantee_id, grantee_name, organisation, kind,
         purpose, entity_ids, period_from, period_to, duration_days, state, requested_by, approved_by,
         approved_at, expires_at)
       values ($1, $2, $3, $4, 'Audit firm', 'statutory_auditor', 'statutory audit', array[$5],
         '2026-04-01', '2027-03-31', 30, 'active', 'usr_a', 'usr_b', now(), now() + interval '30 days')`,
      [grant, tenant, grantee, name, ent],
    );
    return grant;
  };
  const as = (tenant: string, grantee: string, grant: string) =>
    externalContext(tenant, grantee, grant, {
      ip: "198.51.100.9",
      userAgent: "auditor-ua",
      traceId: "trace-xr-1",
    });

  it("counts reads per grant and table, grantee and table with first and last times, in the tenant only", async () => {
    expect(EXTERNAL_READ_LEDGER_ACTION).toBe(EXTERNAL_READ_ACTION);
    for (const t of ["tnt_s", "tnt_o"])
      await db.admin.query(
        "insert into tenancy.tenant (id, product, name) values ($1, 'LDC', $1)",
        [t],
      );
    // A second table an external principal may read (a product grants app_external its own).
    await db.admin.query(
      `create schema xr; create table xr.book (id text primary key);
       grant usage on schema xr to app_external; grant select on xr.book to app_external`,
    );
    const g1 = await grantFixture("tnt_s", "ext_one", "Ann Example");
    const g2 = await grantFixture("tnt_s", "ext_two", "Bea Example");
    const g3 = await grantFixture("tnt_o", "ext_one", "Ann Example");
    const reads = new ExternalReads({ kernel, audit: sink });
    const before = Date.now();
    const grantSql = "select id from tenancy.external_grant";
    await reads.read(as("tnt_s", "ext_one", g1), "tenancy.external_grant", grantSql);
    await reads.read(as("tnt_s", "ext_one", g1), "xr.book", "select id from xr.book");
    await reads.read(as("tnt_s", "ext_one", g1), "xr.book", "select id from xr.book");
    await reads.read(as("tnt_s", "ext_two", g2), "xr.book", "select id from xr.book");
    await reads.read(as("tnt_o", "ext_one", g3), "xr.book", "select id from xr.book");
    // Other entries of the day are not external reads.
    await write(ctx("tnt_s"), 3, "s");
    const after = Date.now();
    const today = new Date(before).toISOString().slice(0, 10);

    const s = await svc.externalReadSummary(ctx("tnt_s"), today);
    expect(s).toMatchObject({ tenantId: "tnt_s", day: today, reads: 4 });
    expect(s.byGrantTable.map((c) => [c.grantId, c.granteeId, c.table, c.reads])).toEqual(
      [
        [g1, "ext_one", "tenancy.external_grant", 1],
        [g1, "ext_one", "xr.book", 2],
        [g2, "ext_two", "xr.book", 1],
      ].sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    );
    expect(s.byGrantee.map((g) => [g.granteeId, g.grantIds, g.reads])).toEqual([
      ["ext_one", [g1], 3],
      ["ext_two", [g2], 1],
    ]);
    expect(s.byTable.map((t) => [t.table, t.reads])).toEqual([
      ["tenancy.external_grant", 1],
      ["xr.book", 3],
    ]);
    const book = s.byGrantTable.find((c) => c.grantId === g1 && c.table === "xr.book")!;
    expect(book.firstReadAt < book.lastReadAt).toBe(true);
    expect(s.firstReadAt! <= book.firstReadAt && s.lastReadAt! >= book.lastReadAt).toBe(true);
    for (const t of [s.firstReadAt!, s.lastReadAt!]) {
      expect(Date.parse(t)).toBeGreaterThanOrEqual(before - 1000);
      expect(Date.parse(t)).toBeLessThanOrEqual(after + 1000);
    }
    // Ids, counts and times only: no grantee name, IP, user-agent hash, trace id or digest.
    const led = await db.admin.query<{ ip_hash: string; ua_hash: string; after_digest: string }>(
      `select ip_hash, ua_hash, after_digest from audit.ledger
        where tenant_id = 'tnt_s' and action = 'platform.external_read'`,
    );
    expect(led.rows).toHaveLength(4);
    const text = JSON.stringify(s);
    for (const personal of [
      "Ann Example",
      "Bea Example",
      "trace-xr-1",
      "198.51.100.9",
      ...led.rows.flatMap((r) => [r.ip_hash, r.ua_hash, r.after_digest]),
    ])
      expect(text).not.toContain(personal);

    // The other tenant sees only its own read; another day is empty.
    const o = await svc.externalReadSummary(ctx("tnt_o"), today);
    expect(o.byGrantTable.map((c) => [c.grantId, c.table, c.reads])).toEqual([[g3, "xr.book", 1]]);
    const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000)
      .toISOString()
      .slice(0, 10);
    expect(await svc.externalReadSummary(ctx("tnt_s"), yesterday)).toEqual({
      tenantId: "tnt_s",
      day: yesterday,
      reads: 0,
      firstReadAt: null,
      lastReadAt: null,
      byGrantTable: [],
      byGrantee: [],
      byTable: [],
    });
    await expect(svc.externalReadSummary(ctx("tnt_s"), "2026-02-30")).rejects.toThrow(RangeError);
    await expect(svc.externalReadSummary(as("tnt_s", "ext_one", g1), today)).rejects.toMatchObject({
      code: "IPB-SEC-005",
    });
  });
});

describe("business ids on ledger entries (PR-LDC-30, R1-D-125)", () => {
  it("hashes them when present, keeps older entries verifying, and reads a business id's history", async () => {
    const c = ctx("tnt_biz");
    await write(c, 3, "plain");
    await kernel.mutate(c, async (tx) => {
      await sink.record(tx, {
        action: "grc.obligation.update",
        resourceType: "obligation",
        resourceId: "obl_1",
        after: { status: "amended" },
        businessIds: ["OBL-2026-0001", "MAT-7"],
      });
      await sink.record(tx, {
        action: "grc.control.link",
        resourceType: "control",
        resourceId: "ctl_9",
        businessIds: ["OBL-2026-0001"],
      });
    });
    expect(await svc.verify(c)).toMatchObject({ ok: true, checked: 5 });
    const h = await svc.history(c, "OBL-2026-0001");
    expect(h.map((e) => e.action)).toEqual(["grc.obligation.update", "grc.control.link"]);
    expect(h[0]?.business_ids).toEqual(["OBL-2026-0001", "MAT-7"]);
    expect(h[0]?.after_digest).toMatch(/^[0-9a-f]{64}$/);
    expect((await svc.history(c, "MAT-7")).map((e) => e.resource_id)).toEqual(["obl_1"]);
    // RLS: another tenant sees none of it.
    expect(await svc.history(ctx("tnt_other_biz"), "OBL-2026-0001")).toEqual([]);
    // The ids are inside the hash: changing them is detected.
    const entries = await svc.query(c);
    const tampered = entries.map((e) =>
      e.resource_id === "ctl_9" ? { ...e, business_ids: ["OBL-2026-0002"] } : e,
    );
    expect(verifyChain(tampered).ok).toBe(false);
    // The index exists and is valid (audit/0011, built concurrently).
    const idx = await db.admin.query<{ valid: boolean }>(
      `select i.indisvalid as valid from pg_index i join pg_class c on c.oid = i.indexrelid
        where c.relname = 'ledger_business_ids_idx'`,
    );
    expect(idx.rows).toEqual([{ valid: true }]);
  });

  it("refuses ids that are not ids, too many, duplicates, and a write around the sink", async () => {
    const c = ctx("tnt_biz2");
    const one = (businessIds: string[]) =>
      kernel.mutate(c, (tx) =>
        sink.record(tx, { action: "grc.x.y", resourceType: "x", resourceId: "x1", businessIds }),
      );
    await expect(one([])).rejects.toThrow(RangeError);
    await expect(one(["has space"])).rejects.toThrow(RangeError);
    await expect(one(["A", "A"])).rejects.toThrow(RangeError);
    await expect(one(Array.from({ length: 17 }, (_, i) => `ID${i}`))).rejects.toThrow(RangeError);
    await expect(svc.history(c, "bad id")).rejects.toThrow(RangeError);
    // The database refuses the same, whoever writes the row.
    await expect(
      kernel.mutate(c, async (tx) => {
        await tx.query(
          `insert into audit.ledger (id, tenant_id, seq, actor_id, actor_type, action, resource_type, resource_id, occurred_at, prev_hash, entry_hash, business_ids)
           values ($1, 'tnt_biz2', 0, 'usr_a', 'user', 'grc.x.y', 'x', 'x1', now(), repeat('0', 64), repeat('0', 64), array['a b'])`,
          [newId("led")],
        );
        tx.markAudited();
      }),
    ).rejects.toThrow(/valid_business_ids|check constraint/);
  });
});
