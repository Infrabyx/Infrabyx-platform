// The tenant brand layer service (LawDocsComply PR-LDC-26; R1-D-87, M57). A tenant's ORG_ADMIN or
// ORG_OWNER proposes a layer over its product's pack; a tenant checker approves it through the
// approvals engine (`brand.tenant_layer.change`, R3), and the executor applies it with an audit
// ledger entry in the same transaction. Every value passes the guards a pack publish uses, at the
// proposal and again when it is applied: the contrast guard on the resulting colour set, the SVG
// sanitiser, a verified email domain, and host uniqueness across pack hosts and tenant domains.
//   propose ──▶ pending_approval ──approve──▶ active (the previous one superseded)
//   revert(to) ──▶ a new version with that body ──approve──▶ active
import { IpbError } from "@infrabyx/contracts/errors";
import { PLATFORM_TENANT_ID } from "@infrabyx/contracts/ids";
import type { AuditSink, KernelContext, MutationKernel, Tx } from "@infrabyx/contracts/kernel";
import type { StoragePort } from "@infrabyx/contracts/ports";
import { storageKey } from "@infrabyx/contracts/ports";
import { canonicalDigest, sha256Hex, ulid } from "@infrabyx/crypto";
import {
  ConflictError,
  isAgentPrincipal,
  NotFoundError,
  type ApprovalRecord,
  type ApprovalsEngine,
} from "@infrabyx/tenancy";
import type { Product } from "@infrabyx/ui/tokens";
import { contrastGuard, contrastMessage, type ContrastGuardResult } from "./contrast.js";
import { faviconSet, type FaviconSet } from "./favicon.js";
import { normaliseHost, resolveHost, type HostResolution } from "./hosts.js";
import { rasteriseFavicons, type RasteriseOptions } from "./raster.js";
import { BrandPackBody, type BrandProduct, type MediaRef } from "./shape.js";
import { loadHostMap, type LogoPngs } from "./studio.js";
import { sanitiseSvg } from "./svg.js";
import {
  applyTenantLayer,
  layerColours,
  layerEmailDomain,
  layerFields,
  TenantLayerBody,
  type TenantLayerBodyInput,
} from "./tenant-shape.js";

export const TENANT_LAYER_ACTION = "brand.tenant_layer.change";
/** Outward identity (sender, domain, logo) changes: R3, maker-checker locked (R1-D-90). */
export const TENANT_LAYER_RISK = "R3" as const;
export const TENANT_LAYER_MAKERS = ["ORG_ADMIN", "ORG_OWNER"] as const;
const SANITISED_TAG = "ipb_svg_sanitised";
const LETTERHEAD_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/svg+xml"];

export type TenantLayerStatus = "pending_approval" | "active" | "superseded" | "withdrawn";

export interface TenantLayerVersion {
  tenantId: string;
  version: number;
  packId: string;
  body: TenantLayerBody;
  domain: string | null;
  status: TenantLayerStatus;
  approvalId: string | null;
  revertOf: number | null;
  makerId: string;
  createdAt: Date;
  activatedAt: Date | null;
}

/** The pack served with the tenant layer applied. */
export interface AppliedBrand {
  packId: string;
  revisionId: string;
  tenantId: string | null;
  layerVersion: number | null;
  /** The pack body with the layer's colours, logo and email identity. */
  body: BrandPackBody;
  favicon: MediaRef | null;
  letterhead: MediaRef | null;
  loginMessage: string | null;
  domain: string | null;
  /** The guard on the colour set served (re-run at every resolution). */
  contrast: ContrastGuardResult;
  /**
   * `tenant_colours_dropped`: the pack changed and the layer's colours no longer pass the guard,
   * so the pack's colours are served until the tenant changes them.
   */
  events: { code: "tenant_colours_dropped"; detail: string }[];
}

export interface TenantBrandLayerHooks {
  /** NOTIFY: SPF, DKIM and DMARC verified for the sending domain (IPB-04-28), as for a pack. */
  emailIdentityVerified(ctx: KernelContext, domain: string): Promise<boolean>;
  /**
   * EDGE: the tenant proved control of the domain (IPB-01 EDGE `verifyDomain`). Omitted or false,
   * the domain is recorded unverified and never selects the layer, as for an unverified pack host.
   */
  domainVerified?(ctx: KernelContext, host: string): Promise<boolean>;
  /** The tenant's plan allows a brand layer (white-label); omitted means allowed. */
  enabled?(ctx: KernelContext): Promise<boolean>;
}

export interface TenantBrandLayerOptions extends RasteriseOptions {
  kernel: MutationKernel;
  audit: AuditSink;
  approvals: ApprovalsEngine;
  storage: StoragePort;
  /** The product whose default pack the layer is over (unless the proposal names another). */
  brandProduct: BrandProduct;
  hooks: TenantBrandLayerHooks;
  /** `brand.contrast.min_text` and `brand.contrast.min_ui` (raise only), as for a pack. */
  contrastMinimums?: (ctx: KernelContext) => Promise<{ minText?: number; minUi?: number }>;
  /** A host-resolution signal (unknown host, forwarded-host mismatch) for the security log. */
  onHostEvent?(event: HostResolution["events"][number]): void;
}

interface VersionRow {
  tenant_id: string;
  version: number;
  pack_id: string;
  body: TenantLayerBody;
  digest: string;
  domain: string | null;
  status: TenantLayerStatus;
  approval_id: string | null;
  revert_of: number | null;
  maker_id: string;
  created_at: Date;
  activated_at: Date | null;
}

const toVersion = (r: VersionRow): TenantLayerVersion => ({
  tenantId: r.tenant_id,
  version: r.version,
  packId: r.pack_id,
  body: r.body,
  domain: r.domain,
  status: r.status,
  approvalId: r.approval_id,
  revertOf: r.revert_of,
  makerId: r.maker_id,
  createdAt: r.created_at,
  activatedAt: r.activated_at,
});

interface PackRow {
  id: string;
  product: string;
  revision_id: string;
  body: BrandPackBody;
}

const digestOf = (packId: string, body: TenantLayerBody) => canonicalDigest({ packId, body });

export class TenantBrandLayers {
  constructor(private readonly o: TenantBrandLayerOptions) {
    // Default tenant checkers (ORG_CHECKER, ORG_ADMIN, ORG_OWNER); never the maker (IPB-SEC-007).
    o.approvals.register(TENANT_LAYER_ACTION, {
      execute: (tx, payload, request) => this.executeChange(tx, payload, request),
    });
  }

  /** A tenant context, an ORG_ADMIN or ORG_OWNER, never an agent, on a plan that allows it. */
  private async assertMaker(ctx: KernelContext): Promise<void> {
    if (ctx.scope === "platform" || ctx.tenantId === PLATFORM_TENANT_ID)
      throw new IpbError("IPB-UX-011", { detail: "a tenant brand layer is set in its tenant" });
    if (isAgentPrincipal(ctx))
      throw new IpbError("IPB-SEC-004", { detail: "an agent never changes a tenant's brand" });
    if (!ctx.principal.roles.some((r) => (TENANT_LAYER_MAKERS as readonly string[]).includes(r)))
      throw new IpbError("IPB-UX-011", {
        detail: `a tenant brand layer is changed by ${TENANT_LAYER_MAKERS.join(" or ")}`,
      });
    if (this.o.hooks.enabled && !(await this.o.hooks.enabled(ctx)))
      throw new IpbError("IPB-UX-011", { detail: "the tenant's plan has no brand layer" });
  }

  /**
   * Sanitise an uploaded SVG (logo, favicon or letterhead) and store only the result under the
   * tenant's own key, with the PNG favicon sizes when a MEDIA port can rasterise (#53).
   */
  async uploadSvg(
    ctx: KernelContext,
    upload: string | Uint8Array,
  ): Promise<{ ref: MediaRef; removed: string[]; png: LogoPngs }> {
    await this.assertMaker(ctx);
    const { svg, removed } = sanitiseSvg(upload);
    const bytes = new TextEncoder().encode(svg);
    const sha256 = sha256Hex(bytes);
    const key = storageKey(ctx.tenantId, "brand", ulid(), "svg");
    const pngs = await rasteriseFavicons(this.o, ctx, svg);
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        await this.o.storage.put(key, bytes, {
          contentType: "image/svg+xml",
          bucketClass: "PUBLIC_ASSETS",
          sha256,
          tags: { [SANITISED_TAG]: "1", tenant_layer: "1" },
        });
        const png: LogoPngs = {};
        for (const p of pngs) {
          const pKey = storageKey(ctx.tenantId, "brand", ulid(), "png");
          const pSha = sha256Hex(p.bytes);
          await this.o.storage.put(pKey, p.bytes, {
            contentType: "image/png",
            bucketClass: "PUBLIC_ASSETS",
            sha256: pSha,
            tags: { tenant_layer: "1", favicon: String(p.size) },
          });
          png[String(p.size) as keyof LogoPngs] = {
            key: pKey,
            sha256: pSha,
            content_type: "image/png",
          };
        }
        await this.o.audit.record(tx, {
          action: "brand.tenant_layer.upload",
          resourceType: "brand_tenant_layer",
          resourceId: ctx.tenantId,
          after: { key, sha256, removed: removed.length, png: Object.keys(png) },
        });
        return { ref: { key, sha256, content_type: "image/svg+xml" }, removed, png };
      },
      { action: "brand.tenant_layer.upload" },
    );
  }

  /**
   * Every guard a pack publish uses, on a layer over `pack` for `ctx`'s tenant: contrast on the
   * resulting colour set (`IPB-BRD-003`), sanitised SVGs in the tenant's own storage
   * (`IPB-BRD-001`; another tenant's or a missing object is `IPB-STOR-001`), the letterhead's type
   * (`IPB-SEC-010`), a verified email domain (`IPB-BRD-005`) and the domain's format. Host
   * uniqueness needs the database and is checked in the transaction (`IPB-BRD-002`).
   */
  async check(
    ctx: KernelContext,
    pack: { product: string; body: BrandPackBody },
    input: TenantLayerBodyInput | TenantLayerBody,
  ): Promise<TenantLayerBody> {
    const layer = TenantLayerBody.parse(input);
    const guard = contrastGuard(
      pack.product as Product,
      layerColours(pack.body.tokens.colour, layer),
      (await this.o.contrastMinimums?.(ctx)) ?? {},
    );
    if (!guard.passed)
      throw new IpbError("IPB-BRD-003", {
        detail: contrastMessage(guard.failures[0]!),
        meta: { pairs: guard.failures },
      });
    if (layer.logo) {
      await this.assertSanitisedSvg(ctx, layer.logo.svg, "logo");
      if (layer.logo.dark_variant)
        await this.assertSanitisedSvg(ctx, layer.logo.dark_variant, "dark logo");
      for (const ref of Object.values(layer.logo.png))
        await this.assertAsset(ctx, ref, ["image/png"]);
    }
    if (layer.favicon) await this.assertSanitisedSvg(ctx, layer.favicon, "favicon");
    if (layer.letterhead) {
      if (layer.letterhead.content_type === "image/svg+xml")
        await this.assertSanitisedSvg(ctx, layer.letterhead, "letterhead");
      else await this.assertAsset(ctx, layer.letterhead, LETTERHEAD_TYPES);
    }
    const domain = layerEmailDomain(layer);
    if (domain && !(await this.o.hooks.emailIdentityVerified(ctx, domain)))
      throw new IpbError("IPB-BRD-005", { detail: `${domain} is not verified` });
    if (layer.domain && normaliseHost(layer.domain) !== layer.domain)
      throw new IpbError("IPB-BRD-002", { detail: `${layer.domain} is not a host name` });
    return layer;
  }

  /**
   * Propose a layer: an R3 approval request whose executor applies it. Refused when a guard fails,
   * when the domain is already a pack host or another tenant's domain, or while another change is
   * pending. `packId` names the base pack (a published pack of the product; default its default).
   */
  async propose(
    ctx: KernelContext,
    input: TenantLayerBodyInput,
    o: { packId?: string; revertOf?: number } = {},
  ): Promise<{ approvalId: string; version: number }> {
    await this.assertMaker(ctx);
    const pack = await this.o.kernel.read(ctx, (tx) => this.basePack(tx, o.packId));
    const layer = await this.check(ctx, pack, input);
    const stale = await this.stalePending(ctx);
    const digest = digestOf(pack.id, layer);
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        if (stale)
          await tx.query(
            `update brand.tenant_layer_version set status = 'withdrawn'
              where tenant_id = $1 and version = $2 and status = 'pending_approval'`,
            [ctx.tenantId, stale],
          );
        const prev = await this.activeRow(tx);
        const max = await tx.query<{ v: number | null }>(
          "select max(version) as v from brand.tenant_layer_version where tenant_id = $1",
          [ctx.tenantId],
        );
        const version = (max.rows[0]?.v ?? 0) + 1;
        await tx.query(
          `insert into brand.tenant_layer_version
             (tenant_id, version, pack_id, body, digest, domain, revert_of, maker_id)
           values ($1, $2, $3, $4::jsonb, $5, $6, $7, $8)`,
          [
            ctx.tenantId,
            version,
            pack.id,
            JSON.stringify(layer),
            digest,
            layer.domain ?? null,
            o.revertOf ?? null,
            ctx.principal.id,
          ],
        );
        if (layer.domain) await this.assertHostFree(tx, layer.domain, version, pack.id, true);
        const fields = layerFields(layer);
        const { id } = await this.o.approvals.request(tx, {
          action: TENANT_LAYER_ACTION,
          riskClass: TENANT_LAYER_RISK,
          payload: { tenantId: ctx.tenantId, version, digest },
          payloadDataClass: "INTERNAL",
          summary: `${o.revertOf ? `Revert the brand layer to version ${o.revertOf}` : "Change the brand layer"}: ${fields.join(", ") || "clear every field"}`,
          diff: { before: prev ? { ...prev.body } : null, after: { ...layer } },
        });
        await tx.query(
          "update brand.tenant_layer_version set approval_id = $3 where tenant_id = $1 and version = $2",
          [ctx.tenantId, version, id],
        );
        await this.o.audit.record(tx, {
          action: "brand.tenant_layer.propose",
          resourceType: "brand_tenant_layer",
          resourceId: ctx.tenantId,
          before: { version: prev?.version ?? null },
          after: {
            version,
            pack_id: pack.id,
            fields,
            domain: layer.domain ?? null,
            approval_id: id,
            revert_of: o.revertOf ?? null,
          },
        });
        return { approvalId: id, version };
      },
      { action: "brand.tenant_layer.propose" },
    );
  }

  /** Propose an earlier version's layer again, under the same guards and maker-checker. */
  async revert(
    ctx: KernelContext,
    toVersion: number,
  ): Promise<{ approvalId: string; version: number }> {
    await this.assertMaker(ctx);
    const target = await this.o.kernel.read(ctx, (tx) => this.loadRow(tx, toVersion, false));
    if (!["active", "superseded"].includes(target.status))
      throw new IpbError("IPB-UX-011", { detail: "a revert targets an applied version" });
    if (target.status === "active")
      throw new IpbError("IPB-UX-011", { detail: "that version is applied already" });
    return this.propose(ctx, target.body, { packId: target.pack_id, revertOf: toVersion });
  }

  /** The applied layer of `ctx`'s tenant, or null. */
  async current(ctx: KernelContext): Promise<TenantLayerVersion | null> {
    return this.o.kernel.read(ctx, async (tx) => {
      const r = await this.activeRow(tx);
      return r ? toVersion(r) : null;
    });
  }

  /** The tenant's versions, newest first (the history and the revert targets). */
  async history(ctx: KernelContext): Promise<TenantLayerVersion[]> {
    return this.o.kernel.read(ctx, async (tx) => {
      const r = await tx.query<VersionRow>(
        "select * from brand.tenant_layer_version where tenant_id = $1 order by version desc limit 100",
        [ctx.tenantId],
      );
      return r.rows.map(toVersion);
    });
  }

  /**
   * The pack for `ctx`'s tenant with its applied layer (the product default pack and no layer
   * when none is applied). The contrast guard runs again on the colour set served: when the pack
   * changed and the layer's colours no longer pass, the pack's colours are served instead.
   */
  async resolveForTenant(ctx: KernelContext): Promise<AppliedBrand> {
    const { pack, row } = await this.o.kernel.read(ctx, async (tx) => {
      const row = ctx.tenantId === PLATFORM_TENANT_ID ? null : await this.activeRow(tx);
      return { pack: await this.basePack(tx, row?.pack_id), row };
    });
    const min = (await this.o.contrastMinimums?.(ctx)) ?? {};
    const layer = row?.body ?? null;
    const events: AppliedBrand["events"] = [];
    let colours = layerColours(pack.body.tokens.colour, layer);
    let contrast = contrastGuard(pack.product as Product, colours, min);
    if (!contrast.passed && layer?.colour) {
      events.push({
        code: "tenant_colours_dropped",
        detail: `layer version ${row!.version}: ${contrastMessage(contrast.failures[0]!)}`,
      });
      colours = pack.body.tokens.colour;
      contrast = contrastGuard(pack.product as Product, colours, min);
    }
    return {
      packId: pack.id,
      revisionId: pack.revision_id,
      tenantId: row ? row.tenant_id : null,
      layerVersion: row?.version ?? null,
      body: applyTenantLayer(pack.body, layer, { colours: events.length === 0 }),
      favicon: layer?.favicon ?? null,
      letterhead: layer?.letterhead ?? null,
      loginMessage: layer?.login_message ?? null,
      domain: layer?.domain ?? null,
      contrast,
      events,
    };
  }

  /**
   * Resolve a request by its `Host` header (never `X-Forwarded-Host`), in a context of the
   * platform tenant (the host resolver runs before any tenant is known): a verified tenant domain
   * gives that tenant's pack with its layer, read in that tenant's context; a pack host gives the
   * pack; an unknown host the product default with `noindex` (`IPB-BRD-007`).
   */
  async resolveHost(
    ctx: KernelContext,
    headers: { host: string | null | undefined; forwardedHost?: string | null | undefined },
  ): Promise<{ resolution: HostResolution; brand: AppliedBrand | null }> {
    const { map, fallback } = await this.o.kernel.read(ctx, (tx) =>
      loadHostMap(tx, this.o.brandProduct),
    );
    if (!fallback) throw new NotFoundError("published default brand pack");
    const resolution = resolveHost(map, fallback, headers);
    for (const e of resolution.events) this.o.onHostEvent?.(e);
    if (!resolution.tenantId) return { resolution, brand: null };
    const tenantCtx: KernelContext = {
      tenantId: resolution.tenantId,
      principal: ctx.principal,
      ...(ctx.traceId ? { traceId: ctx.traceId } : {}),
    };
    return { resolution, brand: await this.resolveForTenant(tenantCtx) };
  }

  /** The favicon set of an applied brand: the tenant's favicon or logo, else the pack's logo. */
  async favicons(applied: AppliedBrand): Promise<FaviconSet> {
    const ref = applied.favicon ?? applied.body.logo?.svg ?? null;
    const svg = ref ? new TextDecoder().decode((await this.o.storage.get(ref.key)).body) : null;
    return faviconSet(applied.body, svg, applied.contrast.previews.light.colours.primary);
  }

  /** The approved request's executor: guards again, then apply and ledger in this transaction. */
  private async executeChange(
    tx: Tx,
    payload: Record<string, unknown>,
    request: ApprovalRecord,
  ): Promise<void> {
    const ctx = tx.ctx;
    if (payload.tenantId !== ctx.tenantId)
      throw new IpbError("IPB-UX-011", { detail: "the change belongs to another tenant" });
    const row = await this.loadRow(tx, Number(payload.version), true);
    if (
      row.status !== "pending_approval" ||
      row.approval_id !== request.id ||
      row.digest !== payload.digest ||
      digestOf(row.pack_id, row.body) !== row.digest
    )
      throw new ConflictError("the tenant brand layer no longer matches the approved request");
    const pack = await this.basePack(tx, row.pack_id);
    const layer = await this.check(ctx, pack, row.body);
    const prev = await this.activeRow(tx);
    if (prev)
      await tx.query(
        `update brand.tenant_layer_version set status = 'superseded'
          where tenant_id = $1 and version = $2`,
        [ctx.tenantId, prev.version],
      );
    await tx.query(
      `update brand.tenant_layer_version set status = 'active', activated_at = now()
        where tenant_id = $1 and version = $2`,
      [ctx.tenantId, row.version],
    );
    await tx.query("delete from brand.tenant_host where tenant_id = $1", [ctx.tenantId]);
    let verified = false;
    if (layer.domain) {
      verified = (await this.o.hooks.domainVerified?.(ctx, layer.domain)) ?? false;
      await this.assertHostFree(tx, layer.domain, row.version, pack.id, false, verified);
    }
    await this.o.audit.record(tx, {
      action: row.revert_of ? "brand.tenant_layer.revert" : "brand.tenant_layer.apply",
      resourceType: "brand_tenant_layer",
      resourceId: ctx.tenantId,
      before: { version: prev?.version ?? null, domain: prev?.domain ?? null },
      after: {
        version: row.version,
        pack_id: pack.id,
        fields: layerFields(layer),
        domain: layer.domain ?? null,
        domain_verified: verified,
        approval_id: request.id,
        revert_of: row.revert_of,
      },
    });
  }

  /**
   * Refuse a host that is a pack host or another tenant's domain (`IPB-BRD-002`). A tenant cannot
   * read another tenant's domains, so the claim is tried: `on conflict do nothing` sees every row
   * whatever the policies. With `probe` the claim is removed again (the proposal); otherwise it
   * stays (the executor), in the transaction that applies the layer.
   */
  private async assertHostFree(
    tx: Tx,
    host: string,
    version: number,
    packId: string,
    probe: boolean,
    verified = false,
  ): Promise<void> {
    const pack = await tx.query("select 1 from brand.host where host = $1", [host]);
    if (pack.rows.length)
      throw new IpbError("IPB-BRD-002", { detail: `${host} is mapped to a brand pack` });
    const own = await tx.query(
      "select 1 from brand.tenant_host where host = $1 and tenant_id = $2",
      [host, tx.ctx.tenantId],
    );
    if (own.rows.length && probe) return;
    const claimed = await tx.query(
      `insert into brand.tenant_host (host, tenant_id, version, pack_id, verified)
       values ($1, $2, $3, $4, $5) on conflict (host) do nothing returning host`,
      [host, tx.ctx.tenantId, version, packId, verified],
    );
    if (!claimed.rows.length)
      throw new IpbError("IPB-BRD-002", { detail: `${host} is another tenant's domain` });
    if (probe)
      await tx.query("delete from brand.tenant_host where host = $1 and tenant_id = $2", [
        host,
        tx.ctx.tenantId,
      ]);
  }

  /** A pending version whose request was rejected, cancelled or expired, or null; refused while one is live. */
  private async stalePending(ctx: KernelContext): Promise<number | null> {
    const pending = await this.o.kernel.read(ctx, async (tx) => {
      const r = await tx.query<VersionRow>(
        "select * from brand.tenant_layer_version where tenant_id = $1 and status = 'pending_approval'",
        [ctx.tenantId],
      );
      return r.rows[0] ?? null;
    });
    if (!pending) return null;
    const state = pending.approval_id
      ? (await this.o.approvals.get(ctx, pending.approval_id)).state
      : "cancelled";
    if (!["rejected", "cancelled", "expired"].includes(state))
      throw new ConflictError(
        `brand layer version ${pending.version} is waiting for approval (${pending.approval_id})`,
      );
    return pending.version;
  }

  private async assertSanitisedSvg(ctx: KernelContext, ref: MediaRef, what: string): Promise<void> {
    if (ref.content_type !== "image/svg+xml")
      throw new IpbError("IPB-BRD-001", { detail: `the ${what} is an SVG` });
    const obj = await this.ownObject(ctx, ref);
    if (obj.meta.tags?.[SANITISED_TAG] !== "1")
      throw new IpbError("IPB-BRD-001", {
        detail: `the ${what} was not stored through the SVG sanitiser`,
      });
  }

  private async assertAsset(
    ctx: KernelContext,
    ref: MediaRef,
    types: readonly string[],
  ): Promise<void> {
    if (!types.includes(ref.content_type))
      throw new IpbError("IPB-SEC-010", {
        detail: `${ref.content_type} is not one of ${types.join(", ")}`,
      });
    const obj = await this.ownObject(ctx, ref);
    if (obj.meta.contentType && obj.meta.contentType !== ref.content_type)
      throw new IpbError("IPB-SEC-010", { detail: "the stored type differs from the reference" });
  }

  /** The object under the tenant's own key with the referenced checksum (`IPB-STOR-001` otherwise). */
  private async ownObject(ctx: KernelContext, ref: MediaRef) {
    const notFound = () =>
      new IpbError("IPB-STOR-001", { detail: "the asset is not in this tenant's storage" });
    if (!ref.key.startsWith(`tenant/${ctx.tenantId}/`)) throw notFound();
    let obj;
    try {
      obj = await this.o.storage.get(ref.key);
    } catch {
      throw notFound();
    }
    if (sha256Hex(obj.body) !== ref.sha256) throw notFound();
    return obj;
  }

  /** The base pack: a published pack of the product (its default when none is named). */
  private async basePack(tx: Tx, packId?: string): Promise<PackRow> {
    const r = await tx.query<PackRow>(
      `select p.id, p.product, r.id as revision_id, r.body
         from brand.pack p join brand.pack_revision r on r.id = p.published_revision_id
        where p.status = 'published' and p.product = $1
          and (($2::text is null and p.is_default) or p.id = $2)`,
      [this.o.brandProduct, packId ?? null],
    );
    if (!r.rows[0]) throw new NotFoundError("published brand pack of this product");
    return { ...r.rows[0], body: BrandPackBody.parse(r.rows[0].body) };
  }

  private async activeRow(tx: Tx): Promise<VersionRow | null> {
    const r = await tx.query<VersionRow>(
      "select * from brand.tenant_layer_version where tenant_id = $1 and status = 'active'",
      [tx.ctx.tenantId],
    );
    return r.rows[0] ?? null;
  }

  private async loadRow(tx: Tx, version: number, lock: boolean): Promise<VersionRow> {
    const r = await tx.query<VersionRow>(
      `select * from brand.tenant_layer_version where tenant_id = $1 and version = $2${lock ? " for update" : ""}`,
      [tx.ctx.tenantId, version],
    );
    if (!r.rows[0]) throw new NotFoundError("tenant brand layer version");
    return r.rows[0];
  }
}
