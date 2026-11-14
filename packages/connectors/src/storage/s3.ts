// STORAGE reference `s3` and alternative `minio` (PL2 plan §6.7): one S3-API code base. One bucket
// per bucket class (`int.storage.bucket.<class>`), each with versioning and Object Lock. Retained
// objects are written in COMPLIANCE mode (PL1-D-06). S3 itself would accept a new version or a
// delete marker over a locked object, so the adapter refuses `put` and `delete` while a retention
// date is in the future (IPB-STOR-003) and `putWithRetention` is write-once (If-None-Match).
// Encryption (C-17): SSE-KMS with the class key (or the tenant's own CMK, C-15) and S3 Bucket
// Keys on `s3`; `minio` relies on the bucket's SSE-S3 auto-encryption. Presigned URLs (IPB-02-15) are SigV4, 1–300 s, bound to the
// method and, for uploads, to the content type. Writes fail fast with IPB-STOR-002; the router
// sends reads to the DR replica (`read_only_failover`). Keys outside the caller's tenant are
// refused (IPB-PORT-003). Compartments (PR-LDC-60, R1-D-158): an object in a compartment of a
// class lives in that compartment's own bucket under its own key; a shared or missing bucket or
// key is refused at start or at write, never replaced by the class's.
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
  PutObjectRetentionCommand,
  DeleteObjectCommand,
  S3Client,
  type HeadObjectCommandOutput,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { IpbError, PortError } from "@infrabyx/contracts/errors";
import {
  BUCKET_CLASSES,
  STORAGE_COMPARTMENTS,
  compartmentAllowed,
  isValidStorageKey,
  type AdapterDescriptor,
  type BucketClass,
  type CompartmentClass,
  type ObjectMeta,
  type ObjectRetention,
  type PortHealth,
  type PresignOptions,
  type StoragePort,
  type StorageCompartment,
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
  /**
   * PR-LDC-60 (R1-D-158): a bucket per compartment and class
   * (`int.storage.bucket.<class>.<compartment>`), distinct from every other bucket. Writing to a
   * compartment without one is refused.
   */
  compartmentBuckets?: Partial<
    Record<StorageCompartment, Partial<Record<CompartmentClass, string>>>
  >;
  /**
   * SSE-KMS key per compartment and class, distinct from every class key and every other
   * compartment's key; `s3` requires one for every compartment bucket.
   */
  compartmentKmsKeyIds?: Partial<
    Record<StorageCompartment, Partial<Record<CompartmentClass, string>>>
  >;
  /**
   * C-17 (PL2-C-04): a tenant with its own CMK (C-15) gets that key per object. Called with the
   * object's location; for a compartment it must return the tenant's key for that compartment,
   * distinct from its other keys, or the write is refused (PR-LDC-60).
   */
  tenantKmsKeyId?: (
    tenantId: string,
    where?: { bucketClass: BucketClass; compartment?: StorageCompartment },
  ) => string | undefined;
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

/** Where an object lives: a bucket class, and optionally a compartment of it (PR-LDC-60). */
interface Slot {
  cls: BucketClass;
  compartment?: StorageCompartment;
}
const slotName = (s: Slot) => (s.compartment ? `${s.cls}.${s.compartment}` : s.cls);
const sameSlot = (a: Slot, b: Slot) => a.cls === b.cls && a.compartment === b.compartment;
const slotOf = (m: { bucketClass: BucketClass; compartment?: StorageCompartment }): Slot =>
  m.compartment ? { cls: m.bucketClass, compartment: m.compartment } : { cls: m.bucketClass };

export class S3Storage implements StoragePort {
  readonly descriptor: AdapterDescriptor;
  protected readonly client: S3Client;
  private readonly now: () => Date;
  /** key → location, learnt from writes and lookups. */
  private readonly located = new Map<string, Slot>();

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
    this.checkCompartments(o, adapter);
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

  private refuseConfig(adapter: string, detail: string): never {
    throw new PortError("IPB-PORT-001", "STORAGE", { adapter, detail });
  }

  /**
   * PR-LDC-60: every compartment bucket is allowed for its class and distinct from every other
   * bucket; on `s3` each has a KMS key; every compartment key is distinct from every class key and
   * every other compartment's key.
   */
  private checkCompartments(o: S3StorageOptions, adapter: string): void {
    const buckets = new Map<string, string>();
    for (const c of BUCKET_CLASSES) {
      const b = o.buckets[c];
      if (b) buckets.set(b, c);
    }
    const classKeys = new Set(Object.values(o.kmsKeyIds ?? {}).filter(Boolean));
    const compartmentKeys = new Map<string, string>();
    for (const comp of STORAGE_COMPARTMENTS)
      for (const [cls, b] of Object.entries(o.compartmentBuckets?.[comp] ?? {})) {
        const where = `${cls}.${comp}`;
        if (!b) continue;
        if (!compartmentAllowed(cls as BucketClass, comp))
          this.refuseConfig(adapter, `compartment ${comp} is not allowed in class ${cls}`);
        if (buckets.has(b))
          this.refuseConfig(adapter, `bucket of ${where} is also used by ${buckets.get(b)}`);
        buckets.set(b, where);
        const k = o.compartmentKmsKeyIds?.[comp]?.[cls as CompartmentClass];
        if (!k) {
          if (adapter === "s3") this.refuseConfig(adapter, `${where} has no KMS key (C-17)`);
          continue;
        }
        if (classKeys.has(k) || compartmentKeys.has(k))
          this.refuseConfig(
            adapter,
            `KMS key of ${where} is shared with ${compartmentKeys.get(k) ?? "a bucket class"}`,
          );
        compartmentKeys.set(k, where);
      }
  }

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

  protected bucket(c: BucketClass | Slot): string {
    const slot: Slot = typeof c === "string" ? { cls: c } : c;
    if (!compartmentAllowed(slot.cls, slot.compartment))
      throw new PortError("IPB-PORT-003", "STORAGE", {
        adapter: this.adapter,
        detail: `compartment ${slot.compartment} is not allowed in class ${slot.cls}`,
      });
    const b = slot.compartment
      ? this.o.compartmentBuckets?.[slot.compartment]?.[slot.cls as CompartmentClass]
      : this.o.buckets[slot.cls];
    if (!b)
      throw new PortError("IPB-PORT-001", "STORAGE", {
        adapter: this.adapter,
        detail: `no bucket configured for ${slotName(slot)}`,
      });
    return b;
  }

  protected classes(): BucketClass[] {
    return BUCKET_CLASSES.filter((c) => this.o.buckets[c]);
  }

  /** Every configured location: the class buckets, then the compartment buckets. */
  protected slots(): Slot[] {
    const out: Slot[] = this.classes().map((cls) => ({ cls }));
    for (const compartment of STORAGE_COMPARTMENTS)
      for (const cls of BUCKET_CLASSES)
        if (this.o.compartmentBuckets?.[compartment]?.[cls as CompartmentClass])
          out.push({ cls, compartment });
    return out;
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

  /** The location holding `key` (current version, not deleted), or undefined. */
  private async locate(
    key: string,
    op: "read" | "write" = "read",
  ): Promise<{ cls: Slot; head: HeadObjectCommandOutput } | undefined> {
    const known = this.located.get(key);
    const order = known
      ? [known, ...this.slots().filter((c) => !sameSlot(c, known))]
      : this.slots();
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

  private sse(slot: Slot, key: string) {
    const kms = this.keyFor(slot, key);
    return kms
      ? { ServerSideEncryption: "aws:kms" as const, SSEKMSKeyId: kms, BucketKeyEnabled: true }
      : {};
  }

  /**
   * The KMS key for a write. A class: the tenant's CMK, else the class key. A compartment
   * (PR-LDC-60): the tenant's key for that compartment when the tenant has its own CMK, else the
   * compartment key; a tenant compartment key that is missing or equal to any of the tenant's
   * other keys (or to a platform key) is refused, never replaced.
   */
  private keyFor(slot: Slot, key: string): string | undefined {
    const tenant = /^tenant\/([^/]+)\//.exec(key)?.[1];
    const tenantKey = (where: Slot) =>
      tenant
        ? this.o.tenantKmsKeyId?.(tenant, {
            bucketClass: where.cls,
            ...(where.compartment ? { compartment: where.compartment } : {}),
          })
        : undefined;
    if (!slot.compartment) return tenantKey(slot) || this.o.kmsKeyIds?.[slot.cls];
    const own = tenantKey(slot);
    const tenantHasCmk = BUCKET_CLASSES.some((c) => tenantKey({ cls: c }));
    if (!own) {
      if (tenantHasCmk)
        this.refuseConfig(
          this.adapter,
          `the tenant's own key has no key for ${slotName(slot)} (PR-LDC-60)`,
        );
      return this.o.compartmentKmsKeyIds?.[slot.compartment]?.[slot.cls as CompartmentClass];
    }
    const others = new Set<string | undefined>([
      ...BUCKET_CLASSES.map((c) => tenantKey({ cls: c })),
      ...BUCKET_CLASSES.map((c) => this.o.kmsKeyIds?.[c]),
      ...STORAGE_COMPARTMENTS.filter((c) => c !== slot.compartment).flatMap((c) =>
        BUCKET_CLASSES.map((cls) => tenantKey({ cls, compartment: c })),
      ),
      ...STORAGE_COMPARTMENTS.flatMap((c) => Object.values(this.o.compartmentKmsKeyIds?.[c] ?? {})),
    ]);
    if (others.has(own))
      this.refuseConfig(
        this.adapter,
        `the tenant's key for ${slotName(slot)} is shared with another of its keys (PR-LDC-60)`,
      );
    return own;
  }

  private metadata(body: Uint8Array, meta: ObjectMeta): Record<string, string> {
    return { sha256: meta.sha256 ?? sha256Hex(body), ...(meta.tags ?? {}) };
  }

  // ---- port --------------------------------------------------------------------------------------

  async put(key: string, body: Uint8Array, meta: ObjectMeta): Promise<void> {
    this.checkKey(key);
    const slot = slotOf(meta);
    const Bucket = this.bucket(slot);
    const sse = this.sse(slot, key);
    const found = await this.locate(key, "write");
    if (found) {
      this.refuseRetained(found.head, "overwrite");
      if (!sameSlot(found.cls, slot))
        throw new PortError("IPB-PORT-003", "STORAGE", {
          adapter: this.adapter,
          detail: "the object exists in another bucket class or compartment",
        });
    }
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket,
          Key: key,
          Body: body,
          ...(meta.contentType ? { ContentType: meta.contentType } : {}),
          Metadata: this.metadata(body, meta),
          ChecksumAlgorithm: "SHA256",
          ...sse,
        }),
      );
      this.located.set(key, slot);
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
    const slot = slotOf(meta);
    const Bucket = this.bucket(slot);
    const sse = this.sse(slot, key);
    if (await this.locate(key, "write"))
      throw new IpbError("IPB-STOR-003", { detail: "write-once object exists" });
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket,
          Key: key,
          Body: body,
          IfNoneMatch: "*",
          ...(meta.contentType ? { ContentType: meta.contentType } : {}),
          Metadata: this.metadata(body, meta),
          ChecksumAlgorithm: "SHA256",
          ObjectLockMode: "COMPLIANCE",
          ObjectLockRetainUntilDate: retainUntil,
          ...sse,
        }),
      );
      this.located.set(key, slot);
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
          bucketClass: found!.cls.cls,
          ...(found!.cls.compartment ? { compartment: found!.cls.compartment } : {}),
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
      const slot = slotOf({
        bucketClass: opts.bucketClass,
        ...(opts.compartment ? { compartment: opts.compartment } : {}),
      });
      const Bucket = this.bucket(slot);
      const sse = this.sse(slot, key);
      const found = await this.locate(key);
      if (found) {
        this.refuseRetained(found.head, "upload");
        if (!sameSlot(found.cls, slot))
          throw new PortError("IPB-PORT-003", "STORAGE", {
            adapter: this.adapter,
            detail: "the object exists in another bucket class or compartment",
          });
      }
      return getSignedUrl(
        this.client,
        new PutObjectCommand({
          Bucket,
          Key: key,
          ContentType: opts.contentType,
          ...sse,
        }),
        { expiresIn: ttlSeconds, signableHeaders: new Set(["content-type"]) },
      );
    }
    const cls: Slot | undefined = opts.bucketClass
      ? slotOf({
          bucketClass: opts.bucketClass,
          ...(opts.compartment ? { compartment: opts.compartment } : {}),
        })
      : (await this.locate(key))?.cls;
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
    const classes = this.slots();
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

  /**
   * Proof of immutability: the current version is in COMPLIANCE mode with a future date, and its
   * stored SHA-256 checksum equals the hash recorded at write. A HEAD with checksum mode reads
   * attributes only, so an encrypt-only key suffices (PR-FBX-27).
   */
  async assertImmutable(key: string): Promise<void> {
    this.checkKey(key);
    const found = await this.locate(key);
    if (!found) this.notFound(key);
    if (found!.head.ObjectLockMode !== "COMPLIANCE" || !this.retained(found!.head))
      throw new IpbError("IPB-STOR-003", {
        detail: "object is not under compliance-mode retention",
      });
    let head: HeadObjectCommandOutput;
    try {
      head = await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucket(found!.cls),
          Key: key,
          ChecksumMode: "ENABLED",
        }),
      );
    } catch (e) {
      this.unavailable("read", e);
    }
    const recorded = head!.Metadata?.sha256;
    const stored = head!.ChecksumSHA256;
    if (!recorded || !stored || Buffer.from(stored, "base64").toString("hex") !== recorded)
      throw new IpbError("IPB-STOR-003", {
        detail: "object checksum is missing or does not match the hash recorded at write",
      });
  }

  /** Extend COMPLIANCE retention; only ever to a later date (PR-FBX-27, R1-D-42). */
  async extendRetention(key: string, retainUntil: Date): Promise<ObjectRetention> {
    this.checkKey(key);
    const found = await this.locate(key, "write");
    if (!found) this.notFound(key);
    const current = this.retained(found!.head);
    if (found!.head.ObjectLockMode !== "COMPLIANCE" || !current)
      throw new IpbError("IPB-STOR-003", {
        detail: "object is not under compliance-mode retention",
      });
    if (!(retainUntil > current))
      throw new IpbError("IPB-STOR-003", { detail: "retention can only be extended" });
    try {
      await this.client.send(
        new PutObjectRetentionCommand({
          Bucket: this.bucket(found!.cls),
          Key: key,
          Retention: { Mode: "COMPLIANCE", RetainUntilDate: retainUntil },
        }),
      );
    } catch (e) {
      this.unavailable("write", e);
    }
    return { mode: "COMPLIANCE", retainUntil: retainUntil.toISOString() };
  }

  /** From the current version's HEAD, which carries the lock mode and date. */
  async retentionOf(key: string): Promise<ObjectRetention> {
    this.checkKey(key);
    const found = await this.locate(key);
    if (!found) this.notFound(key);
    const until = found!.head.ObjectLockRetainUntilDate;
    return found!.head.ObjectLockMode === "COMPLIANCE" && until
      ? { mode: "COMPLIANCE", retainUntil: new Date(until).toISOString() }
      : { mode: null, retainUntil: null };
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
      for (const c of this.slots()) {
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
  async replicationStatus(): Promise<
    Partial<Record<BucketClass | `${CompartmentClass}.${StorageCompartment}`, string[]>>
  > {
    const out: Partial<Record<string, string[]>> = {};
    for (const c of this.slots()) {
      try {
        const r = await this.client.send(
          new GetBucketReplicationCommand({ Bucket: this.bucket(c) }),
        );
        out[slotName(c)] = (r.ReplicationConfiguration?.Rules ?? [])
          .filter((x) => x.Status === "Enabled")
          .map((x) => x.Destination?.Bucket ?? "")
          .filter(Boolean);
      } catch (e) {
        if ((e as S3Error).name === "ReplicationConfigurationNotFoundError") out[slotName(c)] = [];
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
    for (const c of this.slots()) {
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
