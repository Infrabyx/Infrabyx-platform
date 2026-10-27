// Row shapes and transaction helpers shared by the Studio, the scheduler, the public reader and
// the purge. Every write here runs inside a caller's `kernel.mutate`, next to its ledger entry.
import { IpbError } from "@infrabyx/contracts/errors";
import { PLATFORM_TENANT_ID } from "@infrabyx/contracts/ids";
import type { AuditSink, KernelContext, OutboxWriter, Tx } from "@infrabyx/contracts/kernel";
import {
  CMS_EVENTS,
  ContentPublishedData,
  ContentUnpublishedData,
  RedirectChangedData,
  RollbackPerformedData,
} from "@infrabyx/contracts";
import { internalEvent } from "@infrabyx/config/events";
import { newId } from "@infrabyx/crypto";
import { NotFoundError } from "@infrabyx/tenancy";
import { normalisePath, repointed, type RedirectRule } from "./redirects.js";
import type { ContentState } from "./state.js";
import { routeFor, type ContentType } from "./types.js";

export interface ItemRow {
  id: string;
  brand_pack_id: string;
  content_type: ContentType;
  locale: string;
  translation_group_id: string;
  slug: string | null;
  parent_id: string | null;
  template: string | null;
  title: string;
  status: ContentState;
  current_revision_id: string;
  approved_revision_id: string | null;
  scheduled_revision_id: string | null;
  published_revision_id: string | null;
  published_slug: string | null;
  published_path: string | null;
  published_at: Date | null;
  publish_at: Date | null;
  unpublish_at: Date | null;
  needs_legal: boolean;
  legal_review_status: "not_required" | "pending" | "approved";
  machine_translated: boolean;
  retired_behaviour: "gone" | "redirect" | null;
  owner_user_id: string;
  last_reviewed_at: Date;
  seo: Record<string, unknown>;
  claims_refs: string[];
  tags: string[];
  deleted_at: Date | null;
  created_by: string;
  created_at: Date;
  updated_at: Date;
}

export interface RevisionRow {
  id: string;
  content_item_id: string;
  seq: number;
  title: string;
  slug: string | null;
  body: Record<string, unknown>;
  seo: Record<string, unknown>;
  summary_of_changes: string | null;
  source: string;
  sanitiser_report: string[];
  created_by: string;
  created_at: Date;
}

export interface ApprovalRow {
  id: string;
  content_item_id: string;
  revision_id: string;
  action: "publish" | "rollback" | "delete";
  maker_id: string;
  checker_id: string | null;
  legal_reviewer_id: string | null;
  needs_legal: boolean;
  state: "pending" | "approved" | "changes_requested" | "void" | "executed";
  reason: string | null;
}

export interface RedirectRow {
  id: string;
  brand_pack_id: string;
  from_path: string;
  to_path: string | null;
  status_code: 301 | 302 | 410;
  source: "manual" | "legacy_import" | "slug_change" | "retire";
  state: "pending" | "active" | "rejected" | "retired";
  maker_id: string;
  checker_id: string | null;
  legal_reviewer_id: string | null;
  hits: string;
}

export interface Deps {
  audit: AuditSink;
  outbox?: OutboxWriter | undefined;
  product: string;
}

/**
 * The scheduler's and the purge's context: a platform service principal. IPB-02-11 opens the
 * platform scope only to a principal holding a PLT_* role, so it carries PLT_CONTENT_EDITOR; it
 * never passes through the Studio's role checks and only runs the scheduled publish, unpublish
 * and purge paths, each ledgered with the service as actor (PL5-D-06).
 */
export const cmsServiceContext = (principalId: string): KernelContext => ({
  tenantId: PLATFORM_TENANT_ID,
  scope: "platform",
  principal: { id: principalId, type: "service", roles: ["PLT_CONTENT_EDITOR"] },
});

export async function loadItem(tx: Tx, id: string, lock = false): Promise<ItemRow> {
  const r = await tx.query<ItemRow>(
    `select * from cms.content_item where id = $1 and deleted_at is null${lock ? " for update" : ""}`,
    [id],
  );
  if (!r.rows[0]) throw new NotFoundError("content item");
  return r.rows[0];
}

export async function loadRevision(tx: Tx, id: string): Promise<RevisionRow> {
  const r = await tx.query<RevisionRow>("select * from cms.revision where id = $1", [id]);
  if (!r.rows[0]) throw new NotFoundError("revision");
  return r.rows[0];
}

export async function openApproval(tx: Tx, itemId: string): Promise<ApprovalRow | null> {
  const r = await tx.query<ApprovalRow>(
    `select * from cms.approval where content_item_id = $1 and action in ('publish', 'rollback')
       and state in ('pending', 'approved') for update`,
    [itemId],
  );
  return r.rows[0] ?? null;
}

export async function emit(
  tx: Tx,
  deps: Deps,
  event: { module: string; name: string },
  data: Record<string, unknown>,
): Promise<void> {
  if (!deps.outbox) return;
  await deps.outbox.publish(tx, "cms", {
    envelope: internalEvent({ product: deps.product, event, tenantId: tx.ctx.tenantId, data }),
  });
}

/** The served path of an item's revision (route patterns, parent pages, blog category). */
export async function pathOf(tx: Tx, item: ItemRow, rev: RevisionRow): Promise<string | null> {
  let parentPath: string | null = null;
  if (item.parent_id) {
    const p = await tx.query<{ published_path: string | null }>(
      "select published_path from cms.content_item where id = $1",
      [item.parent_id],
    );
    parentPath = p.rows[0]?.published_path ?? null;
  }
  return routeFor(item.content_type, rev.slug, {
    parentPath,
    category: (rev.body.category as string | undefined) ?? null,
    artefactType: (rev.body.artefact_type as string | undefined) ?? null,
  });
}

async function activeRedirects(tx: Tx, packId: string): Promise<(RedirectRule & { id: string })[]> {
  const r = await tx.query<RedirectRow>(
    `select * from cms.redirect where brand_pack_id = $1 and deleted_at is null and state in ('pending', 'active')`,
    [packId],
  );
  return r.rows.map((x) => ({ id: x.id, from: x.from_path, to: x.to_path, status: x.status_code }));
}

/** Retire a redirect whose source path is about to serve content again. */
async function retireRedirectFrom(tx: Tx, deps: Deps, packId: string, path: string): Promise<void> {
  const r = await tx.query<RedirectRow>(
    `update cms.redirect set state = 'retired', updated_at = now()
      where brand_pack_id = $1 and from_path = $2 and deleted_at is null and state in ('pending', 'active')
      returning *`,
    [packId, path],
  );
  for (const x of r.rows) {
    await deps.audit.record(tx, {
      action: "cms.redirect.retire",
      resourceType: "cms_redirect",
      resourceId: x.id,
      after: { from: x.from_path, reason: "path serves content again" },
    });
    await emit(
      tx,
      deps,
      CMS_EVENTS.RedirectChanged,
      RedirectChangedData.parse({
        redirect_id: x.id,
        from: x.from_path,
        to: x.to_path,
        status: x.status_code,
        change: "retired",
      }),
    );
  }
}

/** Add an active redirect created by an approved publish or unpublish (slug change, retire). */
export async function systemRedirect(
  tx: Tx,
  deps: Deps,
  packId: string,
  rule: RedirectRule,
  source: "slug_change" | "retire",
): Promise<string> {
  const from = normalisePath(rule.from);
  const existing = await activeRedirects(tx, packId);
  // Repoint redirects that led to the old path, so no chain forms.
  if (rule.to)
    for (const r of repointed(existing, from, rule.to)) {
      await tx.query("update cms.redirect set to_path = $2, updated_at = now() where id = $1", [
        r.id,
        r.to,
      ]);
      await deps.audit.record(tx, {
        action: "cms.redirect.repoint",
        resourceType: "cms_redirect",
        resourceId: r.id,
        after: { to: r.to },
      });
    }
  await retireRedirectFrom(tx, deps, packId, from);
  const id = newId("rdr");
  await tx.query(
    `insert into cms.redirect (id, brand_pack_id, from_path, to_path, status_code, source, state, maker_id)
     values ($1, $2, $3, $4, $5, $6, 'active', $7)`,
    [id, packId, from, rule.to, rule.status, source, tx.ctx.principal.id],
  );
  await deps.audit.record(tx, {
    action: "cms.redirect.create",
    resourceType: "cms_redirect",
    resourceId: id,
    after: { from, to: rule.to, status: rule.status, source },
  });
  await emit(
    tx,
    deps,
    CMS_EVENTS.RedirectChanged,
    RedirectChangedData.parse({
      redirect_id: id,
      from,
      to: rule.to,
      status: rule.status,
      change: "activated",
    }),
  );
  return id;
}

/**
 * Publish `revisionId` of an item (approved by the caller's checks). A changed path adds a 301
 * from the old path; the item's served revision, path and review date move together; the open
 * approval is executed. Returns the routes to revalidate.
 */
export async function publishInTx(
  tx: Tx,
  deps: Deps,
  item: ItemRow,
  revisionId: string,
  how: "publish_now" | "publish_due",
): Promise<{ routes: string[]; path: string | null }> {
  const rev = await loadRevision(tx, revisionId);
  const path = await pathOf(tx, item, rev);
  const routes: string[] = [];
  if (path) {
    routes.push(path);
    await retireRedirectFrom(tx, deps, item.brand_pack_id, path);
  }
  if (item.published_path && path && item.published_path !== path) {
    await systemRedirect(
      tx,
      deps,
      item.brand_pack_id,
      { from: item.published_path, to: path, status: 301 },
      "slug_change",
    );
    routes.push(item.published_path);
  }
  await tx.query(
    `update cms.content_item set status = 'published', published_revision_id = $2, published_slug = $3,
       published_path = $4, published_at = now(), approved_revision_id = null, scheduled_revision_id = null, publish_at = null,
       legal_review_status = case when needs_legal then 'approved' else legal_review_status end,
       title = $5, last_reviewed_at = now(), updated_by = $6, updated_at = now()
     where id = $1`,
    [item.id, revisionId, rev.slug, path, rev.title, tx.ctx.principal.id],
  );
  // A resource publishes its file version: recorded once, kept for `?v=` (IPB-04-61).
  if (item.content_type === "resource" && typeof rev.body.version === "string")
    await tx.query(
      `insert into cms.resource_version (id, content_item_id, version, revision_id, media_id, created_by)
       values ($1, $2, $3, $4, $5, $6) on conflict (content_item_id, version) do nothing`,
      [
        newId("rsv"),
        item.id,
        rev.body.version,
        revisionId,
        (rev.body.file_media_id as string | undefined) ?? null,
        tx.ctx.principal.id,
      ],
    );
  const appr = await tx.query<ApprovalRow>(
    `update cms.approval set state = 'executed', decided_at = coalesce(decided_at, now())
      where content_item_id = $1 and revision_id = $2 and state = 'approved' and action in ('publish', 'rollback')
      returning *`,
    [item.id, revisionId],
  );
  await deps.audit.record(tx, {
    action: "cms.content.publish",
    resourceType: "cms_content",
    resourceId: item.id,
    before: { revision_id: item.published_revision_id, path: item.published_path },
    after: { revision_id: revisionId, path, how },
  });
  await emit(
    tx,
    deps,
    CMS_EVENTS.ContentPublished,
    ContentPublishedData.parse({
      item_id: item.id,
      revision_id: revisionId,
      content_type: item.content_type,
      brand_pack_id: item.brand_pack_id,
      locale: item.locale,
      routes,
    }),
  );
  const a = appr.rows[0];
  const rollbackOf = /^rollback_of:(rev_\w+)$/.exec(rev.source)?.[1];
  if (a?.action === "rollback" && rollbackOf && item.published_revision_id)
    await emit(
      tx,
      deps,
      CMS_EVENTS.RollbackPerformed,
      RollbackPerformedData.parse({
        item_id: item.id,
        from_revision_id: item.published_revision_id,
        to_revision_id: revisionId,
        maker_id: a.maker_id,
        checker_id: a.checker_id ?? tx.ctx.principal.id,
      }),
    );
  return { routes, path };
}

/** Archive a published item; its path answers 410 or redirects (IPB-04-12). */
export async function unpublishInTx(
  tx: Tx,
  deps: Deps,
  item: ItemRow,
  o: {
    behaviour: "gone" | "redirect";
    to?: string | undefined;
    reason: "unpublished" | "scheduled_unpublish";
  },
): Promise<void> {
  if (o.behaviour === "redirect" && !o.to)
    throw new IpbError("IPB-CMS-009", { detail: "a redirect needs a target path" });
  if (item.published_path)
    await systemRedirect(
      tx,
      deps,
      item.brand_pack_id,
      o.behaviour === "gone"
        ? { from: item.published_path, to: null, status: 410 }
        : { from: item.published_path, to: o.to!, status: 301 },
      "retire",
    );
  await tx.query(
    `update cms.content_item set status = 'archived', published_path = null, unpublish_at = null,
       retired_behaviour = $2, updated_by = $3, updated_at = now() where id = $1`,
    [item.id, o.behaviour, tx.ctx.principal.id],
  );
  await deps.audit.record(tx, {
    action: "cms.content.unpublish",
    resourceType: "cms_content",
    resourceId: item.id,
    before: { status: "published", path: item.published_path },
    after: { status: "archived", behaviour: o.behaviour, to: o.to ?? null },
  });
  await emit(
    tx,
    deps,
    CMS_EVENTS.ContentUnpublished,
    ContentUnpublishedData.parse({
      item_id: item.id,
      reason:
        o.reason === "scheduled_unpublish"
          ? "scheduled_unpublish"
          : o.behaviour === "gone"
            ? "retired_gone"
            : "retired_redirect",
      path: item.published_path,
    }),
  );
}
