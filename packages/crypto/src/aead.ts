// AES-256-GCM, 96-bit random nonce, 128-bit tag (PL1-C-04).
import { createCipheriv, createDecipheriv } from "node:crypto";
import { randomBytes } from "./random.js";
import { concatBytes } from "./encoding.js";

export const AES_GCM_NONCE_BYTES = 12;
export const AES_GCM_TAG_BYTES = 16;

/** Returns nonce ‖ ciphertext ‖ tag. */
export function aesGcmEncrypt(
  key: Uint8Array,
  plaintext: Uint8Array,
  aad?: Uint8Array,
): Uint8Array {
  if (key.byteLength !== 32) throw new Error("AES-256-GCM requires a 32-byte key");
  const nonce = randomBytes(AES_GCM_NONCE_BYTES);
  const c = createCipheriv("aes-256-gcm", key, nonce, { authTagLength: AES_GCM_TAG_BYTES });
  if (aad) c.setAAD(aad);
  const ct = Buffer.concat([c.update(plaintext), c.final()]);
  return concatBytes(nonce, new Uint8Array(ct), new Uint8Array(c.getAuthTag()));
}

export function aesGcmDecrypt(key: Uint8Array, sealed: Uint8Array, aad?: Uint8Array): Uint8Array {
  if (key.byteLength !== 32) throw new Error("AES-256-GCM requires a 32-byte key");
  if (sealed.byteLength < AES_GCM_NONCE_BYTES + AES_GCM_TAG_BYTES)
    throw new Error("ciphertext too short");
  const nonce = sealed.subarray(0, AES_GCM_NONCE_BYTES);
  const tag = sealed.subarray(sealed.byteLength - AES_GCM_TAG_BYTES);
  const ct = sealed.subarray(AES_GCM_NONCE_BYTES, sealed.byteLength - AES_GCM_TAG_BYTES);
  const d = createDecipheriv("aes-256-gcm", key, nonce, { authTagLength: AES_GCM_TAG_BYTES });
  if (aad) d.setAAD(aad);
  d.setAuthTag(tag);
  return new Uint8Array(Buffer.concat([d.update(ct), d.final()]));
}

/** Known-answer testing only: encrypt with a caller-supplied nonce. Not exported from the package index. */
export function aesGcmEncryptWithNonceForTest(
  key: Uint8Array,
  nonce: Uint8Array,
  plaintext: Uint8Array,
  aad?: Uint8Array,
): Uint8Array {
  const c = createCipheriv("aes-256-gcm", key, nonce, { authTagLength: AES_GCM_TAG_BYTES });
  if (aad) c.setAAD(aad);
  const ct = Buffer.concat([c.update(plaintext), c.final()]);
  return concatBytes(nonce, new Uint8Array(ct), new Uint8Array(c.getAuthTag()));
}
