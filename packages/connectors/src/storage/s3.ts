// STORAGE reference `s3` and alternative `minio` (PL2 plan §6.7): one S3-API code base. One bucket
// per bucket class (`int.storage.bucket.<class>`), each with versioning and Object Lock. Retained
// objects are written in COMPLIANCE mode (PL1-D-06). S3 itself would accept a new version or a
// delete marker over a locked object, so the adapter refuses `put` and `delete` while a retention
// date is in the future (IPB-STOR-003) and `putWithRetention` is write-once (If-None-Match).
// Encryption (C-17): SSE-KMS with the class key (or the tenant's own CMK, C-15) and S3 Bucket
// Keys on `s3`; `minio` relies on the bucket's SSE-S3 auto-encryption. Presigned URLs (IPB-02-15) are SigV4, 1–300 s, bound to the
// method and, for uploads, to the content type. Writes fail fast with IPB-STOR-002; the router
// sends reads to the DR replica (`read_only_failover`). Keys outside the caller's tenant are
// refused (IPB-PORT-003).
import {
  CreateBucketCommand,
  GetBucketReplicationCommand,
  GetBucketVersioningCommand,
  GetObjectCommand,
  GetObjectLockConfigurationCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  DeleteObjectCommand,
  S3Client,
  type HeadObjectCommandOutput,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { IpbError, PortError } from "@infrabyx/contracts/errors";
import {
  BUCKET_CLASSES,
  isValidStorageKey,
  type AdapterDescriptor,
  type BucketClass,
  type ObjectMeta,
  type PortHealth,
  type PresignOptions,
  type StoragePort,
  type StoredObject,
} from "@infrabyx/contracts/ports";
import { sha256Hex, toBase64Url } from "@infrabyx/crypto";
import { createEgress } from "../core/http.js";

/** Longest presigned URL (IPB-02-15). */
export const MAX_PRESIGN_TTL_SECONDS = 300;
const S3_REGIONS = ["ap-south-1", "ap-south-2"] as const;

export interface S3StorageOptions {
  /** Bucket per class (`int.storage.bucket.<class>`); classes without a bucket are refused. */
  buckets: Partial<Record<BucketClass, string>>;
  region: string;
  /** KMS key per class for SSE-KMS (`STORAGE_KMS_KEY_REF`); `s3` requires one for every bucket. */
  kmsKeyIds?: Partial<Record<BucketClass, string>>;
  /** C-17 (PL2-C-04): a tenant with its own CMK (C-15) gets that key per object. */
  tenantKmsKeyId?: (tenantId: string) => string | undefined;
  /** Tenant of the current call (tenancy context); keys of other tenants are refused. */
  currentTenant?: () => string | undefined;
  /** `int.storage.presign_ttl_seconds` (≤ 300). */
  presignTtlSeconds?: number;
  /** Tests and MinIO only: endpoint, static credentials, path-style addressing. */
  endpoint?: string;
  credentials?: { accessKeyId: string; secretAccessKey: string };
  forcePathStyle?: boolean;
  now?: () => Date;
}

type S3Error = Error & { name: string; $metadata?: { httpStatusCode?: number } };
const statusOf = (e: unknown) => (e as S3Error).$metadata?.httpStatusCode;
const isNotFound = (e: unknown) =>
  ["NoSuchKey", "NotFound", "NoSuchVersion"].includes((e as S3Error).name) || statusOf(e) === 404;

export class S3Storage implements StoragePort {
  readonly descriptor: AdapterDescriptor;
  protected readonly client: S3Client;
  private readonly now: () => Date;
  /** key → bucket class, learnt from writes and lookups. */
  private readonly located = new Map<string, BucketClass>();

  constructor(
    protected readonly o: S3StorageOptions,
    adapter: "s3" | "minio" = "s3",
  ) {
    if (adapter === "s3" && !(S3_REGIONS as readonly string[]).includes(o.region))
      throw new PortError("IPB-PORT-003", "STORAGE", {
        adapter,
        detail: `region ${o.region} is outside India (ap-south-1, ap-south-2)`,
      });
    if (adapter === "s3")
      for (const c of Object.keys(o.buckets) as BucketClass[])
        if (!o.kmsKeyIds?.[c])
          throw new PortError("IPB-PORT-001", "STORAGE", {
            adapter,
            detail: `bucket class ${c} has no KMS key (C-17)`,
          });
    if ((o.presignTtlSeconds ?? MAX_PRESIGN_TTL_SECONDS) > MAX_PRESIGN_TTL_SECONDS)
      throw new RangeError("presigned URL TTL must be at most 300 s (IPB-02-15)");
    this.descriptor = {
      port: "STORAGE",
      adapter,
      residency: "IN",
      maxDataClass: "SECRET",
    };
    const cfg: S3ClientConfig = {
      region: o.region,
      ...(o.endpoint ? { endpoint: o.endpoint } : {}),
      ...(o.credentials ? { credentials: o.credentials } : {}),
      forcePathStyle: o.forcePathStyle ?? adapter === "minio",
      // Checksums on every write; SHA-256 is also kept in object metadata for replication proofs.
      requestChecksumCalculation: "WHEN_SUPPORTED",
    };
    this.client = new S3Client(cfg);
    this.now = o.now ?? (() => new Date());
  }

  private get adapter(): string {
    return this.descriptor.adapter;
  }

  // ---- helpers -----------------------------------------------------------------------------------

  private checkKey(key: string): void {
    if (!isValidStorageKey(key))
      throw new PortError("IPB-PORT-003", "STORAGE", {
        adapter: this.adapter,
        detail: "key does not follow tenant/<tenant>/<module>/<ulid> (IPB-01-27)",
      });
    const tenant = this.o.currentTenant?.();
    if (tenant !== undefined && !key.startsWith(`tenant/${tenant}/`))
      throw new PortError("IPB-PORT-003", "STORAGE", {
        adapter: this.adapter,
        detail: "key belongs to another tenant",
      });
  }

  protected bucket(c: BucketClass): string {
    const b = this.o.buckets[c];
    if (!b)
      throw new PortError("IPB-PORT-001", "STORAGE", {
        adapter: this.adapter,
        detail: `no bucket configured for class ${c}`,
      });
    return b;
  }

  protected classes(): BucketClass[] {
    return BUCKET_CLASSES.filter((c) => this.o.buckets[c]);
  }

  private notFound(key: string): never {
    throw new IpbError("IPB-STOR-001", { detail: "object not found", meta: { key } });
  }

  private unavailable(op: "read" | "write", e: unknown): never {
    if (e instanceof IpbError) throw e;
    throw new PortError(op === "write" ? "IPB-STOR-002" : "IPB-PORT-002", "STORAGE", {
      adapter: this.adapter,
      detail: `${this.adapter} ${op} failed`,
      meta: { status: statusOf(e), name: (e as S3Error).name },
      cause: e,
    });
  }

  /** The bucket class holding `key` (current version, not deleted), or undefined. */
  private async locate(
    key: string,
    op: "read" | "write" = "read",
  ): Promise<{ cls: BucketClass; head: HeadObjectCommandOutput } | undefined> {
    const known = this.located.get(key);
    const order = known ? [known, ...this.classes().filter((c) => c !== known)] : this.classes();
    for (const cls of order) {
      try {
        const head = await this.client.send(
          new HeadObjectCommand({ Bucket: this.bucket(cls), Key: key }),
        );
        this.located.set(key, cls);
        return { cls, head };
      } catch (e) {
        if (!isNotFound(e)) this.unavailable(op, e);
      }
    }
    this.located.delete(key);
    return undefined;
  }

  private retained(head: HeadObjectCommandOutput): Date | undefined {
    const until = head.ObjectLockRetainUntilDate;
    return until && until > this.now() ? until : undefined;
  }

  private refuseRetained(head: HeadObjectCommandOutput, what: string): void {
    if (this.retained(head))
      throw new IpbError("IPB-STOR-003", { detail: `object is under retention; ${what} refused` });
  }

  private sse(cls: BucketClass, key: string) {
    const tenant = /^tenant\/([^/]+)\//.exec(key)?.[1];
    const kms = (tenant && this.o.tenantKmsKeyId?.(tenant)) || this.o.kmsKeyIds?.[cls];
    return kms
      ? { ServerSideEncryption: "aws:kms" as const, SSEKMSKeyId: kms, BucketKeyEnabled: true }
      : {};
  }

  private metadata(body: Uint8Array, meta: ObjectMeta): Record<string, string> {
    return { sha256: meta.sha256 ?? sha256Hex(body), ...(meta.tags ?? {}) };
  }

  // ---- port --------------------------------------------------------------------------------------

  async put(key: string, body: Uint8Array, meta: ObjectMeta): Promise<void> {
    this.checkKey(key);
    const found = await this.locate(key, "write");
    if (found) {
      this.refuseRetained(found.head, "overwrite");
      if (found.cls !== meta.bucketClass)
        throw new PortError("IPB-PORT-003", "STORAGE", {
          adapter: this.adapter,
          detail: "the object exists in another bucket class",
        });
    }
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket(meta.bucketClass),
          Key: key,
          Body: body,
          ...(meta.contentType ? { ContentType: meta.contentType } : {}),
          Metadata: this.metadata(body, meta),
          ChecksumAlgorithm: "SHA256",
          ...this.sse(meta.bucketClass, key),
        }),
      );
      this.located.set(key, meta.bucketClass);
    } catch (e) {
      this.unavailable("write", e);
    }
  }

  async putWithRetention(
    key: string,
    body: Uint8Array,
    retainUntil: Date,
    meta: ObjectMeta,
  ): Promise<void> {
    this.checkKey(key);
    if (!(retainUntil > this.now())) throw new RangeError("retainUntil must be in the future");
    if (await this.locate(key, "write"))
      throw new IpbError("IPB-STOR-003", { detail: "write-once object exists" });
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket(meta.bucketClass),
          Key: key,
          Body: body,
          IfNoneMatch: "*",
          ...(meta.contentType ? { ContentType: meta.contentType } : {}),
          Metadata: this.metadata(body, meta),
          ChecksumAlgorithm: "SHA256",
          ObjectLockMode: "COMPLIANCE",
          ObjectLockRetainUntilDate: retainUntil,
          ...this.sse(meta.bucketClass, key),
        }),
      );
      this.located.set(key, meta.bucketClass);
    } catch (e) {
      if (statusOf(e) === 412)
        throw new IpbError("IPB-STOR-003", { detail: "write-once object exists" });
      this.unavailable("write", e);
    }
  }

  async get(key: string): Promise<StoredObject> {
    this.checkKey(key);
    const found = await this.locate(key);
    if (!found) this.notFound(key);
    try {
      const r = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket(found!.cls), Key: key }),
      );
      const body = new Uint8Array(await r.Body!.transformToByteArray());
      const { sha256, ...tags } = r.Metadata ?? {};
      if (sha256 && sha256 !== sha256Hex(body))
        throw new PortError("IPB-PORT-002", "STORAGE", {
          adapter: this.adapter,
          detail: "object body does not match its stored SHA-256",
        });
      const until = r.ObjectLockRetainUntilDate;
      return {
        key,
        body,
        meta: {
          bucketClass: found!.cls,
          ...(r.ContentType ? { contentType: r.ContentType } : {}),
          sha256: sha256Hex(body),
          ...(Object.keys(tags).length ? { tags } : {}),
        },
        ...(until ? { retainUntil: until.toISOString() } : {}),
      };
    } catch (e) {
      if (isNotFound(e)) this.notFound(key);
      this.unavailable("read", e);
    }
  }

  async presign(
    key: string,
    op: "get" | "put",
    ttlSeconds: number,
    opts: PresignOptions = {},
  ): Promise<string> {
    this.checkKey(key);
    const max = this.o.presignTtlSeconds ?? MAX_PRESIGN_TTL_SECONDS;
    if (!(Number.isInteger(ttlSeconds) && ttlSeconds > 0 && ttlSeconds <= max))
      throw new RangeError(`presigned URL TTL must be 1–${max} s (IPB-02-15)`);
    if (op === "put") {
      if (!opts.bucketClass || !opts.contentType)
        throw new RangeError("an upload URL needs its bucket class and content type");
      const found = await this.locate(key);
      if (found) this.refuseRetained(found.head, "upload");
      return getSignedUrl(
        this.client,
        new PutObjectCommand({
          Bucket: this.bucket(opts.bucketClass),
          Key: key,
          ContentType: opts.contentType,
          ...this.sse(opts.bucketClass, key),
        }),
        { expiresIn: ttlSeconds, signableHeaders: new Set(["content-type"]) },
      );
    }
    const cls = opts.bucketClass ?? (await this.locate(key))?.cls;
    if (!cls) this.notFound(key);
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket(cls!), Key: key }),
      {
        expiresIn: ttlSeconds,
      },
    );
  }

  /** Soft delete: a delete marker over the versioned object; refused while retention applies. */
  async delete(key: string): Promise<void> {
    this.checkKey(key);
    const found = await this.locate(key, "write");
    if (!found) this.notFound(key);
    this.refuseRetained(found!.head, "delete");
    try {
      await this.client.send(
        new DeleteObjectCommand({ Bucket: this.bucket(found!.cls), Key: key }),
      );
      this.located.delete(key);
    } catch (e) {
      if (statusOf(e) === 403)
        throw new IpbError("IPB-STOR-003", { detail: "the store refused the delete" });
      this.unavailable("write", e);
    }
  }

  /** Keys under `prefix` across every bucket class; the cursor carries the class and token. */
  async list(prefix: string, cursor?: string): Promise<{ keys: string[]; cursor?: string }> {
    const tenant = this.o.currentTenant?.();
    if (
      tenant !== undefined &&
      prefix !== `tenant/${tenant}` &&
      !prefix.startsWith(`tenant/${tenant}/`)
    )
      throw new PortError("IPB-PORT-003", "STORAGE", {
        adapter: this.adapter,
        detail: "prefix outside the caller's tenant",
      });
    const classes = this.classes();
    let [ci, token] = cursor
      ? (JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as [
          number,
          string | undefined,
        ])
      : [0, undefined];
    while (ci < classes.length) {
      try {
        const r = await this.client.send(
          new ListObjectsV2Command({
            Bucket: this.bucket(classes[ci]!),
            Prefix: prefix,
            MaxKeys: 1000,
            ...(token ? { ContinuationToken: token } : {}),
          }),
        );
        const keys = (r.Contents ?? []).map((c) => c.Key!).filter(Boolean);
        const next: [number, string | undefined] = r.IsTruncated
          ? [ci, r.NextContinuationToken]
          : [ci + 1, undefined];
        const more = next[0] < classes.length;
        if (keys.length || !more)
          return {
            keys: keys.sort(),
            ...(more
              ? { cursor: toBase64Url(new TextEncoder().encode(JSON.stringify(next))) }
              : {}),
          };
        [ci, token] = next;
      } catch (e) {
        this.unavailable("read", e);
      }
    }
    return { keys: [] };
  }

  /** Proof of immutability: the current version is in COMPLIANCE mode with a future date. */
  async assertImmutable(key: string): Promise<void> {
    this.checkKey(key);
    const found = await this.locate(key);
    if (!found) this.notFound(key);
    if (found!.head.ObjectLockMode !== "COMPLIANCE" || !this.retained(found!.head))
      throw new IpbError("IPB-STOR-003", {
        detail: "object is not under compliance-mode retention",
      });
  }

  /**
   * Copy every object under `prefix` to `target`, keeping retention, then read each copy back
   * and compare SHA-256 (the manifest). `verified` counts copies whose hash matched.
   */
  async replicateTo(
    target: StoragePort,
    prefix: string,
  ): Promise<{ copied: number; verified: number }> {
    let copied = 0;
    let verified = 0;
    let cursor: string | undefined;
    do {
      const page = await this.list(prefix, cursor);
      for (const key of page.keys) {
        const o = await this.get(key);
        const sha = sha256Hex(o.body);
        const meta: ObjectMeta = { ...o.meta, sha256: sha };
        if (o.retainUntil && new Date(o.retainUntil) > this.now())
          await target.putWithRetention(key, o.body, new Date(o.retainUntil), meta);
        else await target.put(key, o.body, meta);
        copied++;
        if (sha256Hex((await target.get(key)).body) === sha) verified++;
      }
      cursor = page.cursor;
    } while (cursor);
    return { copied, verified };
  }

  /**
   * Every bucket exists, is versioned and has Object Lock enabled; `down` otherwise. The
   * replication target (`int.storage.replication.target`) is reported, not created (PL6).
   */
  async health(): Promise<PortHealth> {
    const t0 = Date.now();
    let status: PortHealth["status"] = "up";
    try {
      for (const c of this.classes()) {
        const Bucket = this.bucket(c);
        await this.client.send(new HeadBucketCommand({ Bucket }));
        const [v, lock] = await Promise.all([
          this.client.send(new GetBucketVersioningCommand({ Bucket })),
          this.client.send(new GetObjectLockConfigurationCommand({ Bucket })),
        ]);
        if (v.Status !== "Enabled" || lock.ObjectLockConfiguration?.ObjectLockEnabled !== "Enabled")
          status = "down";
      }
    } catch {
      status = "down";
    }
    return { status, latency_ms: Date.now() - t0, checked_at: new Date().toISOString() };
  }

  /** Replication rules per bucket, read only (PL2 plan §6.7: checked, not created). */
  async replicationStatus(): Promise<Partial<Record<BucketClass, string[]>>> {
    const out: Partial<Record<BucketClass, string[]>> = {};
    for (const c of this.classes()) {
      try {
        const r = await this.client.send(
          new GetBucketReplicationCommand({ Bucket: this.bucket(c) }),
        );
        out[c] = (r.ReplicationConfiguration?.Rules ?? [])
          .filter((x) => x.Status === "Enabled")
          .map((x) => x.Destination?.Bucket ?? "")
          .filter(Boolean);
      } catch (e) {
        if ((e as S3Error).name === "ReplicationConfigurationNotFoundError") out[c] = [];
        else this.unavailable("read", e);
      }
    }
    return out;
  }
}

/** MinIO: the same S3 code with path-style addressing and SSE-S3 bucket encryption (C-17). */
export class MinioStorage extends S3Storage {
  private readonly egress: ReturnType<typeof createEgress>;

  constructor(o: S3StorageOptions & { endpoint: string; allowLoopbackHttp?: boolean }) {
    super({ ...o, forcePathStyle: true }, "minio");
    this.egress = createEgress({
      port: "STORAGE",
      adapter: "minio",
      allow: [new URL(o.endpoint).hostname],
      retries: 0,
      timeoutMs: 5000,
      ...(o.allowLoopbackHttp ? { allowLoopbackHttp: true } : {}),
    });
  }

  /**
   * Local stacks only (`pnpm dev:up`): create every class bucket that is missing, with Object Lock
   * (versioning follows) as `health` requires. Deployed buckets come from the OpenTofu modules.
   */
  async ensureBuckets(): Promise<{ created: string[] }> {
    const created: string[] = [];
    for (const c of this.classes()) {
      const Bucket = this.bucket(c);
      try {
        await this.client.send(new HeadBucketCommand({ Bucket }));
        continue;
      } catch (e) {
        if (!isNotFound(e)) throw e;
      }
      await this.client.send(new CreateBucketCommand({ Bucket, ObjectLockEnabledForBucket: true }));
      created.push(Bucket);
    }
    return { created };
  }

  /** MinIO's own liveness probe, then the bucket checks. */
  override async health(): Promise<PortHealth> {
    const t0 = Date.now();
    try {
      const r = await this.egress(`${this.o.endpoint!.replace(/\/$/, "")}/minio/health/live`);
      if (r.status !== 200) throw new Error(String(r.status));
    } catch {
      return { status: "down", latency_ms: Date.now() - t0, checked_at: new Date().toISOString() };
    }
    return super.health();
  }
}
