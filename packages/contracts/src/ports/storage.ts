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
/** The bucket classes a named key may be used in. */
export const NAMED_KEY_CLASSES = [
  "CONFIDENTIAL",
  "REGULATED",
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

export interface ObjectMeta {
  contentType?: string;
  bucketClass: BucketClass;
  /** PR-LDC-60: a separately keyed compartment of `bucketClass` (`CONFIDENTIAL` or `REGULATED`). */
  compartment?: StorageCompartment;
  /**
   * PR-UDF-058: the tenant's named key the object is encrypted under (`CONFIDENTIAL` or
   * `REGULATED`); a reference, never a key id. `get` returns it; an overwrite must keep it.
   */
  keyRef?: string;
  sha256?: string;
  tags?: Record<string, string>;
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
  replicateTo(target: StoragePort, prefix: string): Promise<{ copied: number; verified: number }>;
}

const KEY_REGEX = new RegExp(
  `^tenant/[a-z]{2,6}_[A-Za-z0-9]+/[a-z][a-z0-9_]*/${ULID_PATTERN}(\\.[a-z0-9]+)?$`,
);

/** IPB-01-27 key format check (provider never encoded in the key). */
export const isValidStorageKey = (key: string): boolean => KEY_REGEX.test(key);

export function storageKey(tenantId: string, module: string, ulid: string, ext?: string): string {
  const key = `tenant/${tenantId}/${module}/${ulid}${ext ? `.${ext}` : ""}`;
  if (!isValidStorageKey(key)) throw new Error(`invalid storage key ${key}`);
  return key;
}
