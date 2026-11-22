// STORAGE integrity contract cases (Udofin PR-UDF-080, R1-D-269). Every STORAGE adapter, and
// `MemoryStorage`, refuses a tampered object with `IPB-STOR-005` (`meta.reason` `hash_mismatch`)
// and an unreadable store with `IPB-PORT-002`, and neither returns bytes, so a product's fixture
// cannot pass what the `s3` adapter refuses or read a tamper as an outage.
import { expect } from "vitest";
import { toProblem } from "@infrabyx/contracts/errors";
import {
  STORAGE_HASH_MISMATCH,
  STORAGE_INTEGRITY_ERROR,
  type BucketClass,
  type StoragePort,
} from "@infrabyx/contracts/ports";
import { ulid } from "@infrabyx/crypto";
import type { ContractCase } from "./contract.js";

/** How a leg tampers with an object beneath the adapter, and reaches a store that is down. */
export interface StorageIntegrityFixture {
  /**
   * Make the bytes the store holds for `key` (written through the adapter in `bucketClass`) differ
   * from the SHA-256 recorded at write, beneath the adapter: for S3, a raw `PutObject` of other
   * bytes keeping the object's metadata; for `MemoryStorage`, its `readError` option.
   */
  tamper(key: string, bucketClass: BucketClass): Promise<void>;
  /** The adapter with its store unreachable, or failing reads of `key` (an outage). */
  outage(key: string): StoragePort | Promise<StoragePort>;
  /** The tenant of the keys the cases write (default `tnt_contract`). */
  tenantId?: string;
}

/** The integrity cases: run them with `defineContractSuite("STORAGE", factory, cases)`. */
export function storageIntegrityContractCases(
  fx: StorageIntegrityFixture,
): Array<ContractCase<StoragePort>> {
  const tenant = fx.tenantId ?? "tnt_contract";
  const key = () => `tenant/${tenant}/vault/${ulid()}.pdf`;
  const enc = (s: string) => new TextEncoder().encode(s);
  /** The thrown error; the case fails if the read resolved (it must never return bytes). */
  const thrown = (p: Promise<unknown>): Promise<Record<string, unknown>> =>
    p.then(
      () => {
        throw new Error("the read returned instead of failing closed");
      },
      (e: unknown) => e as Record<string, unknown>,
    );
  return [
    {
      name: "a tampered object is IPB-STOR-005 hash_mismatch, a 500 never retried, with no bytes and a fixed detail (PR-UDF-080)",
      async run(p) {
        const k = key();
        const intact = key();
        const body = enc("sanction letter, lender copy");
        await p.put(k, body, { bucketClass: "REGULATED", contentType: "application/pdf" });
        await p.put(intact, body, { bucketClass: "REGULATED", contentType: "application/pdf" });
        await fx.tamper(k, "REGULATED");
        const e = await thrown(p.get(k));
        expect(e).toMatchObject({
          code: STORAGE_INTEGRITY_ERROR,
          meta: { reason: STORAGE_HASH_MISMATCH },
        });
        expect(e).not.toHaveProperty("body");
        // Fixed text: never the key, its tenant, a bucket or a hash.
        const text = `${String(e.message)} ${String(e.detail ?? "")}`;
        expect(text).not.toContain(k);
        expect(text).not.toContain(tenant);
        expect(text).not.toMatch(/[0-9a-f]{64}|[A-Za-z0-9+/]{43}=|bucket/i);
        const problem = toProblem(e);
        expect(problem).toMatchObject({
          status: 500,
          code: "IPB-STOR-005",
          reason: "hash_mismatch",
        });
        expect(problem.retry_after_seconds).toBeUndefined();
        expect(JSON.stringify(problem)).not.toContain(k);
        // Only the tampered object is refused.
        expect(new TextDecoder().decode((await p.get(intact)).body)).toBe(
          "sanction letter, lender copy",
        );
      },
    },
    {
      name: "a store that cannot be read is IPB-PORT-002, never the integrity code, and returns no bytes (PR-UDF-080)",
      async run(p) {
        const k = key();
        await p.put(k, enc("statement"), { bucketClass: "REGULATED" });
        const down = await fx.outage(k);
        const e = await thrown(down.get(k));
        expect(e).toMatchObject({ code: "IPB-PORT-002" });
        expect(e.code).not.toBe(STORAGE_INTEGRITY_ERROR);
        expect(e).not.toHaveProperty("body");
        expect(toProblem(e).status).toBe(503);
      },
    },
  ];
}
