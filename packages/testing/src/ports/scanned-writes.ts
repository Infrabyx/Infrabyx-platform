// Contract cases for files a connector writes itself (Finbyx PR-FBX-57, R1-D-302, R1-D-304;
// IPB-02-44, `@IPB-02-AT-16` style). Every BUREAU and AA_FIU adapter that stores what its vendor
// sends passes them against its stub, a STORAGE and the fake scanner:
//   - EICAR in the vendor's answer: refused `IPB-SEC-011`, nothing `ready`, nothing outside QUARANTINE;
//   - the scanner down: refused `IPB-SEC-015`, then `ready` on a retry once the scanner is back;
//   - the record verifiable: `assertScannedClean(ref.scan, ref.sha256)` passes on what was returned,
//     the clean object carries its scan tags, and the check fails for other bytes.
import { expect } from "vitest";
import {
  SCAN_TAGS,
  assertScannedClean,
  type AccountAggregatorPort,
  type CreditBureauPort,
  type ScanErrorReason,
  type StoragePort,
} from "@infrabyx/contracts/ports";
import { EICAR } from "@infrabyx/fakes";
import { sha256Hex } from "@infrabyx/crypto";
import type { ContractCase } from "../contract.js";

/** What the scanned-write cases control: the vendor's answer, the scanner and the store. */
export interface ScannedWriteFixtures {
  storage: StoragePort;
  /** The vendor's next answers carry `text` (undefined: back to normal). */
  vendorRemarks(text: string | undefined): void;
  /** Every scan from now on ends in `ERROR` with this reason (null: scans normally). */
  scannerMode(mode: ScanErrorReason | null): void;
  /** The prefix the adapter writes under. */
  prefix: string;
}

const EICAR_TEXT = new TextDecoder().decode(EICAR);

/** Every object under `prefix` is in QUARANTINE: nothing was promoted. */
async function nothingPromoted(storage: StoragePort, prefix: string, before: Set<string>) {
  const { keys } = await storage.list(prefix);
  for (const k of keys.filter((k) => !before.has(k)))
    expect((await storage.get(k)).meta.bucketClass, k).toBe("QUARANTINE");
}

const keysOf = async (s: StoragePort, prefix: string) => new Set((await s.list(prefix)).keys);

/** One file as both ports return it. */
interface Written {
  storageKey: string;
  sha256: string;
  scan?: { verdict: string; file: { storageKey: string; sha256: string } } | undefined;
}

async function verifiable(fx: ScannedWriteFixtures, port: string, f: Written) {
  expect(f.scan, "the ref carries its scan").toBeDefined();
  assertScannedClean(f.scan!, f.sha256, port);
  expect(f.scan!.file.storageKey).not.toBe(f.storageKey);
  const o = await fx.storage.get(f.storageKey);
  expect(sha256Hex(o.body)).toBe(f.sha256);
  expect(o.meta.bucketClass).toBe("REGULATED");
  expect(o.meta.tags).toMatchObject({
    [SCAN_TAGS.verdict]: "CLEAN",
    [SCAN_TAGS.sha256]: f.sha256,
  });
  // The scanned copy is still in QUARANTINE, with the same bytes.
  expect((await fx.storage.get(f.scan!.file.storageKey)).meta.bucketClass).toBe("QUARANTINE");
  // The same record does not vouch for other bytes.
  expect(() => assertScannedClean(f.scan!, sha256Hex("other bytes"), port)).toThrow(
    expect.objectContaining({ code: "IPB-SEC-015" }),
  );
}

/** The BUREAU leg: `pull` makes one ready report of the known subject. */
export function bureauScannedWriteContractCases(
  fx: ScannedWriteFixtures & {
    pull: (p: CreditBureauPort) => ReturnType<CreditBureauPort["pull"]>;
  },
): ContractCase<CreditBureauPort>[] {
  return [
    {
      name: "@IPB-02-AT-16 EICAR in the CIC's report is refused IPB-SEC-011; nothing is ready or promoted (PR-FBX-57)",
      async run(p) {
        const before = await keysOf(fx.storage, fx.prefix);
        fx.vendorRemarks(EICAR_TEXT);
        try {
          await expect(fx.pull(p)).rejects.toMatchObject({
            code: "IPB-SEC-011",
            meta: { reason: "infected" },
          });
        } finally {
          fx.vendorRemarks(undefined);
        }
        await nothingPromoted(fx.storage, fx.prefix, before);
      },
    },
    {
      name: "the scanner down refuses the report IPB-SEC-015; a retry once it is back is ready (PR-FBX-57)",
      async run(p) {
        const before = await keysOf(fx.storage, fx.prefix);
        fx.scannerMode("unavailable");
        try {
          await expect(fx.pull(p)).rejects.toMatchObject({
            code: "IPB-SEC-015",
            meta: { reason: "not_clean", scanReason: "unavailable" },
          });
        } finally {
          fx.scannerMode(null);
        }
        await nothingPromoted(fx.storage, fx.prefix, before);
        const r = await fx.pull(p);
        expect(r.state).toBe("ready");
      },
    },
    {
      name: "a ready report's scan is verifiable by assertScannedClean and recorded on the object (PR-FBX-57)",
      async run(p) {
        const r = await fx.pull(p);
        expect(r.state).toBe("ready");
        await verifiable(fx, "BUREAU", r.report!);
      },
    },
  ];
}

/** The AA_FIU leg: `fetch` runs one fetch under an ACTIVE consent with at least one payload. */
export function aaScannedWriteContractCases(
  fx: ScannedWriteFixtures & {
    fetch: (p: AccountAggregatorPort) => ReturnType<AccountAggregatorPort["fetch"]>;
  },
): ContractCase<AccountAggregatorPort>[] {
  return [
    {
      name: "@IPB-02-AT-16 EICAR in an FI payload is refused IPB-SEC-011; no payload is returned or promoted (PR-FBX-57)",
      async run(p) {
        const before = await keysOf(fx.storage, fx.prefix);
        fx.vendorRemarks(EICAR_TEXT);
        try {
          await expect(fx.fetch(p)).rejects.toMatchObject({
            code: "IPB-SEC-011",
            meta: { reason: "infected" },
          });
        } finally {
          fx.vendorRemarks(undefined);
        }
        await nothingPromoted(fx.storage, fx.prefix, before);
      },
    },
    {
      name: "the scanner down refuses the fetch IPB-SEC-015; a retry once it is back returns the payloads (PR-FBX-57)",
      async run(p) {
        const before = await keysOf(fx.storage, fx.prefix);
        fx.scannerMode("unavailable");
        try {
          await expect(fx.fetch(p)).rejects.toMatchObject({
            code: "IPB-SEC-015",
            meta: { reason: "not_clean", scanReason: "unavailable" },
          });
        } finally {
          fx.scannerMode(null);
        }
        await nothingPromoted(fx.storage, fx.prefix, before);
        expect((await fx.fetch(p)).payloads.length).toBeGreaterThan(0);
      },
    },
    {
      name: "each payload's scan is verifiable by assertScannedClean and recorded on the object (PR-FBX-57)",
      async run(p) {
        const r = await fx.fetch(p);
        expect(r.payloads.length).toBeGreaterThan(0);
        for (const f of r.payloads) await verifiable(fx, "AA_FIU", f);
      },
    },
  ];
}
