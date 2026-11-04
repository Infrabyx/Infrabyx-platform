// Sandbox tenants (LawDocsComply PR-LDC-29; R1-plan M60; R1-D-87). `tenancy.tenant.sandbox` is
// set when the tenant is created (`TenantBootstrap`) and changed only here: a PLT_SUPER_ADMIN in a
// platform context, with a reason, in one ledgered transaction whose ledger entry lands in the
// tenant changed. The database refuses any other change (tenancy/0018 trigger), so a tenant's own
// request can never take itself out of the sandbox. The kernel reads the flag into `tx.ctx.sandbox`
// in every transaction; NOTIFY and the AI gateway honour it there.
import { IpbError } from "@infrabyx/contracts/errors";
import type { AuditSink, KernelContext, MutationKernel } from "@infrabyx/contracts/kernel";
import { NotFoundError } from "./errors.js";

export const TENANT_SANDBOX_SET_ACTION = "tenancy.tenant.sandbox.set";
/** Platform roles that may change a tenant's sandbox flag. */
export const TENANT_SANDBOX_ROLES: readonly string[] = ["PLT_SUPER_ADMIN"];
const TENANT_ID = /^tnt_[a-z0-9_]+$|^tnt_[0-9A-HJKMNP-TV-Z]{26}$/;

export interface TenantSandboxOptions {
  kernel: MutationKernel;
  audit: AuditSink;
}

export class TenantSandbox {
  constructor(private readonly o: TenantSandboxOptions) {}

  /** The tenant's flag as stored (platform context). */
  async get(caller: KernelContext, tenantId: string): Promise<boolean> {
    this.assertPlatform(caller);
    return this.o.kernel.read(this.contextFor(caller, tenantId), async (tx) => {
      const r = await tx.query<{ sandbox: boolean }>(
        "select sandbox from tenancy.tenant where id = $1",
        [tenantId],
      );
      if (!r.rows[0]) throw new NotFoundError("tenant");
      return r.rows[0].sandbox;
    });
  }

  /**
   * Put a tenant in or take it out of the sandbox. Ledgered in that tenant with the reason, also
   * when the flag already had the value (`changed: false`).
   */
  async set(
    caller: KernelContext,
    tenantId: string,
    sandbox: boolean,
    reason: string,
  ): Promise<{ changed: boolean }> {
    this.assertPlatform(caller);
    if (!TENANT_SANDBOX_ROLES.some((r) => caller.principal.roles.includes(r)))
      throw new IpbError("IPB-SEC-005", {
        detail: `a tenant's sandbox flag is changed by ${TENANT_SANDBOX_ROLES.join(" or ")}`,
      });
    const why = reason.trim();
    if (why.length < 10 || why.length > 500)
      throw new RangeError("a reason of 10 to 500 characters");
    if (typeof sandbox !== "boolean") throw new TypeError("sandbox is true or false");
    return this.o.kernel.mutate(
      this.contextFor(caller, tenantId),
      async (tx) => {
        const r = await tx.query<{ sandbox: boolean }>(
          "select sandbox from tenancy.tenant where id = $1 for update",
          [tenantId],
        );
        const before = r.rows[0];
        if (!before) throw new NotFoundError("tenant");
        const changed = before.sandbox !== sandbox;
        if (changed)
          await tx.query("update tenancy.tenant set sandbox = $2 where id = $1", [
            tenantId,
            sandbox,
          ]);
        await this.o.audit.record(tx, {
          action: TENANT_SANDBOX_SET_ACTION,
          resourceType: "tenant",
          resourceId: tenantId,
          before: { sandbox: before.sandbox },
          after: { sandbox, changed, reason: why },
        });
        return { changed };
      },
      { action: TENANT_SANDBOX_SET_ACTION, reason: why },
    );
  }

  private assertPlatform(caller: KernelContext): void {
    if (caller.scope !== "platform")
      throw new IpbError("IPB-SEC-005", {
        detail: "a tenant's sandbox flag is read and changed in a platform context",
      });
  }

  /** The changed tenant's own context, still platform-scoped, so the ledger entry lands there. */
  private contextFor(caller: KernelContext, tenantId: string): KernelContext {
    if (!TENANT_ID.test(tenantId)) throw new RangeError("a tenant id is tnt_ followed by an id");
    const ctx: KernelContext = { ...caller, tenantId, scope: "platform" };
    delete ctx.entityId;
    return ctx;
  }
}
