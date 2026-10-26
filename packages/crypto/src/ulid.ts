// ULID and prefixed identifiers (IPB-01 §01.4.6), deterministic seed IDs (PL1-C-07).
import { sha256 } from "./hash.js";
import { randomBytes } from "./random.js";
import { toBytes } from "./encoding.js";

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function encodeTime(ms: number): string {
  if (!Number.isInteger(ms) || ms < 0 || ms > 2 ** 48 - 1)
    throw new RangeError("ULID time out of range");
  let t = ms;
  let out = "";
  for (let i = 0; i < 10; i++) {
    out = (ALPHABET[t % 32] as string) + out;
    t = Math.floor(t / 32);
  }
  return out;
}

/** 80 bits → 16 Crockford characters. */
function encodeRandom(bytes: Uint8Array): string {
  if (bytes.byteLength < 10) throw new Error("need 10 bytes");
  let bits = 0n;
  for (let i = 0; i < 10; i++) bits = (bits << 8n) | BigInt(bytes[i] as number);
  let out = "";
  for (let i = 0; i < 16; i++) {
    out = (ALPHABET[Number(bits & 31n)] as string) + out;
    bits >>= 5n;
  }
  return out;
}

export function ulid(now: number = Date.now()): string {
  return encodeTime(now) + encodeRandom(randomBytes(10));
}

const PREFIX = /^[a-z]{2,6}$/;

/** `<prefix>_<ULID>` (IPB-01 §01.4.6, Ecosystem Spec §5.1). */
export function newId(prefix: string, now?: number): string {
  if (!PREFIX.test(prefix)) throw new Error(`invalid id prefix "${prefix}"`);
  return `${prefix}_${ulid(now)}`;
}

/**
 * Deterministic ID for seeds (IPB-11-23, PL1-C-07): the ULID time part is the seed anchor date and
 * the 80-bit random part is the first 10 bytes of SHA-256(namespace ‖ 0x00 ‖ naturalKey).
 * Not used for anything secret.
 */
export function deterministicId(
  prefix: string,
  namespace: string,
  naturalKey: string,
  anchor: Date,
): string {
  if (!PREFIX.test(prefix)) throw new Error(`invalid id prefix "${prefix}"`);
  const h = sha256(new Uint8Array([...toBytes(namespace), 0, ...toBytes(naturalKey)]));
  return `${prefix}_${encodeTime(anchor.getTime())}${encodeRandom(h)}`;
}

export function ulidTime(id: string): number {
  const u = id.includes("_") ? id.slice(id.indexOf("_") + 1) : id;
  let t = 0;
  for (const ch of u.slice(0, 10)) t = t * 32 + ALPHABET.indexOf(ch);
  return t;
}
