// Named tenant functions (Finbyx PR-FBX-20; IPB-02-33; R1-D-39). A regulated tenant names the
// people who hold statutory functions: the CRO vets a product, the CCO approves it, the compliance
// officer acts in their own right; a product registers more (`FN:PRINCIPAL_OFFICER`, …).
//
// * `requestAssign` raises an R3 `tenancy.function.assign` request through the tenant's approvals
//   engine; its executor (registered by `register(engine)`) writes the assignment, refusing when the
//   assignee approved it. ORG_OWNER and ORG_ADMIN check it; the engine keeps maker ≠ checker.
// * `revoke` ends an assignment at once (ORG_OWNER or ORG_ADMIN), with a reason, ledgered.
// * `withFunctions(ctx)` returns the context with the person's active functions added to its roles,
//   so `mc.checker_roles.<action>` (`FN:` entries) and an action's `checkerFunctions` can test them.
import { IpbError } from "@infrabyx/contracts/errors";
import type { AuditSink, KernelContext, MutationKernel, Tx } from "@infrabyx/contracts/kernel";
import { FUNCTION_ROLE_REGEX, PLATFORM_FUNCTIONS } from "@infrabyx/contracts/roles";
import { newId } from "@infrabyx/crypto";
import type { ApprovalRecord, ApprovalsEngine } from "./approvals/engine.js";
import { ConflictError, NotFoundError } from "./errors.js";

export const FUNCTION_ASSIGN_ACTION = "tenancy.function.assign";
const MANAGERS = ["ORG_OWNER", "ORG_ADMIN"];

export interface FunctionAssignment {
  id: string;
  userId: string;
  function: string;
  requestId: string;
  makerId: string;
  approvedBy: string;
  assignedAt: string;
  revokedAt: string | null;
}

interface Row {
  id: string;
  user_id: string;
  function: string;
  request_id: string;
  maker_id: string;
  approved_by: string;
  assigned_at: Date;
  revoked_at: Date | null;
}

const COLUMNS = "id, user_id, function, request_id, maker_id, approved_by, assigned_at, revoked_at";

const toAssignment = (r: Row): FunctionAssignment => ({
  id: r.id,
  userId: r.user_id,
  function: r.function,
  requestId: r.request_id,
  makerId: r.maker_id,
  approvedBy: r.approved_by,
  assignedAt: r.assigned_at.toISOString(),
  revokedAt: r.revoked_at ? r.revoked_at.toISOString() : null,
});

function assertManager(ctx: KernelContext, what: string): void {
  if (ctx.scope === "platform" || ctx.principal.type !== "user")
    throw new IpbError("IPB-SEC-005", { detail: `${what} is done in the tenant by a named user` });
  if (!ctx.principal.roles.some((r) => MANAGERS.includes(r)))
    throw new IpbError("IPB-UX-011", { detail: `needs one of ${MANAGERS.join(", ")}` });
}

export class TenantFunctions {
  private readonly known: ReadonlySet<string>;

  constructor(
    private readonly o: {
      kernel: MutationKernel;
      audit: AuditSink;
      approvals: ApprovalsEngine;
      /** The product's own functions, `FN:<CODE>`; the platform's three are always known. */
      functions?: readonly string[];
    },
  ) {
    for (const f of o.functions ?? [])
      if (!FUNCTION_ROLE_REGEX.test(f)) throw new RangeError(`function ${f} must match FN:<CODE>`);
    this.known = new Set([...PLATFORM_FUNCTIONS, ...(o.functions ?? [])]);
  }

  /** The functions a tenant may assign. */
  list(): string[] {
    return [...this.known];
  }

  /** Register the assignment's checker roles and executor on the tenant's approvals engine. */
  register(engine: ApprovalsEngine = this.o.approvals): this {
    engine.register(FUNCTION_ASSIGN_ACTION, {
      checkerRoles: MANAGERS,
      execute: (tx, payload, request) => this.executeAssign(tx, payload, request),
    });
    return this;
  }

  /** Ask for `userId` to hold `fn`; a different ORG_OWNER or ORG_ADMIN approves (R3). */
  async requestAssign(
    ctx: KernelContext,
    d: { userId: string; function: string; reason: string },
  ): Promise<{ requestId: string }> {
    assertManager(ctx, "assigning a function");
    if (!this.known.has(d.function)) throw new RangeError(`unknown function ${d.function}`);
    if (d.reason.trim().length < 5) throw new RangeError("a reason of at least 5 characters");
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const member = await tx.query(
          "select 1 from tenancy.membership where tenant_id = $1 and user_id = $2",
          [ctx.tenantId, d.userId],
        );
        if (!member.rows.length) throw new NotFoundError("member");
        const held = await tx.query(
          `select 1 from tenancy.function_assignment
            where tenant_id = $1 and user_id = $2 and function = $3 and revoked_at is null`,
          [ctx.tenantId, d.userId, d.function],
        );
        if (held.rows.length) throw new ConflictError("the person already holds this function");
        const { id } = await this.o.approvals.request(tx, {
          action: FUNCTION_ASSIGN_ACTION,
          riskClass: "R3",
          payload: { user_id: d.userId, function: d.function, reason: d.reason.trim() },
          payloadDataClass: "INTERNAL",
          summary: `Assign ${d.function} to ${d.userId}`,
          diff: { before: null, after: { user_id: d.userId, function: d.function } },
        });
        await this.o.audit.record(tx, {
          action: "tenancy.function.request",
          resourceType: "approval_request",
          resourceId: id,
          after: { user_id: d.userId, function: d.function },
        });
        return { requestId: id };
      },
      { action: "tenancy.function.request" },
    );
  }

  private async executeAssign(
    tx: Tx,
    payload: Record<string, unknown>,
    request: ApprovalRecord,
  ): Promise<void> {
    const userId = String(payload.user_id);
    const fn = String(payload.function);
    if (!this.known.has(fn)) throw new RangeError(`unknown function ${fn}`);
    const checkers = await tx.query<{ checker_id: string }>(
      `select checker_id from tenancy.approval_decision
        where request_id = $1 and decision = 'approve' order by decided_at desc`,
      [request.id],
    );
    const ids = checkers.rows.map((r) => r.checker_id);
    if (ids.includes(userId))
      throw new IpbError("IPB-SEC-006", {
        detail: "a person cannot approve their own assignment to a function",
      });
    const approvedBy = ids[0];
    if (!approvedBy) throw new ConflictError("the request has no approving checker");
    const id = newId("fna");
    await tx.query(
      `insert into tenancy.function_assignment
         (id, tenant_id, user_id, function, request_id, maker_id, approved_by, reason)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, request.tenantId, userId, fn, request.id, request.makerId, approvedBy, payload.reason],
    );
    await this.o.audit.record(tx, {
      action: "tenancy.function.assign",
      resourceType: "function_assignment",
      resourceId: id,
      after: { user_id: userId, function: fn, request_id: request.id, approved_by: approvedBy },
    });
  }

  /** End an assignment at once (ORG_OWNER or ORG_ADMIN), with a reason. */
  async revoke(ctx: KernelContext, assignmentId: string, reason: string): Promise<void> {
    assertManager(ctx, "revoking a function");
    if (reason.trim().length < 5) throw new RangeError("a reason of at least 5 characters");
    await this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const r = await tx.query<Row>(
          `update tenancy.function_assignment
              set revoked_at = now(), revoked_by = $2, revoke_reason = $3
            where id = $1 and revoked_at is null returning ${COLUMNS}`,
          [assignmentId, ctx.principal.id, reason.trim()],
        );
        const row = r.rows[0];
        if (!row) throw new NotFoundError("active function assignment");
        await this.o.audit.record(tx, {
          action: "tenancy.function.revoke",
          resourceType: "function_assignment",
          resourceId: assignmentId,
          before: { revoked: false },
          after: { revoked: true, user_id: row.user_id, function: row.function },
        });
      },
      { action: "tenancy.function.revoke" },
    );
  }

  /** The tenant's assignments, active only unless `all`. */
  async assignments(
    ctx: KernelContext,
    opts: { all?: boolean } = {},
  ): Promise<FunctionAssignment[]> {
    return this.o.kernel.read(ctx, async (tx) => {
      const r = await tx.query<Row>(
        `select ${COLUMNS} from tenancy.function_assignment
          where tenant_id = $1 ${opts.all ? "" : "and revoked_at is null"}
          order by assigned_at, id`,
        [ctx.tenantId],
      );
      return r.rows.map(toAssignment);
    });
  }

  /** The active functions of the context's person in its tenant. */
  async functionsOf(ctx: KernelContext): Promise<string[]> {
    if (ctx.scope === "platform" || ctx.principal.type !== "user") return [];
    return this.o.kernel.read(ctx, async (tx) => {
      const r = await tx.query<{ function: string }>(
        `select function from tenancy.function_assignment
          where tenant_id = $1 and user_id = $2 and revoked_at is null order by function`,
        [ctx.tenantId, ctx.principal.id],
      );
      return r.rows.map((x) => x.function).filter((f) => this.known.has(f));
    });
  }

  /**
   * The context with the person's active functions added to its roles. Call it once per request
   * after the token is verified; `FN:` roles that came from anywhere else are removed first.
   */
  async withFunctions(ctx: KernelContext): Promise<KernelContext> {
    const fns = await this.functionsOf(ctx);
    const base = ctx.principal.roles.filter((r) => !FUNCTION_ROLE_REGEX.test(r));
    return { ...ctx, principal: { ...ctx.principal, roles: [...base, ...fns] } };
  }
}
