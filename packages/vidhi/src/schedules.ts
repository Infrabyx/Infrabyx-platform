// Scheduled tasks (IPB-03-64 to 03-67, §03.4.9; PL4 plan §8.6). A schedule runs a skill for its
// owner on a recurrence (the RFC 5545 subset in `rrule.ts`) or when an event arrives (a CloudEvents
// type plus an optional CEL condition, evaluated by the rules engine with its limits).
// - Due runs: `tick` reads which recurring schedules are due across tenants through the service
//   reader `SVC_VIDHI_SCHED` (id, tenant, state, kind and time only; every read ledgered per
//   tenant) and handles each in its own tenant's context. A product drives `tick` from its QUEUE or
//   cron, once a minute; `vidhi.schedule_run` makes each occurrence run at most once.
// - Before every run the kernel re-checks (IPB-03-65): scheduling is on for the tenant; the owner is
//   still an active member holding every role they held when they created the schedule (and the
//   product's permission check passes); the plan includes the skill; the skill is loaded, enabled
//   and schedulable; no kill switch stops it; its connector tokens are valid. A failed check skips
//   the run with `IPB-VID-020`, tells the owner (`vidhi.schedule.skipped`) and counts the skip; at
//   `vidhi.sched.max_skips` consecutive skips the schedule pauses with `IPB-VID-021`.
// - A scheduled task never runs above L2 unless the owner is ORG_OWNER or ORG_ADMIN and the tenant
//   allows L3, and never at L4 (IPB-03-67): `Autonomy.effectiveLevel` applies the cap.
import { IpbError } from "@infrabyx/contracts/errors";
import type {
  AuditSink,
  KernelContext,
  MutationKernel,
  OutboxWriter,
  Tx,
} from "@infrabyx/contracts/kernel";
import type { CelResult } from "@infrabyx/contracts/ports";
import {
  ScheduleRunSkippedData,
  VIDHI_EVENTS,
  type ScheduleSkipReason as SkipReason,
} from "@infrabyx/contracts";
import { VIDHI_AGENT_ROLE } from "@infrabyx/contracts/roles";
import type { VidhiProduct } from "@infrabyx/contracts/vidhi";
import { internalEvent } from "@infrabyx/config/events";
import { newId } from "@infrabyx/crypto";
import { keySegment, type KillSwitches, type SettingsReader } from "@infrabyx/ai";
import { memberStatus, ServiceReader, type ServiceReadRecord } from "@infrabyx/tenancy";
import type { Autonomy } from "./autonomy.js";
import { nextOccurrence, parseRecurrence, RecurrenceError } from "./rrule.js";
import type { SkillRegistry } from "./skills.js";
import type { TaskRuntime } from "./tasks.js";

export const SCHEDULE_POLLER_PRINCIPAL_ID = "svc_vidhi_sched";
/** The agent principal scheduled runs act as, for their owner. */
export const SCHEDULED_AGENT_ID = "agt_vidhi_sched";
export const scheduledRunContext = (tenantId: string): KernelContext => ({
  tenantId,
  principal: { id: SCHEDULED_AGENT_ID, type: "agent", roles: [VIDHI_AGENT_ROLE] },
});

export type { SkipReason };

export class ScheduleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScheduleError";
  }
}

export interface ScheduleRow {
  id: string;
  tenant_id: string;
  skill_key: string;
  owner_id: string;
  owner_roles: string[];
  kind: "recurrence" | "event";
  recurrence: string | null;
  event_type: string | null;
  condition: string | null;
  state: "ACTIVE" | "PAUSED" | "ENDED";
  next_run_at: Date | null;
  consecutive_skips: number;
}

/** The NOTIFY side, structurally `NotifyService.enqueue` from `@infrabyx/notify`. */
export interface ScheduleNotify {
  enqueue(
    tx: Tx,
    n: {
      class: string;
      to: { ref: string }[];
      vars: Record<string, string>;
      deepLink: string;
      idempotencyKey: string;
    },
  ): Promise<unknown>;
}

export interface SchedulerOptions {
  kernel: MutationKernel;
  audit: AuditSink;
  product: VidhiProduct;
  skills: SkillRegistry;
  autonomy: Autonomy;
  runtime: TaskRuntime;
  settings: SettingsReader;
  kill: KillSwitches;
  /** The rules engine's CEL evaluator (`RulesService.evaluateCel`). */
  cel?: { evaluateCel(expr: string, input: unknown): Promise<CelResult> };
  notify?: ScheduleNotify;
  outbox?: OutboxWriter;
  /** The owner's membership now; defaults to `memberStatus` (tenancy.membership and user). */
  members?: (tx: Tx, userId: string) => Promise<{ active: boolean; roles: string[] } | null>;
  /** The product's permission check (Cerbos) for the owner and skill, run before every run. */
  authorize?: (
    tx: Tx,
    owner: { id: string; roles: string[] },
    skillKey: string,
  ) => Promise<boolean>;
  /** Plan entitlement for the skill. */
  entitled?: (tx: Tx, skillKey: string) => Promise<boolean>;
  /** Whether the connector tokens the schedule depends on are still valid (IPB-03-78). */
  connectorsValid?: (tx: Tx, schedule: ScheduleRow) => Promise<boolean>;
  /** Called after a run's task is created and started, outside the scheduling transaction. */
  onStarted?: (
    ctx: KernelContext,
    run: { scheduleId: string; taskId: string; skillKey: string; ownerId: string },
  ) => Promise<void>;
  onRead?: (r: ServiceReadRecord) => void;
}

export type RunOutcome =
  | { outcome: "started"; taskId: string }
  | { outcome: "skipped"; code: "IPB-VID-020" | "IPB-VID-021"; reason: SkipReason }
  | { outcome: "duplicate" | "inactive" };

/** Rolls back a scheduling transaction that found nothing to do (the kernel ledgers every commit). */
class Noop {
  constructor(readonly outcome: Extract<RunOutcome, { outcome: "duplicate" | "inactive" }>) {}
}

const isAgent = (ctx: KernelContext) =>
  ctx.principal.type === "agent" || ctx.principal.roles.some((r) => r.startsWith("AGT_"));

export class Scheduler {
  private readonly reader: ServiceReader;
  constructor(private readonly o: SchedulerOptions) {
    this.reader = new ServiceReader({
      kernel: o.kernel,
      audit: o.audit,
      role: "SVC_VIDHI_SCHED",
      principalId: SCHEDULE_POLLER_PRINCIPAL_ID,
      ...(o.onRead ? { onRead: o.onRead } : {}),
    });
  }

  private async setting<T>(ctx: KernelContext, key: string, fallback: T): Promise<T> {
    try {
      const v = await this.o.settings.get(ctx, key);
      return v === null || v === undefined ? fallback : (v as T);
    } catch {
      return fallback;
    }
  }

  private eventProduct(): string {
    return this.o.product === "PLATFORM" ? "REF" : this.o.product;
  }

  /**
   * A person creates a schedule for themselves; their current roles are recorded, and every run
   * re-checks that they still hold them. Agents cannot create schedules (`IPB-VID-012`).
   */
  async create(
    ctx: KernelContext,
    i: {
      skillKey: string;
      recurrence?: string;
      event?: { type: string; condition?: string };
      templateKey?: string;
      now?: Date;
    },
  ): Promise<{ scheduleId: string; nextRunAt: Date | null }> {
    if (isAgent(ctx))
      throw new IpbError("IPB-VID-012", { detail: "an agent cannot create a schedule" });
    const skill = this.o.skills.get(i.skillKey);
    if (!skill) throw new IpbError("IPB-VID-001", { detail: `skill ${i.skillKey} is not loaded` });
    if (!skill.manifest.sched_allowed)
      throw new ScheduleError(`${i.skillKey} does not allow scheduling (sched_allowed is false)`);
    if (!(await this.setting(ctx, "vidhi.sched.enabled", true)))
      throw new ScheduleError(
        "scheduling is turned off for this organisation (vidhi.sched.enabled)",
      );
    if (Boolean(i.recurrence) === Boolean(i.event))
      throw new ScheduleError("give either a recurrence or an event trigger");
    let next: Date | null = null;
    if (i.recurrence) {
      try {
        next = nextOccurrence(parseRecurrence(i.recurrence), i.now ?? new Date());
      } catch (e) {
        if (e instanceof RecurrenceError) throw new ScheduleError(e.message);
        throw e;
      }
      if (!next) throw new ScheduleError("the recurrence has no future occurrence");
    }
    if (i.event) {
      if (!/^in\.[a-z0-9]+\.[a-z0-9_]+\.[A-Za-z]+\.v\d+$/i.test(i.event.type))
        throw new ScheduleError("the event type must be in.<product>.<module>.<Event>.v<n>");
      if (i.event.condition) {
        if (!this.o.cel) throw new ScheduleError("event conditions need the rules engine");
        const r = await this.o.cel.evaluateCel(i.event.condition, { type: i.event.type, data: {} });
        if (!r.ok && (r.error === "parse" || r.error === "limit"))
          throw new ScheduleError(`the condition does not compile (${r.error})`);
      }
    }
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const id = newId("sch");
        await tx.query(
          `insert into vidhi.schedule
             (id, tenant_id, skill_key, owner_id, owner_roles, kind, recurrence, event_type, condition,
              template_key, next_run_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            id,
            ctx.tenantId,
            i.skillKey,
            ctx.principal.id,
            [...ctx.principal.roles],
            i.recurrence ? "recurrence" : "event",
            i.recurrence ?? null,
            i.event?.type ?? null,
            i.event?.condition ?? null,
            i.templateKey ?? null,
            next,
          ],
        );
        await this.o.audit.record(tx, {
          action: "vidhi.schedule.create",
          resourceType: "vidhi_schedule",
          resourceId: id,
          after: {
            skill_key: i.skillKey,
            kind: i.recurrence ? "recurrence" : "event",
            next_run_at: next?.toISOString() ?? null,
          },
        });
        return { scheduleId: id, nextRunAt: next };
      },
      { action: "vidhi.schedule.create" },
    );
  }

  private async load(tx: Tx, id: string, lock = false): Promise<ScheduleRow> {
    const r = await tx.query<ScheduleRow>(
      `select id, tenant_id, skill_key, owner_id, owner_roles, kind, recurrence, event_type,
              condition, state, next_run_at, consecutive_skips
         from vidhi.schedule where id = $1${lock ? " for update" : ""}`,
      [id],
    );
    if (!r.rows[0]) throw new ScheduleError(`schedule ${id} not found`);
    return r.rows[0];
  }

  /** The IPB-03-65 re-check: a skip reason, or the owner's roles now when the run may go ahead. */
  private async recheck(
    tx: Tx,
    ctx: KernelContext,
    s: ScheduleRow,
  ): Promise<{ skip: SkipReason } | { roles: string[] }> {
    if (!(await this.setting(ctx, "vidhi.sched.enabled", true)))
      return { skip: "scheduling_disabled" };
    const member = await (this.o.members ?? memberStatus)(tx, s.owner_id);
    if (!member?.active) return { skip: "owner_inactive" };
    if (s.owner_roles.some((r) => !member.roles.includes(r))) return { skip: "owner_role_removed" };
    if (
      this.o.authorize &&
      !(await this.o.authorize(tx, { id: s.owner_id, roles: member.roles }, s.skill_key))
    )
      return { skip: "not_permitted" };
    if (this.o.entitled && !(await this.o.entitled(tx, s.skill_key))) return { skip: "plan" };
    const skill = this.o.skills.get(s.skill_key);
    if (!skill || !skill.manifest.sched_allowed) return { skip: "skill_invalid" };
    const enabled = await this.setting(ctx, `vidhi.skill.${keySegment(s.skill_key)}.enabled`, true);
    if (!enabled || !(await this.o.autonomy.readState(tx, s.skill_key)).enabled)
      return { skip: "skill_disabled" };
    if ((await this.o.kill.gateway(ctx, s.skill_key)).on) return { skip: "kill_switch" };
    if (this.o.connectorsValid && !(await this.o.connectorsValid(tx, s)))
      return { skip: "connector" };
    return { roles: member.roles };
  }

  /**
   * Run one occurrence of a schedule in its tenant: exactly once per `occurrenceKey`, re-checking
   * permissions first. A recurring schedule moves on to its next occurrence either way.
   */
  async runOccurrence(
    tenantId: string,
    scheduleId: string,
    occurrenceKey: string,
    now = new Date(),
  ): Promise<RunOutcome> {
    const ctx = scheduledRunContext(tenantId);
    const decided = await this.o.kernel
      .mutate(
        ctx,
        async (
          tx,
        ): Promise<
          | Exclude<RunOutcome, { outcome: "started" }>
          | { outcome: "go"; skillKey: string; ownerId: string; ownerRoles: string[] }
        > => {
          const s = await this.load(tx, scheduleId, true);
          if (s.state !== "ACTIVE") throw new Noop({ outcome: "inactive" });
          const seen = await tx.query(
            "select 1 from vidhi.schedule_run where schedule_id = $1 and occurrence_key = $2",
            [s.id, occurrenceKey],
          );
          if (seen.rowCount) throw new Noop({ outcome: "duplicate" });
          const next =
            s.kind === "recurrence" ? nextOccurrence(parseRecurrence(s.recurrence!), now) : null;
          const check = await this.recheck(tx, ctx, s);
          if ("skip" in check) return this.skip(tx, ctx, s, occurrenceKey, check.skip, next, now);
          await tx.query(
            `insert into vidhi.schedule_run (tenant_id, schedule_id, occurrence_key, outcome)
           values ($1, $2, $3, 'started')`,
            [tenantId, s.id, occurrenceKey],
          );
          await tx.query(
            `update vidhi.schedule set consecutive_skips = 0, last_run_at = $2, updated_at = now(),
                  next_run_at = $3, state = $4 where id = $1`,
            [s.id, now, next, s.kind === "recurrence" && !next ? "ENDED" : "ACTIVE"],
          );
          await this.o.audit.record(tx, {
            action: "vidhi.schedule.run",
            resourceType: "vidhi_schedule",
            resourceId: s.id,
            after: { occurrence: occurrenceKey, next_run_at: next?.toISOString() ?? null },
          });
          return {
            outcome: "go" as const,
            skillKey: s.skill_key,
            ownerId: s.owner_id,
            ownerRoles: check.roles,
          };
        },
        { action: "vidhi.schedule.run" },
      )
      .catch((e: unknown) => {
        if (e instanceof Noop) return e.outcome;
        throw e;
      });
    if (decided.outcome !== "go") return decided;
    const { taskId } = await this.o.runtime.create(ctx, {
      skillKey: decided.skillKey,
      ownerId: decided.ownerId,
      ownerRoles: decided.ownerRoles,
      scheduleId,
    });
    await this.o.kernel.mutate(
      ctx,
      async (tx) => {
        await tx.query(
          `update vidhi.schedule_run set task_id = $3 where schedule_id = $1 and occurrence_key = $2`,
          [scheduleId, occurrenceKey, taskId],
        );
        await this.o.audit.record(tx, {
          action: "vidhi.schedule.task",
          resourceType: "vidhi_schedule",
          resourceId: scheduleId,
          after: { task_id: taskId, occurrence: occurrenceKey },
        });
      },
      { action: "vidhi.schedule.task" },
    );
    await this.o.runtime.start(ctx, taskId);
    await this.o.onStarted?.(ctx, {
      scheduleId,
      taskId,
      skillKey: decided.skillKey,
      ownerId: decided.ownerId,
    });
    return { outcome: "started", taskId };
  }

  private async skip(
    tx: Tx,
    ctx: KernelContext,
    s: ScheduleRow,
    occurrenceKey: string,
    reason: SkipReason,
    next: Date | null,
    now: Date,
  ): Promise<Extract<RunOutcome, { outcome: "skipped" }>> {
    const skips = s.consecutive_skips + 1;
    const max = Math.max(1, Number(await this.setting(ctx, "vidhi.sched.max_skips", 3)));
    const pause = skips >= max;
    const code = pause ? ("IPB-VID-021" as const) : ("IPB-VID-020" as const);
    await tx.query(
      `insert into vidhi.schedule_run (tenant_id, schedule_id, occurrence_key, outcome, code, reason)
       values ($1, $2, $3, 'skipped', $4, $5)`,
      [ctx.tenantId, s.id, occurrenceKey, code, reason],
    );
    await tx.query(
      `update vidhi.schedule set consecutive_skips = $2, last_run_at = $3, next_run_at = $4,
              state = $5, paused_code = $6, updated_at = now() where id = $1`,
      [
        s.id,
        skips,
        now,
        next,
        pause ? "PAUSED" : s.kind === "recurrence" && !next ? "ENDED" : "ACTIVE",
        pause ? "IPB-VID-021" : null,
      ],
    );
    await this.o.audit.record(tx, {
      action: pause ? "vidhi.schedule.pause" : "vidhi.schedule.skip",
      resourceType: "vidhi_schedule",
      resourceId: s.id,
      after: { code, reason, consecutive_skips: skips, occurrence: occurrenceKey },
    });
    if (this.o.outbox)
      await this.o.outbox.publish(tx, "vidhi", {
        envelope: internalEvent({
          product: this.eventProduct(),
          event: VIDHI_EVENTS.ScheduleRunSkipped,
          tenantId: ctx.tenantId,
          data: ScheduleRunSkippedData.parse({
            schedule_id: s.id,
            tenant_id: ctx.tenantId,
            skill_key: s.skill_key,
            code,
            reason,
            consecutive_skips: skips,
          }),
        }),
      });
    await this.o.notify?.enqueue(tx, {
      class: "vidhi.schedule.skipped",
      to: [{ ref: s.owner_id }],
      vars: { id: s.id, skill: s.skill_key, reason },
      deepLink: `/settings/ai/schedules/${s.id}`,
      idempotencyKey: `vidhi.schedule.skipped:${s.id}:${occurrenceKey}`,
    });
    if (pause)
      await this.o.notify?.enqueue(tx, {
        class: "vidhi.schedule.paused",
        to: [{ ref: s.owner_id }],
        vars: { id: s.id, skill: s.skill_key, skips: String(skips) },
        deepLink: `/settings/ai/schedules/${s.id}`,
        idempotencyKey: `vidhi.schedule.paused:${s.id}:${occurrenceKey}`,
      });
    return { outcome: "skipped", code, reason };
  }

  /** The due-run poller: run every recurring occurrence due by `now`, each in its own tenant. */
  async tick(now = new Date(), limit = 100): Promise<RunOutcome[]> {
    const due = await this.reader.read<{ id: string; tenant_id: string; next_run_at: Date }>(
      "vidhi.schedule",
      `select id, tenant_id, next_run_at from vidhi.schedule
        where state = 'ACTIVE' and kind = 'recurrence' and next_run_at <= $1
        order by next_run_at limit $2`,
      [now, limit],
    );
    const out: RunOutcome[] = [];
    for (const d of due)
      out.push(
        await this.runOccurrence(d.tenant_id, d.id, new Date(d.next_run_at).toISOString(), now),
      );
    return out;
  }

  /**
   * An event arrived in the tenant (from the product's inbox consumer): start every active event
   * schedule whose type matches and whose CEL condition is true. The event id keys the run.
   */
  async onEvent(
    tenantId: string,
    event: { id: string; type: string; data: unknown },
    now = new Date(),
  ): Promise<RunOutcome[]> {
    const ctx = scheduledRunContext(tenantId);
    const matching = await this.o.kernel.read(
      ctx,
      async (tx) =>
        (
          await tx.query<{ id: string; condition: string | null }>(
            `select id, condition from vidhi.schedule
              where state = 'ACTIVE' and kind = 'event' and event_type = $1 order by created_at`,
            [event.type],
          )
        ).rows,
    );
    const out: RunOutcome[] = [];
    for (const s of matching) {
      if (s.condition) {
        if (!this.o.cel) continue;
        const r = await this.o.cel.evaluateCel(s.condition, { type: event.type, data: event.data });
        if (!r.ok || r.value !== true) continue;
      }
      out.push(await this.runOccurrence(tenantId, s.id, `event:${event.id}`, now));
    }
    return out;
  }

  /** The owner resumes a paused schedule; the skip count starts again. */
  async resume(ctx: KernelContext, scheduleId: string, now = new Date()): Promise<void> {
    if (isAgent(ctx))
      throw new IpbError("IPB-VID-012", { detail: "an agent cannot resume a schedule" });
    await this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const s = await this.load(tx, scheduleId, true);
        if (s.owner_id !== ctx.principal.id && !ctx.principal.roles.includes("ORG_ADMIN"))
          throw new ScheduleError("only the owner or an ORG_ADMIN may resume a schedule");
        if (s.state !== "PAUSED") throw new ScheduleError(`schedule ${scheduleId} is ${s.state}`);
        const next =
          s.kind === "recurrence" ? nextOccurrence(parseRecurrence(s.recurrence!), now) : null;
        await tx.query(
          `update vidhi.schedule set state = $2, consecutive_skips = 0, paused_code = null,
                  next_run_at = $3, updated_at = now() where id = $1`,
          [scheduleId, s.kind === "recurrence" && !next ? "ENDED" : "ACTIVE", next],
        );
        await this.o.audit.record(tx, {
          action: "vidhi.schedule.resume",
          resourceType: "vidhi_schedule",
          resourceId: scheduleId,
          before: { state: "PAUSED" },
          after: { state: "ACTIVE", next_run_at: next?.toISOString() ?? null },
        });
      },
      { action: "vidhi.schedule.resume" },
    );
  }
}
