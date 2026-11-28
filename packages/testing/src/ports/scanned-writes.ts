// Contract cases for files a connector writes itself (Finbyx PR-FBX-57, R1-D-302, R1-D-304;
// IPB-02-44, `@IPB-02-AT-16` style). Every BUREAU and AA_FIU adapter that stores what its vendor
// sends passes them against its stub, a STORAGE and the fake scanner:
//   - EICAR in the vendor's answer: refused `IPB-SEC-011`, nothing `ready`, nothing outside QUARANTINE;
//   - the scanner down: refused `IPB-SEC-015`, then `ready` on a retry once the scanner is back;
//   - the record verifiable: `assertScannedClean(ref.scan, ref.sha256)` passes on what was returned,
//     the clean object carries its scan tags, and the check fails for other bytes;
//   - with a quarantine removal (owner answer #216, R1-D-309; `quarantineRemovalHarness`): a CLEAN
//     file leaves no quarantined copy and one audit entry; a promoted copy that reads back failed
//     or different keeps both copies and nothing is `ready`; a failed delete rolls its entry back;
//     INFECTED and ERROR copies stay in QUARANTINE with no entry.
import { expect } from "vitest";
import { IpbError } from "@infrabyx/contracts/errors";
import type {
  AuditEntryInput,
  AuditSink,
  KernelContext,
  MutationKernel,
  Tx,
} from "@infrabyx/contracts/kernel";
import {
  SCAN_TAGS,
  assertScannedClean,
  type AccountAggregatorPort,
  type CreditBureauPort,
  type ScanErrorReason,
  type StoragePort,
  type StoredObject,
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
  /**
   * The adapter was built with `removal` from this harness (#216, R1-D-309); `storage` must be the
   * harness's `storage`. Without it the cases expect the quarantined copy to be kept.
   */
  removal?: QuarantineRemovalHarness;
}

/** Where a promoted copy's read-back goes wrong: unreadable, or other bytes. */
export type PromotedReadBackFault = "failed" | "differs";

/** The action and reason `writeScanned` records when it removes a quarantined copy. */
export const QUARANTINE_REMOVED_ACTION = "connectors.scanned_write.quarantine_removed";
export const QUARANTINE_REMOVED_REASON = "promoted_clean_copy_removed";

/**
 * A STORAGE, an in-memory kernel and an audit sink for the quarantine-removal cases (#216). The
 * kernel commits a unit's entries only when it returns (a unit that throws leaves none) and, like
 * the real kernel, refuses a unit that wrote no entry. `storage` wraps `inner`: reads of an object
 * outside QUARANTINE can be made to fail or return other bytes, and the next delete to fail.
 */
export interface QuarantineRemovalHarness {
  storage: StoragePort;
  removal: {
    kernel: MutationKernel;
    audit: AuditSink;
    context: (tenantId: string) => KernelContext;
  };
  /** The committed audit entries, oldest first. */
  readonly entries: readonly AuditEntryInput[];
  promotedReadBack(fault: PromotedReadBackFault | null): void;
  failNextDelete(): void;
}

export function quarantineRemovalHarness(inner: StoragePort): QuarantineRemovalHarness {
  let fault: PromotedReadBackFault | null = null;
  let failDelete = false;
  const entries: AuditEntryInput[] = [];
  const pending = new WeakMap<Tx, AuditEntryInput[]>();
  const storage = new Proxy(inner, {
    get(target, prop, receiver) {
      if (prop === "get")
        return async (key: string): Promise<StoredObject> => {
          const o = await target.get(key);
          if (!fault || o.meta.bucketClass === "QUARANTINE") return o;
          if (fault === "failed")
            throw new IpbError("IPB-PORT-002", { detail: "injected read-back failure" });
          return { ...o, body: new TextEncoder().encode("other bytes") };
        };
      if (prop === "delete")
        return async (key: string): Promise<void> => {
          if (failDelete) {
            failDelete = false;
            throw new IpbError("IPB-PORT-002", { detail: "injected delete failure" });
          }
          return target.delete(key);
        };
      const v = Reflect.get(target, prop, receiver) as unknown;
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
  });
  const kernel: MutationKernel = {
    async mutate(ctx, fn) {
      const mine: AuditEntryInput[] = [];
      let audited = false;
      const tx: Tx = {
        ctx,
        query: async () => ({ rows: [], rowCount: 0 }),
        markAudited() {
          audited = true;
        },
        get audited() {
          return audited;
        },
      };
      pending.set(tx, mine);
      const out = await fn(tx);
      if (!audited)
        throw new IpbError("IPB-MOD-003", { detail: "mutation wrote no audit ledger entry" });
      entries.push(...mine);
      return out;
    },
    read: async (ctx, fn) => fn({ ctx } as Tx),
  };
  const audit: AuditSink = {
    async record(tx, entry) {
      pending.get(tx)!.push(entry);
      tx.markAudited();
      return { id: `led_${entries.length + 1}` };
    },
  };
  const context = (tenantId: string): KernelContext => ({
    tenantId,
    principal: { id: "svc_connectors", type: "service", roles: [] },
  });
  return {
    storage,
    removal: { kernel, audit, context },
    get entries() {
      return entries;
    },
    promotedReadBack(f) {
      fault = f;
    },
    failNextDelete() {
      failDelete = true;
    },
  };
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
  if (fx.removal) {
    // #216: the quarantined copy is gone, and one entry names it, the clean key and the hash.
    await expect(fx.storage.get(f.scan!.file.storageKey)).rejects.toMatchObject({
      code: "IPB-STOR-001",
    });
    const e = fx.removal.entries.filter((x) => x.resourceId === f.scan!.file.storageKey);
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({
      action: QUARANTINE_REMOVED_ACTION,
      resourceType: "storage.object",
      after: {
        reason: QUARANTINE_REMOVED_REASON,
        quarantineKey: f.scan!.file.storageKey,
        storageKey: f.storageKey,
        sha256: f.sha256,
      },
    });
  } else {
    // The scanned copy is still in QUARANTINE, with the same bytes.
    expect((await fx.storage.get(f.scan!.file.storageKey)).meta.bucketClass).toBe("QUARANTINE");
  }
  // The same record does not vouch for other bytes.
  expect(() => assertScannedClean(f.scan!, sha256Hex("other bytes"), port)).toThrow(
    expect.objectContaining({ code: "IPB-SEC-015" }),
  );
}

/** The quarantine key a refusal names is still in QUARANTINE with the bytes that were scanned. */
async function quarantineKept(fx: ScannedWriteFixtures, err: unknown): Promise<string> {
  const key = (err as { meta?: { quarantineKey?: unknown } }).meta?.quarantineKey;
  expect(typeof key, "the refusal names the quarantine key").toBe("string");
  const q = await fx.storage.get(key as string);
  expect(q.meta.bucketClass).toBe("QUARANTINE");
  expect(sha256Hex(q.body)).toBe(q.meta.sha256);
  return key as string;
}

async function refusal(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (e) {
    return e;
  }
  throw new Error("expected a refusal");
}

/** The #216 cases, for a port whose `write` makes at least one scanned file. */
function removalCases<P>(
  fx: ScannedWriteFixtures,
  write: (p: P) => Promise<unknown>,
  what: string,
): ContractCase<P>[] {
  const h = fx.removal;
  if (!h) return [];
  const newEntries = (n: number) => h.entries.slice(n);
  return [
    ...(["differs", "failed"] as const).map((f): ContractCase<P> => ({
      name: `a promoted ${what} that reads back ${f === "differs" ? "different" : "unreadable"} keeps both copies, is not ready and deletes nothing (#216, R1-D-309)`,
      async run(p) {
        const n = h.entries.length;
        const before = await keysOf(fx.storage, fx.prefix);
        h.promotedReadBack(f);
        let err: unknown;
        try {
          err = await refusal(() => write(p));
        } finally {
          h.promotedReadBack(null);
        }
        expect(err).toMatchObject({
          code: "IPB-SEC-015",
          meta: { reason: "promotion_unverified", readBack: f },
        });
        const q = await quarantineKept(fx, err);
        // The promoted copy is there too: one new REGULATED object beside the quarantined one.
        const added = [...(await keysOf(fx.storage, fx.prefix))].filter((k) => !before.has(k));
        expect(added).toContain(q);
        const classes = await Promise.all(
          added.map(async (k) => (await fx.storage.get(k)).meta.bucketClass),
        );
        expect(classes).toContain("REGULATED");
        expect(newEntries(n)).toEqual([]);
      },
    })),
    {
      name: `a failed delete of a ${what}'s quarantined copy rolls its audit entry back and keeps the copy (#216)`,
      async run(p) {
        const n = h.entries.length;
        h.failNextDelete();
        const err = await refusal(() => write(p));
        expect(err).toMatchObject({
          code: "IPB-SEC-015",
          meta: { reason: "quarantine_not_removed" },
        });
        await quarantineKept(fx, err);
        expect(newEntries(n)).toEqual([]);
      },
    },
    {
      name: `an INFECTED ${what} keeps its quarantined copy, with no audit entry (#216)`,
      async run(p) {
        const n = h.entries.length;
        fx.vendorRemarks(EICAR_TEXT);
        let err: unknown;
        try {
          err = await refusal(() => write(p));
        } finally {
          fx.vendorRemarks(undefined);
        }
        expect(err).toMatchObject({ code: "IPB-SEC-011" });
        await quarantineKept(fx, err);
        expect(newEntries(n)).toEqual([]);
      },
    },
    {
      name: `a ${what} the scanner could not scan (ERROR) keeps its quarantined copy, with no audit entry (#216)`,
      async run(p) {
        const n = h.entries.length;
        fx.scannerMode("unavailable");
        let err: unknown;
        try {
          err = await refusal(() => write(p));
        } finally {
          fx.scannerMode(null);
        }
        expect(err).toMatchObject({ code: "IPB-SEC-015", meta: { reason: "not_clean" } });
        await quarantineKept(fx, err);
        expect(newEntries(n)).toEqual([]);
      },
    },
  ];
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
    ...removalCases<CreditBureauPort>(fx, fx.pull, "report"),
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
    ...removalCases<AccountAggregatorPort>(fx, fx.fetch, "FI payload"),
  ];
}
