// The trust sweep (IPB-08-17, 08-37; OWNER-QUESTIONS #48; PL5 plan §7.2). SVC_TRUST_SWEEP reads ids,
// tenants, versions, states and timers only; each read is ledgered per tenant.
//   tick    requests past their acknowledgement or fulfilment SLA are marked once per timer and
//           ledgered as `IPB-TRUST-014` (for the OH controls dashboard); requests not yet handed to
//           OH are retried (at most 10 times).
//   purge   acknowledgements of a document version that ended (superseded, expired or withdrawn)
//           more than 10 years ago are deleted, one ledgered batch per tenant; never under legal
//           hold. `trust.retention.years` can lengthen the period, never shorten it below 10.
//   legalHold  a PLT_LEGAL_REVIEWER places or lifts a hold on a tenant's acknowledgements of a
//           document; the purge skips held rows (IPB-08 §08.4.9).
import { IpbError } from "@infrabyx/contracts/errors";
import { PLATFORM_TENANT_ID } from "@infrabyx/contracts/ids";
import type { AuditSink, KernelContext, MutationKernel } from "@infrabyx/contracts/kernel";
import { ServiceReader } from "@infrabyx/tenancy";
import type { TrustRoom } from "./room.js";

export const TRUST_SWEEP_PRINCIPAL_ID = "svc_trust_sweep";
export const ACK_RETENTION_YEARS = 10;
export const MAX_REQUEST_SYNC_ATTEMPTS = 10;
const NOTHING_DUE = Symbol("nothing due");

const tenantContext = (tenantId: string, id = TRUST_SWEEP_PRINCIPAL_ID): KernelContext => ({
  tenantId,
  principal: { id, type: "service", roles: [] },
});

export class TrustSweep {
  private readonly reader: ServiceReader;
  constructor(
    private readonly o: {
      kernel: MutationKernel;
      audit: AuditSink;
      room: TrustRoom;
      /** `trust.retention.years` (default and floor 10, per #48). */
      retentionYears?: number;
      now?: () => Date;
      onRead?: ConstructorParameters<typeof ServiceReader>[0]["onRead"];
    },
  ) {
    this.reader = new ServiceReader({
      kernel: o.kernel,
      audit: o.audit,
      role: "SVC_TRUST_SWEEP",
      principalId: TRUST_SWEEP_PRINCIPAL_ID,
      ...(o.onRead ? { onRead: o.onRead } : {}),
    });
  }

  private now(): Date {
    return this.o.now?.() ?? new Date();
  }

  async tick(): Promise<{ breaches: number; synced: number }> {
    const now = this.now();
    const due = await this.reader.read<{
      id: string;
      tenant_id: string;
      state: string;
      sla_ack_due: Date;
      sla_fulfil_due: Date;
      sla_breaches: string[];
    }>(
      "trust.request",
      `select id, tenant_id, state, sla_ack_due, sla_fulfil_due, sla_breaches from trust.request
        where state not in ('fulfilled', 'declined') and least(sla_ack_due, sla_fulfil_due) < $1
        order by created_at limit 500`,
      [now],
    );
    let breaches = 0;
    for (const r of due) {
      const timers = [
        ...(r.state === "open" && r.sla_ack_due < now ? ["ack"] : []),
        ...(r.sla_fulfil_due < now ? ["fulfil"] : []),
      ].filter((t) => !r.sla_breaches.includes(t));
      if (!timers.length) continue;
      await this.o.kernel.mutate(
        tenantContext(r.tenant_id),
        async (tx) => {
          await tx.query(
            "update trust.request set sla_breaches = sla_breaches || $2::text[] where id = $1",
            [r.id, timers],
          );
          await this.o.audit.record(tx, {
            action: "trust.request.sla_breached",
            resourceType: "vad_request",
            resourceId: r.id,
            after: { code: "IPB-TRUST-014", timers },
          });
        },
        { action: "trust.request.sla_breached" },
      );
      breaches += timers.length;
    }
    const pending = await this.reader.read<{ id: string; tenant_id: string }>(
      "trust.request",
      `select id, tenant_id from trust.request
        where ticket_ref is null and state = 'open' and sync_attempts < $1 and created_at < $2
        order by created_at limit 200`,
      [MAX_REQUEST_SYNC_ATTEMPTS, new Date(now.getTime() - 60_000)],
    );
    let synced = 0;
    for (const p of pending)
      if (await this.o.room.syncRequest(p.tenant_id, p.id).catch(() => null)) synced++;
    return { breaches, synced };
  }

  /** Acknowledgements 10 years (or `retentionYears`) after their version ended (#48). */
  async purge(o: { batch?: number } = {}): Promise<{ deleted: number }> {
    const years = Math.max(ACK_RETENTION_YEARS, this.o.retentionYears ?? ACK_RETENTION_YEARS);
    const batch = Math.min(o.batch ?? 500, 1000);
    const tenants = await this.reader.read<{ tenant_id: string }>(
      "trust.acknowledgement",
      `select a.tenant_id from trust.acknowledgement a
         join trust.mirror_document d on d.vad_id = a.vad_id and d.version = a.version
        where not a.legal_hold and d.ended_at < now() - make_interval(years => $1)
        group by a.tenant_id order by a.tenant_id`,
      [years],
    );
    let deleted = 0;
    for (const t of tenants)
      for (;;) {
        const n = await this.purgeBatch(t.tenant_id, years, batch);
        deleted += n;
        if (n < batch) break;
      }
    return { deleted };
  }

  private async purgeBatch(tenantId: string, years: number, size: number): Promise<number> {
    try {
      return await this.o.kernel.mutate(
        tenantContext(tenantId),
        async (tx) => {
          // The restrictive policy enforces the 10-year floor and the legal hold; this bounds the batch.
          const r = await tx.query<{ id: string }>(
            `delete from trust.acknowledgement where id in (
               select a.id from trust.acknowledgement a
                 join trust.mirror_document d on d.vad_id = a.vad_id and d.version = a.version
                where not a.legal_hold and d.ended_at < now() - make_interval(years => $2)
                order by a.acknowledged_at, a.id limit $1)
             returning id`,
            [size, years],
          );
          if (!r.rows.length) throw NOTHING_DUE;
          await this.o.audit.record(tx, {
            action: "trust.acknowledgement.purge",
            resourceType: "vad_acknowledgement",
            resourceId: "batch",
            after: {
              rule: `${years} years after the version ended`,
              ids: r.rows.map((x) => x.id).sort(),
            },
          });
          return r.rows.length;
        },
        { action: "trust.acknowledgement.purge" },
      );
    } catch (e) {
      if (e === NOTHING_DUE) return 0;
      throw e;
    }
  }

  /**
   * Place or lift a legal hold on one tenant's acknowledgements of a document. Only a
   * PLT_LEGAL_REVIEWER in the platform context; the tenant's ledger names the reviewer.
   */
  async legalHold(
    staff: KernelContext,
    h: { tenantId: string; vadId: string; on: boolean; reason: string },
  ): Promise<number> {
    if (
      staff.scope !== "platform" ||
      staff.tenantId !== PLATFORM_TENANT_ID ||
      staff.principal.type !== "user" ||
      !staff.principal.roles.includes("PLT_LEGAL_REVIEWER")
    )
      throw new IpbError("IPB-UX-011", { detail: "legal holds need PLT_LEGAL_REVIEWER" });
    if (h.reason.trim().length < 5)
      throw new IpbError("IPB-CMS-001", { detail: "give the reason for the hold" });
    return this.o.kernel.mutate(
      tenantContext(h.tenantId, "svc_trust_legal_hold"),
      async (tx) => {
        const r = await tx.query(
          "update trust.acknowledgement set legal_hold = $3 where tenant_id = $1 and vad_id = $2 and legal_hold <> $3",
          [h.tenantId, h.vadId, h.on],
        );
        await this.o.audit.record(tx, {
          action: h.on ? "trust.legal_hold.placed" : "trust.legal_hold.lifted",
          resourceType: "vad",
          resourceId: h.vadId,
          after: { by: staff.principal.id, reason: h.reason.trim(), rows: r.rowCount ?? 0 },
        });
        return r.rowCount ?? 0;
      },
      { action: "trust.legal_hold" },
    );
  }
}
