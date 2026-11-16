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
import type { Port, PortCall } from "./common.js";
import { DocFileRef } from "./doc-file.js";

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
] as const;
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
