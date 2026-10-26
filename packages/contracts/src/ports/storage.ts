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

export interface ObjectMeta {
  contentType?: string;
  bucketClass: BucketClass;
  sha256?: string;
  tags?: Record<string, string>;
}

export interface StoredObject {
  key: string;
  body: Uint8Array;
  meta: ObjectMeta;
  retainUntil?: string;
}

export interface StoragePort extends Port {
  put(key: string, body: Uint8Array, meta: ObjectMeta): Promise<void>;
  /** Write-once with a compliance-mode retention date (IPB-01-29). */
  putWithRetention(
    key: string,
    body: Uint8Array,
    retainUntil: Date,
    meta: ObjectMeta,
  ): Promise<void>;
  get(key: string): Promise<StoredObject>;
  presign(key: string, op: "get" | "put", ttlSeconds: number): Promise<string>;
  /** Soft delete (tombstone); refused with IPB-STOR-003 while retention applies. */
  delete(key: string): Promise<void>;
  list(prefix: string, cursor?: string): Promise<{ keys: string[]; cursor?: string }>;
  /** Throws IPB-STOR-003-compatible proof failure if the object is not immutable. */
  assertImmutable(key: string): Promise<void>;
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
