// PR-UDF-066 (R1-D-240): named tenant keys in QUARANTINE, and the meta of a promotion out of it.
import { describe, expect, it } from "vitest";
import {
  NAMED_KEY_CLASSES,
  promotedObjectMeta,
  storageKeyRefStatusRefusal,
  type ObjectMeta,
} from "./storage.js";

describe("PR-UDF-066: named keys in QUARANTINE", () => {
  it("allows QUARANTINE, CONFIDENTIAL and REGULATED only", () => {
    expect([...NAMED_KEY_CLASSES].sort()).toEqual(["CONFIDENTIAL", "QUARANTINE", "REGULATED"]);
    expect(storageKeyRefStatusRefusal("tnt_a", "lender:a", "QUARANTINE")).toEqual({});
    for (const cls of ["AUDIT", "GENERAL", "PUBLIC_ASSETS"] as const)
      expect(storageKeyRefStatusRefusal("tnt_a", "lender:a", cls)).toEqual({
        refusal: "key_ref_class",
      });
  });

  it("a promotion keeps the named key reference, the content type, the hash and the tags", () => {
    const from: ObjectMeta = {
      bucketClass: "QUARANTINE",
      contentType: "application/pdf",
      keyRef: "lender:a",
      sha256: "a".repeat(64),
      tags: { kind: "kyc" },
    };
    expect(promotedObjectMeta(from, { bucketClass: "REGULATED" })).toEqual({
      bucketClass: "REGULATED",
      contentType: "application/pdf",
      keyRef: "lender:a",
      sha256: "a".repeat(64),
      tags: { kind: "kyc" },
    });
    expect(
      promotedObjectMeta(from, { bucketClass: "CONFIDENTIAL", compartment: "SEALED" }),
    ).toMatchObject({ bucketClass: "CONFIDENTIAL", compartment: "SEALED", keyRef: "lender:a" });
    // Into a class without named keys the reference still travels, so the write is refused
    // (`key_ref_class`) rather than landing under the class key.
    expect(promotedObjectMeta(from, { bucketClass: "GENERAL" }).keyRef).toBe("lender:a");
    // An object under a platform key is promoted under the clean location's own key.
    expect(promotedObjectMeta({ bucketClass: "QUARANTINE" }, { bucketClass: "REGULATED" })).toEqual(
      { bucketClass: "REGULATED" },
    );
    // The tags are copied, not shared.
    const out = promotedObjectMeta(from, { bucketClass: "REGULATED" });
    out.tags!.kind = "changed";
    expect(from.tags!.kind).toBe("kyc");
  });
});
