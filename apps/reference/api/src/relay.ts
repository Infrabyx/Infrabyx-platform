// The outbox relay (IPB-01 §01.4.3.3; PL6 session 4c, PL6-D-10): the module's transactional outbox
// is handed to the QUEUE after commit. The platform has no reader role for a product's own outbox
// tables (OWNER-QUESTIONS #74), so the relay works tenant by tenant: it lists the active tenants in
// a platform-scope read (a service principal with the read-only platform role), then, in each
// tenant's own service context under forced RLS, takes the pending rows, enqueues each envelope
// (idempotent on the event id) and marks them dispatched, with one ledger entry per batch.
import type { AuditSink, KernelContext, MutationKernel } from "@infrabyx/contracts/kernel";
import { PLATFORM_TENANT_ID } from "@infrabyx/contracts/ids";
import type { QueuePort } from "@infrabyx/contracts/ports";

/** The queue the relay publishes every outbox envelope to (`name` is the event type). */
export const EVENTS_QUEUE = "events";
export const RELAY_PRINCIPAL_ID = "svc_reference_relay";

const SCHEMA = /^[a-z][a-z0-9_]*$/;

export interface OutboxRelayOptions {
  kernel: MutationKernel;
  audit: AuditSink;
  queue: QueuePort;
  /** The module schemas whose `<schema>.outbox` the relay drains. */
  schemas: readonly string[];
  /** Rows per tenant and schema per pass (default 100). */
  batch?: number;
}

interface OutboxRow {
  id: string;
  tenant_id: string;
  type: string;
  envelope: Record<string, unknown>;
}

/** The job a consumer receives: the ids as fields and the CloudEvents envelope as JSON text. */
export interface EventJobData {
  event_id: string;
  tenant_id: string;
  type: string;
  envelope: string;
  [k: string]: string;
}

/** A read-only platform context: the tenant list only (IPB-02-11 needs a PLT_* role for the scope). */
const tenantsContext: KernelContext = {
  tenantId: PLATFORM_TENANT_ID,
  scope: "platform",
  principal: { id: RELAY_PRINCIPAL_ID, type: "service", roles: ["PLT_AUDITOR_RO"] },
};

const tenantContext = (tenantId: string): KernelContext => ({
  tenantId,
  principal: { id: RELAY_PRINCIPAL_ID, type: "service", roles: [] },
});

export class OutboxRelay {
  constructor(private readonly o: OutboxRelayOptions) {
    for (const s of o.schemas) if (!SCHEMA.test(s)) throw new Error(`bad outbox schema ${s}`);
  }

  async tenants(): Promise<string[]> {
    return this.o.kernel.read(tenantsContext, async (tx) =>
      (
        await tx.query<{ id: string }>(
          "select id from tenancy.tenant where status = 'active' order by id",
        )
      ).rows.map((r) => r.id),
    );
  }

  /** Drain one tenant's outbox of one schema; returns the rows dispatched. */
  async drain(tenantId: string, schema: string): Promise<number> {
    const ctx = tenantContext(tenantId);
    const pending = await this.o.kernel.read(ctx, async (tx) =>
      Number(
        (
          await tx.query<{ n: string }>(
            `select count(*) as n from ${schema}.outbox where dispatched_at is null`,
          )
        ).rows[0]?.n ?? 0,
      ),
    );
    if (pending === 0) return 0;
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const rows = (
          await tx.query<OutboxRow>(
            `select id, tenant_id, type, envelope from ${schema}.outbox where dispatched_at is null
              order by created_at, id limit $1 for update skip locked`,
            [this.o.batch ?? 100],
          )
        ).rows;
        const done: string[] = [];
        for (const r of rows) {
          const data: EventJobData = {
            event_id: r.id,
            tenant_id: r.tenant_id,
            type: r.type,
            envelope: JSON.stringify(r.envelope),
          };
          await this.o.queue.enqueue(
            EVENTS_QUEUE,
            { name: r.type, data },
            { idempotencyKey: r.id },
          );
          done.push(r.id);
        }
        if (done.length)
          await tx.query(
            `update ${schema}.outbox set dispatched_at = now(), attempts = attempts + 1 where id = any($1)`,
            [done],
          );
        await this.o.audit.record(tx, {
          action: `${schema}.outbox.dispatch`,
          resourceType: "outbox",
          resourceId: `${schema}.outbox`,
          after: { dispatched: done.length },
        });
        return done.length;
      },
      { action: `${schema}.outbox.dispatch` },
    );
  }

  /** One pass over every active tenant and schema; returns the rows dispatched. */
  async once(): Promise<number> {
    let n = 0;
    for (const tenantId of await this.tenants())
      for (const schema of this.o.schemas) n += await this.drain(tenantId, schema);
    return n;
  }
}
