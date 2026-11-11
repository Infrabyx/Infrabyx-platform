// AV port fake and contract cases (IPB-01 AV; IPB-02-44; LawDocsComply PR-LDC-41, R1-D-117). Every
// adapter passes the same cases against files it reads from STORAGE: a clean file is `CLEAN`, the
// EICAR test file is `INFECTED`, and a hash mismatch or a missing object is `ERROR`, never `CLEAN`.
// The fake recognises EICAR itself; the ClamAV adapter runs the same cases against clamd.
import { expect } from "vitest";
import {
  FileScanRequest,
  scanDecision,
  type AdapterDescriptor,
  type DocFileRef,
  type FileScanPort,
  type FileScanResult,
  type PortHealth,
  type ScanErrorReason,
  type StoragePort,
} from "@infrabyx/contracts/ports";
import { sha256Hex, ulid } from "@infrabyx/crypto";
import type { ContractCase } from "../contract.js";

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
      status: this.mode === "unavailable" ? "down" : "up",
      latency_ms: 0,
      checked_at: new Date().toISOString(),
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
    } catch {
      return result("ERROR", { reason: "unavailable" });
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

const PREFIX = "tenant/tnt_contract/uploads";

/**
 * The AV contract (IPB-02-44): `storage` is where the adapter under test reads files from.
 */
export function fileScanContractCases(storage: StoragePort): Array<ContractCase<FileScanPort>> {
  const put = async (body: Uint8Array): Promise<DocFileRef> => {
    const storageKey = `${PREFIX}/${ulid()}`;
    await storage.put(storageKey, body, {
      bucketClass: "QUARANTINE",
      contentType: "application/octet-stream",
    });
    return { storageKey, sha256: sha256Hex(body) };
  };
  const shape = (r: FileScanResult, file: DocFileRef) => {
    expect(r.file).toEqual(file);
    expect(Number.isNaN(Date.parse(r.scannedAt))).toBe(false);
    expect(r.adapter).toMatch(/^[a-z][a-z0-9_-]*$/);
  };
  return [
    {
      name: "a clean file is CLEAN and released",
      method: "scan",
      async run(p) {
        const f = await put(new TextEncoder().encode("Board resolution, 10 November 2026.\n"));
        const r = await p.scan(f);
        shape(r, f);
        expect(r.verdict).toBe("CLEAN");
        expect(r.threat).toBeNull();
        expect(r.reason).toBeNull();
        expect(scanDecision(r)).toEqual({ action: "release" });
      },
    },
    {
      name: "the EICAR test file is INFECTED, named, and rejected (IPB-SEC-011)",
      method: "scan",
      async run(p) {
        const f = await put(EICAR);
        const r = await p.scan(f);
        shape(r, f);
        expect(r.verdict).toBe("INFECTED");
        expect(r.threat ?? "").toMatch(/eicar/i);
        expect(scanDecision(r)).toEqual({ action: "reject", code: "IPB-SEC-011" });
      },
    },
    {
      name: "bytes that do not match the hash are ERROR (hash_mismatch) and stay quarantined",
      method: "scan",
      async run(p) {
        const f = await put(new TextEncoder().encode("original"));
        const r = await p.scan({ ...f, sha256: sha256Hex("something else") });
        expect(r.verdict).toBe("ERROR");
        expect(r.reason).toBe("hash_mismatch");
        expect(scanDecision(r)).toEqual({ action: "quarantine", code: "IPB-SEC-015" });
      },
    },
    {
      name: "a missing object is ERROR, never CLEAN; a request outside the schema is refused",
      method: "scan",
      async run(p) {
        const r = await p.scan({ storageKey: `${PREFIX}/${ulid()}`, sha256: sha256Hex("x") });
        expect(r.verdict).toBe("ERROR");
        expect(r.reason).toBe("unavailable");
        await expect(
          p.scan({ storageKey: `${PREFIX}/${ulid()}`, sha256: "nothex" }),
        ).rejects.toThrow();
      },
    },
  ];
}
