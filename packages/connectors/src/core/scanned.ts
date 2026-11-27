// `writeScanned`: a file a connector writes itself (a credit bureau's report, an account
// aggregator's FI payload) is quarantined, scanned through FILE_SCAN and promoted only when CLEAN
// (Finbyx PR-FBX-57, R1-D-302, R1-D-304; IPB-02-44). The same rules as an upload:
//   1. the bytes go to `QUARANTINE` under a fresh key beside the clean one (an object never moves
//      class, so the quarantined copy has its own ULID); a named key reference is kept;
//   2. `FileScanPort.scan` reads them there (a scanner that throws counts as `ERROR`, unavailable);
//   3. `CLEAN`: the bytes read back from QUARANTINE (checked against the hash) are written to the
//      target class with the scan as tags (`SCAN_TAGS`), and the ref carries the scan record;
//   4. `INFECTED`: `IPB-SEC-011` (reason `infected`); the quarantined object stays for the AV
//      owner, nothing is written at the clean key;
//   5. `ERROR`: `IPB-SEC-015` (reason `not_clean`, with the scan's reason); retried later, it
//      quarantines and scans again.
// Without a FILE_SCAN port nothing is written and every call refuses `IPB-SEC-015` (reason
// `scan_required`): optional in 1.x so no product breaks at construction, fail closed at run time
// (owner, 27 Nov 2026 16:10 IST); required at construction in 2.0.0.
import { PortError } from "@infrabyx/contracts/errors";
import type { AppEnv } from "@infrabyx/contracts/env";
import {
  SCAN_TAGS,
  promotedObjectMeta,
  scanDecision,
  scanRecordOf,
  type BucketClass,
  type FileScanPort,
  type FileScanResult,
  type ObjectMeta,
  type PortCall,
  type ScanRecord,
  type StoragePort,
} from "@infrabyx/contracts/ports";
import { sha256Hex, ulid } from "@infrabyx/crypto";

/** The environments where a connector built without FILE_SCAN does not warn at start-up. */
export const SCAN_WARNING_QUIET_ENVS: readonly AppEnv[] = Object.freeze(["local", "test"]);

export interface ScannedWrite {
  /** The clean key (IPB-01-27, `tenant/<t>/<module>/<ULID>[.ext]`). */
  key: string;
  bytes: Uint8Array;
  contentType: string;
  /** Where the clean copy goes (`REGULATED` for bureau reports and FI payloads). */
  bucketClass: BucketClass;
  /** A named tenant key reference, kept on both copies (R1-D-240). */
  keyRef?: string;
}

export interface ScannedFile {
  storageKey: string;
  sha256: string;
  scan: ScanRecord;
}

export interface ScannedWriter {
  port: string;
  adapter: string;
  storage: StoragePort;
  scan?: FileScanPort | undefined;
}

const KEY_PARTS = /^(tenant\/[^/]+\/[a-z][a-z0-9_]*\/)[0-9A-HJKMNP-TV-Z]{26}(\.[a-z0-9]+)?$/;

/** The quarantine key beside `key`: the same tenant and module (so prefix maps agree), a new ULID. */
export function quarantineKeyOf(key: string): string {
  const m = KEY_PARTS.exec(key);
  if (!m) throw new Error(`invalid storage key ${key}`);
  return `${m[1]}${ulid()}${m[2] ?? ""}`;
}

const outage = (file: { storageKey: string; sha256: string }, adapter: string): FileScanResult => ({
  verdict: "ERROR",
  file,
  threat: null,
  reason: "unavailable",
  engine: null,
  signaturesAt: null,
  scannedAt: new Date().toISOString(),
  adapter,
});

/** Quarantine, scan and promote one file; see the file header for each outcome. */
export async function writeScanned(
  w: ScannedWriter,
  f: ScannedWrite,
  call?: PortCall,
): Promise<ScannedFile> {
  const who = { adapter: w.adapter };
  if (!w.scan)
    throw new PortError("IPB-SEC-015", w.port, {
      ...who,
      detail: "no FILE_SCAN port was given to this adapter: nothing it receives is stored",
      meta: { reason: "scan_required" },
    });
  const sha256 = sha256Hex(f.bytes);
  const quarantineKey = quarantineKeyOf(f.key);
  const named = f.keyRef ? { keyRef: f.keyRef } : {};
  await w.storage.put(quarantineKey, f.bytes, {
    bucketClass: "QUARANTINE",
    contentType: f.contentType,
    sha256,
    ...named,
  });
  const file = { storageKey: quarantineKey, sha256 };
  let result: FileScanResult;
  try {
    result = await w.scan.scan(file, call);
  } catch {
    // The port never throws for a failed scan; a scanner that does anyway is an outage.
    result = outage(file, w.scan.descriptor.adapter);
  }
  const d = scanDecision(result);
  if (d.action === "reject")
    throw new PortError("IPB-SEC-011", w.port, {
      ...who,
      detail: "the file was rejected by the AV scan and is kept in quarantine",
      meta: { reason: "infected", quarantineKey },
    });
  if (d.action === "quarantine" || result.file.sha256 !== sha256)
    throw new PortError("IPB-SEC-015", w.port, {
      ...who,
      detail: "the file is not scanned clean; it stays in quarantine and is scanned again on retry",
      meta: {
        reason: "not_clean",
        scanReason: result.file.sha256 !== sha256 ? "hash_mismatch" : (result.reason ?? "error"),
        quarantineKey,
      },
    });
  // Promote the bytes read back from QUARANTINE (STORAGE checks them against the hash).
  const q = await w.storage.get(quarantineKey);
  if (sha256Hex(q.body) !== sha256)
    throw new PortError("IPB-SEC-015", w.port, {
      ...who,
      detail: "the quarantined bytes changed after the scan",
      meta: { reason: "not_clean", scanReason: "hash_mismatch", quarantineKey },
    });
  const meta: ObjectMeta = promotedObjectMeta(q.meta, { bucketClass: f.bucketClass });
  meta.tags = {
    ...meta.tags,
    [SCAN_TAGS.verdict]: result.verdict,
    [SCAN_TAGS.engine]: (result.engine ?? result.adapter).slice(0, 128),
    [SCAN_TAGS.scannedAt]: result.scannedAt,
    [SCAN_TAGS.sha256]: sha256,
  };
  await w.storage.put(f.key, q.body, meta);
  return { storageKey: f.key, sha256, scan: scanRecordOf(result) };
}

/**
 * The one start-up warning of a connector built without FILE_SCAN (R1-D-302): every write it would
 * make refuses `scan_required`, so a product notices before the first pull. Quiet in `local` and
 * `test`; an unknown environment warns. `warn` defaults to `process.emitWarning`.
 */
export function warnWithoutScanner(o: {
  port: string;
  adapter: string;
  scan?: FileScanPort | undefined;
  appEnv?: AppEnv | undefined;
  warn?: ((message: string) => void) | undefined;
}): boolean {
  if (o.scan) return false;
  if (o.appEnv && SCAN_WARNING_QUIET_ENVS.includes(o.appEnv)) return false;
  const message =
    `${o.port} adapter ${o.adapter} was built without a FILE_SCAN port: every file it receives ` +
    "is refused (IPB-SEC-015, scan_required). Pass the product's FILE_SCAN adapter as `scan`.";
  if (o.warn) o.warn(message);
  else process.emitWarning(message, { type: "IpbConfigurationWarning", code: "IPB-SEC-015" });
  return true;
}
