// Transactional outbox and inbox (IPB-01 §01.4.3.3). Events are written to `<schema>.outbox` in
// the caller's transaction; the dispatcher in the product worker delivers them at least once.
import { IpbError } from "@infrabyx/contracts/errors";
import { eventJobName, parseEnvelope } from "@infrabyx/contracts/events";
import {
  BUSINESS_ID_PATTERN,
  type AuditSink,
  type KernelContext,
  type MutationKernel,
  type OutboxEvent,
  type OutboxWriter,
  type Tx,
} from "@infrabyx/contracts/kernel";
import type { QueueJob } from "@infrabyx/contracts/ports";
import { serviceReaderContext } from "./context.js";
import { NotFoundError } from "./errors.js";
import { ServiceReader } from "./service-reader.js";

const SCHEMA = /^[a-z][a-z0-9_]*$/;

function schemaName(s: string): string {
  if (!SCHEMA.test(s)) throw new Error(`invalid module schema ${s}`);
  return s;
}

export class PgOutbox implements OutboxWriter {
  async publish(tx: Tx, schema: string, event: OutboxEvent): Promise<void> {
    const { envelope } = parseEnvelope(event.envelope);
    if (envelope.tenantid !== tx.ctx.tenantId) {
      throw new Error(`event tenant ${envelope.tenantid} differs from the transaction tenant`);
    }
    await tx.query(
      `insert into ${schemaName(schema)}.outbox (id, tenant_id, type, envelope) values ($1, $2, $3, $4::jsonb)`,
      [envelope.id, envelope.tenantid, envelope.type, JSON.stringify(envelope)],
    );
  }
}

export class PgInbox {
  /** Record `eventId` for `consumer`; false when it was already processed (de-duplication). */
  async firstSeen(tx: Tx, schema: string, consumer: string, eventId: string): Promise<boolean> {
    const r = await tx.query(
      `insert into ${schemaName(schema)}.inbox (consumer, event_id, tenant_id) values ($1, $2, $3)
       on conflict (consumer, event_id) do nothing returning event_id`,
      [consumer, eventId, tx.ctx.tenantId],
    );
    return (r.rowCount ?? 0) > 0;
  }
}

// The outbox relay (IPB-01 §01.4.3.3; owner answer #74(e), R1-D-01). It runs as SVC_OUTBOX_RELAY,
// whose database role is granted only the `<schema>.outbox` tables a migration registered with
// `select tenancy.register_outbox('<schema>')`, plus the ledger append and the parking table; the
// grants are the registry. One pass: a platform-scope read of the pending rows per tenant (a
// ServiceReader read, ledgered in every tenant it saw), then, in each such tenant's own context
// under its RLS, a transaction that takes the pending rows, delivers each (idempotent on the event
// id), marks the delivered ones dispatched and writes one ledger entry for the batch.
//
// A row that cannot be delivered no longer stops the pass (Finbyx PR-FBX-53; R1-D-266). Each row's
// delivery is its own unit: a failure is caught, counted on that row (`attempts`) and the pass goes
// on with the next row; the rows delivered before and after it are marked dispatched in the same
// commit. After `maxAttempts` failed attempts (default 5) the row is parked in
// `tenancy.outbox_parked` (tenancy/0027) with a fixed reason label and its attempt count, and a
// `<schema>.outbox.park` ledger entry; a parked row stays undispatched in its outbox and the relay
// skips it until an operator requeues it (`OutboxParking.requeue`, a ledgered tenant mutation),
// which gives it a fresh attempt budget.

/** One outbox row as the relay delivers it. */
export interface RelayedEvent {
  id: string;
  tenant_id: string;
  type: string;
  envelope: Record<string, unknown>;
}

/** The fixed reasons a row is parked with (never an error message, which could carry data). */
export const OUTBOX_PARK_REASONS = [
  "queue_refused",
  "queue_unavailable",
  "delivery_failed",
] as const;
export type OutboxParkReason = (typeof OUTBOX_PARK_REASONS)[number];

/** Failed delivery attempts before a row is parked, unless `maxAttempts` says otherwise. */
export const DEFAULT_OUTBOX_MAX_ATTEMPTS = 5;
/** The table parked rows are recorded in (tenancy/0027). */
export const OUTBOX_PARKED_TABLE = "tenancy.outbox_parked";

/**
 * The reason label of a delivery failure: `queue_refused` for a refusal of the job (`IPB-PORT-003`:
 * a name, payload or event type the queue does not accept, which will not succeed on a retry),
 * `queue_unavailable` for an unreachable queue (`IPB-PORT-002`), `delivery_failed` otherwise.
 */
export function outboxFailureReason(error: unknown): OutboxParkReason {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === "IPB-PORT-003") return "queue_refused";
  if (code === "IPB-PORT-002") return "queue_unavailable";
  return "delivery_failed";
}

/** One failed delivery attempt, reported to `onFailure` after the batch committed. */
export interface OutboxDeliveryFailure {
  schema: string;
  tenantId: string;
  eventId: string;
  type: string;
  /** The row's attempts, this one included. */
  attempts: number;
  reason: OutboxParkReason;
  /** Whether this attempt parked the row. */
  parked: boolean;
  /** The error `deliver` threw (for the operational log; it is never written to the database). */
  error: unknown;
}

/** The queue job of an outbox event: its job name from `eventJobName`, the full type in the data. */
export interface OutboxEventJob extends QueueJob {
  data: { event_id: string; tenant_id: string; type: string; envelope: string };
}

/**
 * The QUEUE job for one relayed event (Finbyx PR-FBX-53; R1-D-266): the name is
 * `eventJobName(event.type)`, which every queue accepts, and the data carries the ids, the full
 * CloudEvents type and the envelope as JSON text. Refused `IPB-PORT-003` when the type has no job
 * name (the relay then parks the row as `queue_refused`).
 */
export function outboxEventJob(event: RelayedEvent): OutboxEventJob {
  return {
    name: eventJobName(event.type),
    data: {
      event_id: event.id,
      tenant_id: event.tenant_id,
      type: event.type,
      envelope: JSON.stringify(event.envelope),
    },
  };
}

export interface OutboxRelayOptions {
  kernel: MutationKernel;
  audit: AuditSink;
  /** Hand one event to the QUEUE (or another transport); must be idempotent on `event.id`. */
  deliver: (schema: string, event: RelayedEvent) => Promise<void>;
  /** The relay's service principal (default `svc_outbox_relay`). */
  principalId?: string;
  /** Limit the pass to these registered schemas (default: every registered outbox). */
  schemas?: readonly string[];
  /** Rows per tenant and schema per pass (default 100). */
  batch?: number;
  /** Failed attempts before a row is parked: 1 to 100 (default 5, `DEFAULT_OUTBOX_MAX_ATTEMPTS`). */
  maxAttempts?: number;
  /** Operational log of each failed attempt, after its batch committed. */
  onFailure?: (failure: OutboxDeliveryFailure) => void;
}

export const OUTBOX_RELAY_PRINCIPAL_ID = "svc_outbox_relay";

// A row's open park, and the attempts it had when it was last requeued (its budget restarts there).
const openPark = (schemaParam: string) =>
  `exists (select 1 from ${OUTBOX_PARKED_TABLE} p
            where p.schema_name = ${schemaParam} and p.event_id = o.id and p.requeued_at is null)`;
const requeuedBase = (schemaParam: string) =>
  `coalesce((select max(p.attempts) from ${OUTBOX_PARKED_TABLE} p
              where p.schema_name = ${schemaParam} and p.event_id = o.id), 0)::int`;

export class OutboxRelay {
  private readonly principalId: string;
  private readonly maxAttempts: number;
  constructor(private readonly o: OutboxRelayOptions) {
    this.principalId = o.principalId ?? OUTBOX_RELAY_PRINCIPAL_ID;
    for (const s of o.schemas ?? []) schemaName(s);
    this.maxAttempts = o.maxAttempts ?? DEFAULT_OUTBOX_MAX_ATTEMPTS;
    if (!Number.isInteger(this.maxAttempts) || this.maxAttempts < 1 || this.maxAttempts > 100)
      throw new RangeError("maxAttempts is an integer from 1 to 100");
  }

  /** The schemas whose outbox is registered for the relay (read from the database grants: the
   * column update grant `tenancy.register_outbox()` makes). */
  async registered(): Promise<string[]> {
    const ctx = serviceReaderContext("SVC_OUTBOX_RELAY", this.principalId);
    const rows = await this.o.kernel.read(
      ctx,
      async (tx) =>
        (
          await tx.query<{ schema: string }>(
            `select n.nspname as schema from pg_class c join pg_namespace n on n.oid = c.relnamespace
              where c.relname = 'outbox' and c.relkind in ('r', 'p')
                and case when exists (select 1 from pg_attribute a where a.attrelid = c.oid
                                         and a.attname = 'dispatched_at' and not a.attisdropped)
                         then has_column_privilege(current_user, c.oid, 'dispatched_at', 'UPDATE')
                         else false end
              order by n.nspname`,
          )
        ).rows,
    );
    const all = rows.map((r) => r.schema).filter((s) => SCHEMA.test(s));
    return this.o.schemas ? all.filter((s) => this.o.schemas!.includes(s)) : all;
  }

  /** Tenants with pending, unparked rows in one schema's outbox (a ledgered cross-tenant read). */
  async pending(schema: string): Promise<Map<string, number>> {
    const table = `${schemaName(schema)}.outbox`;
    const reader = new ServiceReader({
      kernel: this.o.kernel,
      audit: this.o.audit,
      role: "SVC_OUTBOX_RELAY",
      principalId: this.principalId,
      tables: [table],
    });
    const rows = await reader.read<{ tenant_id: string; n: number }>(
      table,
      `select o.tenant_id, count(*)::int as n from ${table} o
        where o.dispatched_at is null and not ${openPark("$1")} group by o.tenant_id`,
      [schema],
    );
    return new Map(rows.map((r) => [r.tenant_id, r.n]));
  }

  /**
   * Deliver one batch of one tenant's outbox: each delivered row is marked dispatched, each failed
   * row has its attempt counted and, at `maxAttempts`, is parked; returns the rows dispatched.
   */
  async drain(tenantId: string, schema: string): Promise<number> {
    const table = `${schemaName(schema)}.outbox`;
    const action = `${schema}.outbox.dispatch`;
    const ctx: KernelContext = {
      tenantId,
      principal: { id: this.principalId, type: "service", roles: ["SVC_OUTBOX_RELAY"] },
    };
    const failures: OutboxDeliveryFailure[] = [];
    const n = await this.o.kernel.mutate(
      ctx,
      async (tx) => {
        failures.length = 0;
        const rows = (
          await tx.query<RelayedEvent & { attempts: number; base: number }>(
            `select o.id, o.tenant_id, o.type, o.envelope, o.attempts, ${requeuedBase("$2")} as base
               from ${table} o
              where o.dispatched_at is null and not ${openPark("$2")}
              order by o.created_at, o.id limit $1 for update of o skip locked`,
            [this.o.batch ?? 100, schema],
          )
        ).rows;
        const delivered: string[] = [];
        for (const { attempts, base, ...event } of rows) {
          // Each row is its own unit: a failure is recorded on that row and the pass goes on.
          try {
            await this.o.deliver(schema, event);
            delivered.push(event.id);
          } catch (error) {
            const tries = attempts + 1;
            failures.push({
              schema,
              tenantId,
              eventId: event.id,
              type: event.type,
              attempts: tries,
              reason: outboxFailureReason(error),
              parked: tries - base >= this.maxAttempts,
              error,
            });
          }
        }
        if (delivered.length)
          await tx.query(
            `update ${table} set dispatched_at = now(), attempts = attempts + 1 where id = any($1)`,
            [delivered],
          );
        if (failures.length)
          await tx.query(`update ${table} set attempts = attempts + 1 where id = any($1)`, [
            failures.map((f) => f.eventId),
          ]);
        const parked = failures.filter((f) => f.parked);
        for (const f of parked) {
          await tx.query(
            `insert into ${OUTBOX_PARKED_TABLE} (tenant_id, schema_name, event_id, event_type, reason, attempts)
             values ($1, $2, $3, $4, $5, $6)`,
            [tenantId, schema, f.eventId, f.type, f.reason, f.attempts],
          );
          await this.o.audit.record(tx, {
            action: `${schema}.outbox.park`,
            resourceType: "outbox",
            resourceId: table,
            after: { event_id: f.eventId, type: f.type, reason: f.reason, attempts: f.attempts },
            ...(BUSINESS_ID_PATTERN.test(f.eventId) ? { businessIds: [f.eventId] } : {}),
          });
        }
        await this.o.audit.record(tx, {
          action,
          resourceType: "outbox",
          resourceId: table,
          after: {
            dispatched: delivered.length,
            ...(failures.length ? { failed: failures.length, parked: parked.length } : {}),
          },
        });
        return delivered.length;
      },
      { action },
    );
    for (const f of failures) this.o.onFailure?.(f);
    return n;
  }

  /** One pass over every registered outbox; returns the rows dispatched. */
  async once(): Promise<number> {
    let n = 0;
    for (const schema of await this.registered())
      for (const tenantId of (await this.pending(schema)).keys())
        n += await this.drain(tenantId, schema);
    return n;
  }
}

/** One park of an outbox row (`tenancy.outbox_parked`). */
export interface ParkedOutboxRow {
  tenantId: string;
  schema: string;
  eventId: string;
  type: string;
  reason: string;
  attempts: number;
  parkedAt: string;
  requeuedAt: string | null;
  requeuedBy: string | null;
}

/** The ledger action of an operator's requeue of a parked row. */
export const OUTBOX_REQUEUE_ACTION = "tenancy.outbox.requeue";
/** Who may requeue a parked row, unless `requeueRoles` says otherwise. */
export const DEFAULT_OUTBOX_REQUEUE_ROLES: readonly string[] = Object.freeze([
  "ORG_OWNER",
  "ORG_ADMIN",
]);

export interface OutboxParkingOptions {
  kernel: MutationKernel;
  audit: AuditSink;
  /** Roles that may requeue (default `ORG_OWNER`, `ORG_ADMIN`); a product adds its operations role. */
  requeueRoles?: readonly string[];
}

interface ParkedRecord {
  tenant_id: string;
  schema_name: string;
  event_id: string;
  event_type: string;
  reason: string;
  attempts: number;
  parked_at: Date;
  requeued_at: Date | null;
  requeued_by: string | null;
}

const parkedRow = (r: ParkedRecord): ParkedOutboxRow => ({
  tenantId: r.tenant_id,
  schema: r.schema_name,
  eventId: r.event_id,
  type: r.event_type,
  reason: r.reason,
  attempts: r.attempts,
  parkedAt: new Date(r.parked_at).toISOString(),
  requeuedAt: r.requeued_at ? new Date(r.requeued_at).toISOString() : null,
  requeuedBy: r.requeued_by,
});

const PARKED_COLUMNS =
  "tenant_id, schema_name, event_id, event_type, reason, attempts, parked_at, requeued_at, requeued_by";

/**
 * Parked outbox rows of the caller's tenant (Finbyx PR-FBX-53; R1-D-266): the list an operator
 * reads, and the requeue that hands a parked row back to the relay. Both run in the caller's own
 * tenant context under RLS; a requeue is a ledgered mutation by the operator.
 */
export class OutboxParking {
  private readonly roles: readonly string[];
  constructor(private readonly o: OutboxParkingOptions) {
    this.roles = o.requeueRoles ?? DEFAULT_OUTBOX_REQUEUE_ROLES;
  }

  /** The tenant's parks, newest first: open ones only unless `includeRequeued`. */
  async list(
    ctx: KernelContext,
    opts: { schema?: string; includeRequeued?: boolean; limit?: number } = {},
  ): Promise<ParkedOutboxRow[]> {
    if (opts.schema !== undefined) schemaName(opts.schema);
    const limit = opts.limit ?? 100;
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000)
      throw new RangeError("limit is an integer from 1 to 1000");
    const rows = await this.o.kernel.read(
      ctx,
      async (tx) =>
        (
          await tx.query<ParkedRecord>(
            `select ${PARKED_COLUMNS} from ${OUTBOX_PARKED_TABLE}
              where ($1::text is null or schema_name = $1) and ($2 or requeued_at is null)
              order by parked_at desc, event_id limit $3`,
            [opts.schema ?? null, opts.includeRequeued ?? false, limit],
          )
        ).rows,
    );
    return rows.map(parkedRow);
  }

  /**
   * Requeue one parked row: its open park is closed (`requeued_at`, `requeued_by`), so the relay
   * takes the row again on its next pass with a fresh attempt budget. Only a named person holding
   * one of `requeueRoles` may; the ledger entry records the park it closed. A row with no open park
   * answers 404.
   */
  async requeue(ctx: KernelContext, schema: string, eventId: string): Promise<ParkedOutboxRow> {
    schemaName(schema);
    if (ctx.principal.type !== "user" || !ctx.principal.roles.some((r) => this.roles.includes(r)))
      throw new IpbError("IPB-SEC-005", {
        detail: `a parked outbox row is requeued by a person holding ${this.roles.join(" or ")}`,
      });
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const r = (
          await tx.query<ParkedRecord>(
            `update ${OUTBOX_PARKED_TABLE} set requeued_at = now(), requeued_by = $3
              where schema_name = $1 and event_id = $2 and requeued_at is null
              returning ${PARKED_COLUMNS}`,
            [schema, eventId, ctx.principal.id],
          )
        ).rows[0];
        if (!r) throw new NotFoundError("parked outbox row");
        await this.o.audit.record(tx, {
          action: OUTBOX_REQUEUE_ACTION,
          resourceType: "outbox",
          resourceId: `${schema}.outbox`,
          before: { event_id: r.event_id, reason: r.reason, attempts: r.attempts },
          after: { event_id: r.event_id, requeued: true },
          ...(BUSINESS_ID_PATTERN.test(r.event_id) ? { businessIds: [r.event_id] } : {}),
        });
        return parkedRow(r);
      },
      { action: OUTBOX_REQUEUE_ACTION },
    );
  }
}
