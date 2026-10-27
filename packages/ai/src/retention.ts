// AI run retention (IPB-03-55; owner approval OWNER-QUESTIONS #30, PL4-D-05). Run rows hold
// metadata only (no content is ever stored). A routine run is deleted 180 days after it ran
// (`ai.obs.run_retention_days`, never below 180), each deletion ledgered in the same transaction.
// A run linked to an approval, a statutory output or a maker-checker request is held for as long
// as that record is kept: the sweep never deletes it, and PostgreSQL refuses the delete too
// (migration `ai/0002`). The owner of the linked record releases the hold when the record itself
// is deleted; the run then falls under the 180-day rule.
import type { AuditSink, KernelContext, MutationKernel, Tx } from "@infrabyx/contracts/kernel";
import { PLATFORM_TENANT_ID } from "@infrabyx/contracts/ids";
import { NotFoundError, ServiceReader } from "@infrabyx/tenancy";
import type { SettingsReader } from "./kill.js";

export const RUN_HOLD_KINDS = ["approval", "statutory_output", "maker_checker"] as const;
export type RunHoldKind = (typeof RUN_HOLD_KINDS)[number];
export interface RunHold {
  kind: RunHoldKind;
  /** The linked record's id (an approval id, a statutory output id, a maker-checker request id). */
  ref: string;
}

/** The owner's floor; the setting may only raise it (PL4-D-05). */
export const RUN_RETENTION_FLOOR_DAYS = 180;
export const AI_RUN_SWEEP_PRINCIPAL_ID = "svc_ai_run_sweep";
const RETENTION_SETTING = "ai.obs.run_retention_days";
const NOTHING_DUE = Symbol("nothing due");

/** The sweep's per-tenant context: a service principal that only deletes due runs. */
export const runSweepContext = (tenantId: string): KernelContext => ({
  tenantId,
  principal: { id: AI_RUN_SWEEP_PRINCIPAL_ID, type: "service", roles: ["SVC_AI_RETENTION"] },
});

const checkHold = (h: RunHold): void => {
  if (!(RUN_HOLD_KINDS as readonly string[]).includes(h.kind))
    throw new Error(`unknown run hold kind ${h.kind}`);
  if (!h.ref || h.ref.length > 200)
    throw new Error("a run hold needs a ref of 1 to 200 characters");
};

/** Write a hold inside the caller's transaction (the gateway uses it in the run's transaction). */
export async function insertRunHold(
  tx: Tx,
  audit: AuditSink,
  ctx: KernelContext,
  runId: string,
  hold: RunHold,
): Promise<void> {
  checkHold(hold);
  await tx.query(
    `insert into ai.run_hold (run_id, tenant_id, kind, ref, held_by) values ($1, $2, $3, $4, $5)
     on conflict (run_id, kind, ref) do nothing`,
    [runId, ctx.tenantId, hold.kind, hold.ref, ctx.principal.id],
  );
  await audit.record(tx, {
    action: "ai.run.hold",
    resourceType: "ai_run",
    resourceId: runId,
    after: { kind: hold.kind, ref: hold.ref },
  });
}

export interface RunRetentionOptions {
  kernel: MutationKernel;
  audit: AuditSink;
  /** Reads `ai.obs.run_retention_days` (platform tier); the floor applies when unreadable. */
  settings?: SettingsReader;
  onRead?: ConstructorParameters<typeof ServiceReader>[0]["onRead"];
}

export class RunRetention {
  private readonly reader: ServiceReader;
  constructor(private readonly o: RunRetentionOptions) {
    this.reader = new ServiceReader({
      kernel: o.kernel,
      audit: o.audit,
      role: "SVC_AI_RUN_SWEEP",
      principalId: AI_RUN_SWEEP_PRINCIPAL_ID,
      ...(o.onRead ? { onRead: o.onRead } : {}),
    });
  }

  /** Keep a run for as long as the linked record is kept. Idempotent; ledgered. */
  async hold(ctx: KernelContext, runId: string, hold: RunHold): Promise<void> {
    checkHold(hold);
    await this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const r = await tx.query("select 1 from ai.run where id = $1", [runId]);
        if (!r.rowCount) throw new NotFoundError("ai run");
        await insertRunHold(tx, this.o.audit, ctx, runId, hold);
      },
      { action: "ai.run.hold" },
    );
  }

  /**
   * The linked record is gone: release its hold, so the run falls under the 180-day rule again.
   * Releasing is final; other holds on the same run still keep it.
   */
  async release(ctx: KernelContext, runId: string, hold: RunHold): Promise<void> {
    checkHold(hold);
    await this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const r = await tx.query(
          `update ai.run_hold set released_at = now(), released_by = $4
            where run_id = $1 and kind = $2 and ref = $3 and released_at is null`,
          [runId, hold.kind, hold.ref, ctx.principal.id],
        );
        if (!r.rowCount) throw new NotFoundError("active run hold");
        await this.o.audit.record(tx, {
          action: "ai.run.hold_release",
          resourceType: "ai_run",
          resourceId: runId,
          after: { kind: hold.kind, ref: hold.ref },
        });
      },
      { action: "ai.run.hold_release" },
    );
  }

  /** The retention in days: the setting, never below the owner's 180-day floor. */
  async retentionDays(): Promise<number> {
    let v: unknown;
    try {
      v = await this.o.settings?.get(
        {
          tenantId: PLATFORM_TENANT_ID,
          scope: "platform",
          principal: { id: AI_RUN_SWEEP_PRINCIPAL_ID, type: "service", roles: [] },
        },
        RETENTION_SETTING,
      );
    } catch {
      v = null;
    }
    const n = typeof v === "number" && Number.isInteger(v) ? v : RUN_RETENTION_FLOOR_DAYS;
    return Math.max(n, RUN_RETENTION_FLOOR_DAYS);
  }

  /**
   * The retention sweep (run it daily from one worker). Finds tenants with runs past the retention
   * through SVC_AI_RUN_SWEEP (ledgered per tenant), then deletes due, unheld runs per tenant in
   * batches; each batch is one transaction with one `ai.run.purge` ledger entry per deleted run.
   */
  async sweep(o: { limit?: number; batch?: number } = {}): Promise<{ deleted: number }> {
    const limit = o.limit ?? 10_000;
    const batch = Math.min(o.batch ?? 500, 1000);
    const days = await this.retentionDays();
    const tenants = await this.reader.read<{ tenant_id: string }>(
      "ai.run",
      `select tenant_id, count(*)::int as n from ai.run
        where created_at < now() - make_interval(days => $1)
        group by tenant_id order by tenant_id`,
      [days],
    );
    let deleted = 0;
    for (const t of tenants) {
      while (deleted < limit) {
        const n = await this.purgeBatch(t.tenant_id, days, Math.min(batch, limit - deleted));
        deleted += n;
        if (n < batch) break;
      }
    }
    return { deleted };
  }

  private async purgeBatch(tenantId: string, days: number, size: number): Promise<number> {
    if (size <= 0) return 0;
    try {
      return await this.o.kernel.mutate(
        runSweepContext(tenantId),
        async (tx) => {
          const r = await tx.query<{ id: string }>(
            `delete from ai.run where id in (
               select r.id from ai.run r
                where r.created_at < now() - make_interval(days => $1)
                  and not exists (select 1 from ai.run_hold h
                                   where h.run_id = r.id and h.released_at is null)
                order by r.created_at, r.id limit $2)
             returning id`,
            [days, size],
          );
          // Nothing due (held runs, or a concurrent sweep took them): roll back, ledger nothing.
          if (!r.rows.length) throw NOTHING_DUE;
          const ids = r.rows.map((x) => x.id).sort();
          for (const id of ids)
            await this.o.audit.record(tx, {
              action: "ai.run.purge",
              resourceType: "ai_run",
              resourceId: id,
              after: { reason: "retention", retention_days: days },
            });
          return ids.length;
        },
        { action: "ai.run.purge" },
      );
    } catch (e) {
      if (e === NOTHING_DUE) return 0;
      throw e;
    }
  }
}
