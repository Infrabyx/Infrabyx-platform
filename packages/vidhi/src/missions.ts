// Missions (IPB-03-63, §03.4.7; PL4 plan §8.5, A-10). A mission is a goal broken into steps, each
// step a task, under a budget of tokens, cost, wall-clock time and tool calls, and a scope (the
// skills it may use).
// - The planner proposes the steps through a `structured` gateway call (`vidhi.mission_plan@1`);
//   a step naming a skill outside the scope is dropped, and an empty plan is refused.
// - The mission's level is the lowest ceiling of its skills; no task in it runs above that level.
// - It halts at any action that needs a human (a locked action at any level, or a write at L2):
//   the mission waits until the task is decided, and a rejected or failed step fails the mission.
// - When the budget runs out it stops with `IPB-VID-070`, keeping what the finished steps did.
// - It is a resumable state machine: a QUEUE worker calls `advance`, a lease keeps two workers off
//   the same mission, and each call picks up from the stored step. Only skill keys, task ids and
//   counters are stored, never the goal or any output text.
import { IpbError } from "@infrabyx/contracts/errors";
import type { AuditSink, KernelContext, MutationKernel, Tx } from "@infrabyx/contracts/kernel";
import { minLevel, type AutonomyLevel, type TaskState } from "@infrabyx/contracts/vidhi";
import type { DataClass } from "@infrabyx/contracts";
import { newId } from "@infrabyx/crypto";
import type { LlmGateway } from "@infrabyx/ai";
import { productCeiling } from "./ceilings.js";
import type { SkillRegistry } from "./skills.js";
import type { TaskRuntime } from "./tasks.js";

export const MISSION_PLAN_PROMPT = "vidhi.mission_plan@1";
export const MAX_MISSION_STEPS = 10;
/** How long one `advance` call holds a mission. */
const LEASE_SECONDS = 120;

export interface MissionBudget {
  tokens: number;
  costMinor: number;
  wallClockS: number;
  toolCalls: number;
}

export interface MissionUsage {
  tokens: number;
  cost_minor: number;
  tool_calls: number;
}

export interface MissionStep {
  skill_key: string;
  task_id: string | null;
}

export type MissionState = "RUNNING" | "WAITING" | "DONE" | "STOPPED" | "FAILED" | "CANCELLED";

export interface MissionProgress {
  missionId: string;
  state: MissionState;
  stepIndex: number;
  steps: MissionStep[];
  used: MissionUsage;
  /** `IPB-VID-070` when the budget stopped it; a task's error code when a step failed. */
  code: string | null;
}

/**
 * Runs (or continues) one step's task: the product's skill code, calling tools through
 * `TaskRuntime.callTool`. It reports what the step used; the task's state in the database decides
 * what the mission does next.
 */
export type StepRunner = (
  ctx: KernelContext,
  step: { index: number; skillKey: string; taskId: string; missionId: string },
) => Promise<{ tokens?: number; costMinor?: number; toolCalls?: number }>;

export interface MissionsOptions {
  kernel: MutationKernel;
  audit: AuditSink;
  product: Parameters<typeof productCeiling>[0];
  skills: SkillRegistry;
  runtime: TaskRuntime;
  gateway: Pick<LlmGateway, "structured">;
}

interface MissionRow {
  id: string;
  owner_id: string;
  state: MissionState;
  level: AutonomyLevel;
  steps: MissionStep[];
  step_index: number;
  budget: MissionBudget;
  used: MissionUsage;
  stop_code: string | null;
  deadline_at: Date;
}

const PLAN_SCHEMA = {
  type: "object",
  properties: {
    steps: {
      type: "array",
      minItems: 1,
      maxItems: MAX_MISSION_STEPS,
      items: {
        type: "object",
        properties: { skill_key: { type: "string" } },
        required: ["skill_key"],
        additionalProperties: false,
      },
    },
  },
  required: ["steps"],
  additionalProperties: false,
} as const;

const TERMINAL: readonly MissionState[] = ["DONE", "STOPPED", "FAILED", "CANCELLED"];

export class MissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MissionError";
  }
}

export class Missions {
  constructor(private readonly o: MissionsOptions) {}

  private progress(m: MissionRow): MissionProgress {
    return {
      missionId: m.id,
      state: m.state,
      stepIndex: m.step_index,
      steps: m.steps,
      used: m.used,
      code: m.stop_code,
    };
  }

  /** Plan and record a mission. The planner's own usage counts against the budget. */
  async start(
    ctx: KernelContext,
    i: {
      goal: string;
      scope: readonly string[];
      budget: MissionBudget;
      ownerId: string;
      featureKey: string;
      dataClass: DataClass;
      now?: Date;
    },
  ): Promise<MissionProgress> {
    const scope = [...new Set(i.scope)];
    if (!scope.length) throw new MissionError("a mission needs a scope");
    for (const k of scope)
      if (!this.o.skills.get(k))
        throw new IpbError("IPB-VID-001", { detail: `skill ${k} is not loaded` });
    for (const [k, v] of Object.entries(i.budget))
      if (!Number.isFinite(v) || v <= 0) throw new MissionError(`budget ${k} must be positive`);
    const level = minLevel(
      ...scope.map((k) => {
        const m = this.o.skills.get(k)!.manifest;
        return minLevel(m.autonomy_ceiling, productCeiling(this.o.product, m.audience, k));
      }),
    );
    const plan = await this.o.gateway.structured(ctx, {
      featureKey: i.featureKey,
      dataClass: i.dataClass,
      promptRef: MISSION_PLAN_PROMPT,
      variables: {
        product: this.o.product,
        skills: scope.map((k) => `${k}: ${this.o.skills.get(k)!.manifest.description}`).join("\n"),
        max_steps: String(MAX_MISSION_STEPS),
      },
      messages: [{ role: "user", content: i.goal }],
      schema: PLAN_SCHEMA,
    });
    const proposed = ((plan.data as { steps?: { skill_key: string }[] } | undefined)?.steps ?? [])
      .map((s) => s.skill_key)
      .filter((k) => scope.includes(k))
      .slice(0, MAX_MISSION_STEPS);
    if (plan.blocked || !proposed.length)
      throw new MissionError("the planner proposed no step within the scope");
    const steps: MissionStep[] = proposed.map((k) => ({ skill_key: k, task_id: null }));
    const used: MissionUsage = {
      tokens: plan.usage.inputTokens + plan.usage.outputTokens,
      cost_minor: plan.cost?.minorUnits ?? 0,
      tool_calls: 0,
    };
    const now = i.now ?? new Date();
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const id = newId("msn");
        const deadline = new Date(now.getTime() + i.budget.wallClockS * 1000);
        await tx.query(
          `insert into vidhi.mission
             (id, tenant_id, owner_id, agent_id, level, scope, steps, budget, used, deadline_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            id,
            ctx.tenantId,
            i.ownerId,
            ctx.principal.id,
            level,
            scope,
            JSON.stringify(steps),
            JSON.stringify(i.budget),
            JSON.stringify(used),
            deadline,
          ],
        );
        await this.o.audit.record(tx, {
          action: "vidhi.mission.start",
          resourceType: "vidhi_mission",
          resourceId: id,
          after: { level, steps: proposed, plan_run_id: plan.runId, budget: i.budget },
        });
        return {
          missionId: id,
          state: "RUNNING" as const,
          stepIndex: 0,
          steps,
          used,
          code: null,
        };
      },
      { action: "vidhi.mission.start" },
    );
  }

  private async load(tx: Tx, id: string): Promise<MissionRow> {
    const r = await tx.query<MissionRow>(
      `select id, owner_id, state, level, steps, step_index, budget, used, stop_code, deadline_at
         from vidhi.mission where id = $1`,
      [id],
    );
    if (!r.rows[0]) throw new IpbError("IPB-VID-022", { detail: `mission ${id} not found` });
    return r.rows[0];
  }

  /** Take the lease; false when another worker holds it or the mission has finished. */
  private async lease(ctx: KernelContext, id: string, now: Date): Promise<boolean> {
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const r = await tx.query(
          `update vidhi.mission set lease_until = $2, updated_at = now()
            where id = $1 and state in ('RUNNING', 'WAITING')
              and (lease_until is null or lease_until < $3)`,
          [id, new Date(now.getTime() + LEASE_SECONDS * 1000), now],
        );
        await this.o.audit.record(tx, {
          action: "vidhi.mission.lease",
          resourceType: "vidhi_mission",
          resourceId: id,
          after: { taken: Boolean(r.rowCount) },
        });
        return Boolean(r.rowCount);
      },
      { action: "vidhi.mission.lease" },
    );
  }

  /** Persist the mission's position, usage and state; releases the lease unless `keepLease`. */
  private async save(
    ctx: KernelContext,
    m: MissionRow,
    patch: Partial<Pick<MissionRow, "state" | "steps" | "step_index" | "used" | "stop_code">>,
    keepLease = false,
  ): Promise<MissionRow> {
    const next = { ...m, ...patch };
    await this.o.kernel.mutate(
      ctx,
      async (tx) => {
        await tx.query(
          `update vidhi.mission set state = $2, steps = $3, step_index = $4, used = $5,
                  stop_code = $6, lease_until = case when $7 then lease_until end, updated_at = now(),
                  finished_at = case when $2 in ('DONE', 'STOPPED', 'FAILED', 'CANCELLED')
                                     then now() end
            where id = $1`,
          [
            m.id,
            next.state,
            JSON.stringify(next.steps),
            next.step_index,
            JSON.stringify(next.used),
            next.stop_code,
            keepLease,
          ],
        );
        await this.o.audit.record(tx, {
          action: "vidhi.mission.advance",
          resourceType: "vidhi_mission",
          resourceId: m.id,
          before: { state: m.state, step_index: m.step_index },
          after: {
            state: next.state,
            step_index: next.step_index,
            used: next.used,
            code: next.stop_code,
          },
        });
      },
      { action: "vidhi.mission.advance" },
    );
    return next;
  }

  private exhausted(m: MissionRow, now: Date): boolean {
    return (
      m.used.tokens >= m.budget.tokens ||
      m.used.cost_minor >= m.budget.costMinor ||
      m.used.tool_calls >= m.budget.toolCalls ||
      now.getTime() >= new Date(m.deadline_at).getTime()
    );
  }

  private async taskState(ctx: KernelContext, taskId: string) {
    return this.o.kernel.read(
      ctx,
      async (tx) =>
        (
          await tx.query<{
            state: TaskState;
            error_code: string | null;
            cancel_reason: string | null;
          }>("select state, error_code, cancel_reason from vidhi.task where id = $1", [taskId])
        ).rows[0]!,
    );
  }

  /** Stop for the budget: cancel the step in flight and keep the finished steps (`IPB-VID-070`). */
  private async stopForBudget(ctx: KernelContext, m: MissionRow): Promise<MissionRow> {
    const current = m.steps[m.step_index];
    if (current?.task_id) {
      const t = await this.taskState(ctx, current.task_id);
      if (!["DONE", "FAILED", "CANCELLED"].includes(t.state))
        await this.o.runtime.cancel(ctx, current.task_id, "mission budget exhausted");
    }
    return this.save(ctx, m, { state: "STOPPED", stop_code: "IPB-VID-070" });
  }

  /**
   * Move the mission on as far as it can go now: run steps until it finishes, waits for a human,
   * or runs out of budget. Safe to call again at any time (from the QUEUE, after an approval).
   */
  async advance(
    ctx: KernelContext,
    missionId: string,
    runStep: StepRunner,
    now: () => Date = () => new Date(),
  ): Promise<MissionProgress> {
    let m = await this.o.kernel.read(ctx, (tx) => this.load(tx, missionId));
    if (TERMINAL.includes(m.state)) return this.progress(m);
    if (!(await this.lease(ctx, missionId, now()))) return this.progress(m);
    m = await this.o.kernel.read(ctx, (tx) => this.load(tx, missionId));
    for (;;) {
      if (m.step_index >= m.steps.length) {
        m = await this.save(ctx, m, { state: "DONE" });
        break;
      }
      if (this.exhausted(m, now())) {
        m = await this.stopForBudget(ctx, m);
        break;
      }
      const step = m.steps[m.step_index]!;
      let taskId = step.task_id;
      if (!taskId) {
        ({ taskId } = await this.o.runtime.create(ctx, {
          skillKey: step.skill_key,
          ownerId: m.owner_id,
          missionId: m.id,
          maxLevel: m.level,
        }));
        await this.o.runtime.start(ctx, taskId);
        const steps = m.steps.map((s, i) => (i === m.step_index ? { ...s, task_id: taskId } : s));
        m = await this.save(ctx, m, { steps, state: "RUNNING" }, true);
      }
      const before = await this.taskState(ctx, taskId!);
      if (before.state === "RUNNING" || before.state === "QUEUED") {
        const usage = await runStep(ctx, {
          index: m.step_index,
          skillKey: step.skill_key,
          taskId: taskId!,
          missionId: m.id,
        });
        m = {
          ...m,
          used: {
            tokens: m.used.tokens + Math.max(0, usage.tokens ?? 0),
            cost_minor: m.used.cost_minor + Math.max(0, usage.costMinor ?? 0),
            tool_calls: m.used.tool_calls + Math.max(0, usage.toolCalls ?? 0),
          },
        };
      }
      const t = await this.taskState(ctx, taskId!);
      if (t.state === "DONE") {
        m = { ...m, step_index: m.step_index + 1 };
        continue;
      }
      if (t.state === "FAILED" || t.state === "CANCELLED") {
        m = await this.save(ctx, m, {
          state: "FAILED",
          stop_code: t.error_code ?? (t.cancel_reason === "rejected" ? "rejected" : "cancelled"),
        });
        break;
      }
      if (t.state === "NEEDS_APPROVAL" || t.state === "NEEDS_INPUT") {
        // Halt for the human; the approval (or the input) resumes the task, then the QUEUE calls
        // `advance` again. The budget is checked first, so a waiting mission never overruns.
        m = this.exhausted(m, now())
          ? await this.stopForBudget(ctx, m)
          : await this.save(ctx, m, { state: "WAITING" });
        break;
      }
      // Still RUNNING after the runner returned: the step has more to do; spend the next call on it.
      if (this.exhausted(m, now())) {
        m = await this.stopForBudget(ctx, m);
        break;
      }
      m = await this.save(ctx, m, { state: "RUNNING" });
      break;
    }
    return this.progress(m);
  }

  /** The owner cancels a mission; the step in flight is cancelled too. */
  async cancel(ctx: KernelContext, missionId: string, reason: string): Promise<MissionProgress> {
    const m = await this.o.kernel.read(ctx, (tx) => this.load(tx, missionId));
    if (TERMINAL.includes(m.state))
      throw new IpbError("IPB-VID-022", { detail: `mission ${missionId} is ${m.state}` });
    const current = m.steps[m.step_index];
    if (current?.task_id) {
      const t = await this.taskState(ctx, current.task_id);
      if (!["DONE", "FAILED", "CANCELLED"].includes(t.state))
        await this.o.runtime.cancel(ctx, current.task_id, reason);
    }
    return this.progress(await this.save(ctx, m, { state: "CANCELLED", stop_code: "cancelled" }));
  }
}
