// The tenant view of the Vendor Assurance Room (IPB-08 §08.3.2; PL5 plan §7.2):
// Settings › Security & trust › Vendor documents. Everything here reads the mirror, so it keeps
// working when OH is unreachable (IPB-08-28) with an "as of" label.
//   list           documents this tenant may see: PUBLIC, TENANT and GATED_NDA versions that are
//                  VISIBLE; expired ones are labelled. AUDITOR documents need a grant (not in PL5).
//   acceptNda      ORG_OWNER or ORG_ADMIN accepts the standard NDA (`trust.gating.nda_version`); a
//                  consent-type record, ledgered, with `NdaAccepted` (`@IPB-08-AT-06`).
//   acknowledge    an ACKNOWLEDGED row: evidence for the tenant, never the user's name or e-mail.
//   download       a PUBLIC document: the OH-signed URL and a DOWNLOADED acknowledgement. A login- or
//                  NDA-gated document must be watermarked (IPB-08-09); until a DOCGEN watermark
//                  adapter exists the answer is `IPB-TRUST-012` and no unwatermarked original is
//                  ever served (OWNER-QUESTIONS #44).
//   request        a `vadr_` request with its SLA, handed to OH SUPPORT; PENDING_SYNC while OH is down.
//   subscribe      update subscriptions per document type or for all types.
import { IpbError } from "@infrabyx/contracts/errors";
import type {
  AuditSink,
  KernelContext,
  MutationKernel,
  OutboxWriter,
  Tx,
} from "@infrabyx/contracts/kernel";
import type { SupportPort, TrustPort, VadDocument } from "@infrabyx/contracts/ports";
import {
  NdaAcceptedData,
  TRUST_EVENTS,
  VendorAssuranceDocumentAcknowledgedData,
  VendorDocumentRequestedData,
} from "@infrabyx/contracts";
import { internalEvent } from "@infrabyx/config/events";
import { newId } from "@infrabyx/crypto";
import { Scrubber } from "@infrabyx/ai";
import type { MirrorRow, TrustMirror } from "./mirror.js";

export const TRUST_NDA_ROLES = ["ORG_OWNER", "ORG_ADMIN"] as const;
const DEFAULT_VIEW_ROLES = ["ORG_OWNER", "ORG_ADMIN", "ORG_AUDITOR_RO"];
const TENANT_VISIBILITY: readonly VadDocument["visibility"][] = ["PUBLIC", "TENANT", "GATED_NDA"];
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Settings the room reads (registered in `@infrabyx/config`). */
export interface SettingsReader {
  get(ctx: KernelContext, key: string): Promise<unknown>;
}

export interface TenantDocument {
  vadId: string;
  version: number;
  title: string;
  category: VadDocument["category"];
  typeKey: string | null;
  cadence: VadDocument["cadence"];
  validFrom: string;
  validUntil: string | null;
  summary: string;
  sha256: string;
  gating: "public" | "login" | "nda";
  status: "current" | "expiring" | "expired";
  ndaRequired: boolean;
}

export interface Acknowledgement {
  id: string;
  vadId: string;
  version: number;
  action: string;
  purpose: string | null;
  acknowledgedAt: string;
  deliveredSha256: string | null;
}

const scrubber = new Scrubber();
const dateOnly = (d: unknown): string | null =>
  d == null ? null : d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);

export class TrustRoom {
  constructor(
    private readonly o: {
      kernel: MutationKernel;
      audit: AuditSink;
      product: string;
      mirror: TrustMirror;
      trust: TrustPort;
      support: SupportPort;
      outbox?: OutboxWriter;
      settings?: SettingsReader;
      now?: () => Date;
    },
  ) {}

  private now(): Date {
    return this.o.now?.() ?? new Date();
  }

  private async setting<T>(ctx: KernelContext, key: string, fallback: T): Promise<T> {
    try {
      return ((await this.o.settings?.get(ctx, key)) ?? fallback) as T;
    } catch {
      return fallback;
    }
  }

  private static role(ctx: KernelContext, allowed: readonly string[]): string {
    if (ctx.scope === "platform" || ctx.principal.type !== "user" || ctx.act)
      throw new IpbError("IPB-UX-011", { detail: "the tenant's own signed-in staff only" });
    const r = ctx.principal.roles.find((x) => allowed.includes(x));
    if (!r) throw new IpbError("IPB-UX-011", { detail: `needs one of ${allowed.join(", ")}` });
    return r;
  }

  private async viewer(ctx: KernelContext): Promise<string> {
    return TrustRoom.role(
      ctx,
      await this.setting<string[]>(ctx, "trust.tenant.view_roles", DEFAULT_VIEW_ROLES),
    );
  }

  private async emit(tx: Tx, event: { module: string; name: string }, data: unknown) {
    if (!this.o.outbox) return;
    await this.o.outbox.publish(tx, "trust", {
      envelope: internalEvent({
        product: this.o.product,
        event,
        tenantId: tx.ctx.tenantId,
        dataclass: "INTERNAL",
        data: data as Record<string, unknown>,
      }),
    });
  }

  private toDocument(r: MirrorRow): TenantDocument {
    const today = this.now().toISOString().slice(0, 10);
    const until = dateOnly(r.valid_until);
    const soon = new Date(this.now().getTime() + 60 * DAY).toISOString().slice(0, 10);
    return {
      vadId: r.vad_id,
      version: r.version,
      title: r.title,
      category: r.category,
      typeKey: r.type_key,
      cadence: r.cadence,
      validFrom: dateOnly(r.valid_from)!,
      validUntil: until,
      summary: r.summary,
      sha256: r.sha256,
      gating:
        r.visibility === "PUBLIC"
          ? "public"
          : r.visibility === "GATED_NDA" || r.nda_required
            ? "nda"
            : "login",
      status:
        r.oh_state === "EXPIRED" || (until && until < today)
          ? "expired"
          : until && until <= soon
            ? "expiring"
            : "current",
      ndaRequired: r.visibility === "GATED_NDA" || r.nda_required,
    };
  }

  private async visible(vadId?: string): Promise<MirrorRow[]> {
    return (await this.o.mirror.rows()).filter(
      (r) =>
        r.mirror_state === "VISIBLE" &&
        TENANT_VISIBILITY.includes(r.visibility) &&
        (!vadId || r.vad_id === vadId),
    );
  }

  /** The documents list (IPB-08-14) with the mirror's "as of" stamp (IPB-08-28). */
  async list(ctx: KernelContext): Promise<{
    documents: TenantDocument[];
    ndaAccepted: boolean;
    asOf: string | null;
    stale: boolean;
  }> {
    await this.viewer(ctx);
    const staleMinutes = await this.setting(ctx, "trust.mirror.stale_minutes", 60);
    const [rows, nda, s] = await Promise.all([
      this.visible(),
      this.ndaAccepted(ctx),
      this.o.mirror.staleness(staleMinutes),
    ]);
    return {
      documents: rows
        .map((r) => this.toDocument(r))
        .sort((a, b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title)),
      ndaAccepted: nda,
      asOf: s.asOf,
      stale: s.label,
    };
  }

  async ndaAccepted(ctx: KernelContext): Promise<boolean> {
    const version = await this.setting<string | null>(ctx, "trust.gating.nda_version", null);
    if (!version) return false;
    return this.o.kernel.read(ctx, async (tx) => {
      const r = await tx.query(
        "select 1 from trust.nda_acceptance where tenant_id = $1 and nda_version = $2",
        [tx.ctx.tenantId, version],
      );
      return !!r.rowCount;
    });
  }

  /** The standard NDA click-through (IPB-08-08, `@IPB-08-AT-06`). Idempotent per NDA version. */
  async acceptNda(ctx: KernelContext): Promise<{ ndaId: string; version: string }> {
    const role = TrustRoom.role(ctx, TRUST_NDA_ROLES);
    const version = await this.setting<string | null>(ctx, "trust.gating.nda_version", null);
    if (!version)
      throw new IpbError("IPB-TRUST-002", { detail: "no standard NDA version is published yet" });
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const had = await tx.query<{ id: string }>(
          "select id from trust.nda_acceptance where tenant_id = $1 and nda_version = $2",
          [tx.ctx.tenantId, version],
        );
        if (had.rows[0]) {
          await this.o.audit.record(tx, {
            action: "trust.nda.already_accepted",
            resourceType: "nda_acceptance",
            resourceId: had.rows[0].id,
          });
          return { ndaId: had.rows[0].id, version };
        }
        const id = newId("nda");
        await tx.query(
          `insert into trust.nda_acceptance (id, tenant_id, nda_version, accepted_by, accepted_role, accepted_at)
           values ($1, $2, $3, $4, $5, $6)`,
          [id, tx.ctx.tenantId, version, ctx.principal.id, role, this.now()],
        );
        await this.o.audit.record(tx, {
          action: "trust.nda.accepted",
          resourceType: "nda_acceptance",
          resourceId: id,
          after: { nda_version: version, role },
        });
        await this.emit(
          tx,
          TRUST_EVENTS.NdaAccepted,
          NdaAcceptedData.parse({ nda_id: id, nda_version: version, accepted_by_role: role }),
        );
        return { ndaId: id, version };
      },
      { action: "trust.nda.accepted" },
    );
  }

  private static cleanPurpose(purpose: string | undefined): string | null {
    const p = purpose?.trim();
    if (!p) return null;
    if (p.length > 200) throw new IpbError("IPB-CMS-001", { detail: "purpose is too long" });
    const kinds = [...new Set(scrubber.detect(p).map((d) => d.kind))];
    if (kinds.length)
      throw new IpbError("IPB-CMS-001", {
        detail: `remove personal details from the purpose (${kinds.join(", ")})`,
      });
    return p;
  }

  /**
   * The document a tenant asks for, or why not: never visible to this tenant → `IPB-TRUST-001`;
   * NDA-gated without an accepted NDA → `IPB-TRUST-002`.
   */
  private async gate(ctx: KernelContext, vadId: string): Promise<MirrorRow> {
    const doc = (await this.visible(vadId)).sort((a, b) => b.version - a.version)[0];
    if (!doc) throw new IpbError("IPB-TRUST-001");
    if ((doc.visibility === "GATED_NDA" || doc.nda_required) && !(await this.ndaAccepted(ctx)))
      throw new IpbError("IPB-TRUST-002");
    return doc;
  }

  private async record(
    ctx: KernelContext,
    role: string,
    doc: MirrorRow,
    a: {
      action: "ACKNOWLEDGED" | "DOWNLOADED";
      purpose: string | null;
      ipClass?: string;
      uaClass?: string;
      deliveredSha256?: string;
    },
  ): Promise<string> {
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const id = newId("vada");
        await tx.query(
          `insert into trust.acknowledgement (id, tenant_id, vad_id, version, user_id, user_role, action, purpose,
             ip_class, ua_class, delivered_sha256, acknowledged_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [
            id,
            tx.ctx.tenantId,
            doc.vad_id,
            doc.version,
            ctx.principal.id,
            role,
            a.action,
            a.purpose,
            a.ipClass ?? null,
            a.uaClass ?? null,
            a.deliveredSha256 ?? null,
            this.now(),
          ],
        );
        await this.o.audit.record(tx, {
          action: `trust.document.${a.action.toLowerCase()}`,
          resourceType: "vad",
          resourceId: doc.vad_id,
          after: { acknowledgement_id: id, version: doc.version },
        });
        await this.emit(
          tx,
          TRUST_EVENTS.VendorAssuranceDocumentAcknowledged,
          VendorAssuranceDocumentAcknowledgedData.parse({
            acknowledgement_id: id,
            vad_id: doc.vad_id,
            version: doc.version,
            action: a.action === "DOWNLOADED" ? "VIEWED" : "ACKNOWLEDGED",
            acknowledged_by_role: role,
          }),
        );
        return id;
      },
      { action: `trust.document.${a.action.toLowerCase()}` },
    );
  }

  /** "I have read this" for the tenant's evidence log (IPB-08-15, IPB-08-31). */
  async acknowledge(
    ctx: KernelContext,
    vadId: string,
    o: { purpose?: string; ipClass?: string; uaClass?: string } = {},
  ): Promise<{ acknowledgementId: string }> {
    const role = await this.viewer(ctx);
    const purpose = TrustRoom.cleanPurpose(o.purpose);
    const doc = await this.gate(ctx, vadId);
    return {
      acknowledgementId: await this.record(ctx, role, doc, {
        action: "ACKNOWLEDGED",
        purpose,
        ...(o.ipClass ? { ipClass: o.ipClass } : {}),
        ...(o.uaClass ? { uaClass: o.uaClass } : {}),
      }),
    };
  }

  /**
   * A download. PUBLIC documents get the OH-signed URL and an acknowledgement; gated documents are
   * refused with `IPB-TRUST-012` until watermarking exists (#44). The refusal is ledgered.
   */
  async download(
    ctx: KernelContext,
    vadId: string,
    o: { purpose?: string; ipClass?: string; uaClass?: string } = {},
  ): Promise<{ url: string; expiresAt: string; acknowledgementId: string; sha256: string }> {
    const role = await this.viewer(ctx);
    const purpose = TrustRoom.cleanPurpose(o.purpose);
    const doc = await this.gate(ctx, vadId);
    if (doc.visibility !== "PUBLIC") {
      await this.o.kernel.mutate(
        ctx,
        async (tx) => {
          await this.o.audit.record(tx, {
            action: "trust.document.download_refused",
            resourceType: "vad",
            resourceId: doc.vad_id,
            after: { code: "IPB-TRUST-012", reason: "watermarking not available" },
          });
        },
        { action: "trust.document.download_refused" },
      );
      throw new IpbError("IPB-TRUST-012", { detail: "gated documents need a watermarked copy" });
    }
    let file: { url: string; sha256: string; expiresAt: string };
    try {
      file = await this.o.trust.fileUrl(doc.vad_id);
    } catch (e) {
      throw new IpbError("IPB-TRUST-012", {
        detail: "the document store is unreachable",
        cause: e,
      });
    }
    if (file.sha256 !== doc.sha256)
      throw new IpbError("IPB-TRUST-012", {
        detail: "the file does not match its published digest",
      });
    const id = await this.record(ctx, role, doc, {
      action: "DOWNLOADED",
      purpose,
      deliveredSha256: doc.sha256,
      ...(o.ipClass ? { ipClass: o.ipClass } : {}),
      ...(o.uaClass ? { uaClass: o.uaClass } : {}),
    });
    return { url: file.url, expiresAt: file.expiresAt, acknowledgementId: id, sha256: doc.sha256 };
  }

  /** The tenant's own acknowledgement log (IPB-08-31); never another tenant's (`@IPB-08-AT-10`). */
  async acknowledgements(ctx: KernelContext): Promise<Acknowledgement[]> {
    await this.viewer(ctx);
    return this.o.kernel.read(ctx, async (tx) => {
      const r = await tx.query<{
        id: string;
        vad_id: string;
        version: number;
        action: string;
        purpose: string | null;
        acknowledged_at: Date;
        delivered_sha256: string | null;
      }>(
        `select id, vad_id, version, action, purpose, acknowledged_at, delivered_sha256 from trust.acknowledgement
          where tenant_id = $1 order by acknowledged_at desc, id desc limit 500`,
        [tx.ctx.tenantId],
      );
      return r.rows.map((x) => ({
        id: x.id,
        vadId: x.vad_id,
        version: x.version,
        action: x.action,
        purpose: x.purpose,
        acknowledgedAt: x.acknowledged_at.toISOString(),
        deliveredSha256: x.delivered_sha256,
      }));
    });
  }

  /** Request a document (IPB-08-17, `@IPB-08-AT-09`): SLA from `trust.request.*`, OH ticket. */
  async request(
    ctx: KernelContext,
    q: { typeKey?: string; description: string; purpose?: string; regulatorDeadline?: string },
  ): Promise<{
    requestId: string;
    state: "open";
    synced: boolean;
    ackDue: string;
    fulfilDue: string;
  }> {
    await this.viewer(ctx);
    const description = q.description.trim();
    if (!description || description.length > 1000)
      throw new IpbError("IPB-CMS-001", {
        detail: "describe the document in up to 1000 characters",
      });
    const kinds = [...new Set(scrubber.detect(description).map((d) => d.kind))];
    if (kinds.length)
      throw new IpbError("IPB-CMS-001", {
        detail: `remove personal details from the description (${kinds.join(", ")})`,
      });
    const purpose = TrustRoom.cleanPurpose(q.purpose);
    if (q.regulatorDeadline && !/^\d{4}-\d{2}-\d{2}$/.test(q.regulatorDeadline))
      throw new IpbError("IPB-CMS-001", { detail: "regulator deadline is a date" });
    const ackHours = Math.min(24, await this.setting(ctx, "trust.request.ack_hours", 24));
    const fulfil = await this.setting(ctx, "trust.request.fulfil_days", {
      default: 10,
      regulator_deadline: 3,
    });
    const now = this.now();
    const ackDue = new Date(now.getTime() + ackHours * HOUR);
    const fulfilDue = new Date(
      now.getTime() + (q.regulatorDeadline ? fulfil.regulator_deadline : fulfil.default) * DAY,
    );
    const id = await this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const id = newId("vadr");
        await tx.query(
          `insert into trust.request (id, tenant_id, type_key, description, purpose, regulator_deadline, sla_ack_due,
             sla_fulfil_due, created_by, created_at, updated_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)`,
          [
            id,
            tx.ctx.tenantId,
            q.typeKey ?? null,
            description,
            purpose,
            q.regulatorDeadline ?? null,
            ackDue,
            fulfilDue,
            ctx.principal.id,
            now,
          ],
        );
        await this.o.audit.record(tx, {
          action: "trust.request.opened",
          resourceType: "vad_request",
          resourceId: id,
          after: { type_key: q.typeKey ?? null, regulator_deadline: q.regulatorDeadline ?? null },
        });
        await this.emit(
          tx,
          TRUST_EVENTS.VendorDocumentRequested,
          VendorDocumentRequestedData.parse({
            request_id: id,
            type_key: q.typeKey ?? null,
            regulator_deadline: q.regulatorDeadline ?? null,
            ack_due_at: ackDue.toISOString(),
          }),
        );
        return id;
      },
      { action: "trust.request.opened" },
    );
    const synced = !!(await this.syncRequest(ctx.tenantId, id).catch(() => null));
    return {
      requestId: id,
      state: "open",
      synced,
      ackDue: ackDue.toISOString(),
      fulfilDue: fulfilDue.toISOString(),
    };
  }

  /** Hand a request to OH SUPPORT once (idempotency key = the request id). */
  async syncRequest(tenantId: string, id: string): Promise<string> {
    const ctx: KernelContext = {
      tenantId,
      principal: { id: "svc_trust_requests", type: "service", roles: [] },
    };
    const cur = await this.o.kernel.read(ctx, async (tx) => {
      const r = await tx.query<{
        ticket_ref: string | null;
        type_key: string | null;
        description: string;
      }>(
        "select ticket_ref, type_key, description from trust.request where tenant_id = $1 and id = $2",
        [tenantId, id],
      );
      return r.rows[0];
    });
    if (!cur) throw new IpbError("IPB-TRUST-001", { detail: "no such request" });
    if (cur.ticket_ref) return cur.ticket_ref;
    let ref: string;
    try {
      ref = (
        await this.o.support.createTicket(
          {
            kind: "support",
            category: "CONTENT",
            summary:
              `Vendor document request ${id} (${cur.type_key ?? "other"}): ${cur.description}`.slice(
                0,
                500,
              ),
            contactOk: true,
          },
          { tenantId, idempotencyKey: id },
        )
      ).ref;
    } catch (e) {
      await this.o.kernel.mutate(
        ctx,
        async (tx) => {
          await tx.query(
            "update trust.request set sync_attempts = sync_attempts + 1 where id = $1",
            [id],
          );
          await this.o.audit.record(tx, {
            action: "trust.request.sync_failed",
            resourceType: "vad_request",
            resourceId: id,
          });
        },
        { action: "trust.request.sync_failed" },
      );
      throw e;
    }
    await this.o.kernel.mutate(
      ctx,
      async (tx) => {
        await tx.query(
          "update trust.request set ticket_ref = $2, updated_at = $3 where id = $1 and ticket_ref is null",
          [id, ref, this.now()],
        );
        await this.o.audit.record(tx, {
          action: "trust.request.synced",
          resourceType: "vad_request",
          resourceId: id,
          after: { ticket_ref: ref },
        });
      },
      { action: "trust.request.synced" },
    );
    return ref;
  }

  /** OH's progress on a request (acknowledged, in progress, fulfilled with a document, declined). */
  async onRequestProgress(
    tenantId: string,
    id: string,
    p: {
      state: "acknowledged" | "in_progress" | "fulfilled" | "declined";
      fulfilledVadId?: string;
    },
  ): Promise<void> {
    const ctx: KernelContext = {
      tenantId,
      principal: { id: "svc_trust_requests", type: "service", roles: [] },
    };
    await this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const r = await tx.query(
          `update trust.request set state = $2, fulfilled_vad_id = coalesce($3, fulfilled_vad_id), updated_at = $4
            where tenant_id = $5 and id = $1 and state not in ('fulfilled', 'declined') returning id`,
          [id, p.state, p.fulfilledVadId ?? null, this.now(), tenantId],
        );
        await this.o.audit.record(tx, {
          action: r.rowCount ? "trust.request.progress" : "trust.request.progress_ignored",
          resourceType: "vad_request",
          resourceId: id,
          after: { state: p.state, fulfilled_vad_id: p.fulfilledVadId ?? null },
        });
      },
      { action: "trust.request.progress" },
    );
  }

  async requests(ctx: KernelContext): Promise<
    {
      id: string;
      typeKey: string | null;
      state: string;
      synced: boolean;
      ackDue: string;
      fulfilDue: string;
      fulfilledVadId: string | null;
    }[]
  > {
    await this.viewer(ctx);
    return this.o.kernel.read(ctx, async (tx) => {
      const r = await tx.query<{
        id: string;
        type_key: string | null;
        state: string;
        ticket_ref: string | null;
        sla_ack_due: Date;
        sla_fulfil_due: Date;
        fulfilled_vad_id: string | null;
      }>(
        `select id, type_key, state, ticket_ref, sla_ack_due, sla_fulfil_due, fulfilled_vad_id from trust.request
          where tenant_id = $1 order by created_at desc limit 200`,
        [tx.ctx.tenantId],
      );
      return r.rows.map((x) => ({
        id: x.id,
        typeKey: x.type_key,
        state: x.state,
        synced: !!x.ticket_ref,
        ackDue: x.sla_ack_due.toISOString(),
        fulfilDue: x.sla_fulfil_due.toISOString(),
        fulfilledVadId: x.fulfilled_vad_id,
      }));
    });
  }

  /** Subscribe to updates for a document type, or to all types (`typeKey` null) (IPB-08-16). */
  async subscribe(
    ctx: KernelContext,
    s: { typeKey: string | null; channels: ("in_app" | "email")[] },
  ): Promise<void> {
    await this.viewer(ctx);
    await this.o.kernel.mutate(
      ctx,
      async (tx) => {
        await tx.query(
          `insert into trust.subscription (id, tenant_id, user_id, type_key, channels) values ($1, $2, $3, $4, $5)
           on conflict (tenant_id, user_id, coalesce(type_key, '*')) do update set channels = excluded.channels`,
          [newId("vads"), tx.ctx.tenantId, ctx.principal.id, s.typeKey, s.channels],
        );
        await this.o.audit.record(tx, {
          action: "trust.subscription.set",
          resourceType: "vad_subscription",
          resourceId: s.typeKey ?? "all",
          after: { channels: s.channels },
        });
      },
      { action: "trust.subscription.set" },
    );
  }

  async unsubscribe(ctx: KernelContext, typeKey: string | null): Promise<void> {
    await this.viewer(ctx);
    await this.o.kernel.mutate(
      ctx,
      async (tx) => {
        await tx.query(
          "delete from trust.subscription where tenant_id = $1 and user_id = $2 and coalesce(type_key, '*') = $3",
          [tx.ctx.tenantId, ctx.principal.id, typeKey ?? "*"],
        );
        await this.o.audit.record(tx, {
          action: "trust.subscription.removed",
          resourceType: "vad_subscription",
          resourceId: typeKey ?? "all",
        });
      },
      { action: "trust.subscription.removed" },
    );
  }
}
