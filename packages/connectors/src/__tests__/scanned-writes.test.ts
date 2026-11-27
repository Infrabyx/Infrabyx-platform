// PR-FBX-57 (R1-D-304): `writeScanned`, the quarantine, scan and promote step every connector
// uses for a file it writes itself, and the guard that the Connector Agent's code stores no file
// outside it.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SCAN_TAGS, assertScannedClean, type FileScanPort } from "@infrabyx/contracts/ports";
import { ulid } from "@infrabyx/crypto";
import { EICAR, FakeFileScan, MemoryStorage } from "@infrabyx/testing";
import { quarantineKeyOf, warnWithoutScanner, writeScanned } from "../core/scanned.js";

const enc = (s: string) => new TextEncoder().encode(s);
const key = () => `tenant/tnt_a/los/${ulid()}.json`;

function setup() {
  const storage = new MemoryStorage();
  const scan = new FakeFileScan(storage);
  return { storage, scan, w: { port: "BUREAU", adapter: "test", storage, scan } };
}

describe("PR-FBX-57 writeScanned", () => {
  it("CLEAN: the clean copy is the scanned bytes with its scan tags; the ref verifies", async () => {
    const { storage, w } = setup();
    const k = key();
    const f = await writeScanned(w, {
      key: k,
      bytes: enc('{"a":1}'),
      contentType: "application/json",
      bucketClass: "REGULATED",
    });
    expect(f.storageKey).toBe(k);
    assertScannedClean(f.scan, f.sha256, "BUREAU");
    const o = await storage.get(k);
    expect(o.meta).toMatchObject({
      bucketClass: "REGULATED",
      contentType: "application/json",
      tags: { [SCAN_TAGS.verdict]: "CLEAN", [SCAN_TAGS.sha256]: f.sha256 },
    });
    expect(o.meta.tags?.[SCAN_TAGS.engine]).toBe("fake-av 1");
    const q = await storage.get(f.scan.file.storageKey);
    expect(q.meta.bucketClass).toBe("QUARANTINE");
    expect(f.scan.file.storageKey.startsWith("tenant/tnt_a/los/")).toBe(true);
  });

  it("INFECTED: IPB-SEC-011, the file stays in quarantine, nothing at the clean key", async () => {
    const { storage, w } = setup();
    const k = key();
    const err = (await writeScanned(w, {
      key: k,
      bytes: EICAR,
      contentType: "application/octet-stream",
      bucketClass: "REGULATED",
    }).catch((e: unknown) => e)) as { code: string; meta: { quarantineKey: string } };
    expect(err).toMatchObject({ code: "IPB-SEC-011", meta: { reason: "infected" } });
    expect((await storage.get(err.meta.quarantineKey)).meta.bucketClass).toBe("QUARANTINE");
    await expect(storage.get(k)).rejects.toThrow();
  });

  it("ERROR, a scanner that throws, and a scan of other bytes are IPB-SEC-015 not_clean", async () => {
    const { storage, scan, w } = setup();
    const f = {
      bytes: enc("x"),
      contentType: "application/json",
      bucketClass: "REGULATED" as const,
    };
    scan.mode = "timeout";
    await expect(writeScanned(w, { ...f, key: key() })).rejects.toMatchObject({
      code: "IPB-SEC-015",
      meta: { reason: "not_clean", scanReason: "timeout" },
    });
    const throwing: FileScanPort = {
      descriptor: scan.descriptor,
      health: () => scan.health(),
      scan: async () => {
        throw new Error("socket hang up");
      },
    };
    await expect(
      writeScanned({ ...w, scan: throwing }, { ...f, key: key() }),
    ).rejects.toMatchObject({
      code: "IPB-SEC-015",
      meta: { reason: "not_clean", scanReason: "unavailable" },
    });
    const lying: FileScanPort = {
      ...throwing,
      scan: async (file) => ({
        ...(await new FakeFileScan(storage).scan(file)),
        file: { ...file, sha256: "0".repeat(64) },
      }),
    };
    await expect(writeScanned({ ...w, scan: lying }, { ...f, key: key() })).rejects.toMatchObject({
      code: "IPB-SEC-015",
      meta: { reason: "not_clean", scanReason: "hash_mismatch" },
    });
  });

  it("without a scanner nothing is written: IPB-SEC-015 scan_required", async () => {
    const { storage } = setup();
    const k = key();
    await expect(
      writeScanned(
        { port: "AA_FIU", adapter: "test", storage },
        { key: k, bytes: enc("x"), contentType: "application/json", bucketClass: "REGULATED" },
      ),
    ).rejects.toMatchObject({ code: "IPB-SEC-015", meta: { reason: "scan_required" } });
    expect((await storage.list("tenant/tnt_a/los/")).keys).toEqual([]);
  });

  it("the quarantine key keeps the tenant, module and extension, never the clean key", () => {
    const k = key();
    const q = quarantineKeyOf(k);
    expect(q).not.toBe(k);
    expect(q).toMatch(/^tenant\/tnt_a\/los\/[0-9A-HJKMNP-TV-Z]{26}\.json$/);
    expect(() => quarantineKeyOf("tenant/tnt_a/../x")).toThrow();
  });

  it("warns once without a scanner, unless local or test; an unknown environment warns", () => {
    const seen: string[] = [];
    const warn = (m: string) => seen.push(m);
    expect(warnWithoutScanner({ port: "BUREAU", adapter: "x", appEnv: "local", warn })).toBe(false);
    expect(warnWithoutScanner({ port: "BUREAU", adapter: "x", appEnv: "dev", warn })).toBe(true);
    expect(warnWithoutScanner({ port: "BUREAU", adapter: "x", warn })).toBe(true);
    expect(seen).toHaveLength(2);
  });
});

describe("PR-FBX-57 the Connector Agent stores no file outside writeScanned", () => {
  it("nothing under accounting/ writes STORAGE directly ([VERIFY] closed: the agent hands JSON bodies only)", () => {
    const root = fileURLToPath(new URL("../accounting/", import.meta.url));
    const files: string[] = [];
    const walk = (d: string) => {
      for (const n of readdirSync(d)) {
        const p = join(d, n);
        if (statSync(p).isDirectory()) walk(p);
        else if (n.endsWith(".ts") && !n.endsWith(".test.ts")) files.push(p);
      }
    };
    walk(root);
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      // A STORAGE write here must go through `writeScanned`; this fails the day one is added.
      if (/\.(put|putWithRetention)\(/.test(src) || /StoragePort/.test(src))
        expect(src, f).toContain("writeScanned");
    }
  });
});
