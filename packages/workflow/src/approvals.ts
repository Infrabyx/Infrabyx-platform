// Maker-checker around the tenancy engine (PL3 plan §5.1–5.5, PL3-D-07, PL3-D-08, PL3-D-19).
// `ApprovalWorkflow` observes every transition inside its transaction and keeps the Work Inbox,
// scheduled actions and timers in step: checkers get an approval item (never the maker); a delayed
// approval becomes a scheduled action that a timer executes; pending requests are reminded at
// 24 hours (or the tenant's shorter `mc.reminder_hours`), escalated to ORG_ADMIN at 48 hours and
// expired at `expires_at`. The engine stays the only place a request is decided or executed.
import { IpbError } from "@infrabyx/contracts/errors";
import type {
  AuditSink,
  KernelContext,
  MutationKernel,
  OutboxWriter,
  Tx,
} from "@infrabyx/contracts/kernel";
import { internalEvent } from "@infrabyx/config/events";
import { newId, type SecretKey } from "@infrabyx/crypto";
import {
  APPROVAL_ESCALATION_HOURS,
  APPROVAL_REMINDER_HOURS,
  ConflictError,
  NotFoundError,
  type ApprovalObserver,
  type ApprovalRecord,
  type ApprovalsEngine,
} from "@infrabyx/tenancy";
import type { InboxItem, InboxService } from "./inbox.js";
import type { DueTimer, TimerKind, WorkflowTimers } from "./timers.js";

const HOUR = 3_600_000;
const PENDING_TIMERS: readonly TimerKind[] = [
  "approval.remind",
  "approval.escalate",
  "approval.expire",
];

/**
 * Sends the mandatory NOTIFY classes `approval.reminder` and `approval.escalated` (session 4), and
 * `inbox.escalated` for escalated inbox items (UNDETERMINED rule decisions, PL3-D-21).
 */
export interface ApprovalNotifier {
  reminder(tx: Tx, r: ApprovalRecord, checkerRoles: readonly string[]): Promise<void>;
  escalated(tx: Tx, r: ApprovalRecord, role: string): Promise<void>;
  itemEscalated?(
    tx: Tx,
    item: InboxItem,
    role: string,
    excludePrincipal: string | null,
  ): Promise<void>;
}

export interface ApprovalWorkflowOptions {
  kernel: MutationKernel;
  audit: AuditSink;
  inbox: InboxService;
  timers: WorkflowTimers;
  product: string;
  outbox?: OutboxWriter;
  notifier?: ApprovalNotifier;
  /** The tenant's `mc.reminder_hours` (1–24; only ever shortens the 24 h reminder). */
  reminderHours?: (ctx: KernelContext) => Promise<number>;
  /** `ux.bulk.confirm_threshold` for `decideMany` (IPB-07-14; default 20). */
  bulkThreshold?: (ctx: KernelContext) => Promise<number>;
  pseudonymKey?: SecretKey;
}

export interface ScheduledAction {
  id: string;
  approvalId: string;
  action: string;
  executeAt: Date;
  state: "scheduled" | "executed" | "cancelled" | "failed";
  attempts: number;
  lastErrorCode: string | null;
}

interface ScaRow {
  id: string;
  approval_id: string;
  action: string;
  execute_at: Date;
  state: ScheduledAction["state"];
  attempts: number;
  last_error_code: string | null;
}
const toSca = (r: ScaRow): ScheduledAction => ({
  id: r.id,
  approvalId: r.approval_id,
  action: r.action,
  executeAt: r.execute_at,
  state: r.state,
  attempts: r.attempts,
  lastErrorCode: r.last_error_code,
});

export type BulkResult =
  { id: string; ok: true; state: string } | { id: string; ok: false; code: string };

export class ApprovalWorkflow implements ApprovalObserver {
  private engine: ApprovalsEngine | null = null;

  constructor(private readonly o: ApprovalWorkflowOptions) {
    o.timers
      .on("approval.execute", (ctx, t) => this.fireExecute(ctx, t))
      .on("approval.remind", (ctx, t) => this.fireOn(ctx, t, (e) => e.remind(ctx, t.ref)))
      .on("approval.escalate", (ctx, t) => this.fireOn(ctx, t, (e) => e.escalate(ctx, t.ref)))
      .on("approval.expire", (ctx, t) => this.fireOn(ctx, t, (e) => e.expire(ctx, t.ref)));
  }

  /** Connect the engine (constructed with this workflow among its `observers`). */
  attach(engine: ApprovalsEngine): this {
    this.engine = engine;
    return this;
  }

  private get approvals(): ApprovalsEngine {
    if (!this.engine) throw new Error("ApprovalWorkflow.attach(engine) was not called");
    return this.engine;
  }

  // ------------------------------------------------------------------ observer (same transaction)

  async onRequested(tx: Tx, r: ApprovalRecord): Promise<void> {
    for (const role of await this.approvals.checkerRolesFor(tx.ctx, r.action))
      await this.o.inbox.raise(
        tx,
        {
          type: "approval",
          productModule: "approvals",
          recordRef: r.id,
          title: `Approval needed: ${r.action} (${r.riskClass})`,
          assignee: { kind: "role", id: role },
          severity: r.riskClass === "R4" || r.riskClass === "R5" ? "warning" : "info",
          actionHint: "decide",
          deepLink: `/approvals/${r.id}`,
          helpKey: "hlp.approvals.request",
          dueAt: r.expiresAt.toISOString(),
        },
        { excludePrincipal: r.makerId },
      );
    const remindH = Math.min(
      APPROVAL_REMINDER_HOURS,
      Math.max(1, (await this.o.reminderHours?.(tx.ctx)) ?? APPROVAL_REMINDER_HOURS),
    );
    const at = (h: number) => new Date(r.createdAt.getTime() + h * HOUR);
    if (at(remindH) < r.expiresAt)
      await this.o.timers.schedule(tx, "approval.remind", r.id, at(remindH));
    if (at(APPROVAL_ESCALATION_HOURS) < r.expiresAt)
      await this.o.timers.schedule(tx, "approval.escalate", r.id, at(APPROVAL_ESCALATION_HOURS));
    await this.o.timers.schedule(tx, "approval.expire", r.id, r.expiresAt);
  }

  async onDecided(tx: Tx, r: ApprovalRecord): Promise<void> {
    if (r.state === "rejected") return this.closed(tx, r, "rejected");
    if (r.state !== "approved") return;
    await this.o.timers.cancel(tx, r.id, PENDING_TIMERS);
    await this.o.inbox.resolveFor(tx, "approvals", r.id, "approved", ["approval", "due"]);
    if (!r.delayUntil || r.delayMinutes === 0) return;
    const id = newId("sca");
    await tx.query(
      `insert into workflow.scheduled_action (id, tenant_id, approval_id, action, execute_at)
       values ($1, $2, $3, $4, $5)`,
      [id, tx.ctx.tenantId, r.id, r.action, r.delayUntil],
    );
    await this.o.audit.record(tx, {
      action: "workflow.scheduled_action.create",
      resourceType: "scheduled_action",
      resourceId: id,
      after: { approval_id: r.id, action: r.action, execute_at: r.delayUntil.toISOString() },
    });
    await this.emit(tx, "ScheduledActionCreated", {
      scheduled_action_id: id,
      request_id: r.id,
      action: r.action,
      execute_at: r.delayUntil.toISOString(),
    });
    await this.o.timers.schedule(tx, "approval.execute", id, r.delayUntil);
    // Checkers and the owner see what will run, and when, until it runs (@IPB-07-AT-07).
    for (const role of await this.approvals.checkerRolesFor(tx.ctx, r.action))
      await this.o.inbox.raise(tx, {
        type: "due",
        productModule: "approvals",
        recordRef: r.id,
        title: `Scheduled: ${r.action} runs at ${r.delayUntil.toISOString()}`,
        assignee: { kind: "role", id: role },
        actionHint: "cancel_scheduled",
        deepLink: `/audit/scheduled-actions/${id}`,
        helpKey: "hlp.approvals.scheduled_action",
        dueAt: r.delayUntil.toISOString(),
      });
  }

  async onExecuted(tx: Tx, r: ApprovalRecord): Promise<void> {
    const sca = await this.scheduledFor(tx, r.id);
    if (sca && sca.state === "scheduled") {
      await this.setSca(tx, sca.id, "executed");
      await this.emit(tx, "ScheduledActionExecuted", {
        scheduled_action_id: sca.id,
        request_id: r.id,
        action: r.action,
        execute_at: sca.execute_at.toISOString(),
      });
      await this.o.timers.cancel(tx, sca.id, ["approval.execute"]);
    }
    await this.closed(tx, r, "executed");
  }

  async onCancelled(tx: Tx, r: ApprovalRecord): Promise<void> {
    const sca = await this.scheduledFor(tx, r.id);
    if (sca && sca.state === "scheduled") {
      await this.setSca(tx, sca.id, "cancelled");
      await this.emit(tx, "ScheduledActionCancelled", {
        scheduled_action_id: sca.id,
        request_id: r.id,
        action: r.action,
        execute_at: sca.execute_at.toISOString(),
      });
      await this.o.timers.cancel(tx, sca.id, ["approval.execute"]);
    }
    await this.closed(tx, r, "cancelled");
  }

  async onExpired(tx: Tx, r: ApprovalRecord): Promise<void> {
    await this.closed(tx, r, "expired");
  }

  async onReminded(tx: Tx, r: ApprovalRecord): Promise<void> {
    const roles = await this.approvals.checkerRolesFor(tx.ctx, r.action);
    for (const role of roles)
      await this.o.inbox.raise(
        tx,
        {
          type: "due",
          productModule: "approvals",
          recordRef: r.id,
          title: `Reminder: ${r.action} is waiting for a decision`,
          assignee: { kind: "role", id: role },
          actionHint: "decide",
          deepLink: `/approvals/${r.id}`,
          helpKey: "hlp.approvals.reminder",
          dueAt: r.expiresAt.toISOString(),
        },
        { excludePrincipal: r.makerId },
      );
    await this.o.notifier?.reminder(tx, r, roles);
  }

  async onEscalated(tx: Tx, r: ApprovalRecord, role: string): Promise<void> {
    await this.o.inbox.raise(
      tx,
      {
        type: "due",
        productModule: "approvals",
        recordRef: r.id,
        title: `Escalated: ${r.action} pending for ${APPROVAL_ESCALATION_HOURS} hours`,
        assignee: { kind: "role", id: role },
        severity: "warning",
        actionHint: "follow_up",
        deepLink: `/approvals/${r.id}`,
        helpKey: "hlp.approvals.escalated",
        dueAt: r.expiresAt.toISOString(),
      },
      { excludePrincipal: r.makerId },
    );
    await this.o.notifier?.escalated(tx, r, role);
  }

  // ------------------------------------------------------------------ API

  /** Scheduled actions of the tenant (Audit trails › Scheduled actions). */
  async listScheduled(
    ctx: KernelContext,
    state?: ScheduledAction["state"],
  ): Promise<ScheduledAction[]> {
    return this.o.kernel.read(ctx, async (tx) => {
      const r = await tx.query<ScaRow>(
        `select * from workflow.scheduled_action where ($1::text is null or state = $1)
          order by execute_at`,
        [state ?? null],
      );
      return r.rows.map(toSca);
    });
  }

  /** Execute a scheduled action by hand; before `execute_at` it is IPB-UX-005 (@IPB-07-AT-07). */
  async executeScheduled(ctx: KernelContext, id: string): Promise<ApprovalRecord> {
    const sca = await this.loadSca(ctx, id);
    if (sca.state !== "scheduled")
      throw new ConflictError(`scheduled action ${id} is ${sca.state}`);
    if (sca.executeAt.getTime() > Date.now())
      throw new IpbError("IPB-UX-005", {
        meta: { scheduled_action_id: id, execute_at: sca.executeAt.toISOString() },
      });
    try {
      return await this.approvals.execute(ctx, sca.approvalId);
    } catch (e) {
      if ((e as { code?: string }).code === "IPB-SEC-008")
        throw new IpbError("IPB-UX-005", { meta: { scheduled_action_id: id } });
      throw e;
    }
  }

  /** Cancel a scheduled action until it runs: the maker, ORG_OWNER or PLT_SECURITY_OFFICER. */
  async cancelScheduled(ctx: KernelContext, id: string): Promise<ApprovalRecord> {
    const sca = await this.loadSca(ctx, id);
    if (sca.state !== "scheduled")
      throw new ConflictError(`scheduled action ${id} is ${sca.state}`);
    return this.approvals.cancel(ctx, sca.approvalId);
  }

  /**
   * Bulk decide (IPB-07-14, @IPB-07-AT-09): each request is decided on its own, with its own ledger
   * entry. Above `ux.bulk.confirm_threshold` the caller must type `<decision> <count>` (for example
   * `approve 25`), or nothing is decided (IPB-UX-006).
   */
  async decideMany(
    ctx: KernelContext,
    ids: readonly string[],
    decision: "approve" | "reject",
    opts: { confirmation?: string; reason?: string } = {},
  ): Promise<BulkResult[]> {
    const unique = [...new Set(ids)];
    const threshold = (await this.o.bulkThreshold?.(ctx)) ?? 20;
    if (unique.length > threshold && opts.confirmation?.trim() !== `${decision} ${unique.length}`)
      throw new IpbError("IPB-UX-006", {
        meta: { count: unique.length, threshold, expected: `${decision} ${unique.length}` },
      });
    const out: BulkResult[] = [];
    for (const id of unique) {
      try {
        const r = await this.approvals.decide(ctx, id, decision, opts.reason);
        out.push({ id, ok: true, state: r.state });
      } catch (e) {
        out.push({ id, ok: false, code: (e as { code?: string }).code ?? (e as Error).name });
      }
    }
    return out;
  }

  // ------------------------------------------------------------------ timer handlers

  private async fireExecute(ctx: KernelContext, t: DueTimer): Promise<"done" | "stale"> {
    const sca = await this.o.kernel.read(ctx, async (tx) => {
      const r = await tx.query<ScaRow>("select * from workflow.scheduled_action where id = $1", [
        t.ref,
      ]);
      return r.rows[0];
    });
    if (!sca || sca.state !== "scheduled") return "stale";
    try {
      await this.approvals.execute(ctx, sca.approval_id);
      return "done";
    } catch (e) {
      if (e instanceof ConflictError || (e as { code?: string }).code === "IPB-UX-012")
        return "stale";
      await this.o.kernel.mutate(
        ctx,
        async (tx) => {
          await tx.query(
            `update workflow.scheduled_action set attempts = attempts + 1, last_error_code = $2,
                    updated_at = now() where id = $1`,
            [sca.id, (e as { code?: string }).code ?? (e as Error).name],
          );
          await this.o.audit.record(tx, {
            action: "workflow.scheduled_action.attempt",
            resourceType: "scheduled_action",
            resourceId: sca.id,
            after: { error: (e as { code?: string }).code ?? (e as Error).name },
          });
        },
        { action: "workflow.scheduled_action.attempt" },
      );
      throw e;
    }
  }

  private async fireOn(
    _ctx: KernelContext,
    _t: DueTimer,
    run: (e: ApprovalsEngine) => Promise<unknown>,
  ): Promise<"done" | "stale"> {
    try {
      await run(this.approvals);
      return "done";
    } catch (e) {
      if (e instanceof ConflictError || e instanceof NotFoundError) return "stale";
      throw e;
    }
  }

  /** A timer given up after its retries: the scheduled action fails and its checkers are told. */
  async onTimerGiveUp(tx: Tx, t: DueTimer, error: string): Promise<void> {
    if (t.kind !== "approval.execute") return;
    const r = await tx.query<ScaRow>(
      "update workflow.scheduled_action set state = 'failed', updated_at = now() where id = $1 and state = 'scheduled' returning *",
      [t.ref],
    );
    const sca = r.rows[0];
    if (!sca) return;
    for (const role of await this.approvals.checkerRolesFor(tx.ctx, sca.action))
      await this.o.inbox.raise(tx, {
        type: "job_failed",
        productModule: "approvals",
        recordRef: sca.approval_id,
        title: `Scheduled ${sca.action} failed (${error})`,
        assignee: { kind: "role", id: role },
        severity: "critical",
        actionHint: "review_failed",
        deepLink: `/audit/scheduled-actions/${sca.id}`,
        helpKey: "hlp.approvals.scheduled_failed",
      });
  }

  // ------------------------------------------------------------------ helpers

  private async closed(tx: Tx, r: ApprovalRecord, resolution: string): Promise<void> {
    await this.o.timers.cancel(tx, r.id, PENDING_TIMERS);
    await this.o.inbox.resolveFor(tx, "approvals", r.id, resolution);
  }

  private async scheduledFor(tx: Tx, approvalId: string): Promise<ScaRow | undefined> {
    const r = await tx.query<ScaRow>(
      "select * from workflow.scheduled_action where approval_id = $1 for update",
      [approvalId],
    );
    return r.rows[0];
  }

  private async setSca(tx: Tx, id: string, state: ScheduledAction["state"]): Promise<void> {
    await tx.query(
      "update workflow.scheduled_action set state = $2, updated_at = now() where id = $1",
      [id, state],
    );
    await this.o.audit.record(tx, {
      action: `workflow.scheduled_action.${state}`,
      resourceType: "scheduled_action",
      resourceId: id,
      after: { state },
    });
  }

  private async loadSca(ctx: KernelContext, id: string): Promise<ScheduledAction> {
    const row = await this.o.kernel.read(ctx, async (tx) => {
      const r = await tx.query<ScaRow>("select * from workflow.scheduled_action where id = $1", [
        id,
      ]);
      return r.rows[0];
    });
    if (!row) throw new NotFoundError("scheduled action");
    return toSca(row);
  }

  private async emit(
    tx: Tx,
    event: "ScheduledActionCreated" | "ScheduledActionExecuted" | "ScheduledActionCancelled",
    data: Record<string, unknown>,
  ): Promise<void> {
    if (!this.o.outbox) return;
    const envelope = internalEvent({
      product: this.o.product,
      event,
      tenantId: tx.ctx.tenantId,
      data,
      actorId: tx.ctx.principal.id,
      ...(this.o.pseudonymKey ? { pseudonymKey: this.o.pseudonymKey } : {}),
      ...(tx.ctx.traceId ? { traceId: tx.ctx.traceId } : {}),
    });
    await this.o.outbox.publish(tx, "workflow", { envelope });
  }
}

/**
 * The standard `RefundApprovals` for `@infrabyx/connectors/payments` (PL3 plan §5.5): products
 * register `payments.refund` (financial, R3) on the engine and pass this to the PAYMENTS adapters.
 */
export function engineRefundApprovals(
  engine: ApprovalsEngine,
  context: () => KernelContext,
): {
  get(
    ref: string,
  ): Promise<{ action: string; state: string; payloadDigest: string; delayUntil: Date | null }>;
} {
  return {
    async get(ref) {
      const r = await engine.get(context(), ref);
      return {
        action: r.action,
        state: r.state,
        payloadDigest: r.payloadDigest,
        delayUntil: r.delayUntil,
      };
    },
  };
}
