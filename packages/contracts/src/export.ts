// Export map (IPB-09 §09.4.7.1) and archive manifest (Ecosystem §12.1 profile, archive standard
// 1.0) schemas used by `@infrabyx/export` and the products' maps (PL3 plan §7).
import { z } from "zod";

/** `<PRODUCT>-EXPORT-<major>.<minor>`, e.g. `REF-EXPORT-1.0`. */
export const MAP_VERSION_REGEX = /^[A-Z][A-Z0-9]{1,9}-EXPORT-(\d+)\.(\d+)$/;

export const ExportMapEntity = z
  .object({
    /** `<schema>.<table>` read by the exporter. */
    source: z.string().regex(/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/),
    id: z.string().min(1),
    /** Path templates of the files emitted per row; changes bump `map_version`. */
    files: z.array(z.string().min(1)).default([]),
    /** Columns exported; changes bump `map_version`. */
    fields: z.array(z.string().regex(/^[a-z][a-z0-9_]*$/)).min(1),
    /** Manifest-only projections; changes never bump. */
    views: z.array(z.string()).default([]),
  })
  .strict();
export type ExportMapEntity = z.infer<typeof ExportMapEntity>;

export const EXPORT_NORMALISERS = [
  "timestamps_iso8601",
  "ulid_stable_sort",
  "runtime_ids",
  "zip_entry_times",
] as const;

export const ExportMap = z
  .object({
    map_version: z.string().regex(MAP_VERSION_REGEX),
    entities: z.record(z.string().regex(/^[a-z][a-z0-9_]*$/), ExportMapEntity),
    manifest: z.literal("manifest.json"),
    normalisers: z.array(z.enum(EXPORT_NORMALISERS)).default([]),
  })
  .strict();
export type ExportMap = z.infer<typeof ExportMap>;

/** `{ major, minor }` of a map version, or null when malformed. */
export function parseMapVersion(
  v: string,
): { product: string; major: number; minor: number } | null {
  const m = MAP_VERSION_REGEX.exec(v);
  if (!m) return null;
  return { product: v.slice(0, v.indexOf("-")), major: Number(m[1]), minor: Number(m[2]) };
}

/**
 * The bump a map change needs (IPB-09 §09.4.7.1): `major` when a file or field is removed or
 * renamed, `minor` when one is added, `none` for view-only changes.
 */
export function requiredMapBump(before: ExportMap, after: ExportMap): "none" | "minor" | "major" {
  let bump: "none" | "minor" | "major" = "none";
  const names = new Set([...Object.keys(before.entities), ...Object.keys(after.entities)]);
  for (const n of names) {
    const a = before.entities[n];
    const b = after.entities[n];
    if (a && !b) return "major";
    if (!a && b) {
      bump = "minor";
      continue;
    }
    if (!a || !b) continue;
    for (const key of ["files", "fields"] as const) {
      const was = new Set(a[key]);
      const now = new Set(b[key]);
      if ([...was].some((x) => !now.has(x))) return "major";
      if ([...now].some((x) => !was.has(x))) bump = "minor";
    }
    if (a.source !== b.source || a.id !== b.id) return "major";
  }
  return bump;
}

const SHA256_HEX = z.string().regex(/^[0-9a-f]{64}$/);

/** `manifest.json` of an archive (Ecosystem §12.1, archive standard 1.0). */
export const ArchiveManifestV1 = z
  .object({
    archive_standard_version: z.literal("1.0"),
    archive_id: z.string().regex(/^arc_[0-7][0-9A-HJKMNP-TV-Z]{25}$/),
    folder_profile: z.string().min(1),
    map_version: z.string().regex(MAP_VERSION_REGEX),
    producer: z.object({ product: z.string(), release: z.string() }).strict(),
    tenant_id: z.string().min(1),
    scope: z
      .object({
        type: z.enum([
          "DATASET",
          "LEGAL_ENTITY",
          "MODULE",
          "AUDIT_PACK",
          "RE_PACK",
          "FULL_TENANT",
          "EXIT",
        ]),
        ref: z.string().nullable(),
      })
      .strict(),
    /** Hashed principal ids, never names (`ids_only`). */
    requester: z.string(),
    approvers: z.array(z.string()),
    as_of: z.iso.datetime({ offset: true }),
    control_totals: z.record(z.string(), z.number().int().nonnegative()),
    predecessor_archive_id: z.string().nullable(),
    files: z
      .array(
        z
          .object({
            path: z.string().max(240),
            bytes: z.number().int().nonnegative(),
            sha256: SHA256_HEX,
          })
          .strict(),
      )
      .min(1),
    /** SHA-256 over the sorted `path ‖ 0x20 ‖ sha256 ‖ 0x0A` lines. */
    pack_sha256: SHA256_HEX,
    /** Detached JWS beside the manifest (C-22, PL3-D-06). */
    signature: z
      .object({ file: z.literal("manifest.json.jws"), alg: z.literal("ES256"), kid: z.string() })
      .strict(),
  })
  .strict();
export type ArchiveManifestV1 = z.infer<typeof ArchiveManifestV1>;
