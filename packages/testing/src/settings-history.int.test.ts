// Per-value setting change history on PostgreSQL (config/0003; LawDocsComply PR-LDC-17, R1-D-82):
// each applied change is kept with who, when, old, new and the approval request id, linked to its
// `settings.setting.change` ledger entry whose digests it matches; read newest first and paged
// under RLS, insert-only, and written only as the context's own actor.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PgSettingsStore, SettingsService } from "@infrabyx/config/settings";
import { canonicalDigest, newId } from "@infrabyx/crypto";
import { platformContext, withTenant } from "./context.js";
import { startPostgres, type TestDatabase } from "./postgres.js";

let db: TestDatabase;
let svc: SettingsService;
const KEY = "trust.auth.session_idle_minutes";
const A = { tier: "TENANT", scopeId: "tnt_a" } as const;
const adminA = withTenant("tnt_a", ["ORG_ADMIN"], { principal: { id: "usr_admin" } });
const adminB = withTenant("tnt_b", ["ORG_ADMIN"], { principal: { id: "usr_admin_b" } });
const code = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: { code?: string; message?: string }) => e.code ?? e.message,
  );

beforeAll(async () => {
  db = await startPostgres();
  await db.admin.query(
    "insert into tenancy.tenant (id, product, name) values ('tnt_platform', 'PLATFORM', 'Infrabyx'), ('tnt_a', 'LDC', 'A'), ('tnt_b', 'LDC', 'B')",
  );
  svc = new SettingsService({
    store: new PgSettingsStore(),
    kernel: db.kernel,
    audit: db.audit,
    product: "LDC",
  });
});
afterAll(async () => db?.end());

describe("setting change history (PR-LDC-17, R1-D-82)", () => {
  it("keeps who, when, old, new and the approval request id, newest first and paged", async () => {
    await svc.set(adminA, KEY, A, 20);
    await svc.set(adminA, KEY, A, 15);
    // An approved change, applied in the checker's transaction by the approvals engine.
    const checker = withTenant("tnt_a", ["ORG_CHECKER"], { principal: { id: "usr_checker" } });
    await db.kernel.mutate(checker, (tx) =>
      svc.applyApproved(tx, { key: KEY, tier: "TENANT", scopeId: "tnt_a", value: 10 }, "apr_hist"),
    );
    await svc.set(adminB, KEY, { tier: "TENANT", scopeId: "tnt_b" }, 25);

    const first = await svc.history(adminA, KEY, A, { limit: 2 });
    expect(
      first.items.map((c) => [c.actorId, c.old, c.new, c.version, c.approvalRequestId]),
    ).toEqual([
      ["usr_checker", 15, 10, 3, "apr_hist"],
      ["usr_admin", 20, 15, 2, null],
    ]);
    expect(first.nextCursor).toMatch(/^\d+$/);
    const rest = await svc.history(adminA, KEY, A, { limit: 2, cursor: first.nextCursor! });
    expect(rest.items.map((c) => [c.actorId, c.old, c.new, c.version])).toEqual([
      ["usr_admin", null, 20, 1],
    ]);
    expect(rest.nextCursor).toBeNull();
    const all = [...first.items, ...rest.items];
    expect(all.every((c) => c.key === KEY && c.tier === "TENANT" && c.scopeId === "tnt_a")).toBe(
      true,
    );
    expect(Date.parse(all[0]!.at)).toBeGreaterThanOrEqual(Date.parse(all[2]!.at));

    // Each row names its ledger entry, whose actor and digests it matches.
    for (const c of all) {
      const led = await db.admin.query<{
        action: string;
        actor_id: string;
        resource_id: string;
        before_digest: string;
        after_digest: string;
      }>(
        "select action, actor_id, resource_id, before_digest, after_digest from audit.ledger where id = $1",
        [c.ledgerId],
      );
      expect(led.rows[0]).toEqual({
        action: "settings.setting.change",
        actor_id: c.actorId,
        resource_id: `${KEY}@TENANT:tnt_a`,
        before_digest: canonicalDigest({ value: c.old }),
        after_digest: canonicalDigest({ value: c.new }),
      });
    }
  });

  it("is RLS-scoped: another tenant sees none of it, tenant rows never reach the platform tiers", async () => {
    // An ENTITY-scope change of tenant A, written as the database owner for the fixture.
    const ent = newId("ent");
    await db.admin.query(
      `insert into config.setting_change (id, ledger_id, key, tier, scope_id, tenant_id, new_value,
         version, actor_id)
       values ($1, $2, $3, 'ENTITY', $4, 'tnt_a', '12'::jsonb, 1, 'usr_admin')`,
      [newId("sch"), newId("led"), KEY, ent],
    );
    const entity = { tier: "ENTITY", scopeId: ent } as const;
    expect((await svc.history(adminA, KEY, entity)).items.map((c) => c.new)).toEqual([12]);
    expect(await svc.history(adminB, KEY, entity)).toEqual({ items: [], nextCursor: null });
    expect(await code(svc.history(adminB, KEY, A))).toBe("IPB-UX-011");
    const seen = await db.kernel.read(
      adminB,
      async (tx) =>
        (await tx.query<{ tenant_id: string }>("select tenant_id from config.setting_change")).rows,
    );
    expect(seen.map((r) => r.tenant_id)).toEqual(["tnt_b"]);

    // PLATFORM history is read in a platform context only.
    const release = platformContext(["PLT_RELEASE_MANAGER"]);
    const platform = { tier: "PLATFORM", scopeId: null } as const;
    await svc.set(release, "eng.flags.snapshot_ttl_hours", platform, 12);
    const p = await svc.history(release, "eng.flags.snapshot_ttl_hours", platform);
    expect(p.items.map((c) => [c.actorId, c.old, c.new])).toEqual([["usr_staff", null, 12]]);
    expect(await code(svc.history(adminA, "eng.flags.snapshot_ttl_hours", platform))).toBe(
      "IPB-UX-011",
    );
    const tenantSees = await db.kernel.read(
      adminA,
      async (tx) =>
        (await tx.query("select 1 from config.setting_change where tenant_id is null")).rows,
    );
    expect(tenantSees).toEqual([]);

    // A user's preference history is theirs alone.
    const ann = withTenant("tnt_a", ["ORG_MEMBER"], { principal: { id: "usr_ann" } });
    const annScope = { tier: "USER", scopeId: "usr_ann" } as const;
    await svc.set(ann, "ux.density", annScope, "compact");
    expect((await svc.history(ann, "ux.density", annScope)).items.map((c) => c.new)).toEqual([
      "compact",
    ]);
    expect(await code(svc.history(adminA, "ux.density", annScope))).toBe("IPB-UX-011");
  });

  it("is insert-only, and a row is written only as the context's own actor", async () => {
    await db.admin.query("begin");
    await db.admin.query("set local role app_rw");
    await db.admin.query("select set_config('app.tenant_id', 'tnt_a', true)");
    await expect(
      db.admin.query("update config.setting_change set new_value = '1'::jsonb"),
    ).rejects.toThrow(/permission denied/);
    await db.admin.query("rollback");
    // The only delete is of an erased person's USER rows (config/0004, R1-D-95): here, none.
    await db.admin.query("begin");
    await db.admin.query("set local role app_rw");
    await db.admin.query("select set_config('app.tenant_id', 'tnt_a', true)");
    expect((await db.admin.query("delete from config.setting_change")).rowCount).toBe(0);
    await db.admin.query("rollback");
    await expect(
      db.kernel.mutate(adminA, async (tx) => {
        await db.audit.record(tx, { action: "t.t.t", resourceType: "t", resourceId: "t" });
        await new PgSettingsStore().appendChange(tx, {
          ledgerId: newId("led"),
          key: KEY,
          tier: "TENANT",
          scopeId: "tnt_a",
          tenantId: "tnt_a",
          actorId: "usr_someone_else",
          old: 10,
          new: 5,
          version: 9,
          approvalRequestId: null,
        });
      }),
    ).rejects.toThrow(/row-level security/);
  });
});
