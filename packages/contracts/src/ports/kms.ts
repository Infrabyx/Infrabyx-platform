// KMS port (IPB-01 §01.4.4.2). Signatures record alg, key_id and cert_chain_ref (crypto-agility).
import type { Port } from "./common.js";

/** Algorithm identifiers from the @infrabyx/crypto registry (PL1-C-01). */
export type KmsSignAlgorithm = "ecdsa-p256-sha256" | (string & {});
export type KmsWrapAlgorithm = "aes-256-gcm" | (string & {});

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
  generateDataKey(keyId: string): Promise<DataKey>;
  /** Sign a digest (not the message); returns a DER-encoded signature. */
  sign(keyId: string, digest: Uint8Array, alg: KmsSignAlgorithm): Promise<Uint8Array>;
  verify(
    keyId: string,
    digest: Uint8Array,
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
