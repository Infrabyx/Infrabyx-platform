// Sandbox tenants (LawDocsComply PR-LDC-29; R1-plan M60; R1-D-87). `tenancy.tenant.sandbox` is
// set when the tenant is created (`TenantBootstrap`) and changed only here, under maker-checker
// (OWNER-QUESTIONS #115, R1-D-95): a PLT_SUPER_ADMIN raises the change with a reason (`request`),
// a different platform approver (PLT_SUPER_ADMIN or PLT_SECURITY_OFFICER) decides it (`decide`),
// and a PLT_SUPER_ADMIN applies the approved change once (`apply`) in its own ledgered
// `tenancy.tenant.sandbox.set` transaction, whose ledger entry lands in the tenant changed. The
// request lives in that tenant, decided in a platform context only. The database refuses any other
// change (tenancy/0018 trigger), so a tenant's own request can never take itself out of the
// sandbox. The kernel reads the flag into `tx.ctx.sandbox` in every transaction; NOTIFY and the AI
// gateway honour it there.
import { IpbError } from "@infrabyx/contracts/errors";
import type { AuditSink, KernelContext, MutationKernel } from "@infrabyx/contracts/kernel";
import type { ApprovalRecord, ApprovalsEngine } from "./approvals/engine.js";
import { NotFoundError } from "./errors.js";

export const TENANT_SANDBOX_SET_ACTION = "tenancy.tenant.sandbox.set";
export const TENANT_SANDBOX_REQUEST_ACTION = "tenancy.tenant.sandbox.request";
/** Platform roles that may raise and apply a change of a tenant's sandbox flag (the maker). */
export const TENANT_SANDBOX_ROLES: readonly string[] = ["PLT_SUPER_ADMIN"];
/** Platform roles that may approve it; never the maker (IPB-SEC-007). */
export const TENANT_SANDBOX_CHECKERS: readonly string[] = [
  "PLT_SUPER_ADMIN",
  "PLT_SECURITY_OFFICER",
];
const TENANT_ID = /^tnt_[a-z0-9_]+$|^tnt_[0-9A-HJKMNP-TV-Z]{26}$/;

export interface TenantSandboxOptions {
  kernel: MutationKernel;
  audit: AuditSink;
  /** The approvals engine the change goes through (#115); without it no change can be made. */
  approvals?: ApprovalsEngine;
}

export class TenantSandbox {
  constructor(private readonly o: TenantSandboxOptions) {
    o.approvals?.register(TENANT_SANDBOX_SET_ACTION, {
      checkerRoles: TENANT_SANDBOX_CHECKERS,
      platformCheckerRoles: TENANT_SANDBOX_CHECKERS,
      autoExecute: false,
    });
  }

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
   * Superseded by maker-checker (#115, R1-D-95): always refused with IPB-SEC-005. Raise the change
   * with `request`, have it approved with `decide`, then `apply` it.
   */
  async set(
    _caller: KernelContext,
    _tenantId: string,
    _sandbox: boolean,
    _reason: string,
  ): Promise<{ changed: boolean }> {
    throw new IpbError("IPB-SEC-005", {
      detail: "a tenant's sandbox flag changes under maker-checker: request, decide, then apply",
    });
  }

  /**
   * Raise a change of a tenant's flag (the maker, a PLT_SUPER_ADMIN, with a reason): an R3
   * approval request in that tenant, decided in a platform context only.
   */
  async request(
    caller: KernelContext,
    tenantId: string,
    sandbox: boolean,
    reason: string,
  ): Promise<{ requestId: string }> {
    this.assertMaker(caller);
    const why = checkReason(reason);
    if (typeof sandbox !== "boolean") throw new TypeError("sandbox is true or false");
    const approvals = this.engine();
    return this.o.kernel.mutate(
      this.contextFor(caller, tenantId),
      async (tx) => {
        const r = await tx.query<{ sandbox: boolean }>(
          "select sandbox from tenancy.tenant where id = $1",
          [tenantId],
        );
        const before = r.rows[0];
        if (!before) throw new NotFoundError("tenant");
        const { id } = await approvals.request(tx, {
          action: TENANT_SANDBOX_SET_ACTION,
          riskClass: "R3",
          payload: { tenant_id: tenantId, sandbox, reason: why },
          summary: `${sandbox ? "Put" : "Take"} tenant ${tenantId} ${sandbox ? "into" : "out of"} the sandbox: ${why}`,
          diff: { before: { sandbox: before.sandbox }, after: { sandbox } },
        });
        return { requestId: id };
      },
      { action: TENANT_SANDBOX_REQUEST_ACTION, reason: why },
    );
  }

  /** Approve or reject a raised change: a platform approver other than the maker. */
  async decide(
    caller: KernelContext,
    tenantId: string,
    requestId: string,
    decision: "approve" | "reject",
    reason?: string,
  ): Promise<ApprovalRecord> {
    this.assertPlatform(caller);
    return this.engine().decide(this.contextFor(caller, tenantId), requestId, decision, reason);
  }

  /**
   * Apply an approved change once (a PLT_SUPER_ADMIN): the approval is used and the flag set in one
   * ledgered `tenancy.tenant.sandbox.set` transaction in the tenant, also when the flag already had
   * the value (`changed: false`).
   */
  async apply(
    caller: KernelContext,
    tenantId: string,
    requestId: string,
  ): Promise<{ changed: boolean }> {
    this.assertMaker(caller);
    const approvals = this.engine();
    return this.o.kernel.mutate(
      this.contextFor(caller, tenantId),
      async (tx) => {
        const { payload, record } = await approvals.consumeIn(
          tx,
          requestId,
          TENANT_SANDBOX_SET_ACTION,
        );
        const sandbox = payload.sandbox;
        const why = payload.reason;
        if (
          payload.tenant_id !== tenantId ||
          typeof sandbox !== "boolean" ||
          typeof why !== "string"
        )
          throw new IpbError("IPB-SEC-005", { detail: "the approval is for another change" });
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
          after: { sandbox, changed, reason: why, approval_request_id: record.id },
        });
        return { changed };
      },
      { action: TENANT_SANDBOX_SET_ACTION },
    );
  }

  private engine(): ApprovalsEngine {
    if (!this.o.approvals)
      throw new IpbError("IPB-SEC-005", {
        detail: "a tenant's sandbox flag changes only under maker-checker (no approvals engine)",
      });
    return this.o.approvals;
  }

  private assertMaker(caller: KernelContext): void {
    this.assertPlatform(caller);
    if (!TENANT_SANDBOX_ROLES.some((r) => caller.principal.roles.includes(r)))
      throw new IpbError("IPB-SEC-005", {
        detail: `a tenant's sandbox change is raised and applied by ${TENANT_SANDBOX_ROLES.join(" or ")}`,
      });
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

function checkReason(reason: string): string {
  const why = typeof reason === "string" ? reason.trim() : "";
  if (why.length < 10 || why.length > 500) throw new RangeError("a reason of 10 to 500 characters");
  return why;
}
