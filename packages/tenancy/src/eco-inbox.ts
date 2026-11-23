// The Ecosystem inbox (Ecosystem Spec §3.4, §3.5; R1 plan M10, G2). A consumer stores each event
// by `(source, id)` and its business key before processing it; duplicates of either are
// acknowledged and never processed again. Events are processed per `subject` in `seq` order: an
// event ahead of the next expected `seq` is parked; after `parkMinutes` (15) the product's
// `replay` callback fetches the gap from the producer (`GET /v1/events?after=…`), and a gap still
// open after that becomes a reconciliation break, handed to `raiseBreak` (the product publishes
// `ReconciliationBreakRaised` through its outbox in the same transaction). The tables are the
// module's own (`tenancy.create_ecosystem_inbox('<schema>')`); every write is ledgered.
//
// R1-D-257 (Udofin PR-UDF-073): a regulated message's detached JWS (Spec §3.6, `X-Infrabyx-JWS`)
// is verified by `receive` (C-22 profile, the `regulated` option's key ring and replay store) and
// kept beside the event in the nullable `jws` column (tenancy 0026), written once and never
// updated (a database trigger refuses a change); the handler gets it as `InboxEvent.jws`.
//
// R1-D-280 (Udofin PR-UDF-084): a product may narrow the column to named roles of the row's own
// tenant (`tenancy.restrict_ecosystem_inbox_jws`, tenancy 0028); app_rw and app_ro then select
// every column but `jws`. This class reads `jws` only through `tenancy.eco_inbox_jws(...)`, which
// returns it to a transaction holding a reader role (`app.roles`, set by the kernel) and refuses
// (42501) anyone else, so it works the same on a restricted inbox and on one that is not. The
// connector service that runs `receive` and `drain` must hold one of the inbox's reader roles.
import { IpbError } from "@infrabyx/contracts/errors";
import {
  EcosystemEnvelope,
  REGULATED_JWS_HEADER,
  regulatedJwsFromHeaders,
} from "@infrabyx/contracts/events";
import type { AuditSink, KernelContext, MutationKernel, Tx } from "@infrabyx/contracts/kernel";
import { verifyRegulatedMessage, type RegulatedKeyRing, type ReplayStore } from "@infrabyx/crypto";

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
  /**
   * R1-D-257: the detached JWS `receive` verified and stored beside the event (Spec §3.6), to
   * re-verify the proof later against `envelope`; `null` for an event received unsigned. Always
   * set on events from `drain` and `sweep`, and from `list` for a caller that may read it; absent
   * from `list` when the inbox's JWS is restricted to roles the caller does not hold (R1-D-280).
   * Optional in the type so a hand-built `InboxEvent` (a product's test fixture) stays valid.
   */
  jws?: string | null;
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
  /**
   * R1-D-257: verifies the detached JWS `receive({ jws })` is given (Spec §3.6; C-22: ES256, `kid`,
   * the `iat` window, `jti` replay), with the producer's pinned keys and a durable replay store.
   * Without it, `receive` refuses a `jws` rather than store one it did not verify.
   */
  regulated?: {
    keys: RegulatedKeyRing;
    replay: ReplayStore;
    maxAgeSeconds?: number;
    maxSkewSeconds?: number;
  };
  now?: () => Date;
}

/** What `receive` answers. */
export interface ReceiveResult {
  outcome: ReceiveOutcome;
  eventId: string;
  /**
   * R1-D-257: the JWS stored with the event: the one just verified when `accepted`, the one kept
   * at the first receipt for a `duplicate` (null if that receipt was unsigned), null for a
   * `business_duplicate` (stored nowhere).
   */
  jws: string | null;
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
  /** Absent when the row was read without its JWS (R1-D-280). */
  jws?: string | null;
}

/** The inbox columns every reader may select (all but `jws`, R1-D-280). */
const ROW_COLUMNS =
  "source, event_id, type, subject, seq, business_key, envelope, state, attempts, parked_at";

const toEvent = (r: Row): InboxEvent => ({
  source: r.source,
  eventId: r.event_id,
  type: r.type,
  subject: r.subject,
  seq: Number(r.seq),
  businessKey: r.business_key,
  envelope: r.envelope,
  ...(r.jws !== undefined ? { jws: r.jws } : {}),
});

/**
 * Refusal of `jwsOf` to a caller holding none of the inbox's reader roles (R1-D-280): the code of
 * the platform's other role refusals (403), with no role names and nothing about the event.
 */
export const INBOX_JWS_REFUSED = "IPB-UX-011";

export class EcosystemInbox {
  private readonly inbox: string;
  private readonly position: string;
  /** `tenancy.eco_inbox_jws` over the row's own source and event id (R1-D-280). */
  private readonly jwsColumn: string;
  private readonly parkMs: number;
  private readonly firstSeq: number;
  private readonly maxAttempts: number;

  constructor(private readonly o: EcosystemInboxOptions) {
    if (!SCHEMA.test(o.schema)) throw new Error(`invalid module schema ${o.schema}`);
    this.inbox = `${o.schema}.eco_inbox`;
    this.position = `${o.schema}.eco_position`;
    // The schema is checked against SCHEMA above, so it is a safe literal.
    this.jwsColumn = `tenancy.eco_inbox_jws('${o.schema}', source, event_id)`;
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
   *
   * `exclusiveWith` (R1-D-70): event types that share the business key with this one, where only
   * the first stored of any of them is processed (Ecosystem Spec v1.3 §6.29: one provisioning
   * request ends in exactly one of `TenantProvisioned` or `ProvisioningFailed`). A later event of
   * another listed type is a `business_duplicate`, stored nowhere and ledgered as received.
   *
   * `jws` (R1-D-257): the event's detached JWS (the `X-Infrabyx-JWS` value, Spec §3.6). It must be
   * one compact detached JWS of at most 1,024 octets and verify with the `regulated` option, or the
   * event is refused with IPB-API-018 (`signature-invalid`) before anything is stored; it is then
   * kept beside the event and given to the handler. A redelivery of a stored event verifies with
   * its own fresh JWS and answers `duplicate` with the JWS stored first; a redelivery of the very
   * same JWS (its `jti` already claimed) is a `duplicate` too. The product still refuses an
   * unsigned regulated message itself (`isRegulatedMessage`); one passed without `jws` is stored
   * with none.
   */
  async receive(
    ctx: KernelContext,
    raw: unknown,
    opts: { businessKey?: string; exclusiveWith?: readonly string[]; jws?: string } = {},
  ): Promise<ReceiveResult> {
    const e = EcosystemEnvelope.parse(raw);
    if ((e.environment ?? "live") !== this.o.environment)
      throw new IpbError("IPB-API-005", {
        detail: `a ${e.environment ?? "live"} event cannot enter a ${this.o.environment} inbox`,
        meta: { reason: "environment" },
      });
    const action = `${this.o.schema}.eco_inbox.receive`;
    const others = (opts.exclusiveWith ?? []).filter((t) => t !== e.type);
    if (others.length && !opts.businessKey) throw new Error("exclusiveWith needs a businessKey");
    const jws = opts.jws === undefined ? null : await this.verified(ctx, e, opts.jws);
    const signed = jws ? { signed: true, kid: jws.kid } : {};
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        if (others.length) {
          // Serialise receivers of one business key, so two types cannot both be stored.
          await tx.query("select pg_advisory_xact_lock(hashtext($1), hashtext($2))", [
            `${this.inbox}:${tx.ctx.tenantId}`,
            opts.businessKey,
          ]);
          const taken = await tx.query(
            `select 1 from ${this.inbox} where tenant_id = $1 and business_key = $2 and type = any($3)`,
            [tx.ctx.tenantId, opts.businessKey, others],
          );
          if (taken.rowCount) {
            await this.o.audit.record(tx, {
              action,
              resourceType: this.inbox,
              resourceId: e.id,
              after: {
                source: e.source,
                type: e.type,
                subject: e.subject,
                seq: e.seq,
                outcome: "business_duplicate",
                exclusive: true,
                ...signed,
              },
            });
            return { outcome: "business_duplicate" as const, eventId: e.id, jws: null };
          }
        }
        const ins = await tx.query(
          `insert into ${this.inbox}
             (tenant_id, source, event_id, type, subject, seq, business_key, envelope, jws)
           values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
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
            jws?.jws ?? null,
          ],
        );
        let outcome: ReceiveOutcome = "accepted";
        let stored = jws?.jws ?? null;
        if (!ins.rowCount) {
          const same = await tx.query<{ jws: string | null }>(
            `select ${this.jwsColumn} as jws from ${this.inbox}
              where tenant_id = $1 and source = $2 and event_id = $3`,
            [tx.ctx.tenantId, e.source, e.id],
          );
          outcome = same.rowCount ? "duplicate" : "business_duplicate";
          stored = same.rows[0]?.jws ?? null;
        }
        await this.o.audit.record(tx, {
          action,
          resourceType: this.inbox,
          resourceId: e.id,
          after: {
            source: e.source,
            type: e.type,
            subject: e.subject,
            seq: e.seq,
            outcome,
            ...signed,
          },
        });
        return { outcome, eventId: e.id, jws: stored };
      },
      { action },
    );
  }

  /**
   * R1-D-257: checks and verifies `jws` for `e` before anything is stored, or refuses the event
   * with IPB-API-018. A `replay` failure (the `jti` was claimed after the signature and `iat`
   * verified) is a redelivery when the tenant's inbox holds this event with this very JWS.
   */
  private async verified(
    ctx: KernelContext,
    e: EcosystemEnvelope,
    jws: string,
  ): Promise<{ jws: string; kid: string }> {
    const refuse = (reason: string, detail: string) =>
      new IpbError("IPB-API-018", { detail, meta: { reason: "signature-invalid", jws: reason } });
    if (!this.o.regulated) throw new Error("receive({ jws }) needs the `regulated` option");
    if (typeof jws !== "string") throw refuse("malformed", "the JWS is not a string");
    // The envelope's own limits (Spec v1.4 §3.6): one compact detached JWS, at most 1,024 octets.
    const h = regulatedJwsFromHeaders({ [REGULATED_JWS_HEADER]: jws });
    if (!h.ok) throw refuse(h.reason, `the JWS is ${h.reason.replace("_", " ")}`);
    const r = this.o.regulated;
    const v = await verifyRegulatedMessage(e as Record<string, unknown>, jws, {
      keys: r.keys,
      replay: r.replay,
      now: this.now(),
      ...(r.maxAgeSeconds !== undefined ? { maxAgeSeconds: r.maxAgeSeconds } : {}),
      ...(r.maxSkewSeconds !== undefined ? { maxSkewSeconds: r.maxSkewSeconds } : {}),
    });
    if (v.ok) return { jws, kid: v.kid };
    if (v.reason === "replay") {
      const stored = await this.o.kernel.read(
        ctx,
        async (tx) =>
          (
            await tx.query<{ jws: string | null }>(
              `select ${this.jwsColumn} as jws from ${this.inbox} where source = $1 and event_id = $2`,
              [e.source, e.id],
            )
          ).rows[0]?.jws ?? null,
      );
      if (stored === jws) {
        const header = JSON.parse(
          Buffer.from(jws.slice(0, jws.indexOf(".")), "base64url").toString("utf8"),
        ) as { kid: string };
        return { jws, kid: header.kid };
      }
    }
    throw refuse(v.reason, `the event's JWS did not verify (${v.reason})`);
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
              `select ${ROW_COLUMNS}
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
            // The JWS only for the event handed over (R1-D-280): 42501 to a non-reader.
            const jws = await this.jwsIn(tx, row.source, row.event_id);
            await handle(tx, toEvent({ ...row, jws }));
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

  /**
   * The stored events of one subject, for an operator view. Each event carries `jws` when the
   * caller may read the inbox's JWS, and none when it is restricted to roles the caller does not
   * hold (R1-D-280).
   */
  async list(
    ctx: KernelContext,
    source: string,
    subject: string,
  ): Promise<(InboxEvent & { state: InboxState; attempts: number })[]> {
    return this.o.kernel.read(ctx, async (tx) => {
      const jws = (await this.readable(tx)) ? `, ${this.jwsColumn} as jws` : "";
      return (
        await tx.query<Row>(
          `select ${ROW_COLUMNS}${jws}
             from ${this.inbox} where source = $1 and subject = $2 order by seq, received_at`,
          [source, subject],
        )
      ).rows.map((r) => ({ ...toEvent(r), state: r.state, attempts: r.attempts }));
    });
  }

  /**
   * R1-D-280: the JWS stored with one event of the caller's tenant, for a principal holding one of
   * the inbox's reader roles (any principal while the inbox is not restricted); `null` for an event
   * received unsigned or not in this tenant's inbox. A caller holding none of them is refused with
   * `IPB-UX-011` (403) before the event is looked up. A read, so nothing is ledgered.
   */
  async jwsOf(ctx: KernelContext, source: string, eventId: string): Promise<string | null> {
    if (typeof source !== "string" || typeof eventId !== "string")
      throw new TypeError("source and eventId are strings");
    return this.o.kernel.read(ctx, async (tx) => {
      if (!(await this.readable(tx)))
        throw new IpbError(INBOX_JWS_REFUSED, {
          detail: "the JWS of this inbox is read by its reader roles only",
          meta: { reason: "jws_reader" },
        });
      return this.jwsIn(tx, source, eventId);
    });
  }

  /** Whether the transaction's roles may read this inbox's JWS (tenancy 0028). */
  private async readable(tx: Tx): Promise<boolean> {
    const r = await tx.query<{ ok: boolean }>("select tenancy.eco_inbox_jws_readable($1) as ok", [
      this.o.schema,
    ]);
    return r.rows[0]?.ok === true;
  }

  /** One event's JWS through `tenancy.eco_inbox_jws` (42501 to a non-reader). */
  private async jwsIn(tx: Tx, source: string, eventId: string): Promise<string | null> {
    const r = await tx.query<{ jws: string | null }>(
      "select tenancy.eco_inbox_jws($1, $2, $3) as jws",
      [this.o.schema, source, eventId],
    );
    return r.rows[0]?.jws ?? null;
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
