// Tasks (IPB-03-62, 03-71, 03-72, §03.4.7; PL4 plan §8.3, §8.5). The unit of execution and audit:
// QUEUED → RUNNING → NEEDS_INPUT / NEEDS_APPROVAL → DONE / FAILED / CANCELLED. Every transition is a
// compare-and-set on `state`; terminal states never change (a database trigger refuses it too).
// - A tool outside the skill's manifest halts the task (`IPB-AI-040`).
// - A locked action (kernel list, product additions, or `locked: true`) at any level, and a write
//   tool at L2, wait for a human: the task moves to NEEDS_APPROVAL and an approval request is made
//   through the approvals engine (`vidhi.action.<tool>`, R3 at least for locked actions). The
//   approval's executor resumes the task and runs the tool exactly once. This is the
//   `awaitApproval` deferred from PL3.
// - An agent never approves (`IPB-VID-012`); the approver must hold the action's role and cannot be
//   the maker. A decision for a task no longer in NEEDS_APPROVAL is `IPB-VID-022`, so two approvers
//   racing produce one execution, and an approval after a kill switch executes nothing.
// - An agent that tries to run a locked action without approval fails the task, emits
//   `LockedActionAttempted` and demotes the skill (IPB-03-70).
import { IpbError } from "@infrabyx/contracts/errors";
import type {
  AuditSink,
  KernelContext,
  MutationKernel,
  OutboxWriter,
  Tx,
} from "@infrabyx/contracts/kernel";
import {
  autonomyRank,
  type AutonomyLevel,
  type TaskState,
  type VidhiProduct,
} from "@infrabyx/contracts/vidhi";
import {
  ActionExecutedData,
  LockedActionAttemptedData,
  TaskStateChangedData,
  VIDHI_EVENTS,
  VidhiApprovalRequestedData,
} from "@infrabyx/contracts";
import { internalEvent } from "@infrabyx/config/events";
import { newId } from "@infrabyx/crypto";
import type { KillSwitches } from "@infrabyx/ai";
import type { Autonomy } from "./autonomy.js";
import type { SkillRegistry, ToolPolicy } from "./skills.js";

export const actionFor = (tool: string): string => `vidhi.action.${tool}`;

/** A product service method a skill may call. Runs with the agent's (delegated) context. */
export type ToolHandler = (
  ctx: KernelContext,
  args: Record<string, unknown>,
  task: { id: string; skillKey: string },
) => Promise<unknown>;

/** The approvals engine as the runtime uses it (`ApprovalsEngine` from `@infrabyx/tenancy`). */
export interface TaskApprovals {
  register(
    action: string,
    policy: {
      checkerRoles?: readonly string[];
      execute?: (
        tx: Tx,
        payload: Record<string, unknown>,
        request: { id: string },
      ) => Promise<void>;
    },
  ): unknown;
  request(
    tx: Tx,
    input: {
      action: string;
      riskClass: "R2" | "R3";
      payload: Record<string, unknown>;
      payloadDataClass?: "PUBLIC" | "INTERNAL" | "CONFIDENTIAL" | "REGULATED";
      summary?: string;
    },
  ): Promise<{ id: string }>;
  decide(
    ctx: KernelContext,
    id: string,
    decision: "approve" | "reject",
    reason?: string,
  ): Promise<unknown>;
}

export interface TaskRuntimeOptions {
  kernel: MutationKernel;
  audit: AuditSink;
  product: VidhiProduct;
  skills: SkillRegistry;
  autonomy: Autonomy;
  approvals: TaskApprovals;
  kill: KillSwitches;
  tools: Readonly<Record<string, ToolHandler>>;
  outbox?: OutboxWriter;
}

interface TaskRow {
  id: string;
  skill_key: string;
  state: TaskState;
  level: AutonomyLevel;
  agent_id: string;
  owner_id: string;
  approval_id: string | null;
  pending_tool: string | null;
}

export interface ToolCallResult {
  state: TaskState;
  approvalId?: string;
  result?: unknown;
}

const isAgent = (ctx: KernelContext) =>
  ctx.principal.type === "agent" || ctx.principal.roles.some((r) => r.startsWith("AGT_"));

export class TaskRuntime {
  constructor(private readonly o: TaskRuntimeOptions) {
    for (const key of o.skills.keys())
      for (const p of o.skills.get(key)!.tools.values())
        if (p.locked || p.tool.write)
          o.approvals.register(actionFor(p.tool.name), {
            checkerRoles: [p.tool.required_role ?? p.locked?.defaultRole ?? "ORG_CHECKER"],
            execute: (tx, payload, request) => this.executeApproved(tx, payload, request.id),
          });
  }

  private eventProduct(): string {
    return this.o.product === "PLATFORM" ? "REF" : this.o.product;
  }

  private async emit(
    tx: Tx,
    tenantId: string,
    event: { module: string; name: string },
    data: Record<string, unknown>,
  ): Promise<void> {
    if (!this.o.outbox) return;
    await this.o.outbox.publish(tx, "vidhi", {
      envelope: internalEvent({ product: this.eventProduct(), event, tenantId, data }),
    });
  }

  private async load(tx: Tx, taskId: string, lock = false): Promise<TaskRow> {
    const r = await tx.query<TaskRow>(
      `select id, skill_key, state, level, agent_id, owner_id, approval_id, pending_tool
         from vidhi.task where id = $1${lock ? " for update" : ""}`,
      [taskId],
    );
    if (!r.rows[0]) throw new IpbError("IPB-VID-022", { detail: `task ${taskId} not found` });
    return r.rows[0];
  }

  /** Compare-and-set; zero rows means another transition won (`IPB-VID-022`). */
  private async move(
    tx: Tx,
    task: Pick<TaskRow, "id" | "skill_key">,
    from: readonly TaskState[],
    to: TaskState,
    set: Record<string, unknown> = {},
  ): Promise<void> {
    const cols = Object.keys(set);
    const r = await tx.query(
      `update vidhi.task t set state = $2, updated_at = now()${
        to === "DONE" || to === "FAILED" || to === "CANCELLED" ? ", finished_at = now()" : ""
      }${cols.map((c, i) => `, ${c} = $${i + 4}`).join("")}
        where id = $1 and state = any($3)`,
      [task.id, to, from, ...cols.map((c) => set[c])],
    );
    if (!r.rowCount)
      throw new IpbError("IPB-VID-022", {
        detail: `task ${task.id} is not ${from.join(" or ")}`,
      });
    await this.o.audit.record(tx, {
      action: "vidhi.task.transition",
      resourceType: "vidhi_task",
      resourceId: task.id,
      before: { state: from.join("|") },
      after: { state: to, ...set },
    });
    await this.emit(
      tx,
      tx.ctx.tenantId,
      VIDHI_EVENTS.TaskStateChanged,
      TaskStateChangedData.parse({
        task_id: task.id,
        tenant_id: tx.ctx.tenantId,
        skill_key: task.skill_key,
        from: from.join("|"),
        to,
      }),
    );
  }

  /** Create a task for an agent acting for `ownerId`; the level is fixed at creation. */
  async create(
    ctx: KernelContext,
    i: {
      skillKey: string;
      ownerId: string;
      ownerRoles?: readonly string[];
      missionId?: string;
      scheduleId?: string;
    },
  ): Promise<{ taskId: string; level: AutonomyLevel }> {
    const skill = this.o.skills.get(i.skillKey);
    if (!skill) throw new IpbError("IPB-VID-001", { detail: `skill ${i.skillKey} is not loaded` });
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const st = await this.o.autonomy.state(tx, ctx.tenantId, i.skillKey);
        if (!st.enabled) throw new IpbError("IPB-VID-010", { detail: `${i.skillKey} is disabled` });
        const { level } = await this.o.autonomy.effectiveLevel(ctx, tx, i.skillKey, {
          scheduled: Boolean(i.scheduleId),
          ...(i.ownerRoles ? { ownerRoles: i.ownerRoles } : {}),
        });
        const id = newId("tsk");
        await tx.query(
          `insert into vidhi.task (id, tenant_id, skill_key, level, agent_id, owner_id, mission_id, schedule_id)
           values ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            id,
            ctx.tenantId,
            i.skillKey,
            level,
            ctx.principal.id,
            i.ownerId,
            i.missionId ?? null,
            i.scheduleId ?? null,
          ],
        );
        await this.o.audit.record(tx, {
          action: "vidhi.task.create",
          resourceType: "vidhi_task",
          resourceId: id,
          after: { skill_key: i.skillKey, level, owner_id: i.ownerId },
        });
        return { taskId: id, level };
      },
      { action: "vidhi.task.create" },
    );
  }

  /** Kill switches stop a task at every step; a task found under a switch is cancelled. */
  private async killed(ctx: KernelContext, skillKey: string): Promise<string | null> {
    return (await this.o.kill.gateway(ctx, skillKey)).on;
  }

  async start(ctx: KernelContext, taskId: string): Promise<void> {
    const task = await this.o.kernel.read(ctx, (tx) => this.load(tx, taskId));
    const sw = await this.killed(ctx, task.skill_key);
    if (sw) {
      await this.cancel(ctx, taskId, `kill switch ${sw}`);
      throw new IpbError("IPB-AI-001", { detail: `${sw} is on` });
    }
    await this.o.kernel.mutate(
      ctx,
      (tx) => this.move(tx, task, ["QUEUED", "NEEDS_INPUT"], "RUNNING"),
      {
        action: "vidhi.task.transition",
      },
    );
  }

  /**
   * The agent asks to call a tool. Read tools and (at L3) unlocked writes run now; a locked action
   * or a write at L2 waits for a human. `insist: true` is an agent trying to run a locked action
   * without approval: the task fails and the skill is demoted (IPB-03-70).
   */
  async callTool(
    ctx: KernelContext,
    taskId: string,
    call: {
      tool: string;
      args: Record<string, unknown>;
      idempotencyKey?: string;
      insist?: boolean;
    },
  ): Promise<ToolCallResult> {
    const task = await this.o.kernel.read(ctx, (tx) => this.load(tx, taskId));
    if (task.state !== "RUNNING")
      throw new IpbError("IPB-VID-022", { detail: `task ${taskId} is ${task.state}` });
    const sw = await this.killed(ctx, task.skill_key);
    if (sw) {
      await this.cancel(ctx, taskId, `kill switch ${sw}`);
      throw new IpbError("IPB-AI-001", { detail: `${sw} is on` });
    }
    const skill = this.o.skills.get(task.skill_key)!;
    const policy = skill.tools.get(call.tool);
    if (!policy) {
      await this.fail(ctx, taskId, "IPB-AI-040", { tool: call.tool, outcome: "refused" });
      throw new IpbError("IPB-AI-040", {
        detail: `${call.tool} is not in ${task.skill_key}'s manifest`,
      });
    }
    const level =
      autonomyRank(task.level) < autonomyRank(policy.ceiling) ? task.level : policy.ceiling;
    if (policy.locked && call.insist) return this.lockedAttempt(ctx, task, policy);
    if (policy.tool.write && autonomyRank(level) < 2)
      throw new IpbError("IPB-VID-010", {
        detail: `${call.tool} needs L2; the task runs at ${level}`,
      });
    const needsApproval = Boolean(policy.locked) || (policy.tool.write && autonomyRank(level) <= 2);
    if (needsApproval) return this.awaitApproval(ctx, task, policy, call);
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const result = await this.runTool(
          tx,
          ctx,
          task,
          call.tool,
          call.args,
          call.idempotencyKey,
          null,
          level,
        );
        return { state: "RUNNING" as TaskState, result };
      },
      { action: "vidhi.task.tool" },
    );
  }

  private async runTool(
    tx: Tx,
    ctx: KernelContext,
    task: Pick<TaskRow, "id" | "skill_key">,
    tool: string,
    args: Record<string, unknown>,
    idempotencyKey: string | undefined,
    approvalId: string | null,
    level: AutonomyLevel,
  ): Promise<unknown> {
    const handler = this.o.tools[tool];
    if (!handler) throw new IpbError("IPB-AI-040", { detail: `no handler for ${tool}` });
    const result = await handler(ctx, args, { id: task.id, skillKey: task.skill_key });
    await tx.query(
      `insert into vidhi.task_step (tenant_id, task_id, tool, outcome, approval_id, idempotency_key, actor_id)
       values ($1, $2, $3, 'executed', $4, $5, $6)`,
      [ctx.tenantId, task.id, tool, approvalId, idempotencyKey ?? null, ctx.principal.id],
    );
    await this.o.audit.record(tx, {
      action: "vidhi.task.tool",
      resourceType: "vidhi_task",
      resourceId: task.id,
      after: { tool, approval_id: approvalId, level },
    });
    await this.emit(
      tx,
      ctx.tenantId,
      VIDHI_EVENTS.ActionExecuted,
      ActionExecutedData.parse({ task_id: task.id, tool, level, approval_id: approvalId }),
    );
    return result;
  }

  private async awaitApproval(
    ctx: KernelContext,
    task: TaskRow,
    policy: ToolPolicy,
    call: { tool: string; args: Record<string, unknown>; idempotencyKey?: string },
  ): Promise<ToolCallResult> {
    const skill = this.o.skills.get(task.skill_key)!;
    const declared = policy.tool.risk_class ?? "R2";
    if (declared === "R4" || declared === "R5")
      throw new IpbError("IPB-VID-011", {
        detail: `${call.tool} is ${declared}: a person must start it; an agent cannot make the request`,
      });
    const risk: "R2" | "R3" = policy.locked || declared === "R3" ? "R3" : "R2";
    const role = policy.tool.required_role ?? policy.locked?.defaultRole ?? "ORG_CHECKER";
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const { id } = await this.o.approvals.request(tx, {
          action: actionFor(call.tool),
          riskClass: risk,
          payload: {
            taskId: task.id,
            tool: call.tool,
            args: call.args,
            idempotencyKey: call.idempotencyKey ?? null,
          },
          payloadDataClass: skill.manifest.data_class_max,
          summary: `Vidhi prepared ${call.tool} (task ${task.id}); a ${role} confirms it`,
        });
        await this.move(tx, task, ["RUNNING"], "NEEDS_APPROVAL", {
          pending_tool: call.tool,
          approval_id: id,
        });
        await tx.query(
          `insert into vidhi.task_step (tenant_id, task_id, tool, outcome, approval_id, actor_id)
           values ($1, $2, $3, 'needs_approval', $4, $5)`,
          [ctx.tenantId, task.id, call.tool, id, ctx.principal.id],
        );
        await this.emit(
          tx,
          ctx.tenantId,
          VIDHI_EVENTS.ApprovalRequested,
          VidhiApprovalRequestedData.parse({
            task_id: task.id,
            approval_id: id,
            tool: call.tool,
            required_role: role,
            risk_class: risk,
            locked_category: policy.locked?.category ?? null,
          }),
        );
        return { state: "NEEDS_APPROVAL" as TaskState, approvalId: id };
      },
      { action: "vidhi.task.await_approval" },
    );
  }

  /** The approval's executor: resume the task and run the tool exactly once. */
  private async executeApproved(
    tx: Tx,
    payload: Record<string, unknown>,
    approvalId: string,
  ): Promise<void> {
    const taskId = String(payload.taskId);
    const task = await this.load(tx, taskId, true);
    if (task.state !== "NEEDS_APPROVAL" || task.approval_id !== approvalId)
      throw new IpbError("IPB-VID-022", { detail: `task ${taskId} is ${task.state}` });
    await this.move(tx, task, ["NEEDS_APPROVAL"], "RUNNING", { pending_tool: null });
    await tx.query(
      `insert into vidhi.task_step (tenant_id, task_id, tool, outcome, approval_id, actor_id)
       values ($1, $2, $3, 'approved', $4, $5)`,
      [tx.ctx.tenantId, taskId, String(payload.tool), approvalId, tx.ctx.principal.id],
    );
    // An approved action runs under the approver's identity, as every approvals-engine executor
    // does: the human who confirmed it is the principal of record, and the kernel's agent-verb
    // guard (IPB-SEC-004) stays intact for the agent itself.
    await this.runTool(
      tx,
      tx.ctx,
      task,
      String(payload.tool),
      (payload.args ?? {}) as Record<string, unknown>,
      (payload.idempotencyKey as string | null) ?? undefined,
      approvalId,
      task.level,
    );
  }

  /**
   * A human approves or rejects the waiting action. An agent never decides (`IPB-VID-012`); a task
   * not waiting, cancelled by a kill switch, or already decided is `IPB-VID-022`.
   */
  async decide(ctx: KernelContext, taskId: string, decision: "approve" | "reject"): Promise<void> {
    if (isAgent(ctx)) {
      await this.o.kernel.mutate(
        ctx,
        async (tx) => {
          await this.o.audit.record(tx, {
            action: "vidhi.task.decide_refused",
            resourceType: "vidhi_task",
            resourceId: taskId,
            after: { reason: "agent", decision },
          });
        },
        { action: "vidhi.task.decide_refused" },
      );
      throw new IpbError("IPB-VID-012", { detail: "an agent cannot approve or reject" });
    }
    const task = await this.o.kernel.read(ctx, (tx) => this.load(tx, taskId));
    const sw = await this.killed(ctx, task.skill_key);
    if (sw) {
      await this.cancel(ctx, taskId, `kill switch ${sw}`).catch(() => undefined);
      throw new IpbError("IPB-VID-022", { detail: `task ${taskId} was cancelled by ${sw}` });
    }
    if (task.state !== "NEEDS_APPROVAL" || !task.approval_id)
      throw new IpbError("IPB-VID-022", { detail: `task ${taskId} is ${task.state}` });
    try {
      await this.o.approvals.decide(ctx, task.approval_id, decision);
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === "IPB-VID-022" || (e as Error).name === "ConflictError" || code === "IPB-UX-012")
        throw new IpbError("IPB-VID-022", { detail: `task ${taskId} was already decided` });
      // Agent (IPB-SEC-004), maker (IPB-SEC-007), or not one of the action's checker roles.
      if (code?.startsWith("IPB-SEC") || code === "IPB-UX-011")
        throw new IpbError("IPB-VID-012", { detail: "this person may not decide this action" });
      throw e;
    }
    if (decision === "reject")
      await this.o.kernel.mutate(
        ctx,
        async (tx) => {
          await this.move(tx, task, ["NEEDS_APPROVAL"], "CANCELLED", {
            cancel_reason: "rejected",
            pending_tool: null,
          });
          await tx.query(
            `insert into vidhi.task_step (tenant_id, task_id, tool, outcome, approval_id, actor_id)
             values ($1, $2, $3, 'rejected', $4, $5)`,
            [ctx.tenantId, taskId, task.pending_tool ?? "?", task.approval_id, ctx.principal.id],
          );
        },
        { action: "vidhi.task.reject" },
      );
  }

  private async lockedAttempt(
    ctx: KernelContext,
    task: TaskRow,
    policy: ToolPolicy,
  ): Promise<never> {
    await this.o.kernel.mutate(
      ctx,
      async (tx) => {
        await tx.query(
          `insert into vidhi.task_step (tenant_id, task_id, tool, outcome, actor_id)
           values ($1, $2, $3, 'locked_attempt', $4)`,
          [ctx.tenantId, task.id, policy.tool.name, ctx.principal.id],
        );
        await this.move(tx, task, ["RUNNING"], "FAILED", { error_code: "IPB-VID-011" });
        await this.emit(
          tx,
          ctx.tenantId,
          VIDHI_EVENTS.LockedActionAttempted,
          LockedActionAttemptedData.parse({
            task_id: task.id,
            tenant_id: ctx.tenantId,
            skill_key: task.skill_key,
            tool: policy.tool.name,
            category: policy.locked?.category ?? "approval",
            agent_id: ctx.principal.id,
          }),
        );
        await this.o.autonomy.demote(tx, ctx, task.skill_key, "demotion_locked", task.id);
      },
      { action: "vidhi.task.locked_attempt" },
    );
    throw new IpbError("IPB-VID-011", {
      detail: `${policy.tool.name} is a locked action and needs a human approval`,
    });
  }

  /** A guardrail incident in the task (IPB-03-70): fail it and demote the skill. */
  async guardrailIncident(ctx: KernelContext, taskId: string, code: string): Promise<void> {
    await this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const task = await this.load(tx, taskId, true);
        await this.move(tx, task, ["QUEUED", "RUNNING", "NEEDS_INPUT"], "FAILED", {
          error_code: code,
        });
        await this.o.autonomy.demote(tx, ctx, task.skill_key, "demotion_guardrail", taskId);
      },
      { action: "vidhi.task.fail" },
    );
  }

  async askInput(ctx: KernelContext, taskId: string): Promise<void> {
    const task = await this.o.kernel.read(ctx, (tx) => this.load(tx, taskId));
    await this.o.kernel.mutate(ctx, (tx) => this.move(tx, task, ["RUNNING"], "NEEDS_INPUT"), {
      action: "vidhi.task.transition",
    });
  }

  async complete(ctx: KernelContext, taskId: string): Promise<void> {
    const task = await this.o.kernel.read(ctx, (tx) => this.load(tx, taskId));
    await this.o.kernel.mutate(ctx, (tx) => this.move(tx, task, ["RUNNING"], "DONE"), {
      action: "vidhi.task.transition",
    });
  }

  async fail(
    ctx: KernelContext,
    taskId: string,
    code: string,
    step?: { tool: string; outcome: "refused" | "failed" },
  ): Promise<void> {
    await this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const task = await this.load(tx, taskId, true);
        if (step)
          await tx.query(
            `insert into vidhi.task_step (tenant_id, task_id, tool, outcome, actor_id)
             values ($1, $2, $3, $4, $5)`,
            [ctx.tenantId, taskId, step.tool, step.outcome, ctx.principal.id],
          );
        await this.move(
          tx,
          task,
          ["QUEUED", "RUNNING", "NEEDS_INPUT", "NEEDS_APPROVAL"],
          "FAILED",
          {
            error_code: code,
          },
        );
      },
      { action: "vidhi.task.fail" },
    );
  }

  /** Cancel from any non-terminal state (owner cancel, kill switch); ledgered before anything else. */
  async cancel(ctx: KernelContext, taskId: string, reason: string): Promise<void> {
    await this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const task = await this.load(tx, taskId, true);
        await this.move(
          tx,
          task,
          ["QUEUED", "RUNNING", "NEEDS_INPUT", "NEEDS_APPROVAL"],
          "CANCELLED",
          { cancel_reason: reason.slice(0, 200), pending_tool: null },
        );
      },
      { action: "vidhi.task.cancel" },
    );
  }

  /**
   * The kill-switch sweep (IPB-03-48; run it on every switch change and once a minute): cancel every
   * non-terminal task of the caller's tenant whose skill a switch now stops.
   */
  async sweepKilled(ctx: KernelContext): Promise<number> {
    const open = await this.o.kernel.read(
      ctx,
      async (tx) =>
        (
          await tx.query<{ id: string; skill_key: string }>(
            `select id, skill_key from vidhi.task
            where state not in ('DONE', 'FAILED', 'CANCELLED') order by created_at`,
          )
        ).rows,
    );
    let n = 0;
    for (const t of open) {
      const sw = await this.killed(ctx, t.skill_key);
      if (!sw) continue;
      try {
        await this.cancel(ctx, t.id, `kill switch ${sw}`);
        n++;
      } catch (e) {
        if ((e as { code?: string }).code !== "IPB-VID-022") throw e;
      }
    }
    return n;
  }
}
