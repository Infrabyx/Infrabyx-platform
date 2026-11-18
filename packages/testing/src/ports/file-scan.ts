// AV port fake and contract cases (IPB-01 AV; IPB-02-44; LawDocsComply PR-LDC-41, R1-D-117). Every
// adapter passes the same cases against files it reads from STORAGE: a clean file is `CLEAN`, the
// EICAR test file is `INFECTED`, and a hash mismatch or a missing object is `ERROR`, never `CLEAN`.
// The fake recognises EICAR itself; the ClamAV adapter runs the same cases against clamd.
// AV port fake and contract cases (IPB-01 AV; IPB-02-44; LawDocsComply PR-LDC-41, R1-D-117). Every
// adapter passes the same cases against files it reads from STORAGE: a clean file is `CLEAN`, the
// EICAR test file is `INFECTED`, and a hash mismatch or a missing object is `ERROR`, never `CLEAN`.
// The fake recognises EICAR itself; the ClamAV adapter runs the same cases against clamd.
import { expect } from "vitest";
import {
  scanDecision,
  type DocFileRef,
  type FileScanPort,
  type FileScanResult,
  type StoragePort,
} from "@infrabyx/contracts/ports";
import { sha256Hex, ulid } from "@infrabyx/crypto";
import type { ContractCase } from "../contract.js";
import { EICAR } from "@infrabyx/fakes";
export { EICAR, FakeFileScan } from "@infrabyx/fakes";

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
    {
      name: "health reports signature-database freshness (PR-LDC-41)",
      async run(p) {
        const h = await p.health();
        expect(h.status).not.toBe("down");
        const d = h.detail ?? {};
        expect(typeof d.engine).toBe("string");
        expect(typeof d.max_signature_age_hours).toBe("number");
        expect(typeof d.signatures_fresh).toBe("boolean");
        expect(d.signatures_fresh).toBe(h.status === "up");
        if (d.signature_age_hours !== null) expect(d.signature_age_hours).toBeGreaterThanOrEqual(0);
      },
    },
  ];
}
