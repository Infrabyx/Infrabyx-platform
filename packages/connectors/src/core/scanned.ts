// `writeScanned`: a file a connector writes itself (a credit bureau's report, an account
// aggregator's FI payload) is quarantined, scanned through FILE_SCAN and promoted only when CLEAN
// (Finbyx PR-FBX-57, R1-D-302, R1-D-304; IPB-02-44). The same rules as an upload:
//   1. the bytes go to `QUARANTINE` under a fresh key beside the clean one (an object never moves
//      class, so the quarantined copy has its own ULID); a named key reference is kept;
//   2. `FileScanPort.scan` reads them there (a scanner that throws counts as `ERROR`, unavailable);
//   3. `CLEAN`: the bytes read back from QUARANTINE (checked against the hash) are written to the
//      target class with the scan as tags (`SCAN_TAGS`), and the ref carries the scan record;
//   4. the promoted copy is read back: only if its SHA-256 equals the scanned one is it `ready`;
//      a read-back that fails or differs keeps both copies and refuses `IPB-SEC-015` (reason
//      `promotion_unverified`) (owner answer #216, R1-D-309);
//   5. with a `removal` unit of work, the quarantined copy is then deleted and an audit entry
//      (`promoted_clean_copy_removed`, the keys and the SHA-256) written in the same transaction;
//      if either fails, the transaction rolls back, both copies stay and the write refuses
//      `IPB-SEC-015` (reason `quarantine_not_removed`). Without `removal` the copy is kept, as in
//      1.38.0, and the adapter warns at start-up outside local and test;
//   6. `INFECTED`: `IPB-SEC-011` (reason `infected`); the quarantined object stays for the AV
//      owner, nothing is written at the clean key, and nothing is ever deleted;
//   7. `ERROR`: `IPB-SEC-015` (reason `not_clean`, with the scan's reason); the quarantined copy
//      is never deleted; retried later, it quarantines and scans again.
// Without a FILE_SCAN port nothing is written and every call refuses `IPB-SEC-015` (reason
// `scan_required`): optional in 1.x so no product breaks at construction, fail closed at run time
// (owner, 27 Nov 2026 16:10 IST); required at construction in 2.0.0.
import { PortError } from "@infrabyx/contracts/errors";
import type { AppEnv } from "@infrabyx/contracts/env";
import type { AuditSink, KernelContext, MutationKernel } from "@infrabyx/contracts/kernel";
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

/** The ledger action and reason of a quarantined copy removed after a verified promotion (#216). */
export const QUARANTINE_REMOVED_ACTION = "connectors.scanned_write.quarantine_removed";
export const QUARANTINE_REMOVED_REASON = "promoted_clean_copy_removed";

/**
 * The unit of work that removes a promoted file's quarantined copy (owner answer #216, R1-D-309):
 * the audit entry and the STORAGE delete run in one kernel transaction, so a failed delete rolls
 * the entry back. `context` gives the adapter's service principal in the file's tenant.
 */
export interface QuarantineRemoval {
  kernel: MutationKernel;
  audit: AuditSink;
  context: (tenantId: string) => KernelContext;
}

export interface ScannedWriter {
  port: string;
  adapter: string;
  storage: StoragePort;
  scan?: FileScanPort | undefined;
  /** Removes the quarantined copy once the promotion is verified; without it the copy is kept. */
  removal?: QuarantineRemoval | undefined;
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
  // Read the promoted copy back: nothing is `ready`, and nothing is deleted, unless it is the
  // scanned bytes (#216, R1-D-309).
  let readBack: "failed" | "differs" | undefined;
  try {
    if (sha256Hex((await w.storage.get(f.key)).body) !== sha256) readBack = "differs";
  } catch {
    readBack = "failed";
  }
  if (readBack)
    throw new PortError("IPB-SEC-015", w.port, {
      ...who,
      detail:
        "the promoted copy could not be verified against the scanned hash; both copies are kept",
      meta: { reason: "promotion_unverified", readBack, quarantineKey },
    });
  if (w.removal) await removeQuarantined(w, w.removal, f.key, quarantineKey, sha256);
  return { storageKey: f.key, sha256, scan: scanRecordOf(result) };
}

/** Delete the quarantined copy with its audit entry in one transaction (#216, R1-D-309). */
async function removeQuarantined(
  w: ScannedWriter,
  removal: QuarantineRemoval,
  storageKey: string,
  quarantineKey: string,
  sha256: string,
): Promise<void> {
  const who = { adapter: w.adapter };
  const tenantId = /^tenant\/([^/]+)\//.exec(quarantineKey)?.[1] ?? "";
  const ctx = removal.context(tenantId);
  if (ctx.tenantId !== tenantId)
    throw new PortError("IPB-PORT-001", w.port, {
      ...who,
      detail: "the quarantine removal's context names another tenant; both copies are kept",
      meta: { reason: "tenant_mismatch", quarantineKey },
    });
  try {
    await removal.kernel.mutate(
      ctx,
      async (tx) => {
        await removal.audit.record(tx, {
          action: QUARANTINE_REMOVED_ACTION,
          resourceType: "storage.object",
          resourceId: quarantineKey,
          after: {
            reason: QUARANTINE_REMOVED_REASON,
            quarantineKey,
            storageKey,
            sha256,
            port: w.port,
            adapter: w.adapter,
          },
        });
        await w.storage.delete(quarantineKey);
      },
      { action: QUARANTINE_REMOVED_ACTION },
    );
  } catch {
    throw new PortError("IPB-SEC-015", w.port, {
      ...who,
      detail:
        "the quarantined copy could not be removed with its audit entry; both copies are kept",
      meta: { reason: "quarantine_not_removed", quarantineKey },
    });
  }
}

/**
 * The one start-up warning of a connector built without FILE_SCAN (R1-D-302): every write it would
 * make refuses `scan_required`, so a product notices before the first pull. With a scanner but no
 * `removal` (#216, R1-D-309) it warns that each promoted file's quarantined copy is kept. Quiet in
 * `local` and `test`; an unknown environment warns. `warn` defaults to `process.emitWarning`.
 */
export function warnWithoutScanner(o: {
  port: string;
  adapter: string;
  scan?: FileScanPort | undefined;
  removal?: QuarantineRemoval | undefined;
  appEnv?: AppEnv | undefined;
  warn?: ((message: string) => void) | undefined;
}): boolean {
  if (o.scan && o.removal) return false;
  if (o.appEnv && SCAN_WARNING_QUIET_ENVS.includes(o.appEnv)) return false;
  const message = o.scan
    ? `${o.port} adapter ${o.adapter} was built without a quarantine removal: the quarantined ` +
      "copy of each promoted file is kept. Pass `removal` (kernel, audit, context) to delete it " +
      "once the promotion is verified."
    : `${o.port} adapter ${o.adapter} was built without a FILE_SCAN port: every file it receives ` +
      "is refused (IPB-SEC-015, scan_required). Pass the product's FILE_SCAN adapter as `scan`.";
  if (o.warn) o.warn(message);
  else process.emitWarning(message, { type: "IpbConfigurationWarning", code: "IPB-SEC-015" });
  return true;
}
