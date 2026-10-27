// Resources library (IPB-04 §04.3.6; `@IPB-04-AT-60`, `@IPB-04-AT-61`, `@IPB-04-AT-13`; PL5 plan §5.8).
// A resource is a content item: its revision carries the version and the file, and publishing a
// revision with a new version records it in `cms.resource_version`. The stable URL serves the
// latest version and `?v=` an older one unless withdrawn (`IPB-CMS-041`). Downloads are gated:
//   public       the file directly
//   email_gate   name, work email and consent → CONSENT receipt → CRM lead → a signed URL
//   login, plan  the product's session and entitlement hooks (`IPB-CMS-040` with an upgrade link)
// Gated files are served by STORAGE presign for 300 seconds (IPB-02-15; IPB-04 says 10 minutes). The download record
// keeps the CRM lead reference (#47), never a field value, and emits `ResourceDownloaded`.
import { IpbError } from "@infrabyx/contracts/errors";
import type {
  AuditSink,
  KernelContext,
  MutationKernel,
  OutboxWriter,
} from "@infrabyx/contracts/kernel";
import type { ConsentPort, ConsentRegion, CrmPort, StoragePort } from "@infrabyx/contracts/ports";
import { CMS_EVENTS } from "@infrabyx/contracts";
import { newId } from "@infrabyx/crypto";
import { NotFoundError } from "@infrabyx/tenancy";
import { publicReadContext } from "./public.js";
import { cmsServiceContext, emit, type Deps } from "./repo.js";

/**
 * Gated downloads are served by a signed URL. IPB-04 §04.4.1 says 10 minutes; IPB-02-15 caps every
 * presigned URL at 300 seconds, and the security baseline is the stricter rule (PL5-D-08, PR-035).
 */
export const GATED_URL_TTL_SECONDS = 300;
export const CMS_DOWNLOADS_PRINCIPAL_ID = "svc_cms_downloads";

export interface ResourceVersion {
  version: string;
  publishedAt: string;
  withdrawn: boolean;
  mediaId: string | null;
}

export interface ResourceView {
  id: string;
  title: string;
  path: string;
  gating: "public" | "email_gate" | "login" | "plan";
  current: string;
  versions: ResourceVersion[];
  citeAs: string;
  /** "Under review — may be out of date" once `review_due` has passed (IPB-04-62). */
  reviewBanner: string | null;
}

/** APA-style citation with version and URL (IPB-04-58). */
export function citeAs(o: {
  author: string;
  year: string;
  title: string;
  version: string;
  url: string;
}): string {
  return `${o.author}. (${o.year}). ${o.title} (v${o.version}). ${o.url}`;
}

export interface DownloadRequest {
  packId: string;
  resourceId: string;
  version?: string;
  /** Required for `email_gate`. */
  lead?: { name: string; email: string; consent: boolean; marketingEmail?: boolean; cid?: string };
  region?: ConsentRegion;
  gpc?: boolean;
  pageUrl: string;
  utm?: Partial<Record<"source" | "medium" | "campaign", string>>;
  /** The product's session (for `login`) and entitlement (for `plan`) checks. */
  session?: { authenticated: boolean; entitled?: (featureKey: string) => Promise<boolean> };
}

export interface DownloadResult {
  url: string;
  version: string;
  expiresInSeconds: number | null;
  leadRef: string | null;
}

interface VersionRow {
  version: string;
  published_at: Date;
  withdrawn_at: Date | null;
  media_id: string | null;
}

export class ResourceService {
  private readonly deps: Deps;
  constructor(
    private readonly o: {
      kernel: MutationKernel;
      audit: AuditSink;
      product: string;
      storage: StoragePort;
      crm: CrmPort;
      consent: ConsentPort;
      outbox?: OutboxWriter;
      /** The organisation named in `cite_as` (the pack's legal entity or brand name). */
      author: (packId: string) => Promise<string>;
      base: (packId: string) => Promise<string>;
      /** The consent text version for `consent.resource_gate` (from `@infrabyx/consent`). */
      noticeVersion?: (packId: string) => Promise<string>;
      now?: () => Date;
    },
  ) {
    this.deps = { audit: o.audit, outbox: o.outbox, product: o.product };
  }

  private now(): Date {
    return this.o.now?.() ?? new Date();
  }

  private async load(packId: string, resourceId: string) {
    return this.o.kernel.read(publicReadContext, async (tx) => {
      const r = await tx.query<{
        id: string;
        title: string;
        published_path: string | null;
        published_at: Date | null;
        body: Record<string, unknown>;
      }>(
        `select i.id, i.title, i.published_path, i.published_at, r.body from cms.content_item i
           join cms.revision r on r.id = i.published_revision_id
          where i.id = $1 and i.brand_pack_id = $2 and i.content_type = 'resource' and i.deleted_at is null
            and i.status <> 'archived'`,
        [resourceId, packId],
      );
      if (!r.rows[0]) throw new NotFoundError("resource");
      const v = await tx.query<VersionRow>(
        "select version, published_at, withdrawn_at, media_id from cms.resource_version where content_item_id = $1 order by published_at desc",
        [resourceId],
      );
      return { item: r.rows[0], versions: v.rows };
    });
  }

  /** The resource card and detail data: versions, gating and cite-as (`@IPB-04-AT-60`). */
  async view(packId: string, resourceId: string): Promise<ResourceView> {
    const { item, versions } = await this.load(packId, resourceId);
    const current = String(item.body.version);
    const url = new URL(item.published_path ?? "/", await this.o.base(packId)).toString();
    const due = item.body.review_due as string | undefined;
    return {
      id: item.id,
      title: item.title,
      path: item.published_path ?? "",
      gating: item.body.gating as ResourceView["gating"],
      current,
      versions: versions.map((v) => ({
        version: v.version,
        publishedAt: v.published_at.toISOString(),
        withdrawn: Boolean(v.withdrawn_at),
        mediaId: v.media_id,
      })),
      citeAs:
        (item.body.cite_as as string | undefined) ??
        citeAs({
          author: await this.o.author(packId),
          year: String((item.published_at ?? this.now()).getUTCFullYear()),
          title: item.title,
          version: current,
          url,
        }),
      reviewBanner:
        due && new Date(`${due}T00:00:00+05:30`) <= this.now()
          ? "Under review — may be out of date"
          : null,
    };
  }

  /** Serve a download through its gate (`@IPB-04-AT-61`). */
  async download(req: DownloadRequest): Promise<DownloadResult> {
    const { item, versions } = await this.load(req.packId, req.resourceId);
    const version = req.version ?? String(item.body.version);
    const v = versions.find((x) => x.version === version);
    if (!v) throw new NotFoundError("resource version");
    if (v.withdrawn_at)
      throw new IpbError("IPB-CMS-041", {
        detail: `version ${version} was withdrawn; see the current version`,
      });
    if (!v.media_id) throw new NotFoundError("resource file");
    const gating = item.body.gating as ResourceView["gating"];
    let leadRef: string | null = null;
    let receipt: string | null = null;
    if (gating === "login" && !req.session?.authenticated)
      throw new IpbError("IPB-CMS-040", {
        detail: "log in to download",
        meta: { action: "login" },
      });
    if (gating === "plan" && !(await req.session?.entitled?.(`resource.${item.id}`)))
      throw new IpbError("IPB-CMS-040", {
        detail: "your plan does not include this resource",
        meta: { action: "upgrade", url: "/pricing" },
      });
    if (gating === "email_gate") {
      const lead = req.lead;
      if (!lead?.name.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead.email))
        throw new IpbError("IPB-CMS-040", { detail: "name and work email are needed" });
      if (!lead.consent) throw new IpbError("IPB-WEB-002");
      const noticeVersion = (await this.o.noticeVersion?.(req.packId)) ?? "1.0";
      const purposes = [
        "LEAD_CONTACT",
        ...(lead.marketingEmail ? ["MARKETING_EMAIL" as const] : []),
      ] as ("LEAD_CONTACT" | "MARKETING_EMAIL")[];
      const r = await this.o.consent.recordConsent({
        ...(lead.cid ? { cid: lead.cid } : { principalRef: `lead:${lead.email.toLowerCase()}` }),
        brandPackId: req.packId,
        method: "FORM",
        purposes,
        textKey: "consent.resource_gate",
        textVersion: noticeVersion,
        region: req.region ?? "IN",
        gpc: req.gpc ?? false,
      });
      receipt = r.receiptId;
      leadRef = (
        await this.o.crm.upsertLead({
          source: "RESOURCE_GATE",
          product: this.o.product,
          brandPackId: req.packId,
          fields: { name: lead.name, email: lead.email, resource: item.title },
          consentReceiptId: r.receiptId,
          noticeVersion,
          pageUrl: req.pageUrl,
          interest: item.id,
        })
      ).leadId;
    }
    const media = await this.o.kernel.read(
      publicReadContext,
      async (tx) =>
        (
          await tx.query<{ storage_key: string }>(
            "select storage_key from cms.media where id = $1",
            [v.media_id],
          )
        ).rows[0],
    );
    if (!media) throw new NotFoundError("resource file");
    const url =
      gating === "public"
        ? `/m/${v.media_id}/original`
        : await this.o.storage.presign(media.storage_key, "get", GATED_URL_TTL_SECONDS);
    const utm = Object.fromEntries(
      Object.entries(req.utm ?? {}).filter(([, x]) => typeof x === "string" && x.length <= 100),
    );
    await this.o.kernel.mutate(
      cmsServiceContext(CMS_DOWNLOADS_PRINCIPAL_ID),
      async (tx) => {
        const id = newId("rdl");
        await tx.query(
          `insert into cms.resource_download (id, content_item_id, version, gating, lead_ref, consent_receipt_id, utm)
           values ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
          [id, item.id, version, gating, leadRef, receipt, JSON.stringify(utm)],
        );
        await this.o.audit.record(tx, {
          action: "cms.resource.download",
          resourceType: "cms_content",
          resourceId: item.id,
          after: { version, gating, download_id: id },
        });
        await emit(tx, this.deps, CMS_EVENTS.ResourceDownloaded, {
          resource_id: item.id,
          version,
          gating,
          lead_ref: leadRef,
        });
      },
      { action: "cms.resource.download" },
    );
    return {
      url,
      version,
      expiresInSeconds: gating === "public" ? null : GATED_URL_TTL_SECONDS,
      leadRef,
    };
  }

  /** Withdraw a version (a checker); its `?v=` link answers 410 `IPB-CMS-041`. */
  async withdrawVersion(ctx: KernelContext, resourceId: string, version: string): Promise<void> {
    if (
      ctx.scope !== "platform" ||
      !ctx.principal.roles.some((r) => r === "PLT_CONTENT_EDITOR" || r === "PLT_SUPER_ADMIN")
    )
      throw new IpbError("IPB-UX-011", {
        detail: "withdrawing needs a content editor in the platform context",
      });
    await this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const r = await tx.query(
          `update cms.resource_version set withdrawn_at = now(), withdrawn_by = $3
            where content_item_id = $1 and version = $2 and withdrawn_at is null`,
          [resourceId, version, ctx.principal.id],
        );
        if (!r.rowCount) throw new NotFoundError("resource version");
        await this.o.audit.record(tx, {
          action: "cms.resource.withdraw_version",
          resourceType: "cms_content",
          resourceId,
          after: { version },
        });
      },
      { action: "cms.resource.withdraw_version" },
    );
  }

  /**
   * `ResourceReviewDue` to the owner 30 days before `review_due` (IPB-04-62, `@IPB-04-AT-13`). Run
   * daily: it emits for the resources whose review date is exactly 30 days away.
   */
  async emitReviewDue(now: Date = this.now()): Promise<string[]> {
    const ctx = cmsServiceContext("svc_cms_scheduler");
    const day = (d: Date) => new Date(d.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10);
    const target = day(new Date(now.getTime() + 30 * 86_400_000));
    const due = await this.o.kernel.read(
      ctx,
      async (tx) =>
        (
          await tx.query<{ id: string; owner_user_id: string }>(
            `select i.id, i.owner_user_id from cms.content_item i join cms.revision r on r.id = i.published_revision_id
            where i.content_type = 'resource' and i.deleted_at is null and i.status <> 'archived'
              and r.body->>'review_due' = $1`,
            [target],
          )
        ).rows,
    );
    if (!due.length) return [];
    await this.o.kernel.mutate(
      ctx,
      async (tx) => {
        for (const d of due) {
          await this.o.audit.record(tx, {
            action: "cms.resource.review_due",
            resourceType: "cms_content",
            resourceId: d.id,
            after: { review_due: target },
          });
          await emit(tx, this.deps, CMS_EVENTS.ResourceReviewDue, {
            resource_id: d.id,
            owner_id: d.owner_user_id,
            due: target,
          });
        }
      },
      { action: "cms.resource.review_due" },
    );
    return due.map((d) => d.id);
  }
}
