// The AV fake passes its own contract cases, and its forced errors are never CLEAN (PR-LDC-41).
import { describe, expect, it } from "vitest";
import { scanDecision } from "@infrabyx/contracts/ports";
import { sha256Hex, ulid } from "@infrabyx/crypto";
import { defineContractSuite } from "../contract.js";
import { MemoryStorage } from "../fakes.js";
import { FakeFileScan, fileScanContractCases } from "./file-scan.js";

const storage = new MemoryStorage();
const av = new FakeFileScan(storage);
defineContractSuite("AV", () => av, fileScanContractCases(storage));

describe("FakeFileScan", () => {
  it("forced errors and oversized files are ERROR and stay quarantined", async () => {
    const s = new MemoryStorage();
    const body = new TextEncoder().encode("0123456789");
    const storageKey = `tenant/tnt_a/uploads/${ulid()}`;
    await s.put(storageKey, body, { bucketClass: "QUARANTINE" });
    const f = { storageKey, sha256: sha256Hex(body) };
    const small = new FakeFileScan(s, 4);
    expect((await small.scan(f)).reason).toBe("too_large");
    const fake = new FakeFileScan(s);
    fake.mode = "stale_signatures";
    const r = await fake.scan(f);
    expect(r.verdict).toBe("ERROR");
    expect(scanDecision(r).action).toBe("quarantine");
  });
});
