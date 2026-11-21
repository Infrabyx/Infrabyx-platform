// PR-UDF-076 (R1-D-261): the class list of `StoragePort.keyRefStatuses`, and its new label.
import { describe, expect, it } from "vitest";
import {
  BUCKET_CLASSES,
  MAX_KEY_REF_STATUS_CLASSES,
  STORAGE_KEY_NOT_DESCRIBED,
  STORAGE_KEY_UNAVAILABLE,
  keyRefStatusClasses,
  type StorageKeyRefClassStatus,
  type StorageKeyRefStatus,
} from "./storage.js";

describe("PR-UDF-076: keyRefStatuses' classes", () => {
  it("takes one to six distinct known classes", () => {
    expect(keyRefStatusClasses({ bucketClasses: ["REGULATED"] })).toEqual(["REGULATED"]);
    expect(keyRefStatusClasses({ bucketClasses: ["REGULATED", "QUARANTINE", "GENERAL"] })).toEqual([
      "REGULATED",
      "QUARANTINE",
      "GENERAL",
    ]);
    expect(keyRefStatusClasses({ bucketClasses: [...BUCKET_CLASSES] })).toHaveLength(
      MAX_KEY_REF_STATUS_CLASSES,
    );
    for (const bad of [
      [],
      ["REGULATED", "REGULATED"],
      ["REGULATED", "NOPE"],
      [1],
      [...BUCKET_CLASSES, "REGULATED"],
    ])
      expect(keyRefStatusClasses({ bucketClasses: bad })).toBeNull();
    expect(keyRefStatusClasses({})).toBeNull();
    expect(keyRefStatusClasses({ bucketClasses: "REGULATED" as unknown as string[] })).toBeNull();
  });

  it("refuses a compartment any class does not allow", () => {
    expect(
      keyRefStatusClasses({ bucketClasses: ["REGULATED", "CONFIDENTIAL"], compartment: "SEALED" }),
    ).toEqual(["REGULATED", "CONFIDENTIAL"]);
    expect(
      keyRefStatusClasses({ bucketClasses: ["REGULATED", "QUARANTINE"], compartment: "SEALED" }),
    ).toBeNull();
  });

  it("the not-described label is distinct and only in the per-class answer type", () => {
    expect(STORAGE_KEY_NOT_DESCRIBED).toBe("storage_key_not_described");
    expect(STORAGE_KEY_NOT_DESCRIBED).not.toBe(STORAGE_KEY_UNAVAILABLE);
    const perClass: StorageKeyRefClassStatus = {
      status: "refused",
      reason: STORAGE_KEY_NOT_DESCRIBED,
    };
    expect(perClass.status).toBe("refused");
    // keyRefStatus's answer type is unchanged: the new label does not type-check there.
    // @ts-expect-error storage_key_not_described is not a keyRefStatus reason
    const single: StorageKeyRefStatus = { status: "refused", reason: STORAGE_KEY_NOT_DESCRIBED };
    expect(single).toBeDefined();
  });
});
