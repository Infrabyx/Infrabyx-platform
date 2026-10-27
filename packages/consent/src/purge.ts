// The consent-record purge (OWNER-QUESTIONS #48, PL5-D-05: life of the consent plus 3 years; the
// owner's approval of this deletion). Run `sweep()` daily from one worker. SVC_CONSENT_SWEEP finds
// the tenants with candidate records (ids, tenants and times only; each read ledgered per tenant);
// each tenant's batch is one transaction with one `consent.record.purge` ledger entry listing the
// ids. The rule itself is in PostgreSQL (migrations `consent/0001` and `0002`): a record is deleted
// only 3 years after a later record for the same person and pack replaced it, 3 years after its
// cookie expired, or, for a marketing lead's form consent, 3 years after its end 24 months past the
// last interaction unless the person has an active relationship (#57); never under legal hold. Any
// other delete is refused for every caller. Status rows whose consent records are all gone leave
// 24 months after their last change, unless held (#57).
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

  async sweep(o: { batch?: number } = {}): Promise<{ deleted: number; subjects: number }> {
    const batch = Math.min(o.batch ?? 500, 1000);
    const records = await this.reader.read<{ tenant_id: string }>(
      "consent.record",
      `select tenant_id from consent.record where recorded_at < now() - interval '3 years' group by tenant_id order by tenant_id`,
    );
    const statuses = await this.reader.read<{ tenant_id: string }>(
      "consent.subject_status",
      `select tenant_id from consent.subject_status where updated_at < now() - interval '24 months' group by tenant_id order by tenant_id`,
    );
    let deleted = 0;
    for (const t of records)
      for (;;) {
        const n = await this.purgeBatch(t.tenant_id, batch);
        deleted += n;
        if (n < batch) break;
      }
    let subjects = 0;
    for (const t of [...new Set(statuses.map((x) => x.tenant_id))])
      subjects += await this.purgeSubjects(t, batch);
    return { deleted, subjects };
  }

  /** Status rows with no consent record left, 24 months after their last change (#57). */
  private async purgeSubjects(tenantId: string, size: number): Promise<number> {
    try {
      return await this.o.kernel.mutate(
        purgeContext(tenantId),
        async (tx) => {
          // The restrictive policy decides which rows may go; this only bounds the batch.
          const r = await tx.query(
            `delete from consent.subject_status where ctid in (
               select ctid from consent.subject_status where updated_at < now() - interval '24 months'
                order by updated_at limit $1)`,
            [size],
          );
          if (!r.rowCount) throw NOTHING_DUE;
          await this.o.audit.record(tx, {
            action: "consent.subject.purge",
            resourceType: "consent_subject",
            resourceId: "batch",
            after: {
              rule: "no consent record left; 24 months after the last change",
              count: r.rowCount,
            },
          });
          return r.rowCount;
        },
        { action: "consent.subject.purge" },
      );
    } catch (e) {
      if (e === NOTHING_DUE) return 0;
      throw e;
    }
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
            after: {
              rule: "life of consent + 3 years; form leads end 24 months after the last interaction",
              ids: r.rows.map((x) => x.id).sort(),
            },
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
