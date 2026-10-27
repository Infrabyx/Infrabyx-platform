// Form handlers of the Brand screens (`BrandStudio` satisfies `BrandWriter`; method parameters are
// checked bivariantly, so the package's narrower types fit these wider ones).
import { FieldProblem, json, oneOf, required, run } from "./form.js";
import { studioPath } from "./layout.js";
import type { StudioResult } from "./types.js";

export interface BrandWriter<C> {
  createPack(
    ctx: C,
    input: { product: string; label: string; isDefault?: boolean },
  ): Promise<{ id: string }>;
  saveDraft(
    ctx: C,
    packId: string,
    input: { body: unknown; hosts: readonly unknown[] },
  ): Promise<unknown>;
  uploadLogo(ctx: C, packId: string, upload: string | Uint8Array): Promise<{ removed: string[] }>;
  submit(ctx: C, revisionId: string): Promise<unknown>;
  legalReview(ctx: C, revisionId: string): Promise<unknown>;
  approve(ctx: C, revisionId: string): Promise<unknown>;
  reject(ctx: C, revisionId: string, reason: string): Promise<unknown>;
  requestRollback(ctx: C, packId: string, toRevisionId: string): Promise<unknown>;
}

const MAX_LOGO = 512 * 1024;

export function brandHandlers<C>(brand: BrandWriter<C>, o: { base: string }) {
  return {
    async create(ctx: C, fd: FormData): Promise<StudioResult> {
      return run(async () => {
        const r = await brand.createPack(ctx, {
          product: required(fd, "product", "a product"),
          label: required(fd, "label", "a name"),
          isDefault: fd.get("isDefault") === "yes",
        });
        return {
          flash: { tone: "success", title: "Pack created" },
          redirectTo: studioPath(o.base, "brand", r.id),
        };
      });
    },

    async save(ctx: C, fd: FormData): Promise<StudioResult> {
      return run(
        async () => {
          const hosts = json(fd, "hosts", "Hosts", []);
          if (!Array.isArray(hosts))
            throw new FieldProblem([{ fieldId: "f-hosts", message: "Hosts must be a JSON list." }]);
          await brand.saveDraft(ctx, required(fd, "packId", "a pack"), {
            body: json(fd, "body", "The pack"),
            hosts,
          });
          return { flash: { tone: "success", title: "Draft saved; the contrast guard passed" } };
        },
        (path) => (path.startsWith("hosts") ? "f-hosts" : "f-body"),
      );
    },

    async logo(ctx: C, fd: FormData): Promise<StudioResult> {
      return run(async () => {
        const f = fd.get("logo");
        if (!f || typeof f === "string" || f.size === 0)
          throw new FieldProblem([{ fieldId: "f-logo", message: "Choose an SVG file." }]);
        if (f.size > MAX_LOGO)
          throw new FieldProblem([
            { fieldId: "f-logo", message: "The logo must be under 512 KB." },
          ]);
        const r = await brand.uploadLogo(
          ctx,
          required(fd, "packId", "a pack"),
          new Uint8Array(await f.arrayBuffer()),
        );
        return {
          flash: {
            tone: r.removed.length ? "warning" : "success",
            title: "Logo uploaded",
            ...(r.removed.length
              ? { detail: `The sanitiser removed: ${r.removed.join(", ")}.` }
              : {}),
          },
        };
      });
    },

    async workflow(ctx: C, fd: FormData): Promise<StudioResult> {
      return run(async () => {
        const id = required(fd, "revisionId", "a revision");
        const op = oneOf(fd, "op", [
          "submit",
          "legal_review",
          "approve",
          "reject",
          "rollback",
        ] as const);
        const done = (title: string): StudioResult => ({ flash: { tone: "success", title } });
        switch (op) {
          case "submit":
            await brand.submit(ctx, id);
            return done("Submitted for approval");
          case "legal_review":
            await brand.legalReview(ctx, id);
            return done("Legal review recorded");
          case "approve":
            await brand.approve(ctx, id);
            return done("Approved and published");
          case "reject":
            await brand.reject(ctx, id, required(fd, "reason", "why"));
            return done("Rejected");
          case "rollback":
            await brand.requestRollback(ctx, required(fd, "packId", "a pack"), id);
            return done("Rollback submitted for approval");
        }
      });
    },
  };
}
