// Text from an uploaded PDF: `PdfPort.extractText` (IPB-01 PDF; IPB-02-44; LawDocsComply PR-LDC-39,
// R1-D-117, R1-D-160). An upload is untrusted input, so the call carries proof that the AV port
// scanned exactly these bytes `CLEAN` (`assertScannedClean`), and the parser runs under limits a
// caller may lower but never raise past the platform maxima. Text comes back per page; a page with
// no text layer is `needsOcr` (OCR is a separate port, later). The method is optional on `PdfPort`,
// so adapters written before it stay valid.
//
// Refusals use the upload codes: `IPB-SEC-011` (the scan found malware), `IPB-SEC-015` (not scanned
// `CLEAN`, or the bytes are not the ones scanned), `IPB-SEC-013` (a size, count, depth, ratio, time
// or memory limit; `meta.reason` says which), `IPB-SEC-010` (not a readable PDF, or encrypted).
// A STORAGE read refused because the file's named tenant key is disabled or no longer granted is
// `IPB-KMS-001` with `meta.reason` `storage_key_unavailable` and nothing else (PR-UDF-067); any
// other read failure is `IPB-PORT-002` (`unavailable`).
import { z } from "zod";
import { DocFileRef } from "./doc-file.js";
import { ScanProof } from "./file-scan.js";
import { classed } from "./payload-class.js";

const internal = <T extends z.ZodType>(s: T): T => classed(s, "INTERNAL");

/** The limits a call gets when it names none. */
export const PDF_TEXT_LIMIT_DEFAULTS = {
  /** File size (25 MiB, the AV adapter's default). */
  maxFileBytes: 25 * 1024 * 1024,
  /** Pages in the page tree. */
  maxPages: 500,
  /** Objects in the cross-reference data, and objects read. */
  maxObjects: 100_000,
  /** Nesting of arrays and dictionaries, of the page tree, and of form XObjects. */
  maxDepth: 32,
  /** Inflated size of one stream. */
  maxStreamBytes: 16 * 1024 * 1024,
  /** Inflated size of every stream read, together. */
  maxTotalInflateBytes: 128 * 1024 * 1024,
  /** Largest inflated-to-compressed ratio of a stream (streams under 64 KiB inflated are exempt). */
  maxRatio: 200,
  /** Characters of text returned; past it the result is `truncated`. */
  maxTextChars: 2_000_000,
  /** Wall-clock time of the parse, worker start included. */
  timeoutMs: 30_000,
} as const;

export type PdfTextLimitName = keyof typeof PDF_TEXT_LIMIT_DEFAULTS;

/** The platform maxima: a larger limit asked for is capped to these. */
export const PDF_TEXT_LIMIT_MAXIMA: Readonly<Record<PdfTextLimitName, number>> = {
  maxFileBytes: 50 * 1024 * 1024,
  maxPages: 2_000,
  maxObjects: 500_000,
  maxDepth: 64,
  maxStreamBytes: 32 * 1024 * 1024,
  maxTotalInflateBytes: 256 * 1024 * 1024,
  maxRatio: 1_000,
  maxTextChars: 10_000_000,
  timeoutMs: 120_000,
};

const positive = () => internal(z.number().int().positive().optional());

export const PdfTextLimits = z
  .object({
    maxFileBytes: positive(),
    maxPages: positive(),
    maxObjects: positive(),
    maxDepth: positive(),
    maxStreamBytes: positive(),
    maxTotalInflateBytes: positive(),
    maxRatio: positive(),
    maxTextChars: positive(),
    timeoutMs: positive(),
  })
  .strict();
export type PdfTextLimits = z.infer<typeof PdfTextLimits>;
export type ResolvedPdfTextLimits = Record<PdfTextLimitName, number>;

/** Each limit as asked (or its default), capped by the platform maximum. */
export function resolvePdfTextLimits(asked: PdfTextLimits = {}): ResolvedPdfTextLimits {
  const out = {} as ResolvedPdfTextLimits;
  for (const k of Object.keys(PDF_TEXT_LIMIT_DEFAULTS) as PdfTextLimitName[])
    out[k] = Math.min(asked[k] ?? PDF_TEXT_LIMIT_DEFAULTS[k], PDF_TEXT_LIMIT_MAXIMA[k]);
  return out;
}

export const PdfTextRequest = z
  .object({
    /** The upload in STORAGE; its SHA-256 is checked against the bytes read. */
    file: DocFileRef,
    /** The AV port's result for this file (`FileScanPort.scan`); only `CLEAN` of these bytes passes. */
    scan: ScanProof,
    limits: PdfTextLimits.optional(),
  })
  .strict();
export interface PdfTextRequest {
  file: DocFileRef;
  /** A `FileScanResult` (any extra fields are kept and ignored). */
  scan: ScanProof;
  limits?: PdfTextLimits;
}

export interface PdfTextPage {
  /** Page number, from 1 (as every `PdfPort` page argument). */
  index: number;
  /** The page's text in reading order of the content stream; lines end with `\n`. */
  text: string;
  /** No text layer could be read on this page: send it to OCR. */
  needsOcr: boolean;
}

export interface PdfTextResult {
  /** One entry per page, in order; fewer than `pageCount` only when `truncated`. */
  pages: PdfTextPage[];
  pageCount: number;
  /** The text limit was reached: later text and pages are missing. */
  truncated?: boolean;
}
