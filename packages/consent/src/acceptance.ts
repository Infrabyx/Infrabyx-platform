// The acceptance ledger (IPB-05-05, §05.4.19; PL5 plan §6.1). A Terms-class document is accepted,
// a Privacy-class one acknowledged, with the exact version and text hash; a refusal puts the user
// in read-only mode with export (`pol.refusal_mode`, locked) and blocks other actions with
// `IPB-POL-010`. Rows are append-only, in the user's tenant, and each is ledgered.
import { IpbError } from "@infrabyx/contracts/errors";
import type {
  AuditSink,
  KernelContext,
  MutationKernel,
  OutboxWriter,
} from "@infrabyx/contracts/kernel";
import { CONSENT_EVENTS } from "@infrabyx/contracts";
import { internalEvent } from "@infrabyx/config/events";
import { newId } from "@infrabyx/crypto";

export type AcceptanceKind = "accepted" | "acknowledged" | "refused";

export interface DocumentVersion {
  key: string;
  version: string;
  textSha256: string;
  /** Terms-class (accept) or Privacy-class (acknowledge), from `pol.reconsent.*_class_keys`. */
  kind: "terms" | "notice";
  reconsentRequired: boolean;
}

export interface Pending {
  key: string;
  version: string;
  action: "accept" | "acknowledge";
}

export class AcceptanceLedger {
  constructor(
    private readonly o: {
      kernel: MutationKernel;
      audit: AuditSink;
      product: string;
      outbox?: OutboxWriter;
    },
  ) {}

  async record(
    ctx: KernelContext,
    d: {
      key: string;
      version: string;
      textSha256: string;
      kind: AcceptanceKind;
      uiVersion?: string;
    },
  ): Promise<{ id: string }> {
    if (ctx.principal.type !== "user")
      throw new IpbError("IPB-SEC-004", { detail: "only a person accepts a document" });
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const id = newId("acc");
        await tx.query(
          `insert into consent.acceptance (id, tenant_id, principal_id, document_key, version, text_sha256, kind, ui_version)
           values ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            id,
            ctx.tenantId,
            ctx.principal.id,
            d.key,
            d.version,
            d.textSha256,
            d.kind,
            d.uiVersion ?? null,
          ],
        );
        await this.o.audit.record(tx, {
          action: `consent.acceptance.${d.kind}`,
          resourceType: "consent_acceptance",
          resourceId: id,
          after: { key: d.key, version: d.version },
        });
        if (this.o.outbox)
          await this.o.outbox.publish(tx, "consent", {
            envelope: internalEvent({
              product: this.o.product,
              event:
                d.kind === "accepted"
                  ? CONSENT_EVENTS.AcceptanceRecorded
                  : d.kind === "acknowledged"
                    ? CONSENT_EVENTS.AcknowledgementRecorded
                    : CONSENT_EVENTS.AcceptanceRefused,
              tenantId: ctx.tenantId,
              data: { acceptance_id: id, document_key: d.key, version: d.version },
            }),
          });
        return { id };
      },
      { action: `consent.acceptance.${d.kind}` },
    );
  }

  /** What the user must accept or acknowledge at the next login (IPB-05-05). */
  async pending(ctx: KernelContext, docs: readonly DocumentVersion[]): Promise<Pending[]> {
    const latest = await this.latest(
      ctx,
      docs.map((d) => d.key),
    );
    return docs
      .filter((d) => {
        const last = latest.get(d.key);
        if (!last) return true;
        if (last.version === d.version) return last.kind === "refused";
        return d.reconsentRequired;
      })
      .map((d) => ({
        key: d.key,
        version: d.version,
        action: d.kind === "terms" ? "accept" : "acknowledge",
      }));
  }

  /** Refuse an action while the latest Terms-class answer is a refusal (`IPB-POL-010`; read-only mode). */
  async assertNotRefused(ctx: KernelContext, termsKeys: readonly string[]): Promise<void> {
    const latest = await this.latest(ctx, termsKeys);
    const refused = [...latest.entries()].filter(([, v]) => v.kind === "refused").map(([k]) => k);
    if (refused.length)
      throw new IpbError("IPB-POL-010", {
        detail: `accept ${refused.join(", ")} or export your data`,
        meta: { refused },
      });
  }

  private async latest(
    ctx: KernelContext,
    keys: readonly string[],
  ): Promise<Map<string, { version: string; kind: AcceptanceKind }>> {
    return this.o.kernel.read(ctx, async (tx) => {
      const r = await tx.query<{ document_key: string; version: string; kind: AcceptanceKind }>(
        `select distinct on (document_key) document_key, version, kind from consent.acceptance
          where tenant_id = $1 and principal_id = $2 and document_key = any($3)
          order by document_key, recorded_at desc, id desc`,
        [ctx.tenantId, ctx.principal.id, [...keys]],
      );
      return new Map(r.rows.map((x) => [x.document_key, { version: x.version, kind: x.kind }]));
    });
  }
}
