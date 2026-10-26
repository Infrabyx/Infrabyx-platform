// Field-level envelope encryption with per-tenant KMS keys (IPB-02-20, §02.4.3.2). Primitives
// come from @infrabyx/crypto (IPB-12-05); REGULATED and SECRET values are always encrypted.
// New seals use envelope format v2: the data key is wrapped under the C-14 KMS context
// { tenant_id, purpose: "field" } (PL2-D-50); v1 fields stay readable and `rewrapField` upgrades them.
import type { DataClass } from "@infrabyx/contracts/data-class";
import type { KmsEncryptionContext, KmsPort } from "@infrabyx/contracts/ports";
import { FieldEnvelope, fieldAad, type EnvelopeOptions, type SealedField } from "@infrabyx/crypto";

export interface FieldLocation {
  table: string;
  column: string;
  rowId: string;
}

export interface FieldCryptoOptions extends EnvelopeOptions {
  kms: KmsPort;
  /** Tenant KMS key id, e.g. localTenantKeyId(tenantId) with LocalKms. */
  keyIdFor: (tenantId: string) => string;
}

export const ENCRYPTED_CLASSES: readonly DataClass[] = ["CONFIDENTIAL", "REGULATED", "SECRET"];

const fieldContext = (tenantId: string): KmsEncryptionContext => ({
  tenant_id: tenantId,
  purpose: "field",
});

export class FieldCrypto {
  private readonly envelope: FieldEnvelope;
  constructor(private readonly o: FieldCryptoOptions) {
    this.envelope = new FieldEnvelope(o.kms, o);
  }

  async encryptField(
    tenantId: string,
    cls: DataClass,
    plaintext: string | Uint8Array,
    at: FieldLocation,
  ): Promise<SealedField> {
    if (!ENCRYPTED_CLASSES.includes(cls)) throw new Error(`${cls} fields are not field-encrypted`);
    return this.envelope.seal(
      this.o.keyIdFor(tenantId),
      plaintext,
      fieldAad(tenantId, at.table, at.column, at.rowId),
      fieldContext(tenantId),
    );
  }

  async decryptField(
    tenantId: string,
    sealed: SealedField,
    at: FieldLocation,
  ): Promise<Uint8Array> {
    if (sealed.keyId !== this.o.keyIdFor(tenantId))
      throw new Error("ciphertext belongs to another tenant key");
    return this.envelope.open(
      sealed,
      fieldAad(tenantId, at.table, at.column, at.rowId),
      fieldContext(tenantId),
    );
  }

  async decryptFieldText(
    tenantId: string,
    sealed: SealedField,
    at: FieldLocation,
  ): Promise<string> {
    return new TextDecoder().decode(await this.decryptField(tenantId, sealed, at));
  }

  /**
   * Upgrade a v1 field to v2 by re-wrapping its data key under the tenant's KMS context. The field
   * ciphertext is unchanged, so no plaintext is re-encrypted; a v2 field is returned as is.
   */
  async rewrapField(tenantId: string, sealed: SealedField): Promise<SealedField> {
    if (sealed.keyId !== this.o.keyIdFor(tenantId))
      throw new Error("ciphertext belongs to another tenant key");
    return this.envelope.rewrapToV2(sealed, fieldContext(tenantId));
  }

  /** Envelope format of a stored field: 1 (pre-PL2-D-50) or 2. */
  formatVersion(sealed: SealedField): 1 | 2 {
    return this.envelope.formatVersion(sealed);
  }

  clear(): void {
    this.envelope.clear();
  }
}
