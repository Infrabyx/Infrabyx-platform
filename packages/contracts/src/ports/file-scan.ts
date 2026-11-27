// AV port, `FileScanPort` (IPB-01 AV; IPB-02-44 upload pipeline; LawDocsComply PR-LDC-41, R1-D-117).
// Every upload is scanned before anyone can read it. The port takes a STORAGE reference (the bytes
// never pass through its arguments) and answers one of three verdicts; the reference adapter is
// ClamAV running in the cluster (`@infrabyx/connectors/av`).
//
// Fail-closed (IPB-02-44): only `CLEAN` releases a file. `INFECTED` rejects it (`IPB-SEC-011`);
// `ERROR` (the engine failed, timed out, refused the size, found the bytes did not match the hash, or
// its signatures are older than allowed) keeps it quarantined (`IPB-SEC-015`) and it is scanned
// again later. `scanDecision` is the single mapping every caller uses.
import { z } from "zod";
import { PortError } from "../errors.js";
import type { Port, PortCall } from "./common.js";
import { DocFileRef } from "./doc-file.js";
import { classed } from "./payload-class.js";

export const SCAN_VERDICTS = ["CLEAN", "INFECTED", "ERROR"] as const;
export type ScanVerdict = (typeof SCAN_VERDICTS)[number];

/** Why a scan ended in `ERROR`; never the file's content. */
export const SCAN_ERROR_REASONS = [
  "engine_error",
  "timeout",
  "too_large",
  "hash_mismatch",
  "stale_signatures",
  "unavailable",
  "disabled",
  // The file's named STORAGE key is disabled, deleted or no longer granted (`IPB-KMS-001`), told
  // apart from an outage (R1-D-276). Still `ERROR`: the file stays quarantined.
  "storage_key_unavailable",
] as const;

/** The scan reason for a STORAGE read that failed with `e` (R1-D-269, R1-D-276). */
export function scanReasonOfReadError(e: unknown): ScanErrorReason {
  const code = (e as { code?: unknown } | null | undefined)?.code;
  if (code === "IPB-STOR-005") return "hash_mismatch";
  if (code === "IPB-KMS-001") return "storage_key_unavailable";
  return "unavailable";
}
export type ScanErrorReason = (typeof SCAN_ERROR_REASONS)[number];

export const FileScanRequest = DocFileRef;

export interface FileScanResult {
  verdict: ScanVerdict;
  /** The file scanned, as given (its SHA-256 was checked against the bytes read). */
  file: DocFileRef;
  /** The engine's name for what it found; only on `INFECTED`. */
  threat: string | null;
  /** Only on `ERROR`. */
  reason: ScanErrorReason | null;
  /** Engine and signature-set version, e.g. `ClamAV 1.5.4/27812`. */
  engine: string | null;
  /** When the signature set was published (ISO 8601), when the engine reports it. */
  signaturesAt: string | null;
  scannedAt: string;
  adapter: string;
}

export interface FileScanPort extends Port {
  /**
   * Scans one STORAGE object. Never throws for a scan that ran and failed: that is `ERROR` with a
   * reason, so a caller cannot release a file by catching an exception. Throws only for a request
   * outside the schema.
   */
  scan(file: z.infer<typeof FileScanRequest>, call?: PortCall): Promise<FileScanResult>;
}

export type ScanDecision =
  | { action: "release" }
  | { action: "reject"; code: "IPB-SEC-011" }
  | { action: "quarantine"; code: "IPB-SEC-015" };

/** The one mapping from a verdict to what happens to the file (IPB-02-44): only `CLEAN` releases. */
export function scanDecision(r: Pick<FileScanResult, "verdict">): ScanDecision {
  switch (r.verdict) {
    case "CLEAN":
      return { action: "release" };
    case "INFECTED":
      return { action: "reject", code: "IPB-SEC-011" };
    default:
      return { action: "quarantine", code: "IPB-SEC-015" };
  }
}

/** What a reader of an untrusted upload takes as proof of its scan: the scan's result, as returned. */
export const ScanProof = z.looseObject({
  /** Any string: an unknown verdict is checked by `scanDecision` and never releases. */
  verdict: classed(z.string().max(32), "INTERNAL"),
  file: DocFileRef,
});
export interface ScanProof {
  verdict: string;
  file: DocFileRef;
}

/**
 * PR-FBX-57 (R1-D-304): the scan a connector records with a file it wrote itself (a credit
 * bureau's report, an account aggregator's FI payload). `file` is the quarantined object that was
 * scanned; its SHA-256 equals the clean copy's, so `assertScannedClean(record, ref.sha256, port)`
 * verifies the record anywhere. Optional on the refs in 1.x (a stored ref from before PR-FBX-57
 * still parses); the platform's adapters always set it.
 */
export const ScanRecord = z
  .object({
    verdict: classed(z.string().max(32), "INTERNAL"),
    file: DocFileRef,
    engine: classed(z.string().max(128).nullable(), "INTERNAL"),
    scannedAt: classed(z.iso.datetime({ offset: true }), "INTERNAL"),
    adapter: classed(z.string().max(64), "INTERNAL"),
  })
  .strict();
export type ScanRecord = z.infer<typeof ScanRecord>;

/** The record of `r`, as a connector returns it beside the file it wrote. */
export function scanRecordOf(r: FileScanResult): ScanRecord {
  return {
    verdict: r.verdict,
    file: { storageKey: r.file.storageKey, sha256: r.file.sha256 },
    engine: r.engine,
    scannedAt: r.scannedAt,
    adapter: r.adapter,
  };
}

/**
 * PR-FBX-57: the STORAGE tags a connector writes on the clean copy of a scanned file, so the
 * object itself carries its scan. Hyphenated like `ipb-key-ref` (S3 metadata names are HTTP
 * header names).
 */
export const SCAN_TAGS = {
  verdict: "ipb-scan-verdict",
  engine: "ipb-scan-engine",
  scannedAt: "ipb-scanned-at",
  sha256: "ipb-scan-sha256",
} as const;

/**
 * Throws unless `scan` is a `CLEAN` scan of exactly the bytes with SHA-256 `sha256` (IPB-02-44):
 * every reader of an untrusted upload calls it before it parses a byte (PR-LDC-39). `INFECTED` is
 * `IPB-SEC-011`; `ERROR`, an unknown verdict, or a scan of other bytes is `IPB-SEC-015` (the bytes
 * stay quarantined). The caller still checks that the bytes it reads hash to `sha256`.
 */
export function assertScannedClean(
  scan: ScanProof,
  sha256: string,
  port: string,
  adapter?: string,
): void {
  const d = scanDecision({ verdict: scan.verdict as ScanVerdict });
  const who = adapter === undefined ? {} : { adapter };
  if (d.action !== "release")
    throw new PortError(d.code, port, {
      ...who,
      detail: `the file's scan is ${String(scan.verdict).slice(0, 16)}, not CLEAN`,
      meta: { reason: d.action === "reject" ? "infected" : "not_clean" },
    });
  if (scan.file.sha256 !== sha256)
    throw new PortError("IPB-SEC-015", port, {
      ...who,
      detail: "the scan is of other bytes",
      meta: { reason: "hash_mismatch" },
    });
}
