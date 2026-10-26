// SHA-256 (PL1-C-01, IPB-12-05: the only hash call-site).
import { createHash } from "node:crypto";
import { canonicalize } from "./jcs.js";
import { toBytes, toHex, type BytesLike } from "./encoding.js";

export type HashAlgorithm = "sha-256";

export function sha256(data: BytesLike): Uint8Array {
  return new Uint8Array(createHash("sha256").update(toBytes(data)).digest());
}

export function sha256Hex(data: BytesLike): string {
  return toHex(sha256(data));
}

/** Generic entry point; only SHA-256 is approved in the registry today. */
export function hash(alg: HashAlgorithm, data: BytesLike): Uint8Array {
  if (alg !== "sha-256") throw new Error(`hash algorithm ${String(alg)} not approved`);
  return sha256(data);
}

/** SHA-256 hex of the RFC 8785 canonical JSON of `value` (ledger before/after digests). */
export function canonicalDigest(value: unknown): string {
  return sha256Hex(canonicalize(value));
}
