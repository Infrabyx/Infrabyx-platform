// The publish scheduler (IPB-04-04, `@IPB-04-AT-04`, `@IPB-04-AT-101`; PL5 plan §5.3). Run `tick()`
// once a minute from one worker. An item whose `publish_at` has passed is published only if it is
// still `scheduled` and its scheduled revision is the approved one (optimistic lock); otherwise the
// run is skipped and the skip is ledgered ("skipped: not scheduled"), and nothing unapproved is
// served. Due `unpublish_at` archives the item with a 410. Content is platform rows, so the
// scheduler reads in a platform service context; no cross-tenant reader is involved.
import type { AuditSink, MutationKernel, OutboxWriter } from "@infrabyx/contracts/kernel";
import {
  cmsServiceContext,
  loadItem,
  publishInTx,
  unpublishInTx,
  type Deps,
  type ItemRow,
} from "./repo.js";

export const CMS_SCHEDULER_PRINCIPAL_ID = "svc_cms_scheduler";

export interface SchedulerResult {
  published: string[];
  skipped: string[];
  unpublished: string[];
}

export class CmsScheduler {
  private readonly deps: Deps;
  constructor(
    private readonly o: {
      kernel: MutationKernel;
      audit: AuditSink;
      product: string;
      outbox?: OutboxWriter;
      /** Revalidation after commit (routes, sitemap, feeds, llms.txt). */
      onPublished?: (n: {
        itemId: string;
        packId: string;
        routes: string[];
      }) => Promise<void> | void;
      /** IndexNow per pack (`web.seo.indexnow.enabled`); the adapter is `none`. */
      indexNowEnabled?: (packId: string) => Promise<boolean>;
    },
  ) {
    this.deps = { audit: o.audit, outbox: o.outbox, product: o.product };
  }

  async tick(now: Date = new Date()): Promise<SchedulerResult> {
    const ctx = cmsServiceContext(CMS_SCHEDULER_PRINCIPAL_ID);
    const out: SchedulerResult = { published: [], skipped: [], unpublished: [] };
    const due = await this.o.kernel.read(ctx, async (tx) =>
      (
        await tx.query<{ id: string }>(
          `select id from cms.content_item where deleted_at is null and publish_at is not null and publish_at <= $1
            order by publish_at limit 200`,
          [now],
        )
      ).rows.map((r) => r.id),
    );
    for (const id of due) {
      const r = await this.o.kernel.mutate(
        ctx,
        async (tx) => {
          const item = await loadItem(tx, id, true);
          if (!item.publish_at || item.publish_at > now) return null;
          const ok =
            item.status === "scheduled" &&
            item.scheduled_revision_id !== null &&
            item.scheduled_revision_id === item.approved_revision_id;
          if (!ok) {
            await tx.query(
              "update cms.content_item set publish_at = null, updated_at = now() where id = $1",
              [id],
            );
            await this.o.audit.record(tx, {
              action: "cms.schedule.skip",
              resourceType: "cms_content",
              resourceId: id,
              after: {
                reason: "skipped: not scheduled",
                status: item.status,
                publish_at: item.publish_at.toISOString(),
              },
            });
            return { kind: "skipped" as const, item };
          }
          const done = await publishInTx(
            tx,
            this.deps,
            item,
            item.scheduled_revision_id!,
            "publish_due",
          );
          if (done.routes.length && (await this.o.indexNowEnabled?.(item.brand_pack_id)))
            await this.o.audit.record(tx, {
              action: "cms.indexnow.push",
              resourceType: "brand_pack",
              resourceId: item.brand_pack_id,
              after: { adapter: "none", urls: done.routes },
            });
          return { kind: "published" as const, item, routes: done.routes };
        },
        { action: "cms.schedule.publish" },
      );
      if (!r) continue;
      if (r.kind === "skipped") out.skipped.push(id);
      else {
        out.published.push(id);
        await this.o.onPublished?.({ itemId: id, packId: r.item.brand_pack_id, routes: r.routes });
      }
    }
    const ending = await this.o.kernel.read(
      ctx,
      async (tx) =>
        (
          await tx.query<ItemRow>(
            `select * from cms.content_item where deleted_at is null and status = 'published'
             and unpublish_at is not null and unpublish_at <= $1 limit 200`,
            [now],
          )
        ).rows,
    );
    for (const row of ending) {
      await this.o.kernel.mutate(
        ctx,
        async (tx) => {
          const item = await loadItem(tx, row.id, true);
          if (item.status !== "published" || !item.unpublish_at || item.unpublish_at > now) return;
          await unpublishInTx(tx, this.deps, item, {
            behaviour: "gone",
            reason: "scheduled_unpublish",
          });
        },
        { action: "cms.schedule.unpublish" },
      );
      out.unpublished.push(row.id);
      if (row.published_path)
        await this.o.onPublished?.({
          itemId: row.id,
          packId: row.brand_pack_id,
          routes: [row.published_path],
        });
    }
    return out;
  }
}
