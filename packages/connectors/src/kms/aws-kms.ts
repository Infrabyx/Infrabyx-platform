// KMS reference adapter `aws-kms` (PL2 plan §6.2, C-14, C-15): AWS KMS in ap-south-1 (or the
// ap-south-2 DR region). SYMMETRIC_DEFAULT for encrypt/decrypt/generateDataKey with the C-14
// encryption context; ECC_NIST_P256 with ECDSA_SHA_256 and MessageType DIGEST for signing; one
// customer-managed key per tenant (alias `alias/ipb/tenant/<id>`, annual rotation); deletion only
// with 30 days. Decrypt fails closed with IPB-KMS-001; there is no plaintext fallback.
import { PortError } from "@infrabyx/contracts/errors";
import type { AdapterDescriptor, DataKey, KmsPort, PortHealth } from "@infrabyx/contracts/ports";
import { sha256 } from "@infrabyx/crypto";
import {
  HEALTH_CONTEXT,
  KMS_ALGORITHMS,
  requireDataKeyContext,
  checkDeletionDays,
  checkSignAlg,
  decryptRefused,
  toEncryptionContext,
} from "./common.js";

type K = typeof import("@aws-sdk/client-kms");

export interface AwsKmsOptions {
  region: string;
  /** Platform key, used by health() for the encrypt/decrypt canary. */
  platformKeyId?: string;
  /** Tests only: LocalStack endpoint and static credentials. */
  endpoint?: string;
  credentials?: { accessKeyId: string; secretAccessKey: string };
}

const REGIONS = new Set(["ap-south-1", "ap-south-2"]);
const TENANT = /^[A-Za-z0-9_]{1,64}$/;

export class AwsKms implements KmsPort {
  readonly descriptor: AdapterDescriptor = {
    port: "KMS",
    adapter: "aws-kms",
    residency: "IN",
    maxDataClass: "SECRET",
  };

  private constructor(
    private readonly o: AwsKmsOptions,
    private readonly k: K,
    private readonly client: InstanceType<K["KMSClient"]>,
  ) {}

  static async create(o: AwsKmsOptions): Promise<AwsKms> {
    if (!REGIONS.has(o.region))
      throw new PortError("IPB-PORT-005", "KMS", {
        adapter: "aws-kms",
        detail: `region ${o.region} is not an India region (residency IN)`,
      });
    const k = await import("@aws-sdk/client-kms");
    return new AwsKms(
      o,
      k,
      new k.KMSClient({
        region: o.region,
        maxAttempts: 3,
        ...(o.endpoint ? { endpoint: o.endpoint } : {}),
        ...(o.credentials ? { credentials: o.credentials } : {}),
      }),
    );
  }

  private name(e: unknown): string {
    return (e as { name?: string })?.name ?? "";
  }

  async encrypt(keyId: string, plaintext: Uint8Array, aad?: Uint8Array): Promise<Uint8Array> {
    const ctx = toEncryptionContext(aad);
    const r = await this.client.send(
      new this.k.EncryptCommand({
        KeyId: keyId,
        Plaintext: plaintext,
        ...(ctx ? { EncryptionContext: ctx } : {}),
      }),
    );
    return r.CiphertextBlob as Uint8Array;
  }

  async decrypt(keyId: string, ciphertext: Uint8Array, aad?: Uint8Array): Promise<Uint8Array> {
    const ctx = toEncryptionContext(aad);
    try {
      const r = await this.client.send(
        new this.k.DecryptCommand({
          KeyId: keyId,
          CiphertextBlob: ciphertext,
          ...(ctx ? { EncryptionContext: ctx } : {}),
        }),
      );
      return r.Plaintext as Uint8Array;
    } catch (e) {
      const n = this.name(e);
      if (n === "KMSInvalidStateException") throw decryptRefused("aws-kms", "pending_deletion");
      if (n === "InvalidCiphertextException" || n === "IncorrectKeyException")
        throw decryptRefused("aws-kms", "integrity");
      // Everything else (outage, throttling, access) fails closed too: no plaintext fallback.
      throw decryptRefused("aws-kms", "unavailable");
    }
  }

  async generateDataKey(keyId: string, aad?: Uint8Array): Promise<DataKey> {
    requireDataKeyContext("aws-kms", aad);
    const ctx = toEncryptionContext(aad);
    const r = await this.client.send(
      new this.k.GenerateDataKeyCommand({
        KeyId: keyId,
        KeySpec: "AES_256",
        ...(ctx ? { EncryptionContext: ctx } : {}),
      }),
    );
    return {
      plaintext: r.Plaintext as Uint8Array,
      ciphertext: r.CiphertextBlob as Uint8Array,
      keyId,
    };
  }

  /** The digest is computed here and signed with MessageType DIGEST (C-14, PL1-D-09). */
  async sign(keyId: string, message: Uint8Array, alg: string): Promise<Uint8Array> {
    checkSignAlg("aws-kms", alg);
    const r = await this.client.send(
      new this.k.SignCommand({
        KeyId: keyId,
        Message: sha256(message),
        MessageType: "DIGEST",
        SigningAlgorithm: "ECDSA_SHA_256",
      }),
    );
    return r.Signature as Uint8Array;
  }

  async verify(
    keyId: string,
    message: Uint8Array,
    signature: Uint8Array,
    alg: string,
  ): Promise<boolean> {
    if (alg !== "ecdsa-p256-sha256") return false;
    try {
      const r = await this.client.send(
        new this.k.VerifyCommand({
          KeyId: keyId,
          Message: sha256(message),
          MessageType: "DIGEST",
          Signature: signature,
          SigningAlgorithm: "ECDSA_SHA_256",
        }),
      );
      return r.SignatureValid === true;
    } catch (e) {
      if (this.name(e) === "KMSInvalidSignatureException") return false;
      throw e;
    }
  }

  async getPublicKey(keyId: string): Promise<Uint8Array> {
    const r = await this.client.send(new this.k.GetPublicKeyCommand({ KeyId: keyId }));
    return r.PublicKey as Uint8Array;
  }

  /** One CMK per tenant holding REGULATED fields (C-15); idempotent through its alias. */
  async createTenantKey(tenantId: string): Promise<{ keyId: string }> {
    if (!TENANT.test(tenantId))
      throw new PortError("IPB-PORT-003", "KMS", {
        adapter: "aws-kms",
        detail: "invalid tenant id",
      });
    const alias = `alias/ipb/tenant/${tenantId}`;
    try {
      const d = await this.client.send(new this.k.DescribeKeyCommand({ KeyId: alias }));
      return { keyId: d.KeyMetadata?.KeyId as string };
    } catch (e) {
      if (this.name(e) !== "NotFoundException") throw e;
    }
    const c = await this.client.send(
      new this.k.CreateKeyCommand({
        KeySpec: "SYMMETRIC_DEFAULT",
        KeyUsage: "ENCRYPT_DECRYPT",
        Description: `Tenant key for REGULATED fields (C-15)`,
        Tags: [
          { TagKey: "ipb:tenant_id", TagValue: tenantId },
          { TagKey: "ipb:purpose", TagValue: "tenant-regulated" },
        ],
      }),
    );
    const keyId = c.KeyMetadata?.KeyId as string;
    await this.client.send(new this.k.EnableKeyRotationCommand({ KeyId: keyId }));
    await this.client.send(new this.k.CreateAliasCommand({ AliasName: alias, TargetKeyId: keyId }));
    return { keyId };
  }

  /**
   * Schedule deletion exactly 30 days ahead. The R5 maker-checker approval with its 72 h delay, the
   * tenant's purge instruction and the legal-hold check happen before this call (C-15).
   */
  async scheduleKeyDeletion(keyId: string, days: number): Promise<{ deletionDate: string }> {
    checkDeletionDays("aws-kms", days);
    const r = await this.client.send(
      new this.k.ScheduleKeyDeletionCommand({ KeyId: keyId, PendingWindowInDays: 30 }),
    );
    return {
      deletionDate: (r.DeletionDate ?? new Date(Date.now() + 30 * 86_400_000)).toISOString(),
    };
  }

  async listAlgorithms(): Promise<string[]> {
    return [...KMS_ALGORITHMS];
  }

  async health(): Promise<PortHealth> {
    const t = Date.now();
    try {
      if (this.o.platformKeyId) {
        const probe = new TextEncoder().encode("ipb-kms-canary");
        const aad = HEALTH_CONTEXT();
        const ct = await this.encrypt(this.o.platformKeyId, probe, aad);
        await this.decrypt(this.o.platformKeyId, ct, aad);
      } else await this.client.send(new this.k.ListKeysCommand({ Limit: 1 }));
      return { status: "up", latency_ms: Date.now() - t, checked_at: new Date().toISOString() };
    } catch {
      return { status: "down", latency_ms: Date.now() - t, checked_at: new Date().toISOString() };
    }
  }
}
