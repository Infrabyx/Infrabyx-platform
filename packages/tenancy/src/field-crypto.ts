// Field-level envelope encryption with per-tenant KMS keys (IPB-02-20, §02.4.3.2). Primitives
// come from @infrabyx/crypto (IPB-12-05); REGULATED and SECRET values are always encrypted.
// New seals use envelope format v2: the data key is wrapped under the C-14 KMS context
// { tenant_id, purpose: "field" } (PL2-D-50); v1 fields stay readable and `rewrapField` upgrades them.
import type { DataClass } from "@infrabyx/contracts/data-class";
import { PortError } from "@infrabyx/contracts/errors";
import type { KmsEncryptionContext, KmsPort } from "@infrabyx/contracts/ports";
import {
  FieldEnvelope,
  fieldAad,
  localTenantKeyId,
  type EnvelopeOptions,
  type SealedField,
} from "@infrabyx/crypto";

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

// ---------------------------------------------------------------------------------------------
// Tenant-bound field encryption over the KMS port (PR-LDC-16; R1-plan M42; R1-D-73).
//
// The key id is never supplied by the caller: it is derived from the KMS adapter and the validated
// tenant id only, following each adapter's own `createTenantKey` (C-15): one key per tenant,
// automatic yearly rotation, and the purpose fixed to "field" in the C-14 encryption context, so
// the envelope's data keys are per tenant and per purpose. No new algorithm, mode or library: the
// envelope is the existing v2 FieldEnvelope (AES-256-GCM, PL1-C-04, PL2-D-50).

/** A tenant id: `tnt_` and a 26-character Crockford ULID, as `TenantBootstrap` takes it. */
const TENANT_ID = /^tnt_[0-9A-HJKMNP-TV-Z]{26}$/;

/**
 * The tenant key-id convention per KMS adapter (PR-LDC-16; R1-D-73). Each entry names the key that
 * adapter's `createTenantKey(tenantId)` creates: LocalKms `local:tenant:<id>`, AWS KMS the alias
 * `alias/ipb/tenant/<id>` (connectors `aws-kms`), Vault Transit the key `tenant-<id>`
 * (connectors `vault-transit`). An adapter not listed here is refused (fail closed).
 */
const TENANT_KEY_IDS: ReadonlyMap<string, (tenantId: string) => string> = new Map([
  ["local", localTenantKeyId],
  ["aws-kms", (t: string) => `alias/ipb/tenant/${t}`],
  ["vault-transit", (t: string) => `tenant-${t}`],
]);

/** Envelope tuning only (cache lifetime and uses, both capped by the envelope); never a key id. */
export type FieldCryptoForTenantOptions = Pick<EnvelopeOptions, "ttlMs" | "maxUses" | "now">;

/**
 * The tenant's field-encryption key id on this KMS adapter (PR-LDC-16; R1-plan M42; R1-D-73).
 * Refuses a malformed tenant id (`RangeError`) and an adapter without a convention (`IPB-PORT-001`).
 */
export function tenantFieldKeyId(kms: Pick<KmsPort, "descriptor">, tenantId: string): string {
  if (typeof tenantId !== "string" || !TENANT_ID.test(tenantId))
    throw new RangeError("a tenant id is tnt_ followed by a ULID");
  const { port, adapter } = kms.descriptor;
  const keyIdFor = port === "KMS" ? TENANT_KEY_IDS.get(adapter) : undefined;
  if (!keyIdFor)
    throw new PortError("IPB-PORT-001", "KMS", {
      adapter,
      detail: "no tenant key-id convention for this KMS adapter",
      meta: { reason: "unsupported" },
    });
  return keyIdFor(tenantId);
}

/**
 * A FieldCrypto bound to one tenant (PR-LDC-16; R1-plan M42; R1-D-73). It keeps the per-call
 * signature, so it can be passed wherever a FieldCrypto is taken, but every call naming another
 * tenant is refused before the KMS is called; a ciphertext of another tenant is refused by its key
 * id, and a key id swapped in still fails at the KMS (other key, other `tenant_id` context) and at
 * the field AAD (tenant ‖ table ‖ column ‖ row).
 */
export class TenantFieldCrypto extends FieldCrypto {
  readonly tenantId: string;
  readonly keyId: string;

  constructor(kms: KmsPort, tenantId: string, opts: FieldCryptoForTenantOptions = {}) {
    const keyId = tenantFieldKeyId(kms, tenantId);
    super({
      ...(opts.ttlMs !== undefined ? { ttlMs: opts.ttlMs } : {}),
      ...(opts.maxUses !== undefined ? { maxUses: opts.maxUses } : {}),
      ...(opts.now !== undefined ? { now: opts.now } : {}),
      kms,
      keyIdFor: (t: string) => {
        if (t !== tenantId) throw new Error("this FieldCrypto is bound to another tenant");
        return keyId;
      },
    });
    this.tenantId = tenantId;
    this.keyId = keyId;
  }
}

/**
 * FieldCrypto for one tenant over the KMS port, with the platform's tenant key-id convention
 * (PR-LDC-16; R1-plan M42; R1-D-73). The tenant's key must exist (`kms.createTenantKey(tenantId)`
 * when the tenant is provisioned); a missing key fails closed at the first seal.
 */
export function fieldCryptoForTenant(
  kms: KmsPort,
  tenantId: string,
  opts?: FieldCryptoForTenantOptions,
): TenantFieldCrypto {
  return new TenantFieldCrypto(kms, tenantId, opts);
}
