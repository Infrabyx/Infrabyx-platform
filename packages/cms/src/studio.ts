// CMS Studio service (IPB-04 §04.3.1, §04.3.12, §04.4.3; PL5 plan §5.3–§5.5). Content is platform
// rows: every write is a `kernel.mutate` in a platform context with a ledger entry in the same
// transaction, and roles are checked here, not by callers (the Studio screens and the product's
// AUTHZ adapter sit in front). Agents are makers only: they may save drafts and submit, nothing
// else (`IPB-SEC-004`). A refused attempt from outside the platform context is itself ledgered.
import { IpbError } from "@infrabyx/contracts/errors";
import { PLATFORM_TENANT_ID } from "@infrabyx/contracts/ids";
import type {
  AuditSink,
  KernelContext,
  MutationKernel,
  OutboxWriter,
  Tx,
} from "@infrabyx/contracts/kernel";
import {
  ClaimsLintFailedData,
  CMS_EVENTS,
  ContentStaleData,
  PublishRequestedData,
  RedirectChangedData,
  RevisionCreatedData,
} from "@infrabyx/contracts";
import { newId, randomBytes, sha256Hex } from "@infrabyx/crypto";
import { NotFoundError } from "@infrabyx/tenancy";
import { emptySlots, parseBody } from "./bodies.js";
import type { Block } from "./blocks.js";
import {
  lintContent,
  wordList,
  type ClaimInfo,
  type LintFinding,
  type MediaInfo,
  type WordList,
} from "./lint.js";
import { dryRun, redirectProblems, type DryRunReport, type RedirectRule } from "./redirects.js";
import {
  emit,
  loadItem,
  loadRevision,
  openApproval,
  publishInTx,
  unpublishInTx,
  type ApprovalRow,
  type Deps,
  type ItemRow,
  type RedirectRow,
  type RevisionRow,
} from "./repo.js";
import { SeoFields, seoWarnings } from "./seo.js";
import { checkSlug } from "./slug.js";
import { AGENT_TRANSITIONS, isAgent, transition, type TransitionName } from "./state.js";
import { CONTENT_PREFIX, LEGAL_REVIEW_TYPES, PUBLISH_DEFERRED, type ContentType } from "./types.js";

export const EDITOR_ROLES = ["PLT_CONTENT_EDITOR", "PLT_SUPER_ADMIN"] as const;
export const CHECKER_ROLES = ["PLT_CONTENT_EDITOR", "PLT_SUPER_ADMIN"] as const;
export const LEGAL_REVIEWER = "PLT_LEGAL_REVIEWER";

/** Settings the Studio reads (registered in `@infrabyx/config`). */
export interface SettingsReader {
  get(ctx: KernelContext, key: string): Promise<unknown>;
}

export interface CmsHooks {
  /** Author notice when changes are requested (NOTIFY). */
  notifyAuthor?(
    ctx: KernelContext,
    n: { itemId: string; authorId: string; reason: string },
  ): Promise<void>;
  /** After commit: revalidate these routes, the sitemap, feeds and `llms.txt`. */
  onPublished?(n: { itemId: string; packId: string; routes: string[] }): Promise<void> | void;
  /** `web.seo.indexnow.enabled` for a pack (BRAND tier); the adapter is `none` until the owner approves. */
  indexNowEnabled?(packId: string): Promise<boolean>;
}

export interface CmsStudioOptions {
  kernel: MutationKernel;
  audit: AuditSink;
  product: string;
  outbox?: OutboxWriter;
  settings?: SettingsReader;
  hooks?: CmsHooks;
  /** A product's additions to the claims word list. */
  words?: Partial<WordList>;
  /** Extra publish lint run at submit, e.g. `PricingService.lintCopy` for pricing copy. */
  extraLint?: (
    item: { type: ContentType; packId: string },
    body: Record<string, unknown>,
  ) => Promise<LintFinding[]>;
  now?: () => Date;
}

export interface Item {
  id: string;
  type: ContentType;
  packId: string;
  locale: string;
  translationGroupId: string;
  slug: string | null;
  title: string;
  status: ItemRow["status"];
  currentRevisionId: string;
  approvedRevisionId: string | null;
  scheduledRevisionId: string | null;
  publishedRevisionId: string | null;
  publishedPath: string | null;
  publishAt: Date | null;
  unpublishAt: Date | null;
  needsLegal: boolean;
  machineTranslated: boolean;
  ownerId: string;
  lastReviewedAt: Date;
  claimsRefs: string[];
  deletedAt: Date | null;
}

export interface Revision {
  id: string;
  itemId: string;
  seq: number;
  title: string;
  slug: string | null;
  body: Record<string, unknown>;
  seo: Record<string, unknown>;
  source: string;
  sanitiserReport: string[];
  createdBy: string;
  createdAt: Date;
}

/** One row of the Redirects list. */
export interface RedirectSummary {
  id: string;
  from: string;
  /** null for 410 Gone. */
  to: string | null;
  status: 301 | 302 | 410;
  source: "manual" | "legacy_import" | "slug_change" | "retire";
  state: "pending" | "active" | "rejected" | "retired";
  makerId: string;
  checkerId: string | null;
  legalReviewerId: string | null;
  hits: number;
  lastHitAt: Date | null;
  createdAt: Date;
}

/** One row of the Claims Register. */
export interface ClaimSummary {
  id: string;
  text: string;
  value: string | null;
  unit: string | null;
  asOf: Date;
  evidenceClass: "E0" | "E1" | "E2" | "E3" | "E4";
  kind: "figure" | "certification" | "audit" | "permission" | "category";
  sourceUrl: string | null;
  ownerId: string;
  reviewDue: Date;
  status: "proposed" | "active" | "expired" | "withdrawn";
  createdBy: string;
  assignedBy: string | null;
}

export interface SaveResult {
  item: Item;
  revision: Revision;
  /** `IPB-CMS-008`: what the sanitiser removed (saved with the revision). */
  removed: string[];
  /** Non-blocking: SEO lengths, slug words not in the title. */
  warnings: string[];
}

export interface DraftInput {
  title: string;
  slug?: string | null;
  body: unknown;
  seo?: unknown;
  summary?: string;
  claimsRefs?: readonly string[];
  tags?: readonly string[];
  machineTranslated?: boolean;
}

const toItem = (r: ItemRow): Item => ({
  id: r.id,
  type: r.content_type,
  packId: r.brand_pack_id,
  locale: r.locale,
  translationGroupId: r.translation_group_id,
  slug: r.slug,
  title: r.title,
  status: r.status,
  currentRevisionId: r.current_revision_id,
  approvedRevisionId: r.approved_revision_id,
  scheduledRevisionId: r.scheduled_revision_id,
  publishedRevisionId: r.published_revision_id,
  publishedPath: r.published_path,
  publishAt: r.publish_at,
  unpublishAt: r.unpublish_at,
  needsLegal: r.needs_legal,
  machineTranslated: r.machine_translated,
  ownerId: r.owner_user_id,
  lastReviewedAt: r.last_reviewed_at,
  claimsRefs: r.claims_refs,
  deletedAt: r.deleted_at,
});

export const toRevision = (r: RevisionRow): Revision => ({
  id: r.id,
  itemId: r.content_item_id,
  seq: r.seq,
  title: r.title,
  slug: r.slug,
  body: r.body,
  seo: r.seo,
  source: r.source,
  sanitiserReport: r.sanitiser_report,
  createdBy: r.created_by,
  createdAt: r.created_at,
});

const hasRole = (ctx: KernelContext, roles: readonly string[]) =>
  ctx.principal.roles.some((r) => roles.includes(r));

const uniqueViolation = (e: unknown) => (e as { code?: string })?.code === "23505";

export class CmsStudio {
  private readonly deps: Deps;
  constructor(private readonly o: CmsStudioOptions) {
    this.deps = { audit: o.audit, outbox: o.outbox, product: o.product };
  }

  private now(): Date {
    return this.o.now?.() ?? new Date();
  }

  private async setting<T>(ctx: KernelContext, key: string, fallback: T): Promise<T> {
    try {
      const v = await this.o.settings?.get(ctx, key);
      return (v ?? fallback) as T;
    } catch {
      return fallback;
    }
  }

  /**
   * Studio writes happen in a platform context. Anything else (a tenant admin with a stolen
   * Studio URL, `@IPB-04-AT-93`) is refused, and the attempt is ledgered first.
   */
  private async platformOnly(ctx: KernelContext, action: string): Promise<void> {
    if (ctx.scope === "platform" && ctx.tenantId === PLATFORM_TENANT_ID) return;
    await this.o.kernel.mutate(
      ctx,
      async (tx) => {
        await this.o.audit.record(tx, {
          action: "cms.access.denied",
          resourceType: "cms_studio",
          resourceId: action,
          after: {
            principal_id: ctx.principal.id,
            roles: [...ctx.principal.roles],
            scope: ctx.scope ?? "tenant",
          },
        });
      },
      { action: "cms.access.denied" },
    );
    throw new IpbError("IPB-UX-011", { detail: "the Studio is used in a platform context" });
  }

  /** Role and agent checks for a named transition or Studio action. */
  private allow(ctx: KernelContext, t: TransitionName | "write", roles: readonly string[]): void {
    if (isAgent(ctx.principal)) {
      if (t === "write" || AGENT_TRANSITIONS.has(t as TransitionName)) return;
      throw new IpbError("IPB-SEC-004", { detail: `agents may not ${t}` });
    }
    if (!hasRole(ctx, roles))
      throw new IpbError("IPB-UX-011", { detail: `${t} needs one of ${roles.join(", ")}` });
  }

  private async legalTypes(ctx: KernelContext): Promise<string[]> {
    const v = await this.setting<string[]>(ctx, "cms.publish.legal_review_types", [
      ...LEGAL_REVIEW_TYPES,
    ]);
    // The setting may only add types (IPB-04 §04.5).
    return [...new Set([...LEGAL_REVIEW_TYPES, ...v])];
  }

  private async parse(ctx: KernelContext, type: ContentType, input: DraftInput) {
    const mermaid = await this.setting<boolean>(ctx, "cms.blocks.mermaid.enabled", false);
    const parsed = parseBody(type, input.body, { mermaid });
    if (parsed.issues.length)
      throw new IpbError("IPB-CMS-001", {
        detail: `${parsed.issues[0]!.path}: ${parsed.issues[0]!.message}`,
        errors: parsed.issues.map((i) => ({
          path: i.path,
          code: "IPB-CMS-001",
          message: i.message,
        })),
      });
    const seo = SeoFields.safeParse(input.seo ?? {});
    if (!seo.success)
      throw new IpbError("IPB-CMS-001", {
        detail: `seo.${seo.error.issues[0]!.path.join(".")}: ${seo.error.issues[0]!.message}`,
      });
    const warnings = seoWarnings(seo.data, input.title);
    if (input.slug) {
      const s = checkSlug(input.slug, input.title);
      if (!s.ok)
        throw new IpbError("IPB-CMS-002", {
          detail: `slug "${input.slug}" is ${s.error === "reserved" ? "reserved" : "not lower-kebab ASCII"}`,
          meta: { suggestion: s.suggestion ?? null },
        });
      warnings.push(...s.warnings);
    }
    return { ...parsed, seo: seo.data, warnings };
  }

  private async insertRevision(
    tx: Tx,
    itemId: string,
    input: {
      title: string;
      slug: string | null;
      body: unknown;
      seo: unknown;
      summary?: string | undefined;
      source: string;
      removed: string[];
      id?: string;
    },
  ): Promise<RevisionRow> {
    const seq = await tx.query<{ n: number }>(
      "select coalesce(max(seq), 0) + 1 as n from cms.revision where content_item_id = $1",
      [itemId],
    );
    const id = input.id ?? newId("rev");
    const r = await tx.query<RevisionRow>(
      `insert into cms.revision (id, content_item_id, seq, title, slug, body, seo, summary_of_changes, source, sanitiser_report, created_by)
       values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10::jsonb, $11) returning *`,
      [
        id,
        itemId,
        seq.rows[0]!.n,
        input.title,
        input.slug,
        JSON.stringify(input.body),
        JSON.stringify(input.seo),
        input.summary ?? null,
        input.source,
        JSON.stringify(input.removed),
        tx.ctx.principal.id,
      ],
    );
    await emit(
      tx,
      this.deps,
      CMS_EVENTS.RevisionCreated,
      RevisionCreatedData.parse({
        item_id: itemId,
        revision_id: id,
        source: input.source,
        actor_id: tx.ctx.principal.id,
      }),
    );
    return r.rows[0]!;
  }

  // --- Items and revisions --------------------------------------------------------------

  /** Create an item with its first revision, in `draft`. */
  async createItem(
    ctx: KernelContext,
    input: DraftInput & {
      type: ContentType;
      packId: string;
      locale?: string;
      translationGroupId?: string;
      parentId?: string | null;
      source?: "editor" | "import" | "machine_translation" | "seed";
    },
  ): Promise<SaveResult> {
    await this.platformOnly(ctx, "cms.content.create");
    this.allow(ctx, "write", EDITOR_ROLES);
    const p = await this.parse(ctx, input.type, input);
    const machine = input.machineTranslated ?? input.source === "machine_translation";
    try {
      return await this.o.kernel.mutate(
        ctx,
        async (tx) => {
          const id = newId(CONTENT_PREFIX[input.type]);
          const revisionId = newId("rev");
          // The item row first (the revision references it), then its first revision.
          await tx.query(
            `insert into cms.content_item (id, brand_pack_id, content_type, locale, translation_group_id, slug, parent_id,
               template, title, current_revision_id, owner_user_id, seo, claims_refs, tags, machine_translated, created_by, updated_by)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14, $15, $11, $11)`,
            [
              id,
              input.packId,
              input.type,
              input.locale ?? "en-IN",
              input.translationGroupId ?? id,
              input.slug ?? null,
              input.parentId ?? null,
              (p.body.template as string | undefined) ?? null,
              input.title,
              revisionId,
              ctx.principal.id,
              JSON.stringify(p.seo),
              [...(input.claimsRefs ?? [])],
              [...(input.tags ?? [])],
              machine,
            ],
          );
          const rev = await this.insertRevision(tx, id, {
            title: input.title,
            slug: input.slug ?? null,
            body: p.body,
            seo: p.seo,
            summary: input.summary,
            source: input.source ?? "editor",
            removed: p.removed,
            id: revisionId,
          });
          await this.o.audit.record(tx, {
            action: "cms.content.create",
            resourceType: "cms_content",
            resourceId: id,
            after: {
              type: input.type,
              pack: input.packId,
              revision_id: rev.id,
              sanitiser_removed: p.removed.length,
            },
          });
          const item = await loadItem(tx, id);
          return {
            item: toItem(item),
            revision: toRevision(rev),
            removed: p.removed,
            warnings: p.warnings,
          };
        },
        { action: "cms.content.create" },
      );
    } catch (e) {
      if (uniqueViolation(e))
        throw new IpbError("IPB-CMS-002", {
          detail: "this slug (or footer) already exists for the pack, locale and type",
        });
      throw e;
    }
  }

  /**
   * Save a new revision (`@IPB-04-AT-01`). Any edit returns the item to `draft` and voids an open
   * approval and legal sign-off; the published revision keeps serving (IPB-04 §04.4.3, AT-101).
   */
  async saveDraft(ctx: KernelContext, itemId: string, input: DraftInput): Promise<SaveResult> {
    await this.platformOnly(ctx, "cms.content.save");
    this.allow(ctx, "edit", EDITOR_ROLES);
    const type = await this.o.kernel.read(
      ctx,
      async (tx) => (await loadItem(tx, itemId)).content_type,
    );
    const p = await this.parse(ctx, type, input);
    try {
      return await this.o.kernel.mutate(
        ctx,
        async (tx) => {
          const item = await loadItem(tx, itemId, true);
          const to = transition(item.status, "edit");
          const rev = await this.insertRevision(tx, itemId, {
            title: input.title,
            slug: input.slug === undefined ? item.slug : input.slug,
            body: p.body,
            seo: p.seo,
            summary: input.summary,
            source: input.machineTranslated ? "machine_translation" : "editor",
            removed: p.removed,
          });
          const voided = await tx.query<ApprovalRow>(
            `update cms.approval set state = 'void', decided_at = now()
              where content_item_id = $1 and state in ('pending', 'approved') and action in ('publish', 'rollback')
              returning id`,
            [itemId],
          );
          await tx.query(
            `update cms.content_item set status = $2, current_revision_id = $3, slug = $4, title = $5, seo = $6::jsonb,
               template = $7, approved_revision_id = null, scheduled_revision_id = null,
               legal_review_status = case when needs_legal then 'pending' else 'not_required' end,
               claims_refs = coalesce($8, claims_refs), tags = coalesce($9, tags),
               machine_translated = $10, updated_by = $11, updated_at = now()
             where id = $1`,
            [
              itemId,
              to,
              rev.id,
              rev.slug,
              input.title,
              JSON.stringify(p.seo),
              (p.body.template as string | undefined) ?? item.template,
              input.claimsRefs ? [...input.claimsRefs] : null,
              input.tags ? [...input.tags] : null,
              input.machineTranslated ??
                (item.machine_translated && rev.source === "machine_translation"),
              ctx.principal.id,
            ],
          );
          await this.o.audit.record(tx, {
            action: "cms.content.save",
            resourceType: "cms_content",
            resourceId: itemId,
            before: { status: item.status, revision_id: item.current_revision_id },
            after: {
              status: to,
              revision_id: rev.id,
              voided_approvals: voided.rows.map((r) => r.id),
              sanitiser_removed: p.removed.length,
            },
          });
          return {
            item: toItem(await loadItem(tx, itemId)),
            revision: toRevision(rev),
            removed: p.removed,
            warnings: p.warnings,
          };
        },
        { action: "cms.content.save" },
      );
    } catch (e) {
      if (uniqueViolation(e))
        throw new IpbError("IPB-CMS-002", { detail: "this slug is already used" });
      throw e;
    }
  }

  /** Lint, slot and translation checks a revision must pass before it may be submitted. */
  private async publishChecks(
    tx: Tx,
    item: ItemRow,
    rev: RevisionRow,
  ): Promise<{ findings: LintFinding[]; legalFlags: string[] }> {
    if (PUBLISH_DEFERRED.has(item.content_type))
      throw new IpbError("IPB-CMS-003", {
        detail: `${item.content_type} cannot be published until its gate exists (OWNER-QUESTIONS #42)`,
        meta: { reason: "deferred_type" },
      });
    if (item.machine_translated || rev.source === "machine_translation")
      throw new IpbError("IPB-CMS-011", {
        detail: "a person must review the machine translation first",
      });
    const parsed = parseBody(item.content_type, rev.body, { mermaid: true });
    const slots = emptySlots(item.content_type, parsed.body, parsed.blocks);
    if (slots.length)
      throw new IpbError("IPB-CMS-003", {
        detail: `required slots are empty: ${slots.join(", ")}`,
        meta: { reason: "slots", slots },
      });
    const claims = await tx.query<{
      id: string;
      evidence_class: ClaimInfo["evidenceClass"];
      kind: ClaimInfo["kind"];
      status: ClaimInfo["status"];
      as_of: string;
      evidence_doc_id: string | null;
      permission_doc_id: string | null;
    }>(
      "select id, evidence_class, kind, status, as_of::text, evidence_doc_id, permission_doc_id from cms.claim",
    );
    const media = await tx.query<{
      id: string;
      kind: string;
      alt_text: string | null;
      decorative: boolean;
    }>("select id, kind, alt_text, decorative from cms.media where deleted_at is null");
    return lintContent({
      type: item.content_type,
      title: rev.title,
      seo: rev.seo,
      body: parsed.body,
      blocks: parsed.blocks as Block[],
      claimsRefs: item.claims_refs,
      claims: new Map(
        claims.rows.map((c) => [
          c.id,
          {
            id: c.id,
            evidenceClass: c.evidence_class,
            kind: c.kind,
            status: c.status,
            asOf: c.as_of,
            evidenceDocId: c.evidence_doc_id,
            permissionDocId: c.permission_doc_id,
          },
        ]),
      ),
      media: new Map<string, MediaInfo>(
        media.rows.map((m) => [
          m.id,
          { id: m.id, kind: m.kind, altText: m.alt_text, decorative: m.decorative },
        ]),
      ),
      words: wordList(this.o.words),
    });
  }

  /**
   * Submit the current revision (`@IPB-04-AT-02`, `@IPB-04-AT-06`). Blocking lint refuses with its
   * code (a claims failure is ledgered with `ClaimsLintFailed` first). Legal-review types and any
   * lint flag go to `legal_review`.
   */
  async submit(ctx: KernelContext, itemId: string): Promise<Item> {
    await this.platformOnly(ctx, "cms.content.submit");
    this.allow(ctx, "submit", EDITOR_ROLES);
    const legalTypes = await this.legalTypes(ctx);
    const check = await this.o.kernel.read(ctx, async (tx) => {
      const item = await loadItem(tx, itemId);
      const rev = await loadRevision(tx, item.current_revision_id);
      return { item, rev, lint: await this.publishChecks(tx, item, rev) };
    });
    if (this.o.extraLint)
      check.lint.findings.push(
        ...(await this.o.extraLint(
          { type: check.item.content_type, packId: check.item.brand_pack_id },
          check.rev.body,
        )),
      );
    if (check.lint.findings.length) {
      const claimsFailures = check.lint.findings.filter((f) => f.code === "IPB-CMS-010");
      if (claimsFailures.length)
        await this.o.kernel.mutate(
          ctx,
          async (tx) => {
            await this.o.audit.record(tx, {
              action: "cms.claims_lint.failed",
              resourceType: "cms_content",
              resourceId: itemId,
              after: { revision_id: check.rev.id, failures: claimsFailures.map((f) => f.path) },
            });
            await emit(
              tx,
              this.deps,
              CMS_EVENTS.ClaimsLintFailed,
              ClaimsLintFailedData.parse({
                item_id: itemId,
                revision_id: check.rev.id,
                failures: claimsFailures,
              }),
            );
          },
          { action: "cms.claims_lint.failed" },
        );
      const first = check.lint.findings[0]!;
      throw new IpbError(first.code, {
        detail: `${first.path}: ${first.message}`,
        meta: { findings: check.lint.findings },
      });
    }
    const pageIsInvestors = check.item.slug === "investors";
    const needsLegal =
      legalTypes.includes(check.item.content_type) ||
      (pageIsInvestors && legalTypes.includes("investors")) ||
      (check.item.slug === "trust" && legalTypes.includes("trust")) ||
      check.lint.legalFlags.length > 0;
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const item = await loadItem(tx, itemId, true);
        if (item.current_revision_id !== check.rev.id)
          throw new IpbError("IPB-CMS-003", {
            detail: "the item changed meanwhile",
            meta: { reason: "stale" },
          });
        if (item.unpublish_at && item.publish_at && item.unpublish_at <= item.publish_at)
          throw new IpbError("IPB-CMS-003", {
            detail: "unpublish_at must be later than publish_at",
            meta: { reason: "dates" },
          });
        const to = transition(item.status, needsLegal ? "submit_legal" : "submit");
        const rollback = /^rollback_of:/.test(check.rev.source);
        const approvalId = newId("cap");
        await tx.query(
          `insert into cms.approval (id, content_item_id, revision_id, action, maker_id, needs_legal)
           values ($1, $2, $3, $4, $5, $6)`,
          [
            approvalId,
            itemId,
            check.rev.id,
            rollback ? "rollback" : "publish",
            ctx.principal.id,
            needsLegal,
          ],
        );
        await tx.query(
          `update cms.content_item set status = $2, needs_legal = $3,
             legal_review_status = case when $3 then 'pending' else 'not_required' end, updated_by = $4, updated_at = now()
           where id = $1`,
          [itemId, to, needsLegal, ctx.principal.id],
        );
        await this.o.audit.record(tx, {
          action: "cms.content.submit",
          resourceType: "cms_content",
          resourceId: itemId,
          before: { status: item.status },
          after: {
            status: to,
            revision_id: check.rev.id,
            approval_id: approvalId,
            needs_legal: needsLegal,
            legal_flags: check.lint.legalFlags,
          },
        });
        await emit(
          tx,
          this.deps,
          CMS_EVENTS.PublishRequested,
          PublishRequestedData.parse({
            item_id: itemId,
            revision_id: check.rev.id,
            needs_legal: needsLegal,
          }),
        );
        return toItem(await loadItem(tx, itemId));
      },
      { action: "cms.content.submit" },
    );
  }

  /** Send back to draft with a reason; the author is notified (AT-101 scenario 2). */
  async requestChanges(ctx: KernelContext, itemId: string, reason: string): Promise<Item> {
    await this.platformOnly(ctx, "cms.content.request_changes");
    if (!reason?.trim())
      throw new IpbError("IPB-CMS-003", {
        detail: "a reason is required",
        meta: { reason: "reason" },
      });
    const { item, author } = await this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const item = await loadItem(tx, itemId, true);
        this.allow(
          ctx,
          "request_changes",
          item.status === "legal_review" ? [LEGAL_REVIEWER] : [...CHECKER_ROLES, LEGAL_REVIEWER],
        );
        const to = transition(item.status, "request_changes");
        const appr = await openApproval(tx, itemId);
        if (appr?.maker_id === ctx.principal.id) throw new IpbError("IPB-CMS-004");
        if (appr)
          await tx.query(
            "update cms.approval set state = 'changes_requested', reason = $2, decided_at = now() where id = $1",
            [appr.id, reason],
          );
        await tx.query(
          "update cms.content_item set status = $2, updated_by = $3, updated_at = now() where id = $1",
          [itemId, to, ctx.principal.id],
        );
        await this.o.audit.record(tx, {
          action: "cms.content.request_changes",
          resourceType: "cms_content",
          resourceId: itemId,
          before: { status: item.status },
          after: { status: to, reason },
        });
        return {
          item: toItem(await loadItem(tx, itemId)),
          author: appr?.maker_id ?? item.owner_user_id,
        };
      },
      { action: "cms.content.request_changes" },
    );
    await this.o.hooks?.notifyAuthor?.(ctx, { itemId, authorId: author, reason });
    return item;
  }

  /** The PLT_LEGAL_REVIEWER sign-off; the item returns to `in_review` for the checker (PL5-D-06). */
  async legalApprove(ctx: KernelContext, itemId: string): Promise<Item> {
    await this.platformOnly(ctx, "cms.content.legal_approve");
    this.allow(ctx, "legal_approve", [LEGAL_REVIEWER]);
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const item = await loadItem(tx, itemId, true);
        const to = transition(item.status, "legal_approve");
        const appr = await openApproval(tx, itemId);
        if (!appr) throw new NotFoundError("open approval");
        if (appr.maker_id === ctx.principal.id || appr.checker_id === ctx.principal.id)
          throw new IpbError("IPB-CMS-004");
        await tx.query(
          "update cms.approval set legal_reviewer_id = $2, legal_decided_at = now() where id = $1",
          [appr.id, ctx.principal.id],
        );
        await tx.query(
          `update cms.content_item set status = $2, legal_review_status = 'approved', updated_by = $3, updated_at = now() where id = $1`,
          [itemId, to, ctx.principal.id],
        );
        await this.o.audit.record(tx, {
          action: "cms.content.legal_approve",
          resourceType: "cms_content",
          resourceId: itemId,
          before: { status: item.status },
          after: { status: to, approval_id: appr.id },
        });
        return toItem(await loadItem(tx, itemId));
      },
      { action: "cms.content.legal_approve" },
    );
  }

  /**
   * The checker's approval (`@IPB-04-AT-03`): never the maker (`IPB-CMS-004`), never the legal
   * reviewer of the same approval, and only after the legal sign-off where it is needed
   * (`IPB-CMS-005`).
   */
  async approve(ctx: KernelContext, itemId: string): Promise<Item> {
    await this.platformOnly(ctx, "cms.content.approve");
    this.allow(ctx, "approve", CHECKER_ROLES);
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const item = await loadItem(tx, itemId, true);
        const appr = await openApproval(tx, itemId);
        if (appr && appr.maker_id === ctx.principal.id) throw new IpbError("IPB-CMS-004");
        if (appr && appr.legal_reviewer_id === ctx.principal.id)
          throw new IpbError("IPB-CMS-004", {
            detail: "the legal reviewer cannot also be the checker",
          });
        if (item.status === "legal_review" || (item.needs_legal && !appr?.legal_reviewer_id))
          throw new IpbError("IPB-CMS-005");
        const to = transition(item.status, "approve");
        if (!appr) throw new NotFoundError("open approval");
        await tx.query(
          "update cms.approval set checker_id = $2, state = 'approved', decided_at = now() where id = $1",
          [appr.id, ctx.principal.id],
        );
        await tx.query(
          `update cms.content_item set status = $2, approved_revision_id = $3, updated_by = $4, updated_at = now() where id = $1`,
          [itemId, to, appr.revision_id, ctx.principal.id],
        );
        await this.o.audit.record(tx, {
          action: "cms.content.approve",
          resourceType: "cms_content",
          resourceId: itemId,
          before: { status: item.status },
          after: { status: to, approval_id: appr.id, revision_id: appr.revision_id },
        });
        return toItem(await loadItem(tx, itemId));
      },
      { action: "cms.content.approve" },
    );
  }

  /** Schedule an approved item (`@IPB-04-AT-04`). A time in the past publishes only through `publishNow`. */
  async schedule(
    ctx: KernelContext,
    itemId: string,
    at: { publishAt: Date; unpublishAt?: Date },
  ): Promise<Item> {
    await this.platformOnly(ctx, "cms.content.schedule");
    this.allow(ctx, "schedule", CHECKER_ROLES);
    if (at.publishAt.getTime() <= this.now().getTime())
      throw new IpbError("IPB-CMS-003", {
        detail: "publish_at is in the past; use publish now",
        meta: { reason: "dates" },
      });
    if (at.unpublishAt && at.unpublishAt <= at.publishAt)
      throw new IpbError("IPB-CMS-003", {
        detail: "unpublish_at must be later than publish_at",
        meta: { reason: "dates" },
      });
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const item = await loadItem(tx, itemId, true);
        const to = transition(item.status, "schedule");
        await tx.query(
          `update cms.content_item set status = $2, scheduled_revision_id = approved_revision_id, publish_at = $3,
             unpublish_at = $4, updated_by = $5, updated_at = now() where id = $1`,
          [itemId, to, at.publishAt, at.unpublishAt ?? null, ctx.principal.id],
        );
        await this.o.audit.record(tx, {
          action: "cms.content.schedule",
          resourceType: "cms_content",
          resourceId: itemId,
          before: { status: item.status },
          after: {
            status: to,
            revision_id: item.approved_revision_id,
            publish_at: at.publishAt.toISOString(),
            unpublish_at: at.unpublishAt?.toISOString() ?? null,
          },
        });
        return toItem(await loadItem(tx, itemId));
      },
      { action: "cms.content.schedule" },
    );
  }

  async unschedule(ctx: KernelContext, itemId: string): Promise<Item> {
    await this.platformOnly(ctx, "cms.content.unschedule");
    this.allow(ctx, "unschedule", CHECKER_ROLES);
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const item = await loadItem(tx, itemId, true);
        const to = transition(item.status, "unschedule");
        await tx.query(
          `update cms.content_item set status = $2, scheduled_revision_id = null, publish_at = null, updated_by = $3, updated_at = now() where id = $1`,
          [itemId, to, ctx.principal.id],
        );
        await this.o.audit.record(tx, {
          action: "cms.content.unschedule",
          resourceType: "cms_content",
          resourceId: itemId,
          before: { status: item.status },
          after: { status: to },
        });
        return toItem(await loadItem(tx, itemId));
      },
      { action: "cms.content.unschedule" },
    );
  }

  /** Publish an approved item now (the checker's `publish_now`). */
  async publishNow(ctx: KernelContext, itemId: string): Promise<Item> {
    await this.platformOnly(ctx, "cms.content.publish");
    this.allow(ctx, "publish_now", CHECKER_ROLES);
    const r = await this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const item = await loadItem(tx, itemId, true);
        if (item.needs_legal && item.legal_review_status !== "approved")
          throw new IpbError("IPB-CMS-005");
        transition(item.status, "publish_now");
        if (!item.approved_revision_id)
          throw new IpbError("IPB-CMS-005", { detail: "no approved revision" });
        const done = await publishInTx(
          tx,
          this.deps,
          item,
          item.approved_revision_id,
          "publish_now",
        );
        await this.indexNow(tx, item.brand_pack_id, done.routes);
        return { item: toItem(await loadItem(tx, itemId)), routes: done.routes };
      },
      { action: "cms.content.publish" },
    );
    await this.o.hooks?.onPublished?.({ itemId, packId: r.item.packId, routes: r.routes });
    return r.item;
  }

  /** IndexNow after publish (IPB-04-09): the `none` adapter records what it would have sent. */
  async indexNow(tx: Tx, packId: string, routes: readonly string[]): Promise<void> {
    if (!routes.length || !(await this.o.hooks?.indexNowEnabled?.(packId))) return;
    await this.o.audit.record(tx, {
      action: "cms.indexnow.push",
      resourceType: "brand_pack",
      resourceId: packId,
      after: { adapter: "none", urls: [...routes] },
    });
  }

  /** Unpublish: the item is archived and its path answers 410 or redirects (IPB-04-12). */
  async unpublish(
    ctx: KernelContext,
    itemId: string,
    o: { behaviour: "gone" | "redirect"; to?: string },
  ): Promise<Item> {
    await this.platformOnly(ctx, "cms.content.unpublish");
    this.allow(ctx, "unpublish", CHECKER_ROLES);
    const r = await this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const item = await loadItem(tx, itemId, true);
        transition(item.status, "unpublish");
        if (o.behaviour === "redirect" && o.to) {
          const existing = await this.redirectRules(tx, item.brand_pack_id);
          const problems = redirectProblems(
            existing.filter((x) => x.from !== item.published_path),
            { from: item.published_path ?? "/", to: o.to, status: 301 },
          );
          if (problems.length) throw new IpbError("IPB-CMS-009", { detail: problems.join("; ") });
        }
        await unpublishInTx(tx, this.deps, item, { ...o, reason: "unpublished" });
        return { item: toItem(await loadItem(tx, itemId)), path: item.published_path };
      },
      { action: "cms.content.unpublish" },
    );
    if (r.path)
      await this.o.hooks?.onPublished?.({ itemId, packId: r.item.packId, routes: [r.path] });
    return r.item;
  }

  /**
   * Roll back to an earlier published revision: a new revision with its body, `rollback_of`, which
   * is submitted and approved like any publish (maker-checker; `@IPB-04-AT-01` keeps both).
   */
  async requestRollback(ctx: KernelContext, itemId: string, toRevisionId: string): Promise<Item> {
    await this.platformOnly(ctx, "cms.content.rollback");
    this.allow(ctx, "edit", EDITOR_ROLES);
    await this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const item = await loadItem(tx, itemId, true);
        const target = await loadRevision(tx, toRevisionId);
        const wasPublished = await tx.query(
          `select 1 from cms.approval where revision_id = $1 and state = 'executed'
           union select 1 from cms.content_item where id = $2 and published_revision_id = $1`,
          [toRevisionId, itemId],
        );
        if (target.content_item_id !== itemId || !wasPublished.rowCount)
          throw new IpbError("IPB-CMS-003", {
            detail: "a rollback targets an earlier published revision",
            meta: { reason: "rollback_target" },
          });
        if (item.published_revision_id === toRevisionId)
          throw new IpbError("IPB-CMS-003", {
            detail: "that revision is already published",
            meta: { reason: "rollback_target" },
          });
        const to = transition(item.status, "edit");
        const rev = await this.insertRevision(tx, itemId, {
          title: target.title,
          slug: target.slug,
          body: target.body,
          seo: target.seo,
          summary: `Rollback to revision ${target.seq}`,
          source: `rollback_of:${toRevisionId}`,
          removed: [],
        });
        await tx.query(
          `update cms.approval set state = 'void', decided_at = now()
            where content_item_id = $1 and state in ('pending', 'approved') and action in ('publish', 'rollback')`,
          [itemId],
        );
        await tx.query(
          `update cms.content_item set status = $2, current_revision_id = $3, slug = $4, title = $5, approved_revision_id = null,
             scheduled_revision_id = null, machine_translated = false, updated_by = $6, updated_at = now() where id = $1`,
          [itemId, to, rev.id, rev.slug, rev.title, ctx.principal.id],
        );
        await this.o.audit.record(tx, {
          action: "cms.content.rollback.request",
          resourceType: "cms_content",
          resourceId: itemId,
          before: { revision_id: item.current_revision_id },
          after: { revision_id: rev.id, rollback_of: toRevisionId },
        });
      },
      { action: "cms.content.rollback.request" },
    );
    return this.submit(ctx, itemId);
  }

  /**
   * Soft delete (IPB-04-101): restorable for `cms.soft_delete.restore_days`, purged after 90 days
   * (OWNER-QUESTIONS #48). Published items are unpublished first. Offices are deleted only through
   * maker-checker (IPB-04-72): the first call opens the request, a second person's call executes it.
   */
  async softDelete(
    ctx: KernelContext,
    itemId: string,
    reason: string,
  ): Promise<{ deleted: boolean; pendingApproval?: string }> {
    await this.platformOnly(ctx, "cms.content.delete");
    this.allow(ctx, "unpublish", EDITOR_ROLES);
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const item = await loadItem(tx, itemId, true);
        if (item.status === "published" || item.status === "scheduled")
          throw new IpbError("IPB-CMS-003", {
            detail: "unpublish or unschedule before deleting",
            meta: { reason: "published" },
          });
        const live = await tx.query(
          "select 1 from cms.content_item where parent_id = $1 and deleted_at is null",
          [itemId],
        );
        if (live.rowCount)
          throw new IpbError("IPB-CMS-003", {
            detail: "the item has child pages",
            meta: { reason: "children" },
          });
        if (item.content_type === "office") {
          const open = await tx.query<ApprovalRow>(
            "select * from cms.approval where content_item_id = $1 and action = 'delete' and state = 'pending' for update",
            [itemId],
          );
          const req = open.rows[0];
          if (!req) {
            const id = newId("cap");
            await tx.query(
              `insert into cms.approval (id, content_item_id, revision_id, action, maker_id, needs_legal, reason)
               values ($1, $2, $3, 'delete', $4, false, $5)`,
              [id, itemId, item.current_revision_id, ctx.principal.id, reason],
            );
            await this.o.audit.record(tx, {
              action: "cms.content.delete.request",
              resourceType: "cms_content",
              resourceId: itemId,
              after: { approval_id: id, reason },
            });
            return { deleted: false, pendingApproval: id };
          }
          if (req.maker_id === ctx.principal.id) throw new IpbError("IPB-CMS-004");
          await tx.query(
            "update cms.approval set checker_id = $2, state = 'executed', decided_at = now() where id = $1",
            [req.id, ctx.principal.id],
          );
        }
        await tx.query(
          "update cms.content_item set deleted_at = now(), deleted_by = $2, updated_by = $2, updated_at = now() where id = $1",
          [itemId, ctx.principal.id],
        );
        await this.o.audit.record(tx, {
          action: "cms.content.delete",
          resourceType: "cms_content",
          resourceId: itemId,
          before: { status: item.status },
          after: { deleted: true, reason },
        });
        return { deleted: true };
      },
      { action: "cms.content.delete" },
    );
  }

  /** Restore a soft-deleted item within the restore window. */
  async restore(ctx: KernelContext, itemId: string): Promise<Item> {
    await this.platformOnly(ctx, "cms.content.restore");
    this.allow(ctx, "unpublish", EDITOR_ROLES);
    const days = await this.setting<number>(ctx, "cms.soft_delete.restore_days", 30);
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const r = await tx.query<ItemRow>(
          "select * from cms.content_item where id = $1 for update",
          [itemId],
        );
        const item = r.rows[0];
        if (!item?.deleted_at) throw new NotFoundError("deleted content item");
        if (this.now().getTime() - item.deleted_at.getTime() > days * 86_400_000)
          throw new IpbError("IPB-CMS-003", {
            detail: `the ${days}-day restore window has passed`,
            meta: { reason: "restore_window" },
          });
        await tx.query(
          "update cms.content_item set deleted_at = null, deleted_by = null, status = 'draft', updated_by = $2, updated_at = now() where id = $1",
          [itemId, ctx.principal.id],
        );
        await this.o.audit.record(tx, {
          action: "cms.content.restore",
          resourceType: "cms_content",
          resourceId: itemId,
          after: { restored: true },
        });
        return toItem(await loadItem(tx, itemId));
      },
      { action: "cms.content.restore" },
    );
  }

  async get(ctx: KernelContext, itemId: string): Promise<Item> {
    return this.o.kernel.read(ctx, async (tx) => toItem(await loadItem(tx, itemId)));
  }

  async revision(ctx: KernelContext, revisionId: string): Promise<Revision> {
    return this.o.kernel.read(ctx, async (tx) => toRevision(await loadRevision(tx, revisionId)));
  }

  async revisions(ctx: KernelContext, itemId: string): Promise<Revision[]> {
    return this.o.kernel.read(ctx, async (tx) =>
      (
        await tx.query<RevisionRow>(
          "select * from cms.revision where content_item_id = $1 order by seq",
          [itemId],
        )
      ).rows.map(toRevision),
    );
  }

  /** The Studio content list (section 1), filtered. */
  async list(
    ctx: KernelContext,
    f: {
      packId?: string;
      type?: ContentType;
      status?: ItemRow["status"];
      locale?: string;
      deleted?: boolean;
    } = {},
  ): Promise<Item[]> {
    return this.o.kernel.read(ctx, async (tx) => {
      const where = [f.deleted ? "deleted_at is not null" : "deleted_at is null"];
      const args: unknown[] = [];
      const add = (sql: string, v: unknown) => {
        args.push(v);
        where.push(sql.replace("?", `$${args.length}`));
      };
      if (f.packId) add("brand_pack_id = ?", f.packId);
      if (f.type) add("content_type = ?", f.type);
      if (f.status) add("status = ?", f.status);
      if (f.locale) add("locale = ?", f.locale);
      const r = await tx.query<ItemRow>(
        `select * from cms.content_item where ${where.join(" and ")} order by updated_at desc limit 500`,
        args,
      );
      return r.rows.map(toItem);
    });
  }

  // --- Stale content (IPB-04-17, `@IPB-04-AT-13`) ---------------------------------------

  /** Published items not reviewed for `cms.review.stale_days` (365). */
  async staleQueue(ctx: KernelContext): Promise<Item[]> {
    const days = await this.setting<number>(ctx, "cms.review.stale_days", 365);
    return this.o.kernel.read(ctx, async (tx) =>
      (
        await tx.query<ItemRow>(
          `select * from cms.content_item where deleted_at is null and status = 'published'
             and last_reviewed_at < $1 order by last_reviewed_at`,
          [new Date(this.now().getTime() - days * 86_400_000)],
        )
      ).rows.map(toItem),
    );
  }

  /** Emit `ContentStale` for each stale item (daily, from one worker), ledgered. */
  async emitStale(ctx: KernelContext): Promise<number> {
    const stale = await this.staleQueue(ctx);
    if (!stale.length) return 0;
    await this.o.kernel.mutate(
      ctx,
      async (tx) => {
        for (const i of stale) {
          await this.o.audit.record(tx, {
            action: "cms.content.stale",
            resourceType: "cms_content",
            resourceId: i.id,
            after: { last_reviewed_at: i.lastReviewedAt.toISOString() },
          });
          await emit(
            tx,
            this.deps,
            CMS_EVENTS.ContentStale,
            ContentStaleData.parse({
              item_id: i.id,
              last_reviewed_at: i.lastReviewedAt.toISOString(),
            }),
          );
        }
      },
      { action: "cms.content.stale" },
    );
    return stale.length;
  }

  /** Record a review of a published item without changing it. */
  async markReviewed(ctx: KernelContext, itemId: string): Promise<Item> {
    await this.platformOnly(ctx, "cms.content.review");
    this.allow(ctx, "unpublish", EDITOR_ROLES);
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        await loadItem(tx, itemId, true);
        await tx.query(
          "update cms.content_item set last_reviewed_at = now(), updated_by = $2, updated_at = now() where id = $1",
          [itemId, ctx.principal.id],
        );
        await this.o.audit.record(tx, {
          action: "cms.content.review",
          resourceType: "cms_content",
          resourceId: itemId,
        });
        return toItem(await loadItem(tx, itemId));
      },
      { action: "cms.content.review" },
    );
  }

  // --- Claims Register (IPB-04-07, 04-102) ----------------------------------------------

  /** Propose a claim; it stays E0 and inactive until the legal reviewer assigns its class. */
  async proposeClaim(
    ctx: KernelContext,
    c: {
      text: string;
      value?: string;
      unit?: string;
      asOf: string;
      kind?: ClaimInfo["kind"];
      sourceUrl?: string;
      reviewDue: string;
    },
  ): Promise<{ id: string }> {
    await this.platformOnly(ctx, "cms.claim.propose");
    this.allow(ctx, "write", EDITOR_ROLES);
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const id = newId("clm");
        await tx.query(
          `insert into cms.claim (id, text, value, unit, as_of, kind, source_url, owner_id, review_due, created_by)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $8)`,
          [
            id,
            c.text,
            c.value ?? null,
            c.unit ?? null,
            c.asOf,
            c.kind ?? "figure",
            c.sourceUrl ?? null,
            ctx.principal.id,
            c.reviewDue,
          ],
        );
        await this.o.audit.record(tx, {
          action: "cms.claim.propose",
          resourceType: "cms_claim",
          resourceId: id,
          after: { kind: c.kind ?? "figure", as_of: c.asOf },
        });
        return { id };
      },
      { action: "cms.claim.propose" },
    );
  }

  /** Assign the evidence class and activate (PLT_LEGAL_REVIEWER, not the proposer). */
  async assignClaim(
    ctx: KernelContext,
    claimId: string,
    a: {
      evidenceClass: ClaimInfo["evidenceClass"];
      evidenceDocId?: string;
      permissionDocId?: string;
    },
  ): Promise<void> {
    await this.platformOnly(ctx, "cms.claim.assign");
    this.allow(ctx, "legal_approve", [LEGAL_REVIEWER]);
    await this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const r = await tx.query<{ created_by: string }>(
          "select created_by from cms.claim where id = $1 for update",
          [claimId],
        );
        if (!r.rows[0]) throw new NotFoundError("claim");
        if (r.rows[0].created_by === ctx.principal.id) throw new IpbError("IPB-CMS-004");
        await tx.query(
          `update cms.claim set evidence_class = $2, evidence_doc_id = coalesce($3, evidence_doc_id),
             permission_doc_id = coalesce($4, permission_doc_id), status = 'active', assigned_by = $5,
             assigned_at = now(), updated_at = now() where id = $1`,
          [
            claimId,
            a.evidenceClass,
            a.evidenceDocId ?? null,
            a.permissionDocId ?? null,
            ctx.principal.id,
          ],
        );
        await this.o.audit.record(tx, {
          action: "cms.claim.assign",
          resourceType: "cms_claim",
          resourceId: claimId,
          after: { evidence_class: a.evidenceClass, evidence_doc_id: a.evidenceDocId ?? null },
        });
      },
      { action: "cms.claim.assign" },
    );
  }

  async withdrawClaim(ctx: KernelContext, claimId: string): Promise<void> {
    await this.platformOnly(ctx, "cms.claim.withdraw");
    this.allow(ctx, "legal_approve", [LEGAL_REVIEWER, ...EDITOR_ROLES]);
    await this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const r = await tx.query(
          "update cms.claim set status = 'withdrawn', updated_at = now() where id = $1",
          [claimId],
        );
        if (!r.rowCount) throw new NotFoundError("claim");
        await this.o.audit.record(tx, {
          action: "cms.claim.withdraw",
          resourceType: "cms_claim",
          resourceId: claimId,
        });
      },
      { action: "cms.claim.withdraw" },
    );
  }

  // --- Redirects (IPB-04-10; `@IPB-04-AT-08`) -------------------------------------------

  private async redirectRules(tx: Tx, packId: string): Promise<(RedirectRule & { id: string })[]> {
    const r = await tx.query<RedirectRow>(
      `select * from cms.redirect where brand_pack_id = $1 and deleted_at is null and state in ('pending', 'active')`,
      [packId],
    );
    return r.rows.map((x) => ({
      id: x.id,
      from: x.from_path,
      to: x.to_path,
      status: x.status_code,
    }));
  }

  /** Add a manual redirect: checked for loops and chains now, active after maker-checker and legal review. */
  /** A pack's redirects, newest first (Studio's Redirects section, IPB-04-100). */
  async redirects(
    ctx: KernelContext,
    packId: string,
    f: { state?: RedirectSummary["state"] } = {},
  ): Promise<RedirectSummary[]> {
    return this.o.kernel.read(ctx, async (tx) => {
      const r = await tx.query<{
        id: string;
        from_path: string;
        to_path: string | null;
        status_code: 301 | 302 | 410;
        source: RedirectSummary["source"];
        state: RedirectSummary["state"];
        maker_id: string;
        checker_id: string | null;
        legal_reviewer_id: string | null;
        hits: string;
        last_hit_at: Date | null;
        created_at: Date;
      }>(
        `select id, from_path, to_path, status_code, source, state, maker_id, checker_id,
                legal_reviewer_id, hits, last_hit_at, created_at
           from cms.redirect
          where brand_pack_id = $1 and deleted_at is null and ($2::text is null or state = $2)
          order by created_at desc, id desc limit 500`,
        [packId, f.state ?? null],
      );
      return r.rows.map((x) => ({
        id: x.id,
        from: x.from_path,
        to: x.to_path,
        status: x.status_code,
        source: x.source,
        state: x.state,
        makerId: x.maker_id,
        checkerId: x.checker_id,
        legalReviewerId: x.legal_reviewer_id,
        hits: Number(x.hits),
        lastHitAt: x.last_hit_at,
        createdAt: x.created_at,
      }));
    });
  }

  /** The Claims Register (IPB-04-07), by review date. */
  async claims(
    ctx: KernelContext,
    f: { status?: ClaimSummary["status"] } = {},
  ): Promise<ClaimSummary[]> {
    return this.o.kernel.read(ctx, async (tx) => {
      const r = await tx.query<{
        id: string;
        text: string;
        value: string | null;
        unit: string | null;
        as_of: Date;
        evidence_class: ClaimSummary["evidenceClass"];
        kind: ClaimSummary["kind"];
        source_url: string | null;
        owner_id: string;
        review_due: Date;
        status: ClaimSummary["status"];
        created_by: string;
        assigned_by: string | null;
      }>(
        `select id, text, value, unit, as_of, evidence_class, kind, source_url, owner_id,
                review_due, status, created_by, assigned_by
           from cms.claim where ($1::text is null or status = $1)
          order by review_due, id limit 500`,
        [f.status ?? null],
      );
      return r.rows.map((x) => ({
        id: x.id,
        text: x.text,
        value: x.value,
        unit: x.unit,
        asOf: x.as_of,
        evidenceClass: x.evidence_class,
        kind: x.kind,
        sourceUrl: x.source_url,
        ownerId: x.owner_id,
        reviewDue: x.review_due,
        status: x.status,
        createdBy: x.created_by,
        assignedBy: x.assigned_by,
      }));
    });
  }

  async addRedirect(
    ctx: KernelContext,
    packId: string,
    rule: RedirectRule,
  ): Promise<{ id: string }> {
    await this.platformOnly(ctx, "cms.redirect.create");
    this.allow(ctx, "unpublish", EDITOR_ROLES);
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const problems = redirectProblems(await this.redirectRules(tx, packId), rule);
        if (problems.length)
          throw new IpbError("IPB-CMS-009", { detail: problems.join("; "), meta: { problems } });
        const id = newId("rdr");
        await tx.query(
          `insert into cms.redirect (id, brand_pack_id, from_path, to_path, status_code, source, maker_id)
           values ($1, $2, $3, $4, $5, 'manual', $6)`,
          [id, packId, rule.from, rule.to, rule.status, ctx.principal.id],
        );
        await this.o.audit.record(tx, {
          action: "cms.redirect.create",
          resourceType: "cms_redirect",
          resourceId: id,
          after: { ...rule, state: "pending" },
        });
        return { id };
      },
      { action: "cms.redirect.create" },
    );
  }

  /** The checker's or the legal reviewer's approval of a pending redirect; both activate it. */
  async reviewRedirect(
    ctx: KernelContext,
    redirectId: string,
    as: "checker" | "legal",
  ): Promise<{ active: boolean }> {
    await this.platformOnly(ctx, "cms.redirect.review");
    this.allow(
      ctx,
      as === "legal" ? "legal_approve" : "approve",
      as === "legal" ? [LEGAL_REVIEWER] : CHECKER_ROLES,
    );
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const r = await tx.query<RedirectRow>(
          "select * from cms.redirect where id = $1 and deleted_at is null for update",
          [redirectId],
        );
        const x = r.rows[0];
        if (!x || x.state !== "pending") throw new NotFoundError("pending redirect");
        if (
          x.maker_id === ctx.principal.id ||
          x.checker_id === ctx.principal.id ||
          x.legal_reviewer_id === ctx.principal.id
        )
          throw new IpbError("IPB-CMS-004");
        const checker = as === "checker" ? ctx.principal.id : x.checker_id;
        const legal = as === "legal" ? ctx.principal.id : x.legal_reviewer_id;
        const active = Boolean(checker && legal);
        await tx.query(
          `update cms.redirect set checker_id = $2, legal_reviewer_id = $3, state = $4, updated_at = now() where id = $1`,
          [redirectId, checker, legal, active ? "active" : "pending"],
        );
        await this.o.audit.record(tx, {
          action: `cms.redirect.review_${as}`,
          resourceType: "cms_redirect",
          resourceId: redirectId,
          after: { active },
        });
        if (active)
          await emit(
            tx,
            this.deps,
            CMS_EVENTS.RedirectChanged,
            RedirectChangedData.parse({
              redirect_id: x.id,
              from: x.from_path,
              to: x.to_path,
              status: x.status_code,
              change: "activated",
            }),
          );
        return { active };
      },
      { action: `cms.redirect.review_${as}` },
    );
  }

  /**
   * Legacy CSV import (`@IPB-04-AT-08`): a dry run by default, which writes nothing; with
   * `commit: true` the accepted rows become pending redirects awaiting review.
   */
  async importRedirects(
    ctx: KernelContext,
    packId: string,
    csv: string,
    o: { commit?: boolean } = {},
  ): Promise<DryRunReport & { committed: number }> {
    await this.platformOnly(ctx, "cms.redirect.import");
    this.allow(ctx, "unpublish", EDITOR_ROLES);
    if (!o.commit) {
      const existing = await this.o.kernel.read(ctx, (tx) => this.redirectRules(tx, packId));
      return { ...dryRun(existing, csv), committed: 0 };
    }
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const report = dryRun(await this.redirectRules(tx, packId), csv);
        for (const row of report.accepted)
          await tx.query(
            `insert into cms.redirect (id, brand_pack_id, from_path, to_path, status_code, source, maker_id)
             values ($1, $2, $3, $4, $5, 'legacy_import', $6)`,
            [newId("rdr"), packId, row.rule.from, row.rule.to, row.rule.status, ctx.principal.id],
          );
        await this.o.audit.record(tx, {
          action: "cms.redirect.import",
          resourceType: "brand_pack",
          resourceId: packId,
          after: {
            committed: report.accepted.length,
            conflicts: report.conflicts.length,
            loops: report.loops.length,
            chains: report.chains.length,
            invalid: report.invalid.length,
          },
        });
        return { ...report, committed: report.accepted.length };
      },
      { action: "cms.redirect.import" },
    );
  }

  /** Redirect hits, flushed in batches by the site (one ledger entry per flush). */
  async recordRedirectHits(
    ctx: KernelContext,
    hits: Readonly<Record<string, number>>,
  ): Promise<void> {
    const ids = Object.keys(hits).filter((k) => Number.isInteger(hits[k]) && hits[k]! > 0);
    if (!ids.length) return;
    await this.o.kernel.mutate(
      ctx,
      async (tx) => {
        for (const id of ids)
          await tx.query(
            "update cms.redirect set hits = hits + $2, last_hit_at = now() where id = $1",
            [id, hits[id]],
          );
        await this.o.audit.record(tx, {
          action: "cms.redirect.hits",
          resourceType: "cms_redirect",
          resourceId: "batch",
          after: { redirects: ids.length, hits: ids.reduce((s, k) => s + hits[k]!, 0) },
        });
      },
      { action: "cms.redirect.hits" },
    );
  }

  // --- Preview (IPB-04-05; `@IPB-04-AT-05`) ---------------------------------------------

  /**
   * A preview link for a revision (the current one by default): a random 32-byte token, stored
   * only as its SHA-256, valid for `cms.preview.ttl_hours` (at most 24), revocable.
   */
  async createPreview(
    ctx: KernelContext,
    itemId: string,
    revisionId?: string,
  ): Promise<{ token: string; path: string; expiresAt: Date }> {
    await this.platformOnly(ctx, "cms.preview.create");
    this.allow(ctx, "unpublish", EDITOR_ROLES);
    const ttl = Math.min(await this.setting<number>(ctx, "cms.preview.ttl_hours", 24), 24);
    const token = Buffer.from(randomBytes(32)).toString("base64url");
    const expiresAt = new Date(this.now().getTime() + ttl * 3_600_000);
    await this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const item = await loadItem(tx, itemId);
        const rev = await loadRevision(tx, revisionId ?? item.current_revision_id);
        if (rev.content_item_id !== itemId) throw new NotFoundError("revision");
        const id = newId("prv");
        await tx.query(
          `insert into cms.preview_token (id, token_sha256, content_item_id, revision_id, created_by, expires_at, created_at)
           values ($1, $2, $3, $4, $5, $6, $7)`,
          [id, sha256Hex(token), itemId, rev.id, ctx.principal.id, expiresAt, this.now()],
        );
        await this.o.audit.record(tx, {
          action: "cms.preview.create",
          resourceType: "cms_content",
          resourceId: itemId,
          after: { preview_id: id, revision_id: rev.id, expires_at: expiresAt.toISOString() },
        });
      },
      { action: "cms.preview.create" },
    );
    return { token, path: `/preview/${token}`, expiresAt };
  }

  async revokePreview(ctx: KernelContext, itemId: string): Promise<number> {
    await this.platformOnly(ctx, "cms.preview.revoke");
    this.allow(ctx, "unpublish", EDITOR_ROLES);
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const r = await tx.query(
          "update cms.preview_token set revoked_at = now() where content_item_id = $1 and revoked_at is null",
          [itemId],
        );
        await this.o.audit.record(tx, {
          action: "cms.preview.revoke",
          resourceType: "cms_content",
          resourceId: itemId,
          after: { revoked: r.rowCount ?? 0 },
        });
        return r.rowCount ?? 0;
      },
      { action: "cms.preview.revoke" },
    );
  }
}
