// HMAC-SHA-256 (PL1-C-02 pseudonymisation, PL1-C-05 blind index).
import { createHmac } from "node:crypto";
import { toBytes, toHex, type BytesLike } from "./encoding.js";
import { keyMaterial, type SecretKey } from "./keys.js";

export function hmacSha256(key: SecretKey, data: BytesLike): Uint8Array {
  return new Uint8Array(createHmac("sha256", keyMaterial(key)).update(toBytes(data)).digest());
}

export function hmacSha256Hex(key: SecretKey, data: BytesLike): string {
  return toHex(hmacSha256(key, data));
}

/**
 * Keyed pseudonym for ip_hash, ua_hash and hashed actor ids (PL1-C-02). The chain itself stays
 * unkeyed so tenants can verify it; these values are keyed so they cannot be reversed by dictionary.
 */
export function pseudonymise(key: SecretKey, value: string): string {
  return hmacSha256Hex(key, value);
}

/** `sha256:<hex>` form used by the internal envelope `actorid` (IPB-10-37). */
export function hashedActorId(key: SecretKey, actorId: string): string {
  return `sha256:${pseudonymise(key, actorId)}`;
}
