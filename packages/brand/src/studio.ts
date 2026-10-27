// Brand Studio (IPB-04 §04.3.2, §04.4.3; PL5 plan §5.2). Packs and revisions are platform rows;
// every write goes through the kernel with an audit ledger entry, in a platform context.
//   draft ──submit──▶ pending_approval ──approve──▶ published; rollback creates a new revision.
// Publish is maker-checker: a second PLT_SUPER_ADMIN or a PLT_RELEASE_MANAGER approves, and a
// PLT_LEGAL_REVIEWER reviews first when legal-class fields changed (Ecosystem §13). The checker and
// the legal reviewer are never the maker; the migration enforces the same.
import { IpbError } from "@infrabyx/contracts/errors";
import { PLATFORM_TENANT_ID } from "@infrabyx/contracts/ids";
import type {
  AuditSink,
  KernelContext,
  MutationKernel,
  OutboxWriter,
  Tx,
} from "@infrabyx/contracts/kernel";
import type { StoragePort } from "@infrabyx/contracts/ports";
import { storageKey } from "@infrabyx/contracts/ports";
import { BRAND_EVENTS, BrandPackPublishedData, ContrastGuardFailedData } from "@infrabyx/contracts";
import { internalEvent } from "@infrabyx/config/events";
import { newId, sha256Hex, ulid } from "@infrabyx/crypto";
import { NotFoundError } from "@infrabyx/tenancy";
import type { Product } from "@infrabyx/ui/tokens";
import { contrastGuard, contrastMessage, type ContrastGuardResult } from "./contrast.js";
import { faviconSet, type FaviconSet } from "./favicon.js";
import { resolveHost, type HostMapEntry, type HostResolution } from "./hosts.js";
import {
  BrandPackBody,
  changedLegalFields,
  emailDomain,
  HostEntry,
  type BrandPackBodyInput,
  type BrandProduct,
  type MediaRef,
} from "./shape.js";
import { sanitiseSvg } from "./svg.js";

export const PUBLISH_CHECKERS = ["PLT_SUPER_ADMIN", "PLT_RELEASE_MANAGER"] as const;
export const LEGAL_REVIEWER = "PLT_LEGAL_REVIEWER";
const SANITISED_TAG = "ipb_svg_sanitised";

export type RevisionStatus = "draft" | "pending_approval" | "rejected" | "published" | "superseded";

export interface Revision {
  id: string;
  packId: string;
  body: BrandPackBody;
  hosts: HostEntry[];
  status: RevisionStatus;
  contrastGuardPassed: boolean;
  svgSanitised: boolean;
  legalReviewRequired: boolean;
  rollbackOf: string | null;
  makerId: string;
  checkerId: string | null;
  legalReviewerId: string | null;
}

export interface BrandStudioHooks {
  /** NOTIFY: SPF, DKIM and DMARC verified for the sending domain (IPB-04-28). */
  emailIdentityVerified(ctx: KernelContext, domain: string): Promise<boolean>;
  /** The IPB-05 policy set is published (IPB-04-30). */
  policySetPublished(ctx: KernelContext, policySetId: string): Promise<boolean>;
  /** The footer validator (`@infrabyx/cms`); throws with its own code when the footer fails. */
  validateFooter?(ctx: KernelContext, body: BrandPackBody): Promise<void>;
  /** A host-resolution signal (unknown host, forwarded-host mismatch) for the security log. */
  onHostEvent?(event: HostResolution["events"][number]): void;
}

export interface BrandStudioOptions {
  kernel: MutationKernel;
  audit: AuditSink;
  product: string;
  storage: StoragePort;
  hooks: BrandStudioHooks;
  outbox?: OutboxWriter;
  /** `brand.contrast.min_text` and `brand.contrast.min_ui` (raise only). */
  contrastMinimums?: (ctx: KernelContext) => Promise<{ minText?: number; minUi?: number }>;
}

interface RevisionRow {
  id: string;
  pack_id: string;
  body: BrandPackBody;
  hosts: HostEntry[];
  status: RevisionStatus;
  contrast_guard_passed: boolean;
  svg_sanitised: boolean;
  legal_review_required: boolean;
  rollback_of: string | null;
  maker_id: string;
  checker_id: string | null;
  legal_reviewer_id: string | null;
}

const toRevision = (r: RevisionRow): Revision => ({
  id: r.id,
  packId: r.pack_id,
  body: r.body,
  hosts: r.hosts,
  status: r.status,
  contrastGuardPassed: r.contrast_guard_passed,
  svgSanitised: r.svg_sanitised,
  legalReviewRequired: r.legal_review_required,
  rollbackOf: r.rollback_of,
  makerId: r.maker_id,
  checkerId: r.checker_id,
  legalReviewerId: r.legal_reviewer_id,
});

const hasRole = (ctx: KernelContext, roles: readonly string[]) =>
  ctx.principal.roles.some((r) => roles.includes(r));

export class BrandStudio {
  constructor(private readonly o: BrandStudioOptions) {}

  private platformOnly(ctx: KernelContext): void {
    if (ctx.scope !== "platform" || ctx.tenantId !== PLATFORM_TENANT_ID)
      throw new IpbError("IPB-UX-011", { detail: "brand packs are edited in a platform context" });
  }

  async createPack(
    ctx: KernelContext,
    input: { product: BrandProduct; label: string; isDefault?: boolean },
  ): Promise<{ id: string }> {
    this.platformOnly(ctx);
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const id = newId("brd");
        await tx.query(
          `insert into brand.pack (id, product, is_default, label, created_by) values ($1, $2, $3, $4, $5)`,
          [id, input.product, input.isDefault ?? false, input.label, ctx.principal.id],
        );
        await this.o.audit.record(tx, {
          action: "brand.pack.create",
          resourceType: "brand_pack",
          resourceId: id,
          after: { product: input.product, is_default: input.isDefault ?? false },
        });
        return { id };
      },
      { action: "brand.pack.create" },
    );
  }

  /**
   * Sanitise an uploaded SVG logo and store only the result (`@IPB-04-AT-21`). The report lists
   * every removal; the upload itself is never written anywhere.
   */
  async uploadLogo(
    ctx: KernelContext,
    packId: string,
    upload: string | Uint8Array,
  ): Promise<{ ref: MediaRef; removed: string[] }> {
    this.platformOnly(ctx);
    const { svg, removed } = sanitiseSvg(upload);
    const bytes = new TextEncoder().encode(svg);
    const sha256 = sha256Hex(bytes);
    const key = storageKey(PLATFORM_TENANT_ID, "brand", ulid(), "svg");
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        await this.loadPack(tx, packId);
        await this.o.storage.put(key, bytes, {
          contentType: "image/svg+xml",
          bucketClass: "PUBLIC_ASSETS",
          sha256,
          tags: { [SANITISED_TAG]: "1", pack: packId },
        });
        await this.o.audit.record(tx, {
          action: "brand.logo.upload",
          resourceType: "brand_pack",
          resourceId: packId,
          after: { key, sha256, removed: removed.length },
        });
        return { ref: { key, sha256, content_type: "image/svg+xml" }, removed };
      },
      { action: "brand.logo.upload" },
    );
  }

  /** The guard on a body's colours, for the four-theme preview before Save (IPB-07-32). */
  async preview(
    ctx: KernelContext,
    product: BrandProduct,
    colour: BrandPackBodyInput["tokens"]["colour"],
  ): Promise<ContrastGuardResult> {
    const body = BrandPackBody.shape.tokens.shape.colour.parse(colour);
    return contrastGuard(product as Product, body, (await this.o.contrastMinimums?.(ctx)) ?? {});
  }

  /**
   * Save a draft revision. Refused with `IPB-BRD-003` (pairs and ratios, with a suggested colour)
   * when the contrast guard fails, and with `IPB-BRD-002` when a host is already another pack's.
   * A rejected guard is recorded in the ledger with `ContrastGuardFailed` before the refusal.
   */
  async saveDraft(
    ctx: KernelContext,
    packId: string,
    input: { body: BrandPackBodyInput; hosts: readonly HostEntry[] | readonly unknown[] },
  ): Promise<Revision> {
    this.platformOnly(ctx);
    const body = BrandPackBody.parse(input.body);
    const hosts = input.hosts.map((h) => HostEntry.parse(h));
    const dup = hosts.map((h) => h.host).filter((h, i, all) => all.indexOf(h) !== i);
    if (dup.length)
      throw new IpbError("IPB-BRD-002", { detail: `listed twice: ${dup.join(", ")}` });
    const pack = await this.o.kernel.read(ctx, (tx) => this.loadPack(tx, packId));
    const guard = contrastGuard(
      pack.product as Product,
      body.tokens.colour,
      (await this.o.contrastMinimums?.(ctx)) ?? {},
    );
    if (!guard.passed) {
      await this.recordContrastRejection(ctx, packId, guard);
      throw new IpbError("IPB-BRD-003", {
        detail: contrastMessage(guard.failures[0]!),
        meta: { pairs: guard.failures },
      });
    }
    const sanitised = body.logo ? await this.isSanitised(body.logo.svg) : false;
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        await this.assertHostsFree(tx, packId, hosts);
        const id = newId("brv");
        const r = await tx.query<RevisionRow>(
          `insert into brand.pack_revision (id, pack_id, body, hosts, contrast_guard_passed, svg_sanitised, maker_id)
           values ($1, $2, $3::jsonb, $4::jsonb, true, $5, $6) returning *`,
          [id, packId, JSON.stringify(body), JSON.stringify(hosts), sanitised, ctx.principal.id],
        );
        await this.o.audit.record(tx, {
          action: "brand.revision.save",
          resourceType: "brand_pack_revision",
          resourceId: id,
          after: { pack_id: packId, hosts: hosts.map((h) => h.host), svg_sanitised: sanitised },
        });
        return toRevision(r.rows[0]!);
      },
      { action: "brand.revision.save" },
    );
  }

  /**
   * Submit for approval after the publish preconditions (IPB-04 §04.4.3): contrast guard passed,
   * SVG sanitised and the favicon set present, email identity verified (`IPB-BRD-005`), policy set
   * published (`IPB-BRD-006`), hosts present and unique (`IPB-BRD-002`), footer valid.
   */
  async submit(ctx: KernelContext, revisionId: string): Promise<Revision> {
    this.platformOnly(ctx);
    const rev = await this.get(ctx, revisionId);
    if (rev.status !== "draft")
      throw new IpbError("IPB-UX-011", { detail: `revision is ${rev.status}` });
    await this.assertPublishable(ctx, rev);
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const current = await this.publishedRow(tx, rev.packId);
        const legal = changedLegalFields(current?.body ?? null, rev.body);
        await this.assertHostsFree(tx, rev.packId, rev.hosts);
        const r = await tx.query<RevisionRow>(
          `update brand.pack_revision set status = 'pending_approval', submitted_at = now(),
             legal_review_required = $2 where id = $1 and status = 'draft' returning *`,
          [revisionId, legal.length > 0],
        );
        if (!r.rows[0]) throw new IpbError("IPB-UX-011", { detail: "revision changed meanwhile" });
        await this.o.audit.record(tx, {
          action: "brand.revision.submit",
          resourceType: "brand_pack_revision",
          resourceId: revisionId,
          before: { status: "draft" },
          after: { status: "pending_approval", legal_fields: legal },
        });
        return toRevision(r.rows[0]);
      },
      { action: "brand.revision.submit" },
    );
  }

  /** The PLT_LEGAL_REVIEWER review that legal-class changes need before approval. */
  async legalReview(ctx: KernelContext, revisionId: string): Promise<Revision> {
    this.platformOnly(ctx);
    if (!hasRole(ctx, [LEGAL_REVIEWER]))
      throw new IpbError("IPB-UX-011", { detail: `legal review needs ${LEGAL_REVIEWER}` });
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const rev = toRevision(await this.loadRow(tx, revisionId, true));
        if (rev.status !== "pending_approval" || !rev.legalReviewRequired)
          throw new IpbError("IPB-UX-011", {
            detail: "no legal review is pending on this revision",
          });
        if (rev.makerId === ctx.principal.id)
          throw new IpbError("IPB-SEC-007", { meta: { revision_id: revisionId } });
        const r = await tx.query<RevisionRow>(
          `update brand.pack_revision set legal_reviewer_id = $2, legal_reviewed_at = now() where id = $1 returning *`,
          [revisionId, ctx.principal.id],
        );
        await this.o.audit.record(tx, {
          action: "brand.revision.legal_review",
          resourceType: "brand_pack_revision",
          resourceId: revisionId,
          after: { legal_reviewer_id: ctx.principal.id },
        });
        return toRevision(r.rows[0]!);
      },
      { action: "brand.revision.legal_review" },
    );
  }

  /** Approve and publish (`@IPB-04-AT-28` for rollbacks). */
  async approve(ctx: KernelContext, revisionId: string): Promise<Revision> {
    this.platformOnly(ctx);
    if (!hasRole(ctx, PUBLISH_CHECKERS))
      throw new IpbError("IPB-UX-011", {
        detail: `checker needs one of ${PUBLISH_CHECKERS.join(", ")}`,
      });
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const rev = toRevision(await this.loadRow(tx, revisionId, true));
        if (rev.status !== "pending_approval")
          throw new IpbError("IPB-UX-011", { detail: `revision is ${rev.status}` });
        if (rev.makerId === ctx.principal.id || rev.legalReviewerId === ctx.principal.id)
          throw new IpbError("IPB-SEC-007", { meta: { revision_id: revisionId } });
        if (rev.legalReviewRequired && !rev.legalReviewerId)
          throw new IpbError("IPB-UX-011", {
            detail: `legal-class fields changed; ${LEGAL_REVIEWER} reviews first`,
          });
        await this.assertHostsFree(tx, rev.packId, rev.hosts);
        const prev = await this.publishedRow(tx, rev.packId);
        if (prev)
          await tx.query("update brand.pack_revision set status = 'superseded' where id = $1", [
            prev.id,
          ]);
        const r = await tx.query<RevisionRow>(
          `update brand.pack_revision set status = 'published', checker_id = $2, approved_at = now()
           where id = $1 returning *`,
          [revisionId, ctx.principal.id],
        );
        await tx.query(
          `update brand.pack set status = 'published', published_revision_id = $2, updated_at = now() where id = $1`,
          [rev.packId, revisionId],
        );
        await tx.query("delete from brand.host where pack_id = $1", [rev.packId]);
        for (const h of rev.hosts)
          await tx.query(
            "insert into brand.host (host, pack_id, role, verified) values ($1, $2, $3, $4)",
            [h.host, rev.packId, h.role, h.verified],
          );
        const action = rev.rollbackOf ? "ROLLED_BACK" : "PUBLISHED";
        await this.o.audit.record(tx, {
          action: rev.rollbackOf ? "brand.pack.rollback" : "brand.pack.publish",
          resourceType: "brand_pack",
          resourceId: rev.packId,
          before: { revision_id: prev?.id ?? null },
          after: {
            revision_id: revisionId,
            rollback_of: rev.rollbackOf,
            hosts: rev.hosts.map((h) => h.host),
          },
        });
        if (this.o.outbox)
          await this.o.outbox.publish(tx, "brand", {
            envelope: internalEvent({
              product: this.o.product,
              event: rev.rollbackOf
                ? BRAND_EVENTS.BrandPackRolledBack
                : BRAND_EVENTS.BrandPackPublished,
              tenantId: tx.ctx.tenantId,
              data: BrandPackPublishedData.parse({
                brd_id: rev.packId,
                revision_id: revisionId,
                action,
                hosts: rev.hosts.map((h) => h.host),
                app_name: rev.body.app_name,
                contrast_guard_passed: rev.contrastGuardPassed,
                rollback_of: rev.rollbackOf,
              }),
            }),
          });
        return toRevision(r.rows[0]!);
      },
      { action: "brand.pack.publish" },
    );
  }

  async reject(ctx: KernelContext, revisionId: string, reason: string): Promise<Revision> {
    this.platformOnly(ctx);
    if (!hasRole(ctx, [...PUBLISH_CHECKERS, LEGAL_REVIEWER]))
      throw new IpbError("IPB-UX-011", { detail: "only a checker or the legal reviewer rejects" });
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const rev = toRevision(await this.loadRow(tx, revisionId, true));
        if (rev.makerId === ctx.principal.id)
          throw new IpbError("IPB-SEC-007", { meta: { revision_id: revisionId } });
        if (rev.status !== "pending_approval")
          throw new IpbError("IPB-UX-011", { detail: `revision is ${rev.status}` });
        const r = await tx.query<RevisionRow>(
          "update brand.pack_revision set status = 'rejected', rejected_reason = $2 where id = $1 returning *",
          [revisionId, reason],
        );
        await this.o.audit.record(tx, {
          action: "brand.revision.reject",
          resourceType: "brand_pack_revision",
          resourceId: revisionId,
          after: { status: "rejected" },
        });
        return toRevision(r.rows[0]!);
      },
      { action: "brand.revision.reject" },
    );
  }

  /**
   * Request a rollback to an earlier published revision: a new revision with that body and
   * `rollback_of`, submitted under the same preconditions and approved like any publish (IPB-04-31).
   */
  async requestRollback(
    ctx: KernelContext,
    packId: string,
    toRevisionId: string,
  ): Promise<Revision> {
    this.platformOnly(ctx);
    const target = await this.get(ctx, toRevisionId);
    if (target.packId !== packId || !["published", "superseded"].includes(target.status))
      throw new IpbError("IPB-UX-011", {
        detail: "a rollback targets an earlier published revision of this pack",
      });
    const draft = await this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const current = await this.publishedRow(tx, packId);
        if (current?.id === toRevisionId)
          throw new IpbError("IPB-UX-011", { detail: "that revision is already published" });
        const id = newId("brv");
        const r = await tx.query<RevisionRow>(
          `insert into brand.pack_revision (id, pack_id, body, hosts, contrast_guard_passed, svg_sanitised, rollback_of, maker_id)
           values ($1, $2, $3::jsonb, $4::jsonb, $5, $6, $7, $8) returning *`,
          [
            id,
            packId,
            JSON.stringify(target.body),
            JSON.stringify(target.hosts),
            target.contrastGuardPassed,
            target.svgSanitised,
            toRevisionId,
            ctx.principal.id,
          ],
        );
        await this.o.audit.record(tx, {
          action: "brand.pack.rollback.request",
          resourceType: "brand_pack",
          resourceId: packId,
          after: { revision_id: id, rollback_of: toRevisionId },
        });
        return toRevision(r.rows[0]!);
      },
      { action: "brand.pack.rollback.request" },
    );
    return this.submit(ctx, draft.id);
  }

  async get(ctx: KernelContext, revisionId: string): Promise<Revision> {
    return this.o.kernel.read(ctx, async (tx) =>
      toRevision(await this.loadRow(tx, revisionId, false)),
    );
  }

  /** The published revision of a pack, or null. */
  async published(ctx: KernelContext, packId: string): Promise<Revision | null> {
    return this.o.kernel.read(ctx, async (tx) => {
      const r = await this.publishedRow(tx, packId);
      return r ? toRevision(r) : null;
    });
  }

  /** The favicon set and manifest for a revision (served per host, IPB-04-22). */
  async favicons(ctx: KernelContext, rev: Revision): Promise<FaviconSet> {
    const svg = rev.body.logo
      ? new TextDecoder().decode((await this.o.storage.get(rev.body.logo.svg.key)).body)
      : null;
    const pack = await this.o.kernel.read(ctx, (tx) => this.loadPack(tx, rev.packId));
    const guard = contrastGuard(pack.product as Product, rev.body.tokens.colour);
    return faviconSet(rev.body, svg, guard.previews.light.colours.primary);
  }

  /** Resolve the pack for a request: published hosts only, the product default otherwise. */
  async resolve(
    ctx: KernelContext,
    product: BrandProduct,
    headers: { host: string | null | undefined; forwardedHost?: string | null | undefined },
  ): Promise<HostResolution> {
    const { map, fallback } = await this.o.kernel.read(ctx, async (tx) => {
      const hosts = await tx.query<{ host: string; pack_id: string }>(
        `select h.host, h.pack_id from brand.host h join brand.pack p on p.id = h.pack_id
          where p.status = 'published' and h.verified`,
      );
      const def = await tx.query<{ id: string }>(
        "select id from brand.pack where product = $1 and is_default and status = 'published'",
        [product],
      );
      return {
        map: hosts.rows.map((h): HostMapEntry => ({ host: h.host, packId: h.pack_id })),
        fallback: def.rows[0]?.id,
      };
    });
    if (!fallback) throw new NotFoundError("published default brand pack");
    const res = resolveHost(map, fallback, headers);
    for (const e of res.events) this.o.hooks.onHostEvent?.(e);
    return res;
  }

  private async assertPublishable(ctx: KernelContext, rev: Revision): Promise<void> {
    if (!rev.contrastGuardPassed)
      throw new IpbError("IPB-BRD-003", { detail: "contrast guard not passed" });
    if (!rev.body.logo || !rev.svgSanitised)
      throw new IpbError("IPB-BRD-001", { detail: "a sanitised SVG logo is needed for icon.svg" });
    if (!rev.hosts.length)
      throw new IpbError("IPB-BRD-002", { detail: "the pack needs at least one host" });
    const domain = emailDomain(rev.body);
    if (!domain || !(await this.o.hooks.emailIdentityVerified(ctx, domain)))
      throw new IpbError("IPB-BRD-005", {
        detail: domain ? `${domain} is not verified` : "no email identity set",
      });
    if (
      !rev.body.policy_set_id ||
      !(await this.o.hooks.policySetPublished(ctx, rev.body.policy_set_id))
    )
      throw new IpbError("IPB-BRD-006");
    await this.o.hooks.validateFooter?.(ctx, rev.body);
  }

  private async assertHostsFree(
    tx: Tx,
    packId: string,
    hosts: readonly HostEntry[],
  ): Promise<void> {
    if (!hosts.length) return;
    const r = await tx.query<{ host: string; pack_id: string }>(
      "select host, pack_id from brand.host where host = any($1) and pack_id <> $2",
      [hosts.map((h) => h.host), packId],
    );
    if (r.rows.length)
      throw new IpbError("IPB-BRD-002", {
        detail: r.rows.map((x) => `${x.host} belongs to ${x.pack_id}`).join("; "),
      });
  }

  private async isSanitised(ref: MediaRef): Promise<boolean> {
    try {
      const obj = await this.o.storage.get(ref.key);
      return obj.meta.tags?.[SANITISED_TAG] === "1" && sha256Hex(obj.body) === ref.sha256;
    } catch {
      return false;
    }
  }

  private async recordContrastRejection(
    ctx: KernelContext,
    packId: string,
    guard: ContrastGuardResult,
  ): Promise<void> {
    await this.o.kernel.mutate(
      ctx,
      async (tx) => {
        await this.o.audit.record(tx, {
          action: "brand.contrast.rejected",
          resourceType: "brand_pack",
          resourceId: packId,
          after: { pairs: guard.failures.map((f) => `${f.pair}@${f.scheme}`) },
        });
        if (this.o.outbox)
          await this.o.outbox.publish(tx, "brand", {
            envelope: internalEvent({
              product: this.o.product,
              event: BRAND_EVENTS.ContrastGuardFailed,
              tenantId: tx.ctx.tenantId,
              data: ContrastGuardFailedData.parse({ brd_id: packId, pairs: guard.failures }),
            }),
          });
      },
      { action: "brand.contrast.rejected" },
    );
  }

  private async loadPack(tx: Tx, packId: string): Promise<{ id: string; product: string }> {
    const r = await tx.query<{ id: string; product: string }>(
      "select id, product from brand.pack where id = $1",
      [packId],
    );
    if (!r.rows[0]) throw new NotFoundError("brand pack");
    return r.rows[0];
  }

  private async loadRow(tx: Tx, revisionId: string, lock: boolean): Promise<RevisionRow> {
    const r = await tx.query<RevisionRow>(
      `select * from brand.pack_revision where id = $1${lock ? " for update" : ""}`,
      [revisionId],
    );
    if (!r.rows[0]) throw new NotFoundError("brand pack revision");
    return r.rows[0];
  }

  private async publishedRow(tx: Tx, packId: string): Promise<RevisionRow | null> {
    const r = await tx.query<RevisionRow>(
      "select * from brand.pack_revision where pack_id = $1 and status = 'published'",
      [packId],
    );
    return r.rows[0] ?? null;
  }
}
