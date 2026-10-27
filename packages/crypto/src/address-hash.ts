// C-23 (PL3-D-05): the keyed address hash for the NOTIFY suppression list and marketing consent.
// HMAC-SHA-256 of the normalised address (lower-cased e-mail; E.164 phone) with the group consent
// key, full 64-hex output. The address itself is never stored next to it.
import { hmacSha256Hex } from "./hmac.js";
import type { SecretKey } from "./keys.js";

export type AddressKind = "email" | "phone";

const E164 = /^\+[1-9]\d{7,14}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Normalise an address for hashing; throws on a value that is not an address of that kind. */
export function normaliseAddress(kind: AddressKind, address: string): string {
  if (kind === "email") {
    const a = address.trim().toLowerCase();
    if (!EMAIL.test(a)) throw new Error("not an e-mail address");
    return a;
  }
  const p = address.replace(/[\s()-]/g, "");
  if (!E164.test(p)) throw new Error("not an E.164 phone number");
  return p;
}

/** C-23 address hash: `hmac-sha256(groupConsentKey, "<kind>:<normalised address>")`, 64 hex. */
export function addressHash(
  groupConsentKey: SecretKey,
  kind: AddressKind,
  address: string,
): string {
  return hmacSha256Hex(groupConsentKey, `${kind}:${normaliseAddress(kind, address)}`);
}
