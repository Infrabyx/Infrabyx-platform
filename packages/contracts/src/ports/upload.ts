// The upload pipeline after the AV scan (IPB-02-44, `@IPB-02-AT-16`; Finbyx PR-FBX-56, R1-D-292).
// One step a product calls on every upload that scanned CLEAN: it sniffs the bytes against the
// declared type and the route's allow-list, then applies what the type needs (raster images
// re-encoded through MEDIA, SVG sanitised or rasterised, PDFs checked for JavaScript and launch
// actions and flattened or refused, Office files refused when they carry macros unless the route
// allows them) and answers the bytes to store or a refusal code. The implementation is
// `releaseUpload` in `@infrabyx/connectors/upload`; these are its types.
import { z } from "zod";

/** The kinds of upload the pipeline knows, by what it does to them. */
export const UPLOAD_KINDS = ["raster", "svg", "pdf", "office"] as const;
export type UploadKind = (typeof UPLOAD_KINDS)[number];

/** Every declared type the pipeline accepts on a route, with its kind. */
export const UPLOAD_TYPES = {
  "image/png": "raster",
  "image/jpeg": "raster",
  "image/webp": "raster",
  "image/avif": "raster",
  "image/svg+xml": "svg",
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "office",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "office",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "office",
  "application/vnd.ms-word.document.macroEnabled.12": "office",
  "application/vnd.ms-excel.sheet.macroEnabled.12": "office",
  "application/vnd.ms-powerpoint.presentation.macroEnabled.12": "office",
  "application/msword": "office",
  "application/vnd.ms-excel": "office",
  "application/vnd.ms-powerpoint": "office",
} as const satisfies Record<string, UploadKind>;
export type UploadType = keyof typeof UPLOAD_TYPES;

/**
 * The PDF names the pipeline always treats as active content (`IPB-SEC-012`, or flattened where the
 * route flattens): code that runs, launches or submits, and content types a viewer executes. Matched
 * as whole PDF names, `#xx` escapes decoded, in the file body and inside every object stream.
 */
export const PDF_ACTIVE_NAMES = [
  "JavaScript",
  "JS",
  "Launch",
  "RichMedia",
  "XFA",
  "SubmitForm",
  "ImportData",
] as const;

/**
 * PDF names ordinary documents use (an initial view, form-field actions, PDF/A-3 attachments,
 * links): reported, and refused only on a route that lists them in `pdf.refuseAlso`.
 */
export const PDF_REPORTED_NAMES = [
  "OpenAction",
  "AA",
  "EmbeddedFile",
  "EmbeddedFiles",
  "URI",
  "GoToR",
  "GoToE",
] as const;
export type PdfReportedName = (typeof PDF_REPORTED_NAMES)[number];

/** The most bytes the pipeline reads or inflates for one upload (zip and PDF streams together). */
export const UPLOAD_MAX_INFLATED_BYTES = 256 * 1024 * 1024;
/** The largest inflation ratio of one compressed entry or stream (a zip bomb above it). */
export const UPLOAD_MAX_INFLATION_RATIO = 200;

export const UploadRoute = z.strictObject({
  /** The route's name, for the ledger and logs (never the file's). */
  name: z.string().regex(/^[a-z][a-z0-9_.-]{0,63}$/),
  /** The declared types this route admits (`IPB-SEC-014` otherwise). */
  accept: z.array(z.enum(Object.keys(UPLOAD_TYPES) as [UploadType, ...UploadType[]])).min(1),
  /** The route class's size limit in bytes (`IPB-SEC-013` above it). */
  maxBytes: z
    .number()
    .int()
    .positive()
    .max(1024 * 1024 * 1024),
  raster: z
    .strictObject({
      /**
       * Keep the original as the record (its SHA-256 is the evidence) and return a re-encoded
       * viewing copy beside it, with both hashes (Finbyx owner answer #333). Without it the
       * re-encoded copy is the record and the original is not returned.
       */
      keepOriginalAsEvidence: z.boolean().default(false),
    })
    .default({ keepOriginalAsEvidence: false }),
  /** SVG: the sanitised SVG, a PNG of it (`size` pixels square), or refused. */
  svg: z
    .strictObject({
      mode: z.enum(["sanitise", "rasterise", "refuse"]).default("refuse"),
      size: z.number().int().min(16).max(4096).default(512),
    })
    .default({ mode: "refuse", size: 512 }),
  /** PDF: refused when active, or flattened (the route's flattener) and checked again. */
  pdf: z
    .strictObject({
      onActive: z.enum(["refuse", "flatten"]).default("refuse"),
      /** Reported names this route also treats as active. */
      refuseAlso: z.array(z.enum(PDF_REPORTED_NAMES)).default([]),
    })
    .default({ onActive: "refuse", refuseAlso: [] }),
  /** Office: refused with macros, ActiveX or as legacy OLE unless the route allows macros. */
  office: z
    .strictObject({ allowMacros: z.boolean().default(false) })
    .default({ allowMacros: false }),
});
export type UploadRouteInput = z.input<typeof UploadRoute>;
export type UploadRoute = z.output<typeof UploadRoute>;

/** Why an upload was refused; never the file's content or name. */
export const UPLOAD_REFUSAL_REASONS = [
  "not_scanned_clean",
  "scan_of_other_bytes",
  "type_not_allowed",
  "too_large",
  "type_mismatch",
  "polyglot",
  "unsupported_type",
  "image_unreadable",
  "svg_refused",
  "svg_unreadable",
  "pdf_active_content",
  "pdf_unreadable",
  "pdf_encrypted",
  "pdf_flatten_unavailable",
  "pdf_flatten_failed",
  "office_macros",
  "office_legacy",
  "office_unreadable",
  "inflation_limit",
] as const;
export type UploadRefusalReason = (typeof UPLOAD_REFUSAL_REASONS)[number];

/** The problem code of each reason (IPB-02 §02.6.3). */
export const UPLOAD_REFUSAL_CODES = {
  not_scanned_clean: "IPB-SEC-011",
  scan_of_other_bytes: "IPB-SEC-015",
  type_not_allowed: "IPB-SEC-014",
  too_large: "IPB-SEC-013",
  type_mismatch: "IPB-SEC-010",
  polyglot: "IPB-SEC-010",
  unsupported_type: "IPB-SEC-014",
  image_unreadable: "IPB-SEC-010",
  svg_refused: "IPB-SEC-012",
  svg_unreadable: "IPB-SEC-010",
  pdf_active_content: "IPB-SEC-012",
  pdf_unreadable: "IPB-SEC-012",
  pdf_encrypted: "IPB-SEC-012",
  pdf_flatten_unavailable: "IPB-SEC-012",
  pdf_flatten_failed: "IPB-SEC-012",
  office_macros: "IPB-SEC-012",
  office_legacy: "IPB-SEC-012",
  office_unreadable: "IPB-SEC-010",
  inflation_limit: "IPB-SEC-013",
} as const satisfies Record<UploadRefusalReason, string>;
export type UploadRefusalCode = (typeof UPLOAD_REFUSAL_CODES)[UploadRefusalReason];

/** Bytes to store, with their type and SHA-256 (lower-case hex). */
export interface StoredUpload {
  bytes: Uint8Array;
  mime: string;
  sha256: string;
}

/** What the pipeline did to a released file (for the ledger; never its content). */
export const UPLOAD_STEPS = [
  "sniffed",
  "reencoded",
  "kept_original_as_evidence",
  "svg_sanitised",
  "svg_rasterised",
  "pdf_checked",
  "pdf_flattened",
  "office_checked",
  "office_macros_allowed",
] as const;
export type UploadStep = (typeof UPLOAD_STEPS)[number];

export type UploadRelease =
  | {
      released: true;
      kind: UploadKind;
      /** What to store as the record: the neutralised bytes, or the original kept as evidence. */
      record: StoredUpload;
      /** The re-encoded viewing copy, only with `raster.keepOriginalAsEvidence`. */
      viewing: StoredUpload | null;
      /** The original's SHA-256 (the scanned bytes), whatever is stored. */
      originalSha256: string;
      steps: UploadStep[];
      /** Reported PDF names and SVG removals (labels only). */
      findings: string[];
    }
  | {
      released: false;
      code: UploadRefusalCode;
      reason: UploadRefusalReason;
      /** Labels only (a PDF name, an SVG element), never content. */
      findings: string[];
    };
