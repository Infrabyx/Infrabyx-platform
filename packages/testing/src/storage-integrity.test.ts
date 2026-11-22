// MemoryStorage's injected read failures, and the fakes that read through it (PR-UDF-080, R1-D-269).
import { describe, expect, it } from "vitest";
import { scanDecision } from "@infrabyx/contracts/ports";
import { sha256Hex, ulid } from "@infrabyx/crypto";
import { MemoryStorage } from "./fakes.js";
import { FakeFileScan } from "./ports/file-scan.js";

const enc = (s: string) => new TextEncoder().encode(s);
const key = () => `tenant/tnt_a/uploads/${ulid()}.pdf`;

describe("MemoryStorage readError (PR-UDF-080)", () => {
  it("integrity: get throws IPB-STOR-005 hash_mismatch for that key only, and never the bytes", async () => {
    const bad = key();
    const good = key();
    const s = new MemoryStorage(undefined, {
      readError: (k) => (k === bad ? "integrity" : undefined),
    });
    await s.put(bad, enc("a"), { bucketClass: "REGULATED" });
    await s.put(good, enc("b"), { bucketClass: "REGULATED" });
    await expect(s.get(bad)).rejects.toMatchObject({
      code: "IPB-STOR-005",
      meta: { reason: "hash_mismatch" },
    });
    expect(new TextDecoder().decode((await s.get(good)).body)).toBe("b");
    // A missing object is still not found; the hook is about stored bytes.
    await expect(s.get(key())).rejects.toMatchObject({ code: "IPB-STOR-001" });
  });

  it("unavailable: get throws IPB-PORT-002 before looking the object up", async () => {
    const s = new MemoryStorage(undefined, { readError: () => "unavailable" });
    const k = key();
    await s.put(k, enc("a"), { bucketClass: "GENERAL" });
    await expect(s.get(k)).rejects.toMatchObject({ code: "IPB-PORT-002" });
    await expect(s.get(key())).rejects.toMatchObject({ code: "IPB-PORT-002" });
  });

  it("replicateTo stops on a tampered object rather than copying it", async () => {
    const k = key();
    const s = new MemoryStorage(undefined, { readError: () => "integrity" });
    await s.put(k, enc("a"), { bucketClass: "GENERAL" });
    const target = new MemoryStorage();
    await expect(s.replicateTo(target, "tenant/tnt_a/")).rejects.toMatchObject({
      code: "IPB-STOR-005",
    });
    expect(target.objects.size).toBe(0);
  });

  it("without readError, reads are as before", async () => {
    const s = new MemoryStorage();
    const k = key();
    await s.put(k, enc("a"), { bucketClass: "GENERAL" });
    expect((await s.get(k)).meta.sha256).toBe(sha256Hex("a"));
  });

  it("FakeFileScan: an object STORAGE refuses for integrity is ERROR hash_mismatch; an outage is unavailable", async () => {
    const body = enc("upload");
    const k = key();
    const file = { storageKey: k, sha256: sha256Hex(body) };
    for (const [readError, reason] of [
      ["integrity", "hash_mismatch"],
      ["unavailable", "unavailable"],
    ] as const) {
      const s = new MemoryStorage(undefined, { readError: () => readError });
      await s.put(k, body, { bucketClass: "QUARANTINE" });
      const r = await new FakeFileScan(s).scan(file);
      expect(r).toMatchObject({ verdict: "ERROR", reason });
      expect(scanDecision(r).action).toBe("quarantine");
    }
  });
});
