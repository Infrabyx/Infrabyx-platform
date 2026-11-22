// AV port fake and contract cases (IPB-01 AV; IPB-02-44; LawDocsComply PR-LDC-41, R1-D-117). Every
// adapter passes the same cases against files it reads from STORAGE: a clean file is `CLEAN`, the
// EICAR test file is `INFECTED`, and a hash mismatch or a missing object is `ERROR`, never `CLEAN`.
// The fake recognises EICAR itself; the ClamAV adapter runs the same cases against clamd.
import {
  FileScanRequest,
  scanReasonOfReadError,
  type AdapterDescriptor,
  type DocFileRef,
  type FileScanPort,
  type FileScanResult,
  type PortHealth,
  type ScanErrorReason,
  type StoragePort,
} from "@infrabyx/contracts/ports";
import { sha256Hex } from "@infrabyx/crypto";

/** The EICAR anti-malware test file (68 bytes): every engine reports it; it is not malware. */
export const EICAR = new TextEncoder().encode(
  "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*",
);

/** In-memory AV: EICAR anywhere in the bytes is `INFECTED`; `mode` forces an `ERROR` for tests. */
export class FakeFileScan implements FileScanPort {
  readonly descriptor: AdapterDescriptor = {
    port: "AV",
    adapter: "fake-av",
    residency: "IN",
    maxDataClass: "REGULATED",
  };
  /** Forces every scan to end in `ERROR` with this reason. */
  mode: ScanErrorReason | null = null;
  /** Every file the fake was asked to scan. */
  readonly scanned: DocFileRef[] = [];
  constructor(
    private readonly storage: StoragePort,
    private readonly maxBytes = 25 * 1024 * 1024,
  ) {}
  async health(): Promise<PortHealth> {
    return {
      status:
        this.mode === "unavailable" ? "down" : this.mode === "stale_signatures" ? "degraded" : "up",
      latency_ms: 0,
      checked_at: new Date().toISOString(),
      detail: {
        engine: "fake-av 1",
        signatures_at: new Date().toISOString(),
        signature_age_hours: this.mode === "stale_signatures" ? 49 : 0,
        max_signature_age_hours: 48,
        signatures_fresh: this.mode !== "stale_signatures",
      },
    };
  }
  async scan(raw: DocFileRef): Promise<FileScanResult> {
    const file = FileScanRequest.parse(raw);
    this.scanned.push(file);
    const result = (
      verdict: FileScanResult["verdict"],
      extra: Partial<FileScanResult> = {},
    ): FileScanResult => ({
      verdict,
      file,
      threat: null,
      reason: null,
      engine: "fake-av 1",
      signaturesAt: new Date().toISOString(),
      scannedAt: new Date().toISOString(),
      adapter: "fake-av",
      ...extra,
    });
    if (this.mode) return result("ERROR", { reason: this.mode });
    let body: Uint8Array;
    try {
      body = (await this.storage.get(file.storageKey)).body;
    } catch (e) {
      // PR-UDF-080 (R1-D-269): bytes STORAGE refuses for integrity are a hash mismatch, as `clamav`.
      return result("ERROR", {
        reason: scanReasonOfReadError(e),
      });
    }
    if (sha256Hex(body) !== file.sha256) return result("ERROR", { reason: "hash_mismatch" });
    if (body.length > this.maxBytes) return result("ERROR", { reason: "too_large" });
    if (contains(body, EICAR)) return result("INFECTED", { threat: "Eicar-Test-Signature" });
    return result("CLEAN");
  }
}

function contains(hay: Uint8Array, needle: Uint8Array): boolean {
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
}
