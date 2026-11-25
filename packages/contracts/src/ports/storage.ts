// STORAGE port (IPB-01 §01.4.4.2, IPB-01-27..30). Keys: tenant/<tenant_id>/<module>/<ulid>.
import type { Port } from "./common.js";
import { ULID_PATTERN } from "../ids.js";

export const BUCKET_CLASSES = [
  "AUDIT",
  "REGULATED",
  "CONFIDENTIAL",
  "GENERAL",
  "PUBLIC_ASSETS",
  "QUARANTINE",
] as const;
export type BucketClass = (typeof BUCKET_CLASSES)[number];

/**
 * Separately keyed compartments within a bucket class (LawDocsComply PR-LDC-60, R1-D-158). An
 * object in a compartment lives in that compartment's own bucket under its own encryption key,
 * never one shared with the class's other objects or with another compartment; the class's lock
 * and retention rules still apply. `BOARD_CONFIDENTIAL`: board papers and unpublished
 * price-sensitive information. `SEALED`: material sealed by an order or an agreement.
 */
export const STORAGE_COMPARTMENTS = ["BOARD_CONFIDENTIAL", "SEALED"] as const;
export type StorageCompartment = (typeof STORAGE_COMPARTMENTS)[number];
/** The bucket classes a compartment may be used in. */
export const COMPARTMENT_CLASSES = [
  "CONFIDENTIAL",
  "REGULATED",
] as const satisfies readonly BucketClass[];
export type CompartmentClass = (typeof COMPARTMENT_CLASSES)[number];

/** Whether `compartment` may be used in `cls` (no compartment is always allowed). */
export function compartmentAllowed(cls: BucketClass, compartment?: StorageCompartment): boolean {
  return (
    compartment === undefined ||
    ((STORAGE_COMPARTMENTS as readonly string[]).includes(compartment) &&
      (COMPARTMENT_CLASSES as readonly string[]).includes(cls))
  );
}

/**
 * Named tenant keys (Udofin PR-UDF-058, R1-D-227). A put may name one of its tenant's own keys by a
 * reference such as `lender:lnd_01…`, so that, for example, a vault keeps each lender's files under
 * that lender's key. The caller only ever names the key: the adapter's configuration resolves the
 * reference to a key id within the object's tenant, and a reference shaped like a key id is
 * refused. The reference (never the key id) is recorded on the object and read back in `meta`.
 */
export const STORAGE_KEY_REF_PATTERN = /^[a-z0-9][a-z0-9_.:-]{2,63}$/;
/** Shapes of a raw key id, refused as a reference: an ARN, a multi-Region key id, a UUID. */
const KEY_ID_SHAPED =
  /^(?:arn:|mrk-)|^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Whether `ref` is a well-formed key reference (and not a key id in disguise). */
export const isValidStorageKeyRef = (ref: string): boolean =>
  STORAGE_KEY_REF_PATTERN.test(ref) && !KEY_ID_SHAPED.test(ref);
/**
 * The bucket classes a named key may be used in. `QUARANTINE` (Udofin PR-UDF-066, R1-D-240), so a
 * lender's upload is under the lender's key from its first byte: the AV engine's workload, which
 * reads the object through STORAGE to scan it, then needs `kms:Decrypt` on each such key. `AUDIT`
 * (anchors the platform must always read), `PUBLIC_ASSETS` and `GENERAL` stay on platform keys.
 */
export const NAMED_KEY_CLASSES = [
  "CONFIDENTIAL",
  "REGULATED",
  "QUARANTINE",
] as const satisfies readonly BucketClass[];
/** Object metadata name that records the reference (S3 `x-amz-meta-ipb-key-ref`). */
export const STORAGE_KEY_REF_META = "ipb-key-ref";
/**
 * Fixed refusal labels (`meta.reason`) of a named-key write. `key_ref_invalid`, `key_ref_class`,
 * `key_ref_prefix_conflict`, `key_ref_changed` and `key_ref_tenant_cmk` come with IPB-PORT-003;
 * `key_ref_unknown`, `key_ref_prefix_invalid` and `key_ref_shared` with IPB-PORT-001 (the
 * configuration); a key that is disabled or no longer granted reads as IPB-KMS-001
 * `storage_key_unavailable`.
 */
export const STORAGE_KEY_REF_REFUSALS = [
  "key_ref_invalid",
  "key_ref_class",
  "key_ref_prefix_conflict",
  "key_ref_prefix_invalid",
  "key_ref_unknown",
  "key_ref_shared",
  "key_ref_changed",
  "key_ref_tenant_cmk",
] as const;
export type StorageKeyRefRefusal = (typeof STORAGE_KEY_REF_REFUSALS)[number];

/**
 * The reference a write uses: the one it names, else the longest matching prefix's in `prefixes`
 * (`{ [prefix]: keyRef }`, each prefix under `tenant/<tenant>/` of the key's tenant), else none.
 * Refuses a malformed reference, a reference outside `NAMED_KEY_CLASSES`, a prefix outside the
 * tenant and a named reference that differs from its prefix's.
 */
export function resolveStorageKeyRef(
  key: string,
  where: { bucketClass: BucketClass; keyRef?: string | undefined },
  prefixes?: Readonly<Record<string, string>>,
): { keyRef?: string; refusal?: StorageKeyRefRefusal } {
  const tenant = /^tenant\/([^/]+)\//.exec(key)?.[1];
  let fromPrefix: string | undefined;
  let longest = -1;
  for (const [prefix, ref] of Object.entries(prefixes ?? {})) {
    if (!tenant || !prefix.startsWith(`tenant/${tenant}/`) || !isValidStorageKeyRef(ref))
      return { refusal: "key_ref_prefix_invalid" };
    if (key.startsWith(prefix) && prefix.length > longest) {
      longest = prefix.length;
      fromPrefix = ref;
    }
  }
  if (where.keyRef !== undefined && !isValidStorageKeyRef(where.keyRef))
    return { refusal: "key_ref_invalid" };
  if (where.keyRef !== undefined && fromPrefix !== undefined && where.keyRef !== fromPrefix)
    return { refusal: "key_ref_prefix_conflict" };
  const keyRef = where.keyRef ?? fromPrefix;
  if (keyRef === undefined) return {};
  if (!(NAMED_KEY_CLASSES as readonly string[]).includes(where.bucketClass))
    return { refusal: "key_ref_class" };
  return { keyRef };
}

/**
 * Key states `keyRefStatus` may report (Udofin PR-UDF-068, R1-D-239): AWS KMS `KeyState` values.
 * Only `Enabled` resolves; any other state answers `storage_key_unavailable`. A state the store
 * reports that is not listed here reads as `Unavailable`.
 */
export const STORAGE_KEY_STATES = [
  "Enabled",
  "Disabled",
  "PendingDeletion",
  "PendingImport",
  "PendingReplicaDeletion",
  "Unavailable",
  "Updating",
  "Creating",
] as const;
export type StorageKeyState = (typeof STORAGE_KEY_STATES)[number];
/** The label of a key that exists in configuration but cannot be used now (IPB-KMS-001). */
export const STORAGE_KEY_UNAVAILABLE = "storage_key_unavailable" as const;
/** Why `keyRefStatus` answers `refused`: a write's refusal label, or the key's state. */
export type StorageKeyRefStatusReason = StorageKeyRefRefusal | typeof STORAGE_KEY_UNAVAILABLE;

/** Where `keyRefStatus` checks a reference, and whether it asks the key store for the key's state. */
export interface StorageKeyRefStatusOptions {
  bucketClass: BucketClass;
  compartment?: StorageCompartment;
  /**
   * Also read the key's state (a read-only KMS `DescribeKey` on `s3`): a key that is not `Enabled`
   * then answers `storage_key_unavailable`. Off by default (configuration only, no KMS call).
   */
  describeKey?: boolean;
}

/**
 * The answer of `keyRefStatus` (PR-UDF-068): fixed labels only, never a key id or ARN. `keyState`
 * is present only when `describeKey` was asked and the store could report it.
 */
export type StorageKeyRefStatus =
  | { status: "resolves"; keyState?: "Enabled" }
  | { status: "refused"; reason: StorageKeyRefStatusReason; keyState?: StorageKeyState };

/**
 * The label of a key the platform's STORAGE role may not describe (Udofin PR-UDF-076, R1-D-261):
 * KMS `DescribeKey` answered `AccessDeniedException`, so the key's state is unknown. Answered by
 * `keyRefStatuses` only; `keyRefStatus` keeps answering `storage_key_unavailable` for it (R1-D-239,
 * #171 (1)), so its answer type and behaviour are unchanged. Either way the status is `refused`.
 */
export const STORAGE_KEY_NOT_DESCRIBED = "storage_key_not_described" as const;
/** Why `keyRefStatuses` refuses a class: `keyRefStatus`'s reasons, or the key not described. */
export type StorageKeyRefStatusesReason =
  StorageKeyRefStatusReason | typeof STORAGE_KEY_NOT_DESCRIBED;

/** Where `keyRefStatuses` checks a reference: several bucket classes in one call. */
export interface StorageKeyRefStatusesOptions {
  /** One to six distinct classes (`BUCKET_CLASSES`); each is answered as `keyRefStatus` would. */
  bucketClasses: readonly BucketClass[];
  /** Applies to every class: each must allow it (`COMPARTMENT_CLASSES`), or the call is refused. */
  compartment?: StorageCompartment;
  /**
   * Also read each key's state, with one read-only KMS `DescribeKey` per distinct key the classes
   * resolve to (a reference that uses one key in `REGULATED` and `QUARANTINE` is described once).
   */
  describeKey?: boolean;
}

/** One class's answer of `keyRefStatuses`: `StorageKeyRefStatus`, with the not-described label. */
export type StorageKeyRefClassStatus =
  | { status: "resolves"; keyState?: "Enabled" }
  | { status: "refused"; reason: StorageKeyRefStatusesReason; keyState?: StorageKeyState };

/** The answer of `keyRefStatuses`: one entry per class asked, keyed by class. */
export type StorageKeyRefStatuses = Partial<Record<BucketClass, StorageKeyRefClassStatus>>;

/** PR-UDF-076: the most classes `keyRefStatuses` takes (every class, once). */
export const MAX_KEY_REF_STATUS_CLASSES = BUCKET_CLASSES.length;

/**
 * PR-UDF-076: the classes of a `keyRefStatuses` call, or `null` when the list is empty, longer
 * than `BUCKET_CLASSES`, has a duplicate or an unknown class, or a class that does not allow the
 * compartment (the adapter refuses the call, IPB-PORT-003).
 */
export function keyRefStatusClasses(opts: {
  bucketClasses?: readonly unknown[];
  compartment?: StorageCompartment;
}): BucketClass[] | null {
  const cs = opts.bucketClasses;
  if (!Array.isArray(cs) || cs.length < 1 || cs.length > MAX_KEY_REF_STATUS_CLASSES) return null;
  if (new Set(cs).size !== cs.length) return null;
  for (const c of cs)
    if (
      typeof c !== "string" ||
      !(BUCKET_CLASSES as readonly string[]).includes(c) ||
      !compartmentAllowed(c as BucketClass, opts.compartment)
    )
      return null;
  return cs as BucketClass[];
}

/**
 * No-cache presigned downloads (Udofin PR-UDF-060, R1-D-230). A presigned GET of an object in one
 * of these classes (its compartments included) signs S3's response overrides
 * `response-cache-control` and `response-expires`, so the response tells browsers, iOS and
 * webviews not to keep a copy. S3 has no `Pragma` override; `Cache-Control: no-store` supersedes
 * it for HTTP/1.1 clients. Nothing a caller passes can drop or change the overrides.
 */
export const NO_CACHE_PRESIGN_CLASSES = [
  "CONFIDENTIAL",
  "REGULATED",
] as const satisfies readonly BucketClass[];
/** The signed overrides: `Expires` is a past HTTP-date (S3 takes a date, never a literal `0`). */
export const PRESIGN_NO_CACHE = {
  cacheControl: "no-store, private",
  expires: "Thu, 01 Jan 1970 00:00:00 GMT",
} as const;
/** Whether a presigned GET of an object in `cls` carries the no-cache overrides. */
export const presignNoCache = (cls: BucketClass): boolean =>
  (NO_CACHE_PRESIGN_CLASSES as readonly string[]).includes(cls);

/**
 * Served downloads are attachments (IPB-02-44; Finbyx PR-FBX-56 (d), R1-D-292): a presigned GET of
 * an object in any class but `PUBLIC_ASSETS` signs `response-content-disposition: attachment`, so
 * a browser saves the file instead of rendering it on the store's origin. Inline preview needs a
 * sandboxed origin of the product's own. Nothing a caller passes can drop it.
 */
export const PRESIGN_ATTACHMENT_DISPOSITION = "attachment" as const;
/** Whether a presigned GET of an object in `cls` signs `Content-Disposition: attachment`. */
export const presignAttachment = (cls: BucketClass): boolean => cls !== "PUBLIC_ASSETS";

export interface ObjectMeta {
  contentType?: string;
  bucketClass: BucketClass;
  /** PR-LDC-60: a separately keyed compartment of `bucketClass` (`CONFIDENTIAL` or `REGULATED`). */
  compartment?: StorageCompartment;
  /**
   * PR-UDF-058: the tenant's named key the object is encrypted under (a `NAMED_KEY_CLASSES` class:
   * `CONFIDENTIAL`, `REGULATED` or, PR-UDF-066, `QUARANTINE`); a reference, never a key id. `get`
   * returns it; an overwrite must keep it.
   */
  keyRef?: string;
  sha256?: string;
  tags?: Record<string, string>;
}

/**
 * PR-UDF-066 (R1-D-240): the meta of the clean copy of a scanned object (`from` is the `meta` that
 * `get` returned for the `QUARANTINE` object), for the product's promotion `put` into `to`. The
 * named key reference is carried over, so the copy is encrypted under that reference's key at the
 * clean location, or the write is refused (`key_ref_unknown` where the reference has no key there,
 * `key_ref_class` outside `NAMED_KEY_CLASSES`); it never falls back to the clean class's key. The
 * content type, the SHA-256 and the tags are kept; the compartment is `to`'s.
 */
export function promotedObjectMeta(
  from: ObjectMeta,
  to: { bucketClass: BucketClass; compartment?: StorageCompartment },
): ObjectMeta {
  return {
    bucketClass: to.bucketClass,
    ...(to.compartment ? { compartment: to.compartment } : {}),
    ...(from.contentType ? { contentType: from.contentType } : {}),
    ...(from.keyRef ? { keyRef: from.keyRef } : {}),
    ...(from.sha256 ? { sha256: from.sha256 } : {}),
    ...(from.tags ? { tags: { ...from.tags } } : {}),
  };
}

/**
 * Integrity refusal of a STORAGE read (Udofin PR-UDF-080, R1-D-269): the object's bytes do not
 * match the SHA-256 recorded at write, or the checksum the store returns disagrees with them.
 * `get` then throws this code with `meta.reason` `STORAGE_HASH_MISMATCH` and a fixed detail, and
 * never returns the bytes. Distinct from an outage (`IPB-PORT-002`, 503, retried later): a
 * possible tamper is 500, never retried, and does not trip the circuit breaker or fail over.
 */
export const STORAGE_INTEGRITY_ERROR = "IPB-STOR-005" as const;
/** The fixed `meta.reason` of `STORAGE_INTEGRITY_ERROR` (the label products already match on). */
export const STORAGE_HASH_MISMATCH = "hash_mismatch" as const;

/** Whether `e` is a STORAGE integrity refusal (`STORAGE_INTEGRITY_ERROR`), not an outage. */
export function isStorageIntegrityError(e: unknown): boolean {
  return (e as { code?: unknown } | null | undefined)?.code === STORAGE_INTEGRITY_ERROR;
}

export interface StoredObject {
  key: string;
  body: Uint8Array;
  meta: ObjectMeta;
  retainUntil?: string;
}

/** An object's retention (IPB-01-29). */
export interface ObjectRetention {
  mode: "COMPLIANCE" | null;
  retainUntil: string | null;
}

/** Options of `presign` (C-17, IPB-02-15). A PUT URL is bound to one bucket class and content type. */
export interface PresignOptions {
  /** Required for `put`; for `get` the adapter finds the object. */
  bucketClass?: BucketClass;
  /** For `put` into a compartment (PR-LDC-60); the URL then writes under the compartment's key. */
  compartment?: StorageCompartment;
  /** For `put` under a named tenant key (PR-UDF-058); the URL signs that key and the reference. */
  keyRef?: string;
  /** Required for `put`: signed, so the upload must send exactly this content type. */
  contentType?: string;
}

export interface StoragePort extends Port {
  put(key: string, body: Uint8Array, meta: ObjectMeta): Promise<void>;
  /**
   * Write-once with a compliance-mode retention date (IPB-01-29): one single-part write carrying
   * the lock mode, the date and a SHA-256 checksum, never a multipart upload (which would need the
   * decrypt permission on an encrypt-only tenant key).
   */
  putWithRetention(
    key: string,
    body: Uint8Array,
    retainUntil: Date,
    meta: ObjectMeta,
  ): Promise<void>;
  /**
   * The object's current version. Fails closed (PR-UDF-080, R1-D-269): bytes that do not match
   * the SHA-256 recorded at write, or a checksum the store returns that disagrees with them, throw
   * `STORAGE_INTEGRITY_ERROR` (`IPB-STOR-005`, `meta.reason` `hash_mismatch`); a store that cannot
   * be read throws `IPB-PORT-002`. Neither returns bytes.
   */
  get(key: string): Promise<StoredObject>;
  /**
   * SigV4 URL bound to the method (and for `put` the content type), TTL 1–300 s (IPB-02-15). A
   * `get` of an object in a `NO_CACHE_PRESIGN_CLASSES` class signs the `PRESIGN_NO_CACHE`
   * response overrides (PR-UDF-060).
   */
  presign(
    key: string,
    op: "get" | "put",
    ttlSeconds: number,
    opts?: PresignOptions,
  ): Promise<string>;
  /** Soft delete (tombstone); refused with IPB-STOR-003 while retention applies. */
  delete(key: string): Promise<void>;
  list(prefix: string, cursor?: string): Promise<{ keys: string[]; cursor?: string }>;
  /**
   * Throws IPB-STOR-003-compatible proof failure if the object is not immutable: the current
   * version is in COMPLIANCE mode with a future date and its stored SHA-256 checksum equals the
   * hash recorded at write. Reads attributes only, never the body, so no decrypt is needed.
   */
  assertImmutable(key: string): Promise<void>;
  /**
   * Extend an object's COMPLIANCE retention (Finbyx PR-FBX-27, R1-D-42). Only ever later: an
   * earlier or equal date, or an object without retention, is refused with IPB-STOR-003. Optional
   * on the interface; every platform adapter provides it.
   */
  extendRetention?(key: string, retainUntil: Date): Promise<ObjectRetention>;
  /** The object's retention, or `{ mode: null, retainUntil: null }` when it has none. */
  retentionOf?(key: string): Promise<ObjectRetention>;
  /**
   * Whether a write in `tenantId` naming `keyRef` at this location would resolve (Udofin
   * PR-UDF-068, R1-D-239). Read-only: no object is written, nothing is ledgered. Applies the
   * write's rules (`resolveStorageKeyRef`'s format, class and prefix-map checks, then the adapter's
   * own: unknown reference, shared key, tenant CMK) and answers `refused` with that write's label;
   * with `describeKey`, a key that is not `Enabled` answers `storage_key_unavailable`. Object-level
   * refusals (`key_ref_changed`, `key_ref_prefix_conflict`) need an object and are not checked. A
   * tenant other than the caller's, a malformed tenant id or a compartment outside its classes is
   * refused (`IPB-PORT-003`) as a write would be; an adapter without per-object keys declares it
   * `unsupported`. Optional on the interface; every platform adapter provides it.
   */
  keyRefStatus?(
    tenantId: string,
    keyRef: string,
    opts: StorageKeyRefStatusOptions,
  ): Promise<StorageKeyRefStatus>;
  /**
   * `keyRefStatus` for several bucket classes in one call (Udofin PR-UDF-076, R1-D-261): one answer
   * per class in `opts.bucketClasses`, each by the same checks. With `describeKey`, one read-only
   * KMS `DescribeKey` per distinct key the classes resolve to; a key the role may not describe
   * answers `storage_key_not_described` (not `storage_key_unavailable`), and a failed read throws
   * `IPB-PORT-002` for the whole call. A malformed class list (`keyRefStatusClasses`), tenant or
   * compartment is refused as `keyRefStatus` refuses it. Optional on the interface; every platform
   * adapter provides it (`minio` declares it `unsupported`).
   */
  keyRefStatuses?(
    tenantId: string,
    keyRef: string,
    opts: StorageKeyRefStatusesOptions,
  ): Promise<StorageKeyRefStatuses>;
  replicateTo(target: StoragePort, prefix: string): Promise<{ copied: number; verified: number }>;
}

/** The tenant segment of a storage key (`tenant/<tenant_id>/…`). */
const TENANT_SEGMENT = "[a-z]{2,6}_[A-Za-z0-9]+";
const KEY_REGEX = new RegExp(
  `^tenant/${TENANT_SEGMENT}/[a-z][a-z0-9_]*/${ULID_PATTERN}(\\.[a-z0-9]+)?$`,
);
const TENANT_REGEX = new RegExp(`^${TENANT_SEGMENT}$`);

/** Whether `tenantId` can head a storage key (IPB-01-27), as `keyRefStatus` requires. */
export const isValidStorageTenantId = (tenantId: string): boolean => TENANT_REGEX.test(tenantId);

/**
 * PR-UDF-068: the configuration-free part of `keyRefStatus`, shared by every adapter. `null` for a
 * tenant id that cannot head a key (the adapter refuses the call, IPB-PORT-003); otherwise the
 * label a write in that tenant naming `keyRef` would be refused with, or `{}`. The prefix map is
 * checked as a write checks it (a prefix outside the tenant refuses every named-key write).
 */
export function storageKeyRefStatusRefusal(
  tenantId: string,
  keyRef: string,
  bucketClass: BucketClass,
  prefixes?: Readonly<Record<string, string>>,
): { refusal?: StorageKeyRefRefusal } | null {
  if (!isValidStorageTenantId(tenantId)) return null;
  const r = resolveStorageKeyRef(`tenant/${tenantId}/`, { bucketClass, keyRef }, prefixes);
  return r.refusal ? { refusal: r.refusal } : {};
}

/** IPB-01-27 key format check (provider never encoded in the key). */
export const isValidStorageKey = (key: string): boolean => KEY_REGEX.test(key);

export function storageKey(tenantId: string, module: string, ulid: string, ext?: string): string {
  const key = `tenant/${tenantId}/${module}/${ulid}${ext ? `.${ext}` : ""}`;
  if (!isValidStorageKey(key)) throw new Error(`invalid storage key ${key}`);
  return key;
}
