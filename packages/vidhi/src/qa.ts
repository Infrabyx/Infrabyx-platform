// QA sampling (IPB-03-85; PL4 plan §8.9). A share of finished tasks is queued for human review by
// the skill's owner: `vidhi.qa.sample_rate` (2 % by default), 10 % while the skill is in its first
// 30 days in the tenant. Sampling is deterministic per task (a hash of its id), so retries never
// add a second sample. Reviews give precision (correct among acted-on outputs) and recall (correct
// among those that should have been acted on); once a skill has enough reviews since its last level
// change and either figure falls below the floor, the skill is demoted one level. The review count
// and both floors are governed, tighten-only settings (`vidhi.qa.min_reviews`,
// `vidhi.qa.precision_floor`, `vidhi.qa.recall_floor`; OWNER-QUESTIONS #40, PL4-D-13): a tenant may
// ask for more evidence or a higher floor, never less, and nothing reads below the platform floor.
import { IpbError } from "@infrabyx/contracts/errors";
import type { AuditSink, KernelContext, MutationKernel, Tx } from "@infrabyx/contracts/kernel";
import { sha256Hex } from "@infrabyx/crypto";
import type { SettingsReader } from "@infrabyx/ai";
import type { Autonomy } from "./autonomy.js";
import type { SkillRegistry } from "./skills.js";

export const QA_NEW_SKILL_RATE = 0.1;
export const QA_NEW_SKILL_DAYS = 30;
/** The platform floor (PL4-D-11, PL4-D-13): 20 reviews; 0.8 precision and recall. */
export const QA_PLATFORM_FLOOR = { precision: 0.8, recall: 0.8, minReviews: 20 } as const;
export type QaFloor = { precision: number; recall: number; minReviews: number };

export type QaVerdict = "correct" | "incorrect" | "missed";

export interface QaMetrics {
  reviewed: number;
  correct: number;
  incorrect: number;
  missed: number;
  /** Null until there is something to divide by. */
  precision: number | null;
  recall: number | null;
}

/** The skill owner's Work Inbox, structurally `InboxService` in `@infrabyx/workflow`. */
export interface QaInbox {
  enqueue(
    tx: Tx,
    item: { kind: "vidhi.qa_review"; taskId: string; skillKey: string; assigneeRole: string },
  ): Promise<unknown>;
}

export interface QaSamplerOptions {
  kernel: MutationKernel;
  audit: AuditSink;
  skills: SkillRegistry;
  autonomy: Autonomy;
  settings?: SettingsReader;
  inbox?: QaInbox;
}

const isAgent = (ctx: KernelContext) =>
  ctx.principal.type === "agent" || ctx.principal.roles.some((r) => r.startsWith("AGT_"));

/** A stable number in [0, 1) for a task id. */
export const sampleDraw = (taskId: string): number =>
  parseInt(sha256Hex(`vidhi.qa:${taskId}`).slice(0, 8), 16) / 0x1_0000_0000;

export class QaSampler {
  constructor(private readonly o: QaSamplerOptions) {}

  /** The tenant's floor: its settings, never below the platform floor (unreadable: the floor). */
  async floor(ctx: KernelContext): Promise<QaFloor> {
    const read = async (key: string, floor: number, int: boolean): Promise<number> => {
      try {
        const v = Number(await this.o.settings?.get(ctx, key));
        if (Number.isFinite(v) && (!int || Number.isInteger(v))) return Math.max(v, floor);
      } catch {
        // The platform floor stays.
      }
      return floor;
    };
    const p = QA_PLATFORM_FLOOR;
    return {
      minReviews: await read("vidhi.qa.min_reviews", p.minReviews, true),
      precision: Math.min(await read("vidhi.qa.precision_floor", p.precision, false), 1),
      recall: Math.min(await read("vidhi.qa.recall_floor", p.recall, false), 1),
    };
  }

  private async rate(ctx: KernelContext, tx: Tx, skillKey: string, now: Date): Promise<number> {
    const first = await tx.query<{ first: Date | null }>(
      "select min(created_at) as first from vidhi.task where skill_key = $1",
      [skillKey],
    );
    const since = first.rows[0]?.first;
    if (!since || now.getTime() - new Date(since).getTime() < QA_NEW_SKILL_DAYS * 86_400_000)
      return QA_NEW_SKILL_RATE;
    let rate = 0.02;
    try {
      const v = Number(await this.o.settings?.get(ctx, "vidhi.qa.sample_rate"));
      if (Number.isFinite(v) && v > 0 && v <= 1) rate = v;
    } catch {
      // The registry default stays.
    }
    return rate;
  }

  /** Call when a task finishes; queues it for review when its draw falls within the rate. */
  async maybeSample(
    ctx: KernelContext,
    taskId: string,
    now = new Date(),
  ): Promise<{ sampled: boolean; rate: number }> {
    return this.o.kernel
      .mutate(
        ctx,
        async (tx) => {
          const t = await tx.query<{ skill_key: string; state: string }>(
            "select skill_key, state from vidhi.task where id = $1",
            [taskId],
          );
          const task = t.rows[0];
          if (!task) throw new IpbError("IPB-VID-022", { detail: `task ${taskId} not found` });
          const rate = await this.rate(ctx, tx, task.skill_key, now);
          if (task.state !== "DONE" || sampleDraw(taskId) >= rate) throw new Skip(rate);
          const r = await tx.query(
            `insert into vidhi.qa_sample (tenant_id, skill_key, task_id, rate) values ($1, $2, $3, $4)
             on conflict (task_id) do nothing`,
            [ctx.tenantId, task.skill_key, taskId, rate],
          );
          if (!r.rowCount) throw new Skip(rate, true);
          await this.o.audit.record(tx, {
            action: "vidhi.qa.sample",
            resourceType: "vidhi_task",
            resourceId: taskId,
            after: { skill_key: task.skill_key, rate },
          });
          await this.o.inbox?.enqueue(tx, {
            kind: "vidhi.qa_review",
            taskId,
            skillKey: task.skill_key,
            assigneeRole: this.o.skills.get(task.skill_key)?.manifest.owner_role ?? "ORG_ADMIN",
          });
          return { sampled: true, rate };
        },
        { action: "vidhi.qa.sample" },
      )
      .catch((e: unknown) => {
        if (e instanceof Skip) return { sampled: e.already, rate: e.rate };
        throw e;
      });
  }

  /** Reviews since the skill's last level change, compared in SQL (microsecond timestamps). */
  private async metricsTx(tx: Tx, skillKey: string): Promise<QaMetrics> {
    const r = await tx.query<{ verdict: QaVerdict; n: string }>(
      `select verdict, count(*) as n from vidhi.qa_sample q
        where q.skill_key = $1 and q.state = 'reviewed'
          and q.reviewed_at > coalesce(
                (select s.evidence_since from vidhi.skill_state s where s.skill_key = $1),
                '-infinity'::timestamptz)
        group by verdict`,
      [skillKey],
    );
    const n = (v: QaVerdict) => Number(r.rows.find((x) => x.verdict === v)?.n ?? 0);
    const correct = n("correct");
    const incorrect = n("incorrect");
    const missed = n("missed");
    return {
      reviewed: correct + incorrect + missed,
      correct,
      incorrect,
      missed,
      precision: correct + incorrect ? correct / (correct + incorrect) : null,
      recall: correct + missed ? correct / (correct + missed) : null,
    };
  }

  /** The skill's figures since its last level change (the window demotion looks at). */
  async metrics(ctx: KernelContext, skillKey: string): Promise<QaMetrics> {
    return this.o.kernel.read(ctx, (tx) => this.metricsTx(tx, skillKey));
  }

  /**
   * The skill's owner records a verdict on a sampled task. Below the floor (with enough reviews)
   * the skill drops one level (`demotion_rate`), which also restarts the review window.
   */
  async review(
    ctx: KernelContext,
    taskId: string,
    verdict: QaVerdict,
  ): Promise<{ metrics: QaMetrics; demoted: boolean }> {
    if (isAgent(ctx)) throw new IpbError("IPB-VID-012", { detail: "an agent cannot review" });
    if (!["correct", "incorrect", "missed"].includes(verdict))
      throw new IpbError("IPB-VID-022", { detail: `unknown verdict ${verdict}` });
    const floor = await this.floor(ctx);
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const s = await tx.query<{ skill_key: string }>(
          `update vidhi.qa_sample set state = 'reviewed', verdict = $2, reviewer_id = $3, reviewed_at = now()
            where task_id = $1 and state = 'queued' returning skill_key`,
          [taskId, verdict, ctx.principal.id],
        );
        const skillKey = s.rows[0]?.skill_key;
        if (!skillKey)
          throw new IpbError("IPB-VID-022", { detail: `task ${taskId} is not waiting for review` });
        const owner = this.o.skills.get(skillKey)?.manifest.owner_role ?? "ORG_ADMIN";
        if (!ctx.principal.roles.includes(owner) && !ctx.principal.roles.includes("ORG_ADMIN"))
          throw new IpbError("IPB-VID-012", { detail: `reviews of ${skillKey} are for ${owner}` });
        await this.o.audit.record(tx, {
          action: "vidhi.qa.review",
          resourceType: "vidhi_task",
          resourceId: taskId,
          after: { skill_key: skillKey, verdict },
        });
        const metrics = await this.metricsTx(tx, skillKey);
        const below =
          metrics.reviewed >= floor.minReviews &&
          ((metrics.precision ?? 1) < floor.precision || (metrics.recall ?? 1) < floor.recall);
        if (below) await this.o.autonomy.demote(tx, ctx, skillKey, "demotion_rate", taskId);
        return { metrics, demoted: below };
      },
      { action: "vidhi.qa.review" },
    );
  }
}

/** Rolls back a sampling transaction that queued nothing (the kernel ledgers every commit). */
class Skip {
  constructor(
    readonly rate: number,
    readonly already = false,
  ) {}
}
