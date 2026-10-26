import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FlagAdmin, FlagService, PgFlagProvider, PgSnapshotStore } from "@infrabyx/config/flags";
import { PgSettingsStore, SettingsService } from "@infrabyx/config/settings";
import { main as seedCli } from "@infrabyx/seed/cli";
import { ApprovalsEngine, PgOutbox } from "@infrabyx/tenancy";
import { lintRls } from "@infrabyx/tenancy/rls-lint";
import { agentContext, platformContext, withTenant } from "./context.js";
import {
  describeAuditChain,
  describeLockedActions,
  describeMakerChecker,
  describeSeedRefusal,
  describeTenantIsolation,
} from "./nn.js";
import { startPostgres, type TestDatabase } from "./postgres.js";
import { newId } from "@infrabyx/crypto";

let db: TestDatabase;
let engine: ApprovalsEngine;
const outbox = new PgOutbox();
const settings = () =>
  new SettingsService({
    store: new PgSettingsStore(),
    kernel: db.kernel,
    audit: db.audit,
    outbox,
    product: "LD",
  });

beforeAll(async () => {
  db = await startPostgres();
  engine = new ApprovalsEngine({ kernel: db.kernel, audit: db.audit, outbox, product: "LD" });
  await db.admin.query(
    "insert into tenancy.tenant (id, product, name) values ('tnt_platform', 'PLATFORM', 'Infrabyx'), ('tnt_a', 'LD', 'A'), ('tnt_b', 'LD', 'B')",
  );
});
afterAll(async () => db?.end());

describeTenantIsolation({
  db: () => db,
  table: "tenancy.legal_entity",
  tenantA: "tnt_a",
  tenantB: "tnt_b",
  async insert(tx) {
    const id = newId("ent");
    await tx.query(
      "insert into tenancy.legal_entity (id, tenant_id, name) values ($1, $2, 'NN-01 Ltd')",
      [id, tx.ctx.tenantId],
    );
    await db.audit.record(tx, {
      action: "tenancy.entity.create",
      resourceType: "legal_entity",
      resourceId: id,
    });
    return id;
  },
  select: async (tx, id) =>
    (await tx.query("select id from tenancy.legal_entity where id = $1", [id])).rows,
});

describeTenantIsolation({
  db: () => db,
  table: "config.setting_value",
  tenantA: "tnt_a",
  tenantB: "tnt_b",
  async insert(tx) {
    const svc = settings();
    await svc.applyApproved(
      tx,
      {
        key: "trust.auth.session_idle_minutes",
        tier: "TENANT",
        scopeId: tx.ctx.tenantId,
        value: 20,
      },
      "apr_nn01",
    );
    return (
      await tx.query<{ id: string }>("select id from config.setting_value where tenant_id = $1", [
        tx.ctx.tenantId,
      ])
    ).rows[0]?.id as string;
  },
  select: async (tx, id) =>
    (await tx.query("select id from config.setting_value where id = $1", [id])).rows,
});

describeAuditChain({
  db: () => db,
  tenantId: "tnt_a",
  ctx: withTenant("tnt_a", ["ORG_ADMIN"]),
  mutate: (ctx) =>
    settings().set(
      ctx,
      "trust.auth.session_absolute_hours",
      { tier: "TENANT", scopeId: "tnt_a" },
      10,
    ),
});

describeMakerChecker({
  db: () => db,
  engine: () => engine,
  request: {
    action: "access.ip_allowlist.change",
    riskClass: "R4",
    payload: { cidrs: ["203.0.113.0/24"] },
  },
  maker: withTenant("tnt_a", ["ORG_ADMIN"], { principal: { id: "usr_maker" } }),
  checker: withTenant("tnt_a", ["ORG_CHECKER"], { principal: { id: "usr_checker" } }),
  agent: agentContext("tnt_a", ["AGT_VIDHI", "ORG_CHECKER"]),
});

describeLockedActions({
  db: () => db,
  actions: [
    "approvals.request.approve",
    "documents.document.sign",
    "loans.loan.disburse",
    "cases.case.delete",
    "access.role.grant",
  ],
  agent: agentContext("tnt_a"),
});

describeSeedRefusal({
  entrypoint: (env) =>
    seedCli(["--profile", "demo"], { ...env, SEED_ENABLED: "true", APP_PRODUCT: "LD" }),
});

describe("config on PostgreSQL", () => {
  it("settings: TENANT rows follow RLS; PLATFORM rows need a platform context", async () => {
    const svc = settings();
    await svc.set(
      withTenant("tnt_b", ["ORG_ADMIN"]),
      "trust.auth.session_idle_minutes",
      { tier: "TENANT", scopeId: "tnt_b" },
      25,
    );
    expect(await svc.get(withTenant("tnt_b"), "trust.auth.session_idle_minutes")).toBe(25);
    expect(await svc.get(withTenant("tnt_a"), "trust.auth.session_idle_minutes")).not.toBe(25);
    const raw = await db.admin.query("select type from config.outbox where tenant_id = 'tnt_b'");
    expect(raw.rows.map((r) => r.type)).toContain("in.ld.settings.SettingChanged.v1");
    expect(
      await db.kernel
        .mutate(withTenant("tnt_a"), async (tx) => {
          await db.audit.record(tx, { action: "t.t.t", resourceType: "t", resourceId: "t" });
          await new PgSettingsStore().write(tx, {
            key: "ux.undo.window_s",
            tier: "PLATFORM",
            scopeId: null,
            tenantId: null,
            value: 20,
            actorId: "usr_x",
          });
        })
        .then(
          () => null,
          (e: Error) => e.message,
        ),
    ).toMatch(/row-level security/);
    const withApprovals = new SettingsService({
      store: new PgSettingsStore(),
      kernel: db.kernel,
      audit: db.audit,
      outbox,
      approvals: engine,
      product: "LD",
    });
    expect(
      await withApprovals.set(
        platformContext(["PLT_RELEASE_MANAGER"]),
        "ux.undo.window_s",
        { tier: "PLATFORM", scopeId: null },
        12,
      ),
    ).toMatchObject({ status: "pending" });
  });
  it("flags: kill switch written through the kernel with the ledger; safe state when the provider fails", async () => {
    const provider = new PgFlagProvider(db.pool);
    const admin = new FlagAdmin({
      kernel: db.kernel,
      audit: db.audit,
      outbox,
      writer: provider,
      product: "LD",
    });
    await admin.set(platformContext(["PLT_SECURITY_OFFICER"]), "kill.webhooks", true);
    expect(await provider.getBooleanValue("kill.webhooks", false)).toBe(true);
    const snapshots = new PgSnapshotStore(db.pool);
    const svc = new FlagService({ provider, snapshots });
    await svc.refreshSnapshot();
    expect((await snapshots.load())?.values["kill.webhooks"]).toBe(true);
    const broken = new PgFlagProvider({ query: async () => Promise.reject(new Error("down")) });
    const stale = new FlagService({
      provider: broken,
      snapshots,
      now: () => Date.now() + 25 * 3_600_000,
    });
    expect(await stale.evaluate("kill.payments")).toMatchObject({
      value: true,
      source: "safe-state",
    });
  });
});

describe("rls-lint over every platform schema", () => {
  it("is clean", async () => {
    expect(
      await lintRls(db.admin, { schemas: ["tenancy", "audit", "config", "seed", "meta"] }),
    ).toEqual([]);
  });
});
