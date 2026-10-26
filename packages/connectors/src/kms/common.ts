// Shared KMS helpers (PL2 plan §6.2, C-14). The port's AAD bytes become the AWS encryption context:
// a JCS-encoded flat string map (`kmsContext({ tenant_id, purpose })`) is passed as that map, and any
// other AAD under the single key `ipb:aad` (base64url), so AAD always binds the ciphertext.
import { PortError } from "@infrabyx/contracts/errors";
import { PLATFORM_KMS_TENANT, type KmsEncryptionContext } from "@infrabyx/contracts/ports";
import { assertKmsContext, canonicalize, encodeKmsContext, toBase64Url } from "@infrabyx/crypto";

/** AAD for KMS calls: the C-14 encryption context `{ tenant_id, purpose }` (PL2-D-50). */
export function kmsContext(ctx: KmsEncryptionContext): Uint8Array {
  return encodeKmsContext(ctx);
}

/** Context of the encrypt/decrypt health canary. */
export const HEALTH_CONTEXT = (): Uint8Array =>
  encodeKmsContext({ tenant_id: PLATFORM_KMS_TENANT, purpose: "health" });

/** generateDataKey refuses a data key without a valid C-14 context (PL2-D-50). */
export function requireDataKeyContext(adapter: string, aad?: Uint8Array): void {
  try {
    assertKmsContext(aad);
  } catch (e) {
    throw new PortError("IPB-PORT-003", "KMS", {
      adapter,
      detail: (e as Error).message.replace(/^IPB-PORT-003: [^—]*— /, ""),
    });
  }
}

/** AAD bytes → AWS EncryptionContext. */
export function toEncryptionContext(aad?: Uint8Array): Record<string, string> | undefined {
  if (!aad || aad.byteLength === 0) return undefined;
  try {
    const v = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(aad)) as unknown;
    if (
      typeof v === "object" &&
      v !== null &&
      !Array.isArray(v) &&
      Object.keys(v).length > 0 &&
      Object.keys(v).length <= 16 &&
      Object.values(v).every((x) => typeof x === "string") &&
      canonicalize(v) === new TextDecoder().decode(aad)
    )
      return v as Record<string, string>;
  } catch {
    // not a context map; fall through
  }
  return { "ipb:aad": toBase64Url(aad) };
}

export const SIGN_ALG = "ecdsa-p256-sha256";
export const KMS_ALGORITHMS = ["aes-256-gcm", SIGN_ALG] as const;

export function checkSignAlg(adapter: string, alg: string): void {
  if (alg !== SIGN_ALG)
    throw new PortError("IPB-PORT-001", "KMS", {
      adapter,
      detail: `signing algorithm ${alg} is not approved (C-14)`,
      meta: { reason: "unsupported" },
    });
}

/** Deletion is scheduled, never immediate, and only with 30 days (C-15, IPB-02-20). */
export function checkDeletionDays(adapter: string, days: number): void {
  if (days !== 30)
    throw new PortError("IPB-PORT-003", "KMS", {
      adapter,
      detail: "key deletion must be scheduled exactly 30 days ahead (C-15)",
    });
}

/** Decrypt refused: the key is unavailable, or the ciphertext or AAD does not verify (IPB-KMS-001). */
export const decryptRefused = (
  adapter: string,
  reason: "unavailable" | "integrity" | "pending_deletion",
) => new PortError("IPB-KMS-001", "KMS", { adapter, meta: { reason } });

export function pemToDer(pem: string): Uint8Array {
  const b64 = pem.replace(/-----(BEGIN|END) PUBLIC KEY-----/g, "").replace(/\s+/g, "");
  return new Uint8Array(Buffer.from(b64, "base64"));
}
