// Blind index: HMAC-SHA-256 with a separate tenant-scoped key over a normalised value (PL1-C-05).
// Never deterministic encryption of the value itself (IPB-02 §02.4.3.2).
import { hmacSha256Hex } from "./hmac.js";
import type { SecretKey } from "./keys.js";

export function normaliseForIndex(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, "").toUpperCase();
}

export function blindIndex(
  key: SecretKey,
  value: string,
  normalise: (v: string) => string = normaliseForIndex,
): string {
  if (key.alg !== "hmac-sha-256") throw new Error("blind index key must be an hmac-sha-256 key");
  return hmacSha256Hex(key, normalise(value));
}
