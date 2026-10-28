// PR-UDF-013 (R1-D-12): the scheduled ledger jobs for every tenant through TenantSweep. The
// tenant list is a ledgered SVC_TENANT_SWEEP read of `id` and `status` only; each job runs in its
// tenant's context; a broken chain is named; one tenant's failure does not stop the others.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { KernelContext } from "@infrabyx/contracts/kernel";
import type { ObjectMeta, StoragePort } from "@infrabyx/contracts/ports";
import { LOCAL_KMS_KEYS, LocalKms, localDevKey } from "@infrabyx/crypto";
import { PgKernel, PgOutbox, TenantSweep } from "@infrabyx/tenancy";
import { AuditService } from "./service.js";
import { PgAuditSink } from "./sink.js";
import { AuditSweep } from "./sweep.js";
import { freshDb } from "./__tests__/db.js";

let db: Awaited<ReturnType<typeof freshDb>>;
let kernel: PgKernel;
const sink = new PgAuditSink({ pseudonymKey: localDevKey(LOCAL_KMS_KEYS.auditPseudonym) });
const stored = new Map<string, Uint8Array>();
const storage = {
  async putWithRetention(key: string, body: Uint8Array, _r: Date, _m: ObjectMeta) {
    if (stored.has(key)) throw new Error("write-once");
    stored.set(key, body);
  },
} as unknown as StoragePort;
let svc: AuditService;
const user = (tenantId: string): KernelContext => ({
  tenantId,
  principal: { id: "usr_a", type: "user", roles: ["ORG_ADMIN"] },
});
const write = (c: KernelContext, n: number) =>
  kernel.mutate(c, async (tx) => {
    for (let i = 0; i < n; i++)
      await sink.record(tx, {
        action: "cases.case.update",
        resourceType: "case",
        resourceId: `r${i}`,
      });
  });

beforeAll(async () => {
  db = await freshDb();
  kernel = new PgKernel({ pool: db.pool });
  svc = new AuditService({
    kernel,
    sink,
    product: "UDF",
    outbox: new PgOutbox(),
    storage,
    kms: new LocalKms(),
    anchorKeyId: LOCAL_KMS_KEYS.anchorSigning,
  });
  await db.admin.query(
    `insert into tenancy.tenant (id, product, name, status, deleted_at) values
       ('tnt_swa', 'UDF', 'A', 'active', null), ('tnt_swb', 'UDF', 'B', 'active', null),
       ('tnt_sws', 'UDF', 'S', 'suspended', null), ('tnt_swd', 'UDF', 'D', 'deleted', now())`,
  );
  for (const t of ["tnt_swa", "tnt_swb", "tnt_sws"]) await write(user(t), 3);
});
afterAll(async () => db?.end());

const ours = (ids: string[]) => ids.filter((t) => t.startsWith("tnt_sw"));

describe("PR-UDF-013 per-tenant scheduled jobs (TenantSweep, AuditSweep)", () => {
  it("lists every tenant not deleted and ledgers the read in each", async () => {
    const sweep = new TenantSweep({ kernel, audit: sink });
    expect(ours(await sweep.tenants())).toEqual(["tnt_swa", "tnt_swb", "tnt_sws"]);
    expect(
      ours(await new TenantSweep({ kernel, audit: sink, includeSuspended: false }).tenants()),
    ).toEqual(["tnt_swa", "tnt_swb"]);
    const led = await db.admin.query<{ tenant_id: string }>(
      `select tenant_id from audit.ledger where action = 'platform.service_read'
        and tenant_id like 'tnt_sw%' order by tenant_id`,
    );
    expect(new Set(led.rows.map((r) => r.tenant_id))).toEqual(
      new Set(["tnt_swa", "tnt_swb", "tnt_sws"]),
    );
  });

  it("the sweep's database role reads id and status only", async () => {
    await db.admin.query("begin");
    try {
      await db.admin.query("set local role svc_tenant_sweep");
      await db.admin.query("select set_config('app.scope', 'platform', true)");
      expect(
        (await db.admin.query("select id, status from tenancy.tenant")).rowCount,
      ).toBeGreaterThan(3);
      await expect(db.admin.query("select name from tenancy.tenant")).rejects.toMatchObject({
        code: "42501",
      });
    } finally {
      await db.admin.query("rollback");
    }
  });

  it("runs each job in its tenant's own context, and verifies every chain, naming a broken one", async () => {
    const sweep = new TenantSweep({ kernel, audit: sink });
    const seen = await sweep.run(async (ctx) => {
      const r = await kernel.read(
        ctx,
        async (tx) =>
          (await tx.query<{ n: string }>("select count(distinct tenant_id) as n from audit.ledger"))
            .rows[0],
      );
      return {
        tenant: ctx.tenantId,
        visibleTenants: Number(r?.n),
        scope: ctx.scope,
        principal: ctx.principal.id,
      };
    });
    for (const s of seen.filter((x) => x.tenantId.startsWith("tnt_sw")))
      expect(s.value).toEqual({
        tenant: s.tenantId,
        visibleTenants: 1,
        scope: "tenant",
        principal: "svc_tenant_job",
      });

    const victim = (
      await db.admin.query(
        "select id from audit.ledger where tenant_id = 'tnt_swb' order by seq limit 1",
      )
    ).rows[0].id as string;
    await db.admin.query("alter table audit.ledger disable trigger ledger_no_update");
    await db.admin.query("update audit.ledger set after_digest = repeat('f', 64) where id = $1", [
      victim,
    ]);
    await db.admin.query("alter table audit.ledger enable trigger ledger_no_update");
    const v = await new AuditSweep({ service: svc, tenants: sweep }).verifyAll();
    expect(v.broken).toEqual(["tnt_swb"]);
    expect(v.failed).toEqual([]);
    expect(ours(v.results.map((r) => r.tenantId))).toEqual(["tnt_swa", "tnt_swb", "tnt_sws"]);
  });

  it("anchors every tenant for a date; one tenant's failure is reported, the others still run", async () => {
    const sweep = new TenantSweep({ kernel, audit: sink });
    const flaky = {
      run: <T>(job: (ctx: KernelContext) => Promise<T>) =>
        sweep.run((ctx) =>
          ctx.tenantId === "tnt_swa"
            ? Promise.reject(Object.assign(new Error("storage down"), { code: "IPB-PORT-002" }))
            : job(ctx),
        ),
    };
    const a = await new AuditSweep({ service: svc, tenants: flaky }).anchorAll("2026-10-28");
    expect(a.failed).toEqual([{ tenantId: "tnt_swa", error: "IPB-PORT-002" }]);
    expect(ours(a.results.map((r) => r.tenantId))).toEqual(["tnt_swb", "tnt_sws"]);
    expect(a.results.every((r) => r.value.anchor_date === "2026-10-28")).toBe(true);
  });
});
