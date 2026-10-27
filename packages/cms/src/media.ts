// Media library (IPB-04-11; `@IPB-04-AT-09`; PL5 plan §5.3). Uploads are stored in STORAGE once
// per SHA-256 (deduplicated) and served as uploaded: raster re-encoding waits for an approved
// image library (OWNER-QUESTIONS #43, #53). What is done without one: SVGs go through the brand
// sanitiser and only the result is stored; EXIF, XMP and text metadata are stripped from JPEG and
// PNG files; alt text is required for every image unless it is marked decorative with a reason.
import { IpbError } from "@infrabyx/contracts/errors";
import { PLATFORM_TENANT_ID } from "@infrabyx/contracts/ids";
import type { AuditSink, KernelContext, MutationKernel } from "@infrabyx/contracts/kernel";
import { storageKey, type StoragePort } from "@infrabyx/contracts/ports";
import { newId, sha256Hex, ulid } from "@infrabyx/crypto";
import { sanitiseSvg } from "@infrabyx/brand";
import { NotFoundError } from "@infrabyx/tenancy";

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
}

export interface MediaRecord {
  id: string;
  kind: MediaKind;
  sha256: string;
  storageKey: string;
  removed: string[];
  deduplicated: boolean;
}

export class MediaLibrary {
  constructor(
    private readonly o: {
      kernel: MutationKernel;
      audit: AuditSink;
      storage: StoragePort;
      maxUploadMb?: number;
    },
  ) {}

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
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const dup = await tx.query<{ id: string; storage_key: string }>(
          "select id, storage_key from cms.media where sha256 = $1 and deleted_at is null",
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
          };
        const key = storageKey(
          PLATFORM_TENANT_ID,
          "cms",
          ulid(),
          u.mime.split("/")[1]!.replace("svg+xml", "svg"),
        );
        await this.o.storage.put(key, bytes, {
          contentType: u.mime,
          bucketClass: "PUBLIC_ASSETS",
          sha256,
          tags: { cms_media: "1" },
        });
        const id = newId("med");
        await tx.query(
          `insert into cms.media (id, kind, storage_key, sha256, mime, bytes, alt_text, decorative, decorative_reason,
             licence_note, sanitiser_report, uploaded_by)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12)`,
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
          },
        });
        return { id, kind, sha256, storageKey: key, removed, deduplicated: false };
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
