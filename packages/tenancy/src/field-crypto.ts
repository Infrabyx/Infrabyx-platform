// Field-level envelope encryption with per-tenant KMS keys (IPB-02-20, §02.4.3.2). Primitives
// come from @infrabyx/crypto (IPB-12-05); REGULATED and SECRET values are always encrypted.
import type { DataClass } from "@infrabyx/contracts/data-class";
import type { KmsPort } from "@infrabyx/contracts/ports";
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
    );
  }

  async decryptField(
    tenantId: string,
    sealed: SealedField,
    at: FieldLocation,
  ): Promise<Uint8Array> {
    if (sealed.keyId !== this.o.keyIdFor(tenantId))
      throw new Error("ciphertext belongs to another tenant key");
    return this.envelope.open(sealed, fieldAad(tenantId, at.table, at.column, at.rowId));
  }

  async decryptFieldText(
    tenantId: string,
    sealed: SealedField,
    at: FieldLocation,
  ): Promise<string> {
    return new TextDecoder().decode(await this.decryptField(tenantId, sealed, at));
  }

  clear(): void {
    this.envelope.clear();
  }
}
