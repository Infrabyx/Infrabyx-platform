// Inbound webhooks (IPB-10-27, plan §3.8): the adapter verifies the vendor signature, the event is
// recorded in the module inbox by vendor event id (duplicates are acknowledged, not processed
// again; @IPB-02-AT-05 scenario 2), and the caller queues the work. Unverified payloads answer
// 401 and are logged without the body.
import { isIpbError } from "@infrabyx/contracts/errors";
import type { AuditSink, KernelContext, MutationKernel, Tx } from "@infrabyx/contracts/kernel";

export interface VerifiedWebhookEvent {
  vendorEventId: string;
}

export interface AcceptWebhookOptions<E extends VerifiedWebhookEvent> {
  /** Adapter verification; throws when the signature or timestamp does not verify. */
  verify: () => Promise<E[]>;
  kernel: MutationKernel;
  audit: AuditSink;
  ctx: KernelContext;
  /** Module schema that owns the inbox table, and the consumer name recorded with each event. */
  schema: string;
  consumer: string;
  firstSeen: (tx: Tx, schema: string, consumer: string, eventId: string) => Promise<boolean>;
  /** Queue the event for asynchronous processing, in the same transaction (outbox or QUEUE port). */
  enqueue: (tx: Tx, event: E) => Promise<void>;
  /** Log line for a refused payload; never receives the body. */
  onRefused?: (reason: string) => void;
}

export interface AcceptWebhookResult {
  status: 200 | 401;
  accepted: number;
  duplicates: number;
}

export async function acceptWebhook<E extends VerifiedWebhookEvent>(
  o: AcceptWebhookOptions<E>,
): Promise<AcceptWebhookResult> {
  let events: E[];
  try {
    events = await o.verify();
  } catch (e) {
    o.onRefused?.(isIpbError(e) ? e.code : "signature verification failed");
    return { status: 401, accepted: 0, duplicates: 0 };
  }
  return o.kernel.mutate(
    o.ctx,
    async (tx) => {
      let accepted = 0;
      let duplicates = 0;
      for (const ev of events) {
        if (await o.firstSeen(tx, o.schema, o.consumer, ev.vendorEventId)) {
          await o.enqueue(tx, ev);
          accepted++;
        } else duplicates++;
      }
      await o.audit.record(tx, {
        action: "connectors.webhook.received",
        resourceType: `${o.schema}.inbox`,
        resourceId: o.consumer,
        after: { accepted, duplicates },
      });
      return { status: 200 as const, accepted, duplicates };
    },
    { action: "connectors.webhook.received" },
  );
}
