// MemoryStorage records a named tenant key reference and refuses as `s3` does (PR-UDF-058, R1-D-227).
import { describe, expect, it } from "vitest";
import { MemoryStorage } from "./fakes.js";

const K = (n: string, module = "vault") =>
  `tenant/tnt_a/${module}/01JAZ0000000000000000000${n}.pdf`;
const enc = (s: string) => new TextEncoder().encode(s);

describe("MemoryStorage named keys (PR-UDF-058)", () => {
  it("knows no reference by default", async () => {
    await expect(
      new MemoryStorage().put(K("AA"), enc("x"), { bucketClass: "REGULATED", keyRef: "lender:a" }),
    ).rejects.toMatchObject({ code: "IPB-PORT-001", meta: { reason: "key_ref_unknown" } });
  });

  it("takes the longest prefix's reference, refuses a conflict and keeps it across overwrites", async () => {
    const s = new MemoryStorage(undefined, {
      keyRefs: (t) => (t === "tnt_a" ? ["lender:a", "lender:b"] : undefined),
      keyRefPrefixes: () => ({ "tenant/tnt_a/vault/": "lender:a" }),
    });
    await s.put(K("AA"), enc("a"), { bucketClass: "CONFIDENTIAL" });
    expect((await s.get(K("AA"))).meta.keyRef).toBe("lender:a");
    await expect(
      s.put(K("AB"), enc("b"), { bucketClass: "CONFIDENTIAL", keyRef: "lender:b" }),
    ).rejects.toMatchObject({ code: "IPB-PORT-003", meta: { reason: "key_ref_prefix_conflict" } });
    await s.put(K("AC", "other"), enc("c"), { bucketClass: "CONFIDENTIAL", keyRef: "lender:b" });
    await s.put(K("AD", "other"), enc("d"), { bucketClass: "CONFIDENTIAL" });
    expect((await s.get(K("AD", "other"))).meta.keyRef).toBeUndefined();
    await expect(
      s.put(K("AD", "other"), enc("e"), { bucketClass: "CONFIDENTIAL", keyRef: "lender:b" }),
    ).rejects.toMatchObject({ code: "IPB-PORT-003", meta: { reason: "key_ref_changed" } });
    // A vault prefix holds lender files only: a GENERAL put there is refused.
    await expect(s.put(K("AE"), enc("f"), { bucketClass: "GENERAL" })).rejects.toMatchObject({
      code: "IPB-PORT-003",
      meta: { reason: "key_ref_class" },
    });
    expect(
      await s.presign(K("AF"), "put", 60, {
        bucketClass: "REGULATED",
        contentType: "application/pdf",
      }),
    ).toContain("key_ref=lender%3Aa");
  });
});
