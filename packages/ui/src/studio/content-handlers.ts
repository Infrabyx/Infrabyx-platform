// Form handlers of the content screens: read the posted form, call the `cms` Studio service and
// say what happened. The app wraps each in its server action (or POST route) and redirects with
// `encodeResult` (post-redirect-get, no JavaScript needed).
import { FieldProblem, json, oneOf, required, run, text } from "./form.js";
import { studioPath, type StudioSection } from "./layout.js";
import type { StudioItem } from "./content.js";
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
