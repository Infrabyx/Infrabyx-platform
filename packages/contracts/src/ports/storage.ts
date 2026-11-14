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

export interface ObjectMeta {
  contentType?: string;
  bucketClass: BucketClass;
  /** PR-LDC-60: a separately keyed compartment of `bucketClass` (`CONFIDENTIAL` or `REGULATED`). */
  compartment?: StorageCompartment;
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
  /** SigV4 URL bound to the method (and for `put` the content type), TTL 1–300 s (IPB-02-15). */
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
