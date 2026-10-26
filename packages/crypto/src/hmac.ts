// HMAC-SHA-256 (PL1-C-02 pseudonymisation, PL1-C-05 blind index).
import { createHmac, hkdfSync } from "node:crypto";
import { toBytes, toHex, type BytesLike } from "./encoding.js";
import { keyMaterial, SecretKey } from "./keys.js";

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

/** HKDF-SHA-256 sub-key of `key` for one purpose, so hashes under different labels cannot be joined. */
export function deriveSubKey(key: SecretKey, label: string): SecretKey {
  const okm = hkdfSync("sha256", keyMaterial(key), new Uint8Array(0), label, 32);
  return new SecretKey(`${key.id}/${label}`, "hmac-sha-256", new Uint8Array(okm));
}

/** HKDF label for telemetry and flag-context identifiers (PL2-C-04, C-21). */
export const TELEMETRY_ID_LABEL = "ipb/telemetry-id/v1";

/**
 * Hasher for tenant, user and flag-context IDs in telemetry (C-21): HMAC-SHA-256 under a key derived
 * from the PL1 pseudonym key with TELEMETRY_ID_LABEL, truncated to 128 bits (32 hex characters).
 */
export function telemetryIdHasher(pseudonymKey: SecretKey): (id: string) => string {
  const k = deriveSubKey(pseudonymKey, TELEMETRY_ID_LABEL);
  return (id) => hmacSha256Hex(k, id).slice(0, 32);
}
