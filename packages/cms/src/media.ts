// Media library (IPB-04-11; `@IPB-04-AT-09`; PL5 plan §5.3). Uploads are stored in STORAGE once
// per SHA-256 (deduplicated). SVGs go through the brand sanitiser and only the result is stored;
// EXIF, XMP and text metadata are stripped from JPEG and PNG files; alt text is required for every
// image unless it is marked decorative with a reason. Raster re-encoding (OWNER-QUESTIONS #53,
// PL5-D-11): with a MEDIA port that can re-encode and `cms.media.reencode_enabled` on (the default),
// each JPEG, PNG, WebP or AVIF upload also gets AVIF, WebP and a JPEG or PNG fallback at the fixed
// widths; an image the port cannot decode, or one above the pixel limit, is refused. Without such a
// port (`passthrough`, or `sharp` not installed) uploads are served as uploaded.
import { IpbError } from "@infrabyx/contracts/errors";
import { PLATFORM_TENANT_ID } from "@infrabyx/contracts/ids";
import type { AuditSink, KernelContext, MutationKernel } from "@infrabyx/contracts/kernel";
import {
  MEDIA_REENCODE_SOURCES,
  MEDIA_RENDITION_WIDTHS,
  storageKey,
  type MediaFormat,
  type MediaPort,
  type MediaRendition,
  type StoragePort,
} from "@infrabyx/contracts/ports";
import { newId, sha256Hex, ulid } from "@infrabyx/crypto";
import { sanitiseSvg } from "@infrabyx/brand";
import { NotFoundError } from "@infrabyx/tenancy";
import type { SettingsReader } from "./studio.js";

export type MediaKind = "image" | "svg" | "video" | "pdf" | "other";

const MIME_KIND: Record<string, MediaKind> = {
  "image/jpeg": "image",
  "image/png": "image",
  "image/webp": "image",
  "image/avif": "image",
  "image/gif": "image",
  "image/svg+xml": "svg",
  "application/pdf": "pdf",
  "video/mp4": "video",
};

/** JPEG without APP1 (EXIF, XMP) and APP13 (IPTC) segments; the image data is untouched. */
export function stripJpegMetadata(b: Uint8Array): { bytes: Uint8Array; removed: string[] } {
  if (b[0] !== 0xff || b[1] !== 0xd8) return { bytes: b, removed: [] };
  const out: number[] = [0xff, 0xd8];
  const removed: string[] = [];
  let i = 2;
  while (i + 4 <= b.length && b[i] === 0xff) {
    const marker = b[i + 1]!;
    if (marker === 0xda) break; // start of scan: the rest is image data
    const len = (b[i + 2]! << 8) | b[i + 3]!;
    const end = i + 2 + len;
    if (marker === 0xe1 || marker === 0xed)
      removed.push(marker === 0xe1 ? "EXIF/XMP (APP1)" : "IPTC (APP13)");
    else for (let k = i; k < end && k < b.length; k++) out.push(b[k]!);
    i = end;
  }
  const bytes = new Uint8Array(out.length + (b.length - i));
  bytes.set(out, 0);
  bytes.set(b.subarray(i), out.length);
  return { bytes, removed };
}

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PNG_DROP = new Set(["eXIf", "tEXt", "iTXt", "zTXt", "tIME"]);

/** PNG without metadata chunks (eXIf, tEXt, iTXt, zTXt, tIME). */
export function stripPngMetadata(b: Uint8Array): { bytes: Uint8Array; removed: string[] } {
  if (!PNG_SIG.every((v, k) => b[k] === v)) return { bytes: b, removed: [] };
  const parts: Uint8Array[] = [b.subarray(0, 8)];
  const removed: string[] = [];
  let i = 8;
  while (i + 12 <= b.length) {
    const len = ((b[i]! << 24) | (b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!) >>> 0;
    const type = String.fromCharCode(b[i + 4]!, b[i + 5]!, b[i + 6]!, b[i + 7]!);
    const end = i + 12 + len;
    if (PNG_DROP.has(type)) removed.push(`${type} chunk`);
    else parts.push(b.subarray(i, end));
    i = end;
  }
  const total = parts.reduce((n, p) => n + p.length, 0);
  const bytes = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    bytes.set(p, o);
    o += p.length;
  }
  return { bytes, removed };
}

export interface MediaUpload {
  mime: string;
  bytes: Uint8Array;
  altText?: string;
  decorative?: { reason: string };
  licenceNote?: string;
  /** A gated resource file: stored in a private bucket and served only by presigned URL. */
  gated?: boolean;
}

/** A stored rendition (`cms.media.renditions`). */
export interface RenditionRef {
  format: MediaFormat;
  mime: string;
  width: number;
  height: number;
  key: string;
  sha256: string;
  bytes: number;
}

export interface MediaRecord {
  id: string;
  kind: MediaKind;
  sha256: string;
  storageKey: string;
  removed: string[];
  deduplicated: boolean;
  renditions: RenditionRef[];
}

/** One row of the media library. */
export interface MediaSummary {
  id: string;
  kind: MediaKind;
  mime: string;
  bytes: number;
  altText: string | null;
  decorative: boolean;
  createdAt: Date;
}

/** What a page needs to render a `<picture>`: one source per modern format, then the fallback. */
export interface MediaSources {
  mime: string;
  key: string;
  alt: string;
  decorative: boolean;
  width: number | null;
  height: number | null;
  sources: { mime: string; srcset: { key: string; width: number }[] }[];
  fallback: { mime: string; srcset: { key: string; width: number }[] } | null;
}

/** The fallback format: PNG keeps transparency, everything else falls back to JPEG. */
const fallbackFormat = (mime: string): MediaFormat => (mime === "image/png" ? "png" : "jpeg");

export class MediaLibrary {
  constructor(
    private readonly o: {
      kernel: MutationKernel;
      audit: AuditSink;
      storage: StoragePort;
      maxUploadMb?: number;
      /** MEDIA port for re-encoding (#53); without one, uploads are served as uploaded. */
      media?: MediaPort;
      /** Reads `cms.media.reencode_enabled` (default on, #53). */
      settings?: SettingsReader;
      widths?: readonly number[];
    },
  ) {}

  private async reencodeOn(ctx: KernelContext): Promise<boolean> {
    const port = this.o.media;
    if (!port || port.descriptor.capabilities?.reencode === "unsupported") return false;
    const v = await this.o.settings?.get(ctx, "cms.media.reencode_enabled");
    return v === undefined ? true : v === true;
  }

  /** Renditions for a raster upload, or none when re-encoding is off or the port cannot load. */
  private async renditions(
    ctx: KernelContext,
    mime: string,
    bytes: Uint8Array,
  ): Promise<MediaRendition[]> {
    if (!(MEDIA_REENCODE_SOURCES as readonly string[]).includes(mime)) return [];
    if (!(await this.reencodeOn(ctx))) return [];
    try {
      return await this.o.media!.reencode({
        bytes,
        mime,
        widths: this.o.widths ?? MEDIA_RENDITION_WIDTHS,
        formats: ["avif", "webp", fallbackFormat(mime)],
      });
    } catch (e) {
      // `sharp` not installed: served as uploaded. Undecodable or oversized images are refused.
      if ((e as { code?: string }).code === "IPB-PORT-001") return [];
      throw e;
    }
  }

  private platformOnly(ctx: KernelContext): void {
    if (ctx.scope !== "platform" || ctx.tenantId !== PLATFORM_TENANT_ID)
      throw new IpbError("IPB-UX-011", {
        detail: "the media library is used in a platform context",
      });
  }

  /** Upload a file: cleaned, stored once by SHA-256, recorded with alt text or a decorative reason. */
  async upload(ctx: KernelContext, u: MediaUpload): Promise<MediaRecord> {
    this.platformOnly(ctx);
    const kind = MIME_KIND[u.mime];
    if (!kind) throw new IpbError("IPB-SEC-014", { detail: `${u.mime} is not accepted` });
    if (u.bytes.length > (this.o.maxUploadMb ?? 200) * 1024 * 1024)
      throw new IpbError("IPB-SEC-013");
    let bytes = u.bytes;
    let removed: string[] = [];
    if (kind === "svg") {
      const s = sanitiseSvg(u.bytes);
      bytes = new TextEncoder().encode(s.svg);
      removed = s.removed;
    } else if (u.mime === "image/jpeg") ({ bytes, removed } = stripJpegMetadata(u.bytes));
    else if (u.mime === "image/png") ({ bytes, removed } = stripPngMetadata(u.bytes));
    const sha256 = sha256Hex(bytes);
    const rendered = kind === "image" ? await this.renditions(ctx, u.mime, bytes) : [];
    const bucketClass = u.gated ? "GENERAL" : "PUBLIC_ASSETS";
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const dup = await tx.query<{ id: string; storage_key: string; renditions: RenditionRef[] }>(
          "select id, storage_key, renditions from cms.media where sha256 = $1 and deleted_at is null",
          [sha256],
        );
        if (dup.rows[0])
          return {
            id: dup.rows[0].id,
            kind,
            sha256,
            storageKey: dup.rows[0].storage_key,
            removed,
            deduplicated: true,
            renditions: dup.rows[0].renditions,
          };
        const key = storageKey(
          PLATFORM_TENANT_ID,
          "cms",
          ulid(),
          u.mime.split("/")[1]!.replace("svg+xml", "svg"),
        );
        await this.o.storage.put(key, bytes, {
          contentType: u.mime,
          bucketClass,
          sha256,
          tags: { cms_media: "1" },
        });
        const renditions: RenditionRef[] = [];
        for (const r of rendered) {
          const rKey = storageKey(PLATFORM_TENANT_ID, "cms", ulid(), r.format);
          const rSha = sha256Hex(r.bytes);
          await this.o.storage.put(rKey, r.bytes, {
            contentType: r.mime,
            bucketClass,
            sha256: rSha,
            tags: { cms_media: "1", rendition: "1" },
          });
          renditions.push({
            format: r.format,
            mime: r.mime,
            width: r.width,
            height: r.height,
            key: rKey,
            sha256: rSha,
            bytes: r.bytes.length,
          });
        }
        const id = newId("med");
        await tx.query(
          `insert into cms.media (id, kind, storage_key, sha256, mime, bytes, alt_text, decorative, decorative_reason,
             licence_note, sanitiser_report, uploaded_by, renditions)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13::jsonb)`,
          [
            id,
            kind,
            key,
            sha256,
            u.mime,
            bytes.length,
            u.altText?.trim() || null,
            Boolean(u.decorative),
            u.decorative?.reason ?? null,
            u.licenceNote ?? null,
            JSON.stringify(removed),
            ctx.principal.id,
            JSON.stringify(renditions),
          ],
        );
        await this.o.audit.record(tx, {
          action: "cms.media.upload",
          resourceType: "cms_media",
          resourceId: id,
          after: {
            kind,
            sha256,
            bytes: bytes.length,
            removed: removed.length,
            alt: Boolean(u.altText),
            renditions: renditions.length,
          },
        });
        return { id, kind, sha256, storageKey: key, removed, deduplicated: false, renditions };
      },
      { action: "cms.media.upload" },
    );
  }

  /** Set alt text, or mark the image decorative with a reason (the alt-text queue). */
  async describe(
    ctx: KernelContext,
    mediaId: string,
    d: { altText: string } | { decorative: true; reason: string },
  ): Promise<void> {
    this.platformOnly(ctx);
    if ("altText" in d && !d.altText.trim()) throw new IpbError("IPB-CMS-007");
    await this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const r = await tx.query(
          `update cms.media set alt_text = $2, decorative = $3, decorative_reason = $4, updated_at = now()
            where id = $1 and deleted_at is null`,
          "altText" in d
            ? [mediaId, d.altText.trim(), false, null]
            : [mediaId, null, true, d.reason],
        );
        if (!r.rowCount) throw new NotFoundError("media");
        await this.o.audit.record(tx, {
          action: "cms.media.describe",
          resourceType: "cms_media",
          resourceId: mediaId,
          after: "altText" in d ? { alt: true } : { decorative: true },
        });
      },
      { action: "cms.media.describe" },
    );
  }

  /**
   * The sources for a `<picture>` (IPB-04-11): AVIF, then WebP, each as a `srcset` by width, then
   * the fallback rendition or, without renditions, the file as uploaded.
   */
  async sources(ctx: KernelContext, mediaId: string): Promise<MediaSources> {
    const r = await this.o.kernel.read(ctx, async (tx) => {
      const q = await tx.query<{
        mime: string;
        storage_key: string;
        alt_text: string | null;
        decorative: boolean;
        renditions: RenditionRef[];
      }>(
        "select mime, storage_key, alt_text, decorative, renditions from cms.media where id = $1 and deleted_at is null",
        [mediaId],
      );
      if (!q.rows[0]) throw new NotFoundError("media");
      return q.rows[0];
    });
    const set = (format: MediaFormat) =>
      r.renditions
        .filter((x) => x.format === format)
        .sort((a, b) => a.width - b.width)
        .map((x) => ({ key: x.key, width: x.width }));
    const widest = [...r.renditions].sort((a, b) => b.width - a.width)[0];
    const fb = set(fallbackFormat(r.mime));
    return {
      mime: r.mime,
      key: r.storage_key,
      alt: r.decorative ? "" : (r.alt_text ?? ""),
      decorative: r.decorative,
      width: widest?.width ?? null,
      height: widest?.height ?? null,
      sources: (["avif", "webp"] as const)
        .map((f) => ({ mime: `image/${f}`, srcset: set(f) }))
        .filter((x) => x.srcset.length),
      fallback: fb.length ? { mime: `image/${fallbackFormat(r.mime)}`, srcset: fb } : null,
    };
  }

  /** The library (Studio's Media section): live items, newest first; `missingAlt` is the alt-text queue. */
  async list(
    ctx: KernelContext,
    f: { kind?: MediaKind; missingAlt?: boolean } = {},
  ): Promise<MediaSummary[]> {
    return this.o.kernel.read(ctx, async (tx) => {
      const r = await tx.query<{
        id: string;
        kind: MediaKind;
        mime: string;
        bytes: string;
        alt_text: string | null;
        decorative: boolean;
        created_at: Date;
      }>(
        `select id, kind, mime, bytes, alt_text, decorative, created_at from cms.media
          where deleted_at is null and ($1::text is null or kind = $1)
            and (not $2 or (alt_text is null and not decorative and kind in ('image', 'svg')))
          order by created_at desc, id desc limit 500`,
        [f.kind ?? null, f.missingAlt === true],
      );
      return r.rows.map((x) => ({
        id: x.id,
        kind: x.kind,
        mime: x.mime,
        bytes: Number(x.bytes),
        altText: x.alt_text,
        decorative: x.decorative,
        createdAt: x.created_at,
      }));
    });
  }

  /** Where a media item is used: live items whose current or published revision refers to it. */
  async whereUsed(ctx: KernelContext, mediaId: string): Promise<string[]> {
    return this.o.kernel.read(ctx, async (tx) => {
      const r = await tx.query<{ id: string }>(
        `select distinct i.id from cms.content_item i join cms.revision r
            on r.id in (i.current_revision_id, i.published_revision_id)
          where i.deleted_at is null and r.body::text like '%' || $1 || '%'`,
        [mediaId],
      );
      return r.rows.map((x) => x.id);
    });
  }

  /** Soft delete, refused while the media is in use (IPB-04-101 "where used" before deletion). */
  async softDelete(ctx: KernelContext, mediaId: string): Promise<void> {
    this.platformOnly(ctx);
    const used = await this.whereUsed(ctx, mediaId);
    if (used.length)
      throw new IpbError("IPB-CMS-003", {
        detail: `in use by ${used.join(", ")}`,
        meta: { reason: "in_use", used },
      });
    await this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const r = await tx.query(
          "update cms.media set deleted_at = now(), deleted_by = $2, updated_at = now() where id = $1 and deleted_at is null",
          [mediaId, ctx.principal.id],
        );
        if (!r.rowCount) throw new NotFoundError("media");
        await this.o.audit.record(tx, {
          action: "cms.media.delete",
          resourceType: "cms_media",
          resourceId: mediaId,
        });
      },
      { action: "cms.media.delete" },
    );
  }
}
