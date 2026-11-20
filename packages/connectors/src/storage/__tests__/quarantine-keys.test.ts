// PR-UDF-066 (R1-D-240): named tenant keys in QUARANTINE and the promotion out of it, unit level.
// The S3 client is an in-memory stand-in that records each write's bucket and KMS key; the moto
// leg (storage.contract.test.ts) runs the upload and the promotion end to end.
import { describe, expect, it } from "vitest";
import { promotedObjectMeta } from "@infrabyx/contracts/ports";
import { ulid } from "@infrabyx/crypto";
import { S3Storage, type S3StorageOptions } from "../s3.js";

interface Put {
  Bucket: string;
  Key: string;
  SSEKMSKeyId?: string;
  Metadata?: Record<string, string>;
}

/** Lender a has a key per location (the clean copy is re-encrypted under its REGULATED key). */
const NAMED: Record<string, Record<string, string>> = {
  QUARANTINE: { "lender:a": "k-lender-a-quarantine", "lender:b": "k-lender-b" },
  REGULATED: { "lender:a": "k-lender-a-regulated", "lender:b": "k-lender-b" },
};

function adapter(over: Partial<S3StorageOptions> = {}) {
  const store = new Map<string, { body: Uint8Array; meta: Record<string, string> }>();
  const puts: Put[] = [];
  let fail: { on: string; name: string } | undefined;
  const p = new S3Storage({
    region: "ap-south-1",
    buckets: {
      GENERAL: "b-general",
      CONFIDENTIAL: "b-conf",
      REGULATED: "b-reg",
      QUARANTINE: "b-quarantine",
      AUDIT: "b-audit",
    },
    kmsKeyIds: {
      GENERAL: "k-general",
      CONFIDENTIAL: "k-conf",
      REGULATED: "k-reg",
      QUARANTINE: "k-quarantine",
      AUDIT: "k-audit",
    },
    tenantNamedKmsKeyIds: (t, w) =>
      t === "tnt_a" && !w.compartment ? NAMED[w.bucketClass] : undefined,
    tenantKeyRefPrefixes: (t) =>
      t === "tnt_a" ? { "tenant/tnt_a/lender_b/": "lender:b" } : undefined,
    credentials: { accessKeyId: "test", secretAccessKey: "test" },
    ...over,
  });
  const err = (name: string, status: number) =>
    Object.assign(new Error(name), { name, $metadata: { httpStatusCode: status } });
  (p as unknown as { client: { send: (c: unknown) => Promise<unknown> } }).client.send = async (
    cmd: unknown,
  ) => {
    const name = (cmd as { constructor: { name: string } }).constructor.name;
    const input = (cmd as { input: Record<string, unknown> }).input;
    const id = `${String(input.Bucket)}/${String(input.Key)}`;
    if (fail?.on === name) throw err(fail.name, fail.name === "AccessDenied" ? 403 : 400);
    const o = store.get(id);
    if (name === "HeadObjectCommand") {
      if (!o) throw err("NotFound", 404);
      return { Metadata: o.meta };
    }
    if (name === "PutObjectCommand") {
      puts.push(input as unknown as Put);
      store.set(id, {
        body: input.Body as Uint8Array,
        meta: (input.Metadata ?? {}) as Record<string, string>,
      });
      return {};
    }
    if (name === "GetObjectCommand") {
      if (!o) throw err("NoSuchKey", 404);
      return { Body: { transformToByteArray: async () => o.body }, Metadata: o.meta };
    }
    throw new Error(`unexpected ${name}`);
  };
  return { p, puts, failOn: (on: string, n: string) => (fail = { on, name: n }) };
}

const enc = (s: string) => new TextEncoder().encode(s);
const key = (module = "inbox") => `tenant/tnt_a/${module}/${ulid()}.pdf`;
const refused = (code: string, reason: string) => ({ code, meta: { reason } });

describe("PR-UDF-066: named tenant keys in QUARANTINE", () => {
  it("an upload is under the lender's key, and its promotion under that reference's clean key", async () => {
    const { p, puts } = adapter();
    const q = key();
    await p.put(q, enc("upload"), { bucketClass: "QUARANTINE", keyRef: "lender:a" });
    const scanned = await p.get(q);
    expect(scanned.meta).toMatchObject({ bucketClass: "QUARANTINE", keyRef: "lender:a" });
    const clean = key("vault");
    await p.put(
      clean,
      scanned.body,
      promotedObjectMeta(scanned.meta, { bucketClass: "REGULATED" }),
    );
    expect(puts.map((x) => [x.Bucket, x.SSEKMSKeyId, x.Metadata?.["ipb-key-ref"]])).toEqual([
      ["b-quarantine", "k-lender-a-quarantine", "lender:a"],
      ["b-reg", "k-lender-a-regulated", "lender:a"],
    ]);
    expect(await p.keyRefStatus("tnt_a", "lender:a", { bucketClass: "QUARANTINE" })).toEqual({
      status: "resolves",
    });
  });

  it("with a prefix map, the upload and the promotion both take the lender's reference unasked", async () => {
    const { p, puts } = adapter();
    const q = key("lender_b");
    await p.put(q, enc("upload"), { bucketClass: "QUARANTINE" });
    await p.put(key("lender_b"), (await p.get(q)).body, { bucketClass: "REGULATED" });
    expect(puts.map((x) => [x.Bucket, x.SSEKMSKeyId])).toEqual([
      ["b-quarantine", "k-lender-b"],
      ["b-reg", "k-lender-b"],
    ]);
    // A put under the lender's prefix into a class without named keys is refused.
    await expect(
      p.put(key("lender_b"), enc("x"), { bucketClass: "GENERAL" }),
    ).rejects.toMatchObject(refused("IPB-PORT-003", "key_ref_class"));
  });

  it("a promotion never falls back to the clean class's key", async () => {
    const { p, puts } = adapter();
    const q = key();
    await p.put(q, enc("upload"), { bucketClass: "QUARANTINE", keyRef: "lender:a" });
    const scanned = await p.get(q);
    // CONFIDENTIAL has no key for lender:a; GENERAL and AUDIT take no named key.
    await expect(
      p.put(key(), scanned.body, promotedObjectMeta(scanned.meta, { bucketClass: "CONFIDENTIAL" })),
    ).rejects.toMatchObject(refused("IPB-PORT-001", "key_ref_unknown"));
    for (const bucketClass of ["GENERAL", "AUDIT"] as const)
      await expect(
        p.put(key(), scanned.body, promotedObjectMeta(scanned.meta, { bucketClass })),
      ).rejects.toMatchObject(refused("IPB-PORT-003", "key_ref_class"));
    expect(puts).toHaveLength(1);
  });

  it("a named key equal to the QUARANTINE class key is refused as shared", async () => {
    const { p } = adapter({
      tenantNamedKmsKeyIds: () => ({ "lender:a": "k-quarantine" }),
    });
    await expect(
      p.put(key(), enc("x"), { bucketClass: "QUARANTINE", keyRef: "lender:a" }),
    ).rejects.toMatchObject(refused("IPB-PORT-001", "key_ref_shared"));
    expect(await p.keyRefStatus("tnt_a", "lender:a", { bucketClass: "QUARANTINE" })).toEqual({
      status: "refused",
      reason: "key_ref_shared",
    });
  });

  it("a scanner read the lender's key no longer allows is IPB-KMS-001, not a generic failure", async () => {
    const { p, failOn } = adapter();
    const q = key();
    await p.put(q, enc("upload"), { bucketClass: "QUARANTINE", keyRef: "lender:a" });
    failOn("GetObjectCommand", "AccessDenied");
    await expect(p.get(q)).rejects.toMatchObject({
      code: "IPB-KMS-001",
      meta: { reason: "storage_key_unavailable", keyRef: "lender:a" },
    });
  });
});
