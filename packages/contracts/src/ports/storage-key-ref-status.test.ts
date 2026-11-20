// PR-UDF-068 (R1-D-239): the configuration-free part of `StoragePort.keyRefStatus`.
import { describe, expect, it } from "vitest";
import {
  STORAGE_KEY_STATES,
  isValidStorageTenantId,
  storageKeyRefStatusRefusal,
} from "./storage.js";

describe("PR-UDF-068: storage key reference status", () => {
  it("accepts only a tenant id that can head a storage key", () => {
    for (const ok of ["tnt_a", "udf_01JA0000", "abcdef_X"])
      expect(isValidStorageTenantId(ok)).toBe(true);
    for (const bad of ["", "tnt", "tnt_", "TNT_a", "abcdefg_a", "tnt_a/../x", "tnt_a/"])
      expect(isValidStorageTenantId(bad)).toBe(false);
    expect(storageKeyRefStatusRefusal("tnt_a/x", "lender:a", "REGULATED")).toBeNull();
  });

  it("refuses as a write would: the format, the class and a prefix outside the tenant", () => {
    expect(storageKeyRefStatusRefusal("tnt_a", "lender:a", "REGULATED")).toEqual({});
    expect(storageKeyRefStatusRefusal("tnt_a", "lender:a", "CONFIDENTIAL")).toEqual({});
    expect(
      storageKeyRefStatusRefusal("tnt_a", "arn:aws:kms:ap-south-1:111122223333:key", "REGULATED"),
    ).toEqual({ refusal: "key_ref_invalid" });
    expect(storageKeyRefStatusRefusal("tnt_a", "lender:a", "GENERAL")).toEqual({
      refusal: "key_ref_class",
    });
    expect(
      storageKeyRefStatusRefusal("tnt_a", "lender:a", "REGULATED", {
        "tenant/tnt_b/vault/": "lender:a",
      }),
    ).toEqual({ refusal: "key_ref_prefix_invalid" });
    // A prefix of the tenant's own never conflicts: the status names no object.
    expect(
      storageKeyRefStatusRefusal("tnt_a", "lender:a", "REGULATED", {
        "tenant/tnt_a/vault/": "lender:b",
      }),
    ).toEqual({});
  });

  it("lists Enabled first among the KMS key states", () => {
    expect(STORAGE_KEY_STATES[0]).toBe("Enabled");
    expect(STORAGE_KEY_STATES).toContain("PendingDeletion");
  });
});
