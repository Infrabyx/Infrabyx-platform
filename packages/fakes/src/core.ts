// Fakes for the ports PL1 consumes (PL1 plan §10): SECRETS, KMS, STORAGE, FEATURE_FLAG, IDENTITY.
// Fakes for the ports PL1 consumes (PL1 plan §10): SECRETS, KMS, STORAGE, FEATURE_FLAG, IDENTITY.
import { IpbError } from "@infrabyx/contracts/errors";
import type {
  PushPlatform,
  PushTokenStore,
  EsignEnvelopeRecord,
  EsignEnvelopeStore,
  IdentityProvisioning,
  ObjectMeta,
  ObjectRetention,
  PortHealth,
  PresignOptions,
  ProvisionUserSpec,
  SecretMeta,
  SecretValue,
  SecretsPort,
  StorageKeyRefRefusal,
  StorageKeyRefStatus,
  StorageKeyRefStatusOptions,
  StorageKeyRefStatuses,
  StorageKeyRefStatusesOptions,
  StorageKeyState,
  StoragePort,
  StoredObject,
} from "@infrabyx/contracts/ports";
import {
  PRESIGN_NO_CACHE,
  STORAGE_HASH_MISMATCH,
  STORAGE_INTEGRITY_ERROR,
  STORAGE_KEY_NOT_DESCRIBED,
  STORAGE_KEY_UNAVAILABLE,
  compartmentAllowed,
  isValidStorageKey,
  keyRefStatusClasses,
  presignNoCache,
  resolveStorageKeyRef,
  storageKeyRefStatusRefusal,
} from "@infrabyx/contracts/ports";
import { LocalKms, sha256Hex } from "@infrabyx/crypto";

const up = (): PortHealth => ({
  status: "up",
  latency_ms: 0,
  checked_at: new Date().toISOString(),
});

export const fakeKms = (): LocalKms => new LocalKms();

export class MemorySecrets implements SecretsPort {
  readonly descriptor = {
    port: "SECRETS",
    adapter: "memory",
    residency: "IN",
    maxDataClass: "SECRET",
  } as const;
  private readonly store = new Map<string, SecretValue[]>();
  private readonly log: Array<{ at: string; actor: string; op: string; path: string }> = [];
  failWrites = false;
  async health(): Promise<PortHealth> {
    return up();
  }
  async get(path: string, version?: string): Promise<SecretValue> {
    const versions = this.store.get(path) ?? [];
    const v = version ? versions.find((x) => x.version === version) : versions.at(-1);
    if (!v) throw new Error(`secret ${path} not found`);
    this.log.push({ at: new Date().toISOString(), actor: "test", op: "get", path });
    return v;
  }
  async put(path: string, value: string, meta: SecretMeta = {}): Promise<{ version: string }> {
    if (this.failWrites) throw new Error("vault unavailable");
    const versions = this.store.get(path) ?? [];
    const version = String(versions.length + 1);
    versions.push({ value, version, meta: { ...meta, lastRotated: new Date().toISOString() } });
    this.store.set(path, versions);
    this.log.push({ at: new Date().toISOString(), actor: "test", op: "put", path });
    return { version };
  }
  async rotate(
    path: string,
    rotator: (current: SecretValue) => Promise<string>,
  ): Promise<{ version: string }> {
    return this.put(path, await rotator(await this.get(path)));
  }
  async list(prefix: string): Promise<string[]> {
    return [...this.store.keys()].filter((k) => k.startsWith(prefix)).sort();
  }
  async lease(path: string, ttlSeconds: number): Promise<SecretValue & { expiresAt: string }> {
    return {
      ...(await this.get(path)),
      expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
    };
  }
  async audit(path: string): Promise<Array<{ at: string; actor: string; op: string }>> {
    return this.log.filter((l) => l.path === path).map(({ at, actor, op }) => ({ at, actor, op }));
  }
  /** Number of versions stored at a path (tests never read values into assertions messages). */
  versions(path: string): number {
    return this.store.get(path)?.length ?? 0;
  }
}

interface Obj {
  body: Uint8Array;
  meta: ObjectMeta;
  retainUntil?: Date;
  deleted?: boolean;
}

/** PR-UDF-058: the named tenant keys the in-memory store knows (it holds no key material). */
export interface MemoryStorageKeyRefs {
  /** The references a tenant may name; none by default, so every reference is unknown. */
  keyRefs?: (tenantId: string) => readonly string[] | undefined;
  /** `{ [prefix]: keyRef }` for a tenant, as `S3StorageOptions.tenantKeyRefPrefixes`. */
  keyRefPrefixes?: (tenantId: string) => Readonly<Record<string, string>> | undefined;
  /**
   * PR-UDF-068: the state `keyRefStatus(…, { describeKey: true })` reports for a known reference,
   * as KMS would (`Enabled` when absent). Only the status reads it: writes and reads of the fake
   * never fail on a key's state.
   */
  keyStates?: (tenantId: string, keyRef: string) => StorageKeyState | undefined;
  /**
   * PR-UDF-076: the key-state read of a known reference fails, as KMS can. `"unavailable"`: the
   * read throws `IPB-PORT-002` (a throttled or failed `DescribeKey`), from `keyRefStatus` and
   * `keyRefStatuses` alike. `"not_described"`: the role may not describe the key, so
   * `keyRefStatuses` answers `storage_key_not_described` and `keyRefStatus`
   * `storage_key_unavailable`, as the `s3` adapter does. Only status calls with `describeKey` read
   * it.
   */
  keyStateError?: (tenantId: string, keyRef: string) => "unavailable" | "not_described" | undefined;
}

/**
 * The options of `MemoryStorage`: the named keys (`MemoryStorageKeyRefs`) and, PR-UDF-080
 * (R1-D-269), an injected read failure.
 */
export interface MemoryStorageOptions extends MemoryStorageKeyRefs {
  /**
   * PR-UDF-080: a read of `key` fails, as the `s3` adapter's can. `"integrity"`: the stored bytes
   * no longer match the SHA-256 recorded at write (a tampered object), so `get` throws
   * `IPB-STOR-005` with `meta.reason` `hash_mismatch`. `"unavailable"`: the store cannot be read,
   * so `get` throws `IPB-PORT-002`. Neither returns the bytes; `replicateTo` stops on either. Other
   * methods ignore it. (Editing `objects` directly is not detected, as before.)
   */
  readError?: (key: string) => "integrity" | "unavailable" | undefined;
}

const KEY_REF_CONFIG: ReadonlySet<StorageKeyRefRefusal> = new Set([
  "key_ref_unknown",
  "key_ref_prefix_invalid",
  "key_ref_shared",
]);

export class MemoryStorage implements StoragePort {
  readonly descriptor = {
    port: "STORAGE",
    adapter: "memory",
    residency: "IN",
    maxDataClass: "REGULATED",
  } as const;
  readonly objects = new Map<string, Obj>();
  constructor(
    private readonly now: () => Date = () => new Date(),
    private readonly named: MemoryStorageOptions = {},
  ) {}
  /**
   * PR-UDF-080: the injected read failure of `key`, thrown as the `s3` adapter throws it. An
   * outage comes before the object is found (a store that is down cannot say it is missing); an
   * integrity failure only for an object that exists.
   */
  private checkRead(key: string, exists: boolean): void {
    const err = this.named.readError?.(key);
    if (err === "unavailable")
      throw new IpbError("IPB-PORT-002", {
        detail: "memory read failed",
        meta: { name: "injected" },
      });
    if (err === "integrity" && exists)
      throw new IpbError(STORAGE_INTEGRITY_ERROR, {
        detail: "object body does not match its stored SHA-256",
        meta: { reason: STORAGE_HASH_MISMATCH },
      });
  }
  async health(): Promise<PortHealth> {
    return up();
  }
  private check(key: string): void {
    if (!isValidStorageKey(key)) throw new Error(`invalid storage key ${key}`);
  }
  private refuseKeyRef(reason: StorageKeyRefRefusal, detail: string): never {
    throw new IpbError(KEY_REF_CONFIG.has(reason) ? "IPB-PORT-001" : "IPB-PORT-003", {
      detail,
      meta: { reason },
    });
  }
  /** PR-UDF-058: the write's named key reference, refused as the `s3` adapter refuses it. */
  private keyRefOf(
    key: string,
    where: { bucketClass: ObjectMeta["bucketClass"]; keyRef?: string | undefined },
  ): string | undefined {
    const tenant = /^tenant\/([^/]+)\//.exec(key)?.[1] ?? "";
    const r = resolveStorageKeyRef(key, where, this.named.keyRefPrefixes?.(tenant));
    if (r.refusal) this.refuseKeyRef(r.refusal, `named key refused (${r.refusal})`);
    if (r.keyRef !== undefined && !(this.named.keyRefs?.(tenant) ?? []).includes(r.keyRef))
      this.refuseKeyRef("key_ref_unknown", `no named key ${r.keyRef}`);
    return r.keyRef;
  }
  /** The stored meta: the resolved reference, never one only a tag claims. */
  private stored(body: Uint8Array, meta: ObjectMeta, keyRef: string | undefined): ObjectMeta {
    const { keyRef: _named, ...rest } = meta;
    return { ...rest, ...(keyRef ? { keyRef } : {}), sha256: sha256Hex(body) };
  }
  /** PR-LDC-60: a compartment only in its classes, and an object never changes location. */
  private checkLocation(key: string, meta: ObjectMeta): void {
    if (!compartmentAllowed(meta.bucketClass, meta.compartment))
      throw new IpbError("IPB-PORT-003", {
        detail: `compartment ${meta.compartment} is not allowed in class ${meta.bucketClass}`,
      });
    const cur = this.objects.get(key);
    if (
      cur &&
      !cur.deleted &&
      (cur.meta.bucketClass !== meta.bucketClass || cur.meta.compartment !== meta.compartment)
    )
      throw new IpbError("IPB-PORT-003", {
        detail: "the object exists in another bucket class or compartment",
      });
  }
  /** PR-UDF-058: an overwrite keeps the object's reference (or its absence). */
  private checkKeyRef(key: string, keyRef: string | undefined): void {
    const cur = this.objects.get(key);
    if (cur && !cur.deleted && cur.meta.keyRef !== keyRef)
      this.refuseKeyRef("key_ref_changed", "the object exists under another key reference");
  }
  async put(key: string, body: Uint8Array, meta: ObjectMeta): Promise<void> {
    this.check(key);
    const cur = this.objects.get(key);
    if (cur?.retainUntil && cur.retainUntil > this.now())
      throw new IpbError("IPB-STOR-003", { detail: "object is under retention" });
    this.checkLocation(key, meta);
    const keyRef = this.keyRefOf(key, meta);
    this.checkKeyRef(key, keyRef);
    this.objects.set(key, { body, meta: this.stored(body, meta, keyRef) });
  }
  async putWithRetention(
    key: string,
    body: Uint8Array,
    retainUntil: Date,
    meta: ObjectMeta,
  ): Promise<void> {
    this.check(key);
    if (this.objects.has(key))
      throw new IpbError("IPB-STOR-003", { detail: "write-once object exists" });
    this.checkLocation(key, meta);
    const keyRef = this.keyRefOf(key, meta);
    this.objects.set(key, { body, meta: this.stored(body, meta, keyRef), retainUntil });
  }
  async get(key: string): Promise<StoredObject> {
    const o = this.objects.get(key);
    this.checkRead(key, !!o && !o.deleted);
    if (!o || o.deleted) throw new IpbError("IPB-STOR-001", { meta: { key } });
    return {
      key,
      body: o.body,
      meta: o.meta,
      ...(o.retainUntil ? { retainUntil: o.retainUntil.toISOString() } : {}),
    };
  }
  /** Presigned URLs live at most 5 minutes (IPB-02-15). */
  async presign(
    key: string,
    op: "get" | "put",
    ttlSeconds: number,
    opts: PresignOptions = {},
  ): Promise<string> {
    this.check(key);
    if (!(ttlSeconds > 0 && ttlSeconds <= 300))
      throw new RangeError("presigned URL TTL must be 1–300 s (IPB-02-15)");
    // PR-UDF-058: an upload URL under a named key names its reference, refused as `put` would.
    let keyRef: string | undefined;
    if (op === "put" && opts.bucketClass) {
      keyRef = this.keyRefOf(key, { bucketClass: opts.bucketClass, keyRef: opts.keyRef });
      this.checkKeyRef(key, keyRef);
    }
    const exp = Math.floor(this.now().getTime() / 1000) + ttlSeconds;
    // PR-UDF-060: a download of a REGULATED or CONFIDENTIAL object names the no-cache overrides,
    // as `s3` signs them; the class is the stored object's, else the one the caller names.
    const cls = this.objects.get(key)?.meta.bucketClass ?? opts.bucketClass;
    const noCache =
      op === "get" && cls && presignNoCache(cls)
        ? `&response-cache-control=${encodeURIComponent(PRESIGN_NO_CACHE.cacheControl)}` +
          `&response-expires=${encodeURIComponent(PRESIGN_NO_CACHE.expires)}`
        : "";
    return `memory://${key}?op=${op}&exp=${exp}${keyRef ? `&key_ref=${encodeURIComponent(keyRef)}` : ""}${noCache}`;
  }
  async delete(key: string): Promise<void> {
    const o = this.objects.get(key);
    if (!o) throw new IpbError("IPB-STOR-001", { meta: { key } });
    if (o.retainUntil && o.retainUntil > this.now())
      throw new IpbError("IPB-STOR-003", { detail: "object is under retention" });
    o.deleted = true;
  }
  async list(prefix: string): Promise<{ keys: string[] }> {
    return {
      keys: [...this.objects.entries()]
        .filter(([k, o]) => k.startsWith(prefix) && !o.deleted)
        .map(([k]) => k)
        .sort(),
    };
  }
  async assertImmutable(key: string): Promise<void> {
    const o = this.objects.get(key);
    if (!o?.retainUntil || o.retainUntil <= this.now())
      throw new IpbError("IPB-STOR-003", { detail: "object is not under retention" });
    if (o.meta.sha256 !== sha256Hex(o.body))
      throw new IpbError("IPB-STOR-003", { detail: "object checksum does not match" });
  }
  /** Only ever later (PR-FBX-27). */
  async extendRetention(key: string, retainUntil: Date): Promise<ObjectRetention> {
    const o = this.objects.get(key);
    if (!o || o.deleted) throw new IpbError("IPB-STOR-001", { meta: { key } });
    if (!o.retainUntil || o.retainUntil <= this.now())
      throw new IpbError("IPB-STOR-003", { detail: "object is not under retention" });
    if (!(retainUntil > o.retainUntil))
      throw new IpbError("IPB-STOR-003", { detail: "retention can only be extended" });
    o.retainUntil = retainUntil;
    return { mode: "COMPLIANCE", retainUntil: retainUntil.toISOString() };
  }
  async retentionOf(key: string): Promise<ObjectRetention> {
    const o = this.objects.get(key);
    if (!o || o.deleted) throw new IpbError("IPB-STOR-001", { meta: { key } });
    return o.retainUntil
      ? { mode: "COMPLIANCE", retainUntil: o.retainUntil.toISOString() }
      : { mode: null, retainUntil: null };
  }
  /**
   * PR-UDF-068: whether a write naming `keyRef` in `tenantId` would resolve, refused with the
   * write's label (`s3` adds the shared-key and tenant-CMK rules, which the fake does not model).
   * With `describeKey`, the configured `keyStates` (default `Enabled`): any other state answers
   * `storage_key_unavailable` with that state; PR-UDF-076: `keyStateError` makes that read fail.
   */
  async keyRefStatus(
    tenantId: string,
    keyRef: string,
    opts: StorageKeyRefStatusOptions,
  ): Promise<StorageKeyRefStatus> {
    const a = this.classStatus(tenantId, keyRef, opts.bucketClass, opts.compartment);
    if (a.status === "refused" || !opts.describeKey) return a;
    const d = this.keyStateOf(tenantId, keyRef);
    return d === "not_described" ? { status: "refused", reason: STORAGE_KEY_UNAVAILABLE } : d;
  }
  /**
   * PR-UDF-076: `keyRefStatus` for several classes; with `describeKey` the reference's state is
   * read once (the fake has one key per reference), and a key the role may not describe
   * (`keyStateError` `"not_described"`) answers `storage_key_not_described`.
   */
  async keyRefStatuses(
    tenantId: string,
    keyRef: string,
    opts: StorageKeyRefStatusesOptions,
  ): Promise<StorageKeyRefStatuses> {
    const classes = keyRefStatusClasses(opts);
    if (!classes)
      throw new IpbError("IPB-PORT-003", {
        detail: "the bucket classes or the compartment are malformed",
      });
    const answers = classes.map(
      (c) => [c, this.classStatus(tenantId, keyRef, c, opts.compartment)] as const,
    );
    const out: StorageKeyRefStatuses = {};
    let state: ReturnType<MemoryStorage["keyStateOf"]> | undefined;
    for (const [c, a] of answers) {
      if (a.status === "refused" || !opts.describeKey) {
        out[c] = a;
        continue;
      }
      state ??= this.keyStateOf(tenantId, keyRef);
      out[c] =
        state === "not_described"
          ? { status: "refused", reason: STORAGE_KEY_NOT_DESCRIBED }
          : state;
    }
    return out;
  }
  /** The configuration's answer for one class (no key state). */
  private classStatus(
    tenantId: string,
    keyRef: string,
    bucketClass: ObjectMeta["bucketClass"],
    compartment: ObjectMeta["compartment"],
  ): StorageKeyRefStatus {
    const r = storageKeyRefStatusRefusal(
      tenantId,
      keyRef,
      bucketClass,
      this.named.keyRefPrefixes?.(tenantId),
    );
    if (!r || !compartmentAllowed(bucketClass, compartment))
      throw new IpbError("IPB-PORT-003", {
        detail: "the tenant id, bucket class or compartment is malformed",
      });
    if (r.refusal) return { status: "refused", reason: r.refusal };
    if (!(this.named.keyRefs?.(tenantId) ?? []).includes(keyRef))
      return { status: "refused", reason: "key_ref_unknown" };
    return { status: "resolves" };
  }
  /** The configured key state (default `Enabled`), or the injected read failure. */
  private keyStateOf(tenantId: string, keyRef: string): StorageKeyRefStatus | "not_described" {
    const err = this.named.keyStateError?.(tenantId, keyRef);
    if (err === "unavailable")
      throw new IpbError("IPB-PORT-002", {
        detail: "the key's state could not be read",
        meta: { name: "injected" },
      });
    if (err === "not_described") return "not_described";
    const keyState = this.named.keyStates?.(tenantId, keyRef) ?? "Enabled";
    return keyState === "Enabled"
      ? { status: "resolves", keyState }
      : { status: "refused", reason: STORAGE_KEY_UNAVAILABLE, keyState };
  }
  async replicateTo(
    target: StoragePort,
    prefix: string,
  ): Promise<{ copied: number; verified: number }> {
    let copied = 0;
    for (const [k, o] of this.objects) {
      if (!k.startsWith(prefix) || o.deleted) continue;
      this.checkRead(k, true);
      if (o.retainUntil) await target.putWithRetention(k, o.body, o.retainUntil, o.meta);
      else await target.put(k, o.body, o.meta);
      copied++;
    }
    return { copied, verified: copied };
  }
}

export class MemoryIdentity implements IdentityProvisioning {
  readonly users = new Map<string, ProvisionUserSpec>();
  async provisionUser(spec: ProvisionUserSpec): Promise<{ id: string }> {
    this.users.set(spec.email, spec);
    return { id: spec.email };
  }
  async setPassword(email: string, password: string, temporary: boolean): Promise<void> {
    const u = this.users.get(email);
    if (!u) throw new Error(`no user ${email}`);
    u.password = { value: password, temporary };
  }
}

/** In-memory PUSH token store for adapter tests (NOTIFY seals tokens in production). */
export class MemoryPushTokenStore implements PushTokenStore {
  private readonly rows = new Map<
    string,
    { tokenRef: string; userId: string; platform: PushPlatform; provider: string; token: string }
  >();
  async save(t: { userId: string; platform: PushPlatform; provider: string; token: string }) {
    const existing = [...this.rows.values()].find(
      (r) => r.token === t.token && r.provider === t.provider,
    );
    if (existing) return { tokenRef: existing.tokenRef };
    const tokenRef = `ptk_${this.rows.size + 1}`;
    this.rows.set(tokenRef, { tokenRef, ...t });
    return { tokenRef };
  }
  async forUsers(userIds: readonly string[], provider: string) {
    return [...this.rows.values()].filter(
      (r) => userIds.includes(r.userId) && r.provider === provider,
    );
  }
  async remove(tokenRef: string) {
    this.rows.delete(tokenRef);
  }
  get size(): number {
    return this.rows.size;
  }
}

/** In-memory `EsignEnvelopeStore` for the ESIGN contract legs (products persist theirs). */
export class MemoryEsignEnvelopeStore implements EsignEnvelopeStore {
  readonly rows = new Map<string, EsignEnvelopeRecord>();
  async save(r: EsignEnvelopeRecord): Promise<void> {
    this.rows.set(r.envelopeId, structuredClone(r));
  }
  async get(envelopeId: string): Promise<EsignEnvelopeRecord | null> {
    return this.rows.get(envelopeId) ?? null;
  }
  async byVendorRef(adapter: string, vendorRef: string): Promise<EsignEnvelopeRecord | null> {
    return (
      [...this.rows.values()].find((r) => r.adapter === adapter && r.vendorRef === vendorRef) ??
      null
    );
  }
}

export { MemoryFlagProvider, MemorySnapshotStore } from "@infrabyx/config/flags";
