// Tenant creation for a provisional id (LawDocsComply PR-LDC-12; R1-plan M37; R1-D-67). One
// ledgered transaction creates the tenant row, its initial tenant-tier settings (through the
// product's `SettingsService.setInitial`) and the product's own first rows (`onCreated`), and
// writes the tenant's first ledger entry. Idempotent per provisional id: the same request again
// returns the tenant; another request under the id is refused.
//
// Two entry points:
// - `bootstrap`: a direct call (local, test, dev, sandbox, uat, staging). Refused in `prod`, `dr`
//   and `pre-prod`, as seeds are (PL1-D-06, `SEED_REFUSED_ENVS`);
// - `provision`: the Operations Hub provisioning adapter's path (R1-plan M38), in every
//   environment, after it has verified the signed `TenantProvisioned` (Ecosystem Spec §6.29). It
//   records the provisioning request id in the ledger entry.
// Both run in a platform context: the caller's PLT_* principal (the kernel checks it), with the
// transaction's tenant set to the new tenant so its settings and ledger entry land in that tenant.
import { isSeedRefused, type AppEnv } from "@infrabyx/contracts/env";
import { IpbError } from "@infrabyx/contracts/errors";
import type { AuditSink, KernelContext, MutationKernel, Tx } from "@infrabyx/contracts/kernel";
import { ConflictError } from "./errors.js";

export const TENANT_BOOTSTRAP_ACTION = "tenancy.tenant.bootstrap";
export const TENANT_PRODUCTS = ["LD", "LDC", "EQ", "FBX", "UDF", "OH"] as const;
export type TenantProduct = (typeof TENANT_PRODUCTS)[number];
const TENANT_ID = /^tnt_[0-9A-HJKMNP-TV-Z]{26}$/;

/** Initial tenant-tier values, written in the bootstrap's transaction (`SettingsService`). */
export interface TenantInitialSettings {
  setInitial(tx: Tx, key: string, value: unknown): Promise<unknown>;
}

export interface TenantBootstrapOptions {
  kernel: MutationKernel;
  audit: AuditSink;
  /** The deployment's `APP_ENV`, from `@infrabyx/config` (IPB-01-19). */
  appEnv: AppEnv;
  settings?: TenantInitialSettings;
}

export interface TenantBootstrapInput {
  /** The provisional id the product already holds (`tnt_` + ULID). */
  tenantId: string;
  product: TenantProduct;
  name: string;
  residency?: "IN" | "IN-ZR" | "GLOBAL";
  orgId?: string;
  planRef?: string;
  brandId?: string;
  /** Initial tenant-tier values by settings key; each key must be registered in `packages/config`. */
  settings?: Readonly<Record<string, unknown>>;
  /** The product's own first rows, in the same transaction, after the tenant and its settings. */
  onCreated?: (tx: Tx) => Promise<void>;
}

export interface TenantBootstrapResult {
  tenantId: string;
  /** False when the tenant already existed with the same request (a retry). */
  created: boolean;
}

interface TenantRow {
  product: string;
  name: string;
  residency: string;
  org_id: string | null;
  plan_ref: string | null;
  brand_id: string | null;
  status: string;
}

export class TenantBootstrap {
  constructor(private readonly o: TenantBootstrapOptions) {}

  /** A direct call; refused in `prod`, `dr` and `pre-prod` (PL1-D-06). */
  async bootstrap(ctx: KernelContext, input: TenantBootstrapInput): Promise<TenantBootstrapResult> {
    if (isSeedRefused(this.o.appEnv))
      throw new IpbError("IPB-SEED-001", {
        detail: `a tenant is created directly only outside prod, dr and pre-prod (APP_ENV ${this.o.appEnv}); use the Operations Hub provisioning path`,
        meta: { env: this.o.appEnv },
      });
    return this.run(ctx, input, null);
  }

  /**
   * The provisioning adapter's path, in every environment, once it has verified the signed
   * `TenantProvisioned`; the ledger entry names the provisioning request.
   */
  async provision(
    ctx: KernelContext,
    input: TenantBootstrapInput & { provisioningRequestId: string },
  ): Promise<TenantBootstrapResult> {
    if (!input.provisioningRequestId || input.provisioningRequestId.length > 128)
      throw new RangeError("a provisioning request id of at most 128 characters");
    return this.run(ctx, input, input.provisioningRequestId);
  }

  private async run(
    caller: KernelContext,
    input: TenantBootstrapInput,
    provisioningRequestId: string | null,
  ): Promise<TenantBootstrapResult> {
    if (caller.scope !== "platform")
      throw new IpbError("IPB-SEC-005", { detail: "a tenant is created in a platform context" });
    if (!TENANT_ID.test(input.tenantId))
      throw new RangeError("a provisional tenant id is tnt_ followed by a ULID");
    if (!(TENANT_PRODUCTS as readonly string[]).includes(input.product))
      throw new RangeError(`unknown product ${input.product}`);
    const name = input.name.trim();
    if (name.length < 1 || name.length > 200) throw new RangeError("a name of 1 to 200 characters");
    const settings = Object.entries(input.settings ?? {});
    if (settings.length && !this.o.settings)
      throw new Error("initial settings need TenantBootstrapOptions.settings");
    const want = {
      product: input.product,
      name,
      residency: input.residency ?? "IN",
      org_id: input.orgId ?? null,
      plan_ref: input.planRef ?? null,
      brand_id: input.brandId ?? null,
    };
    // The new tenant's own context, still platform-scoped: the tenant row needs platform scope,
    // and the settings and the ledger entry belong to the new tenant.
    const ctx: KernelContext = { ...caller, tenantId: input.tenantId, scope: "platform" };
    delete ctx.entityId;
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const inserted = await tx.query(
          `insert into tenancy.tenant (id, org_id, product, name, residency, brand_id, plan_ref)
           values ($1, $2, $3, $4, $5, $6, $7) on conflict (id) do nothing`,
          [
            input.tenantId,
            want.org_id,
            want.product,
            want.name,
            want.residency,
            want.brand_id,
            want.plan_ref,
          ],
        );
        if (!inserted.rowCount) {
          const r = await tx.query<TenantRow>(
            `select product, name, residency, org_id, plan_ref, brand_id, status
               from tenancy.tenant where id = $1 for update`,
            [input.tenantId],
          );
          const have = r.rows[0];
          const same =
            have &&
            have.status === "active" &&
            (Object.keys(want) as Array<keyof typeof want>).every((k) => have[k] === want[k]);
          if (!same)
            throw new ConflictError(
              `tenant ${input.tenantId} already exists with another request (IPB-PORT-004)`,
            );
          // A retry: nothing written again. The ledger entry records that it was seen.
          await this.o.audit.record(tx, {
            action: `${TENANT_BOOTSTRAP_ACTION}.replay`,
            resourceType: "tenant",
            resourceId: input.tenantId,
            after: { provisioning_request_id: provisioningRequestId },
          });
          return { tenantId: input.tenantId, created: false };
        }
        await this.o.audit.record(tx, {
          action: TENANT_BOOTSTRAP_ACTION,
          resourceType: "tenant",
          resourceId: input.tenantId,
          after: {
            ...want,
            via: provisioningRequestId ? "provisioning" : "direct",
            provisioning_request_id: provisioningRequestId,
            settings: settings.map(([k]) => k).sort(),
          },
        });
        for (const [key, value] of settings)
          await (this.o.settings as TenantInitialSettings).setInitial(tx, key, value);
        if (input.onCreated) await input.onCreated(tx);
        return { tenantId: input.tenantId, created: true };
      },
      { action: TENANT_BOOTSTRAP_ACTION },
    );
  }
}
