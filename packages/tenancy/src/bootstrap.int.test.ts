// Tenant creation for a provisional id (LawDocsComply PR-LDC-12; R1-plan M37; R1-D-67): one
// ledgered transaction with RLS on, idempotent per provisional id, refused directly in prod, dr
// and pre-prod, and the provisioning adapter's path in every environment.
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PgSettingsStore, SettingsService } from "@infrabyx/config/settings";
import type { AuditEntryInput, AuditSink, KernelContext, Tx } from "@infrabyx/contracts/kernel";
import { newId } from "@infrabyx/crypto";
import { TenantBootstrap, TENANT_BOOTSTRAP_ACTION } from "./bootstrap.js";
import { PgKernel } from "./kernel.js";
import { PLATFORM_TENANT_ID } from "./context.js";
import { freshDb, TENANCY_SOURCE, type TestDb } from "./__tests__/pg.js";

class RecordingAudit implements AuditSink {
  readonly entries: Array<AuditEntryInput & { tenantId: string }> = [];
  async record(tx: Tx, e: AuditEntryInput): Promise<{ id: string }> {
    this.entries.push({ ...e, tenantId: tx.ctx.tenantId });
    tx.markAudited();
    return { id: "led_x" };
  }
}

const CONFIG_SOURCE = {
  name: "@infrabyx/config",
  dir: join(fileURLToPath(import.meta.url), "../../../config/migrations"),
};
let db: TestDb;
let kernel: PgKernel;
let settings: SettingsService;
const audit = new RecordingAudit();
const platform: KernelContext = {
  tenantId: PLATFORM_TENANT_ID,
  scope: "platform",
  principal: { id: "svc_provisioning", type: "service", roles: ["PLT_SUPER_ADMIN"] },
};
const make = (appEnv: "local" | "prod" | "pre-prod" | "dr" = "local") =>
  new TenantBootstrap({ kernel, audit, appEnv, settings });
const err = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: { code?: string; message?: string }) => e.code ?? e.message,
  );
const tid = () => newId("tnt");

beforeAll(async () => {
  db = await freshDb([TENANCY_SOURCE, CONFIG_SOURCE]);
  kernel = new PgKernel({ pool: db.pool });
  settings = new SettingsService({ kernel, audit, store: new PgSettingsStore(), product: "LDC" });
});
afterAll(async () => {
  await db?.end();
});

describe("R1-D-67 bootstrapTenant (PR-LDC-12)", () => {
  it("creates the tenant, its initial settings and its first ledger entry in one transaction", async () => {
    const id = tid();
    let sawTenant = false;
    const r = await make().bootstrap(platform, {
      tenantId: id,
      product: "LDC",
      name: "Trial Co",
      planRef: "pln_trial",
      settings: { "trust.auth.session_idle_minutes": 20, "ux.palette.enabled": false },
      onCreated: async (tx) => {
        sawTenant =
          (await tx.query("select 1 from tenancy.tenant where id = $1", [id])).rowCount === 1;
      },
    });
    expect(r).toEqual({ tenantId: id, created: true });
    expect(sawTenant).toBe(true);
    const t = await db.admin.query(
      "select product, name, plan_ref, status from tenancy.tenant where id = $1",
      [id],
    );
    expect(t.rows[0]).toEqual({
      product: "LDC",
      name: "Trial Co",
      plan_ref: "pln_trial",
      status: "active",
    });
    const s = await db.admin.query(
      "select key, tier, scope_id, tenant_id, value from config.setting_value where tenant_id = $1 order by key",
      [id],
    );
    expect(s.rows).toEqual([
      {
        key: "trust.auth.session_idle_minutes",
        tier: "TENANT",
        scope_id: id,
        tenant_id: id,
        value: 20,
      },
      { key: "ux.palette.enabled", tier: "TENANT", scope_id: id, tenant_id: id, value: false },
    ]);
    const mine = audit.entries.filter((e) => e.tenantId === id);
    expect(mine[0]).toMatchObject({ action: TENANT_BOOTSTRAP_ACTION, resourceId: id });
    expect(mine.map((e) => e.action)).toContain("settings.setting.change");
    // The tenant reads its own settings through the normal path.
    const own: KernelContext = {
      tenantId: id,
      principal: { id: "usr_x", type: "user", roles: ["ORG_ADMIN"] },
    };
    expect(await settings.get(own, "trust.auth.session_idle_minutes")).toBe(20);
    // Outside a tenant's creation, initial values are refused: changes go through `set`.
    expect(
      await err(
        kernel.mutate(own, (tx) => settings.setInitial(tx, "ux.palette.enabled", true), {
          action: "settings.setting.change",
        }),
      ),
    ).toBe("IPB-UX-011");
  });

  it("is idempotent per provisional id and refuses another request under the id", async () => {
    const id = tid();
    const input = { tenantId: id, product: "LDC" as const, name: "Retry Co" };
    expect((await make().bootstrap(platform, input)).created).toBe(true);
    expect(await make().bootstrap(platform, input)).toEqual({ tenantId: id, created: false });
    expect(await err(make().bootstrap(platform, { ...input, name: "Other Co" }))).toMatch(
      /already exists/,
    );
    expect(
      (await db.admin.query("select count(*)::int as n from tenancy.tenant where id = $1", [id]))
        .rows[0].n,
    ).toBe(1);
  });

  it("rolls everything back when a setting or the product's hook fails", async () => {
    const id = tid();
    expect(
      await err(
        make().bootstrap(platform, {
          tenantId: id,
          product: "LDC",
          name: "Bad Co",
          settings: { "trust.auth.session_idle_minutes": 600 },
        }),
      ),
    ).toBe("IPB-UX-008");
    expect(
      await err(
        make().bootstrap(platform, {
          tenantId: id,
          product: "LDC",
          name: "Bad Co",
          settings: { "trust.auth.passkeys_required": true },
        }),
      ),
    ).toBe("IPB-UX-008");
    expect(
      await err(
        make().bootstrap(platform, {
          tenantId: id,
          product: "LDC",
          name: "Bad Co",
          onCreated: async () => {
            throw new Error("product hook failed");
          },
        }),
      ),
    ).toBe("product hook failed");
    expect(
      (await db.admin.query("select 1 from tenancy.tenant where id = $1", [id])).rowCount,
    ).toBe(0);
    expect(
      (await db.admin.query("select 1 from config.setting_value where tenant_id = $1", [id]))
        .rowCount,
    ).toBe(0);
  });

  it("is refused directly in prod, dr and pre-prod; the provisioning path runs there", async () => {
    for (const env of ["prod", "dr", "pre-prod"] as const)
      expect(
        await err(make(env).bootstrap(platform, { tenantId: tid(), product: "LDC", name: "P" })),
      ).toBe("IPB-SEED-001");
    const id = tid();
    const r = await make("prod").provision(platform, {
      tenantId: id,
      product: "LDC",
      name: "Provisioned Co",
      provisioningRequestId: "018f0d5e-6a7b-7c8d-9e0f-112233445566",
    });
    expect(r.created).toBe(true);
    expect(
      audit.entries.find((e) => e.tenantId === id && e.action === TENANT_BOOTSTRAP_ACTION)?.after,
    ).toMatchObject({
      via: "provisioning",
      provisioning_request_id: "018f0d5e-6a7b-7c8d-9e0f-112233445566",
    });
  });

  it("needs a platform context with a PLT_* role and a ULID tenant id", async () => {
    const tenantCtx: KernelContext = {
      tenantId: "tnt_a",
      principal: { id: "usr_y", type: "user", roles: ["ORG_OWNER"] },
    };
    expect(
      await err(make().bootstrap(tenantCtx, { tenantId: tid(), product: "LDC", name: "X" })),
    ).toBe("IPB-SEC-005");
    const noRole: KernelContext = {
      ...platform,
      principal: { id: "svc_z", type: "service", roles: [] },
    };
    expect(
      await err(make().bootstrap(noRole, { tenantId: tid(), product: "LDC", name: "X" })),
    ).toBe("IPB-SEC-005");
    expect(
      await err(make().bootstrap(platform, { tenantId: "tnt_demo", product: "LDC", name: "X" })),
    ).toMatch(/ULID/);
  });
});
