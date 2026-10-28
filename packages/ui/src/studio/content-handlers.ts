// Form handlers of the content screens: read the posted form, call the `cms` Studio service and
// say what happened. The app wraps each in its server action (or POST route) and redirects with
// `encodeResult` (post-redirect-get, no JavaScript needed).
import {
  applyBlockOp,
  blockFieldOf,
  blockOpFromForm,
  insertAt,
  type Block,
  type BlockEditorOptions,
  type BlockOp,
} from "./block-editor.js";
import { FieldProblem, json, oneOf, required, run, text } from "./form.js";
import { studioPath, type StudioSection } from "./layout.js";
import type { ContentReader, StudioItem } from "./content.js";
import type { StudioResult } from "./types.js";

/** What the content handlers call (`CmsStudio` satisfies it). */
export interface ContentWriter<C> {
  createItem(
    ctx: C,
    input: {
      type: string;
      packId: string;
      title: string;
      slug?: string | null;
      body: unknown;
      seo?: unknown;
    },
  ): Promise<{ item: StudioItem; warnings: string[]; removed: string[] }>;
  saveDraft(
    ctx: C,
    itemId: string,
    input: { title: string; slug?: string | null; body: unknown; seo?: unknown; summary?: string },
  ): Promise<{ item: StudioItem; warnings: string[]; removed: string[] }>;
  submit(ctx: C, itemId: string): Promise<unknown>;
  requestChanges(ctx: C, itemId: string, reason: string): Promise<unknown>;
  legalApprove(ctx: C, itemId: string): Promise<unknown>;
  approve(ctx: C, itemId: string): Promise<unknown>;
  schedule(ctx: C, itemId: string, at: { publishAt: Date; unpublishAt?: Date }): Promise<unknown>;
  unschedule(ctx: C, itemId: string): Promise<unknown>;
  publishNow(ctx: C, itemId: string): Promise<unknown>;
  unpublish(
    ctx: C,
    itemId: string,
    o: { behaviour: "gone" | "redirect"; to?: string },
  ): Promise<unknown>;
  requestRollback(ctx: C, itemId: string, toRevisionId: string): Promise<unknown>;
  softDelete(
    ctx: C,
    itemId: string,
    reason: string,
  ): Promise<{ deleted: boolean; pendingApproval?: string }>;
  restore(ctx: C, itemId: string): Promise<unknown>;
  markReviewed(ctx: C, itemId: string): Promise<unknown>;
  createPreview(
    ctx: C,
    itemId: string,
    revisionId?: string,
  ): Promise<{ token: string; path: string; expiresAt: Date }>;
  revokePreview(ctx: C, itemId: string): Promise<number>;
}

const FIELD: Readonly<Record<string, string>> = { title: "f-title", slug: "f-slug", seo: "f-seo" };
const fieldOf = (path: string) => FIELD[path.split(".")[0] ?? ""] ?? (path ? "f-body" : undefined);

/** `2026-11-01T09:30` from a datetime-local input, read as UTC; anything else is a field error. */
export function utc(v: string | undefined, fieldId: string): Date | undefined {
  if (!v) return undefined;
  const m = /^(\d{4}-\d\d-\d\dT\d\d:\d\d)(:\d\d)?$/.exec(v);
  const d = m ? new Date(`${m[1]}${m[2] ?? ":00"}Z`) : new Date(NaN);
  if (Number.isNaN(d.getTime()))
    throw new FieldProblem([{ fieldId, message: "Enter a date and time." }]);
  return d;
}

const saved = (title: string, r: { warnings: string[]; removed: string[] }): StudioResult => ({
  flash: {
    tone: r.warnings.length || r.removed.length ? "warning" : "success",
    title,
    ...(r.warnings.length || r.removed.length
      ? {
          detail: [
            r.removed.length ? `Removed by the sanitiser: ${r.removed.join(", ")}.` : "",
            r.warnings.join(" "),
          ]
            .filter(Boolean)
            .join(" "),
        }
      : {}),
  },
});

const MOVES = [
  "submit",
  "request_changes",
  "legal_approve",
  "approve",
  "schedule",
  "unschedule",
  "publish_now",
  "unpublish",
  "rollback",
  "delete",
  "restore",
  "mark_reviewed",
] as const;

export function contentHandlers<C>(
  cms: ContentWriter<C>,
  o: { base: string; section: StudioSection },
) {
  return {
    async create(ctx: C, fd: FormData): Promise<StudioResult> {
      return run(async () => {
        const r = await cms.createItem(ctx, {
          type: required(fd, "type", "a type"),
          packId: required(fd, "packId", "a pack"),
          title: required(fd, "title", "a title"),
          slug: text(fd, "slug") ?? null,
          body: json(fd, "body", "The body", {}),
        });
        return {
          ...saved("Draft created", r),
          redirectTo: studioPath(o.base, o.section, r.item.id),
        };
      }, fieldOf);
    },

    async save(ctx: C, fd: FormData): Promise<StudioResult> {
      return run(async () => {
        const summary = text(fd, "summary");
        const r = await cms.saveDraft(ctx, required(fd, "itemId", "an item"), {
          title: required(fd, "title", "a title"),
          slug: text(fd, "slug") ?? null,
          body: json(fd, "body", "The body"),
          seo: json(fd, "seo", "Search and sharing", {}),
          ...(summary ? { summary } : {}),
        });
        return saved("Draft saved", r);
      }, fieldOf);
    },

    async workflow(ctx: C, fd: FormData): Promise<StudioResult> {
      return run(async () => {
        const id = required(fd, "itemId", "an item");
        const op = oneOf(fd, "op", MOVES);
        const done = (title: string): StudioResult => ({ flash: { tone: "success", title } });
        switch (op) {
          case "submit":
            await cms.submit(ctx, id);
            return done("Submitted for review");
          case "request_changes":
            await cms.requestChanges(ctx, id, required(fd, "reason", "what needs to change"));
            return done("Changes requested; the item is back in draft");
          case "legal_approve":
            await cms.legalApprove(ctx, id);
            return done("Legal approval recorded; a checker approves next");
          case "approve":
            await cms.approve(ctx, id);
            return done("Approved");
          case "schedule": {
            const unpublishAt = utc(text(fd, "unpublishAt"), "f-unpublishAt");
            await cms.schedule(ctx, id, {
              publishAt: utc(required(fd, "publishAt", "when to publish"), "f-publishAt")!,
              ...(unpublishAt ? { unpublishAt } : {}),
            });
            return done("Scheduled");
          }
          case "unschedule":
            await cms.unschedule(ctx, id);
            return done("Schedule cancelled");
          case "publish_now":
            await cms.publishNow(ctx, id);
            return done("Published");
          case "unpublish": {
            const behaviour = oneOf(fd, "behaviour", ["gone", "redirect"] as const);
            const to = text(fd, "to");
            await cms.unpublish(ctx, id, { behaviour, ...(to ? { to } : {}) });
            return done("Unpublished");
          }
          case "rollback":
            await cms.requestRollback(ctx, id, required(fd, "revisionId", "a revision"));
            return done("Rollback requested; it is a new draft for review");
          case "delete": {
            const r = await cms.softDelete(ctx, id, required(fd, "reason", "why"));
            return r.deleted
              ? done("Deleted; it can be restored for 90 days")
              : { flash: { tone: "info", title: "Deletion waits for a checker's approval" } };
          }
          case "restore":
            await cms.restore(ctx, id);
            return done("Restored");
          case "mark_reviewed":
            await cms.markReviewed(ctx, id);
            return done("Marked as reviewed");
        }
      });
    },

    async preview(ctx: C, fd: FormData): Promise<StudioResult> {
      return run(async () => {
        const id = required(fd, "itemId", "an item");
        if (oneOf(fd, "op", ["create", "revoke"] as const) === "revoke") {
          const n = await cms.revokePreview(ctx, id);
          return { flash: { tone: "success", title: `${n} preview link(s) revoked` } };
        }
        const r = await cms.createPreview(ctx, id);
        return {
          flash: {
            tone: "success",
            title: "Preview link created",
            detail: `It works until ${r.expiresAt.toISOString().slice(0, 16).replace("T", " ")} UTC.`,
          },
          reveal: r.path,
        };
      });
    },
  };
}

const BLOCK_DONE: Readonly<Record<BlockOp["op"], string>> = {
  add: "Block added",
  remove: "Block removed",
  move: "Block moved",
  update: "Block saved",
};

/**
 * The block editor's handler (PR-038). It applies one posted operation to the blocks of the item's
 * current revision and saves the result as a new draft, the same `saveDraft` the JSON editor
 * calls, so the service checks the whole body and voids approvals as before. A post made against
 * an older revision is refused, so two editors cannot overwrite each other's blocks by position.
 */
export function blockHandlers<C>(
  cms: ContentReader<C> & ContentWriter<C>,
  options: BlockEditorOptions,
) {
  return {
    async blocks(ctx: C, fd: FormData): Promise<StudioResult> {
      let added: { at: number; ref: boolean } | undefined;
      const fieldOf = (path: string) => {
        if (added && path.startsWith(`blocks[${added.at}]`))
          return added.ref ? "f-block-ref" : "f-block-type";
        return blockFieldOf(path) ?? (path ? "blocks" : undefined);
      };
      return run(async () => {
        const id = required(fd, "itemId", "an item");
        const item = await cms.get(ctx, id);
        if (text(fd, "revisionId") !== item.currentRevisionId)
          throw new FieldProblem([
            {
              fieldId: "blocks",
              message:
                "The page has changed since you opened it. Reload it and make the change again.",
            },
          ]);
        const rev = await cms.revision(ctx, item.currentRevisionId);
        if (!Array.isArray(rev.body.blocks))
          throw new FieldProblem([{ fieldId: "blocks", message: "This item has no blocks." }]);
        const blocks = rev.body.blocks as Block[];
        const op = blockOpFromForm(fd, blocks, options);
        if (op.op === "add")
          added = {
            at: insertAt(blocks.length, op.at),
            ref: options.specs.some((s) => s.type === op.type && s.ref),
          };
        const next = applyBlockOp(blocks, op, options);
        const n = op.op === "add" ? added!.at + 1 : op.index + 1;
        const r = await cms.saveDraft(ctx, id, {
          title: rev.title,
          slug: rev.slug,
          body: { ...rev.body, blocks: next },
          seo: rev.seo,
          summary: `${BLOCK_DONE[op.op]} (block ${n})`,
        });
        return saved(BLOCK_DONE[op.op], r);
      }, fieldOf);
    },
  };
}
