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

  it("keyRefStatus (PR-UDF-068): the write's labels, the configured key state, and no write", async () => {
    const s = new MemoryStorage(undefined, {
      keyRefs: (t) => (t === "tnt_a" ? ["lender:a", "lender:b"] : undefined),
      keyRefPrefixes: (t) => (t === "tnt_c" ? { "tenant/tnt_x/vault/": "lender:a" } : undefined),
      keyStates: (_t, ref) => (ref === "lender:b" ? "PendingDeletion" : undefined),
    });
    const reg = { bucketClass: "REGULATED" } as const;
    expect(await s.keyRefStatus("tnt_a", "lender:a", reg)).toEqual({ status: "resolves" });
    expect(await s.keyRefStatus("tnt_a", "lender:a", { ...reg, describeKey: true })).toEqual({
      status: "resolves",
      keyState: "Enabled",
    });
    expect(await s.keyRefStatus("tnt_a", "lender:b", { ...reg, describeKey: true })).toEqual({
      status: "refused",
      reason: "storage_key_unavailable",
      keyState: "PendingDeletion",
    });
    expect(await s.keyRefStatus("tnt_c", "lender:a", reg)).toEqual({
      status: "refused",
      reason: "key_ref_prefix_invalid",
    });
    await expect(
      s.keyRefStatus("tnt_a", "lender:a", {
        bucketClass: "GENERAL",
        compartment: "SEALED",
      }),
    ).rejects.toMatchObject({ code: "IPB-PORT-003" });
    expect(s.objects.size).toBe(0);
  });

  it("keyRefStatuses and keyStateError (PR-UDF-076): several classes, the not-described label, a failed read", async () => {
    const s = new MemoryStorage(undefined, {
      keyRefs: (t) => (t === "tnt_a" ? ["lender:a", "lender:hidden", "lender:flaky"] : undefined),
      keyStateError: (_t, ref) =>
        ref === "lender:hidden"
          ? "not_described"
          : ref === "lender:flaky"
            ? "unavailable"
            : undefined,
    });
    const both = {
      bucketClasses: ["REGULATED", "QUARANTINE", "AUDIT"],
      describeKey: true,
    } as const;
    expect(await s.keyRefStatuses("tnt_a", "lender:a", both)).toEqual({
      REGULATED: { status: "resolves", keyState: "Enabled" },
      QUARANTINE: { status: "resolves", keyState: "Enabled" },
      AUDIT: { status: "refused", reason: "key_ref_class" },
    });
    expect(await s.keyRefStatuses("tnt_a", "lender:hidden", both)).toEqual({
      REGULATED: { status: "refused", reason: "storage_key_not_described" },
      QUARANTINE: { status: "refused", reason: "storage_key_not_described" },
      AUDIT: { status: "refused", reason: "key_ref_class" },
    });
    // keyRefStatus keeps R1-D-239's label for a key it may not describe.
    const reg = { bucketClass: "REGULATED", describeKey: true } as const;
    expect(await s.keyRefStatus("tnt_a", "lender:hidden", reg)).toEqual({
      status: "refused",
      reason: "storage_key_unavailable",
    });
    for (const call of [
      s.keyRefStatus("tnt_a", "lender:flaky", reg),
      s.keyRefStatuses("tnt_a", "lender:flaky", both),
    ])
      await expect(call).rejects.toMatchObject({ code: "IPB-PORT-002" });
    // The injected error is only read with describeKey.
    expect(
      await s.keyRefStatuses("tnt_a", "lender:flaky", { bucketClasses: ["REGULATED"] }),
    ).toEqual({ REGULATED: { status: "resolves" } });
    await expect(
      s.keyRefStatuses("tnt_a", "lender:a", { bucketClasses: ["REGULATED", "REGULATED"] }),
    ).rejects.toMatchObject({ code: "IPB-PORT-003" });
    expect(s.objects.size).toBe(0);
  });
});
