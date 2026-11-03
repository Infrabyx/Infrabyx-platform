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
//
// A function's policy (Finbyx PR-FBX-31; R1-D-46) can make it held per legal entity (an entity
// reference and the product's officer-register row), by one person at a time for the tenant or
// entity (a unique index, 0014), and ended only through an approved R3 `tenancy.function.revoke`
// request. Without a policy a function behaves as in R1-D-39.
import { IpbError } from "@infrabyx/contracts/errors";
import type { AuditSink, KernelContext, MutationKernel, Tx } from "@infrabyx/contracts/kernel";
import { FUNCTION_ROLE_REGEX, PLATFORM_FUNCTIONS } from "@infrabyx/contracts/roles";
import { newId } from "@infrabyx/crypto";
import type { ApprovalRecord, ApprovalsEngine } from "./approvals/engine.js";
import { ConflictError, NotFoundError } from "./errors.js";

export const FUNCTION_ASSIGN_ACTION = "tenancy.function.assign";
export const FUNCTION_REVOKE_ACTION = "tenancy.function.revoke";
const MANAGERS = ["ORG_OWNER", "ORG_ADMIN"];
const REF = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/;
const REGISTER_REF = /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,127}$/;

/** How a function is held and ended (PR-FBX-31; R1-D-46). Every flag defaults to false. */
export interface FunctionPolicy {
  /** Held for one legal entity: an assignment names `entityRef`, and counts only in that entity. */
  perEntity?: boolean;
  /** At most one active holder per tenant (or per entity when `perEntity`). */
  singleHolder?: boolean;
  /** Ended only by an approved `tenancy.function.revoke` request, never at once. */
  checkedRevocation?: boolean;
  /** An assignment must name the product's officer-register row (`registerRef`). */
  registerRequired?: boolean;
}

/** The officer policy Finbyx asked for (PR-FBX-31): per entity, one holder, checked both ways. */
export const OFFICER_POLICY: Readonly<FunctionPolicy> = Object.freeze({
  perEntity: true,
  singleHolder: true,
  checkedRevocation: true,
  registerRequired: true,
});

export interface FunctionAssignment {
  id: string;
  userId: string;
  function: string;
  /** The legal entity it is held for; null when tenant-wide. */
  entityRef: string | null;
  /** The product's officer-register row. */
  registerRef: string | null;
  singleHolder: boolean;
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
  entity_ref: string | null;
  register_ref: string | null;
  single_holder: boolean;
  request_id: string;
  maker_id: string;
  approved_by: string;
  assigned_at: Date;
  revoked_at: Date | null;
}

const COLUMNS =
  "id, user_id, function, entity_ref, register_ref, single_holder, request_id, maker_id, approved_by, assigned_at, revoked_at";

const toAssignment = (r: Row): FunctionAssignment => ({
  id: r.id,
  userId: r.user_id,
  function: r.function,
  entityRef: r.entity_ref,
  registerRef: r.register_ref,
  singleHolder: r.single_holder,
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
  private readonly policies: ReadonlyMap<string, FunctionPolicy>;

  constructor(
    private readonly o: {
      kernel: MutationKernel;
      audit: AuditSink;
      approvals: ApprovalsEngine;
      /** The product's own functions, `FN:<CODE>`; the platform's three are always known. */
      functions?: readonly string[];
      /** Policies by function, for the platform's three or the product's own (PR-FBX-31). */
      policies?: Readonly<Record<string, FunctionPolicy>>;
    },
  ) {
    for (const f of o.functions ?? [])
      if (!FUNCTION_ROLE_REGEX.test(f)) throw new RangeError(`function ${f} must match FN:<CODE>`);
    this.known = new Set([...PLATFORM_FUNCTIONS, ...(o.functions ?? [])]);
    const policies = new Map<string, FunctionPolicy>();
    for (const [f, p] of Object.entries(o.policies ?? {})) {
      if (!this.known.has(f)) throw new RangeError(`policy for unknown function ${f}`);
      policies.set(f, { ...p });
    }
    this.policies = policies;
  }

  /** The policy of a function (all flags false when none was given). */
  policyOf(fn: string): FunctionPolicy {
    return this.policies.get(fn) ?? {};
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
    engine.register(FUNCTION_REVOKE_ACTION, {
      checkerRoles: MANAGERS,
      execute: (tx, payload, request) => this.executeRevoke(tx, payload, request),
    });
    return this;
  }

  /** Ask for `userId` to hold `fn`; a different ORG_OWNER or ORG_ADMIN approves (R3). */
  async requestAssign(
    ctx: KernelContext,
    d: {
      userId: string;
      function: string;
      reason: string;
      /** The legal entity, for a `perEntity` function (required there, refused elsewhere). */
      entityRef?: string;
      /** The product's officer-register row (required by `registerRequired`). */
      registerRef?: string;
    },
  ): Promise<{ requestId: string }> {
    assertManager(ctx, "assigning a function");
    if (!this.known.has(d.function)) throw new RangeError(`unknown function ${d.function}`);
    if (d.reason.trim().length < 5) throw new RangeError("a reason of at least 5 characters");
    const policy = this.policyOf(d.function);
    const entityRef = this.checkEntity(policy, d.function, d.entityRef);
    const registerRef = checkRegister(policy, d.function, d.registerRef);
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const member = await tx.query(
          "select 1 from tenancy.membership where tenant_id = $1 and user_id = $2",
          [ctx.tenantId, d.userId],
        );
        if (!member.rows.length) throw new NotFoundError("member");
        await this.checkFree(tx, ctx.tenantId, d.userId, d.function, policy, entityRef);
        const target = { user_id: d.userId, function: d.function, entity_ref: entityRef };
        const { id } = await this.o.approvals.request(tx, {
          action: FUNCTION_ASSIGN_ACTION,
          riskClass: "R3",
          payload: { ...target, register_ref: registerRef, reason: d.reason.trim() },
          payloadDataClass: "INTERNAL",
          summary: `Assign ${d.function} to ${d.userId}${entityRef ? ` for ${entityRef}` : ""}`,
          diff: { before: null, after: target },
        });
        await this.o.audit.record(tx, {
          action: "tenancy.function.request",
          resourceType: "approval_request",
          resourceId: id,
          after: target,
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
    // The policy in force when the request is executed decides (it may have been tightened since).
    const policy = this.policyOf(fn);
    const entityRef = this.checkEntity(
      policy,
      fn,
      typeof payload.entity_ref === "string" ? payload.entity_ref : undefined,
    );
    const registerRef = checkRegister(
      policy,
      fn,
      typeof payload.register_ref === "string" ? payload.register_ref : undefined,
    );
    await this.checkFree(tx, request.tenantId, userId, fn, policy, entityRef);
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
         (id, tenant_id, user_id, function, request_id, maker_id, approved_by, reason,
          entity_ref, register_ref, single_holder)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        id,
        request.tenantId,
        userId,
        fn,
        request.id,
        request.makerId,
        approvedBy,
        payload.reason,
        entityRef,
        registerRef,
        policy.singleHolder === true,
      ],
    );
    await this.o.audit.record(tx, {
      action: "tenancy.function.assign",
      resourceType: "function_assignment",
      resourceId: id,
      after: {
        user_id: userId,
        function: fn,
        entity_ref: entityRef,
        register_ref: registerRef,
        request_id: request.id,
        approved_by: approvedBy,
      },
    });
  }

  /** A `perEntity` function names a valid entity; any other names none. */
  private checkEntity(policy: FunctionPolicy, fn: string, entityRef?: string): string | null {
    if (!policy.perEntity) {
      if (entityRef !== undefined)
        throw new RangeError(`${fn} is held tenant-wide, not per entity`);
      return null;
    }
    if (!entityRef || !REF.test(entityRef))
      throw new RangeError(`${fn} is held per legal entity: name the entity`);
    return entityRef;
  }

  /** The person does not hold it already, the entity is theirs, and a single holder is free. */
  private async checkFree(
    tx: Tx,
    tenantId: string,
    userId: string,
    fn: string,
    policy: FunctionPolicy,
    entityRef: string | null,
  ): Promise<void> {
    if (entityRef !== null) {
      const m = await tx.query<{ entity_ids: string[] }>(
        "select entity_ids from tenancy.membership where tenant_id = $1 and user_id = $2",
        [tenantId, userId],
      );
      const ids = m.rows[0]?.entity_ids ?? [];
      if (ids.length && !ids.includes(entityRef))
        throw new ConflictError("the person is not a member of that entity");
    }
    const held = await tx.query(
      `select 1 from tenancy.function_assignment
        where tenant_id = $1 and user_id = $2 and function = $3 and revoked_at is null`,
      [tenantId, userId, fn],
    );
    if (held.rows.length) throw new ConflictError("the person already holds this function");
    if (policy.singleHolder) {
      const taken = await tx.query(
        `select 1 from tenancy.function_assignment
          where tenant_id = $1 and function = $2 and coalesce(entity_ref, '') = $3
            and revoked_at is null and single_holder`,
        [tenantId, fn, entityRef ?? ""],
      );
      if (taken.rows.length)
        throw new ConflictError(
          `${fn} already has a holder${entityRef ? ` for ${entityRef}` : ""}; end that assignment first`,
        );
    }
  }

  /**
   * End an assignment at once (ORG_OWNER or ORG_ADMIN), with a reason. A function with
   * `checkedRevocation` is refused here and ended through `requestRevoke`.
   */
  async revoke(ctx: KernelContext, assignmentId: string, reason: string): Promise<void> {
    assertManager(ctx, "revoking a function");
    if (reason.trim().length < 5) throw new RangeError("a reason of at least 5 characters");
    await this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const cur = await this.active(tx, assignmentId);
        if (this.policyOf(cur.function).checkedRevocation)
          throw new IpbError("IPB-SEC-006", {
            detail: `${cur.function} is ended through an approved request (requestRevoke)`,
          });
        await this.end(tx, cur, ctx.principal.id, reason.trim(), null);
      },
      { action: "tenancy.function.revoke" },
    );
  }

  /** Ask to end an assignment; a different ORG_OWNER or ORG_ADMIN approves (R3). */
  async requestRevoke(
    ctx: KernelContext,
    assignmentId: string,
    reason: string,
  ): Promise<{ requestId: string }> {
    assertManager(ctx, "ending a function");
    if (reason.trim().length < 5) throw new RangeError("a reason of at least 5 characters");
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const cur = await this.active(tx, assignmentId);
        const target = {
          assignment_id: cur.id,
          user_id: cur.user_id,
          function: cur.function,
          entity_ref: cur.entity_ref,
        };
        const { id } = await this.o.approvals.request(tx, {
          action: FUNCTION_REVOKE_ACTION,
          riskClass: "R3",
          payload: { ...target, reason: reason.trim() },
          payloadDataClass: "INTERNAL",
          summary: `End ${cur.function} of ${cur.user_id}${cur.entity_ref ? ` for ${cur.entity_ref}` : ""}`,
          diff: { before: { ...target, revoked: false }, after: { ...target, revoked: true } },
        });
        await this.o.audit.record(tx, {
          action: "tenancy.function.revoke_request",
          resourceType: "approval_request",
          resourceId: id,
          after: target,
        });
        return { requestId: id };
      },
      { action: "tenancy.function.revoke_request" },
    );
  }

  private async executeRevoke(
    tx: Tx,
    payload: Record<string, unknown>,
    request: ApprovalRecord,
  ): Promise<void> {
    const cur = await this.active(tx, String(payload.assignment_id));
    const checkers = await tx.query<{ checker_id: string }>(
      `select checker_id from tenancy.approval_decision
        where request_id = $1 and decision = 'approve' order by decided_at desc`,
      [request.id],
    );
    const approvedBy = checkers.rows[0]?.checker_id;
    if (!approvedBy) throw new ConflictError("the request has no approving checker");
    await this.end(tx, cur, approvedBy, String(payload.reason), request.id);
  }

  private async active(tx: Tx, assignmentId: string): Promise<Row> {
    const r = await tx.query<Row>(
      `select ${COLUMNS} from tenancy.function_assignment
        where id = $1 and tenant_id = $2 and revoked_at is null`,
      [assignmentId, tx.ctx.tenantId],
    );
    const row = r.rows[0];
    if (!row) throw new NotFoundError("active function assignment");
    return row;
  }

  private async end(
    tx: Tx,
    cur: Row,
    by: string,
    reason: string,
    requestId: string | null,
  ): Promise<void> {
    const r = await tx.query(
      `update tenancy.function_assignment
          set revoked_at = now(), revoked_by = $2, revoke_reason = $3, revoke_request_id = $4
        where id = $1 and revoked_at is null`,
      [cur.id, by, reason, requestId],
    );
    if (!r.rowCount) throw new NotFoundError("active function assignment");
    await this.o.audit.record(tx, {
      action: "tenancy.function.revoke",
      resourceType: "function_assignment",
      resourceId: cur.id,
      before: { revoked: false },
      after: {
        revoked: true,
        user_id: cur.user_id,
        function: cur.function,
        entity_ref: cur.entity_ref,
        request_id: requestId,
      },
    });
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

  /**
   * The active functions of the context's person in its tenant. A per-entity assignment counts
   * only when the context's `entityId` is its entity.
   */
  async functionsOf(ctx: KernelContext): Promise<string[]> {
    const held = await this.heldBy(ctx);
    const out = new Set<string>();
    for (const h of held)
      if (h.entityRef === null || h.entityRef === ctx.entityId) out.add(h.function);
    return [...out].sort();
  }

  /**
   * The AUTHZ attribute of the context's person (PR-FBX-31): each held function with the entities
   * it is held for, `"*"` for tenant-wide. Pass it as `principal.attr.functions`.
   */
  async authzAttributes(ctx: KernelContext): Promise<{ functions: Record<string, string[]> }> {
    const functions: Record<string, string[]> = {};
    for (const h of await this.heldBy(ctx)) (functions[h.function] ??= []).push(h.entityRef ?? "*");
    for (const k of Object.keys(functions)) functions[k] = [...new Set(functions[k])].sort();
    return { functions };
  }

  private async heldBy(
    ctx: KernelContext,
  ): Promise<Array<{ function: string; entityRef: string | null }>> {
    if (ctx.scope === "platform" || ctx.principal.type !== "user") return [];
    return this.o.kernel.read(ctx, async (tx) => {
      const r = await tx.query<{ function: string; entity_ref: string | null }>(
        `select function, entity_ref from tenancy.function_assignment
          where tenant_id = $1 and user_id = $2 and revoked_at is null order by function, entity_ref`,
        [ctx.tenantId, ctx.principal.id],
      );
      return r.rows
        .filter((x) => this.known.has(x.function))
        .map((x) => ({ function: x.function, entityRef: x.entity_ref }));
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

function checkRegister(policy: FunctionPolicy, fn: string, registerRef?: string): string | null {
  if (registerRef === undefined || registerRef === "") {
    if (policy.registerRequired) throw new RangeError(`${fn} needs the officer-register row`);
    return null;
  }
  if (!REGISTER_REF.test(registerRef)) throw new RangeError("registerRef is not a valid reference");
  return registerRef;
}
