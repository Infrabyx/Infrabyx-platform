// KMS port (IPB-01 §01.4.4.2). Signatures record alg, key_id and cert_chain_ref (crypto-agility).
import type { Port } from "./common.js";

/** Algorithm identifiers from the @infrabyx/crypto registry (PL1-C-01). */
export type KmsSignAlgorithm = "ecdsa-p256-sha256" | (string & {});
export type KmsWrapAlgorithm = "aes-256-gcm" | (string & {});

/**
 * Purposes a KMS encryption context may name (C-14, PL2-D-50). A fixed registry: values are
 * identifiers of a use, never data, so no personal data can enter a context. Extend only here.
 */
export const KMS_PURPOSES = ["field", "health", "workflow"] as const;
export type KmsPurpose = (typeof KMS_PURPOSES)[number];

/** Tenant id used in the context of platform-scoped operations (health canaries). */
export const PLATFORM_KMS_TENANT = "platform";

/** The C-14 encryption context bound to every data-key wrap and unwrap. */
export interface KmsEncryptionContext {
  tenant_id: string;
  purpose: KmsPurpose;
}

const CONTEXT_TENANT = /^[A-Za-z0-9_]{1,64}$/;

/** True for exactly `{ tenant_id, purpose }` with a valid tenant id and a registered purpose. */
export function isKmsEncryptionContext(v: unknown): v is KmsEncryptionContext {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const keys = Object.keys(v).sort();
  if (keys.length !== 2 || keys[0] !== "purpose" || keys[1] !== "tenant_id") return false;
  const c = v as Record<string, unknown>;
  return (
    typeof c.tenant_id === "string" &&
    CONTEXT_TENANT.test(c.tenant_id) &&
    (KMS_PURPOSES as readonly unknown[]).includes(c.purpose)
  );
}

export interface DataKey {
  /** Plaintext data key; keep in memory only, never persist (IPB-02 §02.4.3.2). */
  plaintext: Uint8Array;
  /** Data key encrypted under `keyId`; stored with the row. */
  ciphertext: Uint8Array;
  keyId: string;
}

export interface KmsPort extends Port {
  encrypt(keyId: string, plaintext: Uint8Array, aad?: Uint8Array): Promise<Uint8Array>;
  decrypt(keyId: string, ciphertext: Uint8Array, aad?: Uint8Array): Promise<Uint8Array>;
  /**
   * `aad` is the encoded C-14 encryption context `{ tenant_id, purpose }` (`encodeKmsContext` in
   * @infrabyx/crypto). Adapters refuse a data key without a valid context (IPB-PORT-003, PL2-D-50);
   * unwrapping it later needs the same context.
   */
  generateDataKey(keyId: string, aad?: Uint8Array): Promise<DataKey>;
  /** Sign a message of at most 4096 bytes (adapters may pre-hash; PL1-D-09); returns a DER-encoded signature. */
  sign(keyId: string, message: Uint8Array, alg: KmsSignAlgorithm): Promise<Uint8Array>;
  verify(
    keyId: string,
    message: Uint8Array,
    signature: Uint8Array,
    alg: KmsSignAlgorithm,
  ): Promise<boolean>;
  /** SPKI DER public key of an asymmetric key, so third parties can verify (anchors, IPB-02 §02.4.7.1). */
  getPublicKey(keyId: string): Promise<Uint8Array>;
  /** One customer-managed key per tenant for REGULATED fields (IPB-01 KMS reference). */
  createTenantKey(tenantId: string): Promise<{ keyId: string }>;
  /** Scheduled, never immediate; ≥ 30 days and maker-checker approved upstream (IPB-02-20). */
  scheduleKeyDeletion(keyId: string, days: number): Promise<{ deletionDate: string }>;
  listAlgorithms(): Promise<string[]>;
}
