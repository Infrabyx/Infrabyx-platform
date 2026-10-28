// The Ecosystem inbox (Ecosystem Spec §3.4, §3.5; R1 plan M10, G2). A consumer stores each event
// by `(source, id)` and its business key before processing it; duplicates of either are
// acknowledged and never processed again. Events are processed per `subject` in `seq` order: an
// event ahead of the next expected `seq` is parked; after `parkMinutes` (15) the product's
// `replay` callback fetches the gap from the producer (`GET /v1/events?after=…`), and a gap still
// open after that becomes a reconciliation break, handed to `raiseBreak` (the product publishes
// `ReconciliationBreakRaised` through its outbox in the same transaction). The tables are the
// module's own (`tenancy.create_ecosystem_inbox('<schema>')`); every write is ledgered.
import { IpbError } from "@infrabyx/contracts/errors";
import { EcosystemEnvelope } from "@infrabyx/contracts/events";
import type { AuditSink, KernelContext, MutationKernel, Tx } from "@infrabyx/contracts/kernel";

const SCHEMA = /^[a-z][a-z0-9_]*$/;

/** Thrown inside a transaction that found nothing to change, so it rolls back unledgered. */
class NothingToDo extends Error {
  constructor(readonly result: "parked" | "none") {
    super("nothing to do");
  }
}

export type InboxState = "received" | "parked" | "processed" | "skipped" | "failed" | "break";

/** One stored event as the handler sees it. */
export interface InboxEvent {
  source: string;
  eventId: string;
  type: string;
  subject: string;
  seq: number;
  businessKey: string | null;
  envelope: EcosystemEnvelope;
}

export type ReceiveOutcome = "accepted" | "duplicate" | "business_duplicate";

export interface ReconciliationBreak {
  source: string;
  subject: string;
  /** The `seq` the inbox was waiting for. */
  expectedSeq: number;
  /** The parked events' `seq`s, in order. */
  parkedSeqs: number[];
  eventIds: string[];
}

export interface EcosystemInboxOptions {
  kernel: MutationKernel;
  audit: AuditSink;
  /** The consuming module's schema, where `tenancy.create_ecosystem_inbox` made the tables. */
  schema: string;
  /** The inbox's environment; an event from the other one is refused (Spec §3.2, IPB-API-005). */
  environment: "live" | "test";
  /** Minutes a gap stays parked before replay, then a break (Spec §3.5: 15). */
  parkMinutes?: number;
  /** The first `seq` of a subject the inbox has not seen (default 1). */
  firstSeq?: number;
  /** Handler failures before an event is `failed` and needs an operator (default 5). */
  maxAttempts?: number;
  now?: () => Date;
}

interface Row {
  source: string;
  event_id: string;
  type: string;
  subject: string;
  seq: string;
  business_key: string | null;
  envelope: EcosystemEnvelope;
  state: InboxState;
  attempts: number;
  parked_at: Date | null;
}

const toEvent = (r: Row): InboxEvent => ({
  source: r.source,
  eventId: r.event_id,
  type: r.type,
  subject: r.subject,
  seq: Number(r.seq),
  businessKey: r.business_key,
  envelope: r.envelope,
});

export class EcosystemInbox {
  private readonly inbox: string;
  private readonly position: string;
  private readonly parkMs: number;
  private readonly firstSeq: number;
  private readonly maxAttempts: number;

  constructor(private readonly o: EcosystemInboxOptions) {
    if (!SCHEMA.test(o.schema)) throw new Error(`invalid module schema ${o.schema}`);
    this.inbox = `${o.schema}.eco_inbox`;
    this.position = `${o.schema}.eco_position`;
    this.parkMs = (o.parkMinutes ?? 15) * 60_000;
    this.firstSeq = o.firstSeq ?? 1;
    this.maxAttempts = o.maxAttempts ?? 5;
  }

  private now(): Date {
    return this.o.now?.() ?? new Date();
  }

  /**
   * Validates and stores one event before anything processes it (Spec §3.4: acknowledge with 2xx
   * only after this returns). Invalid envelopes throw; an event of the other environment is
   * refused with IPB-API-005.
   */
  async receive(
    ctx: KernelContext,
    raw: unknown,
    opts: { businessKey?: string } = {},
  ): Promise<{ outcome: ReceiveOutcome; eventId: string }> {
    const e = EcosystemEnvelope.parse(raw);
    if ((e.environment ?? "live") !== this.o.environment)
      throw new IpbError("IPB-API-005", {
        detail: `a ${e.environment ?? "live"} event cannot enter a ${this.o.environment} inbox`,
        meta: { reason: "environment" },
      });
    const action = `${this.o.schema}.eco_inbox.receive`;
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const ins = await tx.query(
          `insert into ${this.inbox}
             (tenant_id, source, event_id, type, subject, seq, business_key, envelope)
           values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
           on conflict do nothing returning event_id`,
          [
            tx.ctx.tenantId,
            e.source,
            e.id,
            e.type,
            e.subject,
            e.seq,
            opts.businessKey ?? null,
            JSON.stringify(e),
          ],
        );
        let outcome: ReceiveOutcome = "accepted";
        if (!ins.rowCount) {
          const same = await tx.query(
            `select 1 from ${this.inbox} where tenant_id = $1 and source = $2 and event_id = $3`,
            [tx.ctx.tenantId, e.source, e.id],
          );
          outcome = same.rowCount ? "duplicate" : "business_duplicate";
        }
        await this.o.audit.record(tx, {
          action,
          resourceType: this.inbox,
          resourceId: e.id,
          after: { source: e.source, type: e.type, subject: e.subject, seq: e.seq, outcome },
        });
        return { outcome, eventId: e.id };
      },
      { action },
    );
  }

  /**
   * Processes the tenant's ready events in `seq` order per subject, each in its own transaction
   * with `handle`; parks events ahead of a gap and skips those at or below the position.
   */
  async drain(
    ctx: KernelContext,
    handle: (tx: Tx, event: InboxEvent) => Promise<void>,
    opts: { limit?: number } = {},
  ): Promise<{ processed: number; parked: number; skipped: number; failed: number }> {
    const out = { processed: 0, parked: 0, skipped: 0, failed: 0 };
    const keys = await this.o.kernel.read(
      ctx,
      async (tx) =>
        (
          await tx.query<{ source: string; subject: string }>(
            `select distinct source, subject from ${this.inbox}
              where state in ('received', 'parked') order by source, subject limit $1`,
            [opts.limit ?? 100],
          )
        ).rows,
    );
    for (const k of keys) {
      for (;;) {
        const step = await this.step(ctx, k.source, k.subject, handle);
        if (step === "none") break;
        out[step]++;
        if (step === "parked" || step === "failed") break;
      }
    }
    return out;
  }

  /** One event of one subject: the lowest pending `seq`, handled, skipped or parked. */
  private async step(
    ctx: KernelContext,
    source: string,
    subject: string,
    handle: (tx: Tx, event: InboxEvent) => Promise<void>,
  ): Promise<"processed" | "parked" | "skipped" | "failed" | "none"> {
    const action = `${this.o.schema}.eco_inbox.process`;
    try {
      return await this.o.kernel.mutate(
        ctx,
        async (tx) => {
          const row = (
            await tx.query<Row>(
              `select source, event_id, type, subject, seq, business_key, envelope, state, attempts, parked_at
                 from ${this.inbox}
                where source = $1 and subject = $2 and state in ('received', 'parked')
                order by seq, received_at limit 1 for update skip locked`,
              [source, subject],
            )
          ).rows[0];
          if (!row) throw new NothingToDo("none");
          const last = await this.lastSeq(tx, source, subject);
          const seq = Number(row.seq);
          let result: "processed" | "parked" | "skipped";
          if (seq <= last) result = "skipped";
          else if (seq > last + 1) result = "parked";
          else {
            await handle(tx, toEvent(row));
            await this.setLast(tx, source, subject, seq);
            result = "processed";
          }
          if (result === "parked" && row.state === "parked") throw new NothingToDo("parked");
          await tx.query(
            `update ${this.inbox}
                set state = $4,
                    parked_at = case when $4 = 'parked' then coalesce(parked_at, $5) else parked_at end,
                    processed_at = case when $4 in ('processed', 'skipped') then $5 else processed_at end
              where tenant_id = $1 and source = $2 and event_id = $3`,
            [tx.ctx.tenantId, source, row.event_id, result, this.now()],
          );
          await this.o.audit.record(tx, {
            action,
            resourceType: this.inbox,
            resourceId: row.event_id,
            after: { subject, seq, result, expected: last + 1 },
          });
          return result;
        },
        { action },
      );
    } catch (err) {
      if (err instanceof NothingToDo) return err.result;
      // The handler failed and its transaction rolled back: count the attempt in its own one.
      return this.recordFailure(ctx, source, subject, err);
    }
  }

  private async recordFailure(
    ctx: KernelContext,
    source: string,
    subject: string,
    err: unknown,
  ): Promise<"failed" | "none"> {
    const action = `${this.o.schema}.eco_inbox.fail`;
    const code = String((err as { code?: unknown })?.code ?? "handler_error").slice(0, 80);
    const safe = /^[A-Za-z0-9_.:-]{1,80}$/.test(code) ? code : "handler_error";
    try {
      return await this.o.kernel.mutate(
        ctx,
        async (tx) => {
          const r = (
            await tx.query<{ event_id: string; attempts: number; seq: string }>(
              `update ${this.inbox} set attempts = attempts + 1, last_error = $3,
                    state = case when attempts + 1 >= $4 then 'failed' else state end
              where (tenant_id, source, event_id) = (
                select tenant_id, source, event_id from ${this.inbox}
                 where source = $1 and subject = $2 and state in ('received', 'parked')
                 order by seq, received_at limit 1)
              returning event_id, attempts, seq`,
              [source, subject, safe, this.maxAttempts],
            )
          ).rows[0];
          if (!r) throw new NothingToDo("none");
          await this.o.audit.record(tx, {
            action,
            resourceType: this.inbox,
            resourceId: r.event_id,
            after: { subject, seq: Number(r.seq), attempts: r.attempts, error: safe },
          });
          return "failed" as const;
        },
        { action },
      );
    } catch (e) {
      if (e instanceof NothingToDo) return "none";
      throw e;
    }
  }

  /**
   * Gaps parked longer than `parkMinutes`: asks `replay` for the missing events (which it passes to
   * `receive`), drains again, and turns a gap still open into a break handed to `raiseBreak` in
   * the transaction that marks the parked events `break`.
   */
  async sweep(
    ctx: KernelContext,
    o: {
      handle: (tx: Tx, event: InboxEvent) => Promise<void>;
      replay: (gap: { source: string; subject: string; afterSeq: number }) => Promise<void>;
      raiseBreak: (tx: Tx, b: ReconciliationBreak) => Promise<void>;
    },
  ): Promise<{ replayed: number; breaks: number }> {
    const cutoff = new Date(this.now().getTime() - this.parkMs);
    const stale = await this.o.kernel.read(
      ctx,
      async (tx) =>
        (
          await tx.query<{ source: string; subject: string }>(
            `select distinct source, subject from ${this.inbox}
              where state = 'parked' and parked_at <= $1 order by source, subject`,
            [cutoff],
          )
        ).rows,
    );
    let breaks = 0;
    for (const g of stale) {
      const afterSeq = await this.o.kernel.read(ctx, (tx) => this.lastSeq(tx, g.source, g.subject));
      await o.replay({ source: g.source, subject: g.subject, afterSeq });
      await this.drain(ctx, o.handle);
      if (await this.markBreak(ctx, g.source, g.subject, cutoff, o.raiseBreak)) breaks++;
    }
    return { replayed: stale.length, breaks };
  }

  private async markBreak(
    ctx: KernelContext,
    source: string,
    subject: string,
    cutoff: Date,
    raiseBreak: (tx: Tx, b: ReconciliationBreak) => Promise<void>,
  ): Promise<boolean> {
    const action = `${this.o.schema}.eco_inbox.break`;
    return this.o.kernel
      .mutate(
        ctx,
        async (tx) => {
          const rows = (
            await tx.query<{ event_id: string; seq: string }>(
              `select event_id, seq from ${this.inbox}
              where source = $1 and subject = $2 and state = 'parked' and parked_at <= $3
              order by seq for update`,
              [source, subject, cutoff],
            )
          ).rows;
          if (!rows.length) throw new NothingToDo("none");
          const b: ReconciliationBreak = {
            source,
            subject,
            expectedSeq: (await this.lastSeq(tx, source, subject)) + 1,
            parkedSeqs: rows.map((r) => Number(r.seq)),
            eventIds: rows.map((r) => r.event_id),
          };
          await tx.query(
            `update ${this.inbox} set state = 'break' where tenant_id = $1 and source = $2 and event_id = any($3)`,
            [tx.ctx.tenantId, source, b.eventIds],
          );
          await raiseBreak(tx, b);
          await this.o.audit.record(tx, {
            action,
            resourceType: this.inbox,
            resourceId: `${source}#${subject}`,
            after: b,
          });
          return true;
        },
        { action },
      )
      .catch((e: unknown) => {
        if (e instanceof NothingToDo) return false;
        throw e;
      });
  }

  /**
   * Sets a subject's position after an operator reconciles it from the owner's snapshot (Spec §3.5:
   * `GET /v1/[aggregate]/{id}` with the last `seq`); its `break` and `failed` events are pending
   * again, and those at or below `lastSeq` will be skipped.
   */
  async setPosition(
    ctx: KernelContext,
    source: string,
    subject: string,
    lastSeq: number,
  ): Promise<void> {
    if (!Number.isSafeInteger(lastSeq) || lastSeq < -1) throw new Error("invalid lastSeq");
    const action = `${this.o.schema}.eco_inbox.reposition`;
    await this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const before = await this.lastSeq(tx, source, subject);
        await this.setLast(tx, source, subject, lastSeq);
        const reopened = await tx.query(
          `update ${this.inbox} set state = 'received', parked_at = null, attempts = 0
            where source = $1 and subject = $2 and state in ('break', 'failed', 'parked')`,
          [source, subject],
        );
        await this.o.audit.record(tx, {
          action,
          resourceType: this.position,
          resourceId: `${source}#${subject}`,
          before: { lastSeq: before },
          after: { lastSeq, reopened: reopened.rowCount ?? 0 },
        });
      },
      { action },
    );
  }

  /** The stored events of one subject, for an operator view. */
  async list(
    ctx: KernelContext,
    source: string,
    subject: string,
  ): Promise<(InboxEvent & { state: InboxState; attempts: number })[]> {
    return this.o.kernel.read(ctx, async (tx) =>
      (
        await tx.query<Row>(
          `select source, event_id, type, subject, seq, business_key, envelope, state, attempts, parked_at
             from ${this.inbox} where source = $1 and subject = $2 order by seq, received_at`,
          [source, subject],
        )
      ).rows.map((r) => ({ ...toEvent(r), state: r.state, attempts: r.attempts })),
    );
  }

  private async lastSeq(tx: Tx, source: string, subject: string): Promise<number> {
    const r = await tx.query<{ last_seq: string }>(
      `select last_seq from ${this.position} where source = $1 and subject = $2`,
      [source, subject],
    );
    return r.rows[0] ? Number(r.rows[0].last_seq) : this.firstSeq - 1;
  }

  private async setLast(tx: Tx, source: string, subject: string, seq: number): Promise<void> {
    await tx.query(
      `insert into ${this.position} (tenant_id, source, subject, last_seq, updated_at)
       values ($1, $2, $3, $4, $5)
       on conflict (tenant_id, source, subject) do update set last_seq = excluded.last_seq, updated_at = excluded.updated_at`,
      [tx.ctx.tenantId, source, subject, seq, this.now()],
    );
  }
}
