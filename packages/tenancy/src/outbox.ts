// Transactional outbox and inbox (IPB-01 §01.4.3.3). Events are written to `<schema>.outbox` in
// the caller's transaction; the dispatcher in the product worker delivers them at least once.
import { parseEnvelope } from "@infrabyx/contracts/events";
import type { OutboxEvent, OutboxWriter, Tx } from "@infrabyx/contracts/kernel";

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
