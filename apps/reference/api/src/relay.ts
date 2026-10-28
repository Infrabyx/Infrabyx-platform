// The outbox relay (IPB-01 §01.4.3.3): the module's transactional outbox is handed to the QUEUE
// after commit. It is the platform's `OutboxRelay` from `@infrabyx/tenancy`, running as the
// SVC_OUTBOX_RELAY service reader (owner answer #74(e), R1-D-01): migration 0002 registers
// `hello.outbox` with `tenancy.register_outbox`, the relay finds the tenants with pending rows in
// one ledgered platform-scope read, then in each tenant's own context enqueues each envelope
// (idempotent on the event id), marks the rows dispatched and writes one ledger entry per batch.
// The relay's database role is granted that outbox and the ledger append, nothing else.
import type { AuditSink, MutationKernel } from "@infrabyx/contracts/kernel";
import type { QueuePort } from "@infrabyx/contracts/ports";
import { OutboxRelay as PlatformOutboxRelay } from "@infrabyx/tenancy";

/** The queue the relay publishes every outbox envelope to (`name` is the event type). */
export const EVENTS_QUEUE = "events";

export interface OutboxRelayOptions {
  kernel: MutationKernel;
  audit: AuditSink;
  queue: QueuePort;
  /** The module schemas whose registered `<schema>.outbox` the relay drains. */
  schemas: readonly string[];
  /** Rows per tenant and schema per pass (default 100). */
  batch?: number;
}

/** The job a consumer receives: the ids as fields and the CloudEvents envelope as JSON text. */
export interface EventJobData {
  event_id: string;
  tenant_id: string;
  type: string;
  envelope: string;
  [k: string]: string;
}

export class OutboxRelay extends PlatformOutboxRelay {
  constructor(o: OutboxRelayOptions) {
    super({
      kernel: o.kernel,
      audit: o.audit,
      schemas: o.schemas,
      ...(o.batch !== undefined ? { batch: o.batch } : {}),
      deliver: async (_schema, e) => {
        const data: EventJobData = {
          event_id: e.id,
          tenant_id: e.tenant_id,
          type: e.type,
          envelope: JSON.stringify(e.envelope),
        };
        await o.queue.enqueue(EVENTS_QUEUE, { name: e.type, data }, { idempotencyKey: e.id });
      },
    });
  }
}
