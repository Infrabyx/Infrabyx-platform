// Transactional outbox and inbox (IPB-01 §01.4.3.3). Events are written to `<schema>.outbox` in
// the caller's transaction; the dispatcher in the product worker delivers them at least once.
import { parseEnvelope } from "@infrabyx/contracts/events";
import type {
  AuditSink,
  KernelContext,
  MutationKernel,
  OutboxEvent,
  OutboxWriter,
  Tx,
} from "@infrabyx/contracts/kernel";
import { serviceReaderContext } from "./context.js";
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
// `select tenancy.register_outbox('<schema>')`, plus the ledger append; the grants are the
// registry. One pass: a platform-scope read of the pending rows per tenant (a ServiceReader read,
// ledgered in every tenant it saw), then, in each such tenant's own context under its RLS, a
// transaction that takes the pending rows, delivers each (idempotent on the event id), marks them
// dispatched and writes one ledger entry for the batch.

/** One outbox row as the relay delivers it. */
export interface RelayedEvent {
  id: string;
  tenant_id: string;
  type: string;
  envelope: Record<string, unknown>;
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
}

export const OUTBOX_RELAY_PRINCIPAL_ID = "svc_outbox_relay";

export class OutboxRelay {
  private readonly principalId: string;
  constructor(private readonly o: OutboxRelayOptions) {
    this.principalId = o.principalId ?? OUTBOX_RELAY_PRINCIPAL_ID;
    for (const s of o.schemas ?? []) schemaName(s);
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

  /** Tenants with pending rows in one schema's outbox (a ledgered cross-tenant read). */
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
      `select tenant_id, count(*)::int as n from ${table} where dispatched_at is null group by tenant_id`,
    );
    return new Map(rows.map((r) => [r.tenant_id, r.n]));
  }

  /** Deliver and mark dispatched one batch of one tenant's outbox; returns the rows dispatched. */
  async drain(tenantId: string, schema: string): Promise<number> {
    const table = `${schemaName(schema)}.outbox`;
    const action = `${schema}.outbox.dispatch`;
    const ctx: KernelContext = {
      tenantId,
      principal: { id: this.principalId, type: "service", roles: ["SVC_OUTBOX_RELAY"] },
    };
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const rows = (
          await tx.query<RelayedEvent>(
            `select id, tenant_id, type, envelope from ${table} where dispatched_at is null
              order by created_at, id limit $1 for update skip locked`,
            [this.o.batch ?? 100],
          )
        ).rows;
        for (const r of rows) await this.o.deliver(schema, r);
        if (rows.length)
          await tx.query(
            `update ${table} set dispatched_at = now(), attempts = attempts + 1 where id = any($1)`,
            [rows.map((r) => r.id)],
          );
        await this.o.audit.record(tx, {
          action,
          resourceType: "outbox",
          resourceId: table,
          after: { dispatched: rows.length },
        });
        return rows.length;
      },
      { action },
    );
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
