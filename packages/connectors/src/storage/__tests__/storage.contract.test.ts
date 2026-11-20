// STORAGE contract legs (PL2 plan §6.7). Hermetic: moto 5.2.4 for the S3 API with versioning,
// Object Lock in COMPLIANCE mode and SSE-KMS (a moto KMS key). `s3` and `minio` run the same
// cases on separate bucket sets (@IPB-01-AT-10 parity, S3-API level). moto does not enforce
// presigned-URL expiry, method or content type, so those cases check what the adapter signs;
// enforcement is proven by the MinIO-server and AWS sandbox legs (OWNER-QUESTIONS #4, D-01).
import { CreateKeyCommand, KMSClient } from "@aws-sdk/client-kms";
import {
  CreateBucketCommand,
  PutBucketEncryptionCommand,
  ListObjectVersionsCommand,
  PutBucketVersioningCommand,
  S3Client,
  DeleteObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { BucketClass, StoragePort } from "@infrabyx/contracts/ports";
import { ulid } from "@infrabyx/crypto";
import {
  MemoryStorage,
  defineContractSuite,
  existingServiceUrl,
  startService,
  type StartedService,
} from "@infrabyx/testing";
import { MinioStorage, S3Storage } from "../s3.js";

const REGION = "ap-south-1";
const CREDS = { accessKeyId: "test", secretAccessKey: "test" };
const CLASSES: BucketClass[] = ["AUDIT", "REGULATED", "GENERAL"];
let moto: StartedService;
let endpoint = "";
let kmsKey = "";
const compartmentKeys: string[] = [];
// PR-UDF-058: two lenders' keys, the named keys of the built-in contract case's tenant.
const lenderKeys: string[] = [];
// Every bucket name carries this run's suffix, so a run never meets a bucket an earlier or a
// concurrent run created on the same server (a reused IPB_TEST_MINIO_URL or IPB_TEST_MOTO_URL, or a
// `pnpm check:full --logs DIR` run again). Their objects cannot be removed afterwards: the AUDIT
// cases lock them in COMPLIANCE mode for a day. The suffix is the random part of a ULID, lowercased
// (Crockford base32 has no I, L, O or U): names stay S3-valid, at most 30 characters here.
const RUN = ulid().slice(-10).toLowerCase();
const COMPARTMENT_BUCKETS = [`ipb-s3-conf-board-${RUN}`, `ipb-s3-reg-sealed-${RUN}`];
let tenant: string | undefined;

const raw = () =>
  new S3Client({ region: REGION, endpoint, forcePathStyle: true, credentials: CREDS });
const buckets = (set: string) =>
  Object.fromEntries(CLASSES.map((c) => [c, `ipb-${set}-${c.toLowerCase()}-${RUN}`])) as Record<
    BucketClass,
    string
  >;

beforeAll(async () => {
  moto = await startService("moto", { ports: [5000], readyLog: /Running on/ });
  endpoint = `http://${moto.host}:${moto.ports[5000]}`;
  const s3 = raw();
  for (const Bucket of [
    ...Object.values(buckets("s3")),
    ...Object.values(buckets("minio")),
    ...COMPARTMENT_BUCKETS,
  ]) {
    await s3.send(
      new CreateBucketCommand({
        Bucket,
        ObjectLockEnabledForBucket: true,
        CreateBucketConfiguration: { LocationConstraint: REGION },
      }),
    );
    await s3.send(
      new PutBucketVersioningCommand({ Bucket, VersioningConfiguration: { Status: "Enabled" } }),
    );
  }
  const kms = new KMSClient({ region: REGION, endpoint, credentials: CREDS });
  kmsKey = (await kms.send(new CreateKeyCommand({ Description: "ipb storage test" }))).KeyMetadata!
    .KeyId!;
  for (const d of ["board", "sealed"])
    compartmentKeys.push(
      (await kms.send(new CreateKeyCommand({ Description: `ipb storage ${d}` }))).KeyMetadata!
        .KeyId!,
    );
  for (const d of ["a", "b"])
    lenderKeys.push(
      (await kms.send(new CreateKeyCommand({ Description: `ipb storage lender ${d}` })))
        .KeyMetadata!.KeyId!,
    );
});
/** The named keys of tenant `tenantId` in REGULATED, as a product's vault would configure them. */
const lenderNamedKeys =
  (tenantId: string) => (t: string, w: { bucketClass: BucketClass; compartment?: string }) =>
    t === tenantId && w.bucketClass === "REGULATED" && !w.compartment
      ? { "lender:contract": lenderKeys[0]!, "lender:contract-b": lenderKeys[1]! }
      : undefined;
afterAll(async () => moto?.stop());

const s3Adapter = () =>
  new S3Storage({
    region: REGION,
    buckets: buckets("s3"),
    kmsKeyIds: Object.fromEntries(CLASSES.map((c) => [c, kmsKey])),
    tenantNamedKmsKeyIds: lenderNamedKeys("tnt_contract"),
    endpoint,
    credentials: CREDS,
    forcePathStyle: true,
    currentTenant: () => tenant,
  });
const minioAdapter = () =>
  new MinioStorage({
    region: REGION,
    buckets: buckets("minio"),
    endpoint,
    credentials: CREDS,
    currentTenant: () => tenant,
    allowLoopbackHttp: true,
  });

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);
const key = (t = "tnt_a", ext = "pdf") => `tenant/${t}/docs/${ulid()}.${ext}`;
const later = () => new Date(Date.now() + 86_400_000);

const cases = [
  {
    name: "put, get, list and overwrite keep body, content type, class and SHA-256",
    async run(p: StoragePort) {
      const k = key();
      await p.put(k, enc("one"), { bucketClass: "GENERAL", contentType: "application/pdf" });
      let o = await p.get(k);
      expect(dec(o.body)).toBe("one");
      expect(o.meta).toMatchObject({ bucketClass: "GENERAL", contentType: "application/pdf" });
      await p.put(k, enc("two"), { bucketClass: "GENERAL", contentType: "application/pdf" });
      o = await p.get(k);
      expect(dec(o.body)).toBe("two");
      expect(o.meta.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect((await p.list(k.slice(0, k.lastIndexOf("/")))).keys).toContain(k);
    },
  },
  {
    name: "@IPB-01-AT-09 retained objects are write-once: overwrite, delete and re-put give IPB-STOR-003",
    async run(p: StoragePort) {
      const k = key("tnt_a", "json");
      await p.putWithRetention(k, enc("{}"), later(), { bucketClass: "AUDIT" });
      await p.assertImmutable(k);
      await expect(p.delete(k)).rejects.toMatchObject({ code: "IPB-STOR-003" });
      await expect(p.put(k, enc("x"), { bucketClass: "AUDIT" })).rejects.toMatchObject({
        code: "IPB-STOR-003",
      });
      await expect(
        p.putWithRetention(k, enc("x"), later(), { bucketClass: "AUDIT" }),
      ).rejects.toMatchObject({ code: "IPB-STOR-003" });
      expect((await p.get(k)).retainUntil).toBeDefined();
    },
  },
  {
    name: "soft delete leaves a tombstone: the object is gone, its version is kept",
    async run(p: StoragePort) {
      const k = key();
      await p.put(k, enc("bye"), { bucketClass: "GENERAL" });
      await p.delete(k);
      await expect(p.get(k)).rejects.toMatchObject({ code: "IPB-STOR-001" });
      await expect(p.delete(k)).rejects.toMatchObject({ code: "IPB-STOR-001" });
    },
  },
  {
    name: "assertImmutable refuses an object without compliance retention",
    async run(p: StoragePort) {
      const k = key();
      await p.put(k, enc("plain"), { bucketClass: "REGULATED" });
      await expect(p.assertImmutable(k)).rejects.toMatchObject({ code: "IPB-STOR-003" });
    },
  },
  {
    name: "presign: TTL 1–300 s; upload URLs sign the content type; both bind the method (IPB-02-15)",
    async run(p: StoragePort) {
      const k = key();
      await p.put(k, enc("doc"), { bucketClass: "GENERAL", contentType: "application/pdf" });
      const get = new URL(await p.presign(k, "get", 300));
      expect(Number(get.searchParams.get("X-Amz-Expires"))).toBe(300);
      expect(get.searchParams.get("X-Amz-Algorithm")).toBe("AWS4-HMAC-SHA256");
      expect(await (await fetch(get)).text()).toBe("doc");
      const k2 = key();
      const put = new URL(
        await p.presign(k2, "put", 60, { bucketClass: "GENERAL", contentType: "application/pdf" }),
      );
      expect(put.searchParams.get("X-Amz-SignedHeaders")?.split(";")).toContain("content-type");
      expect(Number(put.searchParams.get("X-Amz-Expires"))).toBe(60);
      const up = await fetch(put, {
        method: "PUT",
        body: "uploaded",
        headers: { "content-type": "application/pdf" },
      });
      expect(up.status).toBe(200);
      expect(dec((await p.get(k2)).body)).toBe("uploaded");
      await expect(p.presign(k, "get", 301)).rejects.toThrow(/300/);
      await expect(p.presign(k, "get", 0)).rejects.toThrow();
      await expect(p.presign(key(), "put", 60)).rejects.toThrow(/content type/);
    },
  },
  {
    name: "cross-tenant keys and malformed keys are refused (IPB-PORT-003)",
    async run(p: StoragePort) {
      tenant = "tnt_a";
      try {
        await expect(
          p.put(key("tnt_b"), enc("x"), { bucketClass: "GENERAL" }),
        ).rejects.toMatchObject({ code: "IPB-PORT-003" });
        await expect(p.get(key("tnt_b"))).rejects.toMatchObject({ code: "IPB-PORT-003" });
        await expect(p.list("tenant/tnt_b/docs")).rejects.toMatchObject({ code: "IPB-PORT-003" });
        await expect(
          p.put("tenant/tnt_a/../x", enc("x"), { bucketClass: "GENERAL" }),
        ).rejects.toMatchObject({ code: "IPB-PORT-003" });
        const own = key("tnt_a");
        await p.put(own, enc("mine"), { bucketClass: "GENERAL" });
        expect(dec((await p.get(own)).body)).toBe("mine");
      } finally {
        tenant = undefined;
      }
    },
  },
  {
    name: "replicateTo copies with retention and verifies every copy by SHA-256",
    async run(p: StoragePort) {
      const prefix = `tenant/tnt_rep${Math.floor(Math.random() * 1e6)}/docs`;
      const k1 = `${prefix}/${ulid()}.pdf`;
      const k2 = `${prefix}/${ulid()}.json`;
      await p.put(k1, enc("a"), { bucketClass: "GENERAL" });
      await p.putWithRetention(k2, enc("b"), later(), { bucketClass: "AUDIT" });
      const target = new MemoryStorage();
      expect(await p.replicateTo(target, prefix)).toEqual({ copied: 2, verified: 2 });
      await target.assertImmutable(k2);
      expect(dec((await target.get(k1)).body)).toBe("a");
    },
  },
  {
    name: "health is up only when every bucket is versioned with Object Lock",
    async run(p: StoragePort) {
      expect((await p.health()).status).toBe("up");
    },
  },
];

describe("@IPB-01-15 STORAGE hermetic leg: s3 on moto 5.2.4", () => {
  defineContractSuite("STORAGE", s3Adapter, cases, { leg: "hermetic" });

  it("@IPB-02-AT-13 an AUDIT anchor survives a delete of its locked version", async () => {
    const p = s3Adapter();
    const k = `tenant/tnt_a/audit/${ulid()}.json`;
    await p.putWithRetention(k, enc('{"anchor":1}'), later(), { bucketClass: "AUDIT" });
    const s3 = raw();
    const Bucket = buckets("s3").AUDIT;
    const v = await s3.send(new ListObjectVersionsCommand({ Bucket, Prefix: k }));
    // A break-glass operator deleting the version itself: the store refuses (compliance mode).
    await expect(
      s3.send(new DeleteObjectCommand({ Bucket, Key: k, VersionId: v.Versions![0]!.VersionId })),
    ).rejects.toMatchObject({ name: "AccessDenied" });
    expect(dec((await p.get(k)).body)).toBe('{"anchor":1}');
  });

  it("C-17: a tenant with its own CMK gets that key on its objects; others get the class key", async () => {
    const kms = new KMSClient({ region: REGION, endpoint, credentials: CREDS });
    const tenantKey = (await kms.send(new CreateKeyCommand({ Description: "tenant cmk" })))
      .KeyMetadata!.KeyId!;
    const p = new S3Storage({
      region: REGION,
      buckets: buckets("s3"),
      kmsKeyIds: Object.fromEntries(CLASSES.map((c) => [c, kmsKey])),
      tenantKmsKeyId: (t) => (t === "tnt_cmk" ? tenantKey : undefined),
      endpoint,
      credentials: CREDS,
      forcePathStyle: true,
    });
    const own = key("tnt_cmk");
    const other = key("tnt_a");
    await p.put(own, enc("a"), { bucketClass: "GENERAL" });
    await p.put(other, enc("b"), { bucketClass: "GENERAL" });
    const s3 = raw();
    const head = (k: string) =>
      s3.send(new HeadObjectCommand({ Bucket: buckets("s3").GENERAL, Key: k }));
    expect((await head(own)).SSEKMSKeyId).toContain(tenantKey);
    expect((await head(other)).SSEKMSKeyId).toContain(kmsKey);
    expect((await head(own)).ServerSideEncryption).toBe("aws:kms");
  });

  it("PR-LDC-60: a compartment object is in its own bucket under its own key, never the class's", async () => {
    const p = new S3Storage({
      region: REGION,
      buckets: buckets("s3"),
      kmsKeyIds: Object.fromEntries(CLASSES.map((c) => [c, kmsKey])),
      compartmentBuckets: {
        BOARD_CONFIDENTIAL: { CONFIDENTIAL: COMPARTMENT_BUCKETS[0]! },
        SEALED: { REGULATED: COMPARTMENT_BUCKETS[1]! },
      },
      compartmentKmsKeyIds: {
        BOARD_CONFIDENTIAL: { CONFIDENTIAL: compartmentKeys[0]! },
        SEALED: { REGULATED: compartmentKeys[1]! },
      },
      endpoint,
      credentials: CREDS,
      forcePathStyle: true,
    });
    const board = key();
    const sealed = key("tnt_a", "json");
    const general = key();
    await p.put(board, enc("minutes"), {
      bucketClass: "CONFIDENTIAL",
      compartment: "BOARD_CONFIDENTIAL",
      contentType: "application/pdf",
    });
    await p.putWithRetention(sealed, enc("{}"), later(), {
      bucketClass: "REGULATED",
      compartment: "SEALED",
    });
    await p.put(general, enc("memo"), { bucketClass: "REGULATED" });
    const s3 = raw();
    const head = (Bucket: string, k: string) => s3.send(new HeadObjectCommand({ Bucket, Key: k }));
    expect((await head(COMPARTMENT_BUCKETS[0]!, board)).SSEKMSKeyId).toContain(compartmentKeys[0]);
    expect((await head(COMPARTMENT_BUCKETS[1]!, sealed)).SSEKMSKeyId).toContain(compartmentKeys[1]);
    expect((await head(buckets("s3").REGULATED, general)).SSEKMSKeyId).toContain(kmsKey);
    await expect(head(buckets("s3").REGULATED, sealed)).rejects.toBeDefined();
    expect((await p.get(board)).meta).toMatchObject({
      bucketClass: "CONFIDENTIAL",
      compartment: "BOARD_CONFIDENTIAL",
    });
    await p.assertImmutable(sealed);
    await expect(p.put(board, enc("x"), { bucketClass: "CONFIDENTIAL" })).rejects.toMatchObject({
      code: "IPB-PORT-003",
    });
    expect((await p.health()).status).toBe("up");
  });

  it("PR-UDF-058: each lender's files are under that lender's key; uploads sign it; reads are unchanged", async () => {
    const p = new S3Storage({
      region: REGION,
      buckets: buckets("s3"),
      kmsKeyIds: Object.fromEntries(CLASSES.map((c) => [c, kmsKey])),
      tenantNamedKmsKeyIds: lenderNamedKeys("tnt_vault"),
      tenantKeyRefPrefixes: (t) =>
        t === "tnt_vault" ? { "tenant/tnt_vault/lender_b/": "lender:contract-b" } : undefined,
      endpoint,
      credentials: CREDS,
      forcePathStyle: true,
    });
    const a = key("tnt_vault");
    const b = `tenant/tnt_vault/lender_b/${ulid()}.pdf`;
    const plain = key("tnt_vault");
    await p.put(a, enc("lender a"), { bucketClass: "REGULATED", keyRef: "lender:contract" });
    await p.putWithRetention(b, enc("lender b"), later(), { bucketClass: "REGULATED" });
    await p.put(plain, enc("ours"), { bucketClass: "REGULATED" });
    const s3 = raw();
    const head = (k: string) =>
      s3.send(new HeadObjectCommand({ Bucket: buckets("s3").REGULATED, Key: k }));
    expect((await head(a)).SSEKMSKeyId).toContain(lenderKeys[0]);
    expect((await head(a)).Metadata?.["ipb-key-ref"]).toBe("lender:contract");
    expect((await head(b)).SSEKMSKeyId).toContain(lenderKeys[1]);
    expect((await head(plain)).SSEKMSKeyId).toContain(kmsKey);
    expect((await p.get(a)).meta.keyRef).toBe("lender:contract");
    expect((await p.get(b)).meta.keyRef).toBe("lender:contract-b");
    await p.assertImmutable(b);
    // A presigned upload signs the lender's key header: sent with it, the object is under that key.
    const k = key("tnt_vault");
    const put = new URL(
      await p.presign(k, "put", 60, {
        bucketClass: "REGULATED",
        contentType: "application/pdf",
        keyRef: "lender:contract",
      }),
    );
    expect(put.searchParams.get("X-Amz-SignedHeaders")?.split(";")).toEqual(
      expect.arrayContaining(["content-type", "x-amz-server-side-encryption-aws-kms-key-id"]),
    );
    const up = await fetch(put, {
      method: "PUT",
      body: "uploaded",
      headers: {
        "content-type": "application/pdf",
        "x-amz-server-side-encryption": "aws:kms",
        "x-amz-server-side-encryption-aws-kms-key-id": lenderKeys[0]!,
        "x-amz-server-side-encryption-bucket-key-enabled": "true",
      },
    });
    expect(up.status).toBe(200);
    expect((await head(k)).SSEKMSKeyId).toContain(lenderKeys[0]);
    expect((await p.get(k)).meta.keyRef).toBe("lender:contract");
    // A presigned get needs nothing new: S3 decrypts with the object's own key.
    const get = await p.presign(k, "get", 60);
    expect(await (await fetch(get)).text()).toBe("uploaded");
    await expect(
      p.put(a, enc("x"), { bucketClass: "REGULATED", keyRef: "lender:contract-b" }),
    ).rejects.toMatchObject({ code: "IPB-PORT-003", meta: { reason: "key_ref_changed" } });
  });

  it("refuses regions outside India and buckets without a KMS key (C-17)", () => {
    expect(
      () =>
        new S3Storage({
          region: "us-east-1",
          buckets: { GENERAL: "b" },
          kmsKeyIds: { GENERAL: "k" },
        }),
    ).toThrow(expect.objectContaining({ code: "IPB-PORT-003" }));
    expect(() => new S3Storage({ region: REGION, buckets: { GENERAL: "b" } })).toThrow(
      expect.objectContaining({ code: "IPB-PORT-001" }),
    );
  });

  it("a write to an unreachable store fails fast with IPB-STOR-002", async () => {
    const down = new S3Storage({
      region: REGION,
      buckets: { GENERAL: "b" },
      kmsKeyIds: { GENERAL: "k" },
      endpoint: "http://127.0.0.1:9",
      credentials: CREDS,
      forcePathStyle: true,
    });
    await expect(down.put(key(), enc("x"), { bucketClass: "GENERAL" })).rejects.toMatchObject({
      code: "IPB-STOR-002",
    });
    expect((await down.health()).status).toBe("down");
  });
});

describe("@IPB-01-15 STORAGE hermetic leg: minio adapter on the S3 API (moto 5.2.4)", () => {
  defineContractSuite(
    "STORAGE",
    minioAdapter,
    cases.filter((c) => !c.name.startsWith("health")),
    {
      leg: "hermetic",
    },
  );
});

// MinIO server (PL2-D-61): CI builds MinIO's last community release from source and starts it
// (scripts/ci/minio-server.sh)
// and sets IPB_TEST_MINIO_URL; without it (a plain local run) this leg skips. It proves what moto cannot: presigned-URL expiry, method and content-type
// enforcement, and SSE-S3 bucket encryption (C-17).
const minioUrl = await existingServiceUrl("minio");
const MINIO_CREDS = { accessKeyId: "ipb-minio-test", secretAccessKey: "ipb-minio-test-secret" };
const minioBuckets = buckets("srv");

describe.skipIf(!minioUrl)(
  "@IPB-01-15 STORAGE hermetic leg: minio server RELEASE.2025-09-07T16-13-09Z",
  () => {
    const server = () =>
      new MinioStorage({
        region: "us-east-1",
        buckets: minioBuckets,
        endpoint: minioUrl!,
        credentials: MINIO_CREDS,
        currentTenant: () => tenant,
        allowLoopbackHttp: true,
      });

    beforeAll(async () => {
      const s3 = new S3Client({
        region: "us-east-1",
        endpoint: minioUrl!,
        forcePathStyle: true,
        credentials: MINIO_CREDS,
      });
      for (const Bucket of Object.values(minioBuckets)) {
        await s3.send(new CreateBucketCommand({ Bucket, ObjectLockEnabledForBucket: true }));
        await s3.send(
          new PutBucketEncryptionCommand({
            Bucket,
            ServerSideEncryptionConfiguration: {
              Rules: [{ ApplyServerSideEncryptionByDefault: { SSEAlgorithm: "AES256" } }],
            },
          }),
        );
      }
    });

    defineContractSuite("STORAGE", server, cases, { leg: "hermetic" });

    it("IPB-02-15: an expired, re-purposed or tampered presigned URL is refused", async () => {
      const p = server();
      const k = key();
      await p.put(k, enc("doc"), { bucketClass: "GENERAL", contentType: "application/pdf" });
      const short = await p.presign(k, "get", 1);
      await new Promise((r) => setTimeout(r, 2_500));
      expect((await fetch(short)).status).toBe(403);
      const get = await p.presign(k, "get", 60);
      expect((await fetch(get)).status).toBe(200);
      expect((await fetch(get, { method: "DELETE" })).status).toBe(403);
      expect((await fetch(get, { method: "PUT", body: "x" })).status).toBe(403);
      const sig = /X-Amz-Signature=([0-9a-f]+)/.exec(get)![1]!;
      const flipped = get.replace(sig, `${sig[0] === "0" ? "1" : "0"}${sig.slice(1)}`);
      expect((await fetch(flipped)).status).toBe(403);
      const k2 = key();
      const put = await p.presign(k2, "put", 60, {
        bucketClass: "GENERAL",
        contentType: "application/pdf",
      });
      const wrong = await fetch(put, {
        method: "PUT",
        body: "x",
        headers: { "content-type": "text/html" },
      });
      expect(wrong.status).toBe(403);
      const right = await fetch(put, {
        method: "PUT",
        body: "ok",
        headers: { "content-type": "application/pdf" },
      });
      expect(right.status).toBe(200);
      expect(dec((await p.get(k2)).body)).toBe("ok");
    });

    it("C-17: objects are encrypted at rest with SSE-S3; health uses MinIO's probe", async () => {
      const p = server();
      const k = key();
      await p.put(k, enc("secret"), { bucketClass: "REGULATED" });
      const head = await new S3Client({
        region: "us-east-1",
        endpoint: minioUrl!,
        forcePathStyle: true,
        credentials: MINIO_CREDS,
      }).send(new HeadObjectCommand({ Bucket: minioBuckets.REGULATED, Key: k }));
      expect(head.ServerSideEncryption).toBe("AES256");
      expect((await p.health()).status).toBe("up");
    });
  },
);
