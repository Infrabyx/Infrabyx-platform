// The consent-record purge (OWNER-QUESTIONS #48, PL5-D-05: life of the consent plus 3 years; the
// owner's approval of this deletion). Run `sweep()` daily from one worker. SVC_CONSENT_SWEEP finds
// the tenants with candidate records (ids, tenants and times only; each read ledgered per tenant);
// each tenant's batch is one transaction with one `consent.record.purge` ledger entry listing the
// ids. The rule itself is in PostgreSQL (migration `consent/0001`): a record is deleted only 3 years
// after a later record for the same person and pack replaced it, or 3 years after its cookie
// expired; any other delete is refused for every caller.
import type { AuditSink, KernelContext, MutationKernel } from "@infrabyx/contracts/kernel";
import { ServiceReader } from "@infrabyx/tenancy";

export const CONSENT_PURGE_PRINCIPAL_ID = "svc_consent_sweep";
const NOTHING_DUE = Symbol("nothing due");

const purgeContext = (tenantId: string): KernelContext => ({
  tenantId,
  principal: { id: CONSENT_PURGE_PRINCIPAL_ID, type: "service", roles: ["SVC_CONSENT_RETENTION"] },
});

export class ConsentPurge {
  private readonly reader: ServiceReader;
  constructor(
    private readonly o: {
      kernel: MutationKernel;
      audit: AuditSink;
      onRead?: ConstructorParameters<typeof ServiceReader>[0]["onRead"];
    },
  ) {
    this.reader = new ServiceReader({
      kernel: o.kernel,
      audit: o.audit,
      role: "SVC_CONSENT_SWEEP",
      principalId: CONSENT_PURGE_PRINCIPAL_ID,
      ...(o.onRead ? { onRead: o.onRead } : {}),
    });
  }

  async sweep(o: { batch?: number } = {}): Promise<{ deleted: number }> {
    const batch = Math.min(o.batch ?? 500, 1000);
    const tenants = await this.reader.read<{ tenant_id: string }>(
      "consent.record",
      `select tenant_id from consent.record where recorded_at < now() - interval '3 years' group by tenant_id order by tenant_id`,
    );
    let deleted = 0;
    for (const t of tenants)
      for (;;) {
        const n = await this.purgeBatch(t.tenant_id, batch);
        deleted += n;
        if (n < batch) break;
      }
    return { deleted };
  }

  private async purgeBatch(tenantId: string, size: number): Promise<number> {
    try {
      return await this.o.kernel.mutate(
        purgeContext(tenantId),
        async (tx) => {
          // The restrictive policy decides which rows may go; this only bounds the batch.
          const r = await tx.query<{ id: string }>(
            `delete from consent.record where id in (
               select id from consent.record where recorded_at < now() - interval '3 years'
                order by recorded_at, id limit $1)
             returning id`,
            [size],
          );
          if (!r.rows.length) throw NOTHING_DUE;
          await this.o.audit.record(tx, {
            action: "consent.record.purge",
            resourceType: "consent_record",
            resourceId: "batch",
            after: { rule: "life of consent + 3 years", ids: r.rows.map((x) => x.id).sort() },
          });
          return r.rows.length;
        },
        { action: "consent.record.purge" },
      );
    } catch (e) {
      if (e === NOTHING_DUE) return 0;
      throw e;
    }
  }
}
