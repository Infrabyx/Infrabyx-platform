// The feedback sweep (IPB-06-62, `@IPB-06-AT-20`; OWNER-QUESTIONS #48; PL5 plan §7.1). Run `tick()`
// from one worker every few minutes and `purge()` daily. SVC_FEEDBACK_SLA reads ids, tenants, states
// and timers only (never a summary or a subject); each read is ledgered per tenant.
//   timers   an open accessibility item past a due date it has not met gets the timer added to
//            `sla_breaches` and one `AccessibilityIssueSlaBreached` (for the OH controls dashboard
//            and the next accessibility statement). Each timer breaches at most once.
//              ack         nothing from OH and no triage by `ack_due_at` (24 hours)
//              interim     P1 on a regulated step with no human-assisted path by the next business day
//              workaround  no workaround by `workaround_due_at` (5 days)
//              fix         not closed by `fix_due_at` (30 days for P1, 90 otherwise)
//   hand-off pending items (no OH reference yet) are retried, at most 10 times.
//   purge    items closed more than 3 years ago are deleted with their history, one ledgered batch
//            per tenant (the rule itself is a restrictive policy in `feedback/0001`).
import type {
  AuditSink,
  KernelContext,
  MutationKernel,
  OutboxWriter,
} from "@infrabyx/contracts/kernel";
import { AccessibilityIssueSlaBreachedData, FEEDBACK_EVENTS } from "@infrabyx/contracts";
import { internalEvent } from "@infrabyx/config/events";
import { ServiceReader } from "@infrabyx/tenancy";
import type { FeedbackService } from "./service.js";

export const FEEDBACK_SWEEP_PRINCIPAL_ID = "svc_feedback_sla";
export const SLA_TIMERS = ["ack", "interim", "workaround", "fix"] as const;
export type SlaTimer = (typeof SLA_TIMERS)[number];
export const MAX_HAND_OFF_ATTEMPTS = 10;
const NOTHING_DUE = Symbol("nothing due");

interface TimerRow {
  id: string;
  tenant_id: string;
  ack_due_at: Date | null;
  interim_due_at: Date | null;
  workaround_due_at: Date | null;
  fix_due_at: Date | null;
  acknowledged_at: Date | null;
  workaround_at: Date | null;
  sla_breaches: string[];
}

/** The timers an open item has missed by `now` and not yet reported. */
export function missedTimers(r: TimerRow, now: Date): { timer: SlaTimer; due: Date }[] {
  const out: { timer: SlaTimer; due: Date }[] = [];
  const past = (d: Date | null): d is Date => !!d && d.getTime() < now.getTime();
  if (past(r.ack_due_at) && !r.acknowledged_at) out.push({ timer: "ack", due: r.ack_due_at });
  if (past(r.interim_due_at) && !r.workaround_at)
    out.push({ timer: "interim", due: r.interim_due_at });
  if (past(r.workaround_due_at) && !r.workaround_at)
    out.push({ timer: "workaround", due: r.workaround_due_at });
  if (past(r.fix_due_at)) out.push({ timer: "fix", due: r.fix_due_at });
  return out.filter((t) => !r.sla_breaches.includes(t.timer));
}

const sweepContext = (tenantId: string): KernelContext => ({
  tenantId,
  principal: { id: FEEDBACK_SWEEP_PRINCIPAL_ID, type: "service", roles: [] },
});

export class FeedbackSweep {
  private readonly reader: ServiceReader;
  constructor(
    private readonly o: {
      kernel: MutationKernel;
      audit: AuditSink;
      product: string;
      service: FeedbackService;
      outbox?: OutboxWriter;
      now?: () => Date;
      onRead?: ConstructorParameters<typeof ServiceReader>[0]["onRead"];
    },
  ) {
    this.reader = new ServiceReader({
      kernel: o.kernel,
      audit: o.audit,
      role: "SVC_FEEDBACK_SLA",
      principalId: FEEDBACK_SWEEP_PRINCIPAL_ID,
      ...(o.onRead ? { onRead: o.onRead } : {}),
    });
  }

  private now(): Date {
    return this.o.now?.() ?? new Date();
  }

  async tick(): Promise<{ breaches: number; handedOff: number }> {
    const now = this.now();
    const open = await this.reader.read<TimerRow>(
      "feedback.item",
      `select id, tenant_id, ack_due_at, interim_due_at, workaround_due_at, fix_due_at, acknowledged_at,
              workaround_at, sla_breaches
         from feedback.item
        where type = 'accessibility' and closed_at is null
          and least(ack_due_at, interim_due_at, workaround_due_at, fix_due_at) < $1
        order by created_at limit 500`,
      [now],
    );
    let breaches = 0;
    for (const r of open) {
      const missed = missedTimers(r, now);
      if (missed.length) breaches += await this.breach(r.tenant_id, r.id, missed);
    }
    const pending = await this.reader.read<{ id: string; tenant_id: string }>(
      "feedback.item",
      `select id, tenant_id from feedback.item
        where oh_ref is null and closed_at is null and created_at < $1 and hand_off_attempts < $2
        order by created_at limit 200`,
      [new Date(now.getTime() - 60_000), MAX_HAND_OFF_ATTEMPTS],
    );
    let handedOff = 0;
    for (const p of pending) {
      const ref = await this.o.service.handOff(p.tenant_id, p.id).catch(() => null);
      if (ref) handedOff++;
    }
    return { breaches, handedOff };
  }

  private async breach(
    tenantId: string,
    id: string,
    missed: { timer: SlaTimer; due: Date }[],
  ): Promise<number> {
    return this.o.kernel.mutate(
      sweepContext(tenantId),
      async (tx) => {
        const cur = (
          await tx.query<{
            priority: "P1" | "P2" | "P3" | null;
            regulated_step: boolean;
            sla_breaches: string[];
          }>(
            "select priority, regulated_step, sla_breaches from feedback.item where id = $1 for update",
            [id],
          )
        ).rows[0];
        const fresh = missed.filter((m) => cur && !cur.sla_breaches.includes(m.timer));
        if (!cur || !fresh.length) {
          await this.o.audit.record(tx, {
            action: "feedback.a11y.sla_checked",
            resourceType: "feedback_item",
            resourceId: id,
            after: { breaches: "already recorded" },
          });
          return 0;
        }
        await tx.query(
          "update feedback.item set sla_breaches = sla_breaches || $2::text[] where id = $1",
          [id, fresh.map((m) => m.timer)],
        );
        await this.o.audit.record(tx, {
          action: "feedback.a11y.sla_breached",
          resourceType: "feedback_item",
          resourceId: id,
          after: { timers: fresh.map((m) => m.timer) },
        });
        if (this.o.outbox)
          for (const m of fresh)
            await this.o.outbox.publish(tx, "feedback", {
              envelope: internalEvent({
                product: this.o.product,
                event: FEEDBACK_EVENTS.AccessibilityIssueSlaBreached,
                tenantId,
                dataclass: "INTERNAL",
                data: AccessibilityIssueSlaBreachedData.parse({
                  fbk_id: id,
                  timer: m.timer,
                  due_at: m.due.toISOString(),
                  priority: cur.priority,
                  regulated_step: cur.regulated_step,
                }),
              }),
            });
        return fresh.length;
      },
      { action: "feedback.a11y.sla_breached" },
    );
  }

  /** Items closed more than 3 years ago, with their history (#48). */
  async purge(o: { batch?: number } = {}): Promise<{ deleted: number }> {
    const batch = Math.min(o.batch ?? 500, 1000);
    const tenants = await this.reader.read<{ tenant_id: string }>(
      "feedback.item",
      `select tenant_id from feedback.item where closed_at < now() - interval '3 years'
        group by tenant_id order by tenant_id`,
    );
    let deleted = 0;
    for (const t of tenants)
      for (;;) {
        const n = await this.purgeBatch(t.tenant_id, batch);
        deleted += n;
        if (n < batch) break;
      }
    return { deleted };
  }

  private async purgeBatch(tenantId: string, size: number): Promise<number> {
    try {
      return await this.o.kernel.mutate(
        sweepContext(tenantId),
        async (tx) => {
          const r = await tx.query<{ id: string }>(
            `delete from feedback.item where id in (
               select id from feedback.item where closed_at < now() - interval '3 years'
                order by closed_at, id limit $1)
             returning id`,
            [size],
          );
          if (!r.rows.length) throw NOTHING_DUE;
          await this.o.audit.record(tx, {
            action: "feedback.item.purge",
            resourceType: "feedback_item",
            resourceId: "batch",
            after: { rule: "3 years after closure", ids: r.rows.map((x) => x.id).sort() },
          });
          return r.rows.length;
        },
        { action: "feedback.item.purge" },
      );
    } catch (e) {
      if (e === NOTHING_DUE) return 0;
      throw e;
    }
  }
}
