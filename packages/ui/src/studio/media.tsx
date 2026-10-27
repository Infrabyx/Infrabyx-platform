// Media (IPB-04-100; IPB-04-10, 04-11, 04-101): the library, the alt-text queue, uploads with alt
// text or a decorative reason, and deletion (refused by the service while the file is in use).
import { Button, Field } from "../components/forms.js";
import { DataTable } from "../components/data.js";
import { FieldProblem, required, run, text, when } from "./form.js";
import { errorFor, Hidden, StudioPage, StudioSectionBox, studioPath } from "./layout.js";
import type { FormAction, ScreenProps, StudioResult } from "./types.js";

export interface StudioMedia {
  id: string;
  kind: string;
  mime: string;
  bytes: number;
  altText: string | null;
  decorative: boolean;
  createdAt: Date;
}

export interface MediaReader<C> {
  list(ctx: C, f?: { kind?: string; missingAlt?: boolean }): Promise<StudioMedia[]>;
}

export interface MediaWriter<C> {
  upload(
    ctx: C,
    u: { mime: string; bytes: Uint8Array; altText?: string; decorative?: { reason: string } },
  ): Promise<{ id: string; removed: string[]; deduplicated: boolean }>;
  describe(
    ctx: C,
    mediaId: string,
    d: { altText: string } | { decorative: true; reason: string },
  ): Promise<void>;
  softDelete(ctx: C, mediaId: string): Promise<void>;
}

const size = (n: number) =>
  n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;

export async function MediaScreen<C>(
  p: ScreenProps<C> & {
    media: MediaReader<C>;
    missingAlt?: boolean;
    actions: { upload: FormAction; describe: FormAction; remove: FormAction };
  },
) {
  const items = await p.media.list(p.ctx, p.missingAlt ? { missingAlt: true } : {});
  const err = (id: string) => errorFor(p.errors, id);
  return (
    <StudioPage base={p.base} section="media" title="Media" flash={p.flash} errors={p.errors}>
      <p>
        {p.missingAlt ? (
          <a href={studioPath(p.base, "media")}>Show all media</a>
        ) : (
          <a href={`${studioPath(p.base, "media")}?missingAlt=1`}>
            Show only images without alt text
          </a>
        )}
      </p>
      <DataTable
        caption={`${p.missingAlt ? "Images without alt text" : "Media"}: ${items.length}`}
        columns={[
          { key: "id", header: "File", rowHeader: true },
          { key: "kind", header: "Kind" },
          { key: "size", header: "Size", numeric: true },
          { key: "alt", header: "Alt text" },
          { key: "at", header: "Uploaded" },
          { key: "action", header: "Action" },
        ]}
        rows={items.map((m) => ({
          id: m.id,
          kind: `${m.kind} (${m.mime})`,
          size: size(m.bytes),
          alt: m.decorative ? "Decorative" : (m.altText ?? "Missing"),
          at: when(m.createdAt),
          action: (
            <>
              <form method="post" action={p.actions.describe} noValidate>
                <Hidden values={{ mediaId: m.id }} />
                <Field
                  id={`f-alt-${m.id}`}
                  name="altText"
                  label={`Alt text for ${m.id}`}
                  helpKey="hlp.studio.alt_text"
                  defaultValue={m.altText ?? ""}
                  error={err(`f-alt-${m.id}`)}
                />
                <Button type="submit" variant="ghost">
                  Save alt text
                </Button>
              </form>
              <form method="post" action={p.actions.remove}>
                <Hidden values={{ mediaId: m.id }} />
                <Button type="submit" variant="danger">
                  Delete {m.id}
                </Button>
              </form>
            </>
          ),
        }))}
      />
      <StudioSectionBox id="upload" title="Upload">
        <form method="post" action={p.actions.upload} encType="multipart/form-data" noValidate>
          <div className={`ibx-field${err("f-file") ? " ibx-field--error" : ""}`}>
            <label className="ibx-field__label" htmlFor="f-file">
              File
            </label>
            {err("f-file") ? (
              <p className="ibx-field__error" id="f-file-error">
                {err("f-file")}
              </p>
            ) : null}
            <input
              className="ibx-field__input"
              id="f-file"
              name="file"
              type="file"
              aria-describedby={err("f-file") ? "f-file-error" : undefined}
              data-help-key="hlp.studio.media_file"
            />
          </div>
          <Field
            id="f-altText"
            name="altText"
            label="Alt text"
            helpKey="hlp.studio.alt_text"
            hint="What the image shows, for people who cannot see it."
            error={err("f-altText")}
          />
          <Field
            id="f-decorative"
            name="decorative"
            label="Or: why the image is decorative"
            helpKey="hlp.studio.decorative_reason"
            error={err("f-decorative")}
          />
          <Button type="submit" variant="primary">
            Upload
          </Button>
        </form>
      </StudioSectionBox>
    </StudioPage>
  );
}

export function mediaHandlers<C>(media: MediaWriter<C>, o: { maxBytes?: number } = {}) {
  const max = o.maxBytes ?? 25 * 1048576;
  return {
    async upload(ctx: C, fd: FormData): Promise<StudioResult> {
      return run(async () => {
        const f = fd.get("file");
        if (!f || typeof f === "string" || f.size === 0)
          throw new FieldProblem([{ fieldId: "f-file", message: "Choose a file." }]);
        if (f.size > max)
          throw new FieldProblem([{ fieldId: "f-file", message: "The file is too large." }]);
        const altText = text(fd, "altText");
        const reason = text(fd, "decorative");
        const r = await media.upload(ctx, {
          mime: f.type || "application/octet-stream",
          bytes: new Uint8Array(await f.arrayBuffer()),
          ...(altText ? { altText } : {}),
          ...(reason && !altText ? { decorative: { reason } } : {}),
        });
        return {
          flash: {
            tone: r.removed.length ? "warning" : "success",
            title: r.deduplicated ? "Already in the library" : "Uploaded",
            ...(r.removed.length ? { detail: `Removed: ${r.removed.join(", ")}.` } : {}),
          },
        };
      });
    },
    async describe(ctx: C, fd: FormData): Promise<StudioResult> {
      return run(async () => {
        const id = required(fd, "mediaId", "a file");
        const altText = text(fd, "altText");
        if (!altText)
          throw new FieldProblem([{ fieldId: `f-alt-${id}`, message: "Enter the alt text." }]);
        await media.describe(ctx, id, { altText });
        return { flash: { tone: "success", title: "Alt text saved" } };
      });
    },
    async remove(ctx: C, fd: FormData): Promise<StudioResult> {
      return run(async () => {
        await media.softDelete(ctx, required(fd, "mediaId", "a file"));
        return { flash: { tone: "success", title: "Deleted; it can be restored for 90 days" } };
      });
    },
  };
}
