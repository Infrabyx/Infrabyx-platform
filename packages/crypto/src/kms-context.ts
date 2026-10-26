// C-14 encryption context for KMS data keys (PL2-D-50): `{ tenant_id, purpose }` encoded as JCS
// bytes. AWS KMS receives it as the encryption context, Vault Transit as associated data and
// LocalKms as AES-GCM AAD, so a data key wrapped for one tenant and purpose unwraps for no other.
import { IpbError } from "@infrabyx/contracts/errors";
import { isKmsEncryptionContext, type KmsEncryptionContext } from "@infrabyx/contracts/ports";
import { canonicalize } from "./jcs.js";

const enc = new TextEncoder();

export function encodeKmsContext(ctx: KmsEncryptionContext): Uint8Array {
  if (!isKmsEncryptionContext(ctx))
    throw new IpbError("IPB-PORT-003", {
      detail: "KMS context must be exactly { tenant_id, purpose } with a registered purpose (C-14)",
    });
  return enc.encode(canonicalize({ purpose: ctx.purpose, tenant_id: ctx.tenant_id }));
}

/** The context encoded in `aad`, or null when `aad` is not exactly a canonical C-14 context. */
export function decodeKmsContext(aad?: Uint8Array): KmsEncryptionContext | null {
  if (!aad || aad.byteLength === 0) return null;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(aad);
    const v = JSON.parse(text) as unknown;
    return isKmsEncryptionContext(v) && canonicalize(v) === text ? v : null;
  } catch {
    return null;
  }
}

/** For adapters: a data key may only be wrapped under a valid C-14 context (IPB-PORT-003). */
export function assertKmsContext(aad: Uint8Array | undefined): KmsEncryptionContext {
  const ctx = decodeKmsContext(aad);
  if (!ctx)
    throw new IpbError("IPB-PORT-003", {
      detail: "a data key needs the C-14 encryption context { tenant_id, purpose } (PL2-D-50)",
    });
  return ctx;
}
