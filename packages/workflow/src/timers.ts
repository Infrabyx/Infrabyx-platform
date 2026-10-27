// Durable timers (PL3 plan §5.1, PL3-D-19). Every timer is a `workflow.timer` row written in the
// transaction that needs it, so a timer can never be lost. The PostgreSQL poller (`tick`) reads due
// rows across tenants as the service reader SVC_SCHEDULER (timer columns only, every read ledgered
// per tenant; PL3-D-21) and fires each in its own tenant's context;
// it is the reference engine and always runs as the catch-up reconciler. A Temporal engine
// (`TemporalTimers` in `@infrabyx/connectors/workflow`) may fire them on time as well; firing is
// idempotent because every handler re-checks the state it acts on.
import type { KernelContext, MutationKernel, AuditSink, Tx } from "@infrabyx/contracts/kernel";
import type { TimerEngine } from "@infrabyx/contracts/ports";
import { ServiceReader, type ServiceReadRecord } from "@infrabyx/tenancy";

export const TIMER_KINDS = [
  "approval.execute",
  "approval.remind",
  "approval.escalate",
  "approval.expire",
  "inbox.escalate",
] as const;
export type TimerKind = (typeof TIMER_KINDS)[number];

/** Attempts before a failing timer is given up and reported (`job_failed`). */
export const MAX_TIMER_ATTEMPTS = 5;

/** The service identity timers fire as, in the timer's own tenant context. */
export const TIMER_PRINCIPAL_ID = "svc_workflow_timers";
export const timerContext = (tenantId: string): KernelContext => ({
  tenantId,
  principal: { id: TIMER_PRINCIPAL_ID, type: "service", roles: ["SVC_WORKFLOW"] },
});
/** The poller's identity: the cross-tenant service reader SVC_SCHEDULER (OWNER-QUESTIONS #22). */
export const TIMER_POLLER_PRINCIPAL_ID = "svc_scheduler";

export interface DueTimer {
  tenantId: string;
  kind: TimerKind;
  ref: string;
  fireAt: Date;
  attempts: number;
}

/** What a fired timer does; returns "done" or "stale" (the record moved on), or throws to retry. */
export type TimerHandler = (ctx: KernelContext, t: DueTimer) => Promise<"done" | "stale">;

export const timerId = (tenantId: string, kind: TimerKind, ref: string): string =>
  `ipb-timer.${tenantId}.${kind}.${ref}`;

/** Parse a `timerId` back into its parts (for the Temporal activity). */
export function parseTimerId(id: string): { tenantId: string; kind: TimerKind; ref: string } {
  const m =
    /^ipb-timer\.(tnt_[a-z0-9_]+|tnt_[0-9A-HJKMNP-TV-Z]{26})\.((?:approval|inbox)\.[a-z]+)\.((apr|sca|ibx)_[0-9A-HJKMNP-TV-Z]{26})$/.exec(
      id,
    );
  if (!m || !(TIMER_KINDS as readonly string[]).includes(m[2] as string))
    throw new Error("not a timer id");
  return { tenantId: m[1] as string, kind: m[2] as TimerKind, ref: m[3] as string };
}

/** The PostgreSQL engine: the rows are the schedule, so there is nothing else to arrange. */
export class PgTimerEngine implements TimerEngine {
  readonly name = "pg";
  async schedule(): Promise<void> {}
  async cancel(): Promise<void> {}
}

export interface WorkflowTimersOptions {
  kernel: MutationKernel;
  audit: AuditSink;
  /** Extra engine for on-time firing (Temporal); the poller always runs as the reconciler. */
  engine?: TimerEngine;
  /** Reports a timer given up after MAX_TIMER_ATTEMPTS, inside its failure transaction. */
  onGiveUp?: (tx: Tx, t: DueTimer, error: string) => Promise<void>;
  /** Engine errors are never thrown to the caller's transaction; they arrive here. */
  onEngineError?: (e: unknown) => void;
  /** Operational log of each cross-tenant poll that found timers (the ledger has it as well). */
  onServiceRead?: (r: ServiceReadRecord) => void;
}

export class WorkflowTimers {
  private readonly handlers = new Map<TimerKind, TimerHandler>();
  private readonly poller: ServiceReader;
  constructor(private readonly o: WorkflowTimersOptions) {
    this.poller = new ServiceReader({
      kernel: o.kernel,
      audit: o.audit,
      role: "SVC_SCHEDULER",
      principalId: TIMER_POLLER_PRINCIPAL_ID,
      ...(o.onServiceRead ? { onRead: o.onServiceRead } : {}),
    });
  }

  on(kind: TimerKind, handler: TimerHandler): this {
    this.handlers.set(kind, handler);
    return this;
  }

  /** Write (or move) a timer inside the caller's transaction. */
  async schedule(tx: Tx, kind: TimerKind, ref: string, at: Date): Promise<void> {
    await tx.query(
      `insert into workflow.timer (tenant_id, kind, ref, fire_at) values ($1, $2, $3, $4)
       on conflict (tenant_id, kind, ref) do update
         set fire_at = excluded.fire_at, state = 'scheduled', attempts = 0, last_error = null, updated_at = now()`,
      [tx.ctx.tenantId, kind, ref, at],
    );
    await this.o.engine
      ?.schedule(timerId(tx.ctx.tenantId, kind, ref), at)
      .catch((e: unknown) => this.o.onEngineError?.(e));
  }

  /** Cancel timers of the given kinds for a record, inside the caller's transaction. */
  async cancel(tx: Tx, ref: string, kinds: readonly TimerKind[]): Promise<void> {
    const r = await tx.query<{ kind: TimerKind }>(
      `update workflow.timer set state = 'cancelled', updated_at = now()
        where ref = $1 and kind = any($2::text[]) and state = 'scheduled' returning kind`,
      [ref, [...kinds]],
    );
    for (const row of r.rows)
      await this.o.engine
        ?.cancel(timerId(tx.ctx.tenantId, row.kind, ref))
        .catch((e: unknown) => this.o.onEngineError?.(e));
  }

  /** Poll once: fire every due timer (at most `limit`). Returns how many fired. */
  async tick(limit = 100): Promise<number> {
    const due = await this.poller.read<{
      tenant_id: string;
      kind: TimerKind;
      ref: string;
      fire_at: Date;
      attempts: number;
    }>(
      "workflow.timer",
      `select tenant_id, kind, ref, fire_at, attempts from workflow.timer
        where state = 'scheduled' and fire_at <= now() order by fire_at limit $1`,
      [limit],
    );
    let fired = 0;
    for (const t of due) if (await this.fire(t.tenant_id, t.kind, t.ref)) fired += 1;
    return fired;
  }

  /** Fire one timer by its parts (poller or Temporal activity). False when it was not due. */
  async fire(tenantId: string, kind: TimerKind, ref: string): Promise<boolean> {
    const ctx = timerContext(tenantId);
    const t = await this.o.kernel.read(ctx, async (tx) => {
      const r = await tx.query<{ fire_at: Date; attempts: number; due: boolean }>(
        `select fire_at, attempts, fire_at <= now() as due from workflow.timer
          where kind = $1 and ref = $2 and state = 'scheduled'`,
        [kind, ref],
      );
      return r.rows[0];
    });
    if (!t || !t.due) return false;
    const handler = this.handlers.get(kind);
    const due: DueTimer = { tenantId, kind, ref, fireAt: t.fire_at, attempts: t.attempts };
    try {
      if (!handler) throw new Error(`no handler for ${kind}`);
      await handler(ctx, due);
      await this.settle(ctx, kind, ref, "fired");
      return true;
    } catch (e) {
      const code = errorCode(e);
      await this.o.kernel.mutate(
        ctx,
        async (tx) => {
          const r = await tx.query<{ attempts: number }>(
            `update workflow.timer set attempts = attempts + 1, last_error = $3, updated_at = now(),
                    state = case when attempts + 1 >= $4 then 'fired' else state end,
                    fire_at = case when attempts + 1 >= $4 then fire_at
                                   else now() + make_interval(secs => 30 * power(2, attempts)) end
              where kind = $1 and ref = $2 and state = 'scheduled' returning attempts`,
            [kind, ref, code, MAX_TIMER_ATTEMPTS],
          );
          const attempts = r.rows[0]?.attempts ?? 0;
          await this.o.audit.record(tx, {
            action: "workflow.timer.fail",
            resourceType: "timer",
            resourceId: `${kind}:${ref}`,
            after: { attempts, error: code },
          });
          if (attempts >= MAX_TIMER_ATTEMPTS)
            await this.o.onGiveUp?.(tx, { ...due, attempts }, code);
        },
        { action: "workflow.timer.fail" },
      );
      return false;
    }
  }

  /** Fire by timer id: the Temporal activity (`timerActivities(timers.fireById)`). */
  readonly fireById = async (id: string): Promise<boolean> => {
    const p = parseTimerId(id);
    return this.fire(p.tenantId, p.kind, p.ref);
  };

  /** Run the poller every `intervalMs` until the returned stop function is called. */
  start(intervalMs = 60_000, onError?: (e: unknown) => void): () => void {
    let running = false;
    const timer = setInterval(() => {
      if (running) return;
      running = true;
      this.tick()
        .catch((e: unknown) => onError?.(e))
        .finally(() => (running = false));
    }, intervalMs);
    timer.unref?.();
    return () => clearInterval(timer);
  }

  private async settle(
    ctx: KernelContext,
    kind: TimerKind,
    ref: string,
    state: "fired",
  ): Promise<void> {
    await this.o.kernel.mutate(
      ctx,
      async (tx) => {
        await tx.query(
          `update workflow.timer set state = $3, updated_at = now()
            where kind = $1 and ref = $2 and state = 'scheduled'`,
          [kind, ref, state],
        );
        await this.o.audit.record(tx, {
          action: "workflow.timer.fire",
          resourceType: "timer",
          resourceId: `${kind}:${ref}`,
        });
      },
      { action: "workflow.timer.fire" },
    );
  }
}

/** A stable, non-personal error label for the timer row (an IPB code or the error class). */
function errorCode(e: unknown): string {
  const c = (e as { code?: unknown })?.code;
  if (typeof c === "string" && /^[A-Z]{2,4}-[A-Z0-9]{2,6}-\d{3}$/.test(c)) return c;
  return e instanceof Error ? e.name.slice(0, 60) : "Error";
}
