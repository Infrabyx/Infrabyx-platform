// "What Vidhi did today" (IPB-03-83; PL4 plan §8.9). A daily digest per user (their own tasks) and
// per tenant admin (all tasks): tasks by state and autonomy level, actions executed, approvals
// waiting, AI usage and cost, and anomalies (failed tasks, locked-action attempts, demotions). It
// holds counts and ids only, is stored once per recipient and day, and is sent through NOTIFY
// (`vidhi.digest`, in-app; e-mail when the person chooses it). The full action log is searchable
// here and goes into the tenant export as `vidhi_actions.jsonl`.
import { IpbError } from "@infrabyx/contracts/errors";
import type { AuditSink, KernelContext, MutationKernel, Tx } from "@infrabyx/contracts/kernel";
import type { UsageSummary } from "@infrabyx/ai";
import { localToUtc } from "./rrule.js";
import type { ScheduleNotify } from "./schedules.js";

export interface DigestSummary {
  day: string;
  scope: "user" | "tenant";
  tasks: { total: number; byState: Record<string, number>; byLevel: Record<string, number> };
  actionsExecuted: number;
  approvalsPending: number;
  usage: UsageSummary | null;
  anomalies: { failedTasks: number; lockedAttempts: number; demotions: number };
}

export interface ActionLogEntry {
  taskId: string;
  skillKey: string;
  tool: string;
  outcome: string;
  level: string;
  ownerId: string;
  actorId: string;
  approvalId: string | null;
  at: Date;
}

export interface DigestOptions {
  kernel: MutationKernel;
  audit: AuditSink;
  notify?: ScheduleNotify;
  /** AI usage for the window (`usageSummary` from `@infrabyx/ai`). */
  usage?: (
    ctx: KernelContext,
    o: { from: Date; to: Date; principalId?: string },
  ) => Promise<UsageSummary>;
  /** The recipient's time zone (default India Standard Time). */
  timeZone?: string;
}

const isAdmin = (ctx: KernelContext) =>
  ctx.principal.roles.includes("ORG_ADMIN") || ctx.principal.roles.includes("ORG_OWNER");

/** The day's window in the zone: [local midnight, next local midnight). */
export function dayWindow(day: string, tz: string): { from: Date; to: Date } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) throw new Error("day must be YYYY-MM-DD");
  const [y, mo, d] = m.slice(1).map(Number) as [number, number, number];
  const next = new Date(Date.UTC(y, mo - 1, d + 1));
  return {
    from: localToUtc(tz, { y, m: mo, d, h: 0, mi: 0, s: 0 }),
    to: localToUtc(tz, {
      y: next.getUTCFullYear(),
      m: next.getUTCMonth() + 1,
      d: next.getUTCDate(),
      h: 0,
      mi: 0,
      s: 0,
    }),
  };
}

export class Digest {
  constructor(private readonly o: DigestOptions) {}

  private scopeCheck(ctx: KernelContext, scope: "user" | "tenant", recipientId: string): void {
    if (scope === "tenant" && !isAdmin(ctx))
      throw new IpbError("IPB-VID-012", { detail: "the tenant digest is for admins" });
    if (scope === "user" && recipientId !== ctx.principal.id && !isAdmin(ctx))
      throw new IpbError("IPB-VID-012", { detail: "a digest is for its recipient" });
  }

  private async summaryTx(
    tx: Tx,
    scope: "user" | "tenant",
    recipientId: string,
    from: Date,
    to: Date,
  ): Promise<Omit<DigestSummary, "day" | "scope" | "usage">> {
    const own = scope === "user" ? "and t.owner_id = $3" : "";
    const params = scope === "user" ? [from, to, recipientId] : [from, to];
    const tasks = await tx.query<{ state: string; level: string; n: string }>(
      `select t.state, t.level, count(*) as n from vidhi.task t
        where t.created_at >= $1 and t.created_at < $2 ${own} group by t.state, t.level`,
      params,
    );
    const byState: Record<string, number> = {};
    const byLevel: Record<string, number> = {};
    let total = 0;
    for (const r of tasks.rows) {
      const n = Number(r.n);
      total += n;
      byState[r.state] = (byState[r.state] ?? 0) + n;
      byLevel[r.level] = (byLevel[r.level] ?? 0) + n;
    }
    const steps = await tx.query<{ outcome: string; n: string }>(
      `select s.outcome, count(*) as n from vidhi.task_step s join vidhi.task t on t.id = s.task_id
        where s.created_at >= $1 and s.created_at < $2 ${own} group by s.outcome`,
      params,
    );
    const step = (o: string) => Number(steps.rows.find((r) => r.outcome === o)?.n ?? 0);
    const pending = await tx.query<{ n: string }>(
      `select count(*) as n from vidhi.task t where t.state = 'NEEDS_APPROVAL'
          and t.created_at < $2 and $1::timestamptz is not null ${own}`,
      params,
    );
    const demotions = await tx.query<{ n: string }>(
      `select count(*) as n from vidhi.autonomy_event
        where created_at >= $1 and created_at < $2 and reason like 'demotion%'`,
      [from, to],
    );
    return {
      tasks: { total, byState, byLevel },
      actionsExecuted: step("executed"),
      approvalsPending: Number(pending.rows[0]?.n ?? 0),
      anomalies: {
        failedTasks: byState.FAILED ?? 0,
        lockedAttempts: step("locked_attempt"),
        demotions: scope === "tenant" ? Number(demotions.rows[0]?.n ?? 0) : 0,
      },
    };
  }

  /** Build a digest for a day (`YYYY-MM-DD` in the recipient's zone) without storing it. */
  async build(
    ctx: KernelContext,
    i: { recipientId: string; scope: "user" | "tenant"; day: string },
  ): Promise<DigestSummary> {
    this.scopeCheck(ctx, i.scope, i.recipientId);
    const { from, to } = dayWindow(i.day, this.o.timeZone ?? "Asia/Kolkata");
    const base = await this.o.kernel.read(ctx, (tx) =>
      this.summaryTx(tx, i.scope, i.recipientId, from, to),
    );
    const usage = this.o.usage
      ? await this.o.usage(ctx, {
          from,
          to,
          ...(i.scope === "user" ? { principalId: i.recipientId } : {}),
        })
      : null;
    return { day: i.day, scope: i.scope, ...base, usage };
  }

  /** Build, store and send the day's digest once; a second call returns the stored one. */
  async send(
    ctx: KernelContext,
    i: { recipientId: string; scope: "user" | "tenant"; day: string },
  ): Promise<{ summary: DigestSummary; sent: boolean }> {
    const summary = await this.build(ctx, i);
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const r = await tx.query<{ summary: DigestSummary }>(
          `insert into vidhi.digest (tenant_id, recipient_id, scope, day, summary)
           values ($1, $2, $3, $4, $5)
           on conflict (tenant_id, recipient_id, scope, day) do nothing returning summary`,
          [ctx.tenantId, i.recipientId, i.scope, i.day, JSON.stringify(summary)],
        );
        const sent = Boolean(r.rowCount);
        await this.o.audit.record(tx, {
          action: "vidhi.digest.send",
          resourceType: "vidhi_digest",
          resourceId: `${i.scope}:${i.recipientId}:${i.day}`,
          after: { sent, tasks: summary.tasks.total },
        });
        if (sent)
          await this.o.notify?.enqueue(tx, {
            class: "vidhi.digest",
            to: [{ ref: i.recipientId }],
            vars: {
              day: i.day,
              tasks: String(summary.tasks.total),
              actions: String(summary.actionsExecuted),
              approvals: String(summary.approvalsPending),
            },
            deepLink: "/vidhi/activity",
            idempotencyKey: `vidhi.digest:${i.scope}:${i.recipientId}:${i.day}`,
          });
        if (sent) return { summary, sent };
        const stored = await tx.query<{ summary: DigestSummary }>(
          `select summary from vidhi.digest
            where tenant_id = $1 and recipient_id = $2 and scope = $3 and day = $4`,
          [ctx.tenantId, i.recipientId, i.scope, i.day],
        );
        return { summary: stored.rows[0]!.summary, sent };
      },
      { action: "vidhi.digest.send" },
    );
  }

  /** The searchable action log (a person sees their own tasks; admins see all). */
  async actionLog(
    ctx: KernelContext,
    q: { from: Date; to: Date; skillKey?: string; tool?: string; limit?: number },
  ): Promise<ActionLogEntry[]> {
    const params: unknown[] = [q.from, q.to];
    let where = "s.created_at >= $1 and s.created_at < $2";
    if (!isAdmin(ctx)) {
      params.push(ctx.principal.id);
      where += ` and t.owner_id = $${params.length}`;
    }
    if (q.skillKey) {
      params.push(q.skillKey);
      where += ` and t.skill_key = $${params.length}`;
    }
    if (q.tool) {
      params.push(q.tool);
      where += ` and s.tool = $${params.length}`;
    }
    params.push(Math.min(Math.max(q.limit ?? 100, 1), 1000));
    return this.o.kernel.read(ctx, async (tx) =>
      (
        await tx.query<{
          task_id: string;
          skill_key: string;
          tool: string;
          outcome: string;
          level: string;
          owner_id: string;
          actor_id: string;
          approval_id: string | null;
          created_at: Date;
        }>(
          `select s.task_id, t.skill_key, s.tool, s.outcome, t.level, t.owner_id, s.actor_id,
                  s.approval_id, s.created_at
             from vidhi.task_step s join vidhi.task t on t.id = s.task_id
            where ${where} order by s.created_at desc, s.id desc limit $${params.length}`,
          params,
        )
      ).rows.map((r) => ({
        taskId: r.task_id,
        skillKey: r.skill_key,
        tool: r.tool,
        outcome: r.outcome,
        level: r.level,
        ownerId: r.owner_id,
        actorId: r.actor_id,
        approvalId: r.approval_id,
        at: r.created_at,
      })),
    );
  }
}
