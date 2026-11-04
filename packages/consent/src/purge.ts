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
//
// `sweepPurposes()` is #95's purge (OWNER-QUESTIONS #95, the owner's approval of this deletion;
// R1-plan M41; R1-D-72): purpose-consent records and their notice versions are kept 8 years after
// the relationship ends or the consent is withdrawn, then purged; a legal hold stops it. Deletion is
// on the locked list, so the later of the two clocks applies: only once the reported relationship
// end is 8 years past (never while it has not ended), and any withdrawal of the purpose at or after
// the record is also 8 years past. The rule is again PostgreSQL's (`consent/0004`): the 8 years are
// fixed there and no setting shortens them.
// Each tenant's batch is one transaction with one `consent.purpose.purge` entry (counts only, no
// personal data). Retired tenant notices no longer cited go in the same transaction; retired
// platform notices go once no record in any tenant cites them (the foreign key decides), in one
// `consent.purpose_notice.purge` entry in the platform tenant. Re-running it finds nothing more.
import type { AuditSink, KernelContext, MutationKernel, Tx } from "@infrabyx/contracts/kernel";
import { PLATFORM_TENANT_ID } from "@infrabyx/contracts/ids";
import { ServiceReader } from "@infrabyx/tenancy";

export const CONSENT_PURGE_PRINCIPAL_ID = "svc_consent_sweep";
/** OWNER-QUESTIONS #95: the fixed retention of purpose-consent records (enforced by consent/0004). */
export const PURPOSE_CONSENT_RETENTION_YEARS = 8;
const NOTHING_DUE = Symbol("nothing due");
const PURPOSE_PURGE_ACTION = "consent.purpose.purge";
const NOTICE_PURGE_ACTION = "consent.purpose_notice.purge";
const PURPOSE_RULE =
  "8 years after the later of the relationship end and any withdrawal; never while the relationship continues; never held";

export interface PurposeSweepResult {
  /** Purpose-consent records deleted, across tenants. */
  records: number;
  /** Retired tenant notice versions deleted with their last records. */
  tenantNotices: number;
  /** Retired platform notice versions deleted once no tenant's record cites them. */
  platformNotices: number;
}

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

  /**
   * #95's purge of purpose-consent records and their notice versions (R1-D-72). Run it daily from
   * one worker, beside `sweep()`. SVC_CONSENT_SWEEP finds the tenants with a relationship end older
   * than 8 years (status rows' tenants and times only; each read ledgered per tenant): no record is
   * due anywhere else. Each tenant is then purged in batches under its own RLS.
   */
  async sweepPurposes(o: { batch?: number } = {}): Promise<PurposeSweepResult> {
    const batch = Math.max(1, Math.min(o.batch ?? 500, 1000));
    const ended = await this.reader.read<{ tenant_id: string }>(
      "consent.subject_status",
      `select tenant_id from consent.subject_status
        where relationship_ended_at < now() - interval '8 years'
        group by tenant_id order by tenant_id`,
    );
    const out: PurposeSweepResult = { records: 0, tenantNotices: 0, platformNotices: 0 };
    const platformNotices = new Set<string>();
    for (const tenantId of [...new Set(ended.map((t) => t.tenant_id))].sort())
      for (;;) {
        const r = await this.purgePurposeBatch(tenantId, batch, platformNotices);
        out.records += r.records;
        out.tenantNotices += r.notices;
        if (r.records < batch) break;
      }
    if (platformNotices.size)
      out.platformNotices = await this.purgePlatformNotices(platformNotices);
    return out;
  }

  private async purgePurposeBatch(
    tenantId: string,
    size: number,
    platformNotices: Set<string>,
  ): Promise<{ records: number; notices: number }> {
    try {
      return await this.o.kernel.mutate(
        purgeContext(tenantId),
        async (tx) => {
          // The restrictive policy decides which rows may go; the same test here only picks the
          // batch. Oldest first, a grant before a withdrawal recorded at the same instant.
          const r = await tx.query<{ id: string; notice_id: string | null }>(
            `delete from consent.purpose_record where id in (
               select r.id from consent.purpose_record r
                where not exists (
                        select 1 from consent.subject_status h
                         where h.tenant_id = r.tenant_id and h.subject_ref = r.subject_ref and h.legal_hold)
                  and exists (
                        select 1 from consent.subject_status s
                         where s.tenant_id = r.tenant_id and s.subject_ref = r.subject_ref
                           and not s.active_relationship and s.relationship_ended_at is not null
                           and greatest(s.relationship_ended_at, r.recorded_at) < now() - interval '8 years')
                  and not exists (
                        select 1 from consent.purpose_record w
                         where w.tenant_id = r.tenant_id and w.subject_ref = r.subject_ref
                           and w.purpose = r.purpose and w.action = 'withdrawn'
                           and w.recorded_at >= r.recorded_at and w.recorded_at >= now() - interval '8 years')
                order by r.recorded_at, (r.action = 'withdrawn'), r.id limit $1)
             returning id, notice_id`,
            [size],
          );
          if (!r.rows.length) throw NOTHING_DUE;
          const cited = [...new Set(r.rows.map((x) => x.notice_id).filter((x) => x !== null))];
          const notices = cited.length ? await this.purgeTenantNotices(tx, cited) : 0;
          if (cited.length) {
            const p = await tx.query<{ id: string }>(
              "select id from consent.purpose_notice where id = any($1::text[]) and tenant_id = $2",
              [cited, PLATFORM_TENANT_ID],
            );
            for (const x of p.rows) platformNotices.add(x.id);
          }
          await this.o.audit.record(tx, {
            action: PURPOSE_PURGE_ACTION,
            resourceType: "purpose_consent",
            resourceId: "batch",
            after: { rule: PURPOSE_RULE, records: r.rows.length, notices },
          });
          return { records: r.rows.length, notices };
        },
        { action: PURPOSE_PURGE_ACTION },
      );
    } catch (e) {
      if (e === NOTHING_DUE) return { records: 0, notices: 0 };
      throw e;
    }
  }

  /** The tenant's own retired notice versions that no record cites any more. */
  private async purgeTenantNotices(tx: Tx, ids: string[]): Promise<number> {
    const del = (t: Tx) =>
      t.query(
        `delete from consent.purpose_notice
          where id = any($1::text[]) and tenant_id = $2 and state = 'retired'`,
        [ids, t.ctx.tenantId],
      );
    if (!tx.unit) return (await del(tx)).rowCount ?? 0;
    // A notice another tenant still cites stays (the foreign key refuses); the records still go.
    const u = await tx.unit(del);
    if (u.ok) return u.value.rowCount ?? 0;
    if ((u.error as { code?: string }).code === "23503") return 0;
    throw u.error;
  }

  /** Retired platform notice versions once no record in any tenant cites them (#95). */
  private async purgePlatformNotices(ids: Set<string>): Promise<number> {
    try {
      return await this.o.kernel.mutate(
        purgeContext(PLATFORM_TENANT_ID),
        async (tx) => {
          let n = 0;
          for (const id of [...ids].sort()) {
            const del = (t: Tx) =>
              t.query(
                `delete from consent.purpose_notice
                  where id = $1 and tenant_id = $2 and state = 'retired'`,
                [id, PLATFORM_TENANT_ID],
              );
            if (!tx.unit) {
              n += (await del(tx)).rowCount ?? 0;
              continue;
            }
            // The foreign key sees every tenant's records: a notice still cited anywhere stays.
            const u = await tx.unit(del);
            if (u.ok) n += u.value.rowCount ?? 0;
            else if ((u.error as { code?: string }).code !== "23503") throw u.error;
          }
          if (!n) throw NOTHING_DUE;
          await this.o.audit.record(tx, {
            action: NOTICE_PURGE_ACTION,
            resourceType: "purpose_notice",
            resourceId: "batch",
            after: { rule: "retired; no record in any tenant cites it (#95)", notices: n },
          });
          return n;
        },
        { action: NOTICE_PURGE_ACTION },
      );
    } catch (e) {
      if (e === NOTHING_DUE) return 0;
      throw e;
    }
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
