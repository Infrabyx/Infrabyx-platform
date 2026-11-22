// PR-UDF-058 (R1-D-227): writes under a named tenant key, unit level. The S3 client is replaced by
// an in-memory stand-in that records each write's bucket, key and metadata, and can be told to
// fail a call as S3 does when a KMS key is disabled or no longer granted; the moto leg
// (storage.contract.test.ts) runs the same writes end to end.
import { describe, expect, it } from "vitest";
import { ulid } from "@infrabyx/crypto";
import { MinioStorage, S3Storage, type S3StorageOptions } from "../s3.js";

const FAKE_KEY_ARN = "arn:aws:kms:ap-south-1:000000000000:key/00000000-0000-0000-0000-000000000000";
/** No ARN anywhere in the error, its meta or a cause (R1-D-276). */
const noArn = (e: unknown) => {
  expect((e as { cause?: unknown }).cause).toBeUndefined();
  expect(JSON.stringify({ ...(e as object), message: (e as Error).message })).not.toContain(
    "arn:aws:kms",
  );
};

interface Put {
  Bucket: string;
  Key: string;
  SSEKMSKeyId?: string;
  BucketKeyEnabled?: boolean;
  Metadata?: Record<string, string>;
}

const LENDERS: Record<string, string> = { "lender:a": "k-lender-a", "lender:b": "k-lender-b" };

function adapter(over: Partial<S3StorageOptions> = {}) {
  const store = new Map<
    string,
    { body: Uint8Array; meta: Record<string, string>; kms?: string | undefined }
  >();
  const puts: Put[] = [];
  let fail: { on: string; name: string } | undefined;
  const p = new S3Storage({
    region: "ap-south-1",
    buckets: { GENERAL: "b-general", CONFIDENTIAL: "b-conf", REGULATED: "b-reg" },
    kmsKeyIds: { GENERAL: "k-general", CONFIDENTIAL: "k-conf", REGULATED: "k-reg" },
    compartmentBuckets: { SEALED: { REGULATED: "b-reg-sealed" } },
    compartmentKmsKeyIds: { SEALED: { REGULATED: "k-reg-sealed" } },
    tenantNamedKmsKeyIds: (t, w) =>
      t !== "tnt_a"
        ? undefined
        : w.compartment
          ? { "lender:a": `k-lender-a-${w.bucketClass}.${w.compartment}` }
          : w.bucketClass === "CONFIDENTIAL" || w.bucketClass === "REGULATED"
            ? LENDERS
            : undefined,
    credentials: { accessKeyId: "test", secretAccessKey: "test" },
    ...over,
  });
  const err = (name: string, status: number) =>
    // The message quotes a (synthetic) key ARN, as a real KMS error can (R1-D-276).
    Object.assign(new Error(`${name}: ${FAKE_KEY_ARN}`), {
      name,
      $metadata: { httpStatusCode: status },
    });
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
      return { Metadata: o.meta, ...(o.kms ? { ServerSideEncryption: "aws:kms" } : {}) };
    }
    if (name === "PutObjectCommand") {
      puts.push(input as unknown as Put);
      store.set(id, {
        body: input.Body as Uint8Array,
        meta: (input.Metadata ?? {}) as Record<string, string>,
        kms: input.SSEKMSKeyId as string | undefined,
      });
      return {};
    }
    if (name === "GetObjectCommand") {
      if (!o) throw err("NoSuchKey", 404);
      return { Body: { transformToByteArray: async () => o.body }, Metadata: o.meta };
    }
    throw new Error(`unexpected ${name}`);
  };
  return { p, puts, failOn: (on: string, name: string) => (fail = { on, name }) };
}

const enc = (s: string) => new TextEncoder().encode(s);
const key = (t = "tnt_a", module = "vault") => `tenant/${t}/${module}/${ulid()}.pdf`;
const refused = (code: string, reason: string) => ({ code, meta: { reason } });

describe("PR-UDF-058: STORAGE writes under a named tenant key", () => {
  it("encrypts under the named key, records the reference (not the key id) and reads it back", async () => {
    const { p, puts } = adapter();
    const a = key();
    const b = key();
    const plain = key();
    await p.put(a, enc("a"), { bucketClass: "REGULATED", keyRef: "lender:a" });
    await p.putWithRetention(b, enc("b"), new Date(Date.now() + 86_400_000), {
      bucketClass: "CONFIDENTIAL",
      keyRef: "lender:b",
    });
    await p.put(plain, enc("c"), { bucketClass: "REGULATED" });
    await p.put(key(), enc("d"), {
      bucketClass: "REGULATED",
      compartment: "SEALED",
      keyRef: "lender:a",
    });
    expect(puts.map((x) => [x.Bucket, x.SSEKMSKeyId, x.Metadata?.["ipb-key-ref"]])).toEqual([
      ["b-reg", "k-lender-a", "lender:a"],
      ["b-conf", "k-lender-b", "lender:b"],
      ["b-reg", "k-reg", undefined],
      ["b-reg-sealed", "k-lender-a-REGULATED.SEALED", "lender:a"],
    ]);
    expect(JSON.stringify(puts.map((x) => x.Metadata))).not.toContain("k-lender");
    expect((await p.get(a)).meta).toMatchObject({ bucketClass: "REGULATED", keyRef: "lender:a" });
    expect((await p.get(a)).meta.tags).toBeUndefined();
    expect((await p.get(plain)).meta.keyRef).toBeUndefined();
  });

  it("a caller's tag cannot claim a reference", async () => {
    const { p, puts } = adapter();
    const k = key();
    await p.put(k, enc("x"), { bucketClass: "REGULATED", tags: { "ipb-key-ref": "lender:a" } });
    expect(puts[0]!.Metadata?.["ipb-key-ref"]).toBeUndefined();
    expect((await p.get(k)).meta.keyRef).toBeUndefined();
  });

  it("takes the longest prefix's reference and refuses a reference that conflicts with it", async () => {
    const { p, puts } = adapter({
      tenantKeyRefPrefixes: () => ({
        "tenant/tnt_a/vault/": "lender:a",
        "tenant/tnt_a/vaultb/": "lender:b",
      }),
    });
    await p.put(key("tnt_a", "vault"), enc("a"), { bucketClass: "REGULATED" });
    await p.put(key("tnt_a", "vaultb"), enc("b"), { bucketClass: "REGULATED" });
    await p.put(key("tnt_a", "other"), enc("c"), { bucketClass: "REGULATED" });
    expect(puts.map((x) => x.SSEKMSKeyId)).toEqual(["k-lender-a", "k-lender-b", "k-reg"]);
    await expect(
      p.put(key("tnt_a", "vault"), enc("x"), { bucketClass: "REGULATED", keyRef: "lender:b" }),
    ).rejects.toMatchObject(refused("IPB-PORT-003", "key_ref_prefix_conflict"));
    const outside = adapter({ tenantKeyRefPrefixes: () => ({ "tenant/tnt_b/": "lender:a" }) });
    await expect(
      outside.p.put(key(), enc("x"), { bucketClass: "REGULATED" }),
    ).rejects.toMatchObject(refused("IPB-PORT-001", "key_ref_prefix_invalid"));
  });

  it("refuses a malformed, unknown, misplaced or changed reference, never falling back", async () => {
    const { p, puts } = adapter();
    for (const bad of ["arn:aws:kms:ap-south-1:1:key/x", "1234abcd-12ab-34cd-56ef-1234567890ab"])
      await expect(
        p.put(key(), enc("x"), { bucketClass: "REGULATED", keyRef: bad }),
      ).rejects.toMatchObject(refused("IPB-PORT-003", "key_ref_invalid"));
    await expect(
      p.put(key(), enc("x"), { bucketClass: "REGULATED", keyRef: "lender:z" }),
    ).rejects.toMatchObject(refused("IPB-PORT-001", "key_ref_unknown"));
    // Another tenant's object never resolves tnt_a's references.
    await expect(
      p.put(key("tnt_b"), enc("x"), { bucketClass: "REGULATED", keyRef: "lender:a" }),
    ).rejects.toMatchObject(refused("IPB-PORT-001", "key_ref_unknown"));
    for (const bucketClass of ["GENERAL", "AUDIT"] as const)
      await expect(
        p.put(key(), enc("x"), { bucketClass, keyRef: "lender:a" }),
      ).rejects.toMatchObject(refused("IPB-PORT-003", "key_ref_class"));
    expect(puts).toEqual([]);
    const k = key();
    await p.put(k, enc("a"), { bucketClass: "REGULATED", keyRef: "lender:a" });
    for (const meta of [
      { bucketClass: "REGULATED" as const, keyRef: "lender:b" },
      { bucketClass: "REGULATED" as const },
    ])
      await expect(p.put(k, enc("b"), meta)).rejects.toMatchObject(
        refused("IPB-PORT-003", "key_ref_changed"),
      );
    await expect(
      p.presign(k, "put", 60, { bucketClass: "REGULATED", contentType: "application/pdf" }),
    ).rejects.toMatchObject(refused("IPB-PORT-003", "key_ref_changed"));
    await p.put(k, enc("c"), { bucketClass: "REGULATED", keyRef: "lender:a" });
  });

  it("refuses a named key shared with a platform key, another reference or another compartment", async () => {
    const write = (over: Partial<S3StorageOptions>, compartment?: "SEALED") =>
      adapter(over).p.put(key(), enc("x"), {
        bucketClass: "REGULATED",
        keyRef: "lender:a",
        ...(compartment ? { compartment } : {}),
      });
    const shared = refused("IPB-PORT-001", "key_ref_shared");
    const named = (m: Record<string, Record<string, string>>): Partial<S3StorageOptions> => ({
      tenantNamedKmsKeyIds: (_t, w) =>
        m[w.compartment ? `${w.bucketClass}.${w.compartment}` : w.bucketClass],
    });
    await expect(write(named({ REGULATED: { "lender:a": "k-reg" } }))).rejects.toMatchObject(
      shared,
    );
    await expect(write(named({ REGULATED: { "lender:a": "k-reg-sealed" } }))).rejects.toMatchObject(
      shared,
    );
    await expect(
      write(named({ REGULATED: { "lender:a": "k-x", "lender:b": "k-x" } })),
    ).rejects.toMatchObject(shared);
    await expect(
      write(named({ REGULATED: { "lender:a": "k-x" }, CONFIDENTIAL: { "lender:b": "k-x" } })),
    ).rejects.toMatchObject(shared);
    await expect(
      write(
        named({ REGULATED: { "lender:a": "k-x" }, "REGULATED.SEALED": { "lender:a": "k-x" } }),
        "SEALED",
      ),
    ).rejects.toMatchObject(shared);
    await expect(
      write(named({ REGULATED: { "lender:a": "k-x" }, "REGULATED.SEALED": { "lender:a": "k-x" } })),
    ).rejects.toMatchObject(shared);
    // One reference may keep one key across CONFIDENTIAL and REGULATED, as a tenant CMK does.
    await write(named({ REGULATED: { "lender:a": "k-x" }, CONFIDENTIAL: { "lender:a": "k-x" } }));
  });

  it("a tenant with its own CMK keeps it on every object (C-17): a named key is refused", async () => {
    const { p } = adapter({ tenantKmsKeyId: (t) => (t === "tnt_a" ? "t-cmk" : undefined) });
    await expect(
      p.put(key(), enc("x"), { bucketClass: "REGULATED", keyRef: "lender:a" }),
    ).rejects.toMatchObject(refused("IPB-PORT-003", "key_ref_tenant_cmk"));
  });

  it("a disabled or revoked key reads as IPB-KMS-001 storage_key_unavailable, not a generic failure", async () => {
    const { p, failOn } = adapter();
    const k = key();
    await p.put(k, enc("a"), { bucketClass: "REGULATED", keyRef: "lender:a" });
    for (const name of ["KMS.DisabledException", "KMS.KMSInvalidStateException", "AccessDenied"]) {
      failOn("GetObjectCommand", name);
      const e = await p.get(k).catch((x: unknown) => x);
      expect(e).toMatchObject({
        code: "IPB-KMS-001",
        meta: { reason: "storage_key_unavailable", keyRef: "lender:a" },
      });
      noArn(e);
    }
    failOn("PutObjectCommand", "KMS.NotFoundException");
    await expect(
      p.put(key(), enc("b"), { bucketClass: "REGULATED", keyRef: "lender:b" }),
    ).rejects.toMatchObject({ code: "IPB-KMS-001", meta: { reason: "storage_key_unavailable" } });
    failOn("PutObjectCommand", "AccessDenied");
    await expect(
      p.put(key(), enc("b"), { bucketClass: "REGULATED", keyRef: "lender:b" }),
    ).rejects.toMatchObject({ code: "IPB-KMS-001" });
    // Under a platform key, failures are as before (the router may fail reads over to the DR copy).
    await expect(p.put(key(), enc("b"), { bucketClass: "REGULATED" })).rejects.toMatchObject({
      code: "IPB-STOR-002",
    });
  });

  it("a transient KMS error, or any failure on a platform-key object, keeps its old code", async () => {
    const { p, failOn } = adapter();
    const named = key();
    const plain = key();
    await p.put(named, enc("a"), { bucketClass: "REGULATED", keyRef: "lender:a" });
    await p.put(plain, enc("b"), { bucketClass: "REGULATED" });
    failOn("GetObjectCommand", "KMS.ThrottlingException");
    const e = await p.get(named).catch((x: unknown) => x);
    expect(e).toMatchObject({ code: "IPB-PORT-002" });
    noArn(e);
    for (const name of ["AccessDenied", "KMS.DisabledException"]) {
      failOn("GetObjectCommand", name);
      await expect(p.get(plain)).rejects.toMatchObject({ code: "IPB-PORT-002" });
    }
  });

  it("an upload URL under a named key signs that key's header and carries the reference", async () => {
    const { p } = adapter({ endpoint: "http://127.0.0.1:9", forcePathStyle: true });
    const url = new URL(
      await p.presign(key(), "put", 60, {
        bucketClass: "REGULATED",
        contentType: "application/pdf",
        keyRef: "lender:a",
      }),
    );
    expect(url.searchParams.get("X-Amz-SignedHeaders")?.split(";")).toEqual(
      expect.arrayContaining(["content-type", "x-amz-server-side-encryption-aws-kms-key-id"]),
    );
    expect(url.searchParams.get("x-amz-meta-ipb-key-ref")).toBe("lender:a");
    expect(url.toString()).not.toContain("k-lender-a");
  });

  it("R1-D-229: a named key may turn S3 Bucket Keys off for its objects; on stays the default", async () => {
    const keys = {
      "lender:a": "k-lender-a",
      "lender:b": { keyId: "k-lender-b", bucketKey: false },
      "lender:c": { keyId: "k-lender-c" },
      "lender:d": { keyId: "k-lender-d", bucketKey: true },
    };
    const { p, puts } = adapter({
      tenantNamedKmsKeyIds: (t, w) => (t === "tnt_a" && !w.compartment ? keys : undefined),
    });
    for (const ref of Object.keys(keys))
      await p.put(key(), enc(ref), { bucketClass: "REGULATED", keyRef: ref });
    await p.put(key(), enc("plain"), { bucketClass: "REGULATED" });
    expect(puts.map((x) => [x.SSEKMSKeyId, x.BucketKeyEnabled])).toEqual([
      ["k-lender-a", true],
      ["k-lender-b", false],
      ["k-lender-c", true],
      ["k-lender-d", true],
      ["k-reg", true],
    ]);
    // An upload URL signs the switch: off for lender:b, on (as before) for lender:a.
    const presigned = async (keyRef: string) =>
      new URL(
        await adapter({
          endpoint: "http://127.0.0.1:9",
          forcePathStyle: true,
          tenantNamedKmsKeyIds: (t, w) => (t === "tnt_a" && !w.compartment ? keys : undefined),
        }).p.presign(key(), "put", 60, {
          bucketClass: "REGULATED",
          contentType: "application/pdf",
          keyRef,
        }),
      );
    const off = await presigned("lender:b");
    const on = await presigned("lender:a");
    const BK = "x-amz-server-side-encryption-bucket-key-enabled";
    expect(off.searchParams.get("X-Amz-SignedHeaders")?.split(";")).toContain(BK);
    expect(on.searchParams.get("X-Amz-SignedHeaders")?.split(";")).toContain(BK);
    expect(off.searchParams.get(BK)).toBeNull();
    expect(off.toString()).not.toContain("k-lender-b");
    // The object form is subject to the same separation: its key id shared with another is refused.
    await expect(
      adapter({
        tenantNamedKmsKeyIds: (_t, w) =>
          w.compartment
            ? undefined
            : { "lender:a": "k-x", "lender:b": { keyId: "k-x", bucketKey: false } },
      }).p.put(key(), enc("x"), { bucketClass: "REGULATED", keyRef: "lender:a" }),
    ).rejects.toMatchObject(refused("IPB-PORT-001", "key_ref_shared"));
    await expect(
      adapter({
        tenantNamedKmsKeyIds: () => ({ "lender:a": { keyId: "", bucketKey: false } }),
      }).p.put(key(), enc("x"), { bucketClass: "REGULATED", keyRef: "lender:a" }),
    ).rejects.toMatchObject(refused("IPB-PORT-001", "key_ref_unknown"));
  });

  it("minio refuses a named key as unsupported and says so in its descriptor", async () => {
    const m = new MinioStorage({
      region: "us-east-1",
      buckets: { REGULATED: "b-reg" },
      endpoint: "http://127.0.0.1:9",
      credentials: { accessKeyId: "test", secretAccessKey: "test" },
      allowLoopbackHttp: true,
    });
    expect(m.descriptor.capabilities?.["put.keyRef"]).toBe("unsupported");
    await expect(
      m.put(key(), enc("x"), { bucketClass: "REGULATED", keyRef: "lender:a" }),
    ).rejects.toMatchObject({ code: "IPB-PORT-001", meta: { reason: "unsupported" } });
    await expect(
      m.presign(key(), "put", 60, {
        bucketClass: "REGULATED",
        contentType: "application/pdf",
        keyRef: "lender:a",
      }),
    ).rejects.toMatchObject({ code: "IPB-PORT-001", meta: { reason: "unsupported" } });
  });
});
