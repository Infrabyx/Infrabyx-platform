// PR-UDF-058 (R1-D-227): the named tenant key reference a STORAGE write may carry.
import { describe, expect, it } from "vitest";
import { isValidStorageKeyRef, resolveStorageKeyRef } from "./storage.js";

const KEY = "tenant/tnt_a/vault/01JA0000000000000000000000.pdf";

describe("PR-UDF-058: storage key references", () => {
  it("accepts a name and refuses anything shaped like a key id", () => {
    for (const ok of ["lender:lnd_01ja0000", "udf.vault", "abc", "a".repeat(64)])
      expect(isValidStorageKeyRef(ok)).toBe(true);
    for (const bad of [
      "ab",
      "a".repeat(65),
      "Lender:x",
      "-lender",
      "alias/lender",
      "arn:aws:kms:ap-south-1:111122223333:key",
      "mrk-1234abcd12ab34cd56ef1234567890ab",
      "1234abcd-12ab-34cd-56ef-1234567890ab",
      "lender x",
    ])
      expect(isValidStorageKeyRef(bad)).toBe(false);
  });

  it("uses the named reference, else the longest matching prefix's, only in CONFIDENTIAL or REGULATED", () => {
    const prefixes = {
      "tenant/tnt_a/vault/": "lender:one",
      "tenant/tnt_a/vault/01JA": "lender:two",
      "tenant/tnt_a/other/": "lender:three",
    };
    expect(resolveStorageKeyRef(KEY, { bucketClass: "REGULATED" })).toEqual({});
    expect(resolveStorageKeyRef(KEY, { bucketClass: "REGULATED", keyRef: "lender:one" })).toEqual({
      keyRef: "lender:one",
    });
    expect(resolveStorageKeyRef(KEY, { bucketClass: "CONFIDENTIAL" }, prefixes)).toEqual({
      keyRef: "lender:two",
    });
    expect(
      resolveStorageKeyRef(KEY, { bucketClass: "CONFIDENTIAL", keyRef: "lender:two" }, prefixes),
    ).toEqual({ keyRef: "lender:two" });
    for (const bucketClass of ["GENERAL", "AUDIT", "PUBLIC_ASSETS"] as const)
      expect(resolveStorageKeyRef(KEY, { bucketClass, keyRef: "lender:one" })).toEqual({
        refusal: "key_ref_class",
      });
    // PR-UDF-066 (R1-D-240): a lender's upload is under its key from the first byte.
    expect(resolveStorageKeyRef(KEY, { bucketClass: "QUARANTINE", keyRef: "lender:one" })).toEqual({
      keyRef: "lender:one",
    });
    expect(resolveStorageKeyRef(KEY, { bucketClass: "QUARANTINE" }, prefixes)).toEqual({
      keyRef: "lender:two",
    });
    // A class without a reference is untouched even with a prefix map that does not match.
    expect(
      resolveStorageKeyRef(KEY, { bucketClass: "GENERAL" }, { "tenant/tnt_a/x/": "lender:x" }),
    ).toEqual({});
  });

  it("refuses a malformed reference, a conflict with the prefix and a prefix outside the tenant", () => {
    expect(
      resolveStorageKeyRef(KEY, { bucketClass: "REGULATED", keyRef: "arn:aws:kms:x" }),
    ).toEqual({ refusal: "key_ref_invalid" });
    expect(
      resolveStorageKeyRef(
        KEY,
        { bucketClass: "REGULATED", keyRef: "lender:other" },
        { "tenant/tnt_a/vault/": "lender:one" },
      ),
    ).toEqual({ refusal: "key_ref_prefix_conflict" });
    expect(
      resolveStorageKeyRef(
        KEY,
        { bucketClass: "REGULATED" },
        { "tenant/tnt_b/vault/": "lender:b" },
      ),
    ).toEqual({ refusal: "key_ref_prefix_invalid" });
    expect(
      resolveStorageKeyRef(KEY, { bucketClass: "REGULATED" }, { "tenant/tnt_a/vault/": "ARN" }),
    ).toEqual({ refusal: "key_ref_prefix_invalid" });
  });
});
