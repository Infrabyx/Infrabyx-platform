// Web snapshots as evidence: `WebSnapshotPort` (IPB-04 §04.4.4 governed egress; IPB-02-43 SSRF
// guard; IPB-02-44 scanning; LawDocsComply PR-LDC-40, R1-D-117, R1-D-150, R1-D-176; threat model
// §3.125). A dated, hashed copy of one public web page, fetched through the EGRESS port, stored as
// received in the tenant's STORAGE, scanned by the AV port and recorded under the ledger. It is a
// platform service over EGRESS, STORAGE and AV, not a vendor port: the swappable part is EGRESS.
//
// Nothing is rendered: no script runs and no sub-resource is fetched (no headless browser). A copy
// is served only as a download (`webSnapshotDownloadHeaders`), never inline on a platform origin.
//
// Refusals: `IPB-SEC-018` (the URL or a redirect hop is refused by the SSRF guard), `IPB-SEC-013`
// (over the size cap), `IPB-SEC-010` (a media type not on the list, or bytes that do not start with
// their binary type's signature), `IPB-SEC-019` (the tenant's rate limit), `IPB-PORT-002`
// (unreachable, timed out, or a status other than 200), `IPB-PORT-001` (switched off). `open` of a
// copy that is not `RELEASED` is `IPB-SEC-011` (rejected by the scan) or `IPB-SEC-015`
// (quarantined, or bytes that no longer hash to the record).
import { z } from "zod";
import type { KernelContext } from "../kernel.js";
import { ULID_PATTERN } from "../ids.js";
import { DocFileRef, OutputPrefix } from "./doc-file.js";
import { classed } from "./payload-class.js";
import { STORAGE_COMPARTMENTS, type BucketClass, type StorageCompartment } from "./storage.js";

/**
 * The media types a snapshot may have. SVG is not one: it is active content (script, external
 * references). XHTML and HTML are stored as bytes and never rendered by the platform.
 */
export const WEB_SNAPSHOT_CONTENT_TYPES = [
  "text/html",
  "application/xhtml+xml",
  "text/plain",
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
] as const;
export type WebSnapshotContentType = (typeof WEB_SNAPSHOT_CONTENT_TYPES)[number];

/** The file extension each media type is stored and downloaded under. */
export const WEB_SNAPSHOT_EXTENSIONS: Readonly<Record<WebSnapshotContentType, string>> = {
  "text/html": "html",
  "application/xhtml+xml": "xhtml",
  "text/plain": "txt",
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

/** The limits a request gets when it names none (threat model §3.125). */
export const WEB_SNAPSHOT_LIMIT_DEFAULTS = {
  /** Bytes of the page as stored (after any content decoding). */
  maxBytes: 10 * 1024 * 1024,
  /** Wall-clock time of the whole fetch, every redirect included. */
  timeoutMs: 20_000,
} as const;
export type WebSnapshotLimitName = keyof typeof WEB_SNAPSHOT_LIMIT_DEFAULTS;

/** The platform maxima: a larger limit asked for is capped to these. 25 MiB is the AV default. */
export const WEB_SNAPSHOT_LIMIT_MAXIMA: Readonly<Record<WebSnapshotLimitName, number>> = {
  maxBytes: 25 * 1024 * 1024,
  timeoutMs: 60_000,
};

/** Redirects followed, at most (each hop checked as the first). Fixed. */
export const WEB_SNAPSHOT_MAX_REDIRECTS = 5;

/** The bucket classes a snapshot may be stored in. */
export const WEB_SNAPSHOT_BUCKET_CLASSES = [
  "GENERAL",
  "CONFIDENTIAL",
  "REGULATED",
] as const satisfies readonly BucketClass[];

const internal = <T extends z.ZodType>(s: T): T => classed(s, "INTERNAL");
const positive = () => internal(z.number().int().positive().optional());

export const WebSnapshotLimits = z.object({ maxBytes: positive(), timeoutMs: positive() }).strict();
export type WebSnapshotLimits = z.infer<typeof WebSnapshotLimits>;
export type ResolvedWebSnapshotLimits = Record<WebSnapshotLimitName, number>;

/** Each limit as asked (or its default), capped by the platform maximum. */
export function resolveWebSnapshotLimits(asked: WebSnapshotLimits = {}): ResolvedWebSnapshotLimits {
  const out = {} as ResolvedWebSnapshotLimits;
  for (const k of Object.keys(WEB_SNAPSHOT_LIMIT_DEFAULTS) as WebSnapshotLimitName[])
    out[k] = Math.min(asked[k] ?? WEB_SNAPSHOT_LIMIT_DEFAULTS[k], WEB_SNAPSHOT_LIMIT_MAXIMA[k]);
  return out;
}

/** Printable text without control characters (a product's own record id). */
const REFERENCE = /^[\x20-\x7E]{1,120}$/;

/** An https URL of at most 2048 characters (the guard checks the rest at fetch time). */
export const WebSnapshotUrl = z
  .string()
  .max(2048)
  .refine((v) => {
    try {
      return new URL(v).protocol === "https:";
    } catch {
      return false;
    }
  }, "a snapshot URL is an absolute https URL");

export const WebSnapshotRequest = z
  .object({
    /** The public page to keep. Its host must be on the tenant's allow-list. */
    url: classed(WebSnapshotUrl, "CONFIDENTIAL"),
    /** Where the copy is written: under the calling tenant's own STORAGE prefix. */
    outputPrefix: internal(OutputPrefix),
    bucketClass: internal(z.enum(WEB_SNAPSHOT_BUCKET_CLASSES).default("CONFIDENTIAL")),
    compartment: internal(z.enum(STORAGE_COMPARTMENTS).optional()),
    /**
     * A write-once copy kept until this instant (COMPLIANCE retention, IPB-01-29). The platform
     * sets no retention of its own: without it the copy is an ordinary object.
     */
    retainUntil: internal(z.iso.datetime({ offset: true }).optional()),
    /** The product's own record the snapshot belongs to (an id, never personal data). */
    reference: internal(z.string().regex(REFERENCE).optional()),
    limits: WebSnapshotLimits.optional(),
  })
  .strict();
export type WebSnapshotRequest = z.input<typeof WebSnapshotRequest>;

export const WEB_SNAPSHOT_STATES = ["RELEASED", "QUARANTINED", "REJECTED"] as const;
export type WebSnapshotState = (typeof WEB_SNAPSHOT_STATES)[number];

export const WEB_SNAPSHOT_ENCODINGS = ["identity", "gzip", "deflate", "br"] as const;
export type WebSnapshotEncoding = (typeof WEB_SNAPSHOT_ENCODINGS)[number];

export const WEB_SNAPSHOT_ID_REGEX = new RegExp(`^wsn_${ULID_PATTERN}$`);

/** One snapshot, as recorded. */
export interface WebSnapshot {
  /** `wsn_<ULID>`. */
  id: string;
  tenantId: string;
  requestedUrl: string;
  /** The URL the bytes came from (the last hop). */
  finalUrl: string;
  /** Every hop after the first, in order (empty without redirects). */
  redirects: string[];
  /** Always 200: no other status is kept. */
  httpStatus: number;
  contentType: WebSnapshotContentType;
  charset: string | null;
  /** How the server encoded the body; the stored bytes are decoded. */
  contentEncoding: WebSnapshotEncoding;
  bytes: number;
  sha256: string;
  fetchedAt: string;
  file: DocFileRef;
  bucketClass: BucketClass;
  compartment: StorageCompartment | null;
  state: WebSnapshotState;
  scan: {
    verdict: string;
    engine: string | null;
    reason: string | null;
    threat: string | null;
    scannedAt: string;
  };
  reference: string | null;
  /** The principal that asked. */
  requestedBy: string;
  retainUntil: string | null;
}

/** What `open` returns: the bytes (their SHA-256 checked) and the headers to serve them with. */
export interface OpenedWebSnapshot {
  snapshot: WebSnapshot;
  body: Uint8Array;
  headers: Record<string, string>;
}

/**
 * The web snapshot service. Every method runs in the caller's context: the tenant's RLS applies,
 * and the ledger names the caller. Agents, external principals and platform contexts are refused.
 */
export interface WebSnapshotPort {
  /** Fetch, store, scan and record one page. A quarantined copy can be scanned again later. */
  archive(ctx: KernelContext, req: WebSnapshotRequest): Promise<WebSnapshot>;
  /** The record, or null when there is none in the caller's tenant. */
  get(ctx: KernelContext, id: string): Promise<WebSnapshot | null>;
  /** The bytes of a `RELEASED` snapshot, after checking they still hash to the record. */
  open(ctx: KernelContext, id: string): Promise<OpenedWebSnapshot>;
  /** Scan a `QUARANTINED` snapshot again; any other state is returned unchanged. */
  rescan(ctx: KernelContext, id: string): Promise<WebSnapshot>;
}

/**
 * The headers a snapshot is served with: always a download, never sniffed, sandboxed if a browser
 * opens it anyway, and never cached by a shared cache.
 */
export function webSnapshotDownloadHeaders(
  s: Pick<WebSnapshot, "id" | "contentType" | "charset" | "bytes">,
): Record<string, string> {
  const ext = WEB_SNAPSHOT_EXTENSIONS[s.contentType] ?? "bin";
  const type = (WEB_SNAPSHOT_CONTENT_TYPES as readonly string[]).includes(s.contentType)
    ? s.contentType
    : "application/octet-stream";
  const charset = s.charset && /^[A-Za-z0-9._-]{1,40}$/.test(s.charset) ? s.charset : null;
  return {
    "Content-Type": charset ? `${type}; charset=${charset}` : type,
    "Content-Length": String(s.bytes),
    "Content-Disposition": `attachment; filename="${s.id}.${ext}"`,
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "sandbox; default-src 'none'",
    "Cache-Control": "private, no-store",
    "Cross-Origin-Resource-Policy": "same-origin",
  };
}
