// The soft-delete purge (OWNER-QUESTIONS #48, PL5-D-05: soft-deleted CMS content is deleted 90 days
// after its soft delete; the owner's approval of this deletion). Run `sweep()` daily from one worker.
// Each batch is one transaction: the item's preview tokens, approvals and revisions, then the item;
// redirects and media past the period; one ledger entry per sweep batch with the counts and the
// ids. PostgreSQL refuses any delete outside the 90-day rule (migration `cms/0001`), whatever the
// caller. A media file leaves storage only when no remaining media row uses its key.
import type { AuditSink, MutationKernel } from "@infrabyx/contracts/kernel";
import type { StoragePort } from "@infrabyx/contracts/ports";
import { cmsServiceContext } from "./repo.js";

export const CMS_PURGE_DAYS = 90;
export const CMS_PURGE_PRINCIPAL_ID = "svc_cms_purge";

export interface PurgeResult {
  items: string[];
  revisions: number;
  redirects: string[];
  media: string[];
}

export class CmsPurge {
  constructor(
    private readonly o: { kernel: MutationKernel; audit: AuditSink; storage?: StoragePort },
  ) {}

  async sweep(o: { batch?: number } = {}): Promise<PurgeResult> {
    const batch = Math.min(o.batch ?? 200, 1000);
    const ctx = cmsServiceContext(CMS_PURGE_PRINCIPAL_ID);
    const cutoff = `now() - interval '${CMS_PURGE_DAYS} days'`;
    const result: PurgeResult = { items: [], revisions: 0, redirects: [], media: [] };
    const storageKeys: string[] = [];
    // A sweep with nothing due writes nothing (the kernel refuses a mutation without a ledger entry).
    const due = await this.o.kernel.read(
      ctx,
      async (tx) =>
        (
          await tx.query(
            `select 1 from cms.content_item where deleted_at < ${cutoff}
           union all select 1 from cms.redirect where deleted_at < ${cutoff}
           union all select 1 from cms.media where deleted_at < ${cutoff} limit 1`,
          )
        ).rowCount,
    );
    if (!due) return result;
    await this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const items = (
          await tx.query<{ id: string }>(
            `select id from cms.content_item where deleted_at < ${cutoff} order by deleted_at limit $1 for update`,
            [batch],
          )
        ).rows.map((r) => r.id);
        if (items.length) {
          await tx.query("delete from cms.preview_token where content_item_id = any($1)", [items]);
          await tx.query("delete from cms.approval where content_item_id = any($1)", [items]);
          await tx.query("delete from cms.resource_version where content_item_id = any($1)", [
            items,
          ]);
          const revs = await tx.query("delete from cms.revision where content_item_id = any($1)", [
            items,
          ]);
          result.revisions = revs.rowCount ?? 0;
          const del = await tx.query<{ id: string }>(
            "delete from cms.content_item where id = any($1) returning id",
            [items],
          );
          result.items = del.rows.map((r) => r.id);
        }
        result.redirects = (
          await tx.query<{ id: string }>(
            `delete from cms.redirect where id in (select id from cms.redirect where deleted_at < ${cutoff} limit $1) returning id`,
            [batch],
          )
        ).rows.map((r) => r.id);
        const media = await tx.query<{ id: string; storage_key: string }>(
          `delete from cms.media where id in (select id from cms.media where deleted_at < ${cutoff} limit $1)
           returning id, storage_key`,
          [batch],
        );
        result.media = media.rows.map((r) => r.id);
        for (const m of media.rows) {
          const still = await tx.query("select 1 from cms.media where storage_key = $1", [
            m.storage_key,
          ]);
          if (!still.rowCount) storageKeys.push(m.storage_key);
        }
        if (result.items.length || result.redirects.length || result.media.length)
          await this.o.audit.record(tx, {
            action: "cms.purge.sweep",
            resourceType: "cms",
            resourceId: "soft_deleted",
            after: {
              period_days: CMS_PURGE_DAYS,
              items: result.items,
              revisions: result.revisions,
              redirects: result.redirects,
              media: result.media,
            },
          });
      },
      { action: "cms.purge.sweep" },
    );
    // After commit: the files of purged media that no remaining row uses.
    for (const key of storageKeys) await this.o.storage?.delete(key);
    return result;
  }
}
